#!/usr/bin/env python3
"""merge — второй шаг ретро: ответы субагентов → проверенные моменты и таблица для ведущего.

    python3 merge.py --work <рабочая папка>

В --work лежат retro.json и журналы (их пишет prepare) и ответы субагентов <задание>.findings.txt — как есть, где
<задание> — имя журнала без .journal.txt. Момент без дословной цитаты в журнале выпадает; одинаковые моменты из
соседних частей журнала сливаются. У признаков, где пометка скрипта — часть определения («быстрее чтения», вставка,
загруженное окно или сжатие на вызове скилла), момент без этой пометки у хода выпадает. «Работу на загруженном
контексте» и «работу вне скиллов» собирает сам скрипт по фактам prepare — от модели эти признаки не принимаются. Пишет:
  moments.json  — проверенные моменты и счёт «в K из N сессий» по признаку и стороне;
  moments.md    — таблица для ведущего: факты скрипта, признаки по убыванию K, разобранные сессии;
  merge-log.txt — что отброшено и почему.
Модель ничего не считает: счёт сессий — здесь. На экран — только счёт.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from textutil import clip

MANIFEST = "retro.json"
SIGNS = {
    "entry": "вход через /analyst-workspace",
    "task_key": "ключ задачи",
    "resume": "продолжение прерванной работы",
    "project_context": "опора на карточки проекта",
    "context_gap": "чего нет в контексте проекта",
    "hypotheses": "гипотезы агента",
    "decisions": "решения",
    "unknowns": "неизвестное",
    "correction_loop": "петля поправок",
    "context_hygiene": "чистый контекст между стадиями",
    "loaded_work": "работа на загруженном контексте",
    "paste": "большие вставки",
    "acceptance": "приёмка",
    "order": "проверка спеки до разбиения",
    "instruction": "установки агенту",
    "outside_skills": "работа вне скиллов",
    "agent_slip": "сбой агента",
    "other": "другое",
}
SIDES = {"hurts": "мешает", "helps": "помогает", "agent": "сбой агента"}
FIXED_SIDE = {"context_gap": "hurts", "agent_slip": "agent"}  # у этих признаков одна сторона
SCRIPT_SIGNS = ("loaded_work", "outside_skills")  # эти группы собирает скрипт по фактам prepare
# Пометка скрипта — часть определения признака: без неё у хода момент выпадает. Значение — (вид улики, причина в лог).
PEGGED = {
    ("hypotheses", "hurts"): ("fast", "у хода нет пометки «быстрее чтения»"),
    ("paste", "hurts"): ("pastes", "у хода нет вставки"),
    ("context_hygiene", "hurts"): ("entry", "дальше до /clear нет вызова скилла или команды на загруженном окне или после "
                                            "сжатия"),
}
REPLY_PREFIXES = ("ПОЛЬЗОВАТЕЛЬ:", "ОТВЕТ:")
OTHER_LIMIT = 2
EXAMPLES = 5
LINE_RE = re.compile(r"^\[(\d+)\] (.*)$")


def extract_json(text):
    """(объект, ошибка). Обёртку ``` терпим; объектов несколько — модель поправила себя, берём последний."""
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
    return (objects[-1], None) if objects else (None, "не JSON")


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


def journal_lines(path):
    turns = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = LINE_RE.match(line)
        if match:
            turns.setdefault(int(match.group(1)), []).append(match.group(2))
    return turns


def evidence_of(item):
    """Улики скрипта по сессии: ход → есть ли у него пометка. Для «чистого контекста» — ход, после которого до /clear
    есть вызов скилла или команда на загруженном окне или после сжатия: модель может сослаться и на сам вызов, и на
    реплику перед ним. Новая ли это стадия, решает модель."""
    fast = {entry["n"] for entry in item["fast"]}
    pastes = {entry["n"] for entry in item["pastes"]}
    entries = set(item["loaded"]) | set(item["after_compression"])
    clears = item["clears"]

    def entry(turn):
        return any(at >= turn and not any(turn <= clear < at for clear in clears) for at in entries)

    return {"fast": fast.__contains__, "pastes": pastes.__contains__, "entry": entry}


def check(item, session, turns, log, evidence):
    """Момент из ответа модели → проверенный момент или None (причина — в лог)."""
    if not isinstance(item, dict):
        log(f"{session}: момент не объект — отброшен")
        return None
    sign, side, turn, quote = item.get("sign"), item.get("side"), item.get("turn"), item.get("quote")
    if sign not in SIGNS:
        log(f"{session}: признак «{clip(str(sign), 40)}» не из списка — отброшен")
        return None
    if sign in SCRIPT_SIGNS:
        log(f"{session}: {sign} — признак скрипта, от модели не принимается — отброшен")
        return None
    if sign in FIXED_SIDE and side != FIXED_SIDE[sign]:
        log(f"{session}: {sign} в ходе {turn} — сторона «{side}» исправлена на «{FIXED_SIDE[sign]}»")
        side = FIXED_SIDE[sign]
    if side not in SIDES:
        log(f"{session}: {sign} в ходе {turn} — сторона «{clip(str(side), 20)}» не из списка — отброшен")
        return None
    if not isinstance(turn, int) or isinstance(turn, bool) or not isinstance(quote, str) or not quote.strip():
        log(f"{session}: {sign} — нет хода или цитаты — отброшен")
        return None
    if turn not in turns or not quote_in(quote, turns[turn]):
        log(f"{session}: {sign} в ходе {turn} — цитата не нашлась в журнале — отброшен")
        return None
    pegged = PEGGED.get((sign, side))
    if pegged and not evidence[pegged[0]](turn):
        log(f"{session}: {sign} в ходе {turn} — {pegged[1]} — отброшен")
        return None
    why = item.get("why") if isinstance(item.get("why"), str) else ""
    return {"session": session, "sign": sign, "side": side, "turn": turn, "quote": clip(quote, 200), "why": clip(why, 200)}


def read_answer(path):
    """Ответ субагента как текст. Записанный командой оболочки бывает в UTF-16 или в кодировке системы: не падаем,
    а нечитаемое уходит в «ответ не разобран»."""
    data = path.read_bytes()
    for codec in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(codec)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def collect(work, manifest, log):
    """→ (проверенные моменты, разобранные сессии, сессии без ответа)."""
    turns = {item["session"]: journal_lines(work / item["journal"]) for item in manifest["sessions"]}
    evidence = {item["session"]: evidence_of(item) for item in manifest["sessions"]}
    moments, seen, answered, missing = [], set(), set(), []
    for task in manifest["tasks"]:
        session, name = task["session"], task["journal"]
        path = work / (name[: -len(".journal.txt")] + ".findings.txt")
        if not path.exists():
            log(f"{session}: нет ответа субагента на {name}")
            missing.append(name)
            continue
        answer, error = extract_json(read_answer(path))
        items = answer.get("moments") if answer else None
        if error or not isinstance(items, list):
            log(f"{session}: ответ на {name} не разобран — {error or 'нет moments'}")
            missing.append(name)
            continue
        answered.add(session)
        others = 0
        for item in items:
            moment = check(item, session, turns[session], log, evidence[session])
            if not moment:
                continue
            if moment["sign"] == "other":
                others += 1
                if others > OTHER_LIMIT:
                    log(f"{session}: «другое» в ходе {moment['turn']} — больше {OTHER_LIMIT} на журнал — отброшено")
                    continue
            key = (session, moment["sign"], moment["side"], moment["turn"])
            if key in seen:
                continue  # тот же момент из перекрытия частей или повтор модели
            seen.add(key)
            moments.append(moment)
    moments += loaded_moments(manifest, turns, answered, log)
    moments += outside_moments(manifest, turns, answered, log)
    return moments, answered, missing


def reply_quote(turns, turn):
    """Цитата для группы скрипта — текст реплики пользователя на этом ходе, без метки строки."""
    line = next((text for text in turns.get(turn, []) if text.startswith(REPLY_PREFIXES)), "")
    return clip(line.split(": ", 1)[-1], 200)


def skill_share(item):
    replies = item["skill_replies"]
    return replies["inside"] / replies["total"] if replies["total"] else None


def loaded_moments(manifest, turns, answered, log):
    """«Работа на загруженном контексте» по фактам prepare: момент на сессию — первая такая реплика. Группы скрипта —
    только по разобранным сессиям, чтобы счёт шёл из того же N, что у остальных признаков."""
    out = []
    for item in manifest["sessions"]:
        work = item["loaded_work"]
        if item["session"] not in answered or not work:
            continue
        high = [entry["share"] for entry in work if not entry["after_compression"] and entry["share"] is not None]
        after = len(work) - len(high)
        parts = ([f"{len(high)} — при окне до {round(max(high) * 100)} %"] if high else []) \
            + ([f"{after} — после сжатия"] if after else [])
        out.append({"session": item["session"], "sign": "loaded_work", "side": "hurts", "turn": work[0]["n"],
                    "quote": reply_quote(turns[item["session"]], work[0]["n"]),
                    "why": f"реплик на загруженном окне в этой сессии: {len(work)} ({'; '.join(parts)})"})
    if out:
        log(f"работа на загруженном контексте — по фактам скрипта, сессий: {len(out)}")
    return out


def outside_moments(manifest, turns, answered, log):
    """«Работа вне скиллов» по фактам prepare: доля реплик внутри запусков скиллов ниже порога. Момент на сессию —
    первая реплика вне скилла."""
    limit, out = manifest["params"]["skill_share_min"], []
    for item in manifest["sessions"]:
        share, replies = skill_share(item), item["skill_replies"]
        if item["session"] not in answered or share is None or share >= limit or replies["outside_first"] is None:
            continue
        out.append({"session": item["session"], "sign": "outside_skills", "side": "hurts", "turn": replies["outside_first"],
                    "quote": reply_quote(turns[item["session"]], replies["outside_first"]),
                    "why": f"в скиллах {replies['inside']} из {replies['total']} реплик ({round(share * 100)} %)"})
    if out:
        log(f"работа вне скиллов — по фактам скрипта, сессий: {len(out)}")
    return out


def groups_of(moments, sessions):
    start = {item["session"]: item["start"] for item in sessions}
    order = {session: index for index, session in enumerate(start)}
    groups = {}
    for moment in sorted(moments, key=lambda item: (order[item["session"]], item["turn"])):
        groups.setdefault((moment["sign"], moment["side"]), []).append(moment)
    rank = {"hurts": 0, "helps": 1, "agent": 2}
    out = [{"sign": sign, "side": side, "label": SIGNS[sign], "side_label": SIDES[side],
            "sessions": len({item["session"] for item in items}), "moments": items}
           for (sign, side), items in groups.items()]
    out.sort(key=lambda group: (group["sign"] == "other", rank[group["side"]], -group["sessions"], group["label"]))
    return out


def facts_of(sessions):
    def count(test):
        return sum(1 for item in sessions if test(item))

    weak = {}
    for item in sessions:
        for model, answers in item["weak"].items():
            weak[model] = weak.get(model, 0) + answers
    return {"weak": {"sessions": count(lambda item: item["weak"]), "models": weak},
            "loaded": count(lambda item: item["loaded"]),
            "compressed": count(lambda item: item["compressions"] or item["suspected"]),
            "fast": {"sessions": count(lambda item: item["fast"]), "answers": sum(len(item["fast"]) for item in sessions)},
            "pastes": count(lambda item: item["pastes"]),
            "api_errors": sum(item["api_errors"] for item in sessions),
            "tool_errors": sum(item["tool_errors"] for item in sessions)}


def day(stamp):
    return f"{stamp[8:10]}.{stamp[5:7]}" if stamp else "—"


def render(manifest, groups, facts, analysed, missing):
    sessions = manifest["sessions"]
    total = len(sessions)
    start = {item["session"]: item["start"] for item in sessions}
    lines = ["# Моменты ретро — для ведущего", "",
             f"Разобрано сессий: {len(analysed)} из {total}." + (f" Без ответа субагента: {', '.join(missing)}." if missing else "")
             + (" Сессий мало — повторяющихся привычек может не выйти." if manifest.get("few") else ""), "",
             "## Факты скрипта", ""]
    weak = facts["weak"]
    lines += [
        f"- Слабая модель: в {weak['sessions']} из {total} сессий"
        + (" (" + ", ".join(f"{model} — ответов {answers}" for model, answers in weak["models"].items()) + ")" if weak["models"] else ""),
        f"- Скилл или команда при контексте выше порога: в {facts['loaded']} из {total} сессий",
        f"- Сжатие контекста (записанное или похожее): в {facts['compressed']} из {total} сессий",
        f"- Ответ на длинный текст агента быстрее чтения: в {facts['fast']['sessions']} из {total} сессий, всего {facts['fast']['answers']}",
        f"- Большие вставки в чат: в {facts['pastes']} из {total} сессий",
        f"- Ошибки API: {facts['api_errors']}; ошибки инструментов: {facts['tool_errors']}",
    ]
    if manifest.get("missing_fields"):
        lines.append("- В журналах не нашлось: " + "; ".join(manifest["missing_fields"]))
    lines += ["", f"## Признаки — в скольких из {len(analysed)} разобранных сессий", ""]
    if not groups:
        lines.append("Проверенных моментов нет.")
    for group in groups:
        lines.append(f"### {group['label']} — {group['side_label']} — в {group['sessions']} из {len(analysed)}")
        for moment in group["moments"][:EXAMPLES]:
            tail = f" — {moment['why']}" if moment["why"] else ""
            lines.append(f"- {day(start[moment['session']])} · сессия {moment['session'][:8]} · ход {moment['turn']}: "
                         f"«{moment['quote']}»{tail}")
        if len(group["moments"]) > EXAMPLES:
            lines.append(f"- и ещё {len(group['moments']) - EXAMPLES}")
        lines.append("")
    lines += ["## Разобранные сессии", ""]
    for item in sessions:
        models = ", ".join(item["models"]) or "—"
        share = skill_share(item)
        in_skills = f" · в скиллах {round(share * 100)} %" if share is not None else ""
        lines.append(f"- {day(item['start'])} · {item['minutes']} мин · реплик {item['user_turns']}{in_skills} · {models} · "
                     f"сессия {item['session'][:8]}"
                     + ("" if item["session"] in analysed else " — без ответа субагента, в счёт не вошла"))
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Ответы субагентов → проверенные моменты ретро.")
    parser.add_argument("--work", required=True, help="рабочая папка prepare с ответами <задание>.findings.txt")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    work = Path(cfg.work)
    try:
        manifest = json.loads((work / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"Нет разобранного {MANIFEST} в {work}: {error}. Сначала prepare.py.")
        return 1
    log_lines = []
    moments, answered, missing = collect(work, manifest, log_lines.append)
    groups = groups_of(moments, manifest["sessions"])
    facts = facts_of(manifest["sessions"])
    data = {"sessions_total": len(manifest["sessions"]), "analysed": sorted(answered), "missing_answers": missing,
            "facts": facts, "groups": groups}
    (work / "moments.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (work / "moments.md").write_text(render(manifest, groups, facts, answered, missing), encoding="utf-8")
    (work / "merge-log.txt").write_text("\n".join(log_lines) + ("\n" if log_lines else ""), encoding="utf-8")
    print(f"Сессий разобрано: {len(answered)} из {len(manifest['sessions'])}; моментов проверено: {len(moments)}; "
          f"отброшено: {sum(1 for line in log_lines if line.endswith('отброшен') or line.endswith('отброшено'))}")
    print(f"Для ведущего: {work / 'moments.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
