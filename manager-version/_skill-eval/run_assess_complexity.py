#!/usr/bin/env python3
"""run_assess_complexity — набор проб сложности через цепочку specs-assess: collect → субагент по заданию → merge.

    python run_assess_complexity.py [--runs 2] [--parallel 4] [--model claude-sonnet-5] [--only <документ>,…] [--out assess]
    python run_assess_complexity.py --compare [--out assess] [--pilot runs-v4,runs-v5,runs-v6]

Документы — complexity-docs/<документ>/ (target.txt — какой файл оценивать). На прогон — песочница с копией coddoc/ и
скилла в .claude/skills/specs-assess; субагент получает задание словами SKILL.md (шаг 2) и только Read, Glob, Grep.
Итог — runs/complexity/<out>/<документ>/run-<n>/result.json: выход merge (specs-quality/9), цена, время.
--compare: класс и баллы признаков рядом с прогонами пилота analyst-complexity (тот же документ, score.py).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "complexity-docs")
RUNS = os.path.join(HERE, "runs", "complexity")
SKILL = os.path.normpath(os.path.join(HERE, "..", "specs-assess"))
sys.path.insert(0, HERE)
from run_complexity import claude_exe, task  # noqa: E402

ALLOWED_TOOLS = ["Read", "Glob", "Grep"]
DENIED_TOOLS = ["Write", "Edit", "Bash", "PowerShell", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task"]


def subagent_prompt(task_path: str) -> str:
    """Задание субагенту — цитата из шага 2 SKILL.md с подставленным путём."""
    with open(os.path.join(SKILL, "SKILL.md"), encoding="utf-8") as handle:
        text = handle.read()
    quote = re.search(r"\(подставь полные пути\):\n\n((?:> .*\n)+)", text).group(1)
    prompt = " ".join(line[2:].strip() for line in quote.splitlines())
    return prompt.replace("`<работа>/<task>`", task_path)


def one_run(doc: str, number: int, model: str, out: str) -> str:
    kind, path, _folder = task(doc)
    run_dir = os.path.join(RUNS, out, doc, f"run-{number}")
    if os.path.exists(os.path.join(run_dir, "result.json")):
        return f"{doc} run-{number}: уже есть"
    shutil.rmtree(run_dir, ignore_errors=True)
    ws = os.path.join(run_dir, "ws")
    shutil.copytree(os.path.join(DOCS, doc, "coddoc"), os.path.join(ws, "coddoc"))
    os.makedirs(os.path.join(ws, ".git"))
    skill = os.path.join(ws, ".claude", "skills", "specs-assess")
    shutil.copytree(SKILL, skill, ignore=shutil.ignore_patterns("__pycache__"))
    python = [sys.executable, "-I"]
    done = subprocess.run(python + [os.path.join(skill, "reference", "collect.py"), "--input", path], cwd=ws,
                          capture_output=True, encoding="utf-8")
    work = next((line.split(": ", 1)[1] for line in done.stdout.splitlines() if line.startswith("Работа: ")), None)
    if not work:
        return f"{doc} run-{number}: collect не дал работу: {done.stdout} {done.stderr}"
    with open(os.path.join(work, "collect.json"), encoding="utf-8") as handle:
        meta = json.load(handle)["documents"][0]
    started = time.time()
    command = [claude_exe(), "-p", subagent_prompt(os.path.join(work, meta["task"])), "--model", model,
               "--allowedTools", *ALLOWED_TOOLS, "--disallowedTools", *DENIED_TOOLS, "--output-format", "json",
               "--no-session-persistence"]
    cli = subprocess.run(command, cwd=ws, capture_output=True, encoding="utf-8", timeout=1200)
    with open(os.path.join(run_dir, "cli.json"), "w", encoding="utf-8") as handle:
        handle.write(cli.stdout)
    try:
        answer = json.loads(cli.stdout)
    except json.JSONDecodeError:
        return f"{doc} run-{number}: ответ CLI не JSON: {cli.stderr[:200]}"
    with open(os.path.join(work, meta["answer"]), "w", encoding="utf-8") as handle:
        handle.write(answer.get("result") or "")
    check = subprocess.run(python + [os.path.join(skill, "reference", "merge.py"), "--work", work, "--check"], cwd=ws,
                           capture_output=True, encoding="utf-8").stdout
    merged = subprocess.run(python + [os.path.join(skill, "reference", "merge.py"), "--work", work], cwd=ws,
                            capture_output=True, encoding="utf-8")
    output_path = os.path.join(ws, meta["output"])
    output = json.load(open(output_path, encoding="utf-8")) if os.path.exists(output_path) else None
    result = {"cost_usd": answer.get("total_cost_usd"), "seconds": round(time.time() - started), "model": model,
              "check": check, "merge": merged.stdout + merged.stderr, "output": output}
    with open(os.path.join(run_dir, "result.json"), "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=1)
    if output is None:
        return f"{doc} run-{number}: merge не записал итог: {merged.stdout[-300:]}"
    complexity = output["document"]["complexity"]
    return (f"{doc} run-{number}: {result['seconds']} с, ${result['cost_usd'] or 0:.2f}, качество {output['document'].get('pct')}, "
            f"класс {complexity.get('class', '—')}")


def compare(out: str, pilots: list[str]) -> None:
    sys.path.insert(0, os.path.join(os.path.dirname(HERE), "analyst-complexity", "reference"))
    import score  # noqa: E402
    total_cost, outside = 0.0, []
    for doc in sorted(os.listdir(DOCS)):
        results = sorted(glob.glob(os.path.join(RUNS, out, doc, "run-*", "result.json")))
        if not results:
            continue
        kind, target, _folder = task(doc)
        path = os.path.join(DOCS, doc, target)
        base = []
        for pilot in pilots:
            for answer_path in sorted(glob.glob(os.path.join(RUNS, pilot, doc, "run-*", "answer.json"))):
                with open(answer_path, encoding="utf-8") as handle:
                    base.append(score.assess(path, kind, json.load(handle)["items"]))
        runs = []
        for result_path in results:
            with open(result_path, encoding="utf-8") as handle:
                result = json.load(handle)
            total_cost += result.get("cost_usd") or 0
            runs.append(result)
        print(f"\n{doc} ({kind})")
        if base:
            print(f"  пилот ({len(base)}): класс {sorted(r.complexity_class for r in base)}, баллы {sorted(r.total for r in base)}, "
                  f"признаки {[[f[3] for f in r.features] for r in base]}")
        for number, result in enumerate(runs, 1):
            document = result["output"]["document"] if result["output"] else None
            c = document["complexity"] if document else {"scored": False, "skip_reason": "нет итога"}
            if not c["scored"]:
                print(f"  run-{number}: сложность не оценена — {c['skip_reason']}")
                outside.append(f"{doc} run-{number}: не оценена")
                continue
            points = [f["points"] for f in c["factors"]]
            reasons = [e["reason"] for f in c["factors"] for e in f["excluded"]]
            excluded = [f"{reason}: {reasons.count(reason)}" for reason in sorted(set(reasons))]
            print(f"  run-{number}: класс {c['class']}, баллы {c['points']}, признаки {points}, долг {c['debt']}; "
                  f"качество {document['scored'] and document['pct']}; не засчитано: {', '.join(excluded) or 'нет'}")
            if base and not min(r.complexity_class for r in base) <= c["class"] <= max(r.complexity_class for r in base):
                outside.append(f"{doc} run-{number}: класс {c['class']} вне пилота {sorted({r.complexity_class for r in base})}")
    print(f"\nвне разброса пилота: {len(outside)}" + "".join(f"\n  {line}" for line in outside))
    print(f"цена прогонов: ${total_cost:.2f}")


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--parallel", type=int, default=4)
    parser.add_argument("--model", default="claude-sonnet-5")
    parser.add_argument("--only", help="документы через запятую")
    parser.add_argument("--out", default="assess")
    parser.add_argument("--compare", action="store_true")
    parser.add_argument("--pilot", default="runs-v4,runs-v5,runs-v6")
    args = parser.parse_args(argv)
    if args.compare:
        compare(args.out, args.pilot.split(","))
        return 0
    docs = args.only.split(",") if args.only else sorted(os.listdir(DOCS))
    jobs = [(doc, number) for doc in docs for number in range(1, args.runs + 1)]
    with ThreadPoolExecutor(args.parallel) as pool:
        for line in pool.map(lambda job: one_run(*job, args.model, args.out), jobs):
            print(line, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
