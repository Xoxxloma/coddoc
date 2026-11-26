#!/usr/bin/env python3
"""collect — первый шаг оценки: выгрузки сессий → сжатые журналы для модели и факты для merge.

    python3 collect.py --sessions <id>.json | <папка с *.json> [--out <рабочая папка>] [--user имя] [--context-window N]
                       [--params <файл параметров>]

Один файл `<id>.json` — одна сессия, выгрузка событий хуков агента (SessionFile: массив events с eventName
START_SESSION, USER_PROMPT, ASSISTANT_ANSWER, ASK_USER_QUESTION, SKILL_USE, STOP_FAILURE). Вызовов инструментов и
промежуточных реплик агента в выгрузке нет: агент виден последним сообщением за ход. Вход — одна выгрузка или папка;
итоги прошлого запуска <id>.quality.json в папке — не сессии. В --out (по умолчанию .quality-work рядом с сессиями) пишет:
  <id>.journal.txt — сжатый журнал: одна строка на событие, [N] — номер события в выгрузке;
  <id>.facts.json  — числа и кандидаты по сессии для merge;
  collect.json     — список сессий, пропущенные файлы и сверка полей журнала.
Пороги и размеры — из params.json (или --params). Журналы только читаются. В сжатом журнале и кандидатах
секреты и длинные числа замаскированы.
На экран — только счёт, без текста из журналов.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

import params

# Пороги и размеры ставит configure() из params.json; здесь только имена, которыми пользуется код.
MIN_USER_TURNS = INSERT_LIMIT = INSERT_PREVIEW = AGENT_HEAD = AGENT_TAIL = JOURNAL_LIMIT = CONTEXT_WINDOW = None
DUPLICATE_SECONDS = None
DECISION_MIN = READING_SPEED = HUMAN_SPEED = HUMAN_MIN_SECONDS = REPEAT_MIN_CHARS = None

EVENT_NAMES = ("START_SESSION", "USER_PROMPT", "ASSISTANT_ANSWER", "ASK_USER_QUESTION", "SKILL_USE", "STOP_FAILURE")
USER_LABEL = "ПОЛЬЗОВАТЕЛЬ"  # реплики пользователя в сжатом журнале
CHECKS_HEADER = "## Проверить — на каждую строку ровно один ответ в checks"

KEYED_SECRET_RE = re.compile(
    r"\b(пароль|password|passwd|pwd|token|токен|secret|секрет|api[_-]?key)(\s+от\s+\S+)?(\s*[:=]\s*|\s+)(?=\S*\d)(\S+)",
    re.IGNORECASE)
KEYED_WORDS_RE = re.compile(  # «токен для гита: …» — между словом и значением пара слов и двоеточие
    r"\b(пароль|password|passwd|pwd|token|токен|secret|секрет|api[_-]?key)([^\n:=]{1,30}?)(\s*[:=]\s*)(?=\S*\d)(\S+)",
    re.IGNORECASE)
TOKEN_RE = re.compile(  # токены узнаются по форме, без ключевого слова рядом
    r"\b(?:ghp|gho|ghu|ghs|glpat|xox[abpr])[-_][A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b"
    r"|\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}")
BEARER_RE = re.compile(r"\b(bearer)\s+[A-Za-z0-9._~+/=-]{10,}", re.IGNORECASE)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")
CARD_RE = re.compile(r"(?<!\d)(?:\d ?){12,18}\d(?!\d)")
PHONE_RE = re.compile(r"(?<!\d)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
SNILS_RE = re.compile(r"(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)")
LONG_DIGITS_RE = re.compile(r"(?<![\d.])\d{7,}(?![\d.])")
PASTE_RE = re.compile(r"\[Pasted Content[^\]]*\]", re.IGNORECASE)  # заглушка вставки: текста в выгрузке нет


# ---------------------------------------------------------------- параметры


def configure(data):
    """Значения из params.json — в имена, которыми пользуется код."""
    global MIN_USER_TURNS, INSERT_LIMIT, INSERT_PREVIEW, AGENT_HEAD, AGENT_TAIL, JOURNAL_LIMIT, CONTEXT_WINDOW
    global DUPLICATE_SECONDS
    global DECISION_MIN, READING_SPEED, HUMAN_SPEED, HUMAN_MIN_SECONDS, REPEAT_MIN_CHARS

    def get(key):
        return params.value(data, key)

    MIN_USER_TURNS, INSERT_LIMIT, INSERT_PREVIEW = get("min_user_turns"), get("insert_limit"), get("insert_preview")
    AGENT_HEAD, AGENT_TAIL, CONTEXT_WINDOW = get("agent_head"), get("agent_tail"), get("context_window")
    JOURNAL_LIMIT, DECISION_MIN, READING_SPEED = get("journal_limit"), get("decision_min_chars"), get("reading_speed")
    DUPLICATE_SECONDS = get("duplicate_seconds")
    HUMAN_SPEED, HUMAN_MIN_SECONDS = get("human_speed"), get("human_min_seconds")
    REPEAT_MIN_CHARS = get("autoinput_repeat_min_chars")


configure(params.load())


# ---------------------------------------------------------------- утилиты


def parse_ts(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def iso(stamp):
    return stamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if stamp else None


def one_line(text):
    return re.sub(r"\s+", " ", text).strip()


def clip(text, limit):
    text = one_line(text)
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def clip_agent(text):
    text = one_line(text)
    if len(text) <= AGENT_HEAD + AGENT_TAIL:
        return text
    return f"{text[:AGENT_HEAD].rstrip()} … {text[-AGENT_TAIL:].lstrip()}"


def luhn(digits):
    total = 0
    for index, char in enumerate(reversed(digits)):
        number = int(char)
        if index % 2:
            number = number * 2 - 9 if number > 4 else number * 2
        total += number
    return total % 10 == 0


def is_card(match):
    digits = re.sub(r"\D", "", match.group(0))
    return 13 <= len(digits) <= 19 and luhn(digits)


def mask(text):
    text = TOKEN_RE.sub("****", text)
    text = KEYED_SECRET_RE.sub(lambda m: m.group(1) + (m.group(2) or "") + m.group(3) + "****", text)
    text = KEYED_WORDS_RE.sub(lambda m: m.group(1) + m.group(2) + m.group(3) + "****", text)
    text = BEARER_RE.sub(r"\1 ****", text)
    text = PRIVATE_KEY_RE.sub("-----BEGIN **** KEY-----", text)
    text = CARD_RE.sub(lambda m: "****" if is_card(m) else m.group(0), text)
    text = PHONE_RE.sub("****", text)
    text = EMAIL_RE.sub("***@***", text)
    text = SNILS_RE.sub("****", text)
    return LONG_DIGITS_RE.sub("****", text)


def repeat_key(text):
    normal = re.sub(r"[^\w\s]", " ", text.casefold())
    normal = one_line(normal)
    if len(normal) < REPEAT_MIN_CHARS:
        return None
    return hashlib.sha1(normal.encode("utf-8")).hexdigest()[:12]


def classify(raw, selected, labels, multi):
    """Ответ на вопрос с вариантами: выбранный вариант, свой текст или ответа нет."""
    def norm(value):
        return one_line(str(value)).casefold()

    if not one_line(raw) and not selected:
        return "нет ответа"
    names = {norm(label) for label in labels}
    if selected and all(norm(item) in names for item in selected):
        chosen = norm(", ".join(selected)) if multi else norm(selected[0])
        if not one_line(raw) or norm(raw) == chosen or norm(raw) in names:
            return "вариант"
    return "Другое"


# ---------------------------------------------------------------- разбор выгрузки


def read_export(path):
    """(события, битых событий, причина пропуска). Выгрузка — SessionFile: объект с массивом events. Событие годно,
    если у него известное имя и время; остальные считаются битыми и пропускаются, номера [N] сохраняют место."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None, 0, "не JSON"
    if not isinstance(data, dict) or not isinstance(data.get("events"), list):
        return None, 0, "нет массива events"
    events, bad = [], 0
    for number, event in enumerate(data["events"], 1):
        if not isinstance(event, dict) or not isinstance(event.get("eventName"), str) or parse_ts(event.get("createdAt")) is None:
            bad += 1
            continue
        events.append((number, event))
    if not events:
        return None, bad, "нет событий"
    return events, bad, None


WORK_SUFFIXES = (".journal.txt", ".facts.json", ".findings.txt")
WORK_DIR = ".quality-work"  # рабочая папка по умолчанию — рядом с сессиями; merge убирает её после записи итогов
OUTPUT_SUFFIXES = (".quality.json", ".quality.md", ".quality.log.txt")  # итоги merge рядом с выгрузкой — не сессии
WORK_NAMES = ("collect.json", "merge-log.txt")


def clean_work(folder):
    """Убирает из рабочей папки файлы прошлого запуска — только свои: журналы, факты, ответы субагентов, перепроверку.
    Иначе упавший субагент молча подменится ответом прошлого запуска. Чужие файлы не трогает. Возвращает число убранных."""
    removed = 0
    verify_dir = os.path.join(folder, "verify")
    if os.path.isdir(verify_dir):
        for name in os.listdir(verify_dir):
            if name.endswith((".md", ".answer.txt")):
                os.remove(os.path.join(verify_dir, name))
                removed += 1
        if not os.listdir(verify_dir):
            os.rmdir(verify_dir)
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            if os.path.isfile(path) and (name.endswith(WORK_SUFFIXES) or name in WORK_NAMES):
                os.remove(path)
                removed += 1
    return removed


def share_of(tokens, window):
    """Доля окна, не больше 1: токенов больше окна — значит, окно в параметрах задано меньше настоящего."""
    return min(1.0, round(tokens / window, 3)) if window else None


def text_of(event, key):
    value = event.get(key)
    return value if isinstance(value, str) else ""


class Session:
    """Проход по событиям одной выгрузки: строки сжатого журнала и факты."""

    def __init__(self, session_id, context_window):
        self.id = session_id
        self.context_window = context_window
        self.events = []
        self.hits = {key: 0 for key in EVENT_NAMES + ("inputTokens", "over_window", "compact", "duplicate", "unknown")}
        self.last_content = None      # (содержимое, время) прошлого события — для дублей выгрузки
        self.logins = set()
        self.user_turns = 0
        self.skills = []
        self.runs = []
        self.run = None
        self.agent_chars = 0          # непрочитанный текст агента — с последнего ответа пользователя
        self.agent_first_ts = None    # время первого непрочитанного куска
        self.question = None          # вопрос агента обычным текстом, на который ещё не ответили
        self.unanswered = None        # ход реплики пользователя, на которую агент ещё не ответил
        self.first_user_turn = None   # сессия без скиллов для «доведения до результата» — сама один запуск
        self.agent_replied = False    # агент ответил после первой реплики пользователя
        self.answers_total = 0
        self.verdicts = {"вариант": 0, "Другое": 0, "нет ответа": 0}
        self.decisions = []           # кандидаты «место решения»: ответ на вопрос агента или на длинный текст
        self.hidden = []              # реплики из одних заглушек вставки — текст не виден, в оценку не идут
        self.fast = []                # ответы быстрее человека
        self.streaks = []             # одинаковые реплики подряд
        self.streak = None
        self.last_tokens = None       # токены последнего запроса к модели
        self.api_errors = 0
        self.compressions = []        # ходы сжатий контекста
        self.peak = None              # (доля окна или None, токены, ход)
        self.after_error = False
        self.last_error = False       # последнее событие — ошибка API
        self.prev_stamp = None        # время прошлого события — показ вопроса с вариантами не выгружается
        self.unknown = set()          # имена неизвестных событий — для сверки типизации
        self.command = None           # скилл, только что вызванный через «/»: следом может прийти его SKILL_USE

    # -- общее

    def event(self, turn, text):
        self.events.append((turn, text))

    def start_run(self, name, turn, via):
        self.close_run("next_skill")
        self.run = {"skill": name, "turn": turn, "via": via, "user_turns": 0, "replied": False, "ended_by": None,
                    "question": None, "error_end": False,
                    # контекст на запросе прямо перед вызовом и было ли сжатие раньше — для «нагруженного контекста»
                    "context_tokens_before": self.last_tokens, "context_share_before": None,
                    "after_compression": bool(self.compressions)}
        self.skills.append(name)

    def close_run(self, reason):
        if not self.run:
            return
        self.run["ended_by"] = reason
        # Конец запуска — для «доведения до результата»: вопрос агента без ответа решает модель, ошибка API — не в счёт.
        pending = self.question
        if pending and pending["turn"] >= self.run["turn"]:
            self.run["question"] = dict(pending)
        unanswered = self.unanswered
        self.run["unanswered"] = unanswered if unanswered is not None and unanswered >= self.run["turn"] else None
        self.run["error_end"] = self.last_error
        self.runs.append(self.run)
        self.run = None

    def forget_unread(self):
        self.agent_chars = 0
        self.agent_first_ts = None

    def responded(self, turn, stamp, answer_chars, kind, asked, option=False):
        """Ответ пользователя: место ли это решения (решает модель) и успел ли он прочитать (считает скрипт)."""
        chars, first = self.agent_chars, self.agent_first_ts
        seconds = (stamp - first).total_seconds() if stamp and first else None
        if chars and (asked or chars >= DECISION_MIN):
            speed = chars / max(seconds, 0.5) if seconds is not None else None
            self.decisions.append({"turn": turn, "kind": kind, "asked": asked, "option": option, "agent_chars": chars,
                                   "answer_chars": answer_chars,
                                   "seconds": round(seconds, 1) if seconds is not None else None,
                                   "speed": round(speed) if speed is not None else None})
            if speed is not None and ((asked and seconds < HUMAN_MIN_SECONDS)
                                      or (chars >= DECISION_MIN and speed > HUMAN_SPEED)):
                self.fast.append({"turn": turn, "seconds": round(seconds, 1), "agent_chars": chars})
        self.forget_unread()

    def track_repeat(self, turn, key):
        """Одинаковые реплики подряд; повтор сразу после ошибки — не автоввод, а повторная попытка."""
        if key and self.streak and self.streak["key"] == key and not self.after_error:
            self.streak["count"] += 1
            return
        self.flush_streak()
        self.streak = {"key": key, "turn": turn, "count": 1} if key else None

    def flush_streak(self):
        if self.streak and self.streak["count"] >= 2:
            self.streaks.append({"turn": self.streak["turn"], "count": self.streak["count"]})
        self.streak = None

    # -- события

    def start(self, event, turn):
        source = text_of(event, "sessionStartSource")
        if source == "compact":
            self.hits["compact"] += 1
            self.compressions.append(turn)
            self.event(turn, "СЖАТИЕ КОНТЕКСТА")
        elif source and source != "startup":
            self.event(turn, f"СТАРТ СЕССИИ: {clip(source, 40)}")

    def prompt(self, event, turn, stamp):
        raw = text_of(event, "userPrompt")
        flat = one_line(raw)
        if not flat:
            return
        # Вызов через «/» — скилл, запущенный пользователем: SKILL_USE на него не приходит, запуск открывает реплика.
        command = flat[1:].split(maxsplit=1)[0] if flat.startswith("/") and len(flat) > 1 else None
        self.user_turns += 1
        self.last_error = False
        if self.first_user_turn is None:
            self.first_user_turn = turn
        if self.run and not command:
            self.run["user_turns"] += 1
        if len(raw) > INSERT_LIMIT:
            self.event(turn, f"{USER_LABEL}: {clip(mask(flat), INSERT_PREVIEW)} …(вставка, {len(raw)} симв.)")
        else:
            self.event(turn, f"{USER_LABEL}: {mask(flat)}")
        self.track_repeat(turn, repeat_key(flat))
        self.after_error = False
        asked = self.question is not None
        if PASTE_RE.sub("", flat).strip():
            self.responded(turn, stamp, len(flat), "text", asked)
        else:
            self.hidden.append(turn)  # судить не по чему — ни место решения, ни скорость чтения
            self.forget_unread()
        if asked:
            self.answers_total += 1
        self.question = None  # вопрос агента отвечен — в том числе вызовом скилла
        if command:
            self.start_run(command, turn, "user")
            self.run["user_turns"] += 1  # команда — первая реплика запуска
            self.event(turn, f"СКИЛЛ: {command} (вызов пользователем)")
        self.command = command
        self.unanswered = turn

    def answer(self, event, turn, stamp):
        tokens = event.get("inputTokens")
        if isinstance(tokens, int) and not isinstance(tokens, bool) and tokens > 0:
            self.hits["inputTokens"] += 1
            self.last_tokens = tokens
            if self.context_window and tokens > self.context_window:
                self.hits["over_window"] += 1  # окно в параметрах меньше настоящего — видно в сверке событий
            if self.peak is None or tokens > self.peak[1]:
                self.peak = (share_of(tokens, self.context_window), tokens, turn)
        text = one_line(text_of(event, "assistantLastMessage"))
        if not text:
            return
        self.event(turn, f"АГЕНТ: {clip_agent(mask(text))}")
        self.last_error = False
        self.unanswered = None
        self.agent_replied = self.agent_replied or self.first_user_turn is not None
        if self.run:
            self.run["replied"] = True
        self.agent_chars += len(text)
        if self.agent_first_ts is None:
            self.agent_first_ts = stamp
        last = re.split(r"(?<=[.!?])\s+", text)[-1]
        if "?" in last:
            last = mask(last)
            self.question = {"turn": turn, "text": last if len(last) <= 200 else "…" + last[-199:]}
        else:
            self.question = None

    def ask(self, event, turn, stamp):
        if self.run:
            self.run["replied"] = True  # ход с вопросом агента ASSISTANT_ANSWER не пишет — вопрос и есть ответ агента
        self.unanswered = None
        self.agent_replied = self.agent_replied or self.first_user_turn is not None
        payload = event.get("askUserQuestion")
        if isinstance(payload, str):  # по типизации — строка с JSON; готовый объект тоже принимаем
            try:
                payload = json.loads(payload)
            except ValueError:
                payload = None
        questions = payload.get("questions") if isinstance(payload, dict) else None
        if not isinstance(questions, list):
            self.event(turn, "ВОПРОС: — (не разобран)")
            return
        chars, answer_chars, answered = 0, 0, False
        lines = []
        for item in (question for question in questions if isinstance(question, dict)):
            header = one_line(str(item.get("header", "")))
            body = one_line(str(item.get("question", "")))
            labels = [one_line(str(option.get("label", ""))) for option in (item.get("options") or [])
                      if isinstance(option, dict)]
            selected = [str(value) for value in (item.get("selected") or []) if isinstance(value, str)]
            raw = one_line(str(item.get("rawAnswer") or ""))
            verdict = classify(raw, selected, labels, bool(item.get("multiSelect")))
            self.verdicts[verdict] += 1
            self.answers_total += 1
            shown = raw or ", ".join(selected)
            answered = answered or verdict != "нет ответа"
            chars += len(body) + sum(len(label) for label in labels)
            answer_chars += len(shown)
            lines.append(f"ВОПРОС: {header}: {mask(body)} | варианты: {' / '.join(labels) or '—'}")
            lines.append(f"ОТВЕТ: {header}: {clip(mask(shown), 200) if shown else '—'} ({verdict})")
        for line in lines:
            self.event(turn, line)
        if not answered:
            self.forget_unread()  # ответа нет — не место решения
            return
        # Ответ на вопрос — реплика пользователя: в петле скиллов человек работает именно так.
        self.user_turns += 1
        self.last_error = False
        self.unanswered = turn
        if self.first_user_turn is None:
            self.first_user_turn = turn
        if self.run:
            self.run["user_turns"] += 1
        # Время показа вопроса не выгружается (событие приходит с ответом): читать начали не раньше прошлого события.
        # Время чтения так завышено, скорость занижена — «не читая» ставится, только если быстрее чтения наверняка.
        self.agent_chars += chars
        if self.agent_first_ts is None:
            self.agent_first_ts = self.prev_stamp
        option = all(line.endswith("(вариант)") or line.endswith("(нет ответа)") for line in lines if line.startswith("ОТВЕТ:"))
        self.responded(turn, stamp, answer_chars, "question", asked=True, option=option)

    def skill(self, event, turn):
        name = one_line(text_of(event, "skillName")) or "?"
        command, self.command = self.command, None
        if command and self.run and self.run["via"] == "user" and command.split(":")[-1] == name.split(":")[-1]:
            return  # этот запуск уже открыл слэш-вызов
        self.unanswered = None  # вызов скилла агентом — ответ на реплику пользователя
        self.start_run(name, turn, "agent")
        self.event(turn, f"СКИЛЛ: {name}")

    def failure(self, event, turn):
        self.api_errors += 1
        self.after_error = True
        self.last_error = True
        self.event(turn, f"ОШИБКА API: {clip(mask(text_of(event, 'errorReason') or 'без причины'), 200)}")

    def feed(self, turn, event):
        name = event["eventName"]
        stamp = parse_ts(event.get("createdAt"))
        if isinstance(event.get("login"), str) and event["login"]:
            self.logins.add(event["login"])
        # Выгрузка иногда пишет одно событие дважды: другой id, то же содержимое, то же время. Дубль — не второй ответ
        # пользователя (иначе «ответ через 0 с» и автоввод), пропускается и считается в сверке.
        content = json.dumps({key: value for key, value in event.items() if key not in ("id", "createdAt")},
                             ensure_ascii=False, sort_keys=True, default=str)
        last = self.last_content
        self.last_content = (content, stamp)
        if last and last[0] == content and stamp and last[1] and abs((stamp - last[1]).total_seconds()) <= DUPLICATE_SECONDS:
            self.hits["duplicate"] += 1
            return
        if name not in EVENT_NAMES:
            self.hits["unknown"] += 1
            self.unknown.add(clip(name, 40))
            self.prev_stamp = stamp
            return
        self.hits[name] += 1
        if name not in ("USER_PROMPT", "SKILL_USE"):
            self.command = None
        if name == "START_SESSION":
            self.start(event, turn)
        elif name == "USER_PROMPT":
            self.prompt(event, turn, stamp)
        elif name == "ASSISTANT_ANSWER":
            self.answer(event, turn, stamp)
        elif name == "ASK_USER_QUESTION":
            self.ask(event, turn, stamp)
        elif name == "SKILL_USE":
            self.skill(event, turn)
        else:
            self.failure(event, turn)
        self.prev_stamp = stamp


def candidate_checks(session, runs):
    """Кандидаты скрипта, по которым модель выносит вердикт: один на (вид, ход). runs — запуски для «доведения до
    результата»: запуски скиллов или вся сессия без скиллов."""
    checks = []
    for item in session.decisions:
        if item["kind"] == "question":
            detail = "ответ на вопрос агента с вариантами"
        elif item["asked"]:
            detail = "ответ на вопрос агента текстом"
        else:
            detail = f"ответ на длинный текст агента, {item['agent_chars']} симв."
        checks.append({"check": "decision", "turn": item["turn"], "detail": detail})
    for run in runs:
        if run["error_end"]:
            continue
        where = f"запуск {run['skill']} кончился" if run["skill"] else "сессия без скиллов кончилась"
        if run["question"]:
            checks.append({"check": "ending", "turn": run["question"]["turn"],
                           "detail": f"{where} вопросом агента без ответа"})
        elif run["replied"] and run["unanswered"] is not None:
            checks.append({"check": "ending", "turn": run["unanswered"],
                           "detail": f"{where} репликой пользователя без ответа агента"})
    unique = {(item["check"], item["turn"]): item for item in checks}
    return sorted(unique.values(), key=lambda item: (item["turn"], item["check"]))


def collect_session(path, session_id, out_dir, context_window):
    events, bad, reason = read_export(path)
    if events is None:
        return None, reason
    session = Session(session_id, context_window)
    for turn, event in events:
        session.feed(turn, event)
    session.close_run("session_end")
    session.flush_streak()
    whole = None  # оцениваемая сессия без скиллов — для «доведения до результата» она сама один запуск
    if not session.runs and session.first_user_turn is not None and session.user_turns >= MIN_USER_TURNS:
        whole = {"skill": None, "turn": session.first_user_turn, "replied": session.agent_replied,
                 "ended_by": "session_end", "question": dict(session.question) if session.question else None,
                 "unanswered": session.unanswered, "error_end": session.last_error}
    for run in session.runs:
        if context_window:  # до первого запроса к модели контекст пуст
            run["context_share_before"] = share_of(run["context_tokens_before"] or 0, context_window)

    # Время в выходе — с точностью до секунды; длительность считается от тех же значений, иначе не сходится.
    stamps = [parse_ts(event["createdAt"]) for _turn, event in events]
    start, end = min(stamps).replace(microsecond=0), max(stamps).replace(microsecond=0)
    head = (f"# Сессия {session_id} · начало {iso(start)} · длительность {round((end - start).total_seconds())} с"
            f" · событий {len(events)} · реплик пользователя {session.user_turns}")
    checks = candidate_checks(session, session.runs or ([whole] if whole else []))
    check_lines = [f"- {item['check']} [{item['turn']}]: {item['detail']}" for item in checks] or ["- нет"]
    journal = "\n".join([head] + [f"[{turn}] {text}" for turn, text in session.events]
                        + ["", CHECKS_HEADER] + check_lines) + "\n"
    journal_name = f"{session_id}.journal.txt"
    with open(os.path.join(out_dir, journal_name), "w", encoding="utf-8") as handle:
        handle.write(journal)

    scored = session.user_turns >= MIN_USER_TURNS
    share, tokens, peak_turn = session.peak if session.peak else (None, None, None)
    facts = {
        "session": session_id,
        "file": os.path.basename(path),
        "start": iso(start),
        "end": iso(end),
        "duration_sec": round((end - start).total_seconds()),
        "events": len(events),
        "bad_events": bad,
        "logins": sorted(session.logins),
        "user_turns": session.user_turns,
        "skills": session.skills,
        "scored": scored,
        "skip_reason": None if scored else f"меньше {MIN_USER_TURNS} реплик пользователя",
        "context": {"peak_share": share, "peak_tokens": tokens, "turn": peak_turn},
        "runs": session.runs,
        "session_run": whole,
        "answers": {"total": session.answers_total, "verdicts": session.verdicts},
        "decisions": session.decisions,
        "hidden_turns": session.hidden,
        "fast": session.fast,
        "repeat_streaks": session.streaks,
        "checks": checks,
        "environment": {"tool_errors": None, "api_errors": session.api_errors},  # ошибок инструментов в выгрузке нет
        "compressions": session.compressions,
        "journal": {"file": journal_name, "chars": len(journal), "oversize": len(journal) > JOURNAL_LIMIT},
        "hits": session.hits,
        "unknown_events": sorted(session.unknown),
    }
    with open(os.path.join(out_dir, f"{session_id}.facts.json"), "w", encoding="utf-8") as handle:
        json.dump(facts, handle, ensure_ascii=False, indent=2)
    return facts, None


# ---------------------------------------------------------------- main


def main(argv=None):
    parser = argparse.ArgumentParser(description="Выгрузки сессий → сжатые журналы и факты для merge.")
    parser.add_argument("--sessions", required=True, help="выгрузка одной сессии (<id>.json) или папка с выгрузками (*.json)")
    parser.add_argument("--out", default=None, help="рабочая папка; по умолчанию — .quality-work рядом с сессиями")
    parser.add_argument("--user", default=None, help="имя пользователя (по умолчанию — login из выгрузки или имя папки)")
    parser.add_argument("--context-window", type=int, default=None, help="окно модели в токенах вместо context_window")
    parser.add_argument("--params", default=None, help="файл параметров (по умолчанию reference/params.json)")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        configure(params.load(cfg.params))
    except params.ParamsError as error:
        print(f"Параметры не годятся: {error}", file=sys.stderr)
        return 2

    source = os.path.abspath(cfg.sessions)
    if os.path.isfile(source):
        if not source.endswith(".json") or source.endswith(OUTPUT_SUFFIXES):
            print(f"Не выгрузка сессии: {cfg.sessions}", file=sys.stderr)
            return 2
        folder, names = os.path.dirname(source), [os.path.basename(source)]
    elif os.path.isdir(source):
        folder, names = source, sorted(os.listdir(source))
    else:
        print(f"Нет такой сессии или папки: {cfg.sessions}", file=sys.stderr)
        return 2
    cfg.out = cfg.out or os.path.join(folder, WORK_DIR)
    os.makedirs(cfg.out, exist_ok=True)
    stale = clean_work(cfg.out)
    window = cfg.context_window or CONTEXT_WINDOW

    sessions, skipped = [], []
    totals = {}
    for name in names:
        path = os.path.join(folder, name)
        if not os.path.isfile(path) or name.endswith(OUTPUT_SUFFIXES):  # итоги прошлого запуска — не сессии
            continue
        if not name.endswith(".json"):
            skipped.append({"file": name, "reason": "не выгрузка сессии"})
            continue
        facts, reason = collect_session(path, name[: -len(".json")], cfg.out, window)
        if facts is None:
            skipped.append({"file": name, "reason": reason})
            continue
        sessions.append(facts)
        for key, value in facts["hits"].items():
            totals[key] = totals.get(key, 0) + value

    sessions.sort(key=lambda facts: (facts["start"], facts["session"]))

    def user_of(facts):  # пользователь — у каждой сессии свой: логин из выгрузки, иначе --user, иначе имя папки
        return cfg.user or (facts["logins"][0] if len(facts["logins"]) == 1 else os.path.basename(folder))

    summary = {
        "sessions_dir": cfg.sessions,
        "generated_at": iso(datetime.now(timezone.utc)),
        "params": {"file": cfg.params or params.DEFAULT_PATH, "min_user_turns": MIN_USER_TURNS,
                   "decision_min_chars": DECISION_MIN, "reading_speed": READING_SPEED, "human_speed": HUMAN_SPEED,
                   "journal_limit": JOURNAL_LIMIT, "context_window": window},
        "sessions": [{"session": facts["session"], "user": user_of(facts), "scored": facts["scored"],
                      "facts": f"{facts['session']}.facts.json", "journal": facts["journal"]["file"],
                      "output": os.path.join(folder, facts["session"] + ".quality")} for facts in sessions],
        "skipped_files": skipped,
        "hits": totals,
    }
    with open(os.path.join(cfg.out, "collect.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)

    scored = sum(1 for facts in sessions if facts["scored"])
    print(f"Сессий: {len(sessions)} (оценивается: {scored}, коротких: {len(sessions) - scored})")
    print(f"Пропущено файлов: {len(skipped)}")
    if stale:
        print(f"Убрано файлов прошлого запуска: {stale}")
    print(f"Сжатых журналов длиннее {JOURNAL_LIMIT} симв.: {sum(1 for f in sessions if f['journal']['oversize'])}")
    print(f"Работа: {cfg.out}")
    events = sum(facts["events"] for facts in sessions)
    bad = sum(facts["bad_events"] for facts in sessions)
    print(f"Сверка событий (годных: {events}, битых: {bad}):")
    unknown = sorted({name for facts in sessions for name in facts["unknown_events"]})
    for key in EVENT_NAMES + ("inputTokens", "over_window", "compact", "duplicate", "unknown"):
        count = totals.get(key, 0)
        label = {"inputTokens": "inputTokens у ответов", "compact": "сжатий (compact)", "unknown": "неизвестных событий",
                 "over_window": "токенов больше окна", "duplicate": "дублей событий (пропущено)"}.get(key, key)
        if key == "over_window" and count:
            print(f"  {label:24} {count} — проверьте context_window в params.json")
            continue
        if key == "unknown" and count:
            print(f"  {label:24} {count}: {', '.join(unknown)}")
            continue
        print(f"  {label:24} {count if count else 'не найдено'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
