#!/usr/bin/env python3
"""Оценка ответов рубрики specs-quality в JSON: форма ответа и паритет с sdd-quality-audit 1.4.0.

    python3 grade_specs_rubric.py <папка прогона>   # читает responses/<случай>-r<N>.json
    python3 grade_specs_rubric.py --selftest        # известные ответы → известный итог

По каждому ответу: JSON найден и проходит findings.schema.json; критерии — по порядку рубрики; баллы — из шкалы.
Из ответа собирается документ, как его соберёт merge, — итог, нули, форма, происхождение и подсветка по
формулам contract.py. Документ фикстуры сверяется с эталоном 1.4.0: подсветка, шаблонно, не по форме и
происхождение — строго, баллы — справочно (вне эталонных встречается). Точечный случай — своё ожидание.
Цитаты ищутся в тексте документа — справочно, к срезу merge.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCE_DIR = os.path.join(HERE, "..", "specs-quality", "reference")
sys.path.insert(0, REFERENCE_DIR)
sys.path.insert(0, HERE)
import contract  # noqa: E402
import params  # noqa: E402
import specs_cases  # noqa: E402

NA = "н/п"
RUBRIC_MAX = {"goal": 0.5}  # шкала рубрики: у цели БТ — до 0.5, у остальных — до 1
QUOTE_STRIP = re.compile(r"[`*«»\"“”„]")


def last_json(text):
    """Последний JSON-объект в тексте ответа: так берёт и merge (два JSON — второй)."""
    decoder = json.JSONDecoder()
    found = None
    for start in [m.start() for m in re.finditer(r"\{", text)]:
        try:
            value, end = decoder.raw_decode(text, start)
        except ValueError:
            continue
        if isinstance(value, dict) and "criteria" in value:
            found = value
    return found


def normalize(text):
    return re.sub(r"\s+", " ", QUOTE_STRIP.sub("", text)).strip()


def build_document(answer, kind, cfg):
    """Ответ рубрики → поля документа, нужные для подсветки, по формулам contract."""
    weights = params.weights(cfg, kind)
    form_min = cfg["attention"]["form_min_missing"]
    criteria = {item["id"]: None if item["score"] == NA else round(item["score"] / RUBRIC_MAX.get(item["id"], 1) * weights[item["id"]], 4)
                for item in answer["criteria"]}
    form_missing = sorted({m["n"] for m in answer["form"]["missing"]})
    off = contract.off_form(len(form_missing), kind, form_min)
    origin = None
    if kind == "spec":
        origin = contract.origin_verdict(answer["origin"]["code_signs"], answer["origin"]["traces"], not off)
    form_weight = params.form_weight(cfg, kind)
    form_points = contract.form_score({"kind": kind, "form_missing": form_missing}, form_weight)
    _, _, pct = contract.total(criteria, weights, form_points, form_weight)
    document = {"kind": kind, "pct": pct, "criteria": criteria, "template": answer["template"]["flag"],
                "form_missing": form_missing, "off_form": off, "origin": origin}
    document["reasons"] = contract.attention_reasons(document, cfg["attention"]["below_pct"], form_min)
    return document


def scale_ok(item):
    if item["score"] == NA:
        return True
    top = RUBRIC_MAX.get(item["id"], 1)
    return any(contract.close(item["score"], top * level) for level in (0, 0.5, 1))


def grade_answer(case, result_text, cfg, schema):
    """→ (строгие проблемы, справочные замечания, сводка)."""
    answer = last_json(result_text or "")
    if answer is None:
        return ["нет JSON в ответе"], [], {}
    kind = case["kind"]
    problems = [f"схема: {error}" for error in contract.validate(answer, schema["$defs"][kind], schema)]
    if problems:
        return problems, [], {}
    ids = tuple(item["id"] for item in answer["criteria"])
    if ids != params.CRITERIA[kind]:
        return [f"критерии {', '.join(ids)}, а по рубрике {', '.join(params.CRITERIA[kind])}"], [], {}
    bad_scale = [item["id"] for item in answer["criteria"] if not scale_ok(item)]
    if bad_scale:
        return [f"балл не из шкалы рубрики: {', '.join(bad_scale)}"], [], {}

    document = build_document(answer, kind, cfg)
    parts = tuple(NA if item["score"] == NA else item["score"] for item in answer["criteria"])
    notes = []
    text = normalize(case["text"] + "\n" + (case["source_text"] or ""))
    quotes = [e["quote"] for item in answer["criteria"] for e in item["evidence"]]
    if answer["template"]["fact"]:
        quotes.append(answer["template"]["fact"]["quote"])
    quotes += [sign["quote"] for sign in (answer.get("origin") or {}).get("code_signs", [])]
    lost = [q for q in quotes if normalize(q) not in text]
    summary = {"parts": parts, "pct": document["pct"], "reasons": document["reasons"], "origin": document["origin"],
               "quotes": len(quotes), "lost": len(lost)}
    if lost:
        notes.append(f"цитат не найдено {len(lost)} из {len(quotes)}: " + "; ".join(q[:60] for q in lost[:3]))

    reference = case.get("reference")
    if reference:
        attention = bool(document["reasons"])
        if attention != reference["attention"]:
            problems.append(f"подсветка {attention} ({', '.join(document['reasons']) or '—'}), в 1.4.0 {reference['attention']}")
        if answer["template"]["flag"] != reference["template"]:
            problems.append(f"шаблонно {answer['template']['flag']}, в 1.4.0 {reference['template']}")
        if document["off_form"] != reference["off_form"]:
            problems.append(f"не по форме {document['off_form']} (нет {len(document['form_missing'])}), в 1.4.0 {reference['off_form']}")
        if reference["origin"] and summary["origin"] != reference["origin"]:
            problems.append(f"происхождение {summary['origin']}, в 1.4.0 {reference['origin']}")
        if parts[:5] not in reference["parts"]:  # у 1.4.0 — пять критериев; новые сверяются только через подсветку
            notes.append(f"баллы {parts[:5]}, в 1.4.0 {reference['parts']}")
    for field, expected in case.get("expect") or ():
        if field == "origin":
            got = summary["origin"]
        elif field == "code_signs":
            got = len(answer["origin"]["code_signs"])
        else:
            got = dict(zip(ids, parts))[field]
        if (got not in expected) if isinstance(expected, tuple) else (got != expected):  # кортеж — любое из значений
            problems.append(f"{field}: {got}, ожидали {' или '.join(map(str, expected)) if isinstance(expected, tuple) else expected}")
    return problems, notes, summary


def load_schema():
    with open(os.path.join(REFERENCE_DIR, "findings.schema.json"), encoding="utf-8") as handle:
        return json.load(handle)


def grade_run(run_dir):
    cfg = params.load()
    schema = load_schema()
    cases = {item["name"]: item for item in specs_cases.all_cases()}
    lines, total, green, cost = [], 0, 0, 0.0
    clean, false_contra = 0, []  # документы фикстуры без заложенных противоречий: сколько раз модель их нашла
    for path in sorted(glob.glob(os.path.join(run_dir, "responses", "*.json"))):
        name = re.sub(r"-r\d+$", "", os.path.basename(path)[:-5])
        with open(path, encoding="utf-8") as handle:
            raw = handle.read()
        try:
            envelope = json.loads(raw)
        except ValueError:
            envelope = {}
        cost += float(envelope.get("total_cost_usd") or 0)
        if not envelope.get("result") or envelope.get("is_error"):
            lines.append(f"НЕ ИЗМЕРЕНО  {os.path.basename(path)}: нет ответа CLI")
            continue
        problems, notes, summary = grade_answer(cases[name], envelope["result"], cfg, schema)
        total += 1
        green += not problems
        mark = "зелёный" if not problems else "КРАСНЫЙ"
        tail = f"  {summary.get('parts')} {summary.get('pct')}% {summary.get('reasons')} {summary.get('origin') or ''}" if summary else ""
        lines.append(f"{mark:8} {os.path.basename(path)[:-5]}{tail}")
        lines += [f"         ✗ {p}" for p in problems] + [f"         · {n}" for n in notes]
        if summary and not name.startswith("F"):
            clean += 1
            consistency = dict(zip(params.CRITERIA[cases[name]["kind"]], summary["parts"])).get("consistency")
            if consistency not in (1, NA):
                false_contra.append(os.path.basename(path)[:-5])
    lines.append(f"\nзелёных {green} из {total}; стоимость ${cost:.2f}")
    lines.append(f"противоречие на документах без заложенного: {len(false_contra)} из {clean}"
                 + (f" — {', '.join(false_contra)}" if false_contra else ""))
    return "\n".join(lines) + "\n"


def selftest():
    """Известные ответы: эталонные баллы 1.4.0 → зелёный; испорченные → красный со своим сообщением."""
    cfg = params.load()
    schema = load_schema()
    cases = {item["name"]: item for item in specs_cases.all_cases()}
    failures = []

    def answer_for(case, parts, flag, missing, signs=(), traces=("легенда", "карточки INT-N")):
        if len(parts) == 5:  # баллы 1.4.0 + новые критерии полным баллом или «н/п»
            parts = tuple(parts) + ((1, 1) if case["kind"] == "bt" else (1,))
        criteria = [{"id": cid, "evidence": [], "searched": [], "comment": None if p != NA else "не применимо",
                     "fix": None, "score": p} for cid, p in zip(params.CRITERIA[case["kind"]], parts)]
        result = {"criteria": criteria,
                  "template": {"fact": None if flag else {"section": "§1", "quote": "x"}, "generic": [], "flag": flag},
                  "form": {"missing": [{"n": n, "title": "раздел"} for n in range(1, missing + 1)]}}
        if case["kind"] == "spec":
            result["origin"] = {"traces": [{"n": number, "what": what} for number, what in enumerate(traces, 1)],
                                "code_signs": [{"n": n, "quote": "q"} for n in signs]}
        return "Вот ответ:\n" + json.dumps(result, ensure_ascii=False)

    def check(name, text, expect_green, expect_piece=None):
        problems, _, _ = grade_answer(cases[name], text, cfg, schema)
        if expect_green and problems:
            failures.append(f"{name}: ждали зелёный, получили {problems}")
        if not expect_green and not any(expect_piece in p for p in problems):
            failures.append(f"{name}: ждали «{expect_piece}», получили {problems or 'зелёный'}")

    # Эталон каждого документа фикстуры — зелёный.
    for name, case in cases.items():
        reference = case["reference"]
        if not reference:
            continue
        missing = 6 if (reference["off_form"] and case["kind"] == "spec") else 5 if reference["off_form"] else 0
        signs = (1, 2) if reference["origin"] == "by_code" else ()
        traces = () if reference["origin"] == "outside" else ("легенда", "карточки INT-N")
        check(name, answer_for(case, reference["parts"][0], reference["template"], missing, signs, traces), True)

    good = cases["PSS-2210-bt"]
    check("PSS-2210-bt", answer_for(good, (0.5, 1, 1, 0, 1), False, 0), False, "подсветка True (zero)")
    check("PSS-2210-bt", answer_for(good, (0.5, 1, 1, 1, 1), False, 5), False, "не по форме True")
    check("PSS-2210-bt", answer_for(good, (1, 1, 1, 1, 1), False, 0), False, "балл не из шкалы рубрики: goal")
    check("PSS-2210-bt", answer_for(good, (0.5, 1, 1, 1, 1), True, 0), False, "шаблонно True, в 1.4.0 False")
    check("PSS-2210-bt", "нет тут JSON", False, "нет JSON в ответе")
    swapped = json.loads(answer_for(good, (0.5, 1, 1, 1, 1), False, 0).split("\n", 1)[1])
    swapped["criteria"][0], swapped["criteria"][1] = swapped["criteria"][1], swapped["criteria"][0]
    check("PSS-2210-bt", json.dumps(swapped, ensure_ascii=False), False, "критерии entities, goal")
    extra = json.loads(answer_for(good, (0.5, 1, 1, 1, 1), False, 0).split("\n", 1)[1])
    extra["file"] = "x"
    check("PSS-2210-bt", json.dumps(extra, ensure_ascii=False), False, "лишнее поле «file»")
    two = answer_for(good, (0.5, 1, 1, 0, 1), False, 0) + "\nИсправляю:\n" + answer_for(good, (0.5, 1, 1, 1, 1), False, 0)
    check("PSS-2210-bt", two, True)  # два JSON — берётся последний
    code = cases["PSS-2215-spec"]
    check("PSS-2215-spec", answer_for(code, (0, 1, 0, 0.5, 0.5), False, 22, signs=(1, 1)), False, "происхождение")
    check("A-negation", answer_for(cases["A-negation"], (1, NA, NA, 1, NA), False, 1), True)
    check("A-negation", answer_for(cases["A-negation"], (1, 1, NA, 1, NA), False, 1), False, "data_model: 1, ожидали н/п")
    check("C-marker", answer_for(cases["C-marker"], (1, 1, 0.5, 1, 1), False, 0, signs=(6,)), False, "code_signs: 1, ожидали 0")
    check("D2-role-bare", answer_for(cases["D2-role-bare"], (0.5, 1, 1, 1, 0.5), False, 0), False, "roles: 0.5, ожидали 0")
    check("PSS-2210-bt", answer_for(good, (0.5, 1, 1, 1, 1, 1, 0), False, 0), False, "подсветка True (zero)")  # противоречия — ноль
    check("PSS-2210-bt", answer_for(good, (0.5, 1, 1, 1, 1, 1), False, 0), False, "схема")  # шесть баллов у БТ
    contra = cases["F1-contra-bt"]
    check("F1-contra-bt", answer_for(contra, (0.5, 1, 1, 1, 1, 1, 0.5), False, 0), True)  # противоречие замечено
    check("F1-contra-bt", answer_for(contra, (0.5, 1, 1, 1, 1, 1, 0), False, 0), True)
    check("F1-contra-bt", answer_for(contra, (0.5, 1, 1, 1, 1, 1, 1), False, 0), False, "consistency: 1, ожидали 0 или 0.5")
    check("F2-contra-spec", answer_for(cases["F2-contra-spec"], (1, 1, 0.5, 1, 1, 1), False, 0), False, "consistency: 1, ожидали")

    count = sum(1 for case in cases.values() if case["reference"]) + 19
    if failures:
        print("\n".join(failures))
        print(f"selftest: провалов {len(failures)} из {count}")
        return 1
    print(f"selftest: {count}/{count}")
    return 0


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if argv[1:] == ["--selftest"]:
        return selftest()
    if len(argv) != 2:
        print(__doc__.strip())
        return 2
    print(grade_run(argv[1]), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
