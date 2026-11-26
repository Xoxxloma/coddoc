#!/usr/bin/env python3
"""Перепроверка фрода на готовом прогоне brief: задания по находкам фрода из ответов, вызовы модели, перегрейд.

    python3 verify_run.py <папка прогона> [--model sonnet]

Ответы прогона не меняются: рядом пишется <папка>-verified/ — те же журналы и ожидания, ответы без находок фрода,
которые перепроверка не подтвердила (как сделает merge), задания и ответы перепроверки в verify/ и GRADE-REPORT.txt.
Вызовы по одному, задание — системным промптом, без инструментов, как у run_brief. Стоимость — total_cost_usd.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCE = os.path.join(HERE, "..", "session-quality", "reference")
sys.path.insert(0, REFERENCE)
sys.path.insert(0, HERE)
import grade_brief  # noqa: E402
import run_brief  # noqa: E402
import verify  # noqa: E402
from merge import FINDINGS_SCHEMA_PATH, extract_json  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description="Перепроверка фрода на готовом прогоне brief.")
    parser.add_argument("run_dir")
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--timeout", type=int, default=300)
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    run_dir = os.path.normpath(cfg.run_dir)
    out_dir = run_dir + "-verified"
    if os.path.exists(out_dir):
        print(f"Папка уже есть: {out_dir}", file=sys.stderr)
        return 2
    for folder in ("responses", "verify"):
        os.makedirs(os.path.join(out_dir, folder))
    shutil.copytree(os.path.join(run_dir, "out"), os.path.join(out_dir, "out"))
    shutil.copy(os.path.join(run_dir, "expected.json"), os.path.join(out_dir, "expected.json"))
    with open(FINDINGS_SCHEMA_PATH, encoding="utf-8") as handle:
        schema = json.load(handle)
    exe = run_brief.claude_exe()
    empty_cwd = tempfile.mkdtemp(prefix="sq-verify-")
    cost, calls, dropped = 0.0, 0, 0
    for name in sorted(os.listdir(os.path.join(run_dir, "responses"))):
        if not name.endswith(".json"):
            continue
        session_id = name.rsplit("-r", 1)[0]
        with open(os.path.join(run_dir, "responses", name), encoding="utf-8") as handle:
            raw_envelope = handle.read()
        try:
            envelope = json.loads(raw_envelope)
        except ValueError:
            shutil.copy(os.path.join(run_dir, "responses", name), os.path.join(out_dir, "responses", name))
            continue
        raw = str(envelope.get("result", ""))
        with open(os.path.join(run_dir, "out", f"{session_id}.journal.txt"), encoding="utf-8") as handle:
            journal = handle.read()
        drop = set()
        for task, text in verify.tasks_for(session_id, raw, journal, schema):
            command = [exe, "-p", "--model", cfg.model, "--tools", "", "--output-format", "json",
                       "--no-session-persistence", "--system-prompt", text]
            try:
                done = subprocess.run(command, input="Вердикт по реплике из задания:", capture_output=True, text=True,
                                      encoding="utf-8", timeout=cfg.timeout, cwd=empty_cwd)
                output = done.stdout
            except subprocess.TimeoutExpired:
                output = ""
            calls += 1
            base = os.path.join(out_dir, "verify", f"{name[:-len('.json')]}__{task}")
            with open(base, "w", encoding="utf-8") as handle:
                handle.write(text)
            with open(base + ".answer.json", "w", encoding="utf-8") as handle:
                handle.write(output)
            try:
                answer_envelope = json.loads(output)
                cost += float(answer_envelope.get("total_cost_usd") or 0)
                verdict = verify.verdict_of(str(answer_envelope.get("result", "")))
            except ValueError:
                verdict = None
            if verdict == "no":
                _session, kind, turn = task[:-len(".md")].rsplit("__", 2)
                drop.add((kind, int(turn)))
        answer, _notes, error = extract_json(raw)
        if drop and not error:
            answer["findings"] = [item for item in answer["findings"]
                                  if not (isinstance(item, dict) and (item.get("type"), item.get("turn")) in drop)]
            envelope["result"] = json.dumps(answer, ensure_ascii=False)
            dropped += len(drop)
        with open(os.path.join(out_dir, "responses", name), "w", encoding="utf-8") as handle:
            json.dump(envelope, handle, ensure_ascii=False)
    shutil.rmtree(empty_cwd, ignore_errors=True)
    report = grade_brief.grade_run(out_dir)
    print(report, end="")
    print(f"Перепроверок: {calls}, снято находок: {dropped}, стоимость перепроверок: ${cost:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
