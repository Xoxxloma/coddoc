#!/usr/bin/env python3
"""Параметры оценки из params.json: чтение, проверка, таблица для чтения.

    python3 params.py --check [--params <файл>]           # файл годен или список ошибок
    python3 params.py --render <файл.md> [--params <файл>] # таблица параметров для чтения

collect, merge и contract берут значения только отсюда. Ошибка в файле — остановка с понятным сообщением,
а не тихий неверный скор.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATH = os.path.join(HERE, "params.json")

# Что считает код сейчас — порядок метрик в выходе. Остальные метрики в params.json — запланированные.
IMPLEMENTED_METRICS = ("active_review", "blind_confirms", "delegated", "ignored", "completion",
                       "loaded_context", "skill_share")
REQUIRED = {
    "evaluation": ("decision_min_chars", "reading_speed", "human_speed", "human_min_seconds", "autoinput_fast_min",
                   "autoinput_repeat_min", "autoinput_repeat_min_chars", "continuation_hours", "context_window",
                   "loaded_context_share", "min_events", "min_user_turns", "min_measured_weight"),
    "technical": ("agent_head", "agent_tail", "insert_limit", "insert_preview", "journal_limit", "evidence_limit",
                  "duplicate_seconds"),
}


class ParamsError(ValueError):
    pass


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check(data):
    problems = []
    for section in ("metrics", "evaluation", "technical"):
        if not isinstance(data.get(section), dict):
            problems.append(f"нет раздела «{section}»")
    if problems:
        return problems
    for metric_id in IMPLEMENTED_METRICS:
        if metric_id not in data["metrics"]:
            problems.append(f"metrics: нет метрики «{metric_id}» — код её считает")
    for metric_id, item in data["metrics"].items():
        for field in ("good", "bad", "weight"):
            if not is_number(item.get(field)):
                problems.append(f"metrics.{metric_id}.{field}: нужно число")
        if is_number(item.get("good")) and is_number(item.get("bad")) and item["good"] == item["bad"]:
            problems.append(f"metrics.{metric_id}: good и bad совпадают — баллы не посчитать")
        if is_number(item.get("weight")) and item["weight"] <= 0:
            problems.append(f"metrics.{metric_id}.weight: нужно больше нуля")
    for section, keys in REQUIRED.items():
        for key in keys:
            if key not in data[section]:
                problems.append(f"{section}: нет параметра «{key}»")
    for section in ("evaluation", "technical"):
        for key, item in data[section].items():
            value = item.get("value") if isinstance(item, dict) else None
            if not is_number(value) or value < 0:
                problems.append(f"{section}.{key}.value: нужно число не меньше нуля")
    return problems


def load(path=None):
    path = path or DEFAULT_PATH
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as error:
        raise ParamsError(f"{path}: не прочитать — {error}") from error
    problems = check(data)
    if problems:
        raise ParamsError(f"{path}: " + "; ".join(problems))
    return data


def metric(data, metric_id):
    item = data["metrics"][metric_id]
    return item["good"], item["bad"], item["weight"]


def value(data, key):
    for section in ("evaluation", "technical"):
        if key in data[section]:
            return data[section][key]["value"]
    raise KeyError(key)


def render(data):
    def cell(text):
        return str(text).replace("|", "\\|")

    def shown(item_value):
        if isinstance(item_value, list):
            return ", ".join(f"`{path}`" for path in item_value)
        return f"{item_value:g}" if isinstance(item_value, float) else str(item_value)

    lines = [
        "# Параметры скилла session-quality",
        "",
        "Таблица собрана из `manager-version/session-quality/reference/params.json` — значения правь там (колонка «Ключ»);",
        "скрипты берут их из файла при каждом запуске. Пересобрать таблицу:",
        "`python3 manager-version/session-quality/reference/params.py --render SESSION-QUALITY-PARAMS.md`.",
        "",
        "## 1. Метрики скора",
        "",
        "В скоре — только то, что решает сам пользователь. Норма — 100 баллов, плохо — 0, между ними линейно; у метрик, где",
        "«больше — лучше», норма выше «плохо». Общий скор — среднее баллов метрик с весами. Метрика, у которой за период",
        "мало событий (`min_events`), не считается и в скор не входит.",
        "",
        "**Место решения** — ответ пользователя на вопрос агента (с вариантами или текстом) или на длинный текст агента,",
        "где было что решать: подтвердить, поправить, выбрать (гипотезы, решения, требования, предложенные числа). Отчёт о",
        "сделанном и «продолжать?» — не место решения. Каждое место решения модель относит к одному из четырёх: включился",
        "по существу, согласился, отдал решение агенту, ответил не на вопрос — первые четыре метрики делят эти места.",
        "",
        "| № | Метрика | Как считается | Норма | Плохо | Вес | В коде | Ключ |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for number, (metric_id, item) in enumerate(data["metrics"].items(), 1):
        lines.append(f"| {number} | {cell(item.get('label', metric_id))} | {cell(item.get('how', ''))} | {shown(item['good'])} | "
                     f"{shown(item['bad'])} | {shown(item['weight'])} | {cell(item.get('status', ''))} | `{metric_id}` |")
    lines += ["", "## 2. Вне скора", "", "| Блок | Что показываем | Как считается | В коде |", "|---|---|---|---|"]
    for block in data.get("blocks", []):
        lines.append(f"| {cell(block['block'])} | {cell(block['what'])} | {cell(block['how'])} | {cell(block['status'])} |")
    lines += ["", "## 3. Параметры оценки", "", "| Параметр | Значение | Где используется | В коде | Ключ |", "|---|---|---|---|---|"]
    for key, item in data["evaluation"].items():
        lines.append(f"| {cell(item['label'])} | {shown(item['value'])} | {cell(item.get('used_in', ''))} | "
                     f"{cell(item.get('status', ''))} | `{key}` |")
    lines += ["", "## 4. Технические — на оценку не влияют", "", "| Параметр | Значение | Ключ |", "|---|---|---|"]
    for key, item in data["technical"].items():
        lines.append(f"| {cell(item['label'])} | {shown(item['value'])} | `{key}` |")
    lines.append("| субагентов одновременно (по умолчанию) | 5 | `SKILL.md` · `--parallel` |")
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Параметры оценки: проверка и таблица.")
    parser.add_argument("--params", default=None, help="файл параметров (по умолчанию reference/params.json)")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--render", default=None, help="куда записать таблицу .md")
    cfg = parser.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        data = load(cfg.params)
    except ParamsError as error:
        print(f"Параметры не годятся: {error}")
        return 1
    if cfg.render:
        with open(cfg.render, "w", encoding="utf-8") as handle:
            handle.write(render(data))
        print(f"Таблица записана: {cfg.render}")
    else:
        print("Параметры годятся")
    return 0


if __name__ == "__main__":
    sys.exit(main())
