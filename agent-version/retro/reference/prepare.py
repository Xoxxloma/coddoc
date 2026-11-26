#!/usr/bin/env python3
"""prepare — первый шаг ретро: находит последние сессии проекта и пишет по каждой сжатый журнал для субагента.

    python3 prepare.py [--sessions <папка>] [--project <папка проекта>] [--out <рабочая папка>] [--params <файл>]
    python3 prepare.py --clean [--project <папка проекта>] [--out <рабочая папка>]   # в конце ретро: убрать журналы и ответы

Сессии — журналы чата GigaCode: по умолчанию <дом>/.gigacode/projects/*/chats/*.jsonl; берутся те, у которых cwd в
записях — папка проекта (по умолчанию текущая). Пропускаются сессии с вызовом ретро (в том числе текущая) и короткие;
из остальных — последние limit по времени начала. В --out (по умолчанию <корень репозитория проекта>/.coddoc-tmp/retro,
вне репозитория — <папка проекта>/.coddoc-tmp/retro) пишет:
  <id>.journal.txt — сжатый журнал сессии, [N] — номер строки в журнале чата; длинный журнал ещё и частями
                     <id>.partK.journal.txt — каждая часть уходит своему субагенту;
  retro.json       — разобранные сессии с фактами скрипта, задания субагентам, пропущенное, сверка полей.
В журнале секреты замаскированы, содержимое файлов и выводы инструментов не попадают. На экран — только счёт и путь.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

import journal
from textutil import clip, clip_middle, mask, one_line

HERE = Path(__file__).resolve().parent
PARAMS_PATH = HERE / "params.json"
REQUIRED = ("limit", "min_user_turns", "loaded_context_share", "reading_speed", "decision_min_chars", "insert_limit",
            "insert_preview", "agent_head", "agent_tail", "paths_per_tool", "journal_limit", "part_overlap", "weak_models",
            "skill_share_min")
MANIFEST = "retro.json"
WORK_SUFFIXES = (".journal.txt", ".findings.txt")
WORK_NAMES = (MANIFEST, "moments.json", "moments.md", "merge-log.txt")
CLEAR = "/clear"
SKIP_TOOLS = ("skill", "ask_user_question")  # у них своя строка журнала


class ParamsError(Exception):
    pass


def load_params(path=None):
    try:
        with open(path or PARAMS_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as error:
        raise ParamsError(f"не читается: {error}")
    values = {key: item["value"] for key, item in data.items() if isinstance(item, dict) and "value" in item}
    missing = [key for key in REQUIRED if key not in values]
    if missing:
        raise ParamsError("нет значений: " + ", ".join(missing))
    return values


# ---------------------------------------------------------------- выбор сессий


def chat_files(sessions):
    """Журналы основных чатов: служебные *.runtime.jsonl и журналы субагентов — не сессии."""
    root = Path(sessions).expanduser() if sessions else Path.home() / ".gigacode" / "projects"
    if root.is_file():
        return [root]
    if not root.is_dir():
        return []
    return sorted(path for path in root.rglob("*.jsonl") if path.is_file() and journal.where_of(path) == "chats")


def norm_place(value):
    path = os.path.expanduser(str(value))
    if os.path.exists(path):
        path = os.path.realpath(path)
    return os.path.normcase(os.path.normpath(path))


def user_turns(events):
    """Реплики пользователя: набранный текст, слэш-команды и ответы на вопросы с вариантами."""
    count = 0
    for event in events:
        if event["kind"] in ("user", "slash"):
            count += 1
        elif event["kind"] == "result" and "answers" in event and not event["answers"]["declined"] \
                and any(item["raw"] for item in event["answers"]["items"]):
            count += 1
    return count


def is_retro(events):
    def retro(name):
        return name.lstrip("/").split(":")[-1] == "retro"

    return any((event["kind"] == "slash" and retro(event["command"]))
               or (event["kind"] == "call" and event["name"] == "skill" and retro(event.get("skill", "")))
               for event in events)


def select(files, project, p):
    """→ (выбранные сессии по времени начала, счёт пропущенного)."""
    place = norm_place(project)
    skipped, candidates = Counter(), []
    for path in files:
        try:
            chat = journal.parse_chat(path)
        except (OSError, UnicodeDecodeError):
            skipped["не прочитан"] += 1
            continue
        if not chat["cwd"] or norm_place(chat["cwd"]) != place:
            skipped["другой проект"] += 1
            continue
        if is_retro(chat["events"]):
            skipped["ретро"] += 1
            continue
        if user_turns(chat["events"]) < p["min_user_turns"]:
            skipped["короткая"] += 1
            continue
        if not chat["start"]:
            skipped["без времени"] += 1
            continue
        candidates.append(chat)
    candidates.sort(key=lambda chat: chat["start"])
    chosen = candidates[-p["limit"]:]
    if len(candidates) > len(chosen):
        skipped["старше последних"] += len(candidates) - len(chosen)
    return chosen, skipped


# ---------------------------------------------------------------- журнал


def short_path(path, cwd):
    """Путь для журнала: внутри проекта — от его корня. Только для показа, поэтому сравнение строк без учёта регистра."""
    text = str(path).replace("\\", "/")
    base = str(cwd or "").replace("\\", "/").rstrip("/")
    if base and text.casefold().startswith(base.casefold() + "/"):
        text = text[len(base) + 1:]
    return clip(mask(text), 80)


def answer_kind(item):
    if item["selected"] and item["own"]:
        return "вариант + свой текст"
    if item["selected"]:
        return "вариант"
    return "свой текст" if item["own"] else "нет ответа"


def render(chat, p):
    """Сжатый журнал сессии и факты скрипта: (строки журнала, факты)."""
    threshold, reading = p["loaded_context_share"], p["reading_speed"]
    weak = set(p["weak_models"])
    events, cwd = chat["events"], chat["cwd"]
    lines, tools = [], []
    facts = {"models": Counter(), "skills": [], "commands": [], "loaded": [], "compressions": [], "suspected": [],
             "fast": [], "pastes": [], "api_errors": 0, "tool_errors": 0, "clears": [], "after_compression": [],
             "loaded_work": [], "skill_replies": {"inside": 0, "total": 0, "outside_first": None}}
    # degraded — после сжатия (записанного или похожего) до /clear; in_skill — идёт запуск скилла (до /clear). Где
    # начинается новая стадия — по смыслу (кто её начал), это решает модель; скрипт отмечает загрузку на каждом вызове.
    state = {"share": None, "tokens": None, "window": None, "model": None, "unread": 0, "first": None,
             "asked": {}, "compressed": False, "degraded": False, "in_skill": False}

    def enter(n):
        """Вызов скилла или команда при окне выше порога или после сжатия — улика для «нового этапа на загруженном окне»."""
        if state["share"] is not None and state["share"] > threshold:
            facts["loaded"].append(n)
        if state["degraded"]:
            facts["after_compression"].append(n)

    def counted(n):
        """Реплика в счёт доли работы через скиллы: внутри запуска скилла или вне его."""
        share = facts["skill_replies"]
        share["total"] += 1
        if state["in_skill"]:
            share["inside"] += 1
        elif share["outside_first"] is None:
            share["outside_first"] = n

    def reply(n):
        """Реплика пользователя: в счёт доли скиллов; на загруженном окне — если окно выше порога или после сжатия."""
        counted(n)
        share = state["share"]
        if state["degraded"] or (share is not None and share > threshold):
            facts["loaded_work"].append({"n": n, "share": share, "after_compression": state["degraded"]})

    def line(n, text):
        flush_tools()  # вызовы инструментов до этой строки — одной строкой перед ней
        lines.append(f"[{n}] {text}")

    def load_note():
        share = state["share"]
        if share is None:
            return ""
        return f" (контекст {round(share * 100)} % окна" + (" — выше порога" if share > threshold else "") + ")"

    def flush_tools():
        if not tools:
            return
        names, paths, errors = Counter(), {}, 0
        for event in tools:
            if event["kind"] == "call":
                names[event["name"]] += 1
                if event.get("path"):
                    paths.setdefault(event["name"], [])
                    shown = short_path(event["path"], cwd)
                    if shown not in paths[event["name"]] and len(paths[event["name"]]) < p["paths_per_tool"]:
                        paths[event["name"]].append(shown)
            elif event.get("error"):
                errors += 1
        parts = [f"{name} ×{count}" + (f" ({', '.join(paths[name])})" if paths.get(name) else "")
                 for name, count in names.items()]
        first = tools[0]["n"]
        tools.clear()
        if parts:
            lines.append(f"[{first}] ИНСТРУМЕНТЫ: " + "; ".join(parts) + (f"; ошибок: {errors}" if errors else ""))
        facts["tool_errors"] += errors

    def speed_note(n, stamp, extra_chars=0, start=None):
        """Ответ быстрее чтения: символы последнего сообщения агента (и вопроса) ÷ секунды с его появления. Промежуточные
        сообщения о ходе работы до ответа читать не обязательно — в счёт не идут."""
        chars = state["unread"] + extra_chars
        first = start or state["first"]
        moment = journal.parse_ts(stamp)
        if not first or not moment or chars < p["decision_min_chars"]:
            return ""
        seconds = max((moment - first).total_seconds(), 0.5)
        if chars / seconds <= reading:
            return ""
        facts["fast"].append({"n": n, "seconds": round(seconds, 1), "chars": chars})
        return f" (ответ через {round(seconds, 1):g} с на {chars} симв. текста агента — быстрее чтения)"

    def read_all():
        state["unread"], state["first"] = 0, None

    for event in events:
        kind, n = event["kind"], event["n"]
        if kind in ("call", "result") and event.get("name") not in SKIP_TOOLS:
            tools.append(event)
            continue
        if kind == "agent":
            model = event.get("model")
            if model:
                facts["models"][model] += 1
                if model != state["model"]:
                    if state["model"] is not None or model in weak:
                        line(n, f"МОДЕЛЬ: {model}" + (" — слабая" if model in weak else ""))
                    state["model"] = model
            tokens, window = event.get("tokens"), event.get("window")
            if tokens is not None:
                previous = state["tokens"]
                if window:
                    state["window"] = window
                if previous and state["window"] and previous >= 0.5 * state["window"] and tokens < 0.5 * previous \
                        and not state["compressed"]:
                    facts["suspected"].append(n)
                    state["degraded"] = True
                    line(n, f"ПОХОЖЕ НА СЖАТИЕ: контекст упал с {round(previous / state['window'] * 100)} % до "
                            f"{round(tokens / state['window'] * 100)} % окна")
                state["tokens"], state["compressed"] = tokens, False
                state["share"] = round(tokens / state["window"], 3) if state["window"] else None
            if event["text"].strip():
                line(n, "АГЕНТ: " + mask(clip_middle(event["text"], p["agent_head"], p["agent_tail"])))
                state["unread"], state["first"] = len(one_line(event["text"])), journal.parse_ts(event["ts"])
        elif kind == "call" and event["name"] == "skill":
            facts["skills"].append({"n": n, "skill": event.get("skill"), "via": "agent", "share": state["share"]})
            state["in_skill"] = True
            enter(n)
            line(n, f"СКИЛЛ: {event.get('skill')} (вызов агентом)" + load_note())
        elif kind == "call":  # вопрос с вариантами
            state["asked"][event["id"]] = (journal.parse_ts(event["ts"]), event.get("questions") or [])
            for question in event.get("questions") or []:
                line(n, f"ВОПРОС: {question['header']}: {mask(clip(question['question'], 300))} | варианты: "
                        f"{' / '.join(mask(clip(label, 80)) for label in question['options']) or '—'}")
        elif kind == "result":
            if event.get("name") != "ask_user_question" or "answers" not in event:
                continue
            shown, questions = state["asked"].pop(event["id"], (None, []))
            if event["answers"]["declined"]:
                line(n, "ОТВЕТ: отказ отвечать")
                read_all()
                continue
            asked_chars = sum(len(q["question"]) + sum(len(label) for label in q["options"]) for q in questions)
            note = speed_note(n, event["ts"], asked_chars, state["first"] or shown)
            for item in event["answers"]["items"]:
                line(n, f"ОТВЕТ: {item['header']}: {mask(clip(item['raw'], 300)) or '—'} ({answer_kind(item)})" + note)
                note = ""
            if any(item["raw"] for item in event["answers"]["items"]):
                reply(n)
            read_all()
        elif kind == "user":
            text = mask(event["text"])
            if len(text) > p["insert_limit"]:
                shown = f"{clip(text, p['insert_preview'])} …(вставка, {len(text)} симв.)"
                facts["pastes"].append({"n": n, "chars": len(text), "attached": event["attached"]})
            else:
                shown = one_line(text)  # приложенный файл — не вставка: так материалы и передают
            if event["attached"]:
                shown = (shown + " " if shown else "") + "[+ приложены файлы]"
            line(n, "ПОЛЬЗОВАТЕЛЬ: " + shown + speed_note(n, event["ts"]))
            reply(n)
            read_all()
        elif kind == "slash":
            command = event["command"]
            note = "" if command == CLEAR else load_note()
            if command != CLEAR:
                facts["commands"].append({"n": n, "command": command, "share": state["share"]})
                enter(n)
            if event.get("skill"):  # слэш-вызов скилла — первая реплика его запуска; встроенные команды не в счёт
                state["in_skill"] = True
                counted(n)
            line(n, f"КОМАНДА: {command} {mask(clip(event['args'], 200))}".rstrip() + note)
            if command == CLEAR:  # контекст очищен: прежняя загрузка окна, сжатие и запуск скилла позади
                facts["clears"].append(n)
                state["share"] = state["tokens"] = None
                state["degraded"], state["in_skill"] = False, False
            read_all()
        elif kind == "compression":
            facts["compressions"].append(n)
            state["compressed"] = state["degraded"] = True
            line(n, "СЖАТИЕ КОНТЕКСТА")
        elif kind == "api_error":
            facts["api_errors"] += 1
            line(n, f"ОШИБКА API: {clip(event['subtype'], 60)}")
    flush_tools()
    facts["models"] = dict(facts["models"])
    facts["weak"] = {model: count for model, count in facts["models"].items() if model in weak}
    return lines, facts


def header_of(chat, facts, turns):
    minutes = None
    start, end = journal.parse_ts(chat["start"]), journal.parse_ts(chat["end"])
    if start and end:
        minutes = round((end - start).total_seconds() / 60)
    models = ", ".join(facts["models"]) or "—"
    return (f"# Сессия {chat['session']} · начало {chat['start'][:16].replace('T', ' ')} · длительность {minutes} мин"
            f" · реплик пользователя {turns} · модели: {models}"), minutes


def split_parts(head, lines, limit, overlap):
    """Части журнала по границам строк; в начале части — последние строки прошлой, чтобы не терять связь."""
    parts, current, size = [], [], 0
    for text in lines:
        if current and size + len(text) + 1 > limit:
            parts.append(current)
            current = current[-overlap:] if overlap else []
            size = sum(len(item) + 1 for item in current)
        current.append(text)
        size += len(text) + 1
    if current:
        parts.append(current)
    total = len(parts)
    return ["\n".join([f"{head} · часть {index} из {total}"] + part) + "\n" for index, part in enumerate(parts, 1)]


# ---------------------------------------------------------------- main


def clean_work(folder):
    removed = 0
    for path in Path(folder).iterdir() if Path(folder).is_dir() else []:
        if path.is_file() and (path.name.endswith(WORK_SUFFIXES) or path.name in WORK_NAMES):
            path.unlink()
            removed += 1
    return removed


def work_dir(project):
    """Рабочая папка по умолчанию: временные файлы скиллов — в .coddoc-tmp/ корня репозитория, у скилла своя подпапка.

    Вне репозитория или без git — от папки проекта. Путь полный: короткое имя Windows (IVANOV~1) агенты считают
    подозрительным и не пишут туда."""
    top = project
    try:
        done = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=project, capture_output=True,
                              text=True, encoding="utf-8")
        if done.returncode == 0 and done.stdout.strip():
            top = done.stdout.strip()
    except OSError:
        pass
    return Path(os.path.realpath(top)) / ".coddoc-tmp" / "retro"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Сессии проекта → сжатые журналы для ретро.")
    parser.add_argument("--sessions", default=None, help="папка или файл журналов (по умолчанию <дом>/.gigacode/projects)")
    parser.add_argument("--project", default=None, help="папка проекта (по умолчанию текущая)")
    parser.add_argument("--out", default=None, help="рабочая папка (по умолчанию <корень репозитория>/.coddoc-tmp/retro)")
    parser.add_argument("--params", default=None, help="файл параметров (по умолчанию reference/params.json)")
    parser.add_argument("--clean", action="store_true", help="убрать свои файлы из рабочей папки и её саму, если пуста")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    project = cfg.project or os.getcwd()
    out = Path(cfg.out) if cfg.out else work_dir(project)
    if cfg.clean:
        removed = clean_work(out)
        try:
            out.rmdir()
        except OSError:
            pass  # в папке чужие файлы или её нет — не трогаем
        print(f"Убрано файлов: {removed}; рабочая папка {'осталась' if out.exists() else 'убрана'}: {out}")
        return 0
    try:
        p = load_params(cfg.params)
    except ParamsError as error:
        print(f"Параметры не годятся: {error}")
        return 2

    files = chat_files(cfg.sessions)
    root = cfg.sessions or str(Path.home() / ".gigacode" / "projects")
    if not files:
        print(f"Журналов не найдено: {root}. Укажите папку с журналами: --sessions <папка>")
        return 1
    chosen, skipped = select(files, project, p)
    if not chosen:
        print(f"Журналов: {len(files)}, сессий этого проекта для разбора нет ("
              + (", ".join(f"{name}: {count}" for name, count in skipped.items()) or "—")
              + "). Запустите из папки проекта или укажите --project <папка>.")
        return 1

    out.mkdir(parents=True, exist_ok=True)
    ignore = out.parent / ".gitignore"
    if not cfg.out and not ignore.exists():
        ignore.write_text("*\n", encoding="utf-8")
    clean_work(out)
    sessions, tasks = [], []
    for chat in chosen:
        lines, facts = render(chat, p)
        turns = user_turns(chat["events"])
        head, minutes = header_of(chat, facts, turns)
        whole = "\n".join([head] + lines) + "\n"
        name = f"{chat['session']}.journal.txt"
        (out / name).write_text(whole, encoding="utf-8")
        parts = split_parts(head, lines, p["journal_limit"], p["part_overlap"]) if len(whole) > p["journal_limit"] else []
        part_names = []
        for index, text in enumerate(parts, 1):
            part_name = f"{chat['session']}.part{index}.journal.txt"
            (out / part_name).write_text(text, encoding="utf-8")
            part_names.append(part_name)
        for task in part_names or [name]:
            tasks.append({"session": chat["session"], "journal": task})
        sessions.append({"session": chat["session"], "file": chat["file"], "journal": name, "parts": part_names,
                         "start": chat["start"], "end": chat["end"], "minutes": minutes, "user_turns": turns,
                         "chars": len(whole), **facts})

    inv = journal.inventory([Path(chat["file"]) for chat in chosen])
    missing = [name for name, found in journal.EXPECTED if not found(inv)]
    manifest = {"project": project, "sessions_dir": root, "files": len(files), "skipped": dict(skipped),
                "few": len(chosen) < 3, "missing_fields": missing,
                "params": {key: p[key] for key in ("limit", "loaded_context_share", "reading_speed", "weak_models",
                                                    "skill_share_min")},
                "sessions": sessions, "tasks": tasks}
    (out / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Журналов: {len(files)}; разбираю сессий: {len(chosen)}"
          + (" — мало, повторяющихся привычек может не выйти" if manifest["few"] else "")
          + "; пропущено: " + (", ".join(f"{name} {count}" for name, count in skipped.items()) or "—"))
    print(f"Заданий субагентам: {len(tasks)}")
    if missing:
        print("В журналах не нашлось: " + "; ".join(missing))
    print(f"Рабочая папка: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
