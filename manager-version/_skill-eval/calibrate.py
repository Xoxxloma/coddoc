#!/usr/bin/env python3
"""Калибровка скрипта на настоящих сессиях Claude Code владельца — без модели, $0.

    python3 calibrate.py --exclude <id текущей сессии> [--min-kb 20] [--params <файл>]

Берёт ~/.claude/projects/*/*.jsonl, кроме песочниц стенда (папки во временном каталоге) и исключённых id,
переводит (cc2qwen), гонит collect и печатает по оценённым сессиям распределения того, на чём стоят пороги и
кандидаты для модели: p10 / p50 / p75 / p90 / max против значений из params.json. Всё — в product/ (вне Git).
"""

from __future__ import annotations

import argparse
import contextlib
import glob
import io
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCE = os.path.join(HERE, "..", "session-quality", "reference")
sys.path.insert(0, REFERENCE)
sys.path.insert(0, HERE)
import cc2qwen  # noqa: E402
from export import to_export  # noqa: E402
import collect  # noqa: E402
import params  # noqa: E402

PROJECTS = os.path.expanduser("~/.claude/projects")
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "product", "session-quality", "calibration-cli"))


def entrypoint(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        for _ in range(40):
            line = handle.readline()
            if not line:
                break
            try:
                record = json.loads(line)
            except ValueError:
                continue
            if record.get("entrypoint"):
                return record["entrypoint"]
    return None


def pick(exclude, min_kb):
    """Только интерактивные сессии человека: `claude -p` (sdk-cli) — прогоны стенда, в т.ч. с двойником."""
    picked = []
    for path in sorted(glob.glob(os.path.join(PROJECTS, "*", "*.jsonl"))):
        project = os.path.basename(os.path.dirname(path))
        if "AppData" in project or "Temp" in project:
            continue  # песочницы прогонов стенда; к тому же пути там длиннее предела Windows
        name = os.path.basename(path)
        try:
            if any(name.startswith(prefix) for prefix in exclude) or os.path.getsize(path) < min_kb * 1024:
                continue
            if entrypoint(path) == "cli":
                picked.append(path)
        except OSError:
            continue
    return picked


def quantiles(values):
    if not values:
        return "—"
    values = sorted(values)

    def at(share):
        return values[min(len(values) - 1, int(round(share * (len(values) - 1))))]

    def fmt(value):
        return f"{value:.3g}" if isinstance(value, float) else str(value)

    return " / ".join(fmt(at(share)) for share in (0.1, 0.5, 0.75, 0.9)) + f" / {fmt(values[-1])}"


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--exclude", action="append", default=[])
    parser.add_argument("--min-kb", type=int, default=20)
    parser.add_argument("--params", default=None, help="файл параметров вместо reference/params.json")
    parser.add_argument("--context-window", type=int, default=1000000,
                        help="окно модели владельца: его сессии идут на модели с окном 1 млн, а не на прод-модели")
    cfg = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    p = params.load(cfg.params)
    sessions = os.path.join(OUT, "sessions-export", "owner")  # выгрузки, как на проде
    work = os.path.join(OUT, "work")
    os.makedirs(sessions, exist_ok=True)

    paths = pick(cfg.exclude, cfg.min_kb)
    for path in paths:
        stem = os.path.basename(path)[: -len(".jsonl")]
        target = os.path.join(sessions, f"{stem}.json")
        if not os.path.exists(target):
            export, _mapping = to_export(list(enumerate(cc2qwen.convert(cc2qwen.read_cc(path)), 1)), stem)
            with open(target, "w", encoding="utf-8") as handle:
                json.dump(export, handle, ensure_ascii=False)
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", sessions, "--out", work, "--context-window", str(cfg.context_window)]
                     + (["--params", cfg.params] if cfg.params else []))
    summary = json.load(open(os.path.join(work, "collect.json"), encoding="utf-8"))
    facts = [json.load(open(os.path.join(work, item["facts"]), encoding="utf-8")) for item in summary["sessions"]]
    scored = [item for item in facts if item["scored"]]

    rows = []
    min_turns, journal_limit = params.value(p, "min_user_turns"), params.value(p, "journal_limit")
    reading, human = params.value(p, "reading_speed"), params.value(p, "human_speed")
    loaded_share = params.value(p, "loaded_context_share")
    fast_min, repeat_min = params.value(p, "autoinput_fast_min"), params.value(p, "autoinput_repeat_min")

    def row(name, values, current=""):
        rows.append(f"| {name} | {len(values)} | {quantiles(values)} | {current} |")

    def norm(metric_id, note=""):
        good, bad, _weight = params.metric(p, metric_id)
        return f"good {good:g} / bad {bad:g}" + note

    def loaded(run):
        return (run["context_share_before"] or 0) > loaded_share or run["after_compression"]

    with_runs = [f for f in scored if f["runs"]]
    with_decisions = [f for f in scored if f["decisions"]]
    runs = [run for f in scored for run in f["runs"]]
    row("реплик пользователя", [f["user_turns"] for f in scored], f"оценка от {min_turns}")
    row("длительность, мин", [round(f["duration_sec"] / 60) for f in scored])
    row("доля реплик внутри запусков скиллов", [round(sum(r["user_turns"] for r in f["runs"]) / f["user_turns"], 3) for f in scored],
        norm("skill_share"))
    row("запусков, кончившихся вопросом агента без ответа / запусков",
        [round(sum(r["question"] is not None for r in f["runs"]) / len(f["runs"]), 3) for f in with_runs],
        "справочно: обрывы до вердикта модели")
    row("контекст перед вызовом скилла, доля окна (по запускам)",
        [run["context_share_before"] for run in runs if run["context_share_before"] is not None], f"нагружен выше {loaded_share:g}")
    row("нагруженных запусков / запусков", [round(sum(loaded(r) for r in f["runs"]) / len(f["runs"]), 3) for f in with_runs],
        norm("loaded_context"))
    row("пик контекста, доля окна", [f["context"]["peak_share"] for f in scored if f["context"]["peak_share"] is not None],
        "справочно")
    row("сжатий на сессию", [len(f["compressions"]) for f in scored], "справочно")
    row("мест решения на сессию", [len(f["decisions"]) for f in scored])
    row("скорость ответа на место решения, симв./с (по местам)",
        [d["speed"] for f in scored for d in f["decisions"] if d["speed"] is not None], f"чтение {reading:g}, человек {human:g}")
    row("мест решения быстрее чтения / мест решения",
        [round(sum(1 for d in f["decisions"] if d["speed"] is not None and d["speed"] > reading) / len(f["decisions"]), 3)
         for f in with_decisions], norm("blind_confirms", " (до вердикта модели)"))
    row("ответов быстрее человека на сессию", [len(f["fast"]) for f in scored], f"автоввод от {fast_min:g}")
    row("самая длинная серия одинаковых реплик", [max((s["count"] for s in f["repeat_streaks"]), default=0) for f in scored],
        f"автоввод от {repeat_min:g}")
    row("строк «Проверить» на сессию", [len(f["checks"]) for f in scored])
    row("ошибок API", [f["environment"]["api_errors"] for f in scored])

    autoinput_fast = sum(1 for f in scored if len(f["fast"]) >= fast_min)
    autoinput_repeat = sum(1 for f in scored if any(s["count"] >= repeat_min for s in f["repeat_streaks"]))

    report = [
        f"Сессий взято: {len(paths)}; оценено (≥ {min_turns} реплик): {len(scored)}; коротких: {len(facts) - len(scored)}",
        f"Журналов длиннее {journal_limit} симв.: {sum(f['journal']['oversize'] for f in scored)} из {len(scored)}",
        "",
        "| Величина | n | p10 / p50 / p75 / p90 / max | сейчас |",
        "|---|---|---|---|",
        *rows,
        "",
        f"Автоввод: сессий с ответами быстрее человека ≥ {fast_min:g} — {autoinput_fast}; "
        f"с серией одинаковых реплик ≥ {repeat_min:g} — {autoinput_repeat}",
    ]
    text = "\n".join(report) + "\n"
    with open(os.path.join(OUT, "CALIBRATION.txt"), "w", encoding="utf-8") as handle:
        handle.write(text)
    print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
