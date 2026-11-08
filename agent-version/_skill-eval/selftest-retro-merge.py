#!/usr/bin/env python3
"""Самопроверка retro/reference/merge.py: сверка цитат, слияние частей, счёт «в K из N сессий», таблица для ведущего.

    python3 selftest-retro-merge.py

Три сессии проекта собираются синтетикой (sessionlib.Builder), prepare пишет журналы — s1 режется на части. Ответы
субагентов заготовлены вручную: верные моменты, повтор из перекрытия частей, выдуманная цитата, чужой признак, не та
сторона, лишнее «другое», ответ в обёртке ```, признаки без пометки скрипта у хода, признак скрипта от модели; по s3
ответа нет. В s2 и s3 последняя реплика — на загруженном окне: в счёт идёт только разобранная s2.
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
sys.path.insert(0, os.path.join(HERE, "..", "retro", "reference"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "manager-version", "_skill-eval"))
import merge  # noqa: E402
import prepare  # noqa: E402
from sessionlib import Builder, ask, option  # noqa: E402

PROJECT = "/work/ai-sdd"
HYPOTHESES = "Г1. Справка выдаётся за один день. " * 40


def write_chat(root, name, lines):
    path = os.path.join(root, "projects", "proj", "chats", f"{name}.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(json.dumps(dict(json.loads(line), cwd=PROJECT), ensure_ascii=False) for line in lines) + "\n")


def build_s1():
    b = Builder("s1", "2026-10-20T09:00:00")
    b.user(0, "Нужен БТ по выдаче справок")
    b.agent(10, text=HYPOTHESES, tokens=50000,
            calls=[ask("q1", [{"header": "Гипотезы", "question": "Подтверждаешь?", "options": option("Да", "Нет")}])])
    b.result(13, "ask_user_question", "q1", output="User has provided the following answers:\n\n**Гипотезы**: Да")
    b.agent(30, text="Кто согласует изменение лимита?", tokens=51000)
    b.user(60, "Согласует руководитель отдела рисков")
    b.agent(70, text="Уточните, кто согласует изменение лимита?", tokens=52000)
    b.user(80, "сам реши, мне без разницы")
    for index in range(12):
        b.agent(100 + index * 20, text=f"Раздел {index + 1} готов. " * 6, tokens=53000 + index)
        b.user(110 + index * 20, f"дальше, раздел {index + 2}")
    return b.lines


def build_plain(session_id, base, first):
    b = Builder(session_id, base)
    b.agent(0, text=HYPOTHESES, tokens=40000,
            calls=[ask("q1", [{"header": "Гипотезы", "question": "Подтверждаешь?", "options": option("Да", "Нет")}])])
    b.result(2, "ask_user_question", "q1", output="User has provided the following answers:\n\n**Гипотезы**: Да")
    b.user(30, first)
    b.agent(40, text="Принято.", tokens=190000)  # 72 % окна: «ок» — реплика на загруженном окне
    b.user(60, "ок")
    return b.lines


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    root = tempfile.mkdtemp(prefix="retro-merge-")
    write_chat(root, "s1", build_s1())
    write_chat(root, "s2", build_plain("s2", "2026-10-21T09:00:00", "Срок хранения оставляем решать мне"))
    write_chat(root, "s3", build_plain("s3", "2026-10-22T09:00:00", "Пусть будет так"))
    work = os.path.join(root, "work")
    with open(prepare.PARAMS_PATH, encoding="utf-8") as handle:
        data = json.load(handle)
    data["journal_limit"]["value"] = 2000
    data["part_overlap"]["value"] = 3
    params_path = os.path.join(root, "params.json")
    with open(params_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)
    with contextlib.redirect_stdout(io.StringIO()):
        prepare.main(["--sessions", os.path.join(root, "projects"), "--project", PROJECT, "--out", work, "--params", params_path])

    failures, checks = [], 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    manifest = json.load(open(os.path.join(work, "retro.json"), encoding="utf-8"))
    parts = manifest["sessions"][0]["parts"]
    expect(len(parts) >= 2, f"s1 режется на части: {parts}")

    def turn_of(session, needle):
        for line in open(os.path.join(work, f"{session}.journal.txt"), encoding="utf-8"):
            if needle in line:
                return int(line[1:line.index("]")])
        raise AssertionError(f"нет строки «{needle}» в {session}")

    def part_with(needle):
        return next(name for name in parts if needle in open(os.path.join(work, name), encoding="utf-8").read())

    yes1, ask1 = turn_of("s1", "ОТВЕТ: Гипотезы: Да"), turn_of("s1", "АГЕНТ: Кто согласует")
    slip, delegated = turn_of("s1", "АГЕНТ: Уточните, кто"), turn_of("s1", "сам реши")
    plain = turn_of("s1", "ПОЛЬЗОВАТЕЛЬ: Согласует руководитель")
    opening = turn_of("s1", "ПОЛЬЗОВАТЕЛЬ: Нужен БТ")
    first_part = part_with("ОТВЕТ: Гипотезы: Да")
    second_part = parts[1]
    answers = {
        first_part: {"moments": [
            {"sign": "hypotheses", "side": "hurts", "turn": yes1, "quote": "Гипотезы: Да", "why": "пачка подтверждена за 3 с"},
            {"sign": "context_gap", "side": "helps", "turn": ask1, "quote": "Кто согласует изменение лимита?", "why": "согласующего нет в проекте"},
            {"sign": "agent_slip", "side": "hurts", "turn": slip, "quote": "Уточните, кто согласует", "why": "переспросил"},
            {"sign": "decisions", "side": "hurts", "turn": delegated, "quote": "сам реши", "why": "решение отдано агенту"},
            {"sign": "decisions", "side": "hurts", "turn": ask1, "quote": "Согласен на всё", "why": "выдумано"},
            {"sign": "mood", "side": "hurts", "turn": delegated, "quote": "сам реши", "why": "чужой признак"},
            {"sign": "other", "side": "helps", "turn": yes1, "quote": "Гипотезы", "why": "раз"},
            {"sign": "other", "side": "hurts", "turn": ask1, "quote": "Кто согласует", "why": "два"},
            {"sign": "other", "side": "hurts", "turn": delegated, "quote": "сам реши", "why": "три — лишнее"},
            {"sign": "unknowns", "side": "helps", "turn": "7", "quote": "сам реши", "why": "ход строкой"},
            {"sign": "hypotheses", "side": "hurts", "turn": plain, "quote": "Согласует руководитель", "why": "без пометки"},
            {"sign": "paste", "side": "hurts", "turn": delegated, "quote": "сам реши", "why": "вставки нет"},
            {"sign": "context_hygiene", "side": "hurts", "turn": delegated, "quote": "сам реши", "why": "стадий нет"},
            {"sign": "loaded_work", "side": "hurts", "turn": plain, "quote": "Согласует руководитель", "why": "от модели"},
            {"sign": "outside_skills", "side": "hurts", "turn": plain, "quote": "Согласует руководитель", "why": "от модели"},
            {"sign": "instruction", "side": "hurts", "turn": opening, "quote": "Нужен БТ по выдаче справок", "why": "установка"},
        ]},
        second_part: {"moments": [
            {"sign": "decisions", "side": "hurts", "turn": delegated, "quote": "сам реши", "why": "повтор из перекрытия"},
        ]} if second_part != first_part else {"moments": []},
        "s2.journal.txt": "Вот ответ:\n```json\n" + json.dumps({"moments": [
            {"sign": "hypotheses", "side": "hurts", "turn": turn_of("s2", "ОТВЕТ: Гипотезы: Да"), "quote": "Гипотезы: Да",
             "why": "за 2 с"},
            {"sign": "decisions", "side": "helps", "turn": turn_of("s2", "оставляем решать мне"),
             "quote": "Срок хранения оставляем решать мне", "why": "решение за собой"}]}, ensure_ascii=False) + "\n```",
    }
    for name in parts:
        answers.setdefault(name, {"moments": []})
    for name, answer in answers.items():
        text = answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        encoding = "utf-16" if name == "s2.journal.txt" else "utf-8"  # так пишет ответ команда оболочки на Windows
        with open(os.path.join(work, name.replace(".journal.txt", ".findings.txt")), "w", encoding=encoding) as handle:
            handle.write(text)

    screen = io.StringIO()
    with contextlib.redirect_stdout(screen):
        code = merge.main(["--work", work])
    data = json.load(open(os.path.join(work, "moments.json"), encoding="utf-8"))
    table = open(os.path.join(work, "moments.md"), encoding="utf-8").read()
    log = open(os.path.join(work, "merge-log.txt"), encoding="utf-8").read()
    groups = {(group["sign"], group["side"]): group for group in data["groups"]}

    expect(code == 0 and data["analysed"] == ["s1", "s2"] and data["missing_answers"] == ["s3.journal.txt"],
           f"разобраны s1 и s2, по s3 ответа нет: {data['analysed']}, {data['missing_answers']}")
    expect(groups.get(("hypotheses", "hurts"), {}).get("sessions") == 2, f"гипотезы — мешает — в 2 сессиях: {groups.get(('hypotheses', 'hurts'))}")
    expect([moment["turn"] for moment in groups.get(("decisions", "hurts"), {}).get("moments", [])] == [delegated],
           "«сам реши» — один момент: повтор из перекрытия частей слит, выдуманная цитата отброшена")
    expect(("context_gap", "hurts") in groups and ("context_gap", "helps") not in groups
           and ("agent_slip", "agent") in groups, "у «чего нет в контексте» и «сбоя агента» сторона исправлена")
    expect(len(groups.get(("other", "helps"), {}).get("moments", [])) + len(groups.get(("other", "hurts"), {}).get("moments", [])) == 2,
           "«другое» — не больше двух на журнал")
    expect(("unknowns", "helps") not in groups and not any(group["sign"] == "mood" for group in data["groups"]),
           "ход строкой и чужой признак отброшены")
    expect([group["side"] for group in data["groups"] if group["sign"] != "other"]
           == sorted([group["side"] for group in data["groups"] if group["sign"] != "other"], key=["hurts", "helps", "agent"].index)
           and data["groups"][-1]["sign"] == "other", "порядок: мешает, помогает, сбой агента, другое в конце")
    for line in ("цитата не нашлась в журнале — отброшен", "признак «mood» не из списка", "сторона «helps» исправлена на «hurts»",
                 "больше 2 на журнал", "нет хода или цитаты", "s3: нет ответа субагента",
                 f"hypotheses в ходе {plain} — у хода нет пометки «быстрее чтения» — отброшен",
                 f"paste в ходе {delegated} — у хода нет вставки — отброшен",
                 f"context_hygiene в ходе {delegated} — дальше до /clear нет вызова скилла или команды",
                 "loaded_work — признак скрипта, от модели не принимается — отброшен"):
        expect(line in log, f"в merge-log.txt нет «{line}»")
    expect([moment["turn"] for moment in groups.get(("hypotheses", "hurts"), {}).get("moments", [])
            if moment["session"] == "s1"] == [yes1] and ("paste", "hurts") not in groups
           and ("context_hygiene", "hurts") not in groups, "без пометки скрипта у хода признак выпал, с пометкой — остался")
    loaded = groups.get(("loaded_work", "hurts"), {})
    ok_turn = turn_of("s2", "ПОЛЬЗОВАТЕЛЬ: ок")
    expect(loaded.get("sessions") == 1 and [(m["session"], m["turn"], m["quote"]) for m in loaded.get("moments", [])]
           == [("s2", ok_turn, "ок")]
           and loaded["moments"][0]["why"].startswith("реплик на загруженном окне в этой сессии: 1 (1 — при окне до 7"),
           f"работа на загруженном контексте — по фактам скрипта, только разобранные сессии (s3 без ответа): {loaded}")
    expect("### работа на загруженном контексте — мешает — в 1 из 2" in table, "группа скрипта в таблице для ведущего")
    outside = groups.get(("outside_skills", "hurts"), {})
    expect(outside.get("sessions") == 2 and [(m["session"], m["turn"], m["quote"]) for m in outside.get("moments", [])][0]
           == ("s1", opening, "Нужен БТ по выдаче справок") and outside["moments"][0]["why"].startswith("в скиллах 0 из ")
           and "outside_skills — признак скрипта, от модели не принимается" in log,
           f"работа вне скиллов — по фактам скрипта, разобранные s1 и s2, от модели не принимается: {outside}")
    expect([m["turn"] for m in groups.get(("instruction", "hurts"), {}).get("moments", [])] == [opening],
           "установка агенту — признак модели, принимается с цитатой")
    expect(any(line.startswith("- 20.10 · ") and " · в скиллах 0 % · " in line for line in table.splitlines()),
           "доля скиллов в списке разобранных сессий")
    entry = merge.evidence_of({"fast": [], "pastes": [], "loaded": [11], "after_compression": [30], "clears": [20]})["entry"]
    expect([entry(turn) for turn in (10, 11, 12, 20, 25, 30, 31)] == [True, True, False, False, True, True, False],
           "«чистый контекст»: ход до вызова на загруженном окне — в счёт, если между ними нет /clear")
    expect("### гипотезы агента — мешает — в 2 из 2" in table and "Без ответа субагента: s3.journal.txt" in table
           and "- Ответ на длинный текст агента быстрее чтения: в 3 из 3 сессий" in table
           and "## Разобранные сессии" in table and "20.10 · " in table
           and "сессия s3 — без ответа субагента, в счёт не вошла" in table, "таблица для ведущего: признаки, факты, сессии")
    expect(f"20.10 · сессия s1 · ход {yes1}: «Гипотезы: Да» — пачка подтверждена за 3 с" in table, "пример момента с датой и ходом")
    for secret in ("сам реши", "Гипотезы", "согласует"):
        expect(secret not in screen.getvalue(), f"на экран попал текст: «{secret}»")

    code = None
    with contextlib.redirect_stdout(io.StringIO()):
        code = prepare.main(["--clean", "--out", work])
    expect(code == 0 and not os.path.exists(work), "--clean убирает рабочую папку")

    if failures:
        print("\n".join(failures))
        print(f"selftest-retro-merge: провалов {len(failures)} из {checks}; папка оставлена: {root}")
        return 1
    shutil.rmtree(root, ignore_errors=True)
    print(f"selftest-retro-merge: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
