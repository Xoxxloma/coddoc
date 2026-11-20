#!/usr/bin/env python3
"""coddoc-settings — дополнительные разделы БТ и спеки.

    python3 settings.py show
    python3 settings.py add    bt|spec --name <название> --what <что писать> --question <вопрос> [--dry-run]
    python3 settings.py edit   bt|spec --name <название> [--new-name …] [--what …] [--question …] [--dry-run]
    python3 settings.py remove bt|spec --name <название> [--dry-run]
    python3 settings.py check  [bt|spec]

Файлы — <корень репозитория>/.coddoc-tmp/coddoc-settings/sections-bt.md и sections-spec.md (вне репозитория — от
текущей папки); в .coddoc-tmp/ кладётся .gitignore со строкой «*», если его нет. Порядок разделов сохраняется,
новый дописывается в конец. --dry-run печатает итоговый файл и ничего не пишет.

Название не совпадает с базовым разделом документа: заголовки берутся из шаблона соседнего скилла
(business-requirements-doc, technical-spec-doc) — без номеров, без пояснения в скобках, без учёта регистра.

Последняя строка — для агента:
  coddoc-settings: ok doc=<bt|spec> sections=N path=<файл>
  coddoc-settings: dry-run doc=<bt|spec> sections=N path=<файл>
  coddoc-settings: show
  coddoc-settings: check ok
  coddoc-settings: error usage | no-skill | base-name | duplicate | empty | question | multiline | not-found |
                          bad-file | no-write
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

DOCS = {
    "bt": ("БТ", "business-requirements-doc", "sections-bt.md"),
    "spec": ("спека", "technical-spec-doc", "sections-spec.md"),
}
WRAPPER = "Дополнительные разделы"
WHAT = "- что писать: "
ASK = "- вопрос: "
HEADING_RE = re.compile(r"^#{2,4}\s+(.+?)\s*$")
NUMBER_RE = re.compile(r"^\d+(?:\.\d+)*\.?\s+")
SKILLS = Path(__file__).resolve().parent.parent.parent


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def ident(name):
    """Свой раздел — повтор и поиск: без регистра, ё = е, пробелы схлопнуты."""
    return " ".join(name.casefold().replace("ё", "е").split())


def norm(name):
    """Сверка с базовыми разделами: как ident, и без пояснения в скобках на конце."""
    return ident(re.sub(r"\s*\([^)]*\)\s*$", "", name.strip()))


def base_key(heading):
    """Заголовок шаблона → название: без ~~, номера, пояснений в скобках и хвоста после « — »; INT-карточки — None."""
    text = NUMBER_RE.sub("", heading.replace("~~", "").strip())
    if not text or text.startswith("[") or re.match(r"INT-\d", text):
        return None
    text = re.sub(r"\([^)]*\)", "", text).split(" — ")[0]
    return norm(text) or None


def find_root():
    try:
        done = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        return Path.cwd()
    out = done.stdout.decode("utf-8", "surrogateescape").strip()
    return Path(os.path.realpath(out)) if done.returncode == 0 and out else Path.cwd()


def base_names(doc):
    """Заголовки с номером из блока шаблона после «## Output template» в SKILL.md соседнего скилла."""
    skill = SKILLS / DOCS[doc][1] / "SKILL.md"
    if not skill.is_file():
        raise Fail("no-skill", f"скилл установлен не полностью: нет {skill.as_posix()}")
    lines = skill.read_text(encoding="utf-8").splitlines()
    start = next((i for i, line in enumerate(lines) if line.startswith("## Output template")), None)
    if start is None:
        raise Fail("no-skill", f"в {skill.as_posix()} нет шаблона «## Output template»")
    names, fence = set(), None
    for line in lines[start + 1:]:
        stripped = line.strip()
        if fence is None:
            if stripped.startswith("```"):
                fence = len(stripped) - len(stripped.lstrip("`"))
            elif line.startswith("## "):
                break
            continue
        if stripped == "`" * fence:
            break
        match = HEADING_RE.match(line)
        key = base_key(match.group(1)) if match else None
        if key:
            names.add(key)
    if not names:
        raise Fail("no-skill", f"в шаблоне {skill.as_posix()} не нашлось заголовков")
    names.add(norm(WRAPPER))
    return names


def parse(path, doc):
    """[(название, что писать, вопрос)] из файла; файла нет — пусто."""
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    title = f"# {WRAPPER}: {DOCS[doc][0]}"
    sections, i = [], 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != title:
        raise Fail("bad-file", f"{path.as_posix()}: первая строка должна быть «{title}»")
    i += 1
    current = None
    for number, line in enumerate(lines[i:], start=i + 1):
        if not line.strip():
            continue
        if line.startswith("## "):
            current = [line[3:].strip(), None, None, number]
            sections.append(current)
        elif current is not None and line.startswith(WHAT) and current[1] is None:
            current[1] = line[len(WHAT):].strip()
        elif current is not None and line.startswith(ASK) and current[2] is None:
            current[2] = line[len(ASK):].strip()
        else:
            raise Fail("bad-file", f"{path.as_posix()}, строка {number}: «{line.strip()}» — не по форме")
    for name, what, ask, number in sections:
        if what is None or ask is None:
            raise Fail("bad-file", f"{path.as_posix()}, строка {number}: у раздела «{name}» нет поля "
                                   f"«{'что писать' if what is None else 'вопрос'}»")
    return [(name, what, ask) for name, what, ask, _ in sections]


def validate(sections, doc):
    base, seen = base_names(doc), set()
    for name, what, ask in sections:
        for label, value in (("название", name), ("что писать", what), ("вопрос", ask)):
            if not value or not value.strip():
                raise Fail("empty", f"поле «{label}» пустое")
            if "\n" in value or "\r" in value:
                raise Fail("multiline", f"поле «{label}» — одной строкой")
        if name.lstrip().startswith("#"):
            raise Fail("empty", f"название «{name}» без «#» в начале")
        if norm(name) in base:
            raise Fail("base-name", f"«{name}» — базовый раздел документа ({DOCS[doc][0]}); выбери другое название")
        if ident(name) in seen:
            raise Fail("duplicate", f"раздел «{name}» уже есть в файле")
        seen.add(ident(name))
        if ask.count("?") != 1:
            raise Fail("question", f"в вопросе раздела «{name}» должен быть ровно один «?»")


def render(sections, doc):
    out = [f"# {WRAPPER}: {DOCS[doc][0]}"]
    for name, what, ask in sections:
        out += ["", f"## {name.strip()}", f"{WHAT}{what.strip()}", f"{ASK}{ask.strip()}"]
    return "\n".join(out) + "\n"


def write(path, text):
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        ignore = path.parent.parent / ".gitignore"
        if not ignore.exists():
            ignore.write_bytes(b"*\n")
        path.write_bytes(text.encode("utf-8"))
    except OSError as error:
        raise Fail("no-write", f"не удалось записать {path.as_posix()}: {error.strerror}") from None


def options(args, allowed):
    """--ключ значение → dict; --dry-run — флаг."""
    got, i = {"dry-run": False}, 0
    while i < len(args):
        arg = args[i]
        if arg == "--dry-run":
            got["dry-run"] = True
            i += 1
            continue
        key = arg[2:] if arg.startswith("--") else None
        if key not in allowed or i + 1 >= len(args):
            raise Fail("usage", f"непонятный аргумент «{arg}»; можно: {', '.join('--' + a for a in allowed)}, --dry-run")
        got[key] = args[i + 1]
        i += 2
    return got


def find(sections, name):
    key = ident(name)
    for index, section in enumerate(sections):
        if ident(section[0]) == key:
            return index
    raise Fail("not-found", f"раздела «{name}» в файле нет")


def change(command, doc, args, folder):
    path = folder / DOCS[doc][2]
    sections = parse(path, doc)
    if command == "add":
        opt = options(args, ("name", "what", "question"))
        if not all(k in opt for k in ("name", "what", "question")):
            raise Fail("usage", "add: нужны --name, --what и --question")
        sections.append((opt["name"], opt["what"], opt["question"]))
    elif command == "edit":
        opt = options(args, ("name", "new-name", "what", "question"))
        if "name" not in opt or not ({"new-name", "what", "question"} & opt.keys()):
            raise Fail("usage", "edit: нужны --name и хотя бы одно из --new-name, --what, --question")
        index = find(sections, opt["name"])
        name, what, ask = sections[index]
        sections[index] = (opt.get("new-name", name), opt.get("what", what), opt.get("question", ask))
    else:
        opt = options(args, ("name",))
        if "name" not in opt:
            raise Fail("usage", "remove: нужен --name")
        del sections[find(sections, opt["name"])]
    validate(sections, doc)
    text = render(sections, doc) if sections else None
    if opt["dry-run"]:
        print(text.rstrip("\n") if text else f"(разделов не останется — файл {path.as_posix()} будет удалён)")
        print(f"coddoc-settings: dry-run doc={doc} sections={len(sections)} path={path.as_posix()}")
        return 0
    if text:
        write(path, text)
    elif path.exists():
        try:
            path.unlink()
        except OSError as error:
            raise Fail("no-write", f"не удалось удалить {path.as_posix()}: {error.strerror}") from None
    print(f"coddoc-settings: ok doc={doc} sections={len(sections)} path={path.as_posix()}")
    return 0


def show(folder):
    for doc, (label, _, file) in DOCS.items():
        path = folder / file
        sections = parse(path, doc)
        if not sections:
            print(f"{label}: не настроено ({path.as_posix()})")
            continue
        print(f"{label}: {path.as_posix()}")
        for name, what, ask in sections:
            print(f"  ## {name} — что писать: {what} · вопрос: {ask}")
    print("coddoc-settings: show")
    return 0


def check(folder, docs):
    for doc in docs:
        path = folder / DOCS[doc][2]
        validate(parse(path, doc), doc)
        print(f"{DOCS[doc][0]}: {'по форме' if path.exists() else 'файла нет'} ({path.as_posix()})")
    print("coddoc-settings: check ok")
    return 0


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        folder = find_root() / ".coddoc-tmp" / "coddoc-settings"
        command = args[0] if args else None
        if command == "show" and len(args) == 1:
            return show(folder)
        if command == "check" and len(args) <= 2 and (len(args) == 1 or args[1] in DOCS):
            return check(folder, args[1:] or list(DOCS))
        if command in ("add", "edit", "remove") and len(args) >= 2 and args[1] in DOCS:
            return change(command, args[1], args[2:], folder)
        raise Fail("usage", "команды: show | add|edit|remove bt|spec --name … | check [bt|spec]")
    except Fail as error:
        print(error)
        print(f"coddoc-settings: error {error.code}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
