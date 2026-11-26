#!/usr/bin/env python3
"""compare_complexity — стенд замера сложности: класс по прогонам агента рядом с эталоном complexity_baseline.py
и разброс между прогонами.

    python compare_complexity.py [--runs runs]

Документы — complexity-docs/<документ>/target.txt, прогоны — runs/complexity/<папка прогонов>/<документ>/run-*/
answer.json (пишет run_complexity.py).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "complexity-docs")
RUNS = os.path.join(HERE, "runs", "complexity")
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "analyst-complexity", "reference"))
sys.path.insert(0, HERE)
import complexity_baseline  # noqa: E402
import document  # noqa: E402
import score  # noqa: E402


def main(argv=None):
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--runs", default="runs", help="папка прогонов внутри runs/complexity")
    args = parser.parse_args(argv)
    total_cost = 0.0
    for doc in sorted(os.listdir(DOCS)):
        answers = sorted(glob.glob(os.path.join(RUNS, args.runs, doc, "run-*", "answer.json")))
        if not answers:
            continue
        with open(os.path.join(DOCS, doc, "target.txt"), encoding="utf-8") as handle:
            path = os.path.join(DOCS, doc, handle.read().strip())
        kind = "spec" if path.endswith("technical_specification.md") else "bt"
        own_text = "\n".join(document.own_lines(path, kind, document.read_lines(path)))
        base_features, base_total, base_class, _ = complexity_baseline.assess(own_text, kind)
        runs = []
        for answer_path in answers:
            with open(answer_path, encoding="utf-8") as handle:
                answer = json.load(handle)
            result = score.assess(path, kind, answer["items"])
            runs.append((os.path.basename(os.path.dirname(answer_path)), result, answer.get("cost_usd") or 0))
            total_cost += answer.get("cost_usd") or 0
        codes = [feature[0] for feature in runs[0][1].features]
        print(f"\n{doc} ({kind})      " + "  ".join(f"{code:>6}" for code in codes) + "   класс   долг")
        print("  эталон      " + "  ".join(f"{str(f.value).replace('🟢', ''):>6}" for f in base_features)
              + f"   {base_class} ({base_total})")
        for run, result, cost in runs:
            print(f"  агент {run}" + "  ".join(f"{str(feature[2]):>6}" for feature in result.features)
                  + f"   {result.complexity_class} ({result.total})   {result.debt}   ${cost:.2f}"
                  + "".join(f"; {note}" for note in result.notes))
        moving = [code for index, code in enumerate(codes) if len({r.features[index][3] for _, r, _ in runs}) > 1]
        print(f"  разброс: класс {sorted({r.complexity_class for _, r, _ in runs})}, "
              f"баллы {sorted({r.total for _, r, _ in runs})}; признаки с разными баллами: {', '.join(moving) or 'нет'}")
        print(f"  строка результата: {runs[0][1].line()}")
    print(f"\nцена прогонов: ${total_cost:.2f}")


if __name__ == "__main__":
    main()
