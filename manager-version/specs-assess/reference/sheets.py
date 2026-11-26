#!/usr/bin/env python3
"""sheets — объём БТ или спеки в листах по 1800 знаков и число иллюстраций.

    python sheets.py bt|spec <файл> [--chars] [--debug]

Считается тело документа (без шапки) и его файлы задачи, без унаследованного от родителя эпика (document.py).
В знаки не идут: заголовки, подсказки шаблона «>», строки-заголовки таблиц и разделители, разметка Markdown
вместе с адресами ссылок, картинки, метки происхождения 🟢🔵🟡❓⚠️, голые заглушки, схемы PlantUML и Mermaid,
повтор уже посчитанного блока кода. «Не применимо» с причиной и зачёркнутый текст считаются: знаки `~~` уходят,
текст остаётся. Текст режется на предложения по точке и точке с запятой.

Голая заглушка — предложение, которое начинается с «не применимо» (в том числе после подписи «Откат DDL: …»)
или содержит TBD, и в котором после удаления этих слов, «нет», прочерков, знаков препинания и цифр остаётся три
слова или меньше; а также пустой прочерк и одиночное «нет».
"""

from __future__ import annotations

import argparse
import math
import os
import re
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # соседние модули находятся и при `python -I`
import document  # noqa: E402

CHARS_PER_SHEET = 1800

MARKS = re.compile("[🟢🔵🟡❓⚠️]")
EMPHASIS = re.compile(r"\*\*|`|\*")
LIST_MARKER = re.compile(r"^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s*)?")
IMAGE_LINK = re.compile(r"!\[[^\]]*\]\([^)]*\)")
TEXT_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
PROMPT = re.compile(r"^\s*>")
TABLE_CELL_BORDER = re.compile(r"(?<!\\)\|")  # «\|» внутри ячейки — символ, а не граница

DIAGRAM_LANGUAGES = {"plantuml", "puml", "mermaid"}

SENTENCE_END = re.compile(r"(?<=[.;])\s+")
STUB_FLAG = re.compile(r"^не применим|^[^:]{1,40}:\s*не применим|TBD", re.IGNORECASE)
STUB_WORDS = re.compile(r"\bTBD\b|\bне применим[а-я]*|\bнет\b|[:.,;()§0-9—–]|(?<!\w)-|-(?!\w)",
                        re.IGNORECASE)  # слова целиком: «нет» в «кабинета» и дефис в «фронт-энд» — части слов
STUB_MAX_WORDS = 3


@dataclass
class Volume:
    chars: int
    illustrations: int

    @property
    def sheets(self) -> float:
        """Листы с одним знаком после запятой, половина округляется вверх."""
        return math.floor(self.chars * 10 / CHARS_PER_SHEET + 0.5) / 10


def clean(text: str) -> str:
    """Строка или ячейка таблицы без разметки, картинок, меток и маркера списка."""
    text = TEXT_LINK.sub(r"\1", IMAGE_LINK.sub("", text))
    text = text.replace("~~", "")
    text = EMPHASIS.sub("", text)
    text = MARKS.sub("", text)
    text = LIST_MARKER.sub("", text)
    text = text.replace("|", " ")
    return re.sub(r"\s+", " ", text).strip()


def is_diagram(info: str) -> bool:
    return info.strip().lower().split(" ")[0] in DIAGRAM_LANGUAGES


def text_units(lines: list[str], counted_code: set[str]) -> list[str]:
    """Строки и ячейки таблиц, уже очищенные; блок кода — одной единицей, повтор блока не считается."""
    units: list[str] = []
    fence_info, fence_lines = None, []
    expect_table_header = True
    for line in lines:
        if document.FENCE.match(line):
            if fence_info is None:
                fence_info, fence_lines = line.strip()[3:], []
            else:
                code = re.sub(r"\s+", " ", " ".join(fence_lines)).strip()
                if code and code not in counted_code and not is_diagram(fence_info):
                    counted_code.add(code)
                    units.append(code)
                fence_info = None
            continue
        if fence_info is not None:
            fence_lines.append(line)
            continue
        if document.heading_level(line) or PROMPT.match(line):
            expect_table_header = True
            continue
        if document.TABLE_SEPARATOR.match(line.strip()):
            continue
        if line.lstrip().startswith("|"):
            if expect_table_header:
                expect_table_header = False
                continue
            units += [clean(cell.replace("\\|", "|")) for cell in TABLE_CELL_BORDER.split(line.strip().strip("|"))]
            continue
        expect_table_header = True
        units.append(clean(line))
    return units


def is_stub(fragment: str) -> bool:
    if not fragment or fragment == "—" or re.match(r"^нет\.?$", fragment, re.IGNORECASE):
        return True
    return bool(STUB_FLAG.search(fragment)) and len(STUB_WORDS.sub(" ", fragment).split()) <= STUB_MAX_WORDS


def measure(path: str, kind: str, debug: bool = False) -> Volume:
    lines = document.own_lines(path, kind, document.read_lines(path))
    counted_code: set[str] = set()
    units = text_units(lines[document.body_start(lines):], counted_code)
    for file in document.task_files(path, lines):
        task_lines = document.read_lines(file)
        units += text_units(task_lines[document.frontmatter_end(task_lines):], counted_code)
    chars = 0
    for unit in units:
        for fragment in SENTENCE_END.split(unit):
            fragment = fragment.strip()
            if is_stub(fragment):
                if debug and fragment:
                    print("−", fragment[:120], file=sys.stderr)
                continue
            chars += len(fragment) + 1
    return Volume(chars, len(document.illustrations(path, lines)))


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("kind", choices=("bt", "spec"))
    parser.add_argument("file")
    parser.add_argument("--chars", action="store_true", help="показать число знаков")
    parser.add_argument("--debug", action="store_true", help="выброшенные заглушки — в stderr")
    args = parser.parse_args(argv)
    volume = measure(args.file, args.kind, args.debug)
    chars = f"; знаков {volume.chars}" if args.chars else ""
    print(f"{volume.sheets:.1f}".replace(".", ",") + f" листа{chars}; иллюстраций {volume.illustrations}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
