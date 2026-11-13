#!/usr/bin/env python3
"""complexity_baseline — класс сложности БТ или спеки (1–5) по признакам шаблона, без агента.

    python3 complexity_baseline.py bt|spec <файл>

Каждый признак — число решений аналитика в своём разделе шаблона (БТ 1.6, спека 1.8). Сырое число переводится
в балл 0–3 по корзинам, баллы складываются, сумма переводится в класс. Раздел ищется по названию из шаблона,
номер служит запасным путём. Раздел не найден — признак даёт 0, в строку результата идёт пометка. Найден только
по номеру — тоже пометка: так видно, что шаблон переименовал раздел.

Эталон стенда: признаки по форме шаблона, без агента. В инструмент замера (analyst-complexity/) не входит.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple


BT_CLASS_THRESHOLDS = (3, 6, 9, 12)  # баллы БТ 0–15
SPEC_CLASS_THRESHOLDS = (6, 11, 17, 23)  # баллы спеки 0–27

MARKS = re.compile("[🟢🔵🟡❓⚠️]")
EMPHASIS = re.compile(r"\*\*|`|\*")
STRUCK_TEXT = re.compile(r"~~[^~]*~~")
LIST_MARKER = re.compile(r"^\s*([-*]|\d+\.)\s+(\[[ x]\]\s*)?", re.IGNORECASE)
HEADING = re.compile(r"^(#{2,4}) (?:~~)?(\d+(?:\.\d+)*)?\.?\s*(.*)$")
STRUCK_HEADING = re.compile(r"^#+ ~~")
TABLE_SEPARATOR = re.compile(r"^\|\s*:?-")
NOT_APPLICABLE = re.compile(r"^не применим|^[^:]{1,40}:\s*не применим", re.IGNORECASE)
FENCE = re.compile(r"^\s*```")

ENDPOINT = re.compile(r"(?<![A-Za-z0-9_])(GET|POST|PUT|PATCH|DELETE)\s+`?(/[^\s`,)]*)")
PATH_PARAMETER = re.compile(r"\{[^}]*\}")
INTERACTION_KIND = re.compile(r"\*\*Вид:\*\*\s*([^\n]+)")
ERROR_CODE_ROW = re.compile(r"\|\s*\d{3}\s*\|")
UNCHANGED_ERROR = re.compile("как сейчас|не меняется", re.IGNORECASE)
CHECKBOX = re.compile(r"^\s*-\s*\[[ x]\]")
STRUCK_CHECKBOX = re.compile(r"^\s*-\s*\[[ x]\]\s*~~")
CONFIRMED_FACT = re.compile(r"🔵[^|;]{0,160}")
FACT_FROM_SERVICE_CARD = re.compile(r"карточк|services/")


@dataclass
class Section:
    number: str
    title: str
    level: int
    heading: str
    start: int
    lines: list[str] = field(default_factory=list)


class Feature(NamedTuple):
    label: str
    value: object
    points: int


def bucket(value: int, thresholds) -> int:
    """Балл 0–3: сколько нижних границ корзин 1, 2, 3 значение достигло."""
    return sum(1 for threshold in thresholds if value >= threshold)


def clean(text: str) -> str:
    """Строка без зачёркнутого, разметки, меток и маркера списка."""
    text = STRUCK_TEXT.sub("", text)
    text = EMPHASIS.sub("", text)
    text = MARKS.sub("", text)
    text = LIST_MARKER.sub("", text)
    text = text.replace("|", " ")
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------- разделы документа


class Document:
    def __init__(self, text: str):
        self.lines = text.replace("\r", "").split("\n")
        self.sections = self._split()
        self.notes: list[str] = []

    def _split(self) -> list[Section]:
        """Разделы по заголовкам ##–####; строки до первого заголовка — раздел без номера и названия."""
        current = Section("", "", 0, "", -1)
        sections = []
        for number, line in enumerate(self.lines):
            heading = HEADING.match(line)
            if heading:
                sections.append(current)
                current = Section(number=heading.group(2) or "", title=heading.group(3).replace("~~", "").strip(),
                                  level=len(heading.group(1)), heading=line, start=number)
            else:
                current.lines.append(line)
        sections.append(current)
        return sections

    def section(self, number: str | None, name: str, level: int = 0, where: str | None = None) -> Section | None:
        """Раздел шаблона: по началу названия, иначе по номеру. Промах и находка по номеру попадают в пометки."""
        where = where or f"§{number}"
        same_level = [s for s in self.sections if not level or s.level == level]
        for section in same_level:
            if section.title.lower().startswith(name.lower()):
                return section
        if number:
            for section in same_level:
                if section.number == number:
                    self.notes.append(f"раздел «{name}» ({where}) найден только по номеру, "
                                      f"в документе он называется «{section.title}»")
                    return section
        self.notes.append(f"не найден раздел «{name}» ({where})")
        return None

    def block(self, section: Section | None) -> list[str]:
        """Строки раздела вместе с подразделами: до следующего заголовка того же уровня или выше."""
        if not section:
            return []
        end = next((s.start for s in self.sections if s.start > section.start and s.level <= section.level),
                   len(self.lines))
        return self.lines[section.start:end]


def is_struck(section: Section | None) -> bool:
    """Раздела нет или его заголовок зачёркнут."""
    return not section or bool(STRUCK_HEADING.match(section.heading))


def body(section: Section | None) -> list[str]:
    return [text for text in map(clean, section.lines) if text] if section else []


def has_content(section: Section | None) -> bool:
    """Раздел не зачёркнут, и в нём есть что-то кроме «не применимо» и прочерка."""
    return not is_struck(section) and any(not NOT_APPLICABLE.match(text) and text != "—" for text in body(section))


def table_rows(section: Section | None) -> list[str]:
    """Строки таблиц раздела без разделителей и без строки заголовка первой таблицы."""
    if not section:
        return []
    return [line for line in section.lines if line.startswith("|") and not TABLE_SEPARATOR.match(line)][1:]


def section_lines(section: Section | None) -> list[str]:
    return section.lines if section else []


# ---------------------------------------------------------------- признаки БТ


def object_weight(row: str) -> int:
    """Бизнес-объект по последней колонке: новый — 2, без изменений — 0, изменённый — 1."""
    cells = [clean(cell) for cell in row.split("|")[1:-1]]
    change = (cells[-1] if cells else "").lower()
    if change.startswith("нов"):
        return 2
    if re.match(r"^без изменений\.?$", change):
        return 0
    return 1


def bt_features(doc: Document) -> list[Feature]:
    acceptance = doc.section("4.2", "Критерии приёмки")
    roles = doc.section("5.3", "Ролевая модель")
    business_data = doc.section("4.3", "Бизнес-данные")
    out_of_scope = doc.section("3.2", "Не входит в проект")
    split = doc.section("4.5", "Разбиение на части")

    scenarios = " ".join(body(acceptance)).count("Дано")
    role_count = len(table_rows(roles))
    objects = sum(object_weight(row) for row in table_rows(business_data))
    boundaries = sum(1 for line in section_lines(out_of_scope) if re.match(r"^\s*-", line) and "TBD" not in line)
    split_body = body(split)
    not_split = not split or bool(re.search("не применим", split_body[0] if split_body else "", re.IGNORECASE))
    parts = 0 if not_split else len(table_rows(split))

    return [
        Feature("Б1. Сценарии приёмки", scenarios, bucket(scenarios, (1, 4, 9))),
        Feature("Б2. Роли", role_count, bucket(role_count, (2, 4, 6))),
        Feature("Б3. Бизнес-объекты", objects, bucket(objects, (1, 3, 6))),
        Feature("Б4. Границы объёма", boundaries, bucket(boundaries, (1, 3, 5))),
        Feature("Б5. Разрез на части", parts, bucket(parts, (2, 3, 4))),
    ]


# ---------------------------------------------------------------- признаки спеки


def interaction_weight(card: Section) -> int:
    """Карточка INT-N: потребление — 1, новое или изменение существующего — 2, зачёркнутая и depends-on #0 — 0."""
    if is_struck(card) or "depends-on #0" in card.heading:
        return 0
    kind = INTERACTION_KIND.search("\n".join(card.lines))
    return 1 if kind and re.search("потреблен", kind.group(1), re.IGNORECASE) else 2


def contract_size(lines: list[str]) -> int:
    """Разные «МЕТОД /путь» вне блоков кода плюс строки таблиц «Было / Стало»."""
    endpoints: set[str] = set()
    change_rows = 0
    in_code = in_change_table = False
    for line in lines:
        if FENCE.match(line):
            in_code = not in_code
            continue
        if in_code:
            continue
        for match in ENDPOINT.finditer(line):
            endpoints.add(f"{match.group(1)} {PATH_PARAMETER.sub('{}', match.group(2))}")
        if line.startswith("|") and re.search("Было", line, re.IGNORECASE) and re.search("Стало", line, re.IGNORECASE):
            in_change_table = True
            continue
        if in_change_table and TABLE_SEPARATOR.match(line):
            continue
        if in_change_table and line.startswith("|"):
            change_rows += 1
            continue
        in_change_table = False
    return len(endpoints) + change_rows


def confirmed_facts(doc: Document, open_questions: Section | None) -> int:
    """Метки 🔵 до раздела «Допущения и открытые вопросы» (§8), кроме фактов из карточки сервиса."""
    stop = open_questions.start if open_questions else -1
    count = 0
    for number, line in enumerate(doc.lines):
        if line.startswith(">") or (stop >= 0 and number > stop):
            continue
        count += sum(1 for match in CONFIRMED_FACT.finditer(line) if not FACT_FROM_SERVICE_CARD.search(match.group()))
    return count


def spec_features(doc: Document) -> list[Feature]:
    services_section = doc.section("1.2", "Затронутые сервисы")
    interactions = doc.section("2", "Взаимодействия", 2)
    error_catalog = doc.section(None, "Каталог ошибок", 0, "§2, последний подраздел")
    data_storage = doc.section("3.2", "Данные и хранение")
    states_section = doc.section("4.3", "Состояния")
    access_and_nfr = [doc.section(number, name) for number, name in (
        ("3.3", "Авторизация/доступ на бэке"), ("4.4", "Доступ по ролям в UI"), ("5.1", "Синхронность"),
        ("5.2", "Надёжность"), ("5.3", "Безопасность/доступ"))]
    rollout = doc.section("6.1", "Порядок выката")
    rollback = doc.section("6.4", "План отката")
    presetup = doc.section("6.5", "Преднастройка до релиза")
    open_questions = doc.section("8", "Допущения и открытые вопросы", 2)

    services = len(table_rows(services_section))
    cards = [s for s in doc.sections if re.match(r"^INT-\d+", s.title) or s.heading.startswith("### INT-")]
    interaction_points = sum(interaction_weight(card) for card in cards)
    contract = contract_size(doc.block(interactions))
    errors = sum(1 for row in table_rows(error_catalog) if ERROR_CODE_ROW.search(row) and not UNCHANGED_ERROR.search(row))

    new_data = sum(1 for line in section_lines(data_storage) if "🟢" in line)
    ddl_migration = any("DDL" in line and not re.search(r"~~[^~]*DDL", line) for line in section_lines(presetup))
    data_points = min(3, bucket(new_data, (1, 3)) + int(ddl_migration))

    states = 0 if is_struck(states_section) else len(table_rows(states_section))
    zones = sum(1 for section in access_and_nfr if has_content(section))
    presetup_open = any(CHECKBOX.match(line) and not STRUCK_CHECKBOX.match(line) for line in section_lines(presetup))
    release = int(services >= 2 and has_content(rollout)) + int(has_content(rollback)) + int(presetup_open)
    facts = confirmed_facts(doc, open_questions)

    return [
        Feature("С1. Сервисы", services, bucket(services, (2, 3, 5))),
        Feature("С2. Взаимодействия", interaction_points, bucket(interaction_points, (1, 3, 6))),
        Feature("С3. Контракт", contract, bucket(contract, (3, 7, 13))),
        Feature("С4. Ошибки", errors, bucket(errors, (1, 3, 6))),
        Feature("С5. Данные", f"🟢{new_data}{'+DDL' if ddl_migration else ''}", data_points),
        Feature("С6. Состояния экрана", states, bucket(states, (1, 5, 9))),
        Feature("С7. Доступ и НФТ", zones, bucket(zones, (1, 2, 4))),
        Feature("С8. Выкат и откат", release, release),
        Feature("С9. Подтверждённые факты 🔵", facts, bucket(facts, (1, 4, 9))),
    ]


# ---------------------------------------------------------------- класс


def assess(text: str, kind: str) -> tuple[list[Feature], int, int, list[str]]:
    doc = Document(text)
    features = bt_features(doc) if kind == "bt" else spec_features(doc)
    points = sum(feature.points for feature in features)
    thresholds = BT_CLASS_THRESHOLDS if kind == "bt" else SPEC_CLASS_THRESHOLDS
    return features, points, 1 + bucket(points, thresholds), doc.notes


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("kind", choices=("bt", "spec"))
    parser.add_argument("file")
    args = parser.parse_args(argv)

    with open(args.file, encoding="utf-8") as handle:
        features, points, complexity_class, notes = assess(handle.read(), args.kind)
    print("/".join(Path(args.file).parts[-2:]))
    for feature in features:
        print(f"  {feature.label}: {feature.value} → {feature.points}")
    print(f"  баллы {points} → класс {complexity_class}" + "".join(f"; {note}" for note in notes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
