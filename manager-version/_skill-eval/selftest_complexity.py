#!/usr/bin/env python3
"""selftest_complexity — проверка правил замера сложности на мини-документах: python selftest_complexity.py → «OK»
или список провалов.

Каждый случай собирает папку задачи во временном каталоге и сверяет одно правило analyst-complexity/reference
(document.py, sheets.py, score.py) с числом, записанным заранее.
"""

from __future__ import annotations

import contextlib
import io
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "analyst-complexity",
                                "reference"))
import document  # noqa: E402
import score  # noqa: E402
import sheets  # noqa: E402

FAILURES: list[str] = []


def write(root: str, relative: str, text: str) -> str:
    path = os.path.join(root, relative)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)
    return path


def check(name: str, actual, expected) -> None:
    if actual != expected:
        FAILURES.append(f"{name}: ожидалось {expected!r}, получено {actual!r}")


SENTENCE = "Система сохраняет заявку и показывает пользователю номер."  # 58 знаков + пробел
BT_HEAD = "# Бизнес-требования: проверка\n\n> **Задача:** T-1\n> **Версия скилла:** business-requirements-doc 1.6.1\n\n"


def case_task_files(root: str) -> None:
    folder = os.path.join(root, "coddoc", "T-1")
    write(folder, "scenarios.md", f"{SENTENCE}\n![схема](img/flow.png)\n")  # без заголовка «## »
    write(folder, "img/flow.png", "png")
    write(folder, "decomposition.md", f"{SENTENCE}\n")
    write(folder, "stages/stage-01.md", f"{SENTENCE}\n")
    write(folder, "technical_specification.md", f"{SENTENCE}\n")
    bt = write(folder, "business_requirements.md", BT_HEAD + "## 1. Раздел\n\n"
               f"{SENTENCE}\nСценарии: [файл](scenarios.md), [индекс](decomposition.md), [этап](stages/stage-01.md), "
               "[спека](technical_specification.md), [снаружи](https://example.org/a.md).\n")
    lines = document.read_lines(bt)
    check("файлы задачи: только свой Markdown", [os.path.basename(p) for p in document.task_files(bt, lines)],
          ["scenarios.md"])
    check("иллюстрация из файла задачи", sheets.measure(bt, "bt").illustrations, 1)
    plain = sheets.measure(bt, "bt").chars
    check("файл задачи без заголовка идёт в листы целиком", plain >= 2 * (len(SENTENCE) + 1), True)


def case_root_relative_link(root: str) -> None:
    folder = os.path.join(root, "coddoc", "T-2")
    write(folder, "api.md", f"{SENTENCE}\n")
    spec = write(folder, "technical_specification.md", "# Техническая спецификация: проверка\n\n## 1. Раздел\n\n"
                 "Контракт — в [api.md](/coddoc/T-2/api.md); источник — [БТ](business_requirements.md).\n")
    write(folder, "business_requirements.md", BT_HEAD + "## 1. Раздел\n\nТекст БТ, который спеке не засчитывается никогда.\n")
    lines = document.read_lines(spec)
    check("ссылка от корня репозитория; БТ рядом — не файл задачи",
          [os.path.basename(p) for p in document.task_files(spec, lines)], ["api.md"])


def case_body_and_markup(root: str) -> None:
    folder = os.path.join(root, "coddoc", "T-3")
    write(folder, "pic.png", "png")
    doc = write(folder, "business_requirements.md",
                "# Бизнес-требования: проверка\n\n> шапка\n\n## 1. Раздел\n\n"
                f"{SENTENCE}\n![схема](pic.png)\n\n```plantuml\nA -> B\n```\n\n"
                "| Поле | Тип |\n|---|---|\n| a | int \\| null |\n")
    volume = sheets.measure(doc, "bt")
    check("тело после «## », без картинки, схемы и разметки таблицы", volume.chars, len(SENTENCE) + 1 + 2 + 9)
    check("иллюстрация по ссылке Markdown", volume.illustrations, 1)


def case_epic_child(root: str) -> None:
    epic = os.path.join(root, "coddoc", "E-1")
    write(epic, "business_requirements.md", BT_HEAD + f"## 4.2. Критерии приёмки\n\n- **[FR-1]** Дано: {SENTENCE}\n")
    child = write(epic, "C-1/business_requirements.md",
                  "---\nparent: E-1\nsource: coddoc/E-1/business_requirements.md\n---\n\n" + BT_HEAD
                  + f"## 4.2. Критерии приёмки\n\n- **[FR-1]** Дано: {SENTENCE}\n")
    check("ребёнок эпика: скопированный сценарий не в листах", sheets.measure(child, "bt").chars, 0)
    items = {"scenarios": [{"quote": f"Дано: {SENTENCE[:40]}", "file": "business_requirements.md"}]}
    result = score.assess(child, "bt", items)
    check("ребёнок эпика: скопированный сценарий засчитан эпику", (result.features[0][2], result.notes),
          (0, ["засчитано родителю: 1"]))
    orphan = write(root, "coddoc/O-1/business_requirements.md",
                   "---\nsource: coddoc/NO-1/business_requirements.md\n---\n\n" + BT_HEAD + f"## 1. Раздел\n\n{SENTENCE}\n")
    check("эпик по source: не найден — пометка в строке результата",
          "БТ эпика по source: не найден — наследство не вычтено" in score.assess(orphan, "bt", {}).line(), True)
    spec = write(epic, "C-1/technical_specification.md",
                 "# Техническая спецификация: ребёнок\n\n## 2. Взаимодействия (ядро)\n\n"
                 "### INT-0. Контракт фундамента — 🔵 depends-on #0, унаследовано\n- **Вид:** потребление существующего\n"
                 f"- **Пример ответа:** {SENTENCE}\n\n### INT-1. Своё — 🟢\n- **Вид:** потребление существующего\n"
                 f"- **Триггер:** {SENTENCE}\n")
    own = document.own_lines(spec, "spec", document.read_lines(spec))
    check("спека ребёнка: блок с depends-on #0 снят, своя карточка цела",
          (sum("INT-0" in line for line in own), sum("Вид" in line for line in own)), (0, 1))


def case_stub_words(root: str) -> None:
    check("заглушка: «нет» внутри слова не режет его", sheets.is_stub("Не применимо: раздел кабинета клиента"), True)
    check("заглушка: слово через дефис — одно слово", sheets.is_stub("Не применимо: фронт-энд не меняется"), True)
    check("причина длиннее трёх слов — не заглушка", sheets.is_stub("Не применимо: выгрузка работает как обычный запрос"), False)


def case_result_line_and_bom(root: str) -> None:
    folder = os.path.join(root, "coddoc", "L-1")
    doc = write(folder, "business_requirements.md", BT_HEAD + f"## 1. Раздел\n\n{SENTENCE}\n")
    items = write(folder, "items.json", "﻿" + '{"roles": [{"quote": "выдуманная роль, которой нет в документе"}]}')
    result = score.assess(doc, "bt", {"roles": [{"quote": "выдуманная роль, которой нет в документе"}]})
    check("пометка о ненайденной цитате — в строке результата", "цитат не найдено: 1" in result.line(), True)
    with contextlib.redirect_stdout(io.StringIO()):
        code = score.main(["bt", doc, items])
    check("выписка с BOM читается", code, 0)


def case_template_version(root: str) -> None:
    folder = os.path.join(root, "coddoc", "V-1")
    doc = write(folder, "business_requirements.md", BT_HEAD.replace("1.6.1", "1.5.0, business-requirements-doc 1.6.1")
                + "## 1. Раздел\n\nТекст.\n")
    check("версия шаблона — последняя запись списка", document.template_version(document.read_lines(doc)),
          "business-requirements-doc 1.6.1")


def spec_with_type(folder: str, change_type: str) -> str:
    return write(folder, "technical_specification.md", "# Техническая спецификация: проверка\n\n"
                 f"## 1. Обзор изменения\n\n### 1.1. Что делаем и тип изменения\n**Тип:** {change_type}\n\n{SENTENCE}\n")


def case_simplified_types(root: str) -> None:
    items_base = {"services": [{"quote": SENTENCE[:30]}], "open_items": [{"quote": SENTENCE[10:40]}]}
    bugfix = spec_with_type(os.path.join(root, "coddoc", "B-1"), "багфикс")
    result = score.assess(bugfix, "spec", {**items_base, "change_type": {"value": "багфикс", "quote": "**Тип:** багфикс"}})
    check("багфикс: класс 1 и долг", (result.complexity_class, result.debt), (1, 1))
    folder = os.path.join(root, "coddoc", "R-1")
    write(folder, "change_request.md", "Вердикт: объём выше порога (строки 2–3), аналитик решил идти правкой.\n")
    small = spec_with_type(folder, "мелкая правка")
    above = {"yes": True, "quote": "объём выше порога (строки 2–3), аналитик решил идти правкой", "file": "change_request.md"}
    result = score.assess(small, "spec", {**items_base, "change_type": {"value": "мелкая правка", "quote": "Тип: мелкая правка"},
                                          "above_threshold": above})
    check("мелкая правка выше порога считается по признакам", "мелкая правка выше порога — считается по признакам" in result.notes, True)
    result = score.assess(small, "spec", {**items_base, "change_type": {"value": "мелкая правка", "quote": "Тип: мелкая правка"},
                                          "above_threshold": {**above, "quote": "выдуманный вердикт про порог"}})
    check("вердикт без цитаты — класс 1", result.complexity_class, 1)


def case_quotes(root: str) -> None:
    folder = os.path.join(root, "coddoc", "Q-1")
    write(folder, "business_requirements.md", BT_HEAD + "## 1. Раздел\n\nСтрока только из БТ, её спека не цитирует.\n")
    spec = spec_with_type(folder, "доработка")
    items = {"change_type": {"value": "доработка", "quote": "Тип: доработка"},
             "services": [{"quote": "Строка только из БТ, её спека не цитирует"}, {"quote": SENTENCE[:30]},
                          {"quote": SENTENCE[:30]}],
             "contracts": [{"quote": SENTENCE[:30], "method": "get", "path": "/a/{id}?x=1"},
                           {"quote": SENTENCE[5:40], "method": "GET", "path": "/a/{itemId}"},
                           {"quote": SENTENCE[2:35], "method": "EVENT", "path": "order.created"},
                           {"quote": SENTENCE[3:36], "method": "EVENT", "path": "order.cancelled"}]}
    result = score.assess(spec, "spec", items)
    features = {code: value for code, _, value, _ in result.features}
    check("цитата из соседнего БТ не засчитана, повтор склеен", (features["С1"], "цитат не найдено: 1" in result.notes), (1, True))
    check("стык: параметры пути и запроса не делают его другим, события считаются по имени", features["С3"], 3)
    shared = SENTENCE[:40]
    states = score.Quotes(spec, "spec").distinct(
        [{"name": "черновик", "quote": shared}, {"name": "отправлено", "quote": shared}, {"name": "Черновик", "quote": shared}])
    check("пункты одной строки различаются по имени, повтор имени склеен", len(states), 2)
    quotes = score.Quotes(spec, "spec")
    check("цитата с ошибкой в окончании слова засчитана",
          quotes.counts({"quote": "Система сохраняет заявку и показывает пользователю номера"}), True)
    check("выдуманная цитата той же длины не засчитана",
          quotes.counts({"quote": "Сервис отклоняет запрос и сообщает пользователю причину"}), False)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    with tempfile.TemporaryDirectory() as root:
        for case in (case_task_files, case_root_relative_link, case_body_and_markup, case_epic_child,
                     case_simplified_types, case_quotes, case_stub_words, case_template_version,
                     case_result_line_and_bom):
            try:
                case(root)
            except Exception as error:  # noqa: BLE001 — провал случая, а не всей проверки
                FAILURES.append(f"{case.__name__}: {type(error).__name__}: {error}")
    print("OK" if not FAILURES else "\n".join(FAILURES))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
