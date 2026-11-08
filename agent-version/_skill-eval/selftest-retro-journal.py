#!/usr/bin/env python3
"""Самопроверка retro/reference/journal.py: разбор журнала чата GigaCode и сверка формата (--probe).

    python3 selftest-retro-journal.py

Журналы собираются синтетикой стенда session-quality (sessionlib.Builder, формат qwen-code) и пишутся как есть, без
перевода в выгрузку. Сессия s1 — все виды записей, которые ждёт ретро; s2 — без половины ожидаемого (что назовёт
--probe). Номера в комментариях — номера строк журнала.
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
import journal  # noqa: E402
from sessionlib import Builder, ask, call, option  # noqa: E402


def write_lines(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def set_model(builder, model):
    record = json.loads(builder.lines[-1])
    builder.lines[-1] = json.dumps(dict(record, model=model), ensure_ascii=False)


def build_s1():
    b = Builder("s1", "2026-10-20T09:00:00")
    b.user(0, "Делаем БТ по задаче PAY-1, пароль qwerty123")                                       # 1
    b.slash_skill(5, "analyst-workspace", "PAY-1")                                                  # 2 команда, 3 текст скилла
    b.agent(20, text="Что на руках?", tokens=50000,
            calls=[ask("q1", [{"header": "Вход", "question": "Что на руках?", "options": option("Бизнес", "Аналитика")}])])  # 4
    b.result(40, "ask_user_question", "q1", output="User has provided the following answers:\n\n**Вход**: Бизнес")  # 5
    b.agent(50, calls=[call("skill", {"skill": "business-requirements-doc"}, "s1")], tokens=60000)  # 6
    b.result(51, "skill", "s1", output="loaded")                                                   # 7
    b.agent(60, text="Гипотезы по полям и сроку.", tokens=70000,
            calls=[ask("q2", [{"header": "Поля", "question": "Какие поля?", "options": option("id", "name", "date"),
                               "multiSelect": True},
                              {"header": "Срок", "question": "Срок?", "options": option("30", "60")}])])  # 8
    b.result(90, "ask_user_question", "q2",
             output="User has provided the following answers:\n\n**Поля**: id, name, сумма\n**Срок**: не знаю")  # 9
    b.agent(100, calls=[call("read_file", {"absolute_path": "/work/ai-sdd/services/payments.md"}, "r1")], tokens=80000)  # 10
    b.result(101, "read_file", "r1", output="карточка сервиса")                                    # 11
    b.agent(110, calls=[call("write_file", {"file_path": "coddoc/PAY-1/br.md", "content": "секретный текст"}, "w1")],
            tokens=90000)                                                                           # 12
    b.result(111, "write_file", "w1", error="EACCES")                                              # 13
    b.compression(120)                                                                              # 14
    b._record(130, "system", subtype="api_error", systemPayload={})                                # 15
    b.user(140, "Вот документ", "--- Content from referenced files ---", "содержимое файла")       # 16
    b.user(141, "<system-reminder>служебное</system-reminder>")                                     # 17
    b.agent(150, text="Готово.", tokens=20000)                                                      # 18
    set_model(b, "qwen-3.6b")
    b.agent(160, calls=[ask("q3", [{"header": "Ок", "question": "Продолжаем?", "options": option("Да", "Нет")}])])  # 19
    b.result(170, "ask_user_question", "q3", output="User declined to answer the questions.")      # 20
    b.slash(180, "/clear")                                                                          # 21
    b.broken()                                                                                      # 22
    b._record(190, "weird")                                                                         # 23
    b._record(191, "tool_result", message={"role": "user", "parts": [{"functionResponse": {
        "id": "x", "name": "web_fetch", "response": {"output": "", "answers": {"Какой срок хранения?": "30"}}}}]})  # 24
    b._record(191, "assistant", model="deepseek-v4-pro", message={"role": "model", "parts": [
        {"text": "The user hasn't sent a new message yet.", "thought": True}, {"text": "Видимый ответ."}]})  # 25
    return b.lines


def build_s2():
    b = Builder("s2", "2026-10-21T09:00:00")
    b.user(0, "Привет")
    b.agent(10, text="Здравствуйте.", tokens=1000, window=None)
    return b.lines


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    root = tempfile.mkdtemp(prefix="retro-journal-")
    projects = os.path.join(root, "projects")
    s1_path = os.path.join(projects, "work-ai-sdd", "chats", "s1.jsonl")
    write_lines(s1_path, build_s1())
    write_lines(os.path.join(projects, "work-ai-sdd", "chats", "s1.runtime.jsonl"), ['{"status": "idle"}'])
    write_lines(os.path.join(projects, "work-ai-sdd", "subagents", "s1", "agent-review-1.jsonl"), build_s2())
    s2_path = os.path.join(root, "other", "chats", "s2.jsonl")
    write_lines(s2_path, build_s2())

    failures, checks = [], 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    chat = journal.parse_chat(s1_path)
    events = chat["events"]
    by_n = {}
    for event in events:
        by_n.setdefault(event["n"], []).append(event)

    def one(n, kind):
        found = [event for event in by_n.get(n, []) if event["kind"] == kind]
        return found[0] if found else {}

    expect(chat["session"] == "s1" and chat["cwd"] == "/work/ai-sdd" and chat["start"] == "2026-10-20T09:00:00Z"
           and chat["end"] == "2026-10-20T09:03:11Z", f"сводка сессии: {chat['session']}, {chat['cwd']}, {chat['start']}, {chat['end']}")
    expect(chat["records"] == 24 and chat["bad_lines"] == 1 and chat["unknown_types"] == {"weird": 1},
           f"записей 24, битая строка 1, незнакомый тип 1: {chat['records']}, {chat['bad_lines']}, {chat['unknown_types']}")
    expect(one(1, "user").get("text") == "Делаем БТ по задаче PAY-1, пароль qwerty123" and one(1, "user").get("attached") is False,
           f"[1] реплика: {one(1, 'user')}")
    expect(one(2, "slash") == {"n": 2, "ts": "2026-10-20T09:00:05.000Z", "kind": "slash", "command": "/analyst-workspace",
                               "args": "PAY-1", "skill": True},
           f"[2] слэш-вызов скилла: за ним подставлен текст скилла — помечен как скилл: {one(2, 'slash')}")
    expect(3 not in by_n and chat["skill_texts"] == 1, f"[3] текст скилла после слэш-вызова — не реплика: {by_n.get(3)}")
    expect(one(4, "agent").get("tokens") == 50000 and one(4, "agent").get("window") == 262144
           and one(4, "agent").get("model") == "deepseek-v4-pro", f"[4] ответ агента: токены, окно, модель {one(4, 'agent')}")
    expect(one(5, "result").get("answers") == {"declined": False, "items": [
        {"header": "Вход", "raw": "Бизнес", "selected": ["Бизнес"], "own": []}]}, f"[5] выбран вариант: {one(5, 'result')}")
    expect(one(6, "call").get("skill") == "business-requirements-doc" and one(6, "agent").get("text") == "",
           f"[6] вызов скилла агентом: {by_n.get(6)}")
    expect(one(9, "result").get("answers", {}).get("items") == [
        {"header": "Поля", "raw": "id, name, сумма", "selected": ["id", "name"], "own": ["сумма"]},
        {"header": "Срок", "raw": "не знаю", "selected": [], "own": ["не знаю"]}],
        f"[9] несколько вариантов и свой текст: {one(9, 'result')}")
    expect(one(10, "call").get("path") == "/work/ai-sdd/services/payments.md", f"[10] путь чтения: {one(10, 'call')}")
    expect(one(12, "call").get("path") == "coddoc/PAY-1/br.md" and one(13, "result").get("error") is True,
           f"[12–13] запись файла упала: {one(12, 'call')}, {one(13, 'result')}")
    expect(one(14, "compression") and one(15, "api_error").get("subtype") == "api_error", f"[14–15] сжатие и ошибка API: {by_n.get(14)}, {by_n.get(15)}")
    expect(one(16, "user").get("text") == "Вот документ" and one(16, "user").get("attached") is True,
           f"[16] реплика с приложенным файлом: {one(16, 'user')}")
    expect(17 not in by_n, f"[17] одна служебная вставка — не реплика: {by_n.get(17)}")
    expect(one(18, "agent").get("model") == "qwen-3.6b" and chat["models"] == ["deepseek-v4-pro", "qwen-3.6b"],
           f"[18] модель у ответа: {one(18, 'agent')}, модели {chat['models']}")
    expect(one(20, "result").get("answers", {}).get("declined") is True, f"[20] отказ отвечать: {one(20, 'result')}")
    expect(one(21, "slash").get("command") == "/clear" and "skill" not in one(21, "slash"),
           f"[21] /clear — встроенная команда, не скилл: {one(21, 'slash')}")
    expect(one(25, "agent").get("text") == "Видимый ответ.", f"[25] рассуждение модели (thought) — не текст агента: {one(25, 'agent')}")
    dumped = json.dumps(events, ensure_ascii=False)
    expect("секретный текст" not in dumped and "содержимое файла" not in dumped and "карточка сервиса" not in dumped,
           "в события не попадает содержимое записанных и прочитанных файлов и вложений")

    def probe(path):
        screen = io.StringIO()
        with contextlib.redirect_stdout(screen):
            code = journal.main(["--probe", path])
        return code, screen.getvalue()

    code, full = probe(projects)
    expect(code == 0 and full.startswith("Файлов: chats 1, runtime 1, subagents 1;"),
           f"--probe: журнал, служебный файл и журнал субагента различаются: {full.splitlines()[:1]}")
    expect("Ожидаемое не найдено: всё найдено" in full, f"--probe на полном журнале: {full.splitlines()[-1:]}")
    expect("ask_user_question 3" in full and "skill 1" in full and "chat_compression 1" in full and "/clear 1" in full
           and "qwen-3.6b 1" in full, "--probe: инструменты, подтипы, команды, модели")
    for secret in ("qwerty123", "PAY-1", "Делаем", "секретный", "payments.md", "сумма", "Гипотезы", "Какой срок",
                   "содержимое", "/work/ai-sdd"):
        expect(secret not in full, f"--probe напечатал содержимое: «{secret}»")
    expect("<…>" in full, "--probe: ключ-вопрос в ответе инструмента заменён на <…>")

    code, short = probe(s2_path)
    missing = short.rsplit("Ожидаемое не найдено: ", 1)[-1]
    for name in ("размер окна", "слэш-команда", "сжатие контекста", "ошибка API", "вызов скилла агентом",
                 "вопрос с вариантами", "текст скилла после слэш-вызова"):
        expect(name in missing, f"--probe на неполном журнале не назвал «{name}»: {missing.strip()}")
    expect("модель у ответов агента" not in missing and "время у записей" not in missing,
           f"--probe на неполном журнале: найденное не названо ненайденным: {missing.strip()}")

    code, empty = probe(os.path.join(root, "нет-такой-папки"))
    expect(code == 1 and "Журналов не найдено" in empty, f"--probe без журналов: {code}, {empty.strip()}")

    if failures:
        print("\n".join(failures))
        print(f"selftest-retro-journal: провалов {len(failures)} из {checks}; папка оставлена: {root}")
        return 1
    shutil.rmtree(root, ignore_errors=True)
    print(f"selftest-retro-journal: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
