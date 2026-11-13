"""document — документ задачи так, как его видит замер: шапка и тело, файлы задачи, наследство, иллюстрации.

Тело — всё после первого заголовка второго уровня («## »), что выше — шапка. Заголовка «## » нет — телом
считается весь текст после YAML-блока.

Файлы задачи — Markdown-файлы в папке документа и глубже, на которые документ ссылается. Документы конвейера
(БТ, спека, баг-репорт, запрос на правку, индекс разбиения эпика, файлы этапов) — отдельные документы, файлами
задачи они не бывают. Файл задачи — часть документа и считается целиком; ссылки из него на другие Markdown-файлы
не раскрываются.

Наследство. Ребёнок эпика не получает в счёт то, что взял у родителя:
- БТ — строки, дословно совпавшие с БТ эпика (файл из поля `source:` YAML-шапки): разбиение эпика копирует ребёнку
  разделы, требования и сценарии, и эта работа засчитана эпику;
- спека — блок под заголовком с пометкой `depends-on #0`: контракт, спроектированный в спеке узла-фундамента.
Заголовки, ограждения кода, разделители и первые строки таблиц остаются всегда: без них ломаются разделы, блоки
кода и таблицы.

Иллюстрации — уникальные файлы картинок и схем в папке документа и глубже, на которые ссылаются документ или его
файлы задачи ссылкой Markdown. Внешние ссылки не считаются.
"""

from __future__ import annotations

import os
import re
from urllib.parse import unquote

PIPELINE_DOCUMENTS = frozenset({"business_requirements.md", "technical_specification.md", "bug_report.md",
                                "change_request.md", "decomposition.md"})
STAGES_FOLDER = "stages"  # файлы этапов пишет разбиение спеки на этапы
INHERITED_MARK = "depends-on #0"
TEMPLATE_VERSION_LABEL = "Версия скилла"

HEADING = re.compile(r"^(#{1,6})\s+\S")
FENCE = re.compile(r"^\s*(```|~~~)")
TABLE_SEPARATOR = re.compile(r"^\|\s*:?-")
LINK = re.compile(r"!?\[[^\]]*\]\(([^)]*)\)")
URL_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:(?!\\)", re.IGNORECASE)
IMAGE_FILE = re.compile(r"\.(png|jpe?g|gif|webp|svg|drawio|excalidraw)$", re.IGNORECASE)
MARKDOWN_FILE = re.compile(r"\.md$", re.IGNORECASE)


def read_lines(path: str) -> list[str]:
    with open(path, encoding="utf-8-sig") as handle:
        return handle.read().replace("\r", "").split("\n")


def heading_level(line: str) -> int:
    """Уровень заголовка Markdown или 0, если строка не заголовок."""
    match = HEADING.match(line)
    return len(match.group(1)) if match else 0


def outside_code(lines: list[str]) -> list[bool]:
    """Для каждой строки: стоит ли она вне блока кода (строки ограждения — не вне)."""
    flags, in_code = [], False
    for line in lines:
        if FENCE.match(line):
            in_code = not in_code
            flags.append(False)
        else:
            flags.append(not in_code)
    return flags


# ---------------------------------------------------------------- шапка


def frontmatter_end(lines: list[str]) -> int:
    """Номер первой строки после YAML-блока в начале файла; блока нет — 0."""
    if lines and lines[0].strip() == "---":
        for number in range(1, len(lines)):
            if lines[number].strip() == "---":
                return number + 1
    return 0


def frontmatter_field(lines: list[str], name: str) -> str | None:
    for line in lines[1:frontmatter_end(lines)]:
        match = re.match(rf"^{re.escape(name)}\s*:\s*(.+)$", line.strip())
        if match:
            return match.group(1).strip().strip("\"'")
    return None


def body_start(lines: list[str]) -> int:
    """Номер первой строки тела: первый заголовок «## » вне блока кода."""
    code = outside_code(lines)
    return next((n for n, line in enumerate(lines) if code[n] and line.startswith("## ")), frontmatter_end(lines))


def header_field(lines: list[str], label: str) -> str | None:
    """Значение поля шапки вида «> **Метка:** значение»."""
    for line in lines[:body_start(lines)]:
        plain = line.strip().lstrip(">").strip().replace("**", "")
        if plain.lower().startswith(label.lower() + ":"):
            return plain[len(label) + 1:].strip() or None
    return None


def template_version(lines: list[str]) -> str | None:
    """Версия шаблона: последняя запись поля «Версия скилла» (доработка дописывает версии через запятую)."""
    value = header_field(lines, TEMPLATE_VERSION_LABEL)
    return value.split(",")[-1].strip() if value else None


# ---------------------------------------------------------------- ссылки и файлы задачи


def link_targets(lines: list[str]) -> list[str]:
    """Адреса ссылок Markdown вне блоков кода."""
    return [target for line, outside in zip(lines, outside_code(lines)) if outside for target in LINK.findall(line)]


def resolve(target: str, base: str, root: str) -> str | None:
    """Файл, на который ведёт ссылка: путь от папки ссылающегося файла или от корня репозитория, только внутри root."""
    target = target.strip()
    target = re.sub(r"""\s+["'].*$""", "", target)  # подпись ссылки: (схема.png "Процесс")
    target = re.sub(r"^<|>$", "", target)  # адрес с пробелами: (<схема процесса.png>)
    target = unquote(re.sub(r"[#?].*$", "", target))  # без якоря и параметров, %20 → пробел
    if not target or URL_SCHEME.match(target):
        return None
    target = target.lstrip("/")  # «/coddoc/<KEY>/…» — путь от корня репозитория, а не от корня диска
    root = os.path.normcase(os.path.abspath(root))
    folder = os.path.abspath(base)
    while True:  # относительный путь, а в документах конвейера ещё и путь от корня: «coddoc/<KEY>/…»
        candidate = os.path.abspath(os.path.join(folder, target))
        inside = os.path.normcase(candidate) == root or os.path.normcase(candidate).startswith(root + os.sep)
        if inside and os.path.isfile(candidate):
            return candidate
        parent = os.path.dirname(folder)
        if parent == folder:
            return None
        folder = parent


def is_pipeline_document(path: str, root: str) -> bool:
    relative = os.path.relpath(path, root).split(os.sep)
    return os.path.basename(path).lower() in PIPELINE_DOCUMENTS or STAGES_FOLDER in relative[:-1]


def task_files(path: str, lines: list[str]) -> list[str]:
    """Файлы задачи документа: Markdown-файлы в его папке и глубже по ссылкам из него, кроме документов конвейера."""
    root = os.path.dirname(os.path.abspath(path))
    found = []
    for target in link_targets(lines):
        resolved = resolve(target, root, root)
        if (resolved and MARKDOWN_FILE.search(resolved) and not is_pipeline_document(resolved, root)
                and os.path.normcase(resolved) != os.path.normcase(os.path.abspath(path)) and resolved not in found):
            found.append(resolved)
    return found


def illustrations(path: str, lines: list[str]) -> set[str]:
    """Файлы картинок и схем по ссылкам из документа и его файлов задачи — внутри папки документа."""
    root = os.path.dirname(os.path.abspath(path))
    sources = [(root, lines)] + [(os.path.dirname(file), read_lines(file)) for file in task_files(path, lines)]
    images = set()
    for base, source_lines in sources:
        for target in link_targets(source_lines):
            resolved = resolve(target, base, root)
            if resolved and IMAGE_FILE.search(resolved):
                images.add(os.path.normcase(resolved))
    return images


# ---------------------------------------------------------------- наследство


def parent_document(path: str, lines: list[str]) -> str | None:
    """БТ эпика, из которого разбиение скопировало БТ ребёнка (поле `source:`), или None."""
    source = frontmatter_field(lines, "source")
    if not source:
        return None
    folder = os.path.dirname(os.path.abspath(path))
    while True:  # source записан от корня репозитория: «coddoc/<эпик>/business_requirements.md»
        candidate = os.path.normpath(os.path.join(folder, source))
        if os.path.isfile(candidate) and os.path.normcase(candidate) != os.path.normcase(os.path.abspath(path)):
            return candidate
        parent = os.path.dirname(folder)
        if parent == folder:
            return None
        folder = parent


def without_copied_lines(lines: list[str], copied: set[str]) -> list[str]:
    kept, previous = [], ""
    for line in lines:
        stripped = line.strip()
        structural = (heading_level(stripped) > 0 or bool(FENCE.match(stripped)) or bool(TABLE_SEPARATOR.match(stripped))
                      or (stripped.startswith("|") and not previous.startswith("|")))
        if structural or stripped not in copied:
            kept.append(line)
        previous = stripped
    return kept


def without_inherited_blocks(lines: list[str]) -> list[str]:
    """Спека без блоков под заголовками с пометкой наследства от узла-фундамента (вместе с вложенными разделами)."""
    code = outside_code(lines)
    heads = [(n, heading_level(line)) for n, line in enumerate(lines) if code[n] and heading_level(line)]
    drop = set()
    for index, (start, level) in enumerate(heads):
        if INHERITED_MARK in lines[start]:
            end = next((n for n, lvl in heads[index + 1:] if lvl <= level), len(lines))
            drop.update(range(start, end))
    return [line for n, line in enumerate(lines) if n not in drop]


def own_lines(path: str, kind: str, lines: list[str]) -> list[str]:
    """Строки документа без унаследованного от родителя эпика."""
    if kind == "bt":
        parent = parent_document(path, lines)
        if not parent:
            return lines
        return without_copied_lines(lines, {line.strip() for line in read_lines(parent) if line.strip()})
    return without_inherited_blocks(lines)
