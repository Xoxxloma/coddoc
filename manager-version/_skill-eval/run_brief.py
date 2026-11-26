#!/usr/bin/env python3
"""Прогон brief.md на фикстурах: сборка сессий → collect → модель по одной сессии за раз → оценка.

    python3 run_brief.py --name pilot --runs 1 --only bq-1
    python3 run_brief.py --name pool --runs 3

Модель получает brief.md системным промптом и сжатый журнал входом, без инструментов — как прямой вызов
модели без харнесса. Вызовы строго по одному (на проме однопоточка и 429). Оценка — только после того, как
закончились все вызовы. Стоимость — из total_cost_usd. Папка прогона: runs/<дата>-<имя>/.
"""

from __future__ import annotations

import argparse
import contextlib
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
REFERENCE = os.path.join(HERE, "..", "session-quality", "reference")
sys.path.insert(0, REFERENCE)
sys.path.insert(0, HERE)
import brief_fixtures  # noqa: E402
import collect  # noqa: E402
import grade_brief  # noqa: E402

# Моки — настоящие рабочие сессии: прогоны с ними и отчёты с цитатами живут вне Git.
MOCK_RUNS = os.path.join(HERE, "..", "..", "product", "session-quality", "runs")


def claude_exe():
    """Родной claude.exe напрямую: через claude.cmd задание с | < > и переводами строк портит cmd.exe."""
    if os.environ.get("SQ_CLAUDE"):
        return os.environ["SQ_CLAUDE"]
    shim = shutil.which("claude")
    if shim:
        native = os.path.join(os.path.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
        if os.path.exists(native):
            return native
    return shim


def main(argv=None):
    parser = argparse.ArgumentParser(description="Прогон brief.md на фикстурах brief_fixtures.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--only", default=None, help="id сессий через запятую")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--set", choices=("fixtures", "mocks", "holdout"), default="fixtures",
                        help="fixtures — синтетика brief_fixtures; mocks — настоящие сессии с заложенными случаями; "
                             "holdout — отложенный набор: другие сессии и случаи, по которым скилл не правят")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    runs_root = MOCK_RUNS if cfg.set in ("mocks", "holdout") else os.path.join(HERE, "runs")
    run_dir = os.path.normpath(os.path.join(runs_root, f"{date.today().isoformat()}-{cfg.name}"))
    if os.path.exists(run_dir):
        print(f"Папка прогона уже есть: {run_dir}", file=sys.stderr)
        return 2
    exe = claude_exe()
    if not exe:
        print("Не нашёл claude", file=sys.stderr)
        return 2
    sessions = os.path.join(run_dir, "sessions", cfg.set)
    responses = os.path.join(run_dir, "responses")
    os.makedirs(sessions)
    os.makedirs(responses)

    if cfg.set == "mocks":
        import mocks
        expected = mocks.build(sessions)
    elif cfg.set == "holdout":
        import mocks_holdout
        expected = mocks_holdout.build(sessions)
    else:
        expected = brief_fixtures.build(sessions)
    grade_brief.dump_expected(expected, os.path.join(run_dir, "expected.json"))
    screen = io.StringIO()
    with contextlib.redirect_stdout(screen):
        collect.main(["--sessions", sessions, "--out", os.path.join(run_dir, "out")])
    with open(os.path.join(run_dir, "collect.txt"), "w", encoding="utf-8") as handle:
        handle.write(screen.getvalue())

    with open(os.path.join(REFERENCE, "brief.md"), encoding="utf-8") as handle:
        brief = handle.read()
    selected = cfg.only.split(",") if cfg.only else list(expected)
    empty_cwd = tempfile.mkdtemp(prefix="sq-run-")  # без CLAUDE.md проекта
    with open(os.path.join(run_dir, "RUN.txt"), "w", encoding="utf-8") as handle:
        handle.write(f"model: {cfg.model}\nruns: {cfg.runs}\nsessions: {', '.join(selected)}\nexe: {exe}\n")

    for session_id in selected:
        with open(os.path.join(run_dir, "out", f"{session_id}.journal.txt"), encoding="utf-8") as handle:
            journal = handle.read()
        for run in range(1, cfg.runs + 1):
            command = [exe, "-p", "--model", cfg.model, "--tools", "", "--output-format", "json",
                       "--no-session-persistence", "--system-prompt", brief]
            started = time.time()
            try:
                done = subprocess.run(command, input="Журнал сессии:\n\n" + journal, capture_output=True,
                                      text=True, encoding="utf-8", timeout=cfg.timeout, cwd=empty_cwd)
                output, errors = done.stdout, done.stderr
            except subprocess.TimeoutExpired:
                output, errors = "", f"таймаут {cfg.timeout} с"
            base = os.path.join(responses, f"{session_id}-r{run}")
            with open(base + ".json", "w", encoding="utf-8") as handle:
                handle.write(output)
            if errors.strip():
                with open(base + ".err", "w", encoding="utf-8") as handle:
                    handle.write(errors)
            try:
                cost = float(json.loads(output).get("total_cost_usd") or 0)
            except ValueError:
                cost = 0.0
            print(f"{session_id} r{run}: ${cost:.3f}, {time.time() - started:.0f} с" + (" — ошибка CLI" if not output else ""))

    shutil.rmtree(empty_cwd, ignore_errors=True)
    print("")
    print(grade_brief.grade_run(run_dir), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
