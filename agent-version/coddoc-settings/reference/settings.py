#!/usr/bin/env python3
"""coddoc-settings — дополнительные разделы БТ и спеки.

    python3 settings.py show
    python3 settings.py add    bt|spec [--parent <раздел>] --name <название> --what <что писать> --question <вопрос>
                                       [--question …] [[--parent …] --name … --what … --question …]… [--dry-run]
    python3 settings.py edit   bt|spec --name <название> [--new-name …] [--what …] [--question … …] [--dry-run]
    python3 settings.py remove bt|spec --name <название> [--dry-run]
    python3 settings.py check  [bt|spec|watch]
    python3 settings.py watch  --every 5m|10m|15m|20m|30m|1h|2h [--dry-run]

Файлы — <корень репозитория>/.coddoc-tmp/coddoc-settings/sections-bt.md и sections-spec.md (вне репозитория — от
текущей папки); в .coddoc-tmp/ кладётся .gitignore со строкой «*», если его нет. Порядок разделов сохраняется,
новый дописывается в конец. --dry-run печатает итоговый файл и ничего не пишет.

watch — как часто «/work-plan следи» обновляет план: файл work-plan.md там же, строки «слежка: <словами>» и
«расписание: <cron из пяти полей>»; интервал — только из списка, чтобы шаг был ровным. Файла нет — каждые 10 минут.

Раздел «##» — либо «что писать» и один или несколько «вопрос», либо подразделы «###» с тем же содержимым; то и другое
вместе нельзя, глубже «###» нельзя. --parent кладёт подраздел в конец раздела, раздела нет — заводит его в конце файла.
add берёт несколько узлов одной командой: --name открывает узел, следующие --what/--question — его, --parent действует
на следующие --name; --name без полей — только раздел, который ниже стоит в --parent. Команда целиком: ошибка в любом
узле — не записано ничего. --question в edit заменяет все вопросы раздела. Названия не повторяются во всём файле;
remove раздела убирает и его подразделы.

Название не совпадает с базовым разделом документа: заголовки берутся из шаблона соседнего скилла
(business-requirements-doc, technical-spec-doc) — без номеров, без пояснения в скобках, без учёта регистра.

Последняя строка — для агента (sections — число разделов «##»):
  coddoc-settings: ok doc=<bt|spec> sections=N path=<файл>
  coddoc-settings: dry-run doc=<bt|spec> sections=N path=<файл>
  coddoc-settings: ok watch=<интервал> path=<файл>
  coddoc-settings: dry-run watch=<интервал> path=<файл>
  coddoc-settings: show
  coddoc-settings: check ok
  coddoc-settings: error usage | no-skill | base-name | duplicate | empty | question | multiline | mixed | depth |
                          not-found | bad-file | no-write | every
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
WATCH_FILE = "work-plan.md"
WATCH_TITLE = "# Слежка за планом работы"
EVERY = {  # --every → (словами, расписание cron)
    "5m": ("каждые 5 минут", "*/5 * * * *"),
    "10m": ("каждые 10 минут", "*/10 * * * *"),
    "15m": ("каждые 15 минут", "*/15 * * * *"),
    "20m": ("каждые 20 минут", "*/20 * * * *"),
    "30m": ("каждые 30 минут", "*/30 * * * *"),
    "1h": ("каждый час", "0 * * * *"),
    "2h": ("каждые 2 часа", "0 */2 * * *"),
}
DEFAULT_EVERY = "10m"
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


class Node:
    """Раздел «##» или подраздел «###»: у раздела с подразделами своих «что писать» и вопросов нет."""

    def __init__(self, name, what=None, questions=(), line=0):
        self.name, self.what, self.questions, self.children, self.line = name, what, list(questions), [], line


def walk(sections):
    for node in sections:
        yield node
        yield from node.children


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
    """[Node] из файла; файла нет — пусто."""
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
        if line.startswith("## ") or line.startswith("### "):
            sub = line.startswith("### ")
            if sub and not sections:
                raise Fail("bad-file", f"{path.as_posix()}, строка {number}: подраздел «{line.strip()}» стоит до "
                                       f"первого раздела «##»")
            current = Node(line[4 if sub else 3:].strip(), line=number)
            (sections[-1].children if sub else sections).append(current)
        elif current is not None and line.startswith(WHAT) and current.what is None:
            current.what = line[len(WHAT):].strip()
        elif current is not None and line.startswith(ASK):
            current.questions.append(line[len(ASK):].strip())
        else:
            hint = " — заголовки только «##» и «###»" if line.lstrip().startswith("#") else " — не по форме"
            raise Fail("bad-file", f"{path.as_posix()}, строка {number}: «{line.strip()}»{hint}")
    for node in walk(sections):
        if not node.children and (node.what is None or not node.questions):
            raise Fail("bad-file", f"{path.as_posix()}, строка {node.line}: у раздела «{node.name}» нет поля "
                                   f"«{'что писать' if node.what is None else 'вопрос'}»")
    return sections


def validate(sections, doc):
    base, seen = base_names(doc), set()
    for node in walk(sections):
        if node.children and (node.what is not None or node.questions):
            raise Fail("mixed", f"у раздела «{node.name}» и подразделы, и свои «что писать» и вопрос — оставь одно")
        if not node.children and node.what is None and not node.questions:
            raise Fail("empty", f"у раздела «{node.name}» нет ни «что писать» с вопросом, ни подразделов")
        fields = [("название", node.name)]
        if not node.children:
            fields += [("что писать", node.what)] + [("вопрос", ask) for ask in node.questions or [""]]
        for label, value in fields:
            if not value or not value.strip():
                raise Fail("empty", f"поле «{label}» пустое")
            if "\n" in value or "\r" in value:
                raise Fail("multiline", f"поле «{label}» — одной строкой")
        if node.name.lstrip().startswith("#"):
            raise Fail("empty", f"название «{node.name}» без «#» в начале")
        if norm(node.name) in base:
            raise Fail("base-name", f"«{node.name}» — базовый раздел документа ({DOCS[doc][0]}); выбери другое название")
        if ident(node.name) in seen:
            raise Fail("duplicate", f"раздел «{node.name}» уже есть в файле")
        seen.add(ident(node.name))
        for ask in node.questions:
            if ask.count("?") != 1:
                raise Fail("question", f"в вопросе «{ask}» раздела «{node.name}» должен быть ровно один «?»")


def body(node):
    return [] if node.children else [f"{WHAT}{node.what.strip()}"] + [f"{ASK}{ask.strip()}" for ask in node.questions]


def render(sections, doc):
    out = [f"# {WRAPPER}: {DOCS[doc][0]}"]
    for node in sections:
        out += ["", f"## {node.name.strip()}"] + body(node)
        for child in node.children:
            out += [f"### {child.name.strip()}"] + body(child)
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
    """--ключ значение → dict; --question копится списком; --dry-run — флаг."""
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
        if key == "question":
            got.setdefault(key, []).append(args[i + 1])
        else:
            got[key] = args[i + 1]
        i += 2
    return got


def add_args(args):
    """add: узлы по порядку — [(раздел из --parent или None, Node)] и флаг --dry-run."""
    items, parent, node, dry, i = [], None, None, False, 0
    while i < len(args):
        arg = args[i]
        if arg == "--dry-run":
            dry, i = True, i + 1
            continue
        key = arg[2:] if arg.startswith("--") else None
        if key not in ("parent", "name", "what", "question") or i + 1 >= len(args):
            raise Fail("usage", f"непонятный аргумент «{arg}»; можно: --parent, --name, --what, --question, --dry-run")
        value, i = args[i + 1], i + 2
        if key == "parent":
            parent = value
        elif key == "name":
            node = Node(value)
            items.append((parent, node))
        elif node is None:
            raise Fail("usage", f"«--{key}» стоит до первого --name")
        elif key == "what":
            if node.what is not None:
                raise Fail("usage", f"у «{node.name}» два --what")
            node.what = value
        else:
            node.questions.append(value)
    if not items:
        raise Fail("usage", "add: нужны --name, --what и --question")
    parents = {ident(p) for p, _ in items if p is not None}
    for p, node in items:
        bare = node.what is None and not node.questions
        if (node.what is None or not node.questions) and not (bare and ident(node.name) in parents):
            raise Fail("usage", f"add: у «{node.name}» нужны --what и --question")
    return items, dry


def find(sections, name):
    """(список, в котором лежит раздел или подраздел, его номер в списке)."""
    key = ident(name)
    for nodes in [sections] + [node.children for node in sections]:
        for index, node in enumerate(nodes):
            if ident(node.name) == key:
                return nodes, index
    raise Fail("not-found", f"раздела «{name}» в файле нет")


def change(command, doc, args, folder):
    path = folder / DOCS[doc][2]
    sections = parse(path, doc)
    if command == "add":
        items, dry = add_args(args)
        opt = {"dry-run": dry}
        for name, node in items:
            if name is None:
                sections.append(node)
                continue
            key = ident(name)
            parent = next((top for top in sections if ident(top.name) == key), None)
            if parent is None and any(ident(child.name) == key for top in sections for child in top.children):
                raise Fail("depth", f"«{name}» — подраздел, а вложенность — один уровень")
            if parent is None:
                parent = Node(name)
                sections.append(parent)
            parent.children.append(node)
    elif command == "edit":
        opt = options(args, ("name", "new-name", "what", "question"))
        if "name" not in opt or not ({"new-name", "what", "question"} & opt.keys()):
            raise Fail("usage", "edit: нужны --name и хотя бы одно из --new-name, --what, --question")
        nodes, index = find(sections, opt["name"])
        node = nodes[index]
        node.name = opt.get("new-name", node.name)
        node.what = opt.get("what", node.what)
        node.questions = opt.get("question", node.questions)
    else:
        opt = options(args, ("name",))
        if "name" not in opt:
            raise Fail("usage", "remove: нужен --name")
        nodes, index = find(sections, opt["name"])
        del nodes[index]
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


def render_watch(every):
    words, cron = EVERY[every]
    return f"{WATCH_TITLE}\n\nслежка: {words}\nрасписание: {cron}\n"


def parse_watch(path):
    """Интервал из work-plan.md; файла нет — None. Строки — только заголовок, «слежка:» и «расписание:» одной пары."""
    if not path.exists():
        return None
    lines = [line.strip() for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    for every in EVERY:
        if lines == [line for line in render_watch(every).splitlines() if line]:
            return every
    raise Fail("bad-file", f"{path.as_posix()}: не по форме — нужны «{WATCH_TITLE}», «слежка: …» и «расписание: …» "
                           f"одного интервала; запиши заново: watch --every <интервал>")


def watch(args, folder):
    path = folder / WATCH_FILE
    opt = options(args, ("every",))
    every = opt.get("every", "").strip().lower()
    if every not in EVERY:
        raise Fail("every", f"интервал «{opt.get('every', '')}» — можно: {', '.join(EVERY)}")
    text = render_watch(every)
    if opt["dry-run"]:
        print(text.rstrip("\n"))
        print(f"coddoc-settings: dry-run watch={every} path={path.as_posix()}")
        return 0
    write(path, text)
    print(f"coddoc-settings: ok watch={every} path={path.as_posix()}")
    return 0


def summary(node):
    if node.children:
        return ""
    return f" — что писать: {node.what}" + "".join(f" · вопрос: {ask}" for ask in node.questions)


def show(folder):
    for doc, (label, _, file) in DOCS.items():
        path = folder / file
        sections = parse(path, doc)
        if not sections:
            print(f"{label}: не настроено ({path.as_posix()})")
            continue
        print(f"{label}: {path.as_posix()}")
        for node in sections:
            print(f"  ## {node.name}{summary(node)}")
            for child in node.children:
                print(f"    ### {child.name}{summary(child)}")
    path = folder / WATCH_FILE
    every = parse_watch(path)
    print(f"слежка за планом: {EVERY[every or DEFAULT_EVERY][0]}{'' if every else ' — по умолчанию'} ({path.as_posix()})")
    print("coddoc-settings: show")
    return 0


def check(folder, docs):
    for doc in docs:
        if doc == "watch":
            path = folder / WATCH_FILE
            parse_watch(path)
            print(f"слежка за планом: {'по форме' if path.exists() else 'файла нет'} ({path.as_posix()})")
            continue
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
        if command == "check" and len(args) <= 2 and (len(args) == 1 or args[1] in (*DOCS, "watch")):
            return check(folder, args[1:] or [*DOCS, "watch"])
        if command in ("add", "edit", "remove") and len(args) >= 2 and args[1] in DOCS:
            return change(command, args[1], args[2:], folder)
        if command == "watch":
            return watch(args[1:], folder)
        raise Fail("usage", "команды: show | add|edit|remove bt|spec --name … | watch --every … | check [bt|spec|watch]")
    except Fail as error:
        print(error)
        print(f"coddoc-settings: error {error.code}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
