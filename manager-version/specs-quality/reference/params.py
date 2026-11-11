#!/usr/bin/env python3
"""Параметры оценки из params.json: чтение и проверка.

    python3 params.py --check [--params <файл>]   # файл годен или список ошибок

collect, merge и contract берут значения только отсюда. Ошибка в файле — остановка с понятным сообщением,
а не тихий неверный итог.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATH = os.path.join(HERE, "params.json")

KINDS = ("bt", "spec")
# Критерии по порядку рубрик: состав задан рубриками, в params.json — только веса.
CRITERIA = {
    "bt": ("necessity", "entities", "unambiguity", "verifiability", "actors", "scope", "consistency"),
    "spec": ("traceability", "data_model", "security", "impact", "interfaces", "consistency"),
}
# Разделы списка «Форма» рубрики по порядку: номер раздела — позиция + 1; название идёт в выход рядом с номером.
STRUCTURE_TITLES = {
    "bt": ("Тип изменения", "Описание проблемы", "Конечные потребители", "Заказчик и стейкхолдеры", "Бизнес-цель",
           "Ценность для бизнеса", "Бизнес-риски и меры по снижению", "Входит в проект", "Не входит в проект",
           "Архитектурные изменения и интеграции", "Описание функционала / бизнес-процесса", "Критерии приёмки",
           "Разбиение на части", "Приоритет", "Сроки", "Ролевая модель"),
    "spec": ("Что делаем и тип изменения", "Затронутые сервисы и владельцы", "Связь с бизнес-требованиями", "Взаимодействия",
             "Каталог ошибок", "По сервисам (бэкенд)", "Данные и хранение", "Авторизация/доступ на бэке",
             "Где и что меняется в UI", "Пользовательские сценарии", "Состояния", "Loading и таймауты",
             "Доступ по ролям в UI", "Синхронность, кэш, производительность", "Надёжность/деградация",
             "Безопасность/доступ (сводно)", "Порядок выката", "Обратная совместимость", "Фиче-флаги", "План отката",
             "Преднастройка до релиза", "Трассировка приёмки", "Допущения и открытые вопросы"),
}
# Сколько разделов в списке «Форма» рубрики.
STRUCTURE_SECTIONS = {kind: len(titles) for kind, titles in STRUCTURE_TITLES.items()}


class ParamsError(ValueError):
    pass


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check(data):
    problems = []
    criteria = data.get("criteria")
    attention = data.get("attention")
    if not isinstance(criteria, dict):
        problems.append("нет раздела «criteria»")
    if not isinstance(attention, dict):
        problems.append("нет раздела «attention»")
    if problems:
        return problems
    for kind in KINDS:
        items = criteria.get(kind)
        if not isinstance(items, dict):
            problems.append(f"criteria: нет раздела «{kind}»")
            continue
        if tuple(items) != CRITERIA[kind]:
            problems.append(f"criteria.{kind}: нужны ровно {', '.join(CRITERIA[kind])} в этом порядке")
        for criterion_id, item in items.items():
            weight = item.get("weight") if isinstance(item, dict) else None
            if not is_number(weight) or weight <= 0:
                problems.append(f"criteria.{kind}.{criterion_id}.weight: нужно число больше нуля")
            if not isinstance(item, dict) or not isinstance(item.get("label"), str) or not item["label"]:
                problems.append(f"criteria.{kind}.{criterion_id}.label: нужна строка")
    structure_weight = data.get("structure_weight")
    if not isinstance(structure_weight, dict):
        problems.append("structure_weight: нужен раздел с bt и spec")
    else:
        for kind in KINDS:
            value = structure_weight.get(kind)
            if not is_number(value) or value <= 0:
                problems.append(f"structure_weight.{kind}: нужно число больше нуля")
    below = attention.get("below_pct")
    if not is_number(below) or not 0 <= below <= 100:
        problems.append("attention.below_pct: нужно число от 0 до 100")
    structure_min = attention.get("structure_min_missing")
    if not isinstance(structure_min, dict):
        problems.append("attention.structure_min_missing: нужен раздел с bt и spec")
    else:
        for kind in KINDS:
            value = structure_min.get(kind)
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= STRUCTURE_SECTIONS[kind]:
                problems.append(f"attention.structure_min_missing.{kind}: нужно целое от 1 до {STRUCTURE_SECTIONS[kind]}")
    return problems


def load(path=None):
    path = path or DEFAULT_PATH
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError) as error:
        raise ParamsError(f"Параметры не годятся: {path}: {error}") from error
    problems = check(data) if isinstance(data, dict) else ["файл — не объект JSON"]
    if problems:
        raise ParamsError("Параметры не годятся: " + path + "\n" + "\n".join(problems))
    return data


def weights(data, kind):
    return {criterion_id: item["weight"] for criterion_id, item in data["criteria"][kind].items()}


def structure_weight(data, kind):
    return data["structure_weight"][kind]


def label(data, kind, criterion_id):
    return data["criteria"][kind][criterion_id]["label"]


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--check", action="store_true", required=True)
    parser.add_argument("--params")
    args = parser.parse_args(argv)
    try:
        load(args.params)
    except ParamsError as error:
        print(error)
        return 1
    print(f"OK: {args.params or DEFAULT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
