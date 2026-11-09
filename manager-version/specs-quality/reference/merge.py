#!/usr/bin/env python3
"""merge — последний шаг оценки: строки collect + ответы модели по рубрикам → specs-quality/6 по каждому документу.

    python3 merge.py --work <папка collect> [--keep-work]
    python3 merge.py --work <папка collect> --check   # какие ответы перезапустить: нет файла, не JSON, не по схеме

В --work лежат collect.json и задания (их пишет collect) и <id>.findings.txt — ответ модели как есть. Пишет рядом с
каждым документом <имя>.quality.json, проверенный contract.py; после записи удаляет --work (с --keep-work — оставляет).
Хоть один выход не прошёл contract — не пишется ни один, папка остаётся для разбора. На экран — что поправлено в
ответах и список «Требуют внимания».

Модель ничего не считает: итог, нули, форму и её балл, происхождение и подсветку считает contract.py по params.json. Ответ
разбирается терпимо: последний JSON в тексте; элемент criteria с чужим id отбрасывается, повтор id — берётся
последний, порядок — по рубрике; origin внутри form поднимается. Критерия рубрики нет, балл вне шкалы, ответ не по
схеме — документ «оценка не состоялась». В выход идут только сниженные и «н/п» критерии — по строке findings с одной
цитатой (у противоречия — пара); цитаты нет в тексте документа — у строки quote_found: false, балл тот же.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # соседние модули находятся и при `python -I`

import contract  # noqa: E402
import params  # noqa: E402
FINDINGS_SCHEMA_PATH = os.path.join(HERE, "findings.schema.json")
NA = "н/п"
RUBRIC_MAX = {"goal": 0.5}  # шкала рубрики: у цели БТ — до 0.5, у остальных критериев — до 1
PAIRED = {"consistency"}  # находка — пара цитат: два места, которые нельзя выполнить вместе
LIMITS = {"text": 1000}
NOISE_RE = re.compile(r"[`*_«»\"“”„'’~>|]")
ELLIPSIS_RE = re.compile(r"\s*(?:…|\.\.\.)\s*")
NOT_FOUND = {"не найдено", "не найден", "не найдена", "не найдены", "нет", "отсутствует"}  # «цитата» об отсутствии — это searched
REASON_NAMES = {"below_pct": None, "zero": "ноль", "template": "шаблонно: да", "off_form": "не по форме"}
KIND_NAMES = {"bt": "БТ", "spec": "спека"}


class Failed(ValueError):
    """Ответ модели не годится — документ «оценка не состоялась»."""


# ---------------------------------------------------------------- разбор ответа


def last_json(text):
    """Последний JSON-объект с criteria: модель, поправившая себя вторым JSON, имеет в виду второй."""
    decoder = json.JSONDecoder()
    found = None
    for match in re.finditer(r"\{", text):
        try:
            value, _ = decoder.raw_decode(text, match.start())
        except ValueError:
            continue
        if isinstance(value, dict) and "criteria" in value:
            found = value
    return found


def repair(answer, kind, log):
    """Известные огрехи формы — без пересмотра баллов. Остальное — к проверке по схеме."""
    rubric_ids = params.CRITERIA[kind]
    if kind == "spec" and "origin" not in answer and isinstance(answer.get("form"), dict) and "origin" in answer["form"]:
        answer["origin"] = answer["form"].pop("origin")
        log.append("origin стоял внутри form — поднят")
    items = answer.get("criteria")
    if isinstance(items, list):
        by_id = {}
        for item in items:
            criterion_id = item.get("id") if isinstance(item, dict) else None
            if criterion_id not in rubric_ids:
                log.append(f"в criteria лишний элемент «{criterion_id}» — отброшен")
                continue
            if criterion_id in by_id:
                log.append(f"критерий {criterion_id} дважды — взят последний")
            by_id[criterion_id] = item
        missing = [criterion_id for criterion_id in rubric_ids if criterion_id not in by_id]
        if missing:
            raise Failed(f"нет критерия {', '.join(missing)}")
        if [item.get("id") for item in items if isinstance(item, dict) and item.get("id") in rubric_ids] != list(rubric_ids):
            log.append("критерии не по порядку рубрики — переставлены")
        answer["criteria"] = [by_id[criterion_id] for criterion_id in rubric_ids]
    return answer


def parse_answer(text, kind, schema, log):
    answer = last_json(text or "")
    if answer is None:
        raise Failed("в ответе модели нет JSON с criteria")
    answer = repair(answer, kind, log)
    errors = contract.validate(answer, schema["$defs"][kind], schema)
    if errors:
        raise Failed("ответ не по схеме: " + "; ".join(errors[:3]))
    for item in answer["criteria"]:
        score = item["score"]
        top = RUBRIC_MAX.get(item["id"], 1)
        if score != NA and not any(contract.close(score, top * level) for level in (0, 0.5, 1)):
            raise Failed(f"{item['id']}: балл {score:g} вне шкалы 0 / {top / 2:g} / {top:g}")
    return answer


# ---------------------------------------------------------------- сверка цитат


def normalize(text):
    return re.sub(r"\s+", " ", NOISE_RE.sub("", text)).strip().casefold()


def quote_found(quote, haystack):
    """Цитата есть в тексте без учёта переносов, разметки и вида кавычек; «…» — пропуск между кусками."""
    pieces = [normalize(piece) for piece in ELLIPSIS_RE.split(quote)]
    return all(piece in haystack for piece in pieces if piece)


def cut(text, limit, log, where):
    if text is not None and len(text) > limit:
        log.append(f"{where}: длиннее {limit} симв. — обрезано")
        return text[:limit - 1] + "…"
    return text


# ---------------------------------------------------------------- документ


num = contract.num


def head(meta, row, repo):
    """Общие поля документа: путь, репозиторий, вид, ключ и название строки, автор, документ сверху."""
    source = meta["source"]["path"] if meta["source"] else None
    return {"path": meta["path"], "repo": repo, "kind": meta["kind"], "key": row["key"], "feature": row["feature"],
            "author": meta["author"], "source": source}


def failed_document(meta, row, repo, reason):
    return {**head(meta, row, repo), "scored": False, "skip_reason": reason}


def finding(criterion_id, item, haystack, log):
    """Строка findings у сниженного или «н/п» критерия: что не так (где искал), что исправить, одна цитата."""
    absent = [e for e in item["evidence"] if normalize(e["quote"]).rstrip(".") in NOT_FOUND]
    searched = list(item["searched"])
    if absent:
        searched += [e["section"] for e in absent if e["section"] not in searched]
        log.append(f"{criterion_id}: «не найдено» стояло цитатой — перенесено в «искал»")
    found = [e for e in item["evidence"] if e not in absent]
    comment = item["comment"]
    if item["score"] == NA and not comment:
        comment = found[0]["quote"] if found else "не применимо"
        log.append(f"{criterion_id}: «н/п» без причины своими словами — взята цитата")
    if searched:
        comment = f"{comment or 'не найдено'} (искал: {', '.join(searched)})"
    result = {"criterion": criterion_id, "comment": cut(comment, LIMITS["text"], log, criterion_id),
              "fix": cut(item["fix"], LIMITS["text"], log, criterion_id), "quote": None}
    if found:
        shown = found[:2] if criterion_id in PAIRED else found[:1]
        result["quote"] = cut(" ↔ ".join(f"{e['section']}: «{e['quote']}»" for e in shown), LIMITS["text"], log, criterion_id)
        if not all(quote_found(e["quote"], haystack) for e in shown):
            result["quote_found"] = False
    return result


def scored_document(meta, row, repo, answer, cfg, haystack, log):
    kind = meta["kind"]
    weights = params.weights(cfg, kind)
    criteria, findings = {}, []
    for item in answer["criteria"]:
        criterion_id = item["id"]
        if item["score"] == NA:
            criteria[criterion_id] = None  # «н/п» модели → null в выходе, причина — в findings
        else:
            criteria[criterion_id] = num(round(item["score"] / RUBRIC_MAX.get(criterion_id, 1) * weights[criterion_id], 4))
        if criteria[criterion_id] is None or criteria[criterion_id] < weights[criterion_id] - 1e-9:
            findings.append(finding(criterion_id, item, haystack, log))

    template = answer["template"]
    if not template["flag"] and template["fact"] is None:
        log.append("«шаблонно: нет» без факта")

    form_missing = []
    for item in answer["form"]["missing"]:
        if item["n"] in form_missing or item["n"] > params.FORM_SECTIONS[kind]:
            log.append(f"форма: раздел {item['n']} повтор или вне списка — отброшен")
            continue
        form_missing.append(item["n"])
    form_missing.sort()
    form_min = cfg["attention"]["form_min_missing"]

    origin, code_signs = None, None
    if kind == "spec":
        signs, traces = answer["origin"]["code_signs"], answer["origin"]["traces"]
        origin = contract.origin_verdict(signs, traces, not contract.off_form(len(form_missing), kind, form_min))
        code_signs = []
        for sign in signs:  # все признаки, что выписал оценщик, — и когда до «по коду» не дотянули
            item = {"n": sign["n"], "kind": contract.SIGN_KINDS[sign["n"]], "quote": cut(sign["quote"], LIMITS["text"], log, "origin")}
            if not quote_found(sign["quote"], haystack):
                item["quote_found"] = False
            code_signs.append(item)

    document = {**head(meta, row, repo), "scored": True, "pct": None, "sum": None, "max": None, "criteria": criteria,
                "attention": [], "template": template["flag"], "form_missing": form_missing, "form_pct": None, "form_score": None,
                "origin": origin, "code_signs": code_signs, "findings": findings}
    form_weight = params.form_weight(cfg, kind)
    document["form_pct"] = contract.form_pct(document)
    document["form_score"] = contract.form_score(document, form_weight)
    points, maximum, pct = contract.total(criteria, weights, document["form_score"], form_weight)
    document.update(pct=pct, sum=num(points), max=num(maximum))
    document["attention"] = contract.attention_reasons(document, cfg["attention"]["below_pct"], form_min)
    return document


def read(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def check_answers(work):
    """Ответы, которые merge не примет: нет файла, нет JSON, не по схеме, нет критерия, балл вне шкалы. → [(meta, причина)]."""
    collected = json.loads(read(os.path.join(work, "collect.json")))
    schema = json.loads(read(FINDINGS_SCHEMA_PATH))
    bad = []
    for meta in collected["documents"]:
        path = os.path.join(work, meta["answer"])
        try:
            if not os.path.exists(path):
                raise Failed("нет ответа модели")
            parse_answer(read(path), meta["kind"], schema, [])
        except Failed as error:
            bad.append((meta, str(error)))
    return bad, collected


def build(work, now=None):
    """→ ([(строка документа collect, выход specs-quality/6)], лог поправок, collect)."""
    collected = json.loads(read(os.path.join(work, "collect.json")))
    cfg = params.load(collected["params"])
    schema = json.loads(read(FINDINGS_SCHEMA_PATH))
    root, repo = collected["root"], collected["repo"]
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    weights = {kind: params.weights(cfg, kind) for kind in params.KINDS}
    form_weights = {kind: params.form_weight(cfg, kind) for kind in params.KINDS}
    row_of = {cell["document"]: row for row in collected["rows"] for cell in (row["bt"], row["spec"]) if "document" in cell}
    outputs, log = [], []
    for meta in collected["documents"]:
        doc_log = []
        row = row_of[meta["path"]]
        answer_path = os.path.join(work, meta["answer"])
        try:
            if not os.path.exists(answer_path):
                raise Failed("нет ответа модели")
            answer = parse_answer(read(answer_path), meta["kind"], schema, doc_log)
            haystack = read(os.path.join(root, meta["path"]))
            if meta["source"] and meta["source"]["path"]:
                haystack += "\n" + read(os.path.join(root, meta["source"]["path"]))
            document = scored_document(meta, row, repo, answer, cfg, normalize(haystack), doc_log)
        except Failed as error:
            document = failed_document(meta, row, repo, str(error))
            doc_log.append(f"оценка не состоялась: {error}")
        outputs.append((meta, contract.result(document, cfg["attention"]["below_pct"], cfg["attention"]["form_min_missing"],
                                              weights, form_weights, stamp)))
        log += [f"{meta['path']}: {line}" for line in doc_log]
    return outputs, log, collected


# ---------------------------------------------------------------- запись


HEAD_KEYS = ("path", "repo", "kind", "key", "feature", "author", "source")


def dump(output):
    """JSON для чтения глазами: короткие объекты и списки — в строку, находка и признак кода — строка."""
    j = lambda value: json.dumps(value, ensure_ascii=False)  # noqa: E731

    def pairs(item, keys):
        return ", ".join(f"{j(key)}: {j(item[key])}" for key in keys)

    def listed(name, items, last):
        if not items:
            return [f'  "{name}": []' + ("}" if last else ",")]
        return [f'  "{name}": [', ",\n".join("   " + j(item) for item in items), "  ]" + ("}" if last else ",")]

    document = output["document"]
    lines = ["{", " " + pairs(output, ("schema", "generated_at")) + ",", " " + pairs(output, ("params",)) + ",",
             ' "document": {' + pairs(document, HEAD_KEYS) + ","]
    if not document["scored"]:
        lines.append("  " + pairs(document, ("scored", "skip_reason")) + "}")
    else:
        lines.append("  " + pairs(document, ("scored", "pct", "sum", "max")) + ",")
        lines.append("  " + pairs(document, ("criteria",)) + ",")
        lines.append("  " + pairs(document, ("attention", "template", "form_missing", "form_pct", "form_score", "origin")) + ",")
        lines += listed("code_signs", document["code_signs"], False) if document["code_signs"] is not None \
            else ['  "code_signs": null,']
        lines += listed("findings", document["findings"], True)
    text = "\n".join(lines + ["}"]) + "\n"
    if json.loads(text) != output:  # раскладка не должна терять поля
        raise ValueError("раскладка итога разошлась с документом")
    return text


# ---------------------------------------------------------------- экран


def attention_lines(documents, cfg_labels):
    lines = []
    for document in documents:
        if not document["scored"] or not document["attention"]:
            continue
        kind = document["kind"]
        parts = [f"{document['key']} · {KIND_NAMES[kind]} {document['sum']:g} из {document['max']:g} ({document['pct']}%)"]
        for reason in document["attention"]:
            if reason == "zero":
                parts.append("ноль: " + ", ".join(cfg_labels[kind][c] for c in contract.zero_ids(document["criteria"])))
            elif reason == "off_form":
                parts.append(f"не по форме: нет {len(document['form_missing'])} из {params.FORM_SECTIONS[kind]} разделов")
            elif REASON_NAMES[reason]:
                parts.append(REASON_NAMES[reason])
        lines.append("- " + " · ".join(parts))
    return lines


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--work", required=True)
    parser.add_argument("--keep-work", action="store_true")
    parser.add_argument("--check", action="store_true", help="только перечислить ответы, которые надо перезапустить")
    args = parser.parse_args(argv)
    work = os.path.abspath(args.work)
    if args.check:
        try:
            bad, collected = check_answers(work)
        except (OSError, ValueError) as error:
            print(f"Не проверить ответы: {error}")
            return 2
        print(f"Ответов: {len(collected['documents'])}, годных: {len(collected['documents']) - len(bad)}, перезапустить: {len(bad)}")
        for meta, reason in bad:
            print(f"- {meta['id']}: {reason}\n  задание: {os.path.join(work, meta['task'])}\n  ответ: {os.path.join(work, meta['answer'])}")
        return 0
    try:
        outputs, log, collected = build(work)
        texts = [dump(output) for _meta, output in outputs]
    except (OSError, ValueError, params.ParamsError) as error:
        print(f"Не собрать итог: {error}")
        return 2
    out_schema = json.loads(read(contract.SCHEMA_PATH))
    errors = contract.check_schema_keywords(out_schema)
    for meta, output in outputs:
        errors += [f"{meta['path']}: {error}" for error in contract.check_document(output, out_schema)]
    if errors:
        print("Выход не прошёл contract.py — итоги не записаны, рабочая папка оставлена:")
        print("\n".join(errors))
        return 1
    for (meta, _output), text in zip(outputs, texts):
        with open(os.path.join(collected["root"], meta["output"]), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
    work_left = False
    if not args.keep_work:
        for _ in range(6):  # на Windows папку ненадолго держит сканер или чужой процесс
            shutil.rmtree(work, ignore_errors=True)
            if not os.path.exists(work):
                break
            time.sleep(0.5)
        work_left = os.path.exists(work)

    cfg = params.load(collected["params"])
    labels = {kind: {cid: params.label(cfg, kind, cid) for cid in params.CRITERIA[kind]} for kind in params.KINDS}
    documents = [output["document"] for _meta, output in outputs]
    scored = sum(1 for d in documents if d["scored"])
    print(f"Итоги: рядом с каждым документом — <имя>.quality.json, файлов {len(outputs)}")
    if work_left:
        print(f"Рабочая папка не удалена — её держит другой процесс: {work}. Итоги записаны; папку можно удалить руками.")
    print(f"Документов: {len(documents)}, оценено: {scored}, не состоялось: {len(documents) - scored}, "
          f"требуют внимания: {sum(1 for d in documents if d['scored'] and d['attention'])}")
    unverified = sum(1 for d in documents if d["scored"] for item in d["findings"] if item.get("quote_found") is False)
    if unverified:
        print(f"Цитат не найдено в тексте документа: {unverified} (quote_found: false, баллы не менялись)")
    if log:
        print(f"Поправлено в ответах модели: {len(log)}")
        print("\n".join("  " + line for line in log))
    print("")
    print("Требуют внимания:")
    lines = attention_lines(documents, labels)
    print("\n".join(lines) if lines else "Сильно некачественных документов нет.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
