#!/usr/bin/env python3
"""Прогон скилла session-quality целиком: ведущий агент по SKILL.md на папке моков.

    python3 run_skill.py --name skill-pilot --parallel 5
    python3 run_skill.py --name skill-pilot --grade-only

Рабочая папка: моки (mocks.build) в sessions/user-01, скилл — в .claude/skills/session-quality. Ведущий запускается
через `claude -p "/session-quality sessions/user-01 --parallel N"` в обычном режиме разрешений и только с теми
инструментами, что нужны скиллу: чтение и запись файлов, поиск файлов, субагенты и `python` в терминале — остальное
запрещено. Оценка — после завершения прогона, по файлам: рядом с каждой сессией <id>.quality.json и .md, каждый JSON
проходит contract.py, рабочая папка .quality-work убрана; ответов субагентов столько же, сколько сессий; заложенное найдено (как в grade_brief); одновременно работало не больше N субагентов;
ведущий не читал журналы сам. Стоимость — total_cost_usd. Всё — в product/ (вне Git): в моках рабочие диалоги.
"""

from __future__ import annotations

import argparse
import contextlib
import glob
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.normpath(os.path.join(HERE, "..", "session-quality"))
sys.path.insert(0, os.path.join(SKILL, "reference"))
sys.path.insert(0, HERE)
import collect  # noqa: E402
import contract  # noqa: E402
import grade_brief  # noqa: E402
import mocks  # noqa: E402
import run_brief  # noqa: E402

AGENT_TOOLS = ("Agent", "Task")
ALLOWED_TOOLS = ["Read", "Write", "Glob", "Agent", "Task", "Bash(python:*)", "Bash(python3:*)"]
DENIED_TOOLS = ["WebFetch", "WebSearch", "Edit", "NotebookEdit"]


def read_stream(path):
    events = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    return events


def grade(run_dir, parallel):
    ws = os.path.join(run_dir, "ws")
    sessions = os.path.join(ws, "sessions", "user-01")
    work = os.path.join(sessions, collect.WORK_DIR)
    expected = grade_brief.load_expected(os.path.join(run_dir, "expected.json"))
    events = read_stream(os.path.join(run_dir, "stream.jsonl"))
    lines, problems = [], []

    result = next((event for event in reversed(events) if event.get("type") == "result"), {})
    cost = float(result.get("total_cost_usd") or 0)
    if result.get("subtype") != "success" or result.get("is_error"):
        problems.append(f"прогон сорвался: {result.get('subtype')}")

    launched_by_message, reads, written = {}, [], {}
    for event in events:
        if event.get("type") != "assistant" or event.get("parent_tool_use_id"):
            continue  # события субагентов идут в том же потоке — считаем только ведущего
        message = event.get("message") or {}
        uses = [block for block in message.get("content") or [] if block.get("type") == "tool_use"]
        for block in uses:
            if block.get("name") in AGENT_TOOLS:
                # одно сообщение с несколькими вызовами приходит отдельными событиями — волна считается по сообщению
                launched_by_message.setdefault(message.get("id"), set()).add(block.get("id"))
        reads += [block for block in uses if block.get("name") == "Read"
                  and str((block.get("input") or {}).get("file_path", "")).endswith(".journal.txt")]
        for block in uses:  # ответы субагентов ведущий записывает как есть; merge потом убирает рабочую папку
            path = str((block.get("input") or {}).get("file_path", "")).replace("\\", "/")
            if block.get("name") == "Write" and path.endswith(".findings.txt"):
                written[path.rsplit("/", 1)[-1][: -len(".findings.txt")]] = str(block["input"].get("content", ""))
    waves = [len(ids) for ids in launched_by_message.values()]
    lines.append(f"субагентов запущено: {sum(waves)}, волн: {len(waves)}, самая большая волна: {max(waves, default=0)} (N = {parallel})")
    if max(waves, default=0) > parallel:
        problems.append(f"одновременно запущено {max(waves)} субагентов при N = {parallel}")
    if reads:
        problems.append(f"ведущий сам читал журналы: {len(reads)} раз")

    with open(os.path.join(SKILL, "reference", "session-quality.schema.json"), encoding="utf-8") as handle:
        out_schema = json.load(handle)
    for session_id in sorted(expected):
        base = os.path.join(sessions, f"{session_id}.quality")
        if not os.path.exists(base + ".json") or not os.path.exists(base + ".md"):
            problems.append(f"{session_id}: нет итога рядом с сессией (.quality.json и .quality.md)")
            continue
        with open(base + ".json", encoding="utf-8") as handle:
            doc = json.load(handle)
        errors = contract.check_document(doc, out_schema)
        if errors:
            problems.append(f"{session_id}: выход не проходит contract.py: {errors[:3]}")
        completion = next((item for item in doc.get("metrics", []) if item["id"] == "completion"), {})
        lines.append(f"{session_id}: оценена {'да' if doc['session']['scored'] else 'нет'}, скор {doc['session'].get('pct')}, "
                     f"сигналов фрода: {len(doc['fraud']['signals'])}"
                     + (", обрыв в конце сессии" if completion.get("end_break") else ""))
    strays = glob.glob(os.path.join(ws, "sessions", "*-quality"))
    if strays:
        problems.append(f"итог в отдельной папке вместо места рядом с сессиями: {strays}")

    if os.path.isdir(work):
        problems.append("рабочая папка не убрана после отчёта")
    with open(os.path.join(SKILL, "reference", "findings.schema.json"), encoding="utf-8") as handle:
        schema = json.load(handle)
    journals = tempfile.mkdtemp(prefix="sq-skill-journals-")  # те же журналы, что видели субагенты
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", sessions, "--out", journals])
    planted_ok = 0
    for session_id in sorted(expected):
        if session_id not in written:
            problems.append(f"{session_id}: нет ответа субагента")
            continue
        with open(os.path.join(journals, f"{session_id}.journal.txt"), encoding="utf-8") as handle:
            journal = handle.read()
        answer, notes, error = grade_brief.extract_json(written[session_id])
        failed, review = ([error], []) if error else grade_brief.grade_answer(session_id, answer, journal, expected[session_id], schema)
        planted_ok += not failed
        lines.append(f"{session_id}: {'PASS' if not failed else 'FAIL'}" + (f" ({'; '.join(notes)})" if notes else ""))
        lines += [f"    - {item}" for item in failed] + [f"    · {item}" for item in review]
    lines.append(f"заложенное найдено в {planted_ok}/{len(expected)} сессиях")
    verdict = "PASS" if not problems else "FAIL"
    report = "\n".join([f"Итог: {verdict}"] + [f"  - {item}" for item in problems] + lines + [f"Стоимость: ${cost:.2f}"]) + "\n"
    with open(os.path.join(run_dir, "SKILL-REPORT.txt"), "w", encoding="utf-8") as handle:
        handle.write(report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Прогон скилла session-quality на моках.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--parallel", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=2400)
    parser.add_argument("--grade-only", action="store_true", help="только оценить уже сделанный прогон")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    run_dir = os.path.normpath(os.path.join(run_brief.MOCK_RUNS, f"{date.today().isoformat()}-{cfg.name}"))
    if cfg.grade_only:
        print(grade(run_dir, cfg.parallel), end="")
        return 0
    if os.path.exists(run_dir):
        print(f"Папка прогона уже есть: {run_dir}", file=sys.stderr)
        return 2
    ws = os.path.join(run_dir, "ws")
    sessions = os.path.join(ws, "sessions", "user-01")
    os.makedirs(sessions)
    grade_brief.dump_expected(mocks.build(sessions), os.path.join(run_dir, "expected.json"))
    shutil.copytree(SKILL, os.path.join(ws, ".claude", "skills", "session-quality"),
                    ignore=shutil.ignore_patterns("__pycache__"))

    prompt = f"/session-quality sessions/user-01 --parallel {cfg.parallel}"
    command = [run_brief.claude_exe(), "-p", prompt, "--model", cfg.model,
               "--allowedTools", *ALLOWED_TOOLS, "--disallowedTools", *DENIED_TOOLS,
               "--output-format", "stream-json", "--verbose", "--no-session-persistence"]
    with open(os.path.join(run_dir, "RUN.txt"), "w", encoding="utf-8") as handle:
        handle.write(f"model: {cfg.model}\nparallel: {cfg.parallel}\nprompt: {prompt}\nallowed: {ALLOWED_TOOLS}\n")
    started = time.time()
    with open(os.path.join(run_dir, "stream.jsonl"), "w", encoding="utf-8") as out, \
            open(os.path.join(run_dir, "stderr.txt"), "w", encoding="utf-8") as err:
        try:
            subprocess.run(command, stdout=out, stderr=err, cwd=ws, timeout=cfg.timeout, encoding="utf-8")
        except subprocess.TimeoutExpired:
            err.write(f"таймаут {cfg.timeout} с\n")
    print(f"прогон: {time.time() - started:.0f} с")
    print(grade(run_dir, cfg.parallel), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
