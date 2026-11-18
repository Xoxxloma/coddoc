#!/usr/bin/env python3
"""peek — документы задачи из любой ветки, без переключения.

    python3 peek.py <КЛЮЧ>
    python3 peek.py <слово> [<слово> …]
    python3 peek.py --list [--base <ветка>]

Ключ: находит coddoc/**/<КЛЮЧ>/ во всех локальных ветках и в origin, берёт самую свежую версию — по дате последнего
коммита ветки, тронувшего папку ключа, — и выгружает её в <корень репозитория>/.coddoc-tmp/peek/<КЛЮЧ>/: старая
выгрузка ключа удаляется, в peek/ остаются KEEP последних ключей. Печатает ветку, автора, дату, остальные ветки с
ключом и файлы со статусом из шапки.

Слова: строки файлов coddoc/ во всех ветках, где есть все слова (без учёта регистра): «ключ · ветка · автор ·
файл:строка · строка». Одинаковая пара «файл, строка» из разных веток — один раз, с самой свежей веткой.

--list: документы в работе с открытыми вопросами. Основная ветка — названная в --base (origin/<ветка>, иначе
локальная), без --base — origin/HEAD, иначе origin/main, origin/master, локальные main, master.
Смотрит файлы coddoc/ и notes/, которые невлитые локальные ветки поменяли от основной; ноуты notes/*/notebook.md
основной ветки; изменённые и новые файлы рабочей копии (у текущей ветки они заменяют вершину). Один путь в
нескольких местах — самая свежая версия. Документ coddoc/ — с «Статус готовности: Требуются уточнения (N)»; ноут —
N строк «- [открыто]» без «‖». N = 0 и файлы без статуса не показываются. Найденное копирует в
.coddoc-tmp/peek/list/<путь в репозитории> (папка пересоздаётся).

Перед поиском — fetch origin без вопросов пароля. Только читает объекты git и пишет в .coddoc-tmp/peek/: текущая
ветка, индекс, рабочая копия и локальные ветки не меняются; fetch обновляет только origin/*.

Последняя строка — для агента:
  peek: ok key=<КЛЮЧ> files=N path=<папка выгрузки>
  peek: found N
  peek: list N path=<папка копий>
  peek: error usage | no-git | not-repo | no-coddoc | not-found | no-write | no-branch
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

KEEP = 10  # сколько последних выгрузок держать в .coddoc-tmp/peek/
FETCH_TIMEOUT = 60  # секунд на fetch
OTHERS_SHOWN = 8  # сколько остальных веток назвать в строке «ещё в»
FILES_SHOWN = 40  # сколько файлов выгрузки перечислить
LINES_SHOWN = 30  # сколько найденных строк показать
LINE_WIDTH = 200  # длина найденной строки в выводе
HEAD_LINES = 40  # в скольких первых строках документа искать шапку
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*-\d+$")
STATUS_RE = re.compile(r"\*\*Статус готовности:\*\*\s*(.+)")
EDITION_RE = re.compile(r"\*\*Редакция:\*\*\s*(.+)")
NEED_RE = re.compile(r"Требуются уточнения\s*\((\d+)\)")
NOTEBOOK_RE = re.compile(r"^notes/[^/]+/notebook\.md$")
OPEN_RE = re.compile(r"^- \[открыто\]")
FRONT_RE = re.compile(r"^(ключ|тема):\s*(.*)$")
KINDS = {0: "текущая", 1: "локальная", 2: "origin"}


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def git(top, *args, data=None, timeout=None, env=None):
    """git с байтовым выводом; stdin закрыт, чтобы git ничего не спрашивал."""
    stdin = {"input": data} if data is not None else {"stdin": subprocess.DEVNULL}
    try:
        return subprocess.run(["git", "--literal-pathspecs", *args], cwd=top, capture_output=True, timeout=timeout,
                              env=env, **stdin)
    except FileNotFoundError:
        raise Fail("no-git", "git не найден — нужен установленный git") from None


def text(done):
    return done.stdout.decode("utf-8", "surrogateescape")


def find_top():
    done = git(None, "rev-parse", "--show-toplevel")
    if done.returncode != 0 or not done.stdout.strip():
        raise Fail("not-repo", "здесь нет репозитория git — запусти из папки репозитория")
    return Path(os.path.realpath(text(done).strip()))


def fetch(top):
    """Обновляет origin/*. Не вышло — строка с причиной; поиск идёт по тому, что есть."""
    if git(top, "remote", "get-url", "origin").returncode != 0:
        return "origin нет — смотрю только локальные ветки"
    # Агент не ответит ни на пароль https, ни на вопрос ssh про новый хост; свою настройку ssh не трогаем.
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    if not (env.get("GIT_SSH_COMMAND") or env.get("GIT_SSH")) and git(top, "config", "--get", "core.sshCommand").returncode:
        env["GIT_SSH_COMMAND"] = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
    try:
        done = git(top, "fetch", "--quiet", "origin", timeout=FETCH_TIMEOUT, env=env)
    except subprocess.TimeoutExpired:
        return f"origin не обновлён: нет ответа за {FETCH_TIMEOUT} с — смотрю то, что уже есть"
    if done.returncode:
        lines = done.stderr.decode("utf-8", "replace").strip().splitlines()
        return f"origin не обновлён ({lines[-1] if lines else 'git fetch не прошёл'}) — смотрю то, что уже есть"
    return ""


def branches(top):
    """→ [(имя для показа, вершина, вид, время вершины)]; вид 0 — текущая ветка, 1 — локальная, 2 — origin."""
    current = text(git(top, "symbolic-ref", "-q", "HEAD")).strip()
    done = git(top, "for-each-ref", "--format=%(refname)%00%(symref)%00%(objectname)%00%(committerdate:unix)",
               "refs/heads", "refs/remotes/origin")
    found = []
    for line in text(done).splitlines():
        ref, symref, tip, stamp = line.split("\0")
        if symref:
            continue  # origin/HEAD — ссылка на другую ветку
        if ref.startswith("refs/heads/"):
            found.append((ref[len("refs/heads/"):], tip, 0 if ref == current else 1, int(stamp or 0)))
        else:
            found.append((ref[len("refs/remotes/"):], tip, 2, int(stamp or 0)))
    return found


def key_dirs(top, tip, key):
    """→ ([(путь папки ключа, хеш дерева)], есть ли в ветке подпапки coddoc/)."""
    entries = [entry for entry in text(git(top, "ls-tree", "-r", "-d", "-z", tip, "--", "coddoc")).split("\0") if entry]
    hits = []
    for entry in entries:
        meta, path = entry.split("\t", 1)
        if path != "coddoc" and path.rsplit("/", 1)[-1].casefold() == key.casefold():
            hits.append((path, meta.split()[2]))
    return hits, len(entries) > 1


def last_commit(top, tip, path):
    """→ (время, автор, дата) последнего коммита ветки, тронувшего папку."""
    done = git(top, "log", "-1", "--format=%ct%x00%an%x00%cd", "--date=format-local:%Y-%m-%d %H:%M", tip, "--", path)
    stamp, author, date = text(done).strip().split("\0")
    return int(stamp), author, date


def read_blobs(top, shas):
    """→ {хеш: байты} одним git cat-file --batch."""
    unique = list(dict.fromkeys(shas))
    if not unique:
        return {}
    data = git(top, "cat-file", "--batch", data=("\n".join(unique) + "\n").encode()).stdout
    blobs, pos = {}, 0
    for sha in unique:
        end = data.index(b"\n", pos)
        size = int(data[pos:end].split()[2])
        blobs[sha] = data[end + 1:end + 1 + size]
        pos = end + 1 + size + 1
    return blobs


def export(top, tip, path, dest):
    """Папка ключа из ветки → dest (старая выгрузка удаляется). → {путь от папки ключа: байты}."""
    files = []
    for entry in text(git(top, "ls-tree", "-r", "-z", tip, "--", path + "/")).split("\0"):
        if not entry:
            continue
        meta, name = entry.split("\t", 1)
        mode, kind, sha = meta.split()
        if kind == "blob" and mode != "120000":  # ссылки и подмодули не выгружаем
            files.append((name[len(path) + 1:], sha))
    blobs = read_blobs(top, [sha for _, sha in files])
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for rel, sha in files:
        target = dest.joinpath(*rel.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(blobs[sha])
    return {rel: blobs[sha] for rel, sha in sorted(files)}


def header(blob):
    """Статус и редакция из шапки документа; шапки нет — «без шапки»."""
    status = edition = ""
    for line in blob.decode("utf-8", "replace").splitlines()[:HEAD_LINES]:
        status = status or next(iter(STATUS_RE.findall(line)), "").strip()
        edition = edition or next(iter(EDITION_RE.findall(line)), "").strip()
    if not status and not edition:
        return "без шапки"
    return " · ".join(part for part in (status or "статус не указан", edition and f"редакция {edition}") if part)


def make_folder(folder):
    """.coddoc-tmp/peek/ и .coddoc-tmp/.gitignore со строкой «*»."""
    folder.mkdir(parents=True, exist_ok=True)
    ignore = folder.parent / ".gitignore"
    if not ignore.exists():
        ignore.write_text("*\n", encoding="utf-8")


def prune(folder, keep):
    """В папке остаются keep самых свежих выгрузок; не удалилось — не беда."""
    dirs = sorted((d for d in folder.iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime, reverse=True)
    for old in dirs[keep:]:
        shutil.rmtree(old, ignore_errors=True)


def others_line(best, cands):
    marks = []
    for c in sorted((c for c in cands if c is not best), key=lambda c: (-c["stamp"], c["kind"], c["name"])):
        mark = "то же" if c["tree"] == best["tree"] else "старее" if c["stamp"] < best["stamp"] else "другое"
        where = "" if c["path"] == best["path"] else f", {c['path']}"
        marks.append(f"{c['name']} ({mark}{where})")
    if not marks:
        return ""
    more = f" и ещё {len(marks) - OTHERS_SHOWN}" if len(marks) > OTHERS_SHOWN else ""
    return "ещё в: " + ", ".join(marks[:OTHERS_SHOWN]) + more


def peek_key(key):
    top = find_top()
    note = fetch(top)
    if note:
        print(note)
    refs = branches(top)
    cands, any_coddoc, trees, commits = [], False, {}, {}
    for name, tip, kind, _ in refs:
        if tip not in trees:
            trees[tip] = key_dirs(top, tip, key)
        hits, has_coddoc = trees[tip]
        any_coddoc = any_coddoc or has_coddoc
        for path, tree in hits:
            if (tip, path) not in commits:
                commits[(tip, path)] = last_commit(top, tip, path)
            stamp, author, date = commits[(tip, path)]
            cands.append({"name": name, "tip": tip, "kind": kind, "path": path, "tree": tree,
                          "stamp": stamp, "author": author, "date": date})
    if not cands:
        if not any_coddoc:
            raise Fail("no-coddoc", f"ни в одной ветке нет папки coddoc/ с задачами (веток: {len(refs)})")
        raise Fail("not-found", f"{key} нет ни в одной ветке (веток: {len(refs)})")
    # Самая свежая; одна и та же версия в нескольких ветках — текущая, потом локальная, потом origin.
    best = max(cands, key=lambda c: (c["stamp"], -c["kind"]))
    folder = top / ".coddoc-tmp" / "peek"
    dest = folder / best["path"].rsplit("/", 1)[-1]
    try:
        make_folder(folder)
        files = export(top, best["tip"], best["path"], dest)
        prune(folder, KEEP)
    except OSError as error:
        raise Fail("no-write", f"не могу писать в {folder}: {error}") from None

    print(f"{dest.name} · {best['path']}")
    print(f"ветка {best['name']} · {best['author']} · {best['date']}")
    others = others_line(best, cands)
    if others:
        print(others)
    print(f"файлы ({len(files)}):")
    for rel, blob in list(files.items())[:FILES_SHOWN]:
        print(f"  {rel} — {header(blob)}" if rel.lower().endswith(".md") else f"  {rel}")
    if len(files) > FILES_SHOWN:
        print(f"  … и ещё {len(files) - FILES_SHOWN}")
    print(f"выгружено: {dest}")
    print(f"peek: ok key={dest.name} files={len(files)} path={dest.as_posix()}")
    return 0


def tree_files(top, tip, dirs=("coddoc",)):
    """→ [(путь, хеш блоба)] всех файлов папок dirs ветки."""
    files = []
    for entry in text(git(top, "ls-tree", "-r", "-z", tip, "--", *dirs)).split("\0"):
        if entry:
            meta, path = entry.split("\t", 1)
            mode, kind, sha = meta.split()
            if kind == "blob" and mode != "120000":
                files.append((path, sha))
    return files


def matching_lines(blob, words):
    """→ [(номер, строка)], где есть все слова; двоичные файлы пропускаются."""
    if b"\0" in blob[:8000]:
        return []
    return [(number, line.strip()) for number, line in enumerate(blob.decode("utf-8", "replace").splitlines(), 1)
            if all(word in line.casefold() for word in words)]


def key_of(path):
    """Ключ строки — ближайшая вверх папка вида <БУКВЫ>-<цифры>; нет — «—»."""
    return next((part for part in reversed(path.split("/")[:-1]) if KEY_RE.match(part)), "—")


def peek_words(words):
    top = find_top()
    note = fetch(top)
    if note:
        print(note)
    refs = branches(top)
    files = {}
    for _, tip, _, _ in refs:
        if tip not in files:
            files[tip] = tree_files(top, tip)
    if not any(files.values()):
        raise Fail("no-coddoc", f"ни в одной ветке нет папки coddoc/ с файлами (веток: {len(refs)})")
    blobs = read_blobs(top, sorted({sha for listed in files.values() for _, sha in listed}))
    hits = {sha: matching_lines(blob, words) for sha, blob in blobs.items()}
    # Одинаковая пара «файл, строка» — один раз: ветки по свежести вершины, первая забирает строку.
    found = {}
    for name, tip, kind, stamp in sorted(refs, key=lambda r: (-r[3], r[2], r[0])):
        for path, sha in files[tip]:
            for number, line in hits[sha]:
                found.setdefault((path, line), (name, tip, number))
    phrase = " ".join(words)
    if not found:
        print(f"«{phrase}» в coddoc/ не нашлось ни в одной ветке (веток: {len(refs)})")
        print("peek: found 0")
        return 0
    rows = sorted(((key_of(path), path, number, line, name, tip) for (path, line), (name, tip, number) in found.items()),
                  key=lambda row: (row[0], row[1], row[2]))
    print(f"«{phrase}» — строк: {len(rows)} (веток: {len(refs)})")
    authors = {}
    for key, path, number, line, name, tip in rows[:LINES_SHOWN]:
        if (tip, path) not in authors:
            authors[(tip, path)] = text(git(top, "log", "-1", "--format=%an", tip, "--", path)).strip()
        shown = line if len(line) <= LINE_WIDTH else line[:LINE_WIDTH - 1] + "…"
        print(f"  {key} · {name} · {authors[(tip, path)]} · {path}:{number} · {shown}")
    if len(rows) > LINES_SHOWN:
        print(f"  … и ещё {len(rows) - LINES_SHOWN} — уточни слова")
    print(f"peek: found {len(rows)}")
    return 0


def base_ref(top, named=None):
    """→ (ссылка, имя) основной ветки: названная — origin/<имя>, локальная <имя>, ссылка от refs/remotes/; иначе
    origin/HEAD, origin/main, origin/master, потом локальные main и master — origin свежее после fetch, локальная
    у аналитика обычно отстаёт; нет — (None, None)."""
    if named:
        refs = [f"refs/remotes/origin/{named}", f"refs/heads/{named}", f"refs/remotes/{named}"]
    else:
        head = text(git(top, "symbolic-ref", "-q", "refs/remotes/origin/HEAD")).strip()
        refs = ([head] if head else []) + ["refs/remotes/origin/main", "refs/remotes/origin/master", "refs/heads/main",
                                           "refs/heads/master"]
    for ref in refs:
        if git(top, "rev-parse", "-q", "--verify", ref + "^{commit}").returncode == 0:
            return ref, ref.split("/", 2)[2]
    return None, None


def wanted(path):
    """Файл, у которого может быть счёт открытых вопросов: .md в coddoc/ или ноут."""
    return (path.startswith("coddoc/") and path.lower().endswith(".md")) or bool(NOTEBOOK_RE.match(path))


def branch_changes(top, base, tip):
    """→ пути coddoc/ и notes/, которые ветка поменяла от общей с основной точки; общей точки нет — None."""
    done = git(top, "diff", "--name-only", "-z", "--no-renames", "--diff-filter=d", f"{base}...{tip}", "--",
               "coddoc", "notes")
    if done.returncode:
        return None
    return {path for path in text(done).split("\0") if path}


def disk_changes(top):
    """→ (изменённые и новые файлы рабочей копии в coddoc/ и notes/, удалённые) — пути от корня репозитория."""
    done = git(top, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames", "--",
               "coddoc", "notes")
    changed, gone = set(), set()
    for entry in text(done).split("\0"):
        if len(entry) > 3:
            (gone if "D" in entry[:2] else changed).add(entry[3:])
    return changed, gone


def open_questions(path, blob):
    """→ (открытых вопросов, ключ, тема ноута) или None — у файла нет счёта вопросов."""
    lines = blob.decode("utf-8", "replace").splitlines()
    if NOTEBOOK_RE.match(path):
        front = {}
        if lines and lines[0].strip() == "---":
            for line in lines[1:]:
                if line.strip() == "---":
                    break
                match = FRONT_RE.match(line.strip())
                if match:
                    front.setdefault(match.group(1), match.group(2).strip())
        key = front.get("ключ", "")
        count = sum(1 for line in lines if OPEN_RE.match(line) and "‖" not in line)
        return count, key if KEY_RE.match(key) else "—", front.get("тема") or path.split("/")[1]
    for line in lines[:HEAD_LINES]:
        status = next(iter(STATUS_RE.findall(line)), "")
        if status:
            need = NEED_RE.search(status)
            return int(need.group(1)) if need else 0, key_of(path), ""
    return None


def peek_list(named=None):
    top = find_top()
    note = fetch(top)
    if note:
        print(note)
    base, base_name = base_ref(top, named)
    if named and not base:
        raise Fail("no-branch", f"ветку {named} не нашёл ни в origin, ни среди локальных")
    current = text(git(top, "symbolic-ref", "-q", "HEAD")).strip()
    listing = ["for-each-ref", "--format=%(refname)%00%(objectname)"] + ([f"--no-merged={base}"] if base else [])
    work = [line.split("\0") for line in text(git(top, *listing, "refs/heads")).splitlines() if line]
    changed, gone = disk_changes(top)

    cands = {}  # путь → [{stamp, kind, where, author, date, sha | file}]; kind 0 — диск, 1 — ветка, 2 — основная

    def from_tree(tip, where, kind, path, sha):
        stamp, author, date = last_commit(top, tip, path)
        cands.setdefault(path, []).append({"stamp": stamp, "kind": kind, "where": where, "author": author,
                                           "date": date, "sha": sha})

    for ref, tip in work:
        touched = branch_changes(top, base, tip) if base else None
        for path, sha in tree_files(top, tip, ("coddoc", "notes")):
            if not wanted(path) or (touched is not None and path not in touched):
                continue
            if ref == current and (path in changed or path in gone):
                continue  # у текущей ветки этот файл берётся с диска
            from_tree(tip, ref[len("refs/heads/"):], 1, path, sha)
    if base:
        for path, sha in tree_files(top, base, ("notes",)):
            if NOTEBOOK_RE.match(path):
                from_tree(base, base_name, 2, path, sha)
    for path in changed:
        disk = top.joinpath(*path.split("/"))
        if wanted(path) and disk.is_file():
            stamp = disk.stat().st_mtime
            cands.setdefault(path, []).append({
                "stamp": stamp, "kind": 0, "where": "рабочая копия", "author": "не закоммичено",
                "date": time.strftime("%Y-%m-%d %H:%M", time.localtime(stamp)), "file": disk})

    # Самая свежая версия пути; одно время — диск, потом ветка, потом основная.
    best = {path: max(found, key=lambda c: (c["stamp"], -c["kind"])) for path, found in cands.items()}
    blobs = read_blobs(top, [c["sha"] for c in best.values() if "sha" in c])
    rows = []
    for path, c in best.items():
        try:
            data = c["file"].read_bytes() if "file" in c else blobs[c["sha"]]
        except OSError:
            continue
        counted = open_questions(path, data)
        if counted and counted[0] > 0:
            rows.append({"path": path, "count": counted[0], "key": counted[1], "theme": counted[2], "data": data, **c})
    rows.sort(key=lambda row: (row["key"] == "—", row["key"], row["path"]))

    dest = top / ".coddoc-tmp" / "peek" / "list"
    try:
        make_folder(dest.parent)
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir()
        for row in rows:
            target = dest.joinpath(*row["path"].split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(row["data"])
    except OSError as error:
        raise Fail("no-write", f"не могу писать в {dest}: {error}") from None

    if base:
        print(f"в работе — основная ветка {base_name}, невлитых веток: {len(work)}")
    else:
        print(f"основную ветку не нашёл — смотрю все локальные ветки целиком ({len(work)})")
    if not rows:
        print("документов с открытыми вопросами в работе нет")
    for row in rows:
        theme = f" · тема: {row['theme']}" if row["theme"] else ""
        print(f"  {row['key']} · {row['path']} · {row['where']} · {row['author']} · {row['date']} · "
              f"открытых: {row['count']}{theme}")
    if rows:
        print(f"скопировано: {dest}")
    print(f"peek: list {len(rows)} path={dest.as_posix()}")
    return 0


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        if args[:1] == ["--list"]:
            rest = args[1:]
            if rest and (len(rest) != 2 or rest[0] != "--base" or not rest[1].strip()):
                raise Fail("usage", "у --list только --base <ветка>: peek.py --list [--base develop]")
            return peek_list(rest[1].strip() if rest else None)
        if len(args) == 1 and KEY_RE.match(args[0]):
            return peek_key(args[0])
        words = [word.casefold() for arg in args for word in arg.split()]
        if not words:
            raise Fail("usage", "нужен ключ задачи или слова: peek.py <КЛЮЧ> | peek.py <слово> [<слово> …] | "
                                "peek.py --list [--base <ветка>]")
        return peek_words(words)
    except Fail as error:
        print(error)
        print(f"peek: error {error.code}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
