#!/usr/bin/env python3
"""Контракт выхода session-quality/7: схема и правила, которые схемой не выразить.

    python3 contract.py <id>.quality.json   # «OK» или список нарушений, код выхода 1
    python3 contract.py --selftest          # пример проходит, испорченные копии — нет

Без сторонних библиотек: на проме ничего не ставится. Валидатор понимает только
ключевые слова JSON Schema из session-quality.schema.json; незнакомое слово в схеме —
ошибка, а не молчаливый пропуск. Формулы скора здесь же — merge берёт их отсюда.
"""

from __future__ import annotations

import copy
import json
import math
import os
import re
import sys
from datetime import datetime

import params

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(HERE, "session-quality.schema.json")
EXAMPLE_PATH = os.path.join(HERE, "session-quality.example.json")

FORMAT = "session-quality/7"
METRIC_IDS = params.IMPLEMENTED_METRICS
VALUE_TOLERANCE = 0.0005  # value в выходе округлён до трёх знаков

KNOWN_KEYWORDS = {
    "$schema", "$id", "title", "description", "$defs", "$ref", "type", "enum", "const",
    "required", "properties", "additionalProperties", "items", "minItems", "maxItems",
    "minimum", "maximum", "exclusiveMinimum", "minLength", "maxLength", "format",
    "oneOf", "allOf", "not", "if", "then", "else",
}
DATE_TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")


# ---------------------------------------------------------------- формулы


def round_half_up(number):
    return int(math.floor(round(number, 9) + 0.5))


def metric_score(value, good, bad):
    ratio = (value - bad) / (good - bad)
    return round_half_up(max(0.0, min(1.0, ratio)) * 100)


def measured_weight(metrics):
    total = sum(metric["weight"] for metric in metrics)
    measured = sum(metric["weight"] for metric in metrics if metric["status"] == "measured")
    return 100.0 * measured / total if total else 0.0


def total_score(metrics):
    measured = [metric for metric in metrics if metric["status"] == "measured"]
    weight = sum(metric["weight"] for metric in measured)
    if not weight:
        return None
    return round_half_up(sum(metric["weight"] * metric["score"] for metric in measured) / weight)


def score_status(weight_share, fraud_status, min_weight):
    if weight_share < min_weight:
        return "insufficient"
    if fraud_status == "to_review":
        return "hold"
    return "final"


def num(value):
    """1.0 → 1: в выходе целые числа без хвоста."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def session_score(metrics, min_weight):
    """Скор сессии как у документа: sum — Σ вес × скор / 100 по измеренным метрикам, max — Σ их весов, pct = sum / max × 100;
    измерено меньше min_weight % веса — pct = None. → {pct, sum, max}."""
    measured = [metric for metric in metrics if metric["status"] == "measured"]
    points = sum(metric["weight"] * metric["score"] for metric in measured) / 100
    maximum = sum(metric["weight"] for metric in measured)
    pct = total_score(metrics) if measured_weight(metrics) >= min_weight else None
    return {"pct": pct, "sum": num(round(points, 2)), "max": num(maximum)}


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


def parse_time(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def close(left, right):
    return abs(left - right) <= VALUE_TOLERANCE + 1e-9  # ровно полшага округления — не расхождение


def check_invariants(doc):
    errors = []
    session = doc["session"]
    start, end = parse_time(session["start"]), parse_time(session["end"])
    if end < start:
        errors.append(f"сессия {session['id']}: конец раньше начала")
    elif session["duration_sec"] != round((end - start).total_seconds()):
        errors.append(f"сессия {session['id']}: duration_sec не равен концу минус начало")
    for signal in doc["fraud"]["signals"]:
        if signal["count"] < len(signal["evidence"]):
            errors.append(f"фрод {signal['kind']}: count меньше числа доказательств")
    if not session["scored"]:
        return errors

    metrics = doc["metrics"]
    by_id = {}
    for metric in metrics:
        if metric["id"] in by_id:
            errors.append(f"метрика {metric['id']} встречается дважды")
        by_id[metric["id"]] = metric
    missing = [metric_id for metric_id in METRIC_IDS if metric_id not in by_id]
    if missing:
        errors.append(f"нет метрик: {', '.join(missing)}")

    min_events = doc["params"]["min_events"]
    for metric in metrics:
        name, hits, events = metric["id"], metric["hits"], metric["events"]
        if metric["good"] == metric["bad"]:
            errors.append(f"{name}: good и bad совпадают — скор не посчитать")
        if hits > events:
            errors.append(f"{name}: hits {hits} больше events {events}")
            continue
        if metric["status"] == "measured":
            if events < min_events or not events:
                errors.append(f"{name}: событий {events} — меньше {max(min_events, 1):g}, а метрика посчитана")
            elif not close(metric["value"], hits / events):
                errors.append(f"{name}: value {metric['value']:g}, по hits / events {round(hits / events, 3):g}")
            expected = metric_score(metric["value"], metric["good"], metric["bad"])
            if metric["score"] != expected:
                errors.append(f"{name}: score {metric['score']}, по формуле {expected}")
        else:
            if events and events >= min_events:
                errors.append(f"{name}: событий {events} хватает, а метрика не измерена")
            if metric["evidence"]:
                errors.append(f"{name}: не измерена, а доказательства есть")
        if metric.get("end_break") and hits >= events:
            errors.append(f"{name}: end_break — последний запуск брошен, а обрывов нет (hits {hits} из {events})")

    if not missing:
        expected = session_score(metrics, doc["params"]["min_measured_weight"])
        for field in ("sum", "max"):
            if abs(session[field] - expected[field]) > 0.01:
                errors.append(f"session.{field} {session[field]:g}, по метрикам {expected[field]:g}")
        if session["pct"] != expected["pct"]:
            errors.append(f"session.pct {session['pct']}, по формуле {expected['pct']}")

    topic = doc["discipline"]["off_topic"]
    if topic["cases"] < len(topic["evidence"]):
        errors.append("посторонние темы: cases меньше числа примеров")
    return errors


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

    def metric(doc, metric_id):
        return next(item for item in doc["metrics"] if item["id"] == metric_id)

    def rescore(doc):
        doc["session"].update(session_score(doc["metrics"], doc["params"]["min_measured_weight"]))

    def no_fraud(doc):
        doc["fraud"] = {"status": "none", "signals": []}

    def skipped(doc):  # короткая сессия: ни скора, ни метрик, ни посторонних тем; фрод и окружение — как у любой
        for field in ("metrics", "discipline"):
            doc.pop(field)
        for field in ("pct", "sum", "max"):
            doc["session"].pop(field)
        doc["session"].update(scored=False, skip_reason="меньше 3 реплик пользователя")

    def few_events_only(doc):  # три метрики не измерены, скор сессии не пересчитан — для порчи
        for metric_id, events in (("blind_confirms", 3), ("completion", 2), ("loaded_context", 2)):
            metric(doc, metric_id).update(status="not_measured", value=None, score=None, evidence=[],
                                          reason=f"мало событий: {events}, нужно от 5")

    def few_events(doc):
        doc["params"]["min_events"] = 5
        for metric_id, events in (("blind_confirms", 3), ("completion", 2), ("loaded_context", 2)):
            metric(doc, metric_id).update(status="not_measured", value=None, score=None, evidence=[],
                                          reason=f"мало событий: {events}, нужно от 5")
        rescore(doc)

    def mostly_unmeasured(doc):
        doc["params"]["min_events"] = 8
        for metric_id in ("active_review", "blind_confirms", "delegated", "ignored", "completion", "loaded_context"):
            item = metric(doc, metric_id)
            item.update(status="not_measured", value=None, score=None, evidence=[], reason=f"мало событий: {item['events']}, нужно от 8")
        rescore(doc)

    # Порча → ожидаемый кусок сообщения. Известный результат, а не «хоть какая-то ошибка».
    broken = [
        ("доля не по hits / events", lambda d: metric(d, "loaded_context").update(value=0.4), "loaded_context: value 0.4, по hits / events 0.5"),
        ("hits больше events", lambda d: metric(d, "active_review").update(hits=9), "active_review: hits 9 больше events 7"),
        ("нет метрики", lambda d: d["metrics"].pop(), "нет метрик: skill_share"),
        ("метрика дважды", lambda d: metric(d, "skill_share").update(id="active_review"), "встречается дважды"),
        ("длинная цитата", lambda d: metric(d, "completion")["evidence"][0].update(quote="а" * 201), "quote: длиннее 200 симв."),
        ("категория в метрике", lambda d: metric(d, "completion")["evidence"].append({"turn": 50, "category": "personal", "turns": 1}),
         "лишнее поле «category»"),
        ("цитата у посторонних", lambda d: d["discipline"]["off_topic"]["evidence"][0].update(quote="личное"), "лишнее поле «quote»"),
        ("посчитана при малом числе событий", lambda d: d["params"].update(min_events=5), "blind_confirms: событий 3 — меньше 5"),
        ("не измерена при хватающих событиях", lambda d: metric(d, "ignored").update(status="not_measured", value=None, score=None, reason="нет"),
         "ignored: событий 7 хватает, а метрика не измерена"),
        ("не измерена, а доказательства есть", lambda d: (d["params"].update(min_events=5),
                                                         metric(d, "loaded_context").update(status="not_measured", value=None, score=None, reason="мало")),
         "loaded_context: не измерена, а доказательства есть"),
        ("не измерена, а число есть", lambda d: metric(d, "skill_share").update(status="not_measured", reason="нет"),
         "$.metrics[6].value: ожидался тип null"),
        ("end_break не у completion", lambda d: metric(d, "skill_share").update(end_break=False), "запрещённый вариант"),
        ("completion без end_break", lambda d: metric(d, "completion").pop("end_break"), "нет поля «end_break»"),
        ("end_break без обрыва", lambda d: metric(d, "completion").update(hits=2, value=1.0), "end_break — последний запуск брошен, а обрывов нет"),
        ("оценена с причиной пропуска", lambda d: d["session"].update(skip_reason="лишнее"), "запрещённый вариант"),
        ("не оценена, а метрики есть", lambda d: d["session"].update(scored=False, skip_reason="меньше 3 реплик пользователя"),
         "запрещённый вариант"),
        ("оценена без метрик", lambda d: d.pop("metrics"), "нет поля «metrics»"),
        ("нет пользователя", lambda d: d["session"].pop("user"), "нет поля «user»"),
        ("доказательство с сессией", lambda d: metric(d, "active_review")["evidence"][0].update(session="1f6a2c90"), "лишнее поле «session»"),
        ("поле старого формата", lambda d: d.update(subject={}), "лишнее поле «subject»"),
        ("старая версия формата", lambda d: d.update(schema="session-quality/6"), 'ожидалось "session-quality/7"'),
        ("скор сессии не по формуле", lambda d: d["session"].update(pct=70), "session.pct 70, по формуле 54"),
        ("сумма баллов сессии", lambda d: d["session"].update(sum=40), "session.sum 40, по метрикам 34.9"),
        ("максимум сессии с неизмеренными", lambda d: (d["params"].update(min_events=5), few_events_only(d), d["session"].update(max=65)),
         "session.max 65, по метрикам 35"),
        ("скор метрики не по формуле", lambda d: metric(d, "delegated").update(score=62), "delegated: score 62, по формуле 63"),
        ("оценена без скора", lambda d: d["session"].pop("pct"), "нет поля «pct»"),
        ("скор у неоценённой", lambda d: (skipped(d), d["session"].update(pct=50)), "запрещённый вариант"),
        ("не измерена, а скор есть", lambda d: (d["params"].update(min_events=5),
                                                 metric(d, "loaded_context").update(status="not_measured", value=None, evidence=[], reason="мало")),
         "$.metrics[5].score: ожидался тип null"),
        ("фрод none с сигналами", lambda d: d["fraud"].update(status="none"), "элементов больше 0"),
        ("неизвестный вид фрода", lambda d: d["fraud"]["signals"][0].update(kind="repeat_requests"), "значение не из списка"),
        ("длительность", lambda d: d["session"].update(duration_sec=2600), "сессия 1f6a2c90: duration_sec"),
        ("время без пояса", lambda d: d.update(generated_at="2026-10-27T15:00:00"), "часовым поясом"),
        ("true вместо 1", lambda d: metric(d, "skill_share").update(weight=True), "ожидался тип number"),
    ]
    for name, spoil, expected in broken:
        doc = copy.deepcopy(example)
        spoil(doc)
        errors = check_document(doc, schema)
        if not any(expected in error for error in errors):
            problems.append(f"порча «{name}»: ждали «{expected}», получили {errors or 'OK'}")

    valid = [("без фрода", no_fraud), ("сессия не оценена — фрод и окружение остаются", skipped),
             ("мало событий — метрики не измерены, скор по остальным", few_events),
             ("измерена одна работа через скиллы — скора нет, сумма и максимум есть", mostly_unmeasured)]
    for name, change in valid:
        doc = copy.deepcopy(example)
        change(doc)
        errors = check_document(doc, schema)
        if errors:
            problems.append(f"верный вариант «{name}» не прошёл: {errors}")

    total = 1 + len(broken) + len(valid)
    if problems:
        print("\n".join(problems))
        print(f"selftest: провалов {len(problems)} из {total} случаев")
        return 1
    print(f"selftest: {total}/{total}")
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
