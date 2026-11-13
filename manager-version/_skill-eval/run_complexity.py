#!/usr/bin/env python3
"""run_complexity — стенд замера сложности: прогоны агента-выписчика по заданию analyst-complexity/reference/prompts.py;
каждый документ из complexity-docs/ по N раз, ответы в runs/complexity/<папка прогонов>/<документ>/run-<n>/answer.json.

    python run_complexity.py [--runs 3] [--parallel 3] [--model claude-sonnet-5] [--only <документ>[,<документ>…]]
                             [--out runs]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "complexity-docs")
RUNS = os.path.join(HERE, "runs", "complexity")
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "analyst-complexity", "reference"))
import prompts  # noqa: E402
import score  # noqa: E402

ALLOWED_TOOLS = ["Read", "Glob", "Grep"]
DENIED_TOOLS = ["Write", "Edit", "Bash", "PowerShell", "NotebookEdit", "WebFetch", "WebSearch", "Agent"]


def claude_exe():
    """Родной claude.exe: через claude.cmd задание с переводами строк портит cmd.exe."""
    shim = shutil.which("claude")
    native = os.path.join(os.path.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
    return native if os.path.exists(native) else shim


def task(doc_name: str):
    """Вид документа и путь к нему от корня песочницы (complexity-docs/<документ>/target.txt), папка документа."""
    with open(os.path.join(DOCS, doc_name, "target.txt"), encoding="utf-8") as handle:
        path = handle.read().strip()
    kind = "spec" if path.endswith("technical_specification.md") else "bt"
    return kind, path, path.rsplit("/", 1)[0]


def one_run(doc_name: str, number: int, model: str, out: str) -> str:
    kind, path, folder = task(doc_name)
    run_dir = os.path.join(RUNS, out, doc_name, f"run-{number}")
    if os.path.exists(os.path.join(run_dir, "answer.json")):
        return f"{doc_name} run-{number}: уже есть"
    workspace = os.path.join(run_dir, "ws")
    shutil.rmtree(run_dir, ignore_errors=True)
    shutil.copytree(os.path.join(DOCS, doc_name, "coddoc"), os.path.join(workspace, "coddoc"))
    prompt = (prompts.SPEC if kind == "spec" else prompts.BT).format(path=path, folder=folder)
    command = [claude_exe(), "-p", prompt, "--model", model, "--allowedTools", *ALLOWED_TOOLS,
               "--disallowedTools", *DENIED_TOOLS, "--output-format", "json", "--no-session-persistence"]
    started = time.time()
    done = subprocess.run(command, cwd=workspace, capture_output=True, encoding="utf-8", timeout=900)
    with open(os.path.join(run_dir, "cli.json"), "w", encoding="utf-8") as handle:
        handle.write(done.stdout)
    with open(os.path.join(run_dir, "stderr.txt"), "w", encoding="utf-8") as handle:
        handle.write(done.stderr)
    try:
        cli = json.loads(done.stdout)
        answer = score.load_items(cli.get("result", ""))
    except (json.JSONDecodeError, ValueError) as error:
        return f"{doc_name} run-{number}: ответ не разобран ({error})"
    with open(os.path.join(run_dir, "answer.json"), "w", encoding="utf-8") as handle:
        json.dump({"cost_usd": cli.get("total_cost_usd"), "seconds": round(time.time() - started),
                   "model": model, "items": answer}, handle, ensure_ascii=False, indent=1)
    return f"{doc_name} run-{number}: {time.time() - started:.0f} с, ${cli.get('total_cost_usd') or 0:.2f}"


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--parallel", type=int, default=3)
    parser.add_argument("--model", default="claude-sonnet-5")
    parser.add_argument("--only", help="документы через запятую")
    parser.add_argument("--out", default="runs", help="папка прогонов внутри runs/complexity")
    args = parser.parse_args(argv)
    docs = args.only.split(",") if args.only else sorted(os.listdir(DOCS))
    jobs = [(doc, number) for doc in docs for number in range(1, args.runs + 1)]
    with ThreadPoolExecutor(args.parallel) as pool:
        for line in pool.map(lambda job: one_run(*job, args.model, args.out), jobs):
            print(line, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
