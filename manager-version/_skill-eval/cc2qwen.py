#!/usr/bin/env python3
"""Журнал сессии Claude Code (~/.claude/projects/*/<id>.jsonl) → записи в формате qwen-code для collect.

    python3 cc2qwen.py <сессия.jsonl> <выход.jsonl>

Только для стенда: настоящие сессии — фон для заложенных случаев. Переводится то, что видит collect:
реплики, текст агента, вызовы инструментов (имена — как у qwen-code), результаты и ошибки, ответы на
AskUserQuestion (в форме «**header**: ответ»), слэш-команды, подставленный текст скилла, сжатие контекста,
токены контекста. Субагенты (isSidechain), служебные вставки и уведомления — не переводятся.
"""

from __future__ import annotations

import json
import re
import sys

NAME_MAP = {
    "Read": "read_file", "Write": "write_file", "Edit": "edit", "MultiEdit": "edit", "NotebookEdit": "edit",
    "Bash": "run_shell_command", "PowerShell": "run_shell_command", "Grep": "grep_search", "Glob": "glob",
    "LS": "list_directory", "Task": "agent", "Agent": "agent", "TodoWrite": "todo_write", "WebFetch": "web_fetch",
    "WebSearch": "web_search", "AskUserQuestion": "ask_user_question", "Skill": "skill",
}
SKILL_INJECT = "Base directory for this skill:"
COMPACT_SUMMARY = "This session is being continued from a previous conversation"
REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.DOTALL)
COMMAND_RE = re.compile(r"<command-name>\s*(/?[^<\s]+)\s*</command-name>.*?(?:<command-args>(.*?)</command-args>)?", re.DOTALL)
SKIP_MARKS = ("<local-command-stdout>", "<local-command-stderr>", "<task-notification>", "Caveat:",
              "[Request interrupted", "<bash-input>", "<bash-stdout>", "<bash-stderr>")
ANSWER_PAIR_RE = re.compile(r'"(.+?)"="(.*?)"(?=,\s*"|\.\s|\s*$)', re.DOTALL)


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text")
    return ""


def base(record, kind):
    return {"uuid": record.get("uuid"), "parentUuid": record.get("parentUuid"), "sessionId": record.get("sessionId"),
            "timestamp": record.get("timestamp"), "type": kind, "cwd": record.get("cwd"), "version": record.get("version")}


def ask_output(use, result_record, content, is_error):
    if is_error or "declined" in content.lower() or "doesn't want to proceed" in content:
        return "User declined to answer the questions."
    questions = (use.get("input") or {}).get("questions") or []
    answers = ((result_record.get("toolUseResult") or {}).get("answers")) if isinstance(result_record.get("toolUseResult"), dict) else None
    if not isinstance(answers, dict):
        answers = {question: answer for question, answer in ANSWER_PAIR_RE.findall(content)}
    lines = []
    for question in questions:
        answer = answers.get(question.get("question", ""))
        if answer:
            lines.append(f"**{question.get('header', '')}**: {answer}")
    return "User has provided the following answers:\n\n" + "\n".join(lines)


def convert(records):
    out, uses = [], {}
    for record in records:
        if record.get("isSidechain"):
            continue
        kind = record.get("type")
        message = record.get("message") or {}
        content = message.get("content")

        if kind == "system":
            if record.get("subtype") == "compact_boundary":
                out.append(dict(base(record, "system"), subtype="chat_compression", systemPayload={}))
            continue

        if kind == "assistant" and isinstance(content, list):
            parts = []
            for block in content:
                if block.get("type") == "text" and block.get("text", "").strip():
                    parts.append({"text": block["text"]})
                elif block.get("type") == "tool_use":
                    uses[block["id"]] = block
                    parts.append({"functionCall": {"id": block["id"], "name": NAME_MAP.get(block["name"], block["name"].lower()),
                                                   "args": block.get("input") or {}}})
            if not parts:
                continue
            item = dict(base(record, "assistant"), model=message.get("model"), message={"role": "model", "parts": parts})
            usage = message.get("usage") or {}
            prompt = sum(int(usage.get(key) or 0) for key in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
            if prompt:
                item["usageMetadata"] = {"promptTokenCount": prompt, "candidatesTokenCount": int(usage.get("output_tokens") or 0)}
            out.append(item)
            continue

        if kind != "user":
            continue
        blocks = content if isinstance(content, list) else []
        responses = []
        for block in blocks:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                use = uses.get(block.get("tool_use_id"), {})
                name = NAME_MAP.get(use.get("name", ""), (use.get("name") or "?").lower())
                body = text_of(block.get("content")) if not isinstance(block.get("content"), str) else block["content"]
                if name == "ask_user_question":
                    response = {"output": ask_output(use, record, body, block.get("is_error"))}
                elif block.get("is_error"):
                    response = {"error": body or "error"}
                else:
                    response = {"output": body[:2000]}
                responses.append({"functionResponse": {"id": block.get("tool_use_id"), "name": name, "response": response}})
        if responses:
            out.append(dict(base(record, "tool_result"), message={"role": "user", "parts": responses}))
            continue

        text = text_of(content)
        if record.get("isCompactSummary") or text.lstrip().startswith(COMPACT_SUMMARY):
            continue  # сводка Claude Code после сжатия — не реплика; само сжатие пришло записью compact_boundary
        if record.get("isMeta"):
            if text.lstrip().startswith(SKILL_INJECT):
                out.append(dict(base(record, "user"), message={"role": "user", "parts": [{"text": text}]}))
            continue
        command = COMMAND_RE.search(text)
        if command:
            raw = "/" + command.group(1).lstrip("/") + (" " + command.group(2).strip() if command.group(2) and command.group(2).strip() else "")
            out.append(dict(base(record, "system"), subtype="slash_command", systemPayload={"phase": "invocation", "rawCommand": raw}))
            continue
        if any(mark in text for mark in SKIP_MARKS):
            continue
        text = REMINDER_RE.sub("", text).strip()
        if text:
            out.append(dict(base(record, "user"), message={"role": "user", "parts": [{"text": text}]}))

    peak = max((item.get("usageMetadata", {}).get("promptTokenCount", 0) for item in out), default=0)
    window = 200000 if peak <= 200000 else 1000000
    for item in out:
        if "usageMetadata" in item:
            item["contextWindowSize"] = window
    return out


def read_cc(path):
    records = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                try:
                    records.append(json.loads(line))
                except ValueError:
                    continue
    return records


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip())
        return 2
    converted = convert(read_cc(argv[1]))
    with open(argv[2], "w", encoding="utf-8") as handle:
        for item in converted:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"записей: {len(converted)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
