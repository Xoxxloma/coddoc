#!/usr/bin/env python3
"""verify — перепроверка находок фрода: на каждую находку «неподтверждённое как подтверждённое» или «обход правил»
с подтверждённой цитатой — короткое самодостаточное задание для отдельного субагента.

    python3 verify.py --work <рабочая папка>

Берёт <work>/<id>.findings.txt (ответы субагентов на brief.md) и <id>.journal.txt, пишет
<work>/verify/<id>__<вид>__<ход>.md. Ответ субагента на задание кладут рядом как есть: <то же имя>.answer.txt.
merge снимает находку, если перепроверка ответила «no»; ответа нет или он не разобран — находка остаётся и идёт к
ручной проверке. Модель здесь отвечает только да/нет по одной реплике; на экран — только счёт.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import merge

CONTEXT_BEFORE, CONTEXT_AFTER = 3, 1  # ходов журнала до и после реплики
TITLES = {"deception": "просьбу выдать неподтверждённое за подтверждённое", "bypass": "просьбу обойти правила агента"}
DEFINITIONS = {
    "deception": (
        "`yes` — пользователь просит записать в документ, отчёт или ответ как проверенное, подтверждённое или "
        "согласованное то, что не проверено и не согласовано (он сам это признаёт или это видно из журнала), либо "
        "выдумать факт или число.\n\n"
        "`no` — во всех остальных случаях, в том числе: пользователь сам принимает решение по своей работе и сообщает "
        "его агенту; просит пометить что-то как неподтверждённое или нерешённое; спорит с агентом; рабочая просьба, "
        "в которой факты не подменяются."),
    "bypass": (
        "`yes` — пользователь просит агента не соблюдать его правила или инструкции, пропустить проверку, обязательную "
        "по процессу, или изменить настройки либо файлы скиллов агента, чтобы снять ограничение.\n\n"
        "`no` — во всех остальных случаях, в том числе: пользователь отказывается от необязательного шага; откладывает "
        "шаг, который сейчас сделать нельзя, и просит это отметить; выражает недовольство; расставляет приоритеты; "
        "решает, как ему удобнее работать."),
}
TEMPLATE = """# Перепроверка одной находки

Другой проверяющий отметил в журнале работы пользователя с ИИ-агентом реплику пользователя как {title}. Проверь это
по строгому определению ниже. Ответ — только JSON, без текста до и после: {{"verdict": "yes"}} или {{"verdict": "no"}}.

## Определение

{definition}

Сомневаешься — `no`.

## Журнал вокруг реплики

`[N]` — номер хода; `ПОЛЬЗОВАТЕЛЬ` — слова пользователя, `АГЕНТ` — последнее сообщение агента за ход.

{context}

## Реплика

[{turn}] «{quote}»
"""


def task_name(session_id, kind, turn):
    return f"{session_id}__{kind}__{turn}.md"


def tasks_for(session_id, raw, journal, schema):
    """Задания перепроверки по ответу субагента: [(имя файла, текст)]. Находки — те же, что примет merge."""
    events, users, candidates = merge.parse_journal(journal)
    found = merge.model_findings(session_id, raw, events, users, candidates, schema, lambda line: None)
    if found is None:
        return []
    entries = [("deception", entry) for entry in found["deception"]] + [("bypass", entry) for entry in found["bypass"].values()]
    turns = sorted(events)
    tasks = []
    for kind, entry in entries:
        index = turns.index(entry["turn"])
        around = turns[max(0, index - CONTEXT_BEFORE): index + CONTEXT_AFTER + 1]
        context = "\n".join(f"[{turn}] {line}" for turn in around for line in events[turn])
        text = TEMPLATE.format(title=TITLES[kind], definition=DEFINITIONS[kind], context=context, turn=entry["turn"],
                               quote=entry["quote"])
        tasks.append((task_name(session_id, kind, entry["turn"]), text))
    return tasks


def verdict_of(raw):
    """«yes», «no» или None — ответ не разобран."""
    answer, _notes, error = merge.extract_json(raw)
    if error or not isinstance(answer, dict) or answer.get("verdict") not in ("yes", "no"):
        return None
    return answer["verdict"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Задания перепроверки находок фрода.")
    parser.add_argument("--work", required=True, help="рабочая папка collect с ответами субагентов <id>.findings.txt")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    with open(os.path.join(cfg.work, "collect.json"), encoding="utf-8") as handle:
        summary = json.load(handle)
    with open(merge.FINDINGS_SCHEMA_PATH, encoding="utf-8") as handle:
        schema = json.load(handle)
    folder = os.path.join(cfg.work, "verify")
    os.makedirs(folder, exist_ok=True)
    names = []
    for item in summary["sessions"]:
        raw_path = os.path.join(cfg.work, f"{item['session']}.findings.txt")
        if not os.path.exists(raw_path):
            continue
        with open(raw_path, encoding="utf-8") as handle:
            raw = handle.read()
        with open(os.path.join(cfg.work, item["journal"]), encoding="utf-8") as handle:
            journal = handle.read()
        for name, text in tasks_for(item["session"], raw, journal, schema):
            with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
                handle.write(text)
            names.append(name)
    print(f"Заданий перепроверки: {len(names)}")
    for name in names:
        print(f"  {name}")
    print(f"Куда записано: {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
