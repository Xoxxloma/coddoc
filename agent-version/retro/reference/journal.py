#!/usr/bin/env python3
"""journal — разбор локального журнала чата GigaCode (формат qwen-code) в события для ретро.

    python3 journal.py --probe [<папка или файл .jsonl>]

Журнал — строки JSON в <дом>/.gigacode/projects/<проект>/chats/<sessionId>.jsonl, одна запись на строку: user,
assistant, tool_result, system. Схема восстановлена по исходникам qwen-code, поэтому разбор не падает на незнакомом,
а считает его.

--probe — сверка формата: по всем журналам в папке (по умолчанию <дом>/.gigacode/projects) печатает типы записей,
имена полей, имена инструментов и подтипы, и какие ожидаемые поля не нашлись. Текста реплик, ответов и путей не
печатает: вывод можно переслать как есть.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SKILL_INJECT = "Base directory for this skill:"     # текст скилла, подставленный после слэш-вызова, — не реплика
ATTACHMENT_MARK = "--- Content from referenced files ---"  # дальше в реплике — прикреплённые файлы
SERVICE_INJECTS = ("<system-reminder>",)
ANSWERED = "User has provided the following answers"
DECLINED = "User declined"
ANSWER_RE = re.compile(r"^\s*\*\*(.+?)\*\*\s*:\s*(.*)$")
PATH_KEYS = ("file_path", "absolute_path", "path", "dir_path", "directory")

# Что ретро ждёт от журнала: (что, как узнать). Ненайденное --probe называет.
EXPECTED = (
    ("время у записей", lambda inv: inv["keys"]["*"]["timestamp"] > 0),
    ("папка проекта у записей (cwd)", lambda inv: inv["keys"]["*"]["cwd"] > 0),
    ("id сессии у записей", lambda inv: inv["keys"]["*"]["sessionId"] > 0),
    ("модель у ответов агента", lambda inv: inv["keys"]["assistant"]["model"] > 0),
    ("токены запроса (usageMetadata.promptTokenCount)", lambda inv: inv["keys"]["assistant"]["usageMetadata.promptTokenCount"] > 0),
    ("размер окна (contextWindowSize)", lambda inv: inv["keys"]["assistant"]["contextWindowSize"] > 0),
    ("слэш-команда (system/slash_command)", lambda inv: inv["subtypes"]["slash_command"] > 0),
    ("сжатие контекста (system/chat_compression)", lambda inv: inv["subtypes"]["chat_compression"] > 0),
    ("ошибка API (system/*error*)", lambda inv: any("error" in name for name in inv["subtypes"])),
    ("вызов скилла агентом (functionCall skill)", lambda inv: inv["tools"]["skill"] > 0),
    ("вопрос с вариантами (functionCall ask_user_question)", lambda inv: inv["tools"]["ask_user_question"] > 0),
    ("ответ на вопрос «**заголовок**: ответ»", lambda inv: inv["answers"]["answered"] > 0),
    ("текст скилла после слэш-вызова", lambda inv: inv["injects"] > 0),
)


def parse_ts(value):
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def read_records(path):
    """[(номер строки, запись)], число битых строк. Номер строки — с 1, пустые строки номер не занимают."""
    records, bad, number = [], 0, 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            number += 1
            try:
                record = json.loads(line)
            except ValueError:
                bad += 1
                continue
            if isinstance(record, dict):
                records.append((number, record))
            else:
                bad += 1
    return records, bad


def parts_of(record):
    message = record.get("message")
    parts = message.get("parts") if isinstance(message, dict) else None
    return [part for part in parts if isinstance(part, dict)] if isinstance(parts, list) else []


def user_text(parts):
    """(текст реплики, приложены ли файлы): служебные вставки и прикреплённые файлы — не слова пользователя."""
    texts, attached = [], False
    for part in parts:
        text = part.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        if text.strip().startswith(ATTACHMENT_MARK):
            attached = True
        if attached or text.lstrip().startswith(SERVICE_INJECTS):
            continue
        texts.append(text)
    return "\n".join(texts), attached


def path_of(args):
    return next((args[key] for key in PATH_KEYS if isinstance(args.get(key), str)), None)


def questions_of(args):
    items = []
    for item in args.get("questions") or []:
        if not isinstance(item, dict):
            continue
        labels = [str(option.get("label", "")) for option in item.get("options") or [] if isinstance(option, dict)]
        items.append({"header": str(item.get("header", "")), "question": str(item.get("question", "")),
                      "options": labels, "multi": bool(item.get("multiSelect"))})
    return items


def answers_of(questions, output):
    """Ответ инструмента вопросов («**заголовок**: ответ» по строке на вопрос) → по вопросу: ответ как есть, выбранные
    варианты и свой текст. Ответ, не совпавший ни с одной подписью, — свой текст (при нескольких — по каждому)."""
    declined = DECLINED in output
    found = {}
    for line in output.splitlines():
        match = ANSWER_RE.match(line)
        if match:
            found[match.group(1).strip()] = match.group(2).strip()
    items = []
    for number, question in enumerate(questions, 1):
        raw = "" if declined else found.get(question["header"], found.get(f"Question {number}", ""))
        pieces = [piece.strip() for piece in raw.split(",")] if question["multi"] else [raw.strip()]
        pieces = [piece for piece in pieces if piece]
        items.append({"header": question["header"], "raw": raw,
                      "selected": [piece for piece in pieces if piece in question["options"]],
                      "own": [piece for piece in pieces if piece not in question["options"]]})
    return {"declined": declined, "items": items}


def parse_chat(path):
    """Журнал чата → сессия: события по порядку и сводка. Событие — словарь с номером строки n, временем ts и видом
    kind: user, slash, agent, call, result, compression, api_error, system."""
    records, bad = read_records(path)
    events, calls = [], {}
    sessions, cwds, models, unknown = Counter(), Counter(), Counter(), Counter()
    injects = 0

    def add(number, record, kind, **fields):
        events.append({"n": number, "ts": record.get("timestamp"), "kind": kind, **fields})

    for number, record in records:
        kind = record.get("type")
        if isinstance(record.get("sessionId"), str):
            sessions[record["sessionId"]] += 1
        if isinstance(record.get("cwd"), str):
            cwds[record["cwd"]] += 1
        parts = parts_of(record)
        if kind == "system":
            subtype = str(record.get("subtype") or "")
            payload = record.get("systemPayload") if isinstance(record.get("systemPayload"), dict) else {}
            if subtype == "slash_command":
                if payload.get("phase", "invocation") == "result":
                    continue  # вывод команды, а не её набор
                raw = str(payload.get("rawCommand", "")).strip()
                name, _, rest = raw.partition(" ")
                add(number, record, "slash", command=name, args=rest.strip())
            elif subtype == "chat_compression":
                add(number, record, "compression")
            elif "error" in subtype:
                add(number, record, "api_error", subtype=subtype)
            else:
                add(number, record, "system", subtype=subtype)
        elif kind == "user":
            responses = [part["functionResponse"] for part in parts if isinstance(part.get("functionResponse"), dict)]
            if responses:  # ответ инструмента в записи user — так пишут не все версии
                for response in responses:
                    add_result(add, number, record, response, calls)
                continue
            if any(isinstance(part.get("text"), str) and part["text"].lstrip().startswith(SKILL_INJECT) for part in parts):
                injects += 1
                # За слэш-вызовом скилла идёт подставленный текст скилла, за встроенной командой (/clear, /model) — нет.
                for event in reversed(events):
                    if event["kind"] == "slash":
                        event["skill"] = True
                    if event["kind"] in ("slash", "user", "agent", "call", "result"):
                        break
                continue
            text, attached = user_text(parts)
            if text or attached:
                add(number, record, "user", text=text, chars=len(text), attached=attached)
        elif kind == "assistant":
            model = record.get("model") if isinstance(record.get("model"), str) else None
            if model:
                models[model] += 1
            usage = record.get("usageMetadata") if isinstance(record.get("usageMetadata"), dict) else {}
            tokens = usage.get("promptTokenCount")
            window = record.get("contextWindowSize")
            # Часть с thought: true — рассуждение модели: пользователь его не видит, в текст агента не идёт.
            text = "\n".join(part["text"] for part in parts if isinstance(part.get("text"), str) and part["text"].strip()
                             and part.get("thought") is not True)
            add(number, record, "agent", text=text, model=model,
                tokens=tokens if isinstance(tokens, int) and not isinstance(tokens, bool) else None,
                window=window if isinstance(window, int) and not isinstance(window, bool) and window > 0 else None)
            for part in parts:
                call = part.get("functionCall")
                if not isinstance(call, dict):
                    continue
                name = str(call.get("name") or "?")
                args = call.get("args") if isinstance(call.get("args"), dict) else {}
                item = {"id": call.get("id"), "name": name, "path": path_of(args)}
                if name == "skill":
                    item["skill"] = str(args.get("skill") or "?")
                elif name == "ask_user_question":
                    item["questions"] = questions_of(args)
                calls[call.get("id")] = item
                add(number, record, "call", **item)
        elif kind == "tool_result":
            for part in parts:
                if isinstance(part.get("functionResponse"), dict):
                    add_result(add, number, record, part["functionResponse"], calls)
        else:
            unknown[str(kind)] += 1

    stamps = [moment for moment in (parse_ts(event["ts"]) for event in events) if moment]
    return {"file": str(path), "session": sessions.most_common(1)[0][0] if sessions else Path(path).stem,
            "cwd": cwds.most_common(1)[0][0] if cwds else None,
            "start": min(stamps).strftime("%Y-%m-%dT%H:%M:%SZ") if stamps else None,
            "end": max(stamps).strftime("%Y-%m-%dT%H:%M:%SZ") if stamps else None,
            "models": sorted(models), "events": events, "records": len(records), "bad_lines": bad,
            "skill_texts": injects, "unknown_types": dict(unknown)}


def add_result(add, number, record, response, calls):
    name = str(response.get("name") or "?")
    body = response.get("response") if isinstance(response.get("response"), dict) else {}
    item = {"id": response.get("id"), "name": name, "error": bool(body.get("error"))}
    call = calls.get(response.get("id"))
    if name == "ask_user_question" and call and not item["error"]:
        output = body.get("output") if isinstance(body.get("output"), str) else ""
        item["answers"] = answers_of(call.get("questions") or [], output)
    add(number, record, "result", **item)


# ---------------------------------------------------------------- сверка формата


FIELD_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,40}$")


def key_paths(value, prefix=""):
    """Имена полей записи (без значений): вложенные через точку, элементы списков — []. Ключ, похожий на текст, а не на
    имя поля (бывают словари с ключами-вопросами), печатается как <…>."""
    if isinstance(value, dict):
        for key, item in value.items():
            key = key if FIELD_NAME_RE.match(str(key)) else "<…>"
            name = f"{prefix}.{key}" if prefix else str(key)
            yield name
            yield from key_paths(item, name)
    elif isinstance(value, list):
        for item in value:
            yield from key_paths(item, prefix + "[]")


def where_of(path):
    parts = Path(path).parts
    if "subagents" in parts:
        return "subagents"
    return "runtime" if Path(path).name.endswith(".runtime.jsonl") else "chats"


def inventory(files):
    inv = {"files": Counter(), "records": 0, "bad": 0, "types": Counter(), "subtypes": Counter(),
           "keys": {"*": Counter(), "assistant": Counter()}, "tools": Counter(), "results": Counter(),
           "answers": Counter(), "injects": 0, "commands": Counter(), "models": Counter(), "fields": {}}
    for path in files:
        where = where_of(path)
        inv["files"][where] += 1
        try:
            records, bad = read_records(path)
        except (OSError, UnicodeDecodeError):
            inv["files"]["не прочитан"] += 1
            continue
        inv["records"] += len(records)
        inv["bad"] += bad
        if where != "chats":
            continue  # служебные и журналы субагентов — только счёт
        for _number, record in records:
            kind = str(record.get("type"))
            inv["types"][kind] += 1
            paths = set(key_paths(record))
            inv["fields"].setdefault(kind, Counter()).update(paths)
            inv["keys"]["*"].update(key for key in ("timestamp", "cwd", "sessionId") if key in record)
            if kind == "assistant":
                inv["keys"]["assistant"].update(key for key in ("model", "usageMetadata.promptTokenCount", "contextWindowSize")
                                                if key in paths)
                if isinstance(record.get("model"), str):
                    inv["models"][record["model"]] += 1
            if kind == "system":
                subtype = str(record.get("subtype") or "")
                inv["subtypes"][subtype] += 1
                payload = record.get("systemPayload") if isinstance(record.get("systemPayload"), dict) else {}
                if subtype == "slash_command" and isinstance(payload.get("rawCommand"), str):
                    inv["commands"][payload["rawCommand"].split(" ", 1)[0]] += 1
            for part in parts_of(record):
                call, response = part.get("functionCall"), part.get("functionResponse")
                if isinstance(call, dict):
                    inv["tools"][str(call.get("name"))] += 1
                if isinstance(response, dict):
                    body = response.get("response") if isinstance(response.get("response"), dict) else {}
                    inv["results"][f"{response.get('name')}: {'/'.join(sorted(body)) or '—'}"] += 1
                    output = body.get("output") if isinstance(body.get("output"), str) else ""
                    if response.get("name") == "ask_user_question":
                        inv["answers"]["answered" if ANSWERED in output else "declined" if DECLINED in output else "другой вид"] += 1
                text = part.get("text")
                if kind == "user" and isinstance(text, str) and text.lstrip().startswith(SKILL_INJECT):
                    inv["injects"] += 1
    return inv


def render_probe(inv):
    def counts(counter):
        return ", ".join(f"{name} {count}" for name, count in counter.most_common()) or "—"

    lines = [f"Файлов: {counts(inv['files'])}; записей: {inv['records']}; битых строк: {inv['bad']}",
             f"Типы записей (chats): {counts(inv['types'])}",
             f"Подтипы system: {counts(inv['subtypes'])}",
             f"Слэш-команды: {counts(inv['commands'])}",
             f"Инструменты (functionCall.name): {counts(inv['tools'])}",
             f"Ответы инструментов (имя: поля): {counts(inv['results'])}",
             f"Ответы на вопросы с вариантами: {counts(inv['answers'])}",
             f"Модели: {counts(inv['models'])}",
             "", "Поля по типам записей (в скольких записях):"]
    for kind, fields in sorted(inv["fields"].items()):
        lines.append(f"- {kind}: " + ", ".join(f"{name} {count}" for name, count in sorted(fields.items())))
    missing = [name for name, found in EXPECTED if not found(inv)]
    lines += ["", "Ожидаемое не найдено: " + ("; ".join(missing) if missing else "всё найдено")]
    return "\n".join(lines) + "\n"


def chat_files(root):
    root = Path(root)
    if root.is_file():
        return [root]
    return sorted(path for path in root.rglob("*.jsonl") if path.is_file())


def main(argv=None):
    parser = argparse.ArgumentParser(description="Разбор журналов чата GigaCode для ретро.")
    parser.add_argument("--probe", nargs="?", const=str(Path.home() / ".gigacode" / "projects"), default=None,
                        metavar="ПАПКА", help="сверка формата журналов, без содержимого (по умолчанию <дом>/.gigacode/projects)")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if cfg.probe is None:
        parser.print_help()
        return 2
    files = chat_files(cfg.probe) if Path(cfg.probe).exists() else []
    if not files:
        print(f"Журналов не найдено: {cfg.probe}. Укажите папку с журналами: --probe <папка>")
        return 1
    print(render_probe(inventory(files)), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
