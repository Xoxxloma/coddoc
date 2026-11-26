"""Журнал в формате qwen-code (так его собирает стенд) → выгрузка сессии, как на проде (SessionFile, sessions/*.json).

Выгрузка — события хуков агента: START_SESSION (startup, compact), USER_PROMPT, ASSISTANT_ANSWER — последнее сообщение
агента за ход и токены запроса, ASK_USER_QUESTION — вопрос с вариантами вместе с ответом, SKILL_USE — вызов скилла
агентом (на слэш-вызов пользователя приходит только USER_PROMPT «/имя …»), STOP_FAILURE — ошибка API вместо конца хода. Вызовы инструментов, их ошибки и промежуточные реплики агента в выгрузку не попадают:
стенд показывает модели ровно то, что увидит прод.

    to_export([(номер записи, запись), …], session_id) → (выгрузка, {номер записи: номер события})

Номера с 1. Запись, которая не стала событием (вызов инструмента, промежуточная реплика), в карте отсутствует.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone

SKILL_INJECT = "Base directory for this skill:"
ATTACHMENT_MARK = "--- Content from referenced files ---"
OTHER_INJECTS = ("<system-reminder>",)
ANSWER_RE = re.compile(r"^\s*\*\*(.+?)\*\*\s*:\s*(.*)$")
MODEL = "deepseek-v4-pro"


def stamp_of(record):
    value = record.get("timestamp")
    moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return (moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def user_text(parts):
    """Текст реплики, как его видит хук: без вставленных файлов и служебных вставок."""
    texts, attached = [], False
    for part in parts:
        text = part.get("text") if isinstance(part, dict) else None
        if not isinstance(text, str) or not text.strip():
            continue
        if text.strip().startswith(ATTACHMENT_MARK):
            attached = True
        if attached or text.lstrip().startswith(OTHER_INJECTS):
            continue
        texts.append(text)
    return "\n".join(texts)


def answered(questions, output):
    """Ответ qwen («**заголовок**: ответ») → вопросы выгрузки с selected и rawAnswer."""
    declined = "User declined" in output
    answers = {}
    for line in output.splitlines():
        match = ANSWER_RE.match(line)
        if match:
            answers[match.group(1).strip()] = match.group(2).strip()
    items = []
    for number, question in enumerate(questions, 1):
        labels = [str(option.get("label", "")) for option in question.get("options") or [] if isinstance(option, dict)]
        raw = "" if declined else answers.get(question.get("header", ""), answers.get(f"Question {number}", ""))
        parts = [part.strip() for part in raw.split(",")] if question.get("multiSelect") else [raw.strip()]
        items.append({"header": question.get("header", ""), "question": question.get("question", ""),
                      "multiSelect": bool(question.get("multiSelect")),
                      "options": [{"label": label, "description": ""} for label in labels],
                      "selected": [part for part in parts if part in labels], "rawAnswer": raw})
    return items


def to_export(records, session_id, login="user-01"):
    events, mapping, asks = [], {}, {}
    turn = {}

    def emit(name, moment, **fields):
        event = {"id": f"{session_id}-{len(events) + 1}", "login": login, "fio": "", "team": "", "sessionId": session_id,
                 "eventName": name, "status": "error" if name == "STOP_FAILURE" else "success", "createdAt": iso(moment),
                 "userPrompt": None, "assistantLastMessage": None, "errorReason": None, "errorDetails": None,
                 "sessionEndReason": None, "sessionStartSource": None, "sessionStartModel": None, "skillName": None,
                 "inputTokens": None, "askUserQuestion": None}
        event.update(fields)
        events.append(event)
        return len(events)

    def close_turn():
        """Конец хода агента — хук Stop: последнее сообщение и токены последнего запроса."""
        if turn:
            number = emit("ASSISTANT_ANSWER", turn.get("stamp") or turn["seen"], assistantLastMessage=turn.get("text") or "",
                          inputTokens=turn.get("tokens") or 0)
            if turn.get("text_pos"):
                mapping[turn["text_pos"]] = number
            turn.clear()

    if records:
        emit("START_SESSION", stamp_of(records[0][1]), sessionStartSource="startup", sessionStartModel=MODEL)
    for position, record in records:
        kind, moment = record.get("type"), stamp_of(record)
        parts = [part for part in ((record.get("message") or {}).get("parts") or []) if isinstance(part, dict)]
        if kind == "system":
            subtype = record.get("subtype") or ""
            payload = record.get("systemPayload") or {}
            if subtype == "slash_command" and payload.get("phase", "invocation") != "result":
                close_turn()
                mapping[position] = emit("USER_PROMPT", moment, userPrompt=str(payload.get("rawCommand", "")))
            elif subtype == "chat_compression":
                mapping[position] = emit("START_SESSION", moment, sessionStartSource="compact", sessionStartModel=MODEL)
            elif "error" in subtype:
                turn.clear()  # ход оборвался ошибкой API: вместо Stop — StopFailure
                mapping[position] = emit("STOP_FAILURE", moment, errorReason=subtype, errorDetails=subtype,
                                         assistantLastMessage=subtype)
        elif kind == "user" and not any(isinstance(part.get("functionResponse"), dict) for part in parts):
            inject = next((part["text"] for part in parts if isinstance(part.get("text"), str)
                           and part["text"].lstrip().startswith(SKILL_INJECT)), None)
            if inject is not None:
                continue  # текст скилла после слэш-вызова: на проде события нет, вызов — сама реплика «/имя …»
            text = user_text(parts)
            if text:
                close_turn()
                mapping[position] = emit("USER_PROMPT", moment, userPrompt=text)
        elif kind == "assistant":
            usage = record.get("usageMetadata") or {}
            turn["seen"] = moment
            if isinstance(usage.get("promptTokenCount"), int):
                turn["tokens"] = usage["promptTokenCount"]
            text = " ".join(part["text"] for part in parts if isinstance(part.get("text"), str) and part["text"].strip())
            if text:
                turn.update(text=text, text_pos=position, stamp=moment)
            for part in parts:
                call = part.get("functionCall")
                if not isinstance(call, dict):
                    continue
                args = call.get("args") if isinstance(call.get("args"), dict) else {}
                if call.get("name") == "skill":
                    number = emit("SKILL_USE", moment, skillName=str(args.get("skill") or "?"))
                    mapping.setdefault(position, number)
                elif call.get("name") == "ask_user_question":
                    asks[call.get("id")] = [item for item in args.get("questions") or [] if isinstance(item, dict)]
        else:
            for part in parts:
                response = part.get("functionResponse")
                if not isinstance(response, dict) or response.get("name") != "ask_user_question":
                    continue
                body = response.get("response") if isinstance(response.get("response"), dict) else {}
                questions = asks.pop(response.get("id"), None)
                if questions is None or body.get("error"):
                    continue  # вопрос не дошёл до пользователя — события нет
                output = body.get("output") if isinstance(body.get("output"), str) else ""
                payload = {"questions": answered(questions, output)}
                mapping[position] = emit("ASK_USER_QUESTION", moment, askUserQuestion=json.dumps(payload, ensure_ascii=False))
    close_turn()
    stamps = [event["createdAt"] for event in events]
    return {
        "sessionId": session_id, "startedAt": min(stamps) if stamps else None, "endedAt": max(stamps) if stamps else None,
        "lastEventTime": max(stamps) if stamps else None, "live": False, "models": [MODEL], "resumed": False,
        "tokens": max([event["inputTokens"] or 0 for event in events] or [0]),
        "promptsCount": sum(event["eventName"] == "USER_PROMPT" for event in events),
        "skillsCount": sum(event["eventName"] == "SKILL_USE" for event in events),
        "errorsCount": sum(event["eventName"] == "STOP_FAILURE" for event in events),
        "events": events,
    }, mapping
