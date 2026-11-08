#!/usr/bin/env python3
"""Самопроверка retro/reference/prepare.py: выбор сессий проекта, сжатый журнал, факты скрипта, части журнала.

    python3 selftest-retro-prepare.py

Журналы чата — синтетика стенда session-quality (sessionlib.Builder, формат qwen-code). Сессии проекта /work/ai-sdd:
A (всё, что журнал должен показать), B и C (обычные), E (вызов ретро — пропускается), F (одна реплика — короткая);
D — другой проект. Номера в комментариях — номера строк журнала чата.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "retro", "reference"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "manager-version", "_skill-eval"))
import prepare  # noqa: E402
from sessionlib import Builder, ask, call, option  # noqa: E402

PROJECT = "/work/ai-sdd"
LONG = "Гипотезы по полям. " * 90  # 1710 симв.


def write_chat(root, name, lines, cwd=PROJECT):
    path = os.path.join(root, "projects", name.split("-")[0], "chats", f"{name}.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = []
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            out.append(line)
            continue
        out.append(json.dumps(dict(record, cwd=cwd), ensure_ascii=False))
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(out) + "\n")


def set_model(builder, model):
    record = json.loads(builder.lines[-1])
    builder.lines[-1] = json.dumps(dict(record, model=model), ensure_ascii=False)


def build_a():
    b = Builder("sa", "2026-10-20T09:00:00")
    b.user(0, "Делаем БТ по задаче PAY-1, токен: ghp_abcdefghijklmnopqrstuvwxyz1234")                 # 1
    b.slash_skill(5, "analyst-workspace", "PAY-1")                                                     # 2, 3
    b.agent(20, text=LONG, tokens=60000,
            calls=[ask("q1", [{"header": "Вход", "question": "Что на руках?", "options": option("Бизнес", "Аналитика")}])])  # 4
    b.result(22, "ask_user_question", "q1", output="User has provided the following answers:\n\n**Вход**: Бизнес")  # 5
    b.agent(40, calls=[call("skill", {"skill": "business-requirements-doc"}, "s1")], tokens=180000)   # 6
    b.result(41, "skill", "s1", output="loaded")                                                      # 7
    b.agent(50, calls=[call("read_file", {"absolute_path": "/work/ai-sdd/services/payments.md"}, "r1"),
                       call("read_file", {"absolute_path": "/work/ai-sdd/services/payments.md"}, "r2"),
                       call("grep_search", {"pattern": "role"}, "g1")], tokens=181000)                 # 8
    b.result(51, "read_file", "r1", output="карточка")                                                # 9
    b.result(51, "read_file", "r2", output="карточка")                                                # 10
    b.result(52, "grep_search", "g1", output="—")                                                     # 11
    b.agent(60, calls=[call("write_file", {"file_path": "/work/ai-sdd/coddoc/PAY-1/br.md", "content": "черновик"}, "w1")],
            tokens=182000)                                                                             # 12
    b.result(61, "write_file", "w1", error="EACCES")                                                  # 13
    b.compression(70)                                                                                  # 14
    b.agent(80, text="Продолжаю после сжатия.", tokens=40000)                                         # 15
    b.agent(90, text="Собрал раздел.", tokens=200000)                                                  # 16
    b.agent(100, text="Короткий ответ.", tokens=30000)                                                 # 17 падение без записи о сжатии
    b.user(200, "Вот выгрузка: " + "д" * 4000)                                                        # 18
    b.agent(210, text="Принял выгрузку, разбираю.", tokens=50000)                                      # 19
    set_model(b, "qwen-3.6b")
    b.slash(220, "/clear")                                                                             # 20
    b.user(230, "Спасибо")                                                                             # 21
    return b.lines


def build_plain(session_id, base, replies=3, extra=()):
    b = Builder(session_id, base)
    for index in range(replies):
        b.user(index * 60, f"Реплика {index + 1} в {session_id}")
        b.agent(index * 60 + 30, text="Ответ агента.", tokens=10000 + index)
    for item in extra:
        item(b)
    return b.lines


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    root = tempfile.mkdtemp(prefix="retro-prepare-")
    write_chat(root, "proj-a", build_a())
    write_chat(root, "proj-b", build_plain("sb", "2026-10-21T09:00:00"))
    write_chat(root, "proj-c", build_plain("sc", "2026-10-22T09:00:00"))
    write_chat(root, "other-d", build_plain("sd", "2026-10-23T09:00:00"), cwd="/work/other")
    write_chat(root, "proj-e", build_plain("se", "2026-10-24T09:00:00", extra=[lambda b: b.slash(500, "/retro")]))
    write_chat(root, "proj-f", build_plain("sf", "2026-10-25T09:00:00", replies=1))
    sessions = os.path.join(root, "projects")
    out = os.path.join(root, "work")
    os.makedirs(out)
    for name in ("old.journal.txt", "keep.txt"):
        with open(os.path.join(out, name), "w", encoding="utf-8") as handle:
            handle.write("прошлый запуск")

    failures, checks = [], 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    def run(*args):
        screen = io.StringIO()
        with contextlib.redirect_stdout(screen):
            code = prepare.main(["--sessions", sessions, "--project", PROJECT, *args])
        return code, screen.getvalue()

    def read(name):
        with open(os.path.join(out, name), encoding="utf-8") as handle:
            return json.load(handle) if name.endswith(".json") else handle.read()

    def params_file(name, **changes):
        with open(prepare.PARAMS_PATH, encoding="utf-8") as handle:
            data = json.load(handle)
        for key, value in changes.items():
            data[key]["value"] = value
        path = os.path.join(root, name)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False)
        return path

    code, screen = run("--out", out)
    expect(code == 0, f"код выхода {code}: {screen}")
    left = sorted(os.listdir(out))
    expect("old.journal.txt" not in left and "keep.txt" in left, f"рабочая папка: свои старые файлы убраны, чужие нет: {left}")
    manifest = read("retro.json")
    expect([item["session"] for item in manifest["sessions"]] == ["sa", "sb", "sc"],
           f"сессии проекта по времени начала: {[item['session'] for item in manifest['sessions']]}")
    expect(manifest["skipped"] == {"другой проект": 1, "ретро": 1, "короткая": 1},
           f"пропущено: другой проект, ретро, короткая: {manifest['skipped']}")
    expect(manifest["tasks"] == [{"session": "sa", "journal": "sa.journal.txt"}, {"session": "sb", "journal": "sb.journal.txt"},
                                 {"session": "sc", "journal": "sc.journal.txt"}], f"задания: {manifest['tasks']}")
    expect("ошибка API (system/*error*)" in manifest["missing_fields"] and "сжатие контекста (system/chat_compression)"
           not in manifest["missing_fields"], f"сверка полей по выбранным сессиям: {manifest['missing_fields']}")
    for secret in ("PAY-1", "ghp_", "Делаем", "выгрузка", "Реплика"):
        expect(secret not in screen, f"на экран попал текст из журнала: «{secret}»")

    a = manifest["sessions"][0]
    text = read("sa.journal.txt")
    lines = text.splitlines()
    expect(lines[0].startswith("# Сессия sa · начало 2026-10-20 09:00 · длительность 4 мин · реплик пользователя 6")
           and "deepseek-v4-pro" in lines[0] and "qwen-3.6b" in lines[0], f"шапка: {lines[0]}")
    expect("[1] ПОЛЬЗОВАТЕЛЬ: Делаем БТ по задаче PAY-1, токен: ****" in lines and "ghp_" not in text,
           "секрет в реплике замаскирован")
    expect("[2] КОМАНДА: /analyst-workspace PAY-1" in lines and not any(line.startswith("[3]") for line in lines),
           "слэш-вызов скилла — команда; подставленный текст скилла — без строки")
    expect("[4] ВОПРОС: Вход: Что на руках? | варианты: Бизнес / Аналитика" in lines, "вопрос с вариантами")
    answer = next((line for line in lines if line.startswith("[5] ОТВЕТ:")), "")
    expect(answer.startswith("[5] ОТВЕТ: Вход: Бизнес (вариант) (ответ через 2 с на ") and "быстрее чтения" in answer,
           f"выбор варианта через 2 с после длинного текста — быстрее чтения: {answer}")
    expect("[6] СКИЛЛ: business-requirements-doc (вызов агентом) (контекст 69 % окна — выше порога)" in lines,
           "вызов скилла агентом с загрузкой окна выше порога")
    expect("[8] ИНСТРУМЕНТЫ: read_file ×2 (services/payments.md); grep_search ×1; write_file ×1 (coddoc/PAY-1/br.md); "
           "ошибок: 1" in lines, f"вызовы инструментов подряд, через ходы агента без текста, — одной строкой; путь от корня "
           f"проекта, без повторов; ошибка записи: {[line for line in lines if 'ИНСТРУМЕНТЫ' in line]}")
    expect("черновик" not in text and "карточка" not in text, "содержимое файлов в журнал не попадает")
    expect("[14] СЖАТИЕ КОНТЕКСТА" in lines and not any(line.startswith("[15] ПОХОЖЕ") for line in lines),
           "сжатие с записью — без догадки о сжатии")
    expect("[17] ПОХОЖЕ НА СЖАТИЕ: контекст упал с 76 % до 11 % окна" in lines, "падение токенов без записи — догадка о сжатии")
    paste = next((line for line in lines if line.startswith("[18] ПОЛЬЗОВАТЕЛЬ:")), "")
    expect(paste.endswith("…(вставка, 4014 симв.)") and len(paste) < 600, f"вставка — начало и длина: {paste[:80]}…{paste[-40:]}")
    expect("[19] МОДЕЛЬ: qwen-3.6b — слабая" in lines, "смена модели на слабую")
    expect("[20] КОМАНДА: /clear" in lines, "/clear — без загрузки окна")
    expect(a["models"] == {"deepseek-v4-pro": 7, "qwen-3.6b": 1} and a["weak"] == {"qwen-3.6b": 1},
           f"факты: модели {a['models']}, слабая {a['weak']}")
    expect(a["skills"] == [{"n": 6, "skill": "business-requirements-doc", "via": "agent", "share": 0.687}]
           and a["commands"] == [{"n": 2, "command": "/analyst-workspace", "share": None}] and a["loaded"] == [6],
           f"факты: скиллы {a['skills']}, команды {a['commands']}, нагруженные {a['loaded']}")
    expect(a["compressions"] == [14] and a["suspected"] == [17] and a["tool_errors"] == 1 and a["api_errors"] == 0,
           f"факты: сжатия {a['compressions']}, догадки {a['suspected']}, ошибки инструментов {a['tool_errors']}")
    expect(a["fast"] and a["fast"][0]["n"] == 5 and a["pastes"] == [{"n": 18, "chars": 4014, "attached": False}]
           and a["user_turns"] == 6 and a["minutes"] == 4, f"факты: быстрые {a['fast']}, вставки {a['pastes']}")
    expect([item["n"] for item in a["loaded_work"]] == [18] and a["loaded_work"][0]["after_compression"] is True
           and a["after_compression"] == [] and a["clears"] == [20],
           f"реплика после сжатия — работа на загруженном; после /clear — нет: {a['loaded_work']}, "
           f"вызовы после сжатия {a['after_compression']}, /clear {a['clears']}")
    expect(a["skill_replies"] == {"inside": 3, "total": 5, "outside_first": 1},
           f"доля скиллов: до слэш-вызова и после /clear — вне скилла, /clear не в счёт: {a['skill_replies']}")

    def at(n, kind, **fields):
        return dict({"n": n, "ts": f"2026-10-20T09:{n:02d}:00Z", "kind": kind}, **fields)

    def agent_at(n, tokens, text="Вопрос?"):
        return at(n, "agent", text=text, model="m", tokens=tokens, window=262144)

    def user_at(n, text):
        return at(n, "user", text=text, chars=len(text), attached=False)

    inside = [
        at(1, "slash", command="/analyst-workspace", args=""),
        agent_at(2, 30000), user_at(3, "ответ один"),                       # 11 % окна — не в счёт
        agent_at(4, 190000), user_at(5, "ответ два"),                       # 72 % — выше порога, стадия начата чисто
        at(6, "call", name="ask_user_question", id="q1", questions=[{"header": "Срок", "question": "Какой?", "options": ["День"]}]),
        at(7, "result", name="ask_user_question", id="q1",
           answers={"declined": False, "items": [{"header": "Срок", "raw": "День", "selected": ["День"], "own": False}]}),
        at(8, "compression"),
        agent_at(9, 40000, "После сжатия."), user_at(10, "ответ три"),      # после сжатия
        at(11, "call", name="skill", skill="technical-spec-doc", id="s1"),  # вызов скилла после сжатия
        agent_at(12, 60000), user_at(13, "ответ четыре"),                   # всё ещё после сжатия
        at(14, "slash", command="/clear", args=""),
        agent_at(15, 30000), user_at(16, "ответ пять"),                     # после /clear окно чистое — не в счёт
        agent_at(17, 200000), user_at(18, "ответ шесть")]                   # снова выше порога
    inside_lines, inside_facts = prepare.render({"events": inside, "cwd": None}, prepare.load_params())
    work = inside_facts["loaded_work"]
    expect([item["n"] for item in work] == [5, 7, 10, 13, 18]
           and [item["after_compression"] for item in work] == [False, False, True, True, False]
           and work[0]["share"] == 0.725, f"реплики при окне выше порога и после сжатия до /clear: {work}")
    expect(inside_facts["after_compression"] == [11] and inside_facts["loaded"] == [] and inside_facts["clears"] == [14],
           f"вход после сжатия и /clear: {inside_facts['after_compression']}, {inside_facts['loaded']}, {inside_facts['clears']}")
    expect("[5] ПОЛЬЗОВАТЕЛЬ: ответ два" in inside_lines and "[18] ПОЛЬЗОВАТЕЛЬ: ответ шесть" in inside_lines,
           "у реплик в журнале нет пометок загрузки — их считает скрипт, не модель")

    chained = [
        at(1, "slash", command="/analyst-workspace", args="", skill=True),  # первая реплика запуска скилла
        agent_at(2, 30000, "Что на руках?"),
        user_at(3, "бизнес"),
        at(4, "call", name="skill", skill="next-skill", id="s1"),           # агент зовёт скилл — запуск продолжается
        user_at(5, "дальше"),
        at(6, "slash", command="/clear", args=""),                          # /clear закрывает запуск, сам не в счёт
        user_at(7, "вопрос вне скилла"),
        user_at(8, "ещё вопрос")]
    chained_facts = prepare.render({"events": chained, "cwd": None}, prepare.load_params())[1]
    expect(chained_facts["skill_replies"] == {"inside": 3, "total": 5, "outside_first": 7},
           f"доля скиллов: запуск открыт слэш-вызовом, закрыт /clear: {chained_facts['skill_replies']}")

    after_clear = [
        {"n": 1, "ts": "2026-10-20T09:00:00Z", "kind": "agent", "text": "Готово.", "model": "m", "tokens": 210000, "window": 262144},
        {"n": 2, "ts": "2026-10-20T09:01:00Z", "kind": "slash", "command": "/clear", "args": ""},
        {"n": 3, "ts": "2026-10-20T09:02:00Z", "kind": "slash", "command": "/analyst-workspace", "args": ""},
        {"n": 4, "ts": "2026-10-20T09:03:00Z", "kind": "agent", "text": "Что на руках?", "model": "m", "tokens": 15000, "window": 262144}]
    clear_lines, clear_facts = prepare.render({"events": after_clear, "cwd": None}, prepare.load_params())
    expect("[3] КОМАНДА: /analyst-workspace" in clear_lines and not clear_facts["loaded"] and not clear_facts["suspected"],
           f"после /clear прежняя загрузка окна не переносится: {clear_lines}, {clear_facts['loaded']}, {clear_facts['suspected']}")

    def fast_of(gap_text, last_text, answer_after):
        events = [{"n": 1, "ts": "2026-10-20T09:00:00Z", "kind": "agent", "text": gap_text, "model": "m", "tokens": 1000, "window": 262144},
                  {"n": 2, "ts": "2026-10-20T09:05:00Z", "kind": "agent", "text": last_text, "model": "m", "tokens": 1000, "window": 262144},
                  {"n": 3, "ts": f"2026-10-20T09:05:{answer_after:02d}Z", "kind": "user", "text": "да", "chars": 2, "attached": False}]
        return prepare.render({"events": events, "cwd": None}, prepare.load_params())[1]["fast"]
    expect(fast_of("Ход работы. " * 4000, "Готово, проверь.", 3) == [],
           "длинный ход работы до короткого итога — не «быстрее чтения»: считается последнее сообщение")
    expect([item["chars"] for item in fast_of("Ход работы.", "Гипотезы. " * 80, 3)] == [799],
           "длинный итог и ответ через 3 с — «быстрее чтения» по последнему сообщению")

    small = params_file("small.json", journal_limit=1500, part_overlap=2)
    code, _ = run("--out", out, "--params", small)
    manifest = read("retro.json")
    parts = manifest["sessions"][0]["parts"]
    expect(code == 0 and len(parts) >= 2 and [task["journal"] for task in manifest["tasks"] if task["session"] == "sa"] == parts,
           f"длинный журнал — части, каждая своим заданием: {parts}")
    first, second = read(parts[0]), read(parts[1])
    expect(first.startswith("# Сессия sa") and f"часть 1 из {len(parts)}" in first.splitlines()[0]
           and first.splitlines()[-2:] == second.splitlines()[1:3] and len(first) <= 1500 + 200,
           "часть — шапка, номер части, две строки прошлой части в начале следующей")
    expect(os.path.exists(os.path.join(out, "sa.journal.txt")), "целый журнал остаётся для сверки цитат")

    code, _ = run("--out", out, "--params", params_file("two.json", limit=2))
    manifest = read("retro.json")
    expect([item["session"] for item in manifest["sessions"]] == ["sb", "sc"] and manifest["skipped"].get("старше последних") == 1
           and manifest["few"] is True, f"limit 2 — последние две: {[item['session'] for item in manifest['sessions']]}, {manifest['skipped']}")

    code, screen = run("--out", out, "--project", "/work/nowhere")
    expect(code == 1 and "сессий этого проекта для разбора нет" in screen, f"чужая папка проекта: {code}, {screen.strip()}")
    screen = io.StringIO()
    with contextlib.redirect_stdout(screen):
        code = prepare.main(["--sessions", os.path.join(root, "нет"), "--out", out])
    expect(code == 1 and "Журналов не найдено" in screen.getvalue(), f"нет журналов: {code}, {screen.getvalue().strip()}")
    bad = os.path.join(root, "bad.json")
    with open(bad, "w", encoding="utf-8") as handle:
        json.dump({"limit": {"value": 3}}, handle)
    code, screen = run("--out", out, "--params", bad)
    expect(code == 2 and "нет значений" in screen, f"неполные параметры: {code}, {screen.strip()}")

    if failures:
        print("\n".join(failures))
        print(f"selftest-retro-prepare: провалов {len(failures)} из {checks}; папка оставлена: {root}")
        return 1
    shutil.rmtree(root, ignore_errors=True)
    print(f"selftest-retro-prepare: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
