#!/usr/bin/env python3
"""Прогон скилла specs-quality целиком: ведущий агент по SKILL.md на фикстуре SQ-AUDIT + случай E.

    python3 run_specs.py --name lead-pilot --parallel 5
    python3 run_specs.py --name lead-pilot --grade-only

Песочница: runs/<дата>-<имя>/run-01/ — coddoc/ фикстуры, папка PSS-2290 (случай E: хороший БТ без критериев
приёмки), скилл — в .claude/skills/specs-quality; в песочнице своя .git — корнем итога становится она. Ведущий
запускается через `claude -p "/specs-quality coddoc/ …"` в обычном режиме разрешений и только с теми инструментами,
что нужны скиллу, — как run_skill.py у session-quality. Оценка — после завершения прогона, по файлам: рядом с каждым
документом выход <имя>.quality.json, каждый проходит contract.py, work/ убрана, документы coddoc/ не тронуты, ответов
субагентов столько же, сколько документов, волны ≤ N, ведущий документы сам не читал; содержание — проверки
grade-sq.mjs стенда sdd-quality-audit по выходам и случай E. Стоимость — total_cost_usd.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.normpath(os.path.join(HERE, "..", "specs-quality"))
sys.path.insert(0, os.path.join(SKILL, "reference"))
sys.path.insert(0, HERE)
import contract  # noqa: E402
import params  # noqa: E402
import specs_cases  # noqa: E402
from run_specs_rubric import claude_exe  # noqa: E402

AGENT_TOOLS = ("Agent", "Task")
ALLOWED_TOOLS = ["Read", "Write", "Glob", "Agent", "Task", "Bash(python:*)", "Bash(python3:*)"]
DENIED_TOOLS = ["WebFetch", "WebSearch", "Edit", "NotebookEdit"]
PROMPT = "/specs-quality coddoc/ pss --parallel {parallel}"
BT, SPEC = "business_requirements.md", "technical_specification.md"
IN_FORM = ["PSS-2210", "PSS-2211", "PSS-2212", "PSS-2213", "ARS-312"]
BY_SKILL = ["PSS-2210", "PSS-2212", "PSS-2213", "PSS-2214", "ARS-312"]


def digest(folder):
    """Отпечатки документов; выходы скилла <имя>.quality.json — не документы."""
    out = {}
    for path in sorted(glob.glob(os.path.join(folder, "**", "*"), recursive=True)):
        if os.path.isfile(path) and not path.endswith(".quality.json"):
            with open(path, "rb") as handle:
                out[os.path.relpath(path, folder)] = hashlib.sha256(handle.read()).hexdigest()
    return out


def read_stream(path):
    events = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
    return events


def content_checks(doc):
    """Проверки grade-sq.mjs по документам выходов specs-quality/8 + случай E. doc — {"documents": [...]}. → {имя: True/False}.
    Хороший документ — по потере баллов критериев (вес − балл), а не по проценту: процент зависит от максимума и
    округления, полнота структуры в потерю не входит."""
    docs = {d["path"]: d for d in doc["documents"]}

    def d(folder, kind):
        return docs.get(f"coddoc/{folder}/{BT if kind == 'bt' else SPEC}")

    def pct(item):
        return item["pct"] if item and item["scored"] and item["pct"] is not None else -1

    weights = {kind: params.weights(params.load(), kind) for kind in params.KINDS}

    def loss(item):
        if not item or not item["scored"]:
            return float("inf")
        return sum(weights[item["kind"]][k] - v for k, v in item["criteria"].items() if v is not None)

    def score(item, number):
        return list(item["criteria"].values())[number] if item and item["scored"] else None

    def attention(folder):
        return any(x and x["scored"] and x["attention"] for x in (d(folder, "bt"), d(folder, "spec")))

    def flag(item):
        return bool(item and item["scored"] and item["template"])

    def off(item):
        return bool(item and item["scored"] and "off_structure" in item["attention"])

    def origin(item):
        return item["origin"] if item and item["scored"] else None

    ck = {}
    ck["строки"] = len({path.rsplit("/", 1)[0] for path in docs}) == 12 and len(docs) == 19
    bug, fnd = d("ARS-312", "spec"), d("ARS-100/_foundation", "spec")
    ck["н/п"] = (bool(bug and bug["source"] == "coddoc/ARS-312/bug_report.md" and not d("ARS-312", "bt")) and
                 bool(fnd and fnd["source"] is None and not d("ARS-100/_foundation", "bt")) and
                 not d("PSS-2211", "spec") and not d("ARS-100", "spec"))
    ck["оценено всё"] = all(x["scored"] for x in doc["documents"])
    p10b, p10s = d("PSS-2210", "bt"), d("PSS-2210", "spec")
    ck["хорошая"] = loss(p10b) <= 1 and loss(p10s) <= 0.5
    p11 = d("PSS-2211", "bt")
    ck["версия"] = loss(p11) <= 1 and loss(p10b) <= 1 and abs(loss(p11) - loss(p10b)) <= 1
    p12b, p12s = d("PSS-2212", "bt"), d("PSS-2212", "spec")
    planted = p12s and any(score(p12s, i) is not None and score(p12s, i) <= 0.5 for i in (1, 2, 4))
    off_target = not p12s or any(score(p12s, i) is not None and score(p12s, i) < 1 for i in (0, 3))
    ck["частичная"] = bool(p12b and score(p12b, 3) is not None and score(p12b, 3) <= 0.5 and planted and not off_target and
                           pct(p12b) >= 50 and pct(p12s) >= 50)
    p13b, p13s = d("PSS-2213", "bt"), d("PSS-2213", "spec")
    ck["протыкано"] = all(x and x["scored"] and {"template", "zero"} <= set(x["attention"]) for x in (p13b, p13s))
    ck["багфикс"] = bool(bug and pct(bug) >= 80 and sum(1 for i in (1, 2, 4) if score(bug, i) is None) >= 2)  # оценён, None — «н/п»
    ck["фундамент"] = bool(fnd and fnd["scored"] and score(fnd, 0) is None)
    ck["внимание"] = (all(attention(k) for k in ("PSS-2213", "PSS-2214", "PSS-2215", "PSS-2216")) and
                      not any(attention(k) for k in ("PSS-2210", "PSS-2211", "PSS-2212", "ARS-312")))
    ck["флаг"] = not any(flag(d(k, kind)) for k in ("PSS-2210", "PSS-2211", "PSS-2212", "ARS-312", "PSS-2214", "PSS-2215", "PSS-2216")
                         for kind in ("bt", "spec"))
    ck["форма"] = (off(d("PSS-2214", "bt")) and not off(d("PSS-2214", "spec")) and
                   not any(off(d(k, kind)) for k in IN_FORM for kind in ("bt", "spec")) and
                   off(d("PSS-2215", "spec")) and off(d("PSS-2216", "spec")) and not off(d("PSS-2216", "bt")))
    ck["свободная"] = loss(d("PSS-2214", "bt")) <= 0.5  # неполная структура задумана — в потерю не входит
    ck["по коду"] = origin(d("PSS-2215", "spec")) == "by_code" and not any(origin(d(k, "spec")) == "by_code" for k in BY_SKILL + ["PSS-2216"])
    ck["правлена"] = origin(d("PSS-2216", "spec")) == "skill_edited" and all(origin(d(k, "spec")) == "skill" for k in BY_SKILL)
    p15 = d("PSS-2215", "spec")
    ck["без источника"] = bool(p15 and p15["source"] is None and not d("PSS-2215", "bt") and score(p15, 0) == 0)
    by_author = {}
    for item in doc["documents"]:
        by_author.setdefault(item["author"], []).append(item)
    ck["авторы"] = (set(by_author) == {"ivanova.ma", None} and [x["kind"] for x in by_author["ivanova.ma"]] == ["bt"] * 3 and
                    len(by_author[None]) == 16)  # PSS-2211, 2214, 2216 БТ — ivanova.ma
    ck["репозиторий"] = all(item["repo"] == "pss" for item in doc["documents"])
    e_bt, e_spec = d("PSS-2290", "bt"), d("PSS-2290", "spec")
    ck["случай E: только ноль"] = bool(e_bt and e_bt["scored"] and e_bt["attention"] == ["zero"] and pct(e_bt) >= 50 and
                                       e_spec and e_spec["scored"] and not e_spec["attention"])
    return ck


def grade(run_dir, parallel):
    ws = os.path.join(run_dir, "run-01")
    events = read_stream(os.path.join(run_dir, "stream.jsonl"))
    lines, problems = [], []
    result = next((e for e in reversed(events) if e.get("type") == "result"), {})
    cost = float(result.get("total_cost_usd") or 0)
    if result.get("subtype") != "success" or result.get("is_error"):
        problems.append(f"прогон сорвался: {result.get('subtype')} {str(result.get('result', ''))[:200]}")

    launched, doc_reads, written, checked = {}, [], 0, 0
    for event in events:
        if event.get("type") != "assistant" or event.get("parent_tool_use_id"):
            continue  # события субагентов идут в том же потоке — считаем только ведущего
        message = event.get("message") or {}
        for block in [b for b in message.get("content") or [] if b.get("type") == "tool_use"]:
            path = str((block.get("input") or {}).get("file_path", "")).replace("\\", "/")
            if block.get("name") == "Bash" and "--check" in str((block.get("input") or {}).get("command", "")):
                checked += 1
            if block.get("name") in AGENT_TOOLS:
                launched.setdefault(message.get("id"), set()).add(block.get("id"))
            if block.get("name") == "Read" and "/coddoc/" in path:
                doc_reads.append(path)
            if block.get("name") == "Write" and path.endswith(".findings.txt"):
                written += 1
    waves = [len(ids) for ids in launched.values()]
    lines.append(f"субагентов: {sum(waves)}, волн: {len(waves)}, самая большая: {max(waves, default=0)} (N = {parallel}); "
                 f"ответов записано: {written}; проверок --check: {checked}")
    if not checked:
        problems.append("ведущий не вызвал merge.py --check")
    if max(waves, default=0) > parallel:
        problems.append(f"одновременно запущено {max(waves)} субагентов при N = {parallel}")
    if doc_reads:
        problems.append(f"ведущий сам читал документы: {len(doc_reads)} раз")
    with open(os.path.join(run_dir, "coddoc.sha256.json"), encoding="utf-8") as handle:
        if json.load(handle) != digest(os.path.join(ws, "coddoc")):
            problems.append("coddoc/ изменена")
    if glob.glob(os.path.join(ws, "specs-quality-*.work")):
        problems.append("рабочая папка не убрана")
    stray = [p for p in glob.glob(os.path.join(ws, "**", "*.json"), recursive=True)
             if not p.endswith(".quality.json") and os.sep + ".claude" + os.sep not in p]
    if stray:
        problems.append(f"лишние JSON вне документов: {[os.path.relpath(p, ws) for p in stray]}")
    documents = sorted(glob.glob(os.path.join(ws, "coddoc", "**", "*.md"), recursive=True))
    documents = [p for p in documents if os.path.basename(p) in (BT, SPEC) and os.sep + "stages" + os.sep not in p
                 and os.sep + "_foundation" + os.sep + BT not in p]
    missing = [os.path.relpath(p, ws) for p in documents if not os.path.exists(p[:-len(".md")] + ".quality.json")]
    doc = {"documents": []}
    if missing:
        problems.append(f"нет выхода рядом с документом: {missing}")
    schema = contract.load_json(contract.SCHEMA_PATH)
    for path in sorted(glob.glob(os.path.join(ws, "coddoc", "**", "*.quality.json"), recursive=True)):
        with open(path, encoding="utf-8") as handle:
            output = json.load(handle)
        errors = contract.check_document(output, schema)
        if errors:
            problems.append(f"{os.path.relpath(path, ws)} не проходит contract.py: {errors[:3]}")
            doc = None
            break
        doc["documents"].append(output["document"])
    if doc is not None and not doc["documents"]:
        doc = None
    checks = content_checks(doc) if doc else {}
    for name, ok in checks.items():
        lines.append(f"  {'ok  ' if ok else 'НЕТ '} {name}")
        if not ok:
            problems.append(f"проверка «{name}»")
    if doc:
        lines.append("подсвечено: " + ", ".join(sorted({x["key"] for x in doc["documents"] if x["scored"] and x["attention"]})))
        lines.append("цитат не найдено: " + str(sum(1 for x in doc["documents"] if x["scored"] for f in x["findings"] if f.get("quote_found") is False)))
    verdict = "PASS" if not problems else "FAIL"
    report = "\n".join([f"Итог: {verdict}"] + [f"  - {p}" for p in problems] + lines + [f"Стоимость: ${cost:.2f}"]) + "\n"
    with open(os.path.join(run_dir, "SKILL-REPORT.txt"), "w", encoding="utf-8") as handle:
        handle.write(report)
    return report


def selftest():
    """Известный результат: эталонные ответы → collect → merge → все проверки зелёные; порча — своя проверка красная."""
    import copy
    import tempfile
    import collect
    import merge
    import selftest_specs_merge as sm

    na = "н/п"
    shape = {  # документ → (баллы 0 / 0.5 / 1, шаблонно, пропущено разделов, признаки кода, следы); БТ — 7 баллов, спека — 6
        "PSS-2210/bt": ((1, 1, 1, 1, 1, 1, 1), False, 0, (), ()), "PSS-2210/spec": ((1, 1, 0.5, 1, 1, 1), False, 0, (), (2, 3)),
        "PSS-2211/bt": ((1, 1, 1, 1, 1, 1, 1), False, 0, (), ()), "PSS-2212/bt": ((1, 1, 0.5, 0.5, 1, 1, 1), False, 0, (), ()),
        "PSS-2212/spec": ((1, 0.5, 0.5, 1, 1, 1), False, 0, (), (2, 3)), "PSS-2213/bt": ((0, 0.5, 0.5, 0, 0, 0, 0), True, 0, (), ()),
        "PSS-2213/spec": ((0, 0, 0, 0.5, 0, 0), True, 0, (), (1, 3)), "PSS-2214/bt": ((1, 1, 1, 1, 1, 1, 1), False, 12, (), ()),
        "PSS-2214/spec": ((1, 1, 0.5, 1, 1, 1), False, 0, (), (2, 3)), "PSS-2215/spec": ((0, 1, 0, 0.5, 0.5, 1), False, 22, (1, 2), ()),
        "PSS-2216/bt": ((1, 1, 1, 1, 1, 1, 1), False, 0, (), ()), "PSS-2216/spec": ((1, 1, 0.5, 1, 1, 1), False, 10, (), (2, 3)),
        "ARS-312/spec": ((1, na, na, 1, na, 1), False, 1, (), (4, 5)), "ARS-100/bt": ((0.5, 0.5, 1, 0, 1, 1, 1), False, 12, (), ()),
        "ARS-100/_foundation/spec": ((na, 0, 0, 0, 0, 0), True, 22, (), (1,)),
        "ARS-100/ARS-101/bt": ((0, 0, 0, 0, 0, 0, 0), True, 15, (), ()),
        "ARS-100/ARS-101/spec": ((0, 0, 0, 0, 0, 0), True, 22, (), ()), "PSS-2290/bt": ((1, 1, 1, 0, 1, 1, 1), False, 0, (), ()),
        "PSS-2290/spec": ((1, 1, 0.5, 1, 1, 1), False, 0, (), (2, 3)),
    }
    base = tempfile.mkdtemp(prefix="specs-lead-")
    try:
        root = os.path.join(base, "run-01")
        shutil.copytree(specs_cases.FIXTURE, os.path.join(root, "coddoc"))
        os.makedirs(os.path.join(root, "coddoc", "PSS-2290"))
        for name, text in specs_cases.zero_only_folder().items():
            with open(os.path.join(root, "coddoc", "PSS-2290", name), "w", encoding="utf-8") as handle:
                handle.write(text)
        data = collect.collect("coddoc/", root, repo="pss", today="2026-10-28")
        for meta in data["documents"]:
            key = meta["path"][len("coddoc/"):].rsplit("/", 1)[0] + "/" + meta["kind"]
            parts, flag, missing, signs, traces = shape[key]
            with open(os.path.join(root, meta["path"]), encoding="utf-8") as handle:
                quote = sm.real_quote(handle.read())
            with open(os.path.join(data["work"], meta["answer"]), "w", encoding="utf-8") as handle:
                json.dump(sm.answer(meta["kind"], parts, quote, flag, missing, signs, traces), handle, ensure_ascii=False)
        outputs, _, _ = merge.build(data["work"])
        doc = {"documents": [output["document"] for _meta, output in outputs]}
    finally:
        shutil.rmtree(base, ignore_errors=True)
    problems = []
    known = content_checks(doc)
    problems += [f"эталон: проверка «{name}» красная" for name, ok in known.items() if not ok]
    spoils = {
        "внимание": lambda d: next(x for x in d["documents"] if x["path"].endswith("PSS-2210/business_requirements.md"))["attention"].append("zero"),
        "по коду": lambda d: next(x for x in d["documents"] if x["path"].endswith("PSS-2215/technical_specification.md")).update(origin="skill"),
        "случай E: только ноль": lambda d: next(x for x in d["documents"] if x["path"].endswith("PSS-2290/business_requirements.md"))["attention"].append("off_structure"),
        "фундамент": lambda d: next(x for x in d["documents"] if "_foundation" in x["path"])["criteria"].update(traceability=0),
        "строки": lambda d: d["documents"].pop(),
    }
    for name, spoil in spoils.items():
        spoiled = copy.deepcopy(doc)
        spoil(spoiled)
        if content_checks(spoiled).get(name, True):
            problems.append(f"порча «{name}» не поймана")
    total = len(known) + len(spoils)
    print("\n".join(problems) if problems else f"selftest run_specs: {total}/{total}")
    return 1 if problems else 0


def main(argv=None):
    if argv is None and sys.argv[1:] == ["--selftest"]:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
        return selftest()
    parser = argparse.ArgumentParser(description="Прогон скилла specs-quality на фикстуре SQ-AUDIT.")
    parser.add_argument("--name", required=True)
    parser.add_argument("--model", default="sonnet")
    parser.add_argument("--parallel", type=int, default=5)
    parser.add_argument("--timeout", type=int, default=3000)
    parser.add_argument("--grade-only", action="store_true")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    run_dir = os.path.join(HERE, "runs", f"{date.today().isoformat()}-{cfg.name}")
    if cfg.grade_only:
        print(grade(run_dir, cfg.parallel), end="")
        return 0
    if os.path.exists(run_dir):
        print(f"Папка прогона уже есть: {run_dir}", file=sys.stderr)
        return 2
    ws = os.path.join(run_dir, "run-01")
    shutil.copytree(specs_cases.FIXTURE, os.path.join(ws, "coddoc"))
    os.makedirs(os.path.join(ws, ".git"))  # корень итога — песочница, а не репозиторий стенда
    os.makedirs(os.path.join(ws, "coddoc", "PSS-2290"))
    for name, text in specs_cases.zero_only_folder().items():
        with open(os.path.join(ws, "coddoc", "PSS-2290", name), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    with open(os.path.join(run_dir, "coddoc.sha256.json"), "w", encoding="utf-8") as handle:
        json.dump(digest(os.path.join(ws, "coddoc")), handle, indent=1)
    shutil.copytree(SKILL, os.path.join(ws, ".claude", "skills", "specs-quality"), ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(SKILL, os.path.join(run_dir, "_skill"), ignore=shutil.ignore_patterns("__pycache__"))  # текст, которым получены числа

    prompt = PROMPT.format(parallel=cfg.parallel)
    command = [claude_exe(), "-p", prompt, "--model", cfg.model, "--allowedTools", *ALLOWED_TOOLS,
               "--disallowedTools", *DENIED_TOOLS, "--output-format", "stream-json", "--verbose", "--no-session-persistence"]
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
