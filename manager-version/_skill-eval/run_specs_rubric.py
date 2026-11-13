#!/usr/bin/env python3
"""Прогон рубрик specs-quality на случаях стенда: модель по одному документу → ответ JSON → оценка.

    python3 run_specs_rubric.py --name rubric-json --runs 1 --point-runs 2
    python3 run_specs_rubric.py --name rubric-json --grade-only

Модель получает рубрику системным промптом и текст документа (у спеки — и источника) входом, без инструментов —
как run_brief.py у session-quality. Оценка — только после того, как закончились все вызовы. Стоимость — из
total_cost_usd. Папка прогона: runs/<дата>-<имя>/.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import grade_specs_rubric  # noqa: E402
import specs_cases  # noqa: E402

RUBRICS = {kind: os.path.join(grade_specs_rubric.REFERENCE_DIR, f"rubric-{kind}.md") for kind in ("bt", "spec")}
# У specs-assess вторая часть задания — признаки сложности: идёт в системный промпт следом за рубрикой.
COMPLEXITY = {kind: os.path.join(grade_specs_rubric.REFERENCE_DIR, f"complexity-{kind}.md") for kind in ("bt", "spec")}


def claude_exe():
    """Как в run_brief.py (импорт оттуда тянет params session-quality): родной claude.exe — через claude.cmd
    задание с | < > и переводами строк портит cmd.exe."""
    if os.environ.get("SQ_CLAUDE"):
        return os.environ["SQ_CLAUDE"]
    shim = shutil.which("claude")
    if shim:
        native = os.path.join(os.path.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
        if os.path.exists(native):
            return native
    return shim


def message(case):
    if case["kind"] == "bt":
        return f"Файл: {case['path']}\n\n{case['text']}"
    head = f"Файл: {case['path']}\nИсточник требований: {case['source']}.\n\n=== {case['path']} ===\n\n{case['text']}"
    if case["source_text"]:
        head += f"\n\n=== {case['source']} ===\n\n{case['source_text']}"
    return head


def call(exe, model, rubric, case, cwd, timeout):
    command = [exe, "-p", "--model", model, "--tools", "", "--output-format", "json", "--no-session-persistence",
               "--system-prompt", rubric]
    started = time.time()
    try:
        done = subprocess.run(command, input=message(case), capture_output=True, text=True, encoding="utf-8",
                              timeout=timeout, cwd=cwd)
        return done.stdout, done.stderr, time.time() - started
    except subprocess.TimeoutExpired:
        return "", f"таймаут {timeout} с", time.time() - started


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description="Прогон рубрик specs-quality на случаях specs_cases.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--runs", type=int, default=1, help="прогонов на документ фикстуры")
    parser.add_argument("--point-runs", type=int, default=2, help="прогонов на точечный случай")
    parser.add_argument("--only", help="имена случаев через запятую")
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--grade-only", action="store_true")
    cfg = parser.parse_args(argv)

    run_dir = os.path.join(HERE, "runs", f"{date.today().isoformat()}-{cfg.name}")
    if cfg.grade_only:
        print(grade_specs_rubric.grade_run(run_dir), end="")
        return 0
    os.environ.setdefault("DISABLE_AUTOUPDATER", "1")  # обновление claude.exe посреди прогона роняет запуск процессов
    exe = claude_exe()
    if not exe:
        print("Не нашёл claude", file=sys.stderr)
        return 1
    responses = os.path.join(run_dir, "responses")
    os.makedirs(responses, exist_ok=True)
    rubrics = {}
    for kind, path in RUBRICS.items():
        with open(path, encoding="utf-8") as handle:
            rubrics[kind] = handle.read()
        shutil.copy(path, os.path.join(run_dir, os.path.basename(path)))  # снимок рубрики, которой получены числа
        if os.path.exists(COMPLEXITY[kind]):
            with open(COMPLEXITY[kind], encoding="utf-8") as handle:
                rubrics[kind] += "\n\n" + handle.read()
            shutil.copy(COMPLEXITY[kind], os.path.join(run_dir, os.path.basename(COMPLEXITY[kind])))

    only = set(cfg.only.split(",")) if cfg.only else None
    jobs = []
    for case in specs_cases.all_cases():
        if only and case["name"] not in only:
            continue
        runs = cfg.runs if case["reference"] else cfg.point_runs
        for run in range(1, runs + 1):  # уже есть непустой ответ — не повторяем: прогон продолжается с места обрыва
            done = os.path.join(responses, f"{case['name']}-r{run}.json")
            if not (os.path.exists(done) and os.path.getsize(done) > 0):
                jobs.append((case, run))
    with open(os.path.join(run_dir, "RUN.txt"), "w", encoding="utf-8") as handle:
        handle.write(f"model: {cfg.model}\nruns: {cfg.runs}, point-runs: {cfg.point_runs}\ncalls: {len(jobs)}\nexe: {exe}\n")

    empty_cwd = tempfile.mkdtemp(prefix="specs-run-")  # без CLAUDE.md проекта

    def one(job):
        case, run = job
        output, errors, seconds = call(exe, cfg.model, rubrics[case["kind"]], case, empty_cwd, cfg.timeout)
        base = os.path.join(responses, f"{case['name']}-r{run}")
        with open(base + ".json", "w", encoding="utf-8") as handle:
            handle.write(output)
        if errors.strip():
            with open(base + ".err", "w", encoding="utf-8") as handle:
                handle.write(errors)
        try:
            cost = float(json.loads(output).get("total_cost_usd") or 0)
        except ValueError:
            cost = 0.0
        print(f"{case['name']} r{run}: ${cost:.3f}, {seconds:.0f} с" + (" — ошибка CLI" if not output else ""), flush=True)

    with ThreadPoolExecutor(max_workers=max(1, cfg.parallel)) as pool:
        list(pool.map(one, jobs))
    shutil.rmtree(empty_cwd, ignore_errors=True)
    print("")
    print(grade_specs_rubric.grade_run(run_dir), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
