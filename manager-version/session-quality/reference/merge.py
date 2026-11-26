#!/usr/bin/env python3
"""merge — последний шаг оценки: факты collect + находки модели → session-quality/7 рядом с каждой сессией.

    python3 merge.py --work <папка collect> [--params <файл>] [--keep-work]

В --work лежат collect.json, <id>.facts.json, <id>.journal.txt (их пишет collect) и <id>.findings.txt — ответ
модели на brief.md как есть. Пишет рядом с выгрузкой каждой сессии <id>.quality.json (проверен contract.py; скор сессии —
session.pct / sum / max), отчёт <id>.quality.md и <id>.quality.log.txt: что из ответа модели отброшено и вердикты.
Хоть один выход не прошёл contract — не пишется ни один, рабочая папка остаётся для разбора.

Модель ничего не считает: доли, скоры и статусы считаются здесь, пороги и веса — из params.json (или --params).
Находка модели без подтверждённой цитаты выпадает; у посторонней темы пересказ вырезается; битая находка
отбрасывается одна, а не весь ответ; находка одного вида — одна на ход.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

import collect
import contract
import params

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(HERE, "session-quality.schema.json")
FINDINGS_SCHEMA_PATH = os.path.join(HERE, "findings.schema.json")

SOURCES = {"active_review": "script+model", "blind_confirms": "script+model", "delegated": "script+model",
           "ignored": "script+model", "completion": "script+model",
           "loaded_context": "script", "skill_share": "script"}
UNDECIDED = "?"  # спорная концовка запуска без вердикта модели
FRAUD_NAMES = {"deception": "Неподтверждённое выдаётся за подтверждённое", "bypass": "Обход правил и проверок",
               "autoinput": "Автоматический ввод"}

EVENT_RE = re.compile(r"^\[(\d+)\] (.*)$")
CHECK_RE = re.compile(r"^- (\w+) \[(\d+)\]:")


# ---------------------------------------------------------------- журнал и ответ модели


VERDICTS_HEADER = "Вердикты ([ход] проверка: вердикт):"


def parse_journal(text):
    """(события по ходам, ходы пользователя по порядку, кандидаты раздела «Проверить»)."""
    body, _, checks = text.partition(collect.CHECKS_HEADER)
    events, users = {}, []
    for line in body.splitlines():
        match = EVENT_RE.match(line)
        if not match:
            continue
        turn, content = int(match.group(1)), match.group(2)
        events.setdefault(turn, []).append(content)
        if content.startswith(collect.USER_LABEL + ":") and turn not in users:
            users.append(turn)
    candidates = [(m.group(1), int(m.group(2))) for m in map(CHECK_RE.match, checks.splitlines()) if m]
    return events, users, candidates


def extract_json(text):
    """(объект, пометки, ошибка). Обёртку ``` терпим. Объектов несколько — модель поправила себя после первого
    ответа: берём последний."""
    decoder, objects, index = json.JSONDecoder(), [], 0
    while True:
        start = text.find("{", index)
        if start < 0:
            break
        try:
            value, end = decoder.raw_decode(text, start)
        except ValueError:
            index = start + 1
            continue
        if isinstance(value, dict):
            objects.append(value)
        index = end
    notes = ["ответ в обёртке ```"] if "```" in text else []
    if not objects:
        return None, notes, "не JSON"
    if len(objects) > 1:
        notes.append(f"самоисправление: объектов {len(objects)}, взят последний")
    return objects[-1], notes, None


def norm(text):
    return re.sub(r"\s+", " ", text).strip().strip("«»\"' ")


def quote_in(quote, lines):
    """Цитата есть в одной из строк хода; «…» внутри цитаты — пропуск, куски идут по порядку."""
    pieces = [norm(piece).strip(". ") for piece in norm(quote).split("…")]
    pieces = [piece for piece in pieces if piece]
    if not pieces:
        return False
    for line in lines:
        flat, start = norm(line), 0
        for piece in pieces:
            found = flat.find(piece, start)
            if found < 0:
                break
            start = found + len(piece)
        else:
            return True
    return False


def event_quote(events, turn, prefixes=()):
    """Цитата из журнала для доказательства, которое нашёл скрипт: строка хода с нужной меткой, до 200 символов."""
    lines = [line for line in events[turn] if line.startswith(prefixes)] if prefixes else []
    return collect.clip((lines or events[turn])[0], 199)


def line_quote(events, turn):
    """Текст хода без метки — для реплик пользователя; в ходе с вопросом агента — строка ответа, а не вопроса."""
    lines = events[turn]
    content = next((line for line in lines if line.startswith(("ОТВЕТ:", collect.USER_LABEL + ":"))), lines[0])
    content = content.split(": ", 1)[1] if ": " in content else content
    return collect.clip(content, 199)


def model_findings(session_id, raw, events, users, candidates, schema, log, hidden=()):
    """Проверенные находки модели по сессии; None — ответа нет или он не разобрался. hidden — реплики из одних
    заглушек вставки: находки на них не судимы и отбрасываются."""
    if raw is None:
        log(f"{session_id}: нет ответа модели")
        return None
    answer, notes, error = extract_json(raw)
    for note in notes:
        log(f"{session_id}: {note}")
    if error or not isinstance(answer.get("findings"), list) or not isinstance(answer.get("checks"), list):
        log(f"{session_id}: ответ модели не разобран — {error or 'нет findings или checks'}")
        return None
    defs = schema["$defs"]
    result = {"deception": [], "bypass": {}, "off_topic": [], "checks": {}}
    for item in answer["findings"]:
        if not isinstance(item, dict):
            log(f"{session_id}: находка не объект — отброшена")
            continue
        if item.get("type") == "off_topic" and "note" in item:
            item = {key: value for key, value in item.items() if key != "note"}
            log(f"{session_id}: у посторонней темы в ходе {item.get('turn')} вырезан пересказ")
        definition = defs["topic_finding"] if item.get("type") == "off_topic" else defs["quote_finding"]
        errors = contract.validate(item, definition, schema)
        if errors:
            log(f"{session_id}: находка отброшена — {errors[0]}")
            continue
        turn = item["turn"]
        if turn in hidden:
            log(f"{session_id}: {item['type']} в ходе {turn} — реплика из заглушки вставки, текста нет, отброшена")
            continue
        if item["type"] == "off_topic":
            if turn not in users:
                log(f"{session_id}: посторонняя тема с хода {turn} — не реплика пользователя, отброшена")
                continue
            start = users.index(turn)
            covered = users[start:start + item["turns"]]
            result["off_topic"].append({"session": session_id, "turn": turn, "category": item["category"],
                                        "turns": len(covered), "covered": covered})
            continue
        if turn not in events or not quote_in(item["quote"], events[turn]):
            log(f"{session_id}: {item['type']} в ходе {turn} — цитата не подтвердилась, отброшена")
            continue
        entry = {"session": session_id, "turn": turn, "quote": item["quote"]}
        if item["type"] == "bypass":
            result["bypass"].setdefault(turn, entry)
        elif any(found["turn"] == turn for found in result[item["type"]]):
            log(f"{session_id}: {item['type']} в ходе {turn} — на ходе уже есть такая находка, отброшена")
        else:
            result[item["type"]].append(entry)
    for item in answer["checks"]:
        if not isinstance(item, dict) or contract.validate(item, defs["check"], schema):
            log(f"{session_id}: ответ на проверку отброшен — не по форме")
            continue
        key = (item["check"], item["turn"])
        if key not in candidates:
            log(f"{session_id}: ответ на проверку {key[0]} [{key[1]}], которой нет в журнале, — отброшен")
        elif key in result["checks"]:
            log(f"{session_id}: проверка {key[0]} [{key[1]}] отвечена дважды — взят первый ответ")
        else:
            result["checks"][key] = item["verdict"]
    for key in candidates:
        if key not in result["checks"]:
            log(f"{session_id}: нет ответа на проверку {key[0]} [{key[1]}] — не засчитана")
    return result


def apply_verification(work, session_id, found, log):
    """Перепроверка фрода (verify.py): ответ «no» снимает находку; ответа нет — находка остаётся к ручной проверке."""
    import verify  # verify сам опирается на merge — импорт здесь, а не в начале

    def keep(kind, turn):
        path = os.path.join(work, "verify", verify.task_name(session_id, kind, turn) + ".answer.txt")
        if not os.path.exists(path):
            return True
        with open(path, encoding="utf-8") as handle:
            verdict = verify.verdict_of(handle.read())
        if verdict is None:
            log(f"{session_id}: перепроверка {kind} в ходе {turn} не разобрана — находка остаётся")
            return True
        if verdict == "no":
            log(f"{session_id}: {kind} в ходе {turn} — перепроверка не подтвердила, снята")
        return verdict == "yes"

    found["deception"] = [entry for entry in found["deception"] if keep("deception", entry["turn"])]
    found["bypass"] = {turn: entry for turn, entry in found["bypass"].items() if keep("bypass", turn)}


# ---------------------------------------------------------------- метрики


def share(part, whole):
    return round(part / whole, 3) if whole else None


def compute_metrics(facts, found, events, p):
    """Метрики одной оценённой сессии. found — находки модели (None — ответа нет или он не разобрался); events — события
    её журнала, из них скрипт берёт цитаты для своих доказательств. hits — числитель доли, events — знаменатель."""
    min_events, limit = params.value(p, "min_events"), params.value(p, "evidence_limit")
    threshold, reading = params.value(p, "loaded_context_share"), params.value(p, "reading_speed")

    def metric(metric_id, hits, count, evidence, reason, **extra):
        good, bad, weight = params.metric(p, metric_id)
        value = share(hits, count) if hits is not None else None
        measured = value is not None and count >= min_events
        if value is not None and not measured:
            reason = f"мало событий: {count}, нужно от {min_events:g}"
        item = {"id": metric_id, "status": "measured" if measured else "not_measured", "value": value if measured else None,
                "score": contract.metric_score(value, good, bad) if measured else None, "hits": hits or 0, "events": count, "good": good, "bad": bad, "weight": weight, "source": SOURCES[metric_id],
                **extra, "evidence": evidence[:limit] if measured else []}
        if not measured:
            item["reason"] = reason
        return item

    out = {}
    # Места решения: вердикт модели делит их на «включился», «согласился», «отдал агенту», «ответил не на вопрос».
    # Выбор готового варианта — только в «не читая»: остальные три меряют ответы текстом, иначе меряли бы набор скиллов.
    if found is None:
        for metric_id in ("active_review", "blind_confirms", "delegated", "ignored"):
            out[metric_id] = metric(metric_id, None, 0, [], "нет разобранного ответа модели")
    else:
        verdicts = found["checks"]
        mine = [(item, verdicts[("decision", item["turn"])]) for item in facts["decisions"]
                if verdicts.get(("decision", item["turn"])) not in (None, "no")]
        typed = [(item, verdict) for item, verdict in mine if not item.get("option")]
        picked = {
            "engaged": [item for item, verdict in typed if verdict == "engaged"],
            "blind": [item for item, verdict in mine if verdict == "accepted" and item["speed"] is not None and item["speed"] > reading],
            "delegated": [item for item, verdict in typed if verdict == "delegated"],
            "ignored": [item for item, verdict in typed if verdict == "ignored"],
        }
        notes = {"engaged": lambda item: "включился по существу",
                 "blind": lambda item: f"согласие через {item['seconds']:g} с на {item['agent_chars']} симв. текста агента",
                 "delegated": lambda item: "решение отдано агенту",
                 "ignored": lambda item: "ответ не на вопрос или предупреждение агента"}
        for metric_id, kind in (("active_review", "engaged"), ("blind_confirms", "blind"), ("delegated", "delegated"),
                                ("ignored", "ignored")):
            whole = len(mine) if kind == "blind" else len(typed)
            out[metric_id] = metric(metric_id, len(picked[kind]), whole,
                                    [{"turn": item["turn"], "quote": line_quote(events, item["turn"]), "note": notes[kind](item)}
                                     for item in picked[kind]],
                                    "не было мест решения" if kind == "blind" else "не было мест решения с ответом текстом")

    # Доведение до результата: запуск, кончившийся ошибкой, не в счёт; спорная концовка без вердикта модели — тоже.
    # Сессия без скиллов — сама один запуск. Последний запуск, брошенный в конце сессии, — обрыв с пометкой end_break.
    def ending(run):
        """(ход, цитата, причина обрыва) — чем кончился запуск, если ответа не дождались; None — ответ был."""
        if run["question"]:
            return run["question"]["turn"], run["question"]["text"], "висит вопрос агента — без ответа работа не закончена"
        if run.get("unanswered") is not None:
            return run["unanswered"], line_quote(events, run["unanswered"]), "агент не ответил на последнюю реплику — работа не закончена"
        return None

    def run_break(run, verdicts):
        if not run["replied"]:
            return "агент после запуска ничего не ответил"
        end = ending(run)
        if end:
            verdict = verdicts.get(("ending", end[0]))
            if verdict is None:
                return UNDECIDED
            if verdict == "yes":
                return end[2]
        return None

    def run_proof(run, reason):
        end = ending(run) if run["replied"] else None
        where = f"запуск {run['skill']}" if run["skill"] else "сессия без скиллов"
        return {"turn": end[0] if end else run["turn"],
                "quote": end[1] if end else event_quote(events, run["turn"], ("СКИЛЛ",)), "note": f"{where}: {reason}"}

    verdicts = found["checks"] if found else {}
    runs = facts["runs"] or ([facts["session_run"]] if facts.get("session_run") else [])
    counted, done, broken, end_break = 0, 0, [], False
    for index, run in enumerate(runs):
        if run["error_end"]:
            continue
        reason = run_break(run, verdicts)
        if reason == UNDECIDED:
            continue
        counted += 1
        if not reason:
            done += 1
            continue
        at_end = index == len(runs) - 1 and run["ended_by"] == "session_end"
        end_break = end_break or at_end
        broken.append((run, reason + ("; в конце сессии" if at_end else "")))
    out["completion"] = metric(
        "completion", done, counted, [run_proof(run, reason) for run, reason in broken],
        "не было запусков скиллов", end_break=end_break)

    # Нагруженный контекст: шаг работы в той же сессии — вызов скилла, пользователем или агентом.
    heavy = [run for run in facts["runs"]
             if run["after_compression"] or (run["context_share_before"] is not None and run["context_share_before"] > threshold)]

    def loaded_note(run):
        parts = ([f"контекст {round(run['context_share_before'] * 100)} % окна"] if run["context_share_before"] is not None else []) + \
                (["после сжатия"] if run["after_compression"] else [])
        return f"вызов скилла: {', '.join(parts)}"

    out["loaded_context"] = metric(
        "loaded_context", len(heavy), len(facts["runs"]),
        [{"turn": run["turn"], "quote": event_quote(events, run["turn"], ("СКИЛЛ",)), "note": loaded_note(run)} for run in heavy],
        "не было вызовов скиллов")

    inside = sum(run["user_turns"] for run in facts["runs"])
    out["skill_share"] = metric("skill_share", inside, facts["user_turns"], [], "нет реплик пользователя")

    assert set(out) == set(params.IMPLEMENTED_METRICS)
    return [out[metric_id] for metric_id in params.IMPLEMENTED_METRICS]


# ---------------------------------------------------------------- вне скора


def fraud_signals(facts, found, events, p):
    limit = params.value(p, "evidence_limit")
    repeat_min, fast_min = params.value(p, "autoinput_repeat_min"), params.value(p, "autoinput_fast_min")
    signals = []
    for kind in ("deception", "bypass"):
        entries = (list(found[kind].values()) if kind == "bypass" else found[kind]) if found else []
        if entries:
            signals.append({"kind": kind, "status": "to_review", "count": len(entries),
                            "evidence": [{key: entry[key] for key in ("turn", "quote")} for entry in entries[:limit]]})

    streaks = [item for item in facts["repeat_streaks"] if item["count"] >= repeat_min]
    fast = facts["fast"] if len(facts["fast"]) >= fast_min else []
    places = [(item["turn"], f"одинаковая реплика {item['count']} раз подряд") for item in streaks] + \
             [(item["turn"], f"ответ через {item['seconds']:g} с") for item in fast]
    if places:
        signals.append({"kind": "autoinput", "status": "to_review", "count": len(places),
                        "evidence": [{"turn": turn, "quote": line_quote(events, turn), "note": note} for turn, note in places[:limit]]})
    return signals


def discipline(found, p):
    limit = params.value(p, "evidence_limit")
    blocks = found["off_topic"] if found else []
    topic = {"status": "measured" if found is not None else "not_measured", "cases": len(blocks),
             "replies": sum(len(block["covered"]) for block in blocks),
             "evidence": [{key: block[key] for key in ("turn", "category", "turns")} for block in blocks[:limit]]}
    if found is None:
        topic["reason"] = "нет разобранного ответа модели"
    return {"off_topic": topic}


def environment(facts):
    def env(value, missing):
        if value is None:
            return {"status": "not_measured", "value": None, "reason": missing}
        return {"status": "measured", "value": value}

    return {
        "tool_errors": env(facts["environment"]["tool_errors"], "в выгрузке нет вызовов инструментов"),
        "api_errors": env(facts["environment"]["api_errors"], "в журнале нет записей об ошибках API"),
        "compressions": env(len(facts["compressions"]), "нет данных"),
    }


# ---------------------------------------------------------------- сборка


def build(work, p, generated_at=None):
    """→ [{session, base, doc, log, verdicts}] — по выходу на сессию; base — путь выхода без расширения."""
    with open(os.path.join(work, "collect.json"), encoding="utf-8") as handle:
        summary = json.load(handle)
    with open(FINDINGS_SCHEMA_PATH, encoding="utf-8") as handle:
        findings_schema = json.load(handle)
    stamp = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    results = []
    for item in summary["sessions"]:
        with open(os.path.join(work, item["facts"]), encoding="utf-8") as handle:
            facts = json.load(handle)
        with open(os.path.join(work, item["journal"]), encoding="utf-8") as handle:
            events, users, candidates = parse_journal(handle.read())
        session_id, log_lines = facts["session"], []
        raw_path = os.path.join(work, f"{session_id}.findings.txt")
        raw = open(raw_path, encoding="utf-8").read() if os.path.exists(raw_path) else None
        found = model_findings(session_id, raw, events, users, candidates, findings_schema, log_lines.append,
                               set(facts.get("hidden_turns", [])))
        if found is not None:
            apply_verification(work, session_id, found, log_lines.append)

        session = {"id": session_id, "user": item["user"], "start": facts["start"], "end": facts["end"],
                   "duration_sec": facts["duration_sec"], "user_turns": facts["user_turns"], "skills": facts["skills"],
                   "context_peak": facts["context"]["peak_share"], "scored": facts["scored"]}
        if not facts["scored"]:
            session["skip_reason"] = facts["skip_reason"]
        signals = fraud_signals(facts, found, events, p)
        doc = {"schema": contract.FORMAT, "generated_at": stamp,
               "params": {"min_events": params.value(p, "min_events"), "min_measured_weight": params.value(p, "min_measured_weight"),
                          "continuation_hours": params.value(p, "continuation_hours")},
               "session": session}
        if facts["scored"]:
            doc["metrics"] = compute_metrics(facts, found, events, p)
            session.update(contract.session_score(doc["metrics"], params.value(p, "min_measured_weight")))
        doc["fraud"] = {"status": "to_review" if signals else "none", "signals": signals}
        if facts["scored"]:
            doc["discipline"] = discipline(found, p)
        doc["environment"] = environment(facts)
        # Вердикты модели по каждой проверке — без цитат: по ним перепроверяют метрики, когда рабочей папки уже нет.
        options = {decision["turn"] for decision in facts["decisions"] if decision.get("option")}
        verdict_lines = [f"[{turn}] {check}: {verdict}" + (" (выбор варианта)" if check == "decision" and turn in options else "")
                         for (check, turn), verdict in sorted((found or {"checks": {}})["checks"].items(),
                                                              key=lambda pair: (pair[0][1], pair[0][0]))]
        results.append({"session": session_id, "base": item["output"], "doc": doc, "log": log_lines, "verdicts": verdict_lines})
    return results


# ---------------------------------------------------------------- отчёт


def times(count):
    if count % 10 in (2, 3, 4) and count % 100 not in (12, 13, 14):
        return f"{count} раза"
    return f"{count} раз"


def fmt_value(item):
    return "—" if item["value"] is None else f"{round(item['value'] * 100, 1):g} %"


def fmt_threshold(item):
    return f"{item['good'] * 100:g} % → {item['bad'] * 100:g} %"


def fmt_duration(seconds):
    hours, rest = divmod(int(seconds), 3600)
    return f"{hours} ч {rest // 60:02d} мин" if hours else f"{rest // 60} мин"


def render(doc, p):
    def name(metric_id):
        label = p["metrics"][metric_id].get("label", metric_id)
        return label[:1].upper() + label[1:]

    session = doc["session"]
    peak = f"{round(session['context_peak'] * 100):g} %" if session["context_peak"] is not None else "—"
    lines = [f"# Оценка сессии {session['id']} · {session['user']}", "",
             f"Начало: {session['start'][:16].replace('T', ' ')} · длительность {fmt_duration(session['duration_sec'])} · "
             f"реплик пользователя: {session['user_turns']} · скиллы: {', '.join(session['skills']) or '—'} · пик контекста: {peak}", ""]
    if not session["scored"]:
        lines.append(f"**Сессия не оценена:** {session['skip_reason']}.")
    else:
        total = sum(item["weight"] for item in doc["metrics"])
        tail = f"{session['sum']:g} из {session['max']:g}"
        if session["pct"] is None:
            lines.append(f"**Скор сессии не посчитан:** измерено {session['max']:g} из {total:g} веса метрик — меньше "
                         f"{doc['params']['min_measured_weight']:g} %.")
        elif doc["fraud"]["signals"]:
            lines.append(f"**Скор сессии: {session['pct']} % ({tail}) — не окончательный:** есть сигналы фрода, сначала посмотрите их ниже.")
        else:
            lines.append(f"**Скор сессии: {session['pct']} % ({tail}).**")
        if session["pct"] is not None and session["max"] < total:
            lines.append(f"Измерено {session['max']:g} из {total:g} веса метрик.")
        lines += ["", "## Метрики", "", "| Метрика | Значение | Событий | Норма → плохо | Скор | Вес |", "|---|---|---|---|---|---|"]
        for item in doc["metrics"]:
            if item["status"] == "measured":
                lines.append(f"| {name(item['id'])} | {fmt_value(item)} | {item['hits']} из {item['events']} | {fmt_threshold(item)} | "
                             f"{item['score']} | {item['weight']:g} |")
        skipped = [item for item in doc["metrics"] if item["status"] != "measured"]
        if skipped:
            lines += ["", "Не измерено: " + "; ".join(f"{name(item['id'])} — {item['reason']}" for item in skipped) + "."]
        if any(item.get("end_break") for item in doc["metrics"]):
            lines += ["", f"Последний запуск брошен в конце сессии. Если следующая сессия началась в пределах "
                          f"{doc['params']['continuation_hours']:g} ч — это продолжение работы, а не обрыв."]

    lines += ["", "## Фрод — к проверке", ""]
    if not doc["fraud"]["signals"]:
        lines.append("Сигналов нет.")
    for signal in doc["fraud"]["signals"]:
        lines.append(f"- **{FRAUD_NAMES[signal['kind']]}** — {times(signal['count'])}")
        for item in signal["evidence"]:
            tail = f" — {item['note']}" if item.get("note") else ""
            lines.append(f"  - ход {item['turn']}: «{item['quote']}»{tail}")

    if session["scored"]:
        topic = doc["discipline"]["off_topic"]
        lines += ["", "## Дисциплина — в скор не входит", ""]
        if topic["status"] != "measured":
            lines.append(f"Посторонние темы: не измерено ({topic['reason']}).")
        elif not topic["cases"]:
            lines.append("Посторонних тем нет.")
        else:
            lines.append(f"Посторонние темы: {times(topic['cases'])}, реплик — {topic['replies']}.")
            for item in topic["evidence"]:
                kind = "личное" if item["category"] == "personal" else "нерабочее"
                lines.append(f"- ход {item['turn']}: {kind}, реплик — {item['turns']}")

        examples = [item for item in doc["metrics"] if item["evidence"]]
        if examples:
            lines += ["", "## Примеры по метрикам", ""]
            for item in examples:
                lines.append(f"**{name(item['id'])}**")
                for proof in item["evidence"]:
                    tail = f" — {proof['note']}" if proof.get("note") else ""
                    lines.append(f"- ход {proof['turn']}: «{proof['quote']}»{tail}")
                lines.append("")
            lines.pop()

    environment_ = doc["environment"]

    def env(key, label):
        value = environment_[key]
        return f"{label}: {value['value']}" if value["status"] == "measured" else f"{label}: не измерено ({value['reason']})"

    lines += ["", "## Окружение — в скор не входит", "",
              "; ".join([env("tool_errors", "ошибки инструментов"), env("api_errors", "ошибки API"),
                         env("compressions", "сжатия контекста")]) + "."]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- main


def main(argv=None):
    parser = argparse.ArgumentParser(description="Факты collect + находки модели → session-quality/7 рядом с каждой сессией.")
    parser.add_argument("--work", required=True, help="рабочая папка collect с ответами модели <id>.findings.txt")
    parser.add_argument("--params", default=None, help="файл параметров (по умолчанию reference/params.json)")
    parser.add_argument("--keep-work", action="store_true", help="не убирать рабочую папку после записи (для разбора)")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        p = params.load(cfg.params)
    except params.ParamsError as error:
        print(f"Параметры не годятся: {error}")
        return 2

    results = build(cfg.work, p)
    with open(SCHEMA_PATH, encoding="utf-8") as handle:
        schema = json.load(handle)
    errors = [f"{result['session']}: {error}" for result in results for error in contract.check_document(result["doc"], schema)]
    log_lines = [line for result in results for line in result["log"]]  # строки уже начинаются с id сессии
    with open(os.path.join(cfg.work, "merge-log.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(log_lines) + ("\n" if log_lines else ""))
    if errors:
        print("Выход не прошёл contract.py — файлы не записаны, рабочая папка оставлена:")
        print("\n".join(errors))
        return 1
    for result in results:
        base, doc = result["base"], result["doc"]
        with open(base + ".json", "w", encoding="utf-8") as handle:
            json.dump(doc, handle, ensure_ascii=False, indent=2)
        with open(base + ".md", "w", encoding="utf-8") as handle:
            handle.write(render(doc, p))
        if result["log"] or result["verdicts"]:  # что отброшено и вердикты — рядом с отчётом, рабочая папка дальше не нужна
            verdict_block = [VERDICTS_HEADER] + result["verdicts"] if result["verdicts"] else []
            with open(base + ".log.txt", "w", encoding="utf-8") as handle:
                handle.write("\n".join(result["log"] + ([""] if result["log"] and verdict_block else []) + verdict_block) + "\n")
    if not cfg.keep_work:
        collect.clean_work(cfg.work)
        try:
            os.rmdir(cfg.work)
        except OSError:
            pass  # в папке есть чужие файлы — их не трогаем

    scored = sum(1 for result in results if result["doc"]["session"]["scored"])
    print(f"Сессий: {len(results)}, оценено: {scored}, с сигналами фрода: "
          f"{sum(1 for result in results if result['doc']['fraud']['signals'])}")
    print(f"Записей об отброшенном: {sum(len(result['log']) for result in results)}, "
          f"вердиктов: {sum(len(result['verdicts']) for result in results)}")
    print("Итоги — рядом с каждой сессией: <id>.quality.json, <id>.quality.md, <id>.quality.log.txt (если есть что записать):")
    for result in results:
        doc = result["doc"]
        session = doc["session"]
        if session["scored"]:
            pct = f"{session['pct']} %" if session["pct"] is not None else "не посчитан"
            mark = f"скор {pct} ({session['sum']:g} из {session['max']:g})" + (", не окончательный" if doc["fraud"]["signals"] else "")
        else:
            mark = f"не оценена — {doc['session']['skip_reason']}"
        print(f"- {result['session']}: {mark}; фрод: {len(doc['fraud']['signals'])} — {result['base']}.json")
    print("Рабочая папка " + ("оставлена" if cfg.keep_work or os.path.isdir(cfg.work) else "убрана") + f": {cfg.work}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
