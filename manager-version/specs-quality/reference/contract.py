#!/usr/bin/env python3
"""Контракт выхода specs-quality/6: схема и правила, которые схемой не выразить.

    python3 contract.py <документ>.quality.json   # «OK» или список нарушений, код выхода 1
    python3 contract.py --selftest                # пример и кейсы проходят, испорченные копии — нет

Без сторонних библиотек: на проме ничего не ставится. Валидатор понимает только
ключевые слова JSON Schema из specs-quality.schema.json; незнакомое слово в схеме —
ошибка, а не молчаливый пропуск. Формулы итога, подсветки и происхождения здесь же —
merge берёт их отсюда.
"""

from __future__ import annotations

import copy
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # соседние модули находятся и при `python -I`

import params  # noqa: E402
SCHEMA_PATH = os.path.join(HERE, "specs-quality.schema.json")
EXAMPLE_PATH = os.path.join(HERE, "specs-quality.example.json")
CASES_PATH = os.path.join(HERE, "specs-quality.cases.json")  # документы разных видов и случаев — для --selftest
FORMAT = "specs-quality/6"

KNOWN_KEYWORDS = {
    "$schema", "$id", "title", "description", "$defs", "$ref", "type", "enum", "const",
    "required", "properties", "additionalProperties", "items", "minItems", "maxItems",
    "minimum", "maximum", "exclusiveMinimum", "minLength", "maxLength", "format",
    "oneOf", "allOf", "not", "if", "then", "else",
}
DATE_TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")

FILE_NAMES = {"bt": "business_requirements.md", "spec": "technical_specification.md"}
# Признаки кода по номерам списка рубрики спеки — подпись идёт в выход рядом с цитатой.
SIGN_KINDS = {1: "сделано в коде", 2: "путь к исходнику", 3: "объём правки в строках", 4: "рефакторинг или тесты",
              5: "миграция или changelog", 6: "закрытое изменение источником"}


# ---------------------------------------------------------------- формулы


def round_half_up(number):
    return int(math.floor(round(number, 9) + 0.5))


def close(left, right):
    return abs(left - right) <= 1e-9


def score_ok(score, weight):
    """Балл с весом — 0, половина веса или вес: шкала рубрики 0 / 0.5 / 1, умноженная на вес."""
    return any(close(score, weight * level) for level in (0, 0.5, 1))


def total(criteria, weights, form_points, form_weight):
    """criteria — {критерий: балл с весом | None — «н/п»}, форма — её балл (None — не проверена) → (sum, max, pct)."""
    scored = {cid: score for cid, score in criteria.items() if score is not None}
    points = sum(scored.values())
    maximum = sum(weights[cid] for cid in scored)
    if form_points is not None:
        points += form_points
        maximum += form_weight
    pct = round_half_up(100.0 * points / maximum) if maximum else None
    return round(points, 4), round(maximum, 4), pct


def zero_ids(criteria):
    return [cid for cid, score in criteria.items() if score is not None and close(score, 0)]


def lowered_ids(criteria, weights):
    """Критерии, у которых должна быть строка findings: «н/п» (None) или балл ниже веса."""
    return [cid for cid, score in criteria.items() if score is None or score < weights[cid] - 1e-9]


def is_by_code(code_signs):
    """«По коду» — два разных признака, и среди них «уже сделано» (1, 3, 6): пути, рефакторинг и миграции (2, 4, 5)
    пишет и проект поверх существующего кода."""
    numbers = {sign["n"] for sign in code_signs}
    return len(numbers) >= 2 and bool(numbers & DONE_SIGNS)


def off_form(missing_count, kind, form_min):
    return missing_count >= form_min[kind]


DONE_SIGNS = {1, 3, 6}  # код этой задачи уже написан: сделано в прошедшем времени, объём в строках, закрытое изменение


def origin_verdict(code_signs, traces, form_intact):
    """Первое подходящее сверху. form_intact — форма проверена и цела."""
    if is_by_code(code_signs):
        return "by_code"
    if form_intact:
        return "skill"
    if len({trace["n"] for trace in traces}) >= 2:
        return "skill_edited"
    return "outside"


def num(value):
    """1.0 → 1: в выходе целые числа без хвоста."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def form_pct(document):
    """Доля разделов шаблона на месте; форма не проверена — None."""
    if document["form_missing"] is None:
        return None
    sections = params.FORM_SECTIONS[document["kind"]]
    return round_half_up(100.0 * (sections - len(document["form_missing"])) / sections)


def form_score(document, weight):
    """Балл формы в итоге: доля разделов на месте × вес, до сотых; форма не проверена — None."""
    if document["form_missing"] is None:
        return None
    sections = params.FORM_SECTIONS[document["kind"]]
    share = (sections - len(document["form_missing"])) / sections * weight
    return num(math.floor(round(share * 100, 9) + 0.5) / 100)


def result(document, below_pct, form_min, weights, form_weight, generated_at):
    """Выход по одному документу; form_min, weights и form_weight — по обоим видам, как в params.json, в выход — только его вида."""
    kind = document["kind"]
    return {"schema": FORMAT, "generated_at": generated_at,
            "params": {"below_pct": below_pct, "form_min_missing": form_min[kind], "weights": dict(weights[kind]),
                       "form_weight": form_weight[kind]},
            "document": document}


def attention_reasons(document, below_pct, form_min):
    reasons = []
    if document["pct"] is not None and document["pct"] < below_pct:
        reasons.append("below_pct")
    if zero_ids(document["criteria"]):
        reasons.append("zero")
    if document["template"]:
        reasons.append("template")
    if document["form_missing"] is not None and off_form(len(document["form_missing"]), document["kind"], form_min):
        reasons.append("off_form")
    return reasons  # «по коду» сюда не входит: это поле origin с доказательствами в code_signs, а не причина подсветки


# ---------------------------------------------------------------- валидатор схемы


def check_schema_keywords(schema, path="#"):
    """Незнакомое ключевое слово в схеме — ошибка: иначе правило молча не проверяется."""
    problems = []
    if not isinstance(schema, dict):
        return problems
    for key, value in schema.items():
        if key not in KNOWN_KEYWORDS:
            problems.append(f"{path}: валидатор не знает ключевого слова «{key}»")
            continue
        if key in ("properties", "$defs"):
            for name, sub in value.items():
                problems += check_schema_keywords(sub, f"{path}/{key}/{name}")
        elif key in ("oneOf", "allOf"):
            for number, sub in enumerate(value):
                problems += check_schema_keywords(sub, f"{path}/{key}/{number}")
        elif key in ("items", "not", "if", "then", "else", "additionalProperties"):
            problems += check_schema_keywords(value, f"{path}/{key}")
    return problems


def same(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    return type(left) is type(right) and left == right


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def type_ok(value, name):
    if name == "null":
        return value is None
    if name == "boolean":
        return isinstance(value, bool)
    if name == "integer":
        return is_number(value) and float(value).is_integer()
    if name == "number":
        return is_number(value)
    if name == "string":
        return isinstance(value, str)
    if name == "object":
        return isinstance(value, dict)
    if name == "array":
        return isinstance(value, list)
    raise ValueError(f"неизвестный тип в схеме: {name}")


def resolve(ref, root):
    if not ref.startswith("#/$defs/"):
        raise ValueError(f"поддерживаются только ссылки #/$defs/…, а не {ref}")
    return root["$defs"][ref[len("#/$defs/"):]]


def validate(value, schema, root, path="$"):
    errors = []
    if "$ref" in schema:
        errors += validate(value, resolve(schema["$ref"], root), root, path)

    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(type_ok(value, name) for name in names):
            return errors + [f"{path}: ожидался тип {' | '.join(names)}"]

    if "const" in schema and not same(value, schema["const"]):
        errors.append(f"{path}: ожидалось {json.dumps(schema['const'], ensure_ascii=False)}")
    if "enum" in schema and not any(same(value, option) for option in schema["enum"]):
        errors.append(f"{path}: значение не из списка {schema['enum']}")

    if is_number(value):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path}: меньше {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path}: больше {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append(f"{path}: должно быть больше {schema['exclusiveMinimum']}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path}: короче {schema['minLength']} симв.")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path}: длиннее {schema['maxLength']} симв.")
        if schema.get("format") == "date-time" and not DATE_TIME_RE.match(value):
            errors.append(f"{path}: не время ISO 8601 с часовым поясом")

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path}: элементов меньше {schema['minItems']}")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path}: элементов больше {schema['maxItems']}")
        if "items" in schema:
            for number, item in enumerate(value):
                errors += validate(item, schema["items"], root, f"{path}[{number}]")

    if isinstance(value, dict):
        for name in schema.get("required", ()):
            if name not in value:
                errors.append(f"{path}: нет поля «{name}»")
        properties = schema.get("properties", {})
        for name, item in value.items():
            if name in properties:
                errors += validate(item, properties[name], root, f"{path}.{name}")
            elif schema.get("additionalProperties") is False:
                errors.append(f"{path}: лишнее поле «{name}»")

    for sub in schema.get("allOf", ()):
        errors += validate(value, sub, root, path)
    if "oneOf" in schema:
        results = [validate(value, sub, root, path) for sub in schema["oneOf"]]
        fits = sum(1 for result in results if not result)
        if fits != 1:
            errors.append(f"{path}: должно подходить ровно под один вариант, подошло {fits}")
        if fits == 0:
            errors += min(results, key=len)  # ближайший вариант — его ошибки и есть причина
    if "not" in schema and not validate(value, schema["not"], root, path):
        errors.append(f"{path}: подходит под запрещённый вариант")
    if "if" in schema:
        branch = "then" if not validate(value, schema["if"], root, path) else "else"
        if branch in schema:
            errors += validate(value, schema[branch], root, path)
    return errors


# ---------------------------------------------------------------- правила вне схемы


def check_document_rules(document, doc_params):
    errors = []
    path, kind = document["path"], document["kind"]
    name = f"документ {path}"
    if not path.endswith("/" + FILE_NAMES[kind]) and path != FILE_NAMES[kind]:
        errors.append(f"{name}: вид {kind}, а имя файла не {FILE_NAMES[kind]}")
    if kind == "bt" and document["source"] is not None:
        errors.append(f"{name}: у БТ source должен быть null")
    if tuple(doc_params["weights"]) != params.CRITERIA[kind]:
        errors.append(f"params.weights: критерии {', '.join(doc_params['weights'])}, а у вида {kind} — {', '.join(params.CRITERIA[kind])}")
        return errors  # баллы и сумму по чужим весам не проверить
    if doc_params["form_min_missing"] > params.FORM_SECTIONS[kind]:
        errors.append(f"params.form_min_missing {doc_params['form_min_missing']} — больше разделов шаблона вида {kind} "
                      f"({params.FORM_SECTIONS[kind]})")
    if not document["scored"]:
        return errors
    if kind == "bt" and (document["origin"] is not None or document["code_signs"] is not None):
        errors.append(f"{name}: у БТ origin и code_signs должны быть null")
    if kind == "spec" and (document["origin"] is None or document["code_signs"] is None):
        errors.append(f"{name}: у спеки нужны origin и code_signs")
    if kind == "spec" and document["code_signs"] is not None:
        for sign in document["code_signs"]:
            if sign["kind"] != SIGN_KINDS[sign["n"]]:
                errors.append(f"{name}: признак {sign['n']} подписан «{sign['kind']}», по рубрике «{SIGN_KINDS[sign['n']]}»")
        if document["origin"] is not None and (document["origin"] == "by_code") != is_by_code(document["code_signs"]):
            numbers = sorted({sign["n"] for sign in document["code_signs"]})
            errors.append(f"{name}: origin {document['origin']}, а по признакам {numbers} «по коду» {'да' if is_by_code(document['code_signs']) else 'нет'}")

    criteria = document["criteria"]
    if tuple(criteria) != params.CRITERIA[kind]:
        errors.append(f"{name}: критерии {', '.join(criteria)}, а по рубрике {', '.join(params.CRITERIA[kind])}")
        return errors  # дальше счёт по чужим критериям бессмыслен
    weights = doc_params["weights"]
    for cid, score in criteria.items():
        if score is not None and not score_ok(score, weights[cid]):
            errors.append(f"{name}: {cid}: балл {score:g} не из шкалы 0 / {weights[cid] / 2:g} / {weights[cid]:g}")
    missing = document["form_missing"]
    if missing is not None and (missing != sorted(set(missing)) or any(n > params.FORM_SECTIONS[kind] for n in missing)):
        errors.append(f"{name}: form_missing — не по возрастанию, с повтором или вне списка 1–{params.FORM_SECTIONS[kind]}")

    if document["form_pct"] != form_pct(document):
        errors.append(f"{name}: form_pct {document['form_pct']}, по form_missing {form_pct(document)}")
    form_points = form_score(document, doc_params["form_weight"])
    if (document["form_score"] is None) != (form_points is None) or (form_points is not None and not close(document["form_score"], form_points)):
        errors.append(f"{name}: form_score {document['form_score']}, по form_missing {form_points}")

    points, maximum, pct = total(criteria, weights, form_points, doc_params["form_weight"])
    if not close(document["sum"], points):
        errors.append(f"{name}: sum {document['sum']:g}, по критериям и форме {points:g}")
    if not close(document["max"], maximum):
        errors.append(f"{name}: max {document['max']:g}, по весам без «н/п» с формой {maximum:g}")
    if document["pct"] != pct:
        errors.append(f"{name}: pct {document['pct']}, по формуле {pct}")

    expected = attention_reasons(document, doc_params["below_pct"], {kind: doc_params["form_min_missing"]})
    if document["attention"] != expected:
        errors.append(f"{name}: attention {document['attention']}, по правилам {expected}")

    finding_ids = [item["criterion"] for item in document["findings"]]
    expected_ids = lowered_ids(criteria, weights)
    if finding_ids != expected_ids:
        errors.append(f"{name}: findings по {finding_ids}, а нужны ровно по {expected_ids} — сниженные и «н/п» по порядку рубрики")
    return errors


def check_invariants(doc):
    return check_document_rules(doc["document"], doc["params"])


# ---------------------------------------------------------------- вход


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def check_document(doc, schema):
    errors = validate(doc, schema, schema)
    if errors:
        return errors  # правила вне схемы опираются на её форму
    return check_invariants(doc)


def selftest():
    schema = load_json(SCHEMA_PATH)
    problems = check_schema_keywords(schema)
    example = load_json(EXAMPLE_PATH)
    problems += [f"пример: {error}" for error in check_document(example, schema)]
    cases = load_json(CASES_PATH)
    case_params = cases["params"]

    def case(tail):
        """Выход по документу кейсов, чей путь кончается на tail."""
        document = next(item for item in cases["documents"] if item["path"].endswith(tail))
        return copy.deepcopy(result(document, case_params["below_pct"], case_params["form_min_missing"],
                                    case_params["weights"], case_params["form_weight"], cases["generated_at"]))

    def recount(output):
        """Верный вариант поменял баллы или форму — производные поля пересчитываются, проверяется другое правило."""
        d, p = output["document"], output["params"]
        d["form_pct"] = form_pct(d)
        d["form_score"] = form_score(d, p["form_weight"])
        points, maximum, pct = total(d["criteria"], p["weights"], d["form_score"], p["form_weight"])
        d.update(sum=num(points), max=num(maximum), pct=pct)

    for item in cases["documents"]:
        problems += [f"кейс {item['path']}: {error}" for error in check_document(case(item["path"]), schema)]

    good_bt, good_spec = "PRJ-101/business_requirements.md", "PRJ-101/technical_specification.md"
    zero_bt, part_spec = "PRJ-102/business_requirements.md", "PRJ-102/technical_specification.md"
    bug_spec, epic_bt = "PRJ-103/technical_specification.md", "PRJ-104/business_requirements.md"
    fnd_spec, code_spec = "_foundation/technical_specification.md", "PRJ-105/technical_specification.md"
    scored_fields = ("pct", "sum", "max", "criteria", "attention", "template", "form_missing", "form_pct", "form_score", "origin",
                     "code_signs", "findings")

    def swap_criteria(d):
        keys = list(d["document"]["criteria"])
        keys[1], keys[2] = keys[2], keys[1]
        d["document"]["criteria"] = {key: d["document"]["criteria"][key] for key in keys}

    def fail_document(d):
        for field in scored_fields:
            d["document"].pop(field)
        d["document"].update(scored=False, skip_reason="нет ответа модели")

    def spec_exactly_half(d):  # 50% — не «ниже 50%»: подсвечивает только ноль; 2.5 + форма 1 из 7
        item = d["document"]
        item["criteria"] = dict(zip(params.CRITERIA["spec"], (1, 0.5, 0.5, 0, 0, 0.5)))
        item["attention"] = ["zero"]
        item["findings"].insert(2, {"criterion": "services", "comment": "дыра", "fix": "x", "quote": None})

    # Порча → ожидаемый кусок сообщения. Известный результат, а не «хоть какая-то ошибка».
    doc = lambda d: d["document"]  # noqa: E731
    broken = [
        ("сумма частей", good_spec, lambda d: doc(d).update(sum=4), "sum 4, по критериям и форме 6.46"),
        ("максимум без вычета н/п", fnd_spec, lambda d: doc(d).update(max=7), "max 7, по весам без «н/п» с формой 6"),
        ("процент", zero_bt, lambda d: doc(d).update(pct=77), "pct 77, по формуле 86"),
        ("балл формы", good_spec, lambda d: doc(d).update(form_score=1), "form_score 1, по form_missing 0.96"),
        ("вес формы не тот, каким считали", good_bt, lambda d: d["params"].update(form_weight=2), "form_score 1, по form_missing 2"),
        ("ноль без причины", zero_bt, lambda d: doc(d).update(attention=[]), "attention [], по правилам ['zero']"),
        ("не по форме без причины", epic_bt, lambda d: doc(d).update(attention=[]), "по правилам ['off_form']"),
        ("причина без повода", good_bt, lambda d: doc(d).update(attention=["zero"]), "attention ['zero'], по правилам []"),
        ("лишняя причина", code_spec, lambda d: doc(d)["attention"].append("template"), "по правилам ['below_pct', 'zero', 'off_form']"),
        ("н/п не на своём месте", bug_spec, swap_criteria, "критерии source_logic, access, data_model"),
        ("балл не из шкалы", good_spec, lambda d: doc(d)["criteria"].update(access=0.7), "access: балл 0.7 не из шкалы 0 / 0.5 / 1"),
        ("балл цели по шкале критерия", good_bt, lambda d: doc(d)["criteria"].update(goal=1), "goal: балл 1 не из шкалы 0 / 0.25 / 0.5"),
        ("вес в params не тот, каким считали", good_bt, lambda d: d["params"]["weights"].update(roles=2),
         "max 7, по весам без «н/п» с формой 8"),
        ("веса чужого вида", good_bt, lambda d: d["params"].update(weights=dict(case_params["weights"]["spec"])),
         "params.weights: критерии source_logic, data_model, access, services, contracts, consistency, а у вида bt"),
        ("порог формы больше разделов вида", good_bt, lambda d: d["params"].update(form_min_missing=20), "больше разделов шаблона вида bt (16)"),
        ("нет находки у сниженного", part_spec, lambda d: doc(d)["findings"].pop(0),
         "нужны ровно по ['data_model', 'access', 'contracts', 'consistency']"),
        ("находка у полного балла", good_bt, lambda d: doc(d)["findings"].append({"criterion": "roles", "comment": "x", "fix": None, "quote": None}),
         "findings по ['roles'], а нужны ровно по []"),
        ("находки не по порядку", part_spec, lambda d: doc(d)["findings"].reverse(),
         "нужны ровно по ['data_model', 'access', 'contracts', 'consistency']"),
        ("по коду без признака «уже сделано»", code_spec, lambda d: doc(d)["code_signs"][0].update(n=4, kind="рефакторинг или тесты"),
         "origin by_code, а по признакам [2, 4] «по коду» нет"),
        ("по коду на одном номере дважды", code_spec, lambda d: doc(d)["code_signs"].__setitem__(1, dict(doc(d)["code_signs"][0])),
         "origin by_code, а по признакам [1] «по коду» нет"),
        ("признаки «по коду», а origin другой", part_spec, lambda d: doc(d)["code_signs"].insert(0, {"n": 1, "kind": "сделано в коде", "quote": "x"}),
         "origin skill, а по признакам [1, 2] «по коду» да"),
        ("подпись признака не к номеру", code_spec, lambda d: doc(d)["code_signs"][1].update(n=3),
         "признак 3 подписан «путь к исходнику», по рубрике «объём правки в строках»"),
        ("находка origin в findings", code_spec, lambda d: doc(d)["findings"].append({"criterion": "origin", "comment": "x", "fix": None, "quote": None}),
         "нужны ровно по ['source_logic', 'data_model', 'access', 'contracts']"),
        ("origin у БТ", good_bt, lambda d: doc(d).update(origin="outside"), "у БТ origin и code_signs должны быть null"),
        ("признаки у БТ", good_bt, lambda d: doc(d).update(code_signs=[]), "у БТ origin и code_signs должны быть null"),
        ("спека без признаков", good_spec, lambda d: doc(d).update(code_signs=None), "у спеки нужны origin и code_signs"),
        ("source у БТ", good_bt, lambda d: doc(d).update(source="coddoc/x/bug_report.md"), "у БТ source должен быть null"),
        ("форма не по возрастанию", epic_bt, lambda d: doc(d).update(form_missing=[3, 1, 4, 6, 7, 10, 13, 14, 15]), "form_missing — не по возрастанию"),
        ("номер раздела вне списка", good_spec, lambda d: doc(d).update(form_missing=[19, 24]), "вне списка 1–23"),
        ("вид не по имени файла", good_spec, lambda d: doc(d).update(kind="bt"), "вид bt, а имя файла не business_requirements.md"),
        ("не оценён, а баллы есть", good_bt, lambda d: doc(d).update(scored=False, skip_reason="нет ответа"), "запрещённый вариант"),
        ("не оценён без причины", good_bt, lambda d: [doc(d).pop(f) for f in scored_fields] and doc(d).update(scored=False),
         "нет поля «skip_reason»"),
        ("оценён с причиной пропуска", good_bt, lambda d: doc(d).update(skip_reason="лишнее"), "запрещённый вариант"),
        ("чужой критерий", good_bt, lambda d: doc(d)["criteria"].update(contracts=1), "лишнее поле «contracts»"),
        ("quote_found: true", part_spec, lambda d: doc(d)["findings"][0].update(quote_found=True), "ожидалось false"),
        ("н/п строкой с опечаткой", bug_spec, lambda d: doc(d)["criteria"].update(access="н.п"), "ожидался тип number"),
        ("поле старого формата", good_bt, lambda d: d.update(documents=[]), "лишнее поле «documents»"),
        ("старая версия формата", good_bt, lambda d: d.update(schema="specs-quality/5"), 'ожидалось "specs-quality/6"'),
        ("нет repo", good_bt, lambda d: doc(d).pop("repo"), "нет поля «repo»"),
        ("form_pct документа", good_spec, lambda d: doc(d).update(form_pct=90), "form_pct 90, по form_missing 96"),
        ("время без пояса", good_bt, lambda d: d.update(generated_at="2026-10-28T15:00:00"), "часовым поясом"),
        ("true вместо числа", good_bt, lambda d: doc(d)["criteria"].update(roles=True), "ожидался тип number"),
    ]
    for name, tail, spoil, expected in broken:
        output = case(tail)
        spoil(output)
        errors = check_document(output, schema)
        if not any(expected in error for error in errors):
            problems.append(f"порча «{name}»: ждали «{expected}», получили {errors or 'OK'}")

    valid = [
        ("оценка не состоялась", good_bt, fail_document),
        ("шаблонно — с причиной подсветки", good_bt, lambda d: doc(d).update(template=True, attention=["template"])),
        ("форма не проверена — подсветки нет", epic_bt, lambda d: doc(d).update(form_missing=None, attention=[])),
        ("БТ без 5 разделов — не по форме", good_bt, lambda d: doc(d).update(form_missing=[1, 2, 3, 4, 5], attention=["off_form"])),
        ("БТ без 4 разделов — по форме", good_bt, lambda d: doc(d).update(form_missing=[1, 2, 3, 4])),
        ("ровно 50% — не ниже порога", part_spec, spec_exactly_half),
    ]
    for name, tail, change in valid:
        output = case(tail)
        change(output)
        if output["document"]["scored"]:
            recount(output)
        errors = check_document(output, schema)
        if errors:
            problems.append(f"верный вариант «{name}» не прошёл: {errors}")

    total_cases = 1 + len(cases["documents"]) + len(broken) + len(valid)
    if problems:
        print("\n".join(problems))
        print(f"selftest: провалов {len(problems)} из {total_cases} случаев")
        return 1
    print(f"selftest: {total_cases}/{total_cases}")
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
    schema = load_json(SCHEMA_PATH)
    errors = check_schema_keywords(schema) + check_document(load_json(argv[1]), schema)
    if errors:
        print("\n".join(errors))
        return 1
    print(f"OK: {argv[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
