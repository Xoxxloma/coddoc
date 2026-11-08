#!/usr/bin/env python3
"""Прогон скилла retro целиком: ведущий агент по SKILL.md на синтетических сессиях с заложенными случаями.

    python3 run_retro.py --name pilot [--model sonnet]
    python3 run_retro.py --name pilot --grade-only

Папка прогона — product/retro/runs/<дата>-<имя> (вне Git): ws/ — папка проекта, скилл в ws/.claude/skills/retro;
sessions/ — журналы чата (retro_mocks), cwd в них — ws. Ведущий запускается через `claude -p "/retro <sessions>"`
только с инструментами скилла. Оценка — после прогона, по файлам и потоку событий:
  - субагенты строго по одному, ведущий журналы сам не читал, рабочая папка убрана;
  - ответы субагентов, которые ведущий записал, сверяются заново (prepare + merge на тех же журналах): заложенные
    пары (признак, сторона) найдены, запрещённых нет, привычки в нужном числе сессий;
  - отчёт в чат: есть «попробовать», названа слабая модель, нет баллов, нет номеров сессий; работа на загруженном
    контексте и работа вне скиллов названы, если они в первых пяти «мешает».
Стоимость — total_cost_usd.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.normpath(os.path.join(HERE, "..", "retro"))
RUNS = os.path.normpath(os.path.join(HERE, "..", "..", "product", "retro", "runs"))
sys.path.insert(0, os.path.join(SKILL, "reference"))
sys.path.insert(0, HERE)
import merge  # noqa: E402
import prepare  # noqa: E402
import retro_mocks  # noqa: E402

AGENT_TOOLS = ("Agent", "Task")
ALLOWED_TOOLS = ["Read", "Write", "Agent", "Task", "Bash(python:*)", "Bash(python3:*)"]
DENIED_TOOLS = ["WebFetch", "WebSearch", "Edit", "NotebookEdit", "Glob", "Grep"]
SCORE_WORDS = ("балл", "скор", "оценка:")
# Запись ответа командой: cat > ".../<задание>.findings.txt" <<'EOF' … EOF — так пишет ведущий, если Write недоступен.
HEREDOC_RE = re.compile(r"""cat\s*>\s*["']?[^"'\n]*?([\w.-]+\.findings\.txt)["']?\s*<<\s*-?["']?(\w+)["']?\n(.*?)\n\2\b""",
                        re.DOTALL)


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


def read_stream(path):
    events = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    return events


def load_expected(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    for item in data["sessions"].values():
        # пара — [признак, сторона]; список пар — годится любая
        item["must"] = [tuple(pair) if isinstance(pair[0], str) else [tuple(one) for one in pair] for pair in item["must"]]
        item["must_not"] = [tuple(pair) for pair in item["must_not"]]
    data["habits"] = {tuple(key.split("|")): count for key, count in data["habits"].items()}
    return data


def dump_expected(expected, path):
    data = dict(expected, habits={"|".join(key): count for key, count in expected["habits"].items()})
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def regrade(run_dir, written):
    """Те же журналы заново (prepare детерминирован) + ответы, которые записал ведущий → merge → моменты."""
    work = tempfile.mkdtemp(prefix="retro-regrade-")
    with contextlib.redirect_stdout(io.StringIO()):
        prepare.main(["--sessions", os.path.join(run_dir, "sessions"), "--project", os.path.join(run_dir, "ws"), "--out", work])
    for name, content in written.items():
        with open(os.path.join(work, name), "w", encoding="utf-8") as handle:
            handle.write(content)
    with contextlib.redirect_stdout(io.StringIO()):
        merge.main(["--work", work])
    with open(os.path.join(work, "moments.json"), encoding="utf-8") as handle:
        moments = json.load(handle)
    with open(os.path.join(work, "merge-log.txt"), encoding="utf-8") as handle:
        log = handle.read().splitlines()
    shutil.rmtree(work, ignore_errors=True)
    return moments, log


def grade(run_dir):
    expected = load_expected(os.path.join(run_dir, "expected.json"))
    events = read_stream(os.path.join(run_dir, "stream.jsonl"))
    lines, problems = [], []
    result = next((event for event in reversed(events) if event.get("type") == "result"), {})
    cost = float(result.get("total_cost_usd") or 0)
    if result.get("subtype") != "success" or result.get("is_error"):
        problems.append(f"прогон сорвался: {result.get('subtype')}")

    waves, reads, written = {}, [], {}
    for event in events:
        if event.get("type") != "assistant" or event.get("parent_tool_use_id"):
            continue  # события субагентов идут в том же потоке — считаем только ведущего
        message = event.get("message") or {}
        uses = [block for block in message.get("content") or [] if block.get("type") == "tool_use"]
        for block in uses:
            data = block.get("input") or {}
            path = str(data.get("file_path", "")).replace("\\", "/")
            if block.get("name") in AGENT_TOOLS:
                waves.setdefault(message.get("id"), set()).add(block.get("id"))
            elif block.get("name") == "Read" and path.endswith(".journal.txt"):
                reads.append(path)
            elif block.get("name") == "Write" and path.endswith(".findings.txt"):
                written[path.rsplit("/", 1)[-1]] = str(data.get("content", ""))
            elif block.get("name") == "Bash":
                for name, _end, body in HEREDOC_RE.findall(str(data.get("command", ""))):
                    written[name] = body
    sizes = [len(ids) for ids in waves.values()]
    lines.append(f"субагентов: {sum(sizes)}, самая большая волна: {max(sizes, default=0)}; ответов записано: {len(written)}")
    if max(sizes, default=0) > 1:
        problems.append(f"субагенты не по одному: волна из {max(sizes)}")
    if reads:
        problems.append(f"ведущий сам читал журналы: {len(reads)} раз")
    if os.path.isdir(os.path.join(os.path.realpath(tempfile.gettempdir()), "retro-work")):
        problems.append("рабочая папка retro-work не убрана")

    moments, log = regrade(run_dir, written)
    found = {}
    for group in moments["groups"]:
        for moment in group["moments"]:
            found.setdefault(moment["session"], set()).add((group["sign"], group["side"]))
    must_total = must_ok = bad = 0
    for session, item in expected["sessions"].items():
        have = found.get(session, set())
        missed = [pair for pair in item["must"] if not (pair in have if isinstance(pair, tuple) else set(pair) & have)]
        wrong = [pair for pair in item["must_not"] if pair in have]
        must_total += len(item["must"])
        must_ok += len(item["must"]) - len(missed)
        bad += len(wrong)
        lines.append(f"{session}: найдено {len(item['must']) - len(missed)}/{len(item['must'])}"
                     + (f"; пропущено: {missed}" if missed else "") + (f"; лишнее: {wrong}" if wrong else ""))
    groups = {(group["sign"], group["side"]): group["sessions"] for group in moments["groups"]}
    for key, count in expected["habits"].items():
        if groups.get(key, 0) < count:
            problems.append(f"привычка {key}: в {groups.get(key, 0)} сессиях, ждали от {count}")
    if len(moments["analysed"]) != expected["analysed"]:
        problems.append(f"разобрано сессий {len(moments['analysed'])}, ждали {expected['analysed']}")
    dropped = sum(1 for line in log if "цитата не нашлась" in line)
    kept = sum(len(group["moments"]) for group in moments["groups"])
    lines.append(f"заложенное найдено: {must_ok}/{must_total}; запрещённых пар: {bad}; моментов: {kept}, "
                 f"отброшено выдуманных цитат: {dropped}")
    if must_ok < must_total * 0.8:
        problems.append(f"заложенного найдено меньше 80 %: {must_ok}/{must_total}")
    if bad:
        problems.append(f"запрещённых пар: {bad}")

    # Отчёт — самое длинное сообщение ведущего: после него ведущий может ещё убрать папку и коротко подвести итог.
    texts = [block.get("text", "") for event in events if event.get("type") == "assistant" and not event.get("parent_tool_use_id")
             for block in (event.get("message") or {}).get("content") or [] if block.get("type") == "text"]
    report = max(texts + [str(result.get("result") or "")], key=len)
    low = report.casefold()
    checks = {"есть «попробовать»": "попробовать" in low, "названа слабая модель": "qwen-3.6b" in low,
              "нет баллов": not any(word in low for word in SCORE_WORDS)}
    # «Что мешает» — первые пять групп «мешает» по K (порядок merge), без «чего нет в контексте» и «другого».
    top = [group["sign"] for group in moments["groups"]
           if group["side"] == "hurts" and group["sign"] not in ("context_gap", "other")][:5]
    for sign, name, stem in (("loaded_work", "работа на загруженном контексте", "загруженн"),
                             ("outside_skills", "работа вне скиллов", "вне скилл")):
        if sign in top:
            checks[f"названа {name}"] = stem in low
    checks["нет номеров сессий"] = not re.search(r"сесси[яиюей]\s+p\d+\b", low)
    lines.append("отчёт: " + ", ".join(f"{name} — {'да' if ok else 'НЕТ'}" for name, ok in checks.items()))
    problems += [f"отчёт: {name} — нет" for name, ok in checks.items() if not ok]
    with open(os.path.join(run_dir, "report.md"), "w", encoding="utf-8") as handle:
        handle.write(report)
    verdict = "PASS" if not problems else "FAIL"
    text = "\n".join([f"Итог: {verdict}"] + [f"  - {item}" for item in problems] + lines + [f"Стоимость: ${cost:.2f}"]) + "\n"
    with open(os.path.join(run_dir, "SKILL-REPORT.txt"), "w", encoding="utf-8") as handle:
        handle.write(text)
    return text


def main(argv=None):
    parser = argparse.ArgumentParser(description="Прогон скилла retro на синтетических сессиях.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--timeout", type=int, default=2400)
    parser.add_argument("--grade-only", action="store_true", help="только оценить уже сделанный прогон")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    run_dir = os.path.join(RUNS, f"{date.today().isoformat()}-{cfg.name}")
    if cfg.grade_only:
        print(grade(run_dir), end="")
        return 0
    if os.path.exists(run_dir):
        print(f"Папка прогона уже есть: {run_dir}", file=sys.stderr)
        return 2
    ws = os.path.join(run_dir, "ws")
    sessions = os.path.join(run_dir, "sessions")
    os.makedirs(ws)
    dump_expected(retro_mocks.build(os.path.join(sessions, "proj", "chats"), ws), os.path.join(run_dir, "expected.json"))
    shutil.copytree(SKILL, os.path.join(ws, ".claude", "skills", "retro"), ignore=shutil.ignore_patterns("__pycache__"))
    prompt = f"/retro {sessions}"
    command = [claude_exe(), "-p", prompt, "--model", cfg.model, "--allowedTools", *ALLOWED_TOOLS,
               "--disallowedTools", *DENIED_TOOLS, "--output-format", "stream-json", "--verbose", "--no-session-persistence"]
    with open(os.path.join(run_dir, "RUN.txt"), "w", encoding="utf-8") as handle:
        handle.write(f"model: {cfg.model}\nprompt: {prompt}\nallowed: {ALLOWED_TOOLS}\n")
    started = time.time()
    with open(os.path.join(run_dir, "stream.jsonl"), "w", encoding="utf-8") as out, \
            open(os.path.join(run_dir, "stderr.txt"), "w", encoding="utf-8") as err:
        try:
            subprocess.run(command, stdout=out, stderr=err, cwd=ws, timeout=cfg.timeout, encoding="utf-8")
        except subprocess.TimeoutExpired:
            err.write(f"таймаут {cfg.timeout} с\n")
    print(f"прогон: {time.time() - started:.0f} с")
    print(grade(run_dir), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
