#!/usr/bin/env python3
"""Самопроверка merge.py specs-quality: collect по фикстуре + ответы известного вида → итог против ручного счёта.

    python3 selftest_specs_merge.py

Ответы собираются из эталонных баллов 1.4.0 с настоящими цитатами из документов. Проверяется: итог, нули, структура,
происхождение и подсветка по ручному счёту; допуски разбора (лишний элемент criteria, повтор id, порядок, origin
внутри form, два JSON); «оценка не состоялась» (нет JSON, балл вне шкалы, нет критерия, нет ответа); цитаты —
выдуманная в unverified при том же балле, с другим переносом, разметкой и «…» — найдена; выход каждого документа
проходит contract.py и пишется рядом с ним, work/ удаляется после успеха; провал контракта — не пишется ни один выход,
work/ остаётся. Если рядом есть ответы среза 2 (runs/*-rubric-json*/responses), они тоже собираются в выходы, которые
обязаны пройти контракт.
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "specs-quality", "reference"))
sys.path.insert(0, HERE)
import collect  # noqa: E402
import contract  # noqa: E402
import merge  # noqa: E402
import params  # noqa: E402
import specs_cases  # noqa: E402

NA = "н/п"
failures = []
checks = 0


def check(name, condition, detail=""):
    global checks
    checks += 1
    if not condition:
        failures.append(f"{name}: {detail}")


def real_quote(text):
    """Строка прозы из документа без разметки — заведомо найдётся."""
    for line in text.split("\n"):
        plain = line.strip().lstrip("#>-").strip()
        if len(plain) > 25 and "|" not in plain and "**" not in plain and "`" not in plain:
            return plain[:120]
    return text.strip().split("\n")[0].lstrip("# ").strip()


def answer(kind, parts, quote, flag=False, missing=0, signs=(), traces=(2, 3)):
    criteria = []
    for criterion_id, score in zip(params.CRITERIA[kind], parts):
        lowered = score == NA or score < 1
        criteria.append({"id": criterion_id, "evidence": [{"section": "§1", "quote": quote}] if lowered else [],
                         "searched": [], "comment": "не применимо" if score == NA else ("дыра" if lowered else None),
                         "fix": "дописать" if lowered and score != NA else None, "score": score})
    result = {"criteria": criteria,
              "template": {"fact": None if flag else {"section": "§1", "quote": quote}, "generic": ["общие слова"] if flag else [],
                           "flag": flag}}
    if kind == "spec":
        result["origin"] = {"traces": [{"n": n, "what": "след"} for n in traces], "code_signs": [{"n": n, "quote": quote} for n in signs]}
    result["form"] = {"missing": [{"n": n, "title": "раздел"} for n in range(1, missing + 1)]}
    return result


def setup(base, name, repo=None):
    root = os.path.join(base, name)
    shutil.copytree(specs_cases.FIXTURE, os.path.join(root, "coddoc"))
    data = collect.collect("coddoc/", root, repo=repo, today="2026-10-28")
    return root, data


def written(root):
    return sorted(glob.glob(os.path.join(root, "**", "*.quality.json"), recursive=True))


def doc_meta(data, tail):
    return next(d for d in data["documents"] if d["path"].endswith(tail))


def put(data, tail, text):
    with open(os.path.join(data["work"], doc_meta(data, tail)["answer"]), "w", encoding="utf-8") as handle:
        handle.write(text)


def text_of(root, data, tail):
    with open(os.path.join(root, doc_meta(data, tail)["path"]), encoding="utf-8") as handle:
        return handle.read()


def by_path(doc, tail):
    return next(d for d in doc["documents"] if d["path"].endswith(tail))


def built(work):
    """merge.build → (выходы по документам, {"documents": документы} для поиска по пути, лог)."""
    outputs, log, _ = merge.build(work)
    return outputs, {"documents": [output["document"] for _meta, output in outputs]}, log


def main_checks(base):
    root, data = setup(base, "repo", repo="pss")
    q = lambda tail: real_quote(text_of(root, data, tail))  # noqa: E731
    bt, sp = "business_requirements.md", "technical_specification.md"

    # Ручной счёт по эталону.
    # Баллы: у БТ necessity … actors, scope, consistency; у спеки traceability … interfaces, consistency.
    put(data, "PSS-2212/" + bt, json.dumps(answer("bt", (1, 1, 0.5, 0.5, 1, 1, 1), q("PSS-2212/" + bt)), ensure_ascii=False))
    put(data, "ARS-100/" + bt, json.dumps(answer("bt", (0.5, 0.5, 1, 0, 1, 1, 1), q("ARS-100/" + bt), missing=12), ensure_ascii=False))
    put(data, "_foundation/" + sp, json.dumps(answer("spec", (NA, 0, 0, 0, 0, 0), q("_foundation/" + sp), flag=True, missing=22, traces=(1,)),
                                              ensure_ascii=False))
    put(data, "ARS-312/" + sp, json.dumps(answer("spec", (1, NA, NA, 1, NA, 1), q("ARS-312/" + sp), missing=1, traces=(4, 5)), ensure_ascii=False))
    put(data, "PSS-2215/" + sp, json.dumps(answer("spec", (0, 1, 0, 0.5, 0.5, 1), q("PSS-2215/" + sp), missing=22, signs=(1, 2), traces=()),
                                           ensure_ascii=False))
    edited = answer("spec", (1, 1, 0.5, 1, 1, 0.5), q("PSS-2216/" + sp), missing=10)
    edited["origin"]["code_signs"] = [{"n": 2, "quote": "src/PassService.java — этой строки в документе нет"}]
    edited["criteria"][5]["evidence"] = [{"section": "§1", "quote": q("PSS-2216/" + sp)}, {"section": "источник", "quote": q("PSS-2216/" + bt)}]
    put(data, "PSS-2216/" + sp, json.dumps(edited, ensure_ascii=False))

    # Порча и допуски.
    put(data, "PSS-2210/" + bt, "Оценка готова, но JSON не пришёл.")
    put(data, "PSS-2211/" + bt, json.dumps(answer("bt", (0.25, 1, 1, 1, 1, 1, 1), q("PSS-2211/" + bt)), ensure_ascii=False))
    first = answer("bt", (0, 0, 0, 0, 0, 0, 0), q("PSS-2213/" + bt), flag=True)
    second = answer("bt", (0, 0.5, 0.5, 0, 0, 0, 0), q("PSS-2213/" + bt), flag=True)
    put(data, "PSS-2213/" + bt, "Черновик:\n" + json.dumps(first, ensure_ascii=False) + "\nИсправляю:\n" + json.dumps(second, ensure_ascii=False))
    invented = answer("bt", (1, 1, 1, 1, 1, 1, 1), q("PSS-2214/" + bt), missing=12)
    invented["criteria"][2].update(score=0.5, evidence=[{"section": "§4.1", "quote": "FR-9. Этой строки в документе нет"}], comment="дыра", fix="x")
    put(data, "PSS-2214/" + bt, json.dumps(invented, ensure_ascii=False))
    spec14 = answer("spec", (1, 1, 0.5, 1, 1, 1), q("PSS-2214/" + sp))
    spec14["criteria"][2]["evidence"] = [{"section": "шапка", "quote": "**Статус готовности:**\nГотово к разработке"},
                                         {"section": "шапка", "quote": "«Статус готовности» … «Задача: PSS-2214»"},
                                         {"section": "Авторизация/доступ на бэке", "quote": "Не найдено."}]
    put(data, "PSS-2214/" + sp, json.dumps(spec14, ensure_ascii=False))
    extra = answer("spec", (1, 0.5, 0.5, 1, 1, 0.5), q("PSS-2212/" + sp))
    extra["criteria"].append({"id": "template", "evidence": [], "searched": [], "comment": None, "fix": None, "score": 1})
    extra["criteria"][5]["evidence"] = [{"section": "§1", "quote": q("PSS-2212/" + sp)}, {"section": "источник", "quote": "Этой строки нет нигде"}]
    put(data, "PSS-2212/" + sp, json.dumps(extra, ensure_ascii=False))
    nested = answer("spec", (1, 1, 0.5, 1, 1, 1), q("PSS-2210/" + sp))
    nested["form"]["origin"] = nested.pop("origin")
    put(data, "PSS-2210/" + sp, json.dumps(nested, ensure_ascii=False))
    shuffled = answer("spec", (0, 0, 0, 0.5, 0, 0), q("PSS-2213/" + sp), flag=True, traces=(1, 3))
    shuffled["criteria"].reverse()
    put(data, "PSS-2213/" + sp, json.dumps(shuffled, ensure_ascii=False))
    twice = answer("bt", (NA, 0, 0, 0, 0, 0, 0), q("ARS-101/" + bt), flag=True, missing=15)
    twice["criteria"][0]["comment"] = None  # «н/п» без причины своими словами
    twice["criteria"].append(dict(twice["criteria"][4], score=0.5, comment="дыра"))
    put(data, "ARS-101/" + bt, json.dumps(twice, ensure_ascii=False))
    short = answer("spec", (0, 0, 0, 0, 0, 0), q("ARS-101/" + sp), flag=True, missing=22, traces=())
    short["criteria"].pop(1)
    put(data, "ARS-101/" + sp, json.dumps(short, ensure_ascii=False))
    # У PSS-2216 БТ ответа нет вовсе.

    outputs, doc, log = built(data["work"])
    schema = contract.load_json(contract.SCHEMA_PATH)
    errors = [f"{meta['path']}: {error}" for meta, output in outputs for error in contract.check_document(output, schema)]
    check("выход каждого документа проходит contract", not errors, errors[:5])
    params_of = {output["document"]["path"]: output["params"] for _meta, output in outputs}
    check("параметры — своего вида", params_of["coddoc/PSS-2212/business_requirements.md"]["structure_min_missing"] == 5 and
          list(params_of["coddoc/PSS-2212/business_requirements.md"]["weights"]) == list(params.CRITERIA["bt"]) and
          params_of["coddoc/PSS-2212/technical_specification.md"]["structure_min_missing"] == 6, params_of["coddoc/PSS-2212/business_requirements.md"])
    check("репозиторий — в каждом документе", all(d["repo"] == "pss" for d in doc["documents"]), {d["repo"] for d in doc["documents"]})

    def totals(d):
        return d["sum"], d["max"], d["pct"]

    def line(d, criterion):
        return next((item for item in d["findings"] if item["criterion"] == criterion), None)

    d = by_path(doc, "PSS-2212/" + bt)
    check("ручной счёт: БТ 6 + структура 1 = 7 из 8 (88%)", totals(d) == (7, 8, 88) and d["structure_score"] == 1 and d["attention"] == [],
          totals(d))
    check("находки — только у сниженных, по порядку рубрики", [f["criterion"] for f in d["findings"]] == ["unambiguity", "verifiability"], d["findings"])
    check("ключ и название — из строки collect", d["key"] == "PSS-2212" and d["feature"] == "заявка на разовый пропуск для посетителя",
          (d["key"], d["feature"]))
    d = by_path(doc, "ARS-100/" + bt)
    check("ручной счёт: необходимость 0.5, структура 4 из 16 → 5.25 из 8 (66%), ноль и неполная структура", totals(d) == (5.25, 8, 66) and d["structure_score"] == 0.25 and
          contract.zero_ids(d["criteria"]) == ["verifiability"] and d["attention"] == ["zero", "off_structure"], (totals(d), d["attention"]))
    d = by_path(doc, "_foundation/" + sp)
    check("ручной счёт: фундамент 0 + структура 1 из 23 = 0.04 из 6 (1%), мимо фреймворка", totals(d) == (0.04, 6, 1) and d["origin"] == "outside" and
          d["source"] is None and
          d["attention"] == ["below_pct", "zero", "template", "off_structure"], (totals(d), d["origin"]))
    d = by_path(doc, "ARS-312/" + sp)
    check("ручной счёт: багфикс 3 + структура 0.96 из 4 (99%), источник — баг-репорт", totals(d) == (3.96, 4, 99) and d["origin"] == "skill" and
          d["source"] == "coddoc/ARS-312/bug_report.md", (totals(d), d["source"]))
    d = by_path(doc, "PSS-2215/" + sp)
    check("ручной счёт: по коду, 3 + структура 0.04 из 7 (43%), «по коду» — не причина подсветки", totals(d) == (3.04, 7, 43) and d["origin"] == "by_code" and
          d["attention"] == ["below_pct", "zero", "off_structure"], d["attention"])
    check("признаки кода — своим полем, не в findings", [(s["n"], s["kind"]) for s in d["code_signs"]] == [(1, "сделано в коде"), (2, "путь к исходнику")]
          and not any("quote_found" in s for s in d["code_signs"]) and "origin" not in [f["criterion"] for f in d["findings"]], d["code_signs"])
    d = by_path(doc, "PSS-2216/" + sp)
    check("ручной счёт: правлена руками, неполная структура", d["origin"] == "skill_edited" and d["attention"] == ["off_structure"], d["origin"])
    pair = line(d, "consistency")
    check("противоречие — пара цитат, вторая из источника, обе найдены", pair and pair["quote"].count(" ↔ ") == 1 and
          pair["quote"].startswith("§1: «") and "источник: «" in pair["quote"] and "quote_found" not in pair, pair)
    check("один признак — не «по коду», но в code_signs; выдуманная цитата — quote_found: false",
          d["code_signs"] == [{"n": 2, "kind": "путь к исходнику", "quote": "src/PassService.java — этой строки в документе нет", "quote_found": False}],
          d["code_signs"])
    check("у БТ code_signs null, у спеки без признаков — []", by_path(doc, "PSS-2212/" + bt)["code_signs"] is None and
          by_path(doc, "ARS-312/" + sp)["code_signs"] == [], (by_path(doc, "PSS-2212/" + bt)["code_signs"], by_path(doc, "ARS-312/" + sp)["code_signs"]))

    d = by_path(doc, "PSS-2210/" + bt)
    check("нет JSON — не состоялась, документ из одних общих полей", not d["scored"] and "нет JSON" in d["skip_reason"] and
          set(d) == set(merge.HEAD_KEYS) | {"scored", "skip_reason"}, d)
    d = by_path(doc, "PSS-2211/" + bt)
    check("старая шкала цели — вне шкалы", not d["scored"] and "necessity: балл 0.25 вне шкалы 0 / 0.5 / 1" in d["skip_reason"], d.get("skip_reason"))
    d = by_path(doc, "PSS-2213/" + bt)
    check("два JSON — последний", d["scored"] and d["sum"] == 2, totals(d))
    d = by_path(doc, "PSS-2214/" + bt)
    check("выдуманная цитата — quote_found: false, балл тот же", d["criteria"]["unambiguity"] == 0.5 and
          line(d, "unambiguity")["quote_found"] is False and "FR-9" in line(d, "unambiguity")["quote"], d["findings"])
    d = by_path(doc, "PSS-2214/" + sp)
    check("цитата с переносом, **, кавычками и «…» — найдена", d["scored"] and "quote_found" not in line(d, "security"), line(d, "security"))
    check("«не найдено» цитатой — в «искал»", "искал: Авторизация/доступ на бэке" in line(d, "security")["comment"], line(d, "security"))
    d = by_path(doc, "PSS-2212/" + sp)
    check("лишний элемент criteria — отброшен", d["scored"] and list(d["criteria"]) == list(params.CRITERIA["spec"]), d.get("skip_reason"))
    check("лишний элемент — в логе", any("PSS-2212/technical_specification.md: в criteria лишний элемент «template»" in entry for entry in log), log)
    check("противоречие: одной цитаты из пары нет — quote_found: false, балл тот же", d["criteria"]["consistency"] == 0.5 and
          line(d, "consistency")["quote_found"] is False, line(d, "consistency"))
    d = by_path(doc, "PSS-2210/" + sp)
    check("origin внутри form — поднят", d["scored"] and d["origin"] == "skill", d.get("skip_reason"))
    d = by_path(doc, "PSS-2213/" + sp)
    check("порядок критериев — по рубрике", d["scored"] and list(d["criteria"]) == list(params.CRITERIA["spec"]) and
          d["criteria"]["impact"] == 0.5, d["criteria"])
    d = by_path(doc, "ARS-101/" + bt)
    check("повтор критерия — последний", d["criteria"]["actors"] == 0.5, d["criteria"])
    check("н/п без причины — null, причина из цитаты", d["criteria"]["necessity"] is None and line(d, "necessity")["comment"], line(d, "necessity"))
    d = by_path(doc, "ARS-101/" + sp)
    check("нет критерия — не состоялась", not d["scored"] and "нет критерия data_model" in d["skip_reason"], d.get("skip_reason"))
    check("выход на каждый документ collect", [meta["path"] for meta, _output in outputs] == [meta["path"] for meta in data["documents"]] and
          len(outputs) == 17, len(outputs))
    missing = [x["path"] for x in doc["documents"] if not x["scored"] and x["skip_reason"] == "нет ответа модели"]
    check("без ответа — «нет ответа модели»", missing == ["coddoc/PSS-2216/business_requirements.md"], missing)
    check("счёт не состоявшихся", sum(1 for d in doc["documents"] if d["scored"]) == 17 - 4, "")
    authors = sorted({d["author"] or "—" for d in doc["documents"]})
    check("автор — из шапки, сводки по людям в выходе нет", authors == ["ivanova.ma", "—"] and
          all(set(output) == {"schema", "generated_at", "params", "document"} for _meta, output in outputs), authors)
    for _meta, output in outputs:
        text = merge.dump(output)
        document = output["document"]
        lines_max = 12 + len(document.get("findings") or []) + len(document.get("code_signs") or [])
        if json.loads(text) != output or text.count("\n") > lines_max:
            check(f"раскладка {document['path']}: читается обратно, строк не больше {lines_max}", False, text.count("\n"))
            break
    else:
        check("раскладка: читается обратно без потерь, строка на находку и признак", True)

    # --check: перечисляет то, что merge не примет, и не трогает work/.
    bad, _ = merge.check_answers(data["work"])
    listed = sorted(meta["path"].replace("coddoc/", "") for meta, _ in bad)
    check("--check: битые и без ответа — к перезапуску", listed == ["ARS-100/ARS-101/technical_specification.md", "PSS-2210/business_requirements.md",
                                                                     "PSS-2211/business_requirements.md", "PSS-2216/business_requirements.md"], listed)
    check("--check: поправимое (лишний элемент, origin в form) — не к перезапуску",
          not any(tail in " ".join(listed) for tail in ("PSS-2212/technical", "PSS-2210/technical")), listed)
    code = merge.main(["--work", data["work"], "--check"])
    check("--check: work/ на месте, выходов нет", code == 0 and os.path.exists(data["work"]) and not written(root), code)

    # main: успех — выход рядом с каждым документом, work/ удалена.
    code = merge.main(["--work", data["work"]])
    expected = sorted(os.path.normpath(os.path.join(root, meta["output"])) for meta in data["documents"])
    check("main: успех — выход рядом с каждым документом", code == 0 and [os.path.normpath(p) for p in written(root)] == expected and
          not os.path.exists(data["work"]), (code, len(written(root)), os.path.exists(data["work"])))
    bad_files = []
    for path in written(root):
        with open(path, encoding="utf-8") as handle:
            if contract.check_document(json.load(handle), schema):
                bad_files.append(path)
    check("main: записанные выходы проходят contract", not bad_files, bad_files[:2])

    # main: контракт не прошёл — не пишется ни один выход, work/ на месте.
    root2, data2 = setup(base, "repo-fail")
    original = contract.check_document
    contract.check_document = lambda doc, schema: ["порча для самопроверки"]
    try:
        code = merge.main(["--work", data2["work"]])
    finally:
        contract.check_document = original
    check("main: провал контракта — выходов нет, work/ оставлена", code == 1 and not written(root2) and os.path.exists(data2["work"]),
          (code, len(written(root2))))


def real_answers_checks(base):
    """Ответы модели из среза 2 — в итог; итог обязан пройти контракт."""
    runs = sorted(glob.glob(os.path.join(HERE, "runs", "*-rubric-json*", "responses")))
    if not runs:
        print("ответов среза 2 рядом нет — проверка на них пропущена")
        return
    names = {case["name"]: (case["path"], case["kind"]) for case in specs_cases.fixture_cases()}

    def same_rubric(run_dir, kind):  # ответ получен той рубрикой, что лежит в скилле сейчас
        snapshot, current = os.path.join(run_dir, f"rubric-{kind}.md"), os.path.join(merge.HERE, f"rubric-{kind}.md")
        if not os.path.exists(snapshot):
            return False
        with open(snapshot, encoding="utf-8") as left, open(current, encoding="utf-8") as right:
            return left.read() == right.read()

    used = 0
    for number, folder in enumerate(runs):
        fresh = {kind for kind in params.KINDS if same_rubric(os.path.dirname(folder), kind)}
        for run_tag in ("r1", "r2"):
            root, data = setup(base, f"real-{number}-{run_tag}")
            for name, (path, kind) in names.items():
                response = os.path.join(folder, f"{name}-{run_tag}.json")
                if kind not in fresh or not os.path.exists(response):
                    continue
                with open(response, encoding="utf-8") as handle:
                    result = json.load(handle).get("result") or ""
                put(data, path.replace("coddoc/", "", 1), result)
                used += 1
            outputs, doc, log = built(data["work"])
            out_schema = contract.load_json(contract.SCHEMA_PATH)
            errors = [error for _meta, output in outputs for error in contract.check_document(output, out_schema)]
            check(f"реальные ответы {os.path.basename(os.path.dirname(folder))} {run_tag}: выходы проходят contract", not errors, errors[:3])
            failed = [d["path"] for d in doc["documents"] if not d["scored"] and d["skip_reason"] != "нет ответа модели"]
            check(f"реальные ответы {os.path.basename(os.path.dirname(folder))} {run_tag}: ни один не «не состоялся»", not failed,
                  [(p, by_path(doc, p)["skip_reason"]) for p in failed])
    print(f"реальных ответов среза 2 собрано: {used}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    check("сверка: «…» — пропуск", merge.quote_found("начало … конец", merge.normalize("Начало и середина, конец.")), "")
    check("сверка: чужое не находится", not merge.quote_found("совсем другое", merge.normalize("начало и конец")), "")
    signs = lambda *numbers: [{"n": n, "quote": "q"} for n in numbers]  # noqa: E731
    traces = [{"n": 2, "what": "легенда"}, {"n": 3, "what": "карточки INT-N"}]
    for numbers, intact, expected in (((2, 5), True, "skill"), ((2, 5), False, "skill_edited"), ((3, 4), True, "by_code"),
                                      ((2, 6), True, "by_code"), ((1, 2), True, "by_code"), ((1,), True, "skill"), ((), True, "skill")):
        got = contract.origin_verdict(signs(*numbers), traces, intact)
        check(f"вердикт: признаки {set(numbers) or '—'}, форма {'цела' if intact else 'нет'} → {expected}", got == expected, got)
    base = tempfile.mkdtemp(prefix="specs-merge-")
    try:
        main_checks(base)
        real_answers_checks(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    if failures:
        print("\n".join(failures))
        print(f"selftest merge: провалов {len(failures)} из {checks}")
        return 1
    print(f"selftest merge: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
