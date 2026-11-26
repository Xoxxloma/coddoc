"""Сборка синтетических сессий: пишем журнал в формате qwen-code, на диск кладём выгрузку, как на проде.

Каждый метод добавляет одну запись журнала и возвращает её номер. write() переводит журнал в выгрузку событий хуков
(export.to_export) и возвращает карту «номер записи → номер события»: события и есть [N] сжатого журнала, поэтому
ожидания фикстур, записанные номерами записей, переводятся через эту карту (remap).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

from export import to_export

WINDOW = 262144


class Builder:
    def __init__(self, session_id, base):
        self.session_id = session_id
        self.base = datetime.fromisoformat(base).replace(tzinfo=timezone.utc)
        self.lines = []

    def _record(self, sec, kind, **extra):
        stamp = (self.base + timedelta(seconds=sec)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        record = {"uuid": f"u{len(self.lines) + 1}", "parentUuid": None, "sessionId": self.session_id,
                  "timestamp": stamp, "type": kind, "cwd": "/work/ai-sdd", "version": "26.9.64"}
        record.update(extra)
        self.lines.append(json.dumps(record, ensure_ascii=False))
        return len(self.lines)

    def user(self, sec, *texts):
        return self._record(sec, "user", message={"role": "user", "parts": [{"text": text} for text in texts]})

    def agent(self, sec, text=None, calls=(), tokens=None, window=WINDOW):
        parts = ([{"text": text}] if text else []) + [{"functionCall": item} for item in calls]
        extra = {"model": "deepseek-v4-pro", "message": {"role": "model", "parts": parts}}
        if tokens is not None:
            extra["usageMetadata"] = {"promptTokenCount": tokens, "candidatesTokenCount": 100}
            if window:
                extra["contextWindowSize"] = window
        return self._record(sec, "assistant", **extra)

    def result(self, sec, name, call_id, output=None, error=None):
        response = {"error": error} if error else {"output": output}
        part = {"functionResponse": {"id": call_id, "name": name, "response": response}}
        return self._record(sec, "tool_result", message={"role": "user", "parts": [part]})

    def slash(self, sec, raw):
        return self._record(sec, "system", subtype="slash_command",
                            systemPayload={"phase": "invocation", "rawCommand": raw})

    def slash_skill(self, sec, name, args=""):
        """Запуск скилла слэш-командой: команда и подставленный текст скилла — две записи."""
        self.slash(sec, f"/{name} {args}".rstrip())
        return self.user(sec + 1, f"Base directory for this skill: /work/ai-sdd/.gigacode/skills/{name}\n\n"
                                  + "Текст скилла. " * 300)

    def compression(self, sec):
        return self._record(sec, "system", subtype="chat_compression", systemPayload={})

    def broken(self):
        self.lines.append("{broken")
        return len(self.lines)

    def write(self, folder):
        records = []
        for number, line in enumerate(self.lines, 1):
            try:
                records.append((number, json.loads(line)))
            except ValueError:
                continue  # битая строка в выгрузку не попадает
        export, mapping = to_export(records, self.session_id)
        with open(os.path.join(folder, f"{self.session_id}.json"), "w", encoding="utf-8") as handle:
            json.dump(export, handle, ensure_ascii=False, indent=2)
        return mapping


def remap(expected, mapping):
    """Ожидания фикстуры с номерами записей → номера событий выгрузки."""
    def turn(number):
        assert number in mapping, f"запись {number} не стала событием выгрузки"
        return mapping[number]

    def turns(values):
        return {None if value is None else turn(value) for value in values}

    out = dict(expected)
    out["findings"] = [dict(item, turn=turn(item["turn"]), **{key: turns(item[key]) for key in ("earlier_turn", "caught_turn")
                                                               if key in item}) for item in expected["findings"]]
    out["off_topic"] = {category: turns(values) for category, values in expected["off_topic"].items()}
    out["checks"] = {(check, turn(number)): verdict for (check, number), verdict in expected["checks"].items()}
    if "caught" in expected:
        out["caught"] = {(check, turn(number)): turns(values) for (check, number), values in expected["caught"].items()}
    return out


def call(name, args, call_id):
    return {"id": call_id, "name": name, "args": args}


def ask(call_id, questions):
    return call("ask_user_question", {"questions": questions}, call_id)


def option(*labels):
    return [{"label": label, "description": ""} for label in labels]
