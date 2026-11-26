#!/usr/bin/env python3
"""Самопроверка merge.py: синтетические сессии brief_fixtures + испорченные ответы модели → числа, посчитанные вручную.

    python3 selftest-merge.py

Ручной счёт по каждой сессии (bq-1 … bq-4, все оценены; ответа модели по bq-4 нет; параметры — reference/params.json,
но минимум событий 1). Выход — <id>.quality.json рядом с выгрузкой, hits / events:
  места решения по вердикту модели: bq-1 [5] accepted (согласие через 3 с — «не читая»), [12] engaged; bq-2 [5] engaged;
    bq-3 [5] — верный ответ «no», не в счёт:
    bq-1: active_review 1/2, blind_confirms 1/2, delegated 0/2, ignored 0/2 · bq-2: 1/1, 0/1, 0/1, 0/1 ·
    bq-3: мест нет — не измерены · bq-4: ответа модели нет — не измерены
  completion: bq-1 кончился вопросом «Добавить раздел…?» — модель: no, 1/1; bq-2 — вопросом о коде ошибки — модель: yes,
    0/1 и end_break: брошен в конце сессии (продолжение по следующей сессии считает дашборд); bq-3 — 1/1; bq-4 кончился
    «Отлично, спасибо» без ответа агента — концовку решает модель, а её ответа нет: не измерена
  loaded_context: у каждой 0/1 — скилл вызван в первом ходе, контекста ещё нет
  skill_share: 6/7, 6/7, 6/7, 4/5
  суммы по сессиям — прежний счёт за период: active_review 2/3, blind_confirms 1/3, completion 2/3, skill_share 22/26
  скор сессии — session.pct / sum / max, как у документа: sum = Σ вес × скор метрики / 100 по измеренным, max = Σ их весов.
  bq-1: 10 + 0 + 5 + 10 + 10 + 10 + 5 = 50 из 60 → 83 %, без фрода; bq-2: 50 из 60 → 83 %, «не окончательный»
  (неподтверждённое как подтверждённое, второе на том же ходе отброшено); bq-3: измерено 25 из 60 веса
  (41.67 % < 50) — pct null, sum 25, max 25; bq-4: 15 из 60 — pct null, sum 15, max 15; фрод bq-3 — обход. С минимумом событий 5 у каждой сессии измерена только
  работа через скиллы. Находки убранных видов (ухудшение агента, нечёткая постановка, переход к задаче, поздние вводные)
  отбрасываются.

Сессия opt-1 (своя папка, выгрузка): запуски context-doc [3] и business-requirements-doc [9]; места решения — [4] выбор
варианта (accepted), [6] и [8] текстом (engaged); [11] — одна заглушка вставки, находка на ней отброшена:
  active_review 2/2 = 1.0 (выбор варианта не в знаменателе; было бы 2/3) · blind_confirms 0/3 (выбор варианта — здесь)
Вход файлом: collect по одной выгрузке — одна сессия; повторный collect по папке итоги <id>.quality.json сессиями не считает.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REFERENCE = os.path.join(HERE, "..", "session-quality", "reference")
sys.path.insert(0, REFERENCE)
sys.path.insert(0, HERE)
import importlib.util  # noqa: E402

import brief_fixtures  # noqa: E402
import collect  # noqa: E402
import contract  # noqa: E402
import grade_brief  # noqa: E402
import merge  # noqa: E402
import params  # noqa: E402

SESSIONS = ("bq-1", "bq-2", "bq-3", "bq-4")


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def outputs(folder, ids=SESSIONS):
    return {sid: json.loads(read(os.path.join(folder, f"{sid}.quality.json"))) for sid in ids}


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    root = tempfile.mkdtemp(prefix="sq-merge-")
    sessions = os.path.join(root, "sessions", "user-01")
    work = os.path.join(root, "work")
    os.makedirs(sessions)
    expected = brief_fixtures.build(sessions)
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", sessions, "--out", work])
    loose = params.load()
    loose["evaluation"]["min_events"]["value"] = 1
    loose_path = os.path.join(root, "params-min1.json")
    with open(loose_path, "w", encoding="utf-8") as handle:
        json.dump(loose, handle, ensure_ascii=False)
    strict_params = params.load()
    strict_params["evaluation"]["min_events"]["value"] = 5
    strict_path = os.path.join(root, "params-min5.json")
    with open(strict_path, "w", encoding="utf-8") as handle:
        json.dump(strict_params, handle, ensure_ascii=False)

    journals = {session_id: read(os.path.join(work, f"{session_id}.journal.txt")) for session_id in expected}
    perfect = {session_id: grade_brief.perfect_answer(session_id, journals[session_id],
                                                      dict(expected[session_id], background=False))
               for session_id in expected}

    # Порча ответов — то, что модель делала на прогонах. Номера ходов — по тексту: в выгрузке они свои.
    turn_of = {session_id: (lambda text, sid=session_id: grade_brief.turn_with(journals[sid], text)) for session_id in journals}
    bq1_start, bq1_end = turn_of["bq-1"]("Делаем БТ по уведомлениям"), turn_of["bq-1"]("Хорошо. Документ сохранён")
    bq2_end = turn_of["bq-2"]("Раздел ошибок без одного кода")
    deception_turn = turn_of["bq-2"]("Запиши в спеке, что лимит")
    bq1 = perfect["bq-1"]
    bq1["findings"].append({"type": "degradation", "turn": bq1_end, "quote": "Добавить в него раздел",
                            "earlier_turn": bq1_start, "caught_turn": None})  # вид убран — отбрасывается
    bq1["findings"] += [{"type": "deception", "turn": bq1_end, "quote": "этого в журнале нет"},
                        {"type": "vague_request", "turn": bq1_start, "quote": "Делаем БТ по уведомлениям клиента"},
                        {"type": "late_requirement", "turn": bq1_start, "quote": "Срок хранения уведомлений — 90 дней"}]
    first_try = dict(bq1, findings=[])
    bq2 = perfect["bq-2"]
    for item in bq2["findings"]:
        if item["type"] == "off_topic":
            item["note"] = "подарок жене и отпуск"
    bq2["findings"].append({"type": "off_topic", "turn": 15, "category": "non_work", "turns": 0})
    bq2["findings"].append({"type": "task_switch", "turn": 6, "quote": "Слушай, не по работе"})
    bq2["findings"].append({"type": "deception", "turn": deception_turn, "quote": "Запиши в спеке, что лимит"})  # второй на ходе
    bq3 = perfect["bq-3"]
    bq3["findings"].append(dict(next(item for item in bq3["findings"] if item["type"] == "bypass")))  # тот же обход дважды
    bq3["findings"].append({"type": "degradation", "turn": 6, "quote": "Отмечаю спеку как переданную в разработку.",
                            "earlier_turn": None, "caught_turn": None})
    answers = {"bq-1": json.dumps(first_try, ensure_ascii=False) + "\n\nНет, поправлю:\n\n```json\n"
                       + json.dumps(bq1, ensure_ascii=False) + "\n```",
               "bq-2": json.dumps(bq2, ensure_ascii=False),
               "bq-3": json.dumps(bq3, ensure_ascii=False)}  # по bq-4 ответа модели нет
    for session_id, text in answers.items():
        with open(os.path.join(work, f"{session_id}.findings.txt"), "w", encoding="utf-8") as handle:
            handle.write(text)

    failures, checks = [], 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    def run_merge(*extra):
        screen = io.StringIO()
        with contextlib.redirect_stdout(screen):
            code = merge.main(["--work", work, *extra])
        return code, screen.getvalue()

    code, screen = run_merge("--params", loose_path, "--keep-work")
    expect(code == 0, f"код выхода {code}: {screen}")
    docs = outputs(sessions)
    reports = {sid: read(os.path.join(sessions, f"{sid}.quality.md")) for sid in SESSIONS}
    log = read(os.path.join(work, "merge-log.txt"))
    schema = json.loads(read(merge.SCHEMA_PATH))
    bad = {sid: contract.check_document(doc, schema) for sid, doc in docs.items()}
    expect(not any(bad.values()), f"выход каждой сессии проходит contract.py: {bad}")
    expect(sorted(name for name in os.listdir(sessions) if name.endswith(".quality.json")) ==
           [f"{sid}.quality.json" for sid in SESSIONS], f"итог — рядом с выгрузкой каждой сессии: {sorted(os.listdir(sessions))}")

    # Посылки ручного счёта — факты collect.
    facts = {sid: json.loads(read(os.path.join(work, f"{sid}.facts.json"))) for sid in expected}
    expect([facts[s]["user_turns"] for s in SESSIONS] == [7, 7, 7, 5],
           "реплики 7/7/7/5 — вызов через «/» и ответ на вопрос с вариантами тоже реплики")
    expect([[run["user_turns"] for run in facts[s]["runs"]] for s in SESSIONS] == [[6], [6], [6], [4]],
           "реплик внутри запусков 6/6/6/4 — слэш-вызов открывает запуск и сам в нём")
    expect([[run["context_share_before"] for run in facts[s]["runs"]] for s in SESSIONS]
           == [[0.0], [0.0], [0.0], [0.0]], "контекст перед вызовами: токены — с конца прошлого хода, а скиллы вызваны в первом")
    expect([[item["turn"] for item in facts[s]["decisions"]] for s in SESSIONS]
           == [[turn_of["bq-1"]("ПОЛЬЗОВАТЕЛЬ: да"), turn_of["bq-1"]("90 дней, я же писал")],
               [turn_of["bq-2"]("ОТВЕТ: Формат")], [turn_of["bq-3"]("Пропусти проверку готовности")],
               [turn_of["bq-4"]("ОТВЕТ: Порядок"), turn_of["bq-4"]("ПОЛЬЗОВАТЕЛЬ: да")]], "кандидаты мест решения")
    expect(facts["bq-1"]["decisions"][0]["seconds"] == 3.0, f"bq-1: согласие через 3 с {facts['bq-1']['decisions'][0]}")
    expect([item["seconds"] for item in facts["bq-2"]["decisions"]] == [75.0],
           "вопрос с вариантами: время показа не выгружается — от прошлого события (вызов скилла) до ответа")

    metrics = {sid: {item["id"]: item for item in doc["metrics"]} for sid, doc in docs.items()}
    want = {  # метрика → по сессиям (hits, events) или None — не измерена
        "active_review": ((1, 2), (1, 1), None, None), "blind_confirms": ((1, 2), (0, 1), None, None),
        "delegated": ((0, 2), (0, 1), None, None), "ignored": ((0, 2), (0, 1), None, None),
        "completion": ((1, 1), (0, 1), (1, 1), None), "loaded_context": ((0, 1), (0, 1), (0, 1), (0, 1)),
        "skill_share": ((6, 7), (6, 7), (6, 7), (4, 5)),
    }
    for metric_id, per_session in want.items():
        for sid, pair in zip(SESSIONS, per_session):
            got = metrics[sid][metric_id]
            if pair is None:
                ok = got["status"] == "not_measured" and got["value"] is None and got["evidence"] == []
            else:
                ok = got["status"] == "measured" and (got["hits"], got["events"]) == pair and abs(got["value"] - pair[0] / pair[1]) <= 0.0005
            expect(ok, f"{sid} {metric_id}: {got['status']} {got['hits']}/{got['events']} value {got['value']}; ждали {pair or 'не измерена'}")
    expect(metrics["bq-3"]["active_review"]["reason"] == "не было мест решения с ответом текстом" and
           metrics["bq-4"]["active_review"]["reason"] == "нет разобранного ответа модели",
           f"причины «не измерено»: {metrics['bq-3']['active_review'].get('reason')}, {metrics['bq-4']['active_review'].get('reason')}")
    totals = {metric_id: (sum(metrics[s][metric_id]["hits"] for s in SESSIONS), sum(metrics[s][metric_id]["events"] for s in SESSIONS))
              for metric_id in ("active_review", "blind_confirms", "completion", "skill_share")}
    expect(totals == {"active_review": (2, 3), "blind_confirms": (1, 3), "completion": (2, 3), "skill_share": (22, 26)},
           f"суммы hits / events по сессиям — прежний счёт за период: {totals}")
    breaks = {sid: metrics[sid]["completion"]["end_break"] for sid in SESSIONS}
    expect(breaks == {"bq-1": False, "bq-2": True, "bq-3": False, "bq-4": False}, f"end_break — только у брошенного в конце сессии: {breaks}")
    evidence = metrics["bq-2"]["completion"]["evidence"]
    expect([item["turn"] for item in evidence] == [bq2_end] and "без ответа работа не закончена" in evidence[0]["note"]
           and "в конце сессии" in evidence[0]["note"], f"обрыв bq-2 [{bq2_end}]: {evidence}")
    expect(all("session" not in item for doc in docs.values() for metric in doc["metrics"] for item in metric["evidence"]),
           "в доказательствах нет id сессии — он в session.id")
    expect(all([item["id"] for item in doc["metrics"]] == list(params.IMPLEMENTED_METRICS) for doc in docs.values()), "порядок метрик")
    expect(all(doc["params"] == {"min_events": 1, "min_measured_weight": 50, "continuation_hours": 12} for doc in docs.values()),
           f"параметры в выходе: {docs['bq-1']['params']}")
    scores = {sid: tuple(docs[sid]["session"][key] for key in ("pct", "sum", "max")) for sid in SESSIONS}
    expect(scores == {"bq-1": (83, 50, 60), "bq-2": (83, 50, 60), "bq-3": (None, 25, 25), "bq-4": (None, 15, 15)},
           f"скор сессии — pct / sum / max в JSON: {scores}")
    expect(metrics["bq-1"]["blind_confirms"]["score"] == 0 and metrics["bq-2"]["completion"]["score"] == 0 and
           metrics["bq-1"]["skill_share"]["score"] == 100 and metrics["bq-3"]["active_review"]["score"] is None,
           "скор метрики — в JSON, у неизмеренной null")
    expect(all(doc["session"]["user"] == "user-01" and "score" not in doc for doc in docs.values()),
           f"пользователь — у сессии, отдельного блока score нет: {docs['bq-1']['session']}")

    signals = {sid: {signal["kind"]: signal for signal in doc["fraud"]["signals"]} for sid, doc in docs.items()}
    expect({sid: sorted(kinds) for sid, kinds in signals.items()} == {"bq-1": [], "bq-2": ["deception"], "bq-3": ["bypass"], "bq-4": []},
           f"сигналы фрода по сессиям: {({sid: sorted(kinds) for sid, kinds in signals.items()})}")
    expect(signals["bq-3"]["bypass"]["count"] == 1 and signals["bq-2"]["deception"]["count"] == 1,
           "обход дважды — один сигнал; второе «неподтверждённое» на том же ходе отброшено")
    topic = docs["bq-2"]["discipline"]["off_topic"]
    expect(topic["cases"] == 1 and topic["replies"] == 2 and topic["evidence"] == [{"turn": 6, "category": "personal", "turns": 2}],
           f"посторонние темы — вне скора, без пересказа: {topic}")
    expect(docs["bq-4"]["discipline"]["off_topic"]["status"] == "not_measured", "без ответа модели посторонние темы не измерены")
    expect(set(docs["bq-1"]["environment"]) == {"tool_errors", "api_errors", "compressions"}, f"окружение {docs['bq-1']['environment']}")
    for line in ("цитата не подтвердилась", "вырезан пересказ", "turns: меньше 1", "самоисправление", "bq-4: нет ответа модели",
                 f"deception в ходе {deception_turn} — на ходе уже есть такая находка", "находка отброшена — $.type"):
        expect(line in log, f"в merge-log.txt нет «{line}»")
    expect(log.count("находка отброшена — $.type") == 5, "убранные виды находок отброшены все пять")
    expect("bq-4: bq-4:" not in log, "id сессии в строке лога один раз")

    expect("**Скор сессии: 83 % (50 из 60).**" in reports["bq-1"], "отчёт bq-1: скор 83 % (50 из 60)")
    expect("**Скор сессии: 83 % (50 из 60) — не окончательный:**" in reports["bq-2"] and "Неподтверждённое выдаётся за подтверждённое" in reports["bq-2"],
           "отчёт bq-2: не окончательный — фрод")
    expect("**Скор сессии не посчитан:** измерено 25 из 60 веса метрик — меньше 50 %." in reports["bq-3"] and "Обход правил и проверок" in reports["bq-3"],
           "отчёт bq-3: мало веса — скора нет; фрод — обход")
    expect("Последний запуск брошен в конце сессии" in reports["bq-2"] and "Последний запуск брошен" not in reports["bq-1"],
           "отчёт: про обрыв в конце сессии — только у bq-2")
    expect("## Дисциплина" in reports["bq-2"] and "личное, реплик — 2" in reports["bq-2"], "отчёт: посторонние темы — в дисциплине, без содержания")
    for secret in ("подарить", "жене", "отпуск", "Турция", "Qw3rty", "4111"):
        expect(not any(secret in reports[sid] or secret in json.dumps(docs[sid], ensure_ascii=False) for sid in SESSIONS),
               f"в выход попало личное или секрет: «{secret}»")

    code, _ = run_merge("--params", strict_path, "--keep-work")
    strict = outputs(sessions)
    strict_ok = all(item["status"] == ("measured" if item["id"] == "skill_share" else "not_measured")
                    for doc in strict.values() for item in doc["metrics"])
    blind = next(item for item in strict["bq-1"]["metrics"] if item["id"] == "blind_confirms")
    expect(code == 0 and strict_ok and blind["reason"] == "мало событий: 2, нужно от 5",
           f"минимум событий 5: у каждой сессии измерена только работа через скиллы: {blind}")

    # Перепроверка фрода: задания — по тем же находкам, что принял merge; «no» снимает, «yes» и мусор — оставляют.
    import verify  # noqa: E402
    findings_schema = json.loads(read(merge.FINDINGS_SCHEMA_PATH))
    tasks = {session_id: verify.tasks_for(session_id, answers[session_id], journals[session_id], findings_schema)
             for session_id in answers}
    bypass_turn = turn_of["bq-3"]("Пропусти проверку готовности")
    expect([name for name, _text in tasks["bq-2"]] == [verify.task_name("bq-2", "deception", deception_turn)]
           and [name for name, _text in tasks["bq-3"]] == [verify.task_name("bq-3", "bypass", bypass_turn)]
           and not tasks["bq-1"], f"задания перепроверки — по одной на находку фрода: {[[n for n, _t in v] for v in tasks.values()]}")
    text = tasks["bq-2"][0][1]
    expect(f"[{deception_turn}] ПОЛЬЗОВАТЕЛЬ: Не надо. Запиши в спеке" in text and "Сомневаешься — `no`." in text,
           "задание перепроверки: реплика с окружением журнала и правило сомнения")
    os.makedirs(os.path.join(work, "verify"))
    for name, answer in ((verify.task_name("bq-2", "deception", deception_turn), '{"verdict": "no"}'),
                         (verify.task_name("bq-3", "bypass", bypass_turn), "Да, это обход. {\"verdict\": \"yes\"}")):
        with open(os.path.join(work, "verify", name + ".answer.txt"), "w", encoding="utf-8") as handle:
            handle.write(answer)
    run_merge("--params", loose_path, "--keep-work")
    verified = outputs(sessions)
    verified_log = read(os.path.join(work, "merge-log.txt"))
    expect(verified["bq-2"]["fraud"]["signals"] == [] and [s["kind"] for s in verified["bq-3"]["fraud"]["signals"]] == ["bypass"]
           and f"deception в ходе {deception_turn} — перепроверка не подтвердила, снята" in verified_log,
           f"перепроверка «no» снимает находку, «yes» — оставляет: {verified['bq-2']['fraud']}")
    with open(os.path.join(work, "verify", verify.task_name("bq-2", "deception", deception_turn) + ".answer.txt"),
              "w", encoding="utf-8") as handle:
        handle.write("не знаю")
    code, screen = run_merge("--params", loose_path)
    kept = outputs(sessions)
    expect([s["kind"] for s in kept["bq-2"]["fraud"]["signals"]] == ["deception"],
           "перепроверка без разобранного ответа — находка остаётся к ручной проверке")
    side_log = os.path.join(sessions, "bq-2.quality.log.txt")
    expect(not os.path.exists(work) and os.path.exists(side_log) and "не разобрана — находка остаётся" in read(side_log),
           "без --keep-work рабочая папка убрана, журнал отброшенного — рядом с отчётом сессии")
    expect(merge.VERDICTS_HEADER in read(side_log) and f"[{bq2_end}] ending: yes" in read(side_log),
           "в журнале рядом с отчётом — вердикты по проверкам этой сессии")
    expect(all(f"{sid}.quality.json" in screen for sid in SESSIONS) and "bq-1: скор 83 % (50 из 60)" in screen,
           f"на экран — строка на сессию со скором и путём: {screen}")

    # Провал контракта — не пишется ни один выход, рабочая папка остаётся.
    fail_sessions, fail_work = os.path.join(root, "sessions", "user-03"), os.path.join(root, "work-fail")
    os.makedirs(fail_sessions)
    shutil.copy(os.path.join(sessions, "bq-1.json"), fail_sessions)
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", fail_sessions, "--out", fail_work])
    original = contract.check_document
    contract.check_document = lambda doc, schema: ["порча для самопроверки"]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            fail_code = merge.main(["--work", fail_work])
    finally:
        contract.check_document = original
    expect(fail_code == 1 and not [n for n in os.listdir(fail_sessions) if ".quality." in n] and os.path.isdir(fail_work),
           f"провал контракта — выходов нет, рабочая папка оставлена: {fail_code}, {os.listdir(fail_sessions)}")

    # Вход файлом и повторный запуск по папке.
    single_work = os.path.join(root, "work-single")
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", os.path.join(sessions, "bq-1.json"), "--out", single_work])
    single = json.loads(read(os.path.join(single_work, "collect.json")))
    expect([item["session"] for item in single["sessions"]] == ["bq-1"] and
           single["sessions"][0]["output"] == os.path.join(os.path.abspath(sessions), "bq-1.quality"),
           f"вход файлом — одна сессия, итог рядом с ней: {single['sessions']}")
    again_work = os.path.join(root, "work-again")
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", sessions, "--out", again_work])
    again = json.loads(read(os.path.join(again_work, "collect.json")))
    expect([item["session"] for item in again["sessions"]] == list(SESSIONS) and
           not any(".quality." in item["file"] for item in again["skipped_files"]),
           f"повторный запуск по папке: итоги не сессии и не «пропущенные файлы»: {again['skipped_files']}")
    default_screen = io.StringIO()
    with contextlib.redirect_stdout(default_screen):
        collect.main(["--sessions", os.path.join(sessions, "bq-2.json")])
    expect(os.path.isdir(os.path.join(sessions, collect.WORK_DIR)) and
           f"Работа: {os.path.join(os.path.abspath(sessions), collect.WORK_DIR)}" in default_screen.getvalue(),
           f"рабочая папка по умолчанию — {collect.WORK_DIR} рядом с сессиями: {default_screen.getvalue()[:200]}")

    # Выбор варианта, заглушка вставки, цитата ответа — на выгрузке своей сессии.
    spec = importlib.util.spec_from_file_location("selftest_collect", os.path.join(HERE, "selftest-collect.py"))
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    opt_sessions, opt_work = os.path.join(root, "sessions", "user-02"), os.path.join(root, "work-opt")
    os.makedirs(opt_sessions)
    s = builder.Export("opt-1", "2026-10-24T09:00:00", login="user-02")
    s.start(0)                                                                                   # 1
    s.prompt(1, "Собери БТ по выгрузке платежей")                                                # 2
    s.skill(5, "context-doc")                                                                    # 3
    s.ask(40, [("Источник", "Откуда берём данные?", ["Из задачи", "Из переписки"], False, ["Из задачи"], "")])  # 4
    s.answer(60, "Черновик готов. Всё верно?", 20000)                                            # 5
    s.prompt(120, "Нет, забыл сказать: сумма обязательна")                                       # 6
    s.answer(150, "Учёл. Ещё что-то?", 22000)                                                    # 7
    s.prompt(220, "ещё забыл: валюта только рубли")                                              # 8
    s.skill(230, "business-requirements-doc")                                                    # 9
    s.answer(300, "БТ готов. Проверь, всё верно?", 30000)                                        # 10
    s.prompt(500, "[Pasted Content 3021 chars]")                                                 # 11
    s.write(opt_sessions)
    with contextlib.redirect_stdout(io.StringIO()):
        collect.main(["--sessions", opt_sessions, "--out", opt_work])
    _events, _users, opt_candidates = merge.parse_journal(read(os.path.join(opt_work, "opt-1.journal.txt")))
    verdicts = {4: "accepted", 6: "engaged", 8: "engaged"}
    answer = {"findings": [{"type": "deception", "turn": 11, "quote": "[Pasted Content 3021 chars]"}],
              "checks": [{"check": check, "turn": turn, "verdict": verdicts.get(turn, "no")}
                         for check, turn in opt_candidates]}
    with open(os.path.join(opt_work, "opt-1.findings.txt"), "w", encoding="utf-8") as handle:
        json.dump(answer, handle, ensure_ascii=False)
    with contextlib.redirect_stdout(io.StringIO()):
        opt_code = merge.main(["--work", opt_work, "--params", loose_path])
    expect(opt_code == 0 and [check for check in opt_candidates if check[0] == "decision"]
           == [("decision", 4), ("decision", 6), ("decision", 8)], f"opt-1: места решения {opt_candidates}")
    opt = {item["id"]: item for item in outputs(opt_sessions, ("opt-1",))["opt-1"]["metrics"]}
    expect((opt["active_review"]["hits"], opt["active_review"]["events"]) == (2, 2)
           and (opt["blind_confirms"]["hits"], opt["blind_confirms"]["events"]) == (0, 3)
           and opt["delegated"]["events"] == 2 and opt["ignored"]["events"] == 2,
           f"выбор варианта — только в «не читая»: {[(k, opt[k]['hits'], opt[k]['events']) for k in opt]}")
    opt_log = read(os.path.join(opt_sessions, "opt-1.quality.log.txt"))
    expect("deception в ходе 11 — реплика из заглушки вставки, текста нет, отброшена" in opt_log
           and "[4] decision: accepted (выбор варианта)" in opt_log and "[6] decision: engaged" in opt_log,
           f"журнал opt-1: заглушка отброшена, вердикты записаны: {opt_log}")
    # Сессия без скиллов — один запуск; реплика пользователя без ответа агента — обрыв, если так решила модель.
    bare = {"decisions": [], "runs": [], "user_turns": 3,
            "session_run": {"skill": None, "turn": 2, "replied": True, "ended_by": "session_end", "question": None,
                            "unanswered": 6, "error_end": False}}
    bare_events = {2: ["ПОЛЬЗОВАТЕЛЬ: Собери письмо по итогам встречи"], 6: ["ПОЛЬЗОВАТЕЛЬ: Вот поинты от 30.10"]}
    bare_p = params.load(None)
    for verdict, pair in (("yes", (0, 1)), ("no", (1, 1)), (None, None)):
        got = {item["id"]: item for item in merge.compute_metrics(
            bare, {"checks": {("ending", 6): verdict} if verdict else {}}, bare_events, bare_p)}
        done = got["completion"]
        ok = (done["status"] == "not_measured" if pair is None else
              (done["hits"], done["events"]) == pair and done["end_break"] == (verdict == "yes"))
        expect(ok and got["loaded_context"]["reason"] == "не было вызовов скиллов"
               and (got["skill_share"]["hits"], got["skill_share"]["events"]) == (0, 3),
               f"сессия без скиллов, концовка {verdict}: доведение {done['status']} {done['hits']}/{done['events']}, "
               f"нагруженный контекст — {got['loaded_context'].get('reason')}")
        if verdict == "yes":
            expect(done["evidence"] == [{"turn": 6, "quote": "Вот поинты от 30.10", "note": "сессия без скиллов: агент не "
                                         "ответил на последнюю реплику — работа не закончена; в конце сессии"}],
                   f"обрыв сессии без скиллов — реплика без ответа: {done['evidence']}")
    expect(merge.line_quote({4: ["ВОПРОС: Источник: Откуда берём данные? | варианты: Из задачи / Из переписки",
                                 "ОТВЕТ: Источник: Из задачи (вариант)"]}, 4) == "Источник: Из задачи (вариант)",
           "цитата хода с вопросом — ответ, а не вопрос")

    if failures:
        print("\n".join(failures))
        print(f"selftest-merge: провалов {len(failures)} из {checks}; папка оставлена: {root}")
        return 1
    shutil.rmtree(root, ignore_errors=True)
    print(f"selftest-merge: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
