#!/usr/bin/env python3
"""Самопроверка peek/reference/peek.py на сфабрикованных репозиториях.

    python3 selftest-peek.py

origin.git — общий репозиторий; alice/ — клон коллеги, me/ — клон человека, который смотрит. Ветки в origin:
  main          LM-1 (старый, Боб, 01.11), OTHER-5
  feature/lm-1  LM-1 (новый, Алиса, 05.11): статус и редакция в шапке, спека без шапки, картинка
  feature/epic  EP-1/LM-2 — ключ ребёнком эпика, с подпапкой (Алиса, 03.11)
  my            ветка, на которой стоит me; после клона me коллега допушила туда LM-3 (07.11)
У me: локальные main, my (своя правка OTHER-5), feature/lm-1 — та же версия, что в origin; в рабочей копии
незакоммиченная правка, правка в индексе и неотслеживаемый notes/. После каждого вызова peek всё это должно остаться
как было: HEAD, ветка, индекс, рабочая копия, локальные ветки, notes/. Меняются только origin/* (fetch) и .coddoc-tmp/.

--list — отдельная песочница lister/: основная (вопросы в ней не в работе), невлитые ветки с БТ, с ноутом и без правок
документов, влитая ветка, текущая ветка с правкой на диске, удалённым файлом и новым ноутом вне git; задачи, влитые в
dev при origin/HEAD на main (--base); плюс репозиторий без основной ветки.

Git изолирован: свой глобальный конфиг, без системного, GIT_CEILING_DIRECTORIES — выше песочницы не подняться.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
# PEEK_SCRIPT — подсунуть испорченную копию и убедиться, что самопроверка её ловит.
PEEK = Path(os.environ.get("PEEK_SCRIPT") or HERE.parent / "peek" / "reference" / "peek.py")

HEADER_OLD = ("# Бизнес-требования: Старое\n\n> **Задача:** LM-1\n> **Редакция:** 1\n>\n"
              "> **Статус готовности:** Требуются уточнения (2)\n\nАвтосоздание пользователей при входе.\n")
HEADER_NEW = ("# Бизнес-требования: Новое\n\n> **Задача:** LM-1\n> **Редакция:** 2 (2026-11-05)\n>\n"
              "> **Статус готовности:** Готово к разработке\n\nАвтосоздание пользователей при входе.\n")
MANY = "".join(f"строка-повтор {index}\n" for index in range(1, 36))
PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x01\r\n\x00\xff"


def remove_tree(path):
    """Файлы объектов git на Windows — только для чтения: без снятия флага rmtree молча оставит их."""
    for item in Path(path).rglob("*"):
        try:
            os.chmod(item, stat.S_IWRITE | stat.S_IREAD)
        except OSError:
            pass
    shutil.rmtree(path, ignore_errors=True)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    root = Path(os.path.realpath(tempfile.mkdtemp(prefix="peek-selftest-")))
    config = root / "gitconfig"
    config.write_text("[user]\n\tname = Тест\n\temail = t@example.com\n[init]\n\tdefaultBranch = main\n"
                      "[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n", encoding="utf-8")
    env = dict(os.environ, GIT_CONFIG_GLOBAL=str(config), GIT_CONFIG_NOSYSTEM="1", GIT_CEILING_DIRECTORIES=str(root),
               GIT_TERMINAL_PROMPT="0")
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        env.pop(name, None)

    failures, checks = [], 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    def g(cwd, *args, who=None, date=None):
        extra = {}
        if who:
            extra = {"GIT_AUTHOR_NAME": who, "GIT_COMMITTER_NAME": who, "GIT_AUTHOR_EMAIL": "x@example.com",
                     "GIT_COMMITTER_EMAIL": "x@example.com"}
        if date:
            extra.update(GIT_AUTHOR_DATE=date, GIT_COMMITTER_DATE=date)
        done = subprocess.run(["git", *args], cwd=cwd, env=dict(env, **extra), capture_output=True)
        if done.returncode:
            raise RuntimeError(f"git {' '.join(args)}: {done.stderr.decode('utf-8', 'replace')}")
        return done.stdout.decode("utf-8", "replace")

    def put(repo, rel, content):
        path = Path(repo, *rel.split("/"))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if isinstance(content, bytes) else content.encode("utf-8"))

    def commit(repo, who, date, message):
        g(repo, "add", "-A")
        g(repo, "commit", "-q", "-m", message, who=who, date=date)

    def peek(cwd, *args):
        done = subprocess.run([sys.executable, str(PEEK), *args], cwd=cwd, env=env, capture_output=True)
        out = done.stdout.decode("utf-8", "replace")
        return done.returncode, out, (out.strip().splitlines() or [""])[-1]

    # ---------------------------------------------------------------- репозитории
    origin, alice, me = root / "origin.git", root / "alice", root / "me"
    g(root, "init", "-q", "--bare", str(origin))
    g(root, "clone", "-q", str(origin), str(alice))
    put(alice, "README.md", "# Репо\n")
    put(alice, "coddoc/LM-1/business_requirements.md", HEADER_OLD)
    put(alice, "coddoc/OTHER-5/x.md", "# Другое\n")
    put(alice, "coddoc/OTHER-5/many.md", MANY)
    commit(alice, "Боб", "2026-11-01T10:00:00+03:00", "LM-1 старый")
    g(alice, "push", "-q", "origin", "main")
    g(alice, "checkout", "-q", "-b", "feature/lm-1")
    put(alice, "coddoc/LM-1/business_requirements.md", HEADER_NEW)
    put(alice, "coddoc/LM-1/technical_specification.md", "# Спека\n\nБез шапки.\n")
    put(alice, "coddoc/LM-1/img/pic.png", PNG)
    commit(alice, "Алиса", "2026-11-05T12:00:00+03:00", "LM-1 новый")
    g(alice, "push", "-q", "origin", "feature/lm-1")
    g(alice, "checkout", "-q", "main")
    g(alice, "checkout", "-q", "-b", "feature/epic")
    put(alice, "coddoc/EP-1/LM-2/business_requirements.md", "# Бизнес-требования: Ребёнок\n")
    put(alice, "coddoc/EP-1/LM-2/sub/notes.md", "заметки\n")
    put(alice, "coddoc/EP-1/_foundation/technical_specification.md", "Фундамент эпика.\n")
    commit(alice, "Алиса", "2026-11-03T12:00:00+03:00", "EP-1/LM-2")
    g(alice, "push", "-q", "origin", "feature/epic")

    g(root, "clone", "-q", str(origin), str(me))
    g(me, "checkout", "-q", "-b", "my")
    put(me, "coddoc/OTHER-5/x.md", "# Другое, моя правка\n")
    commit(me, "Я", "2026-11-02T09:00:00+03:00", "моя правка")
    g(me, "push", "-q", "-u", "origin", "my")
    g(me, "branch", "-q", "feature/lm-1", "origin/feature/lm-1")

    # Коллега допушила в ветку, на которой стоит me; me об этом ещё не знает.
    g(alice, "fetch", "-q", "origin")
    g(alice, "checkout", "-q", "-b", "my", "origin/my")
    put(alice, "coddoc/LM-3/business_requirements.md", "# Бизнес-требования: Третья\n")
    commit(alice, "Алиса", "2026-11-07T12:00:00+03:00", "LM-3")
    g(alice, "push", "-q", "origin", "my")

    # Грязная рабочая копия me: правка без индекса, правка в индексе, неотслеживаемые заметки.
    put(me, "README.md", "# Репо, правлю\n")
    put(me, "coddoc/OTHER-5/x.md", "# Другое, в индексе\n")
    g(me, "add", "coddoc/OTHER-5/x.md")
    put(me, "notes/n.md", "мои заметки\n")

    def state():
        return {
            "HEAD": g(me, "rev-parse", "HEAD"),
            "ветка": g(me, "symbolic-ref", "HEAD"),
            "статус": g(me, "status", "--porcelain=v1", "-uall"),
            "рабочая копия": g(me, "diff"),
            "индекс": g(me, "diff", "--cached"),
            "локальные ветки": g(me, "for-each-ref", "refs/heads"),
            "notes/": (me / "notes" / "n.md").read_text(encoding="utf-8"),
        }

    before = state()

    def unchanged(label):
        after = state()
        for name, value in before.items():
            expect(after[name] == value, f"{label}: изменилось «{name}»")

    out_dir = me / ".coddoc-tmp" / "peek"

    # ---------------------------------------------------------------- fetch: ключ, который есть только у коллеги
    expect(g(me, "rev-parse", "origin/my") != g(alice, "rev-parse", "my"), "до peek me не видит пуш коллеги")
    code, out, last = peek(me, "LM-3")
    expect(code == 0 and last == f"peek: ok key=LM-3 files=1 path={(out_dir / 'LM-3').as_posix()}", f"LM-3: {out}")
    expect("ветка origin/my · Алиса · 2026-11-07" in out, f"LM-3 найден в origin/my после fetch: {out}")
    expect("origin не обновлён" not in out, f"fetch прошёл: {out}")
    unchanged("LM-3")

    # ---------------------------------------------------------------- свежая версия, та же в двух ветках
    code, out, last = peek(me, "LM-1")
    dest = out_dir / "LM-1"
    expect(code == 0 and last == f"peek: ok key=LM-1 files=3 path={dest.as_posix()}", f"LM-1: {out}")
    expect("ветка feature/lm-1 · Алиса · 2026-11-05" in out, f"LM-1: свежая версия, локальное имя впереди origin: {out}")
    others = next((line for line in out.splitlines() if line.startswith("ещё в: ")), "")
    for mark in ("origin/feature/lm-1 (то же)", "main (старее)", "my (старее)", "origin/main (старее)",
                 "origin/my (старее)", "origin/feature/epic (старее)"):
        expect(mark in others, f"LM-1: в «ещё в» нет «{mark}»: {others}")
    expect("business_requirements.md — Готово к разработке · редакция 2 (2026-11-05)" in out, f"LM-1: шапка: {out}")
    expect("technical_specification.md — без шапки" in out, f"LM-1: без шапки: {out}")
    for rel in ("business_requirements.md", "technical_specification.md", "img/pic.png"):
        want = subprocess.run(["git", "cat-file", "blob", f"origin/feature/lm-1:coddoc/LM-1/{rel}"], cwd=me, env=env,
                              capture_output=True).stdout
        got = dest.joinpath(*rel.split("/")).read_bytes() if dest.joinpath(*rel.split("/")).exists() else None
        expect(got == want, f"LM-1: {rel} не совпал с веткой байт в байт")
    expect(sorted(str(p.relative_to(dest).as_posix()) for p in dest.rglob("*") if p.is_file())
           == ["business_requirements.md", "img/pic.png", "technical_specification.md"], "LM-1: лишние файлы в выгрузке")
    ignore = me / ".coddoc-tmp" / ".gitignore"
    expect(ignore.exists() and ignore.read_text(encoding="utf-8").strip() == "*", ".coddoc-tmp/.gitignore = «*»")
    unchanged("LM-1")

    # ---------------------------------------------------------------- повтор: регистр ключа, старый файл убран
    put(dest, "old.md", "от прошлой выгрузки\n")
    code, out, last = peek(me, "lm-1")
    expect(code == 0 and last.startswith("peek: ok key=LM-1 files=3"), f"lm-1 строчными: {out}")
    expect(not (dest / "old.md").exists(), "повтор: старая выгрузка ключа не удалена")

    # ---------------------------------------------------------------- ребёнок эпика, запуск из подпапки
    code, out, last = peek(me / "coddoc", "LM-2")
    expect(code == 0 and last == f"peek: ok key=LM-2 files=2 path={(out_dir / 'LM-2').as_posix()}", f"LM-2 из подпапки: {out}")
    expect("LM-2 · coddoc/EP-1/LM-2" in out and "ветка origin/feature/epic" in out, f"LM-2: путь и ветка: {out}")
    expect((out_dir / "LM-2" / "sub" / "notes.md").exists(), "LM-2: подпапка ключа выгружена")
    expect(not (me / "coddoc" / ".coddoc-tmp").exists(), "из подпапки: своей .coddoc-tmp в подпапке нет")
    unchanged("LM-2")

    # ---------------------------------------------------------------- 10 последних выгрузок
    now = time.time()
    for index in range(1, 12):
        old = out_dir / f"OLD-{index}"
        old.mkdir()
        os.utime(old, (now - (100 - index) * 60, now - (100 - index) * 60))
    code, out, last = peek(me, "LM-1")
    left = sorted(d.name for d in out_dir.iterdir() if d.is_dir())
    want = sorted(["LM-1", "LM-2", "LM-3"] + [f"OLD-{index}" for index in range(5, 12)])
    expect(code == 0 and left == want, f"чистка: осталось {left}, ждали {want}")

    # ---------------------------------------------------------------- слова
    def rows(out):
        return [line.strip() for line in out.splitlines() if line.startswith("  ") and " · " in line]

    # Одна и та же строка во всех ветках — один раз, с самой свежей веткой (origin/my, 07.11); регистр кириллицы.
    code, out, last = peek(me, "АВТОСОЗДАНИЕ", "пользователей")
    expect(code == 0 and last == "peek: found 1", f"слова во всех ветках: {out}")
    expect(rows(out) == ["LM-1 · origin/my · Боб · coddoc/LM-1/business_requirements.md:8 · "
                         "Автосоздание пользователей при входе."], f"слова во всех ветках — строка: {rows(out)}")
    # Строка только новой версии — в локальной ветке и в origin, та же вершина: впереди локальная.
    code, out, last = peek(me, "готово к разработке")
    expect(code == 0 and rows(out) == ["LM-1 · feature/lm-1 · Алиса · coddoc/LM-1/business_requirements.md:6 · "
                                       "> **Статус готовности:** Готово к разработке"], f"фраза одним аргументом: {out}")
    code, out, last = peek(me, "автосоздание", "готово")
    expect(code == 0 and last == "peek: found 0" and "не нашлось" in out, f"слова в разных строках — не совпадение: {out}")
    code, out, last = peek(me, "LM-1", "LM-2")
    expect(code == 0 and last == "peek: found 0", f"два ключа — это слова: {out}")
    code, out, last = peek(me, "фундамент")
    expect(rows(out) == ["EP-1 · origin/feature/epic · Алиса · coddoc/EP-1/_foundation/technical_specification.md:1 · "
                         "Фундамент эпика."], f"ключ строки — папка эпика: {rows(out)}")
    code, out, last = peek(me, "заметки")
    expect(len(rows(out)) == 1 and rows(out)[0].startswith("LM-2 · origin/feature/epic · Алиса · "
                                                            "coddoc/EP-1/LM-2/sub/notes.md:1"), f"ключ из подпапки: {rows(out)}")
    code, out, last = peek(me, "строка-повтор")
    expect(last == "peek: found 35" and len(rows(out)) == 30 and "и ещё 5 — уточни слова" in out, f"предел 30: {out}")
    code, out, last = peek(me, "IHDR")
    expect(last == "peek: found 0", f"двоичный файл не ищется: {out}")
    unchanged("слова")

    # ---------------------------------------------------------------- ошибки
    code, out, last = peek(me, "NOPE-9")
    expect(code == 1 and last == "peek: error not-found", f"нет ключа: {out}")
    for args in ((), ("  ",)):
        code, out, last = peek(me, *args)
        expect(code == 1 and last == "peek: error usage", f"{args}: {out}")
    plain = root / "plain"
    plain.mkdir()
    code, out, last = peek(plain, "LM-1")
    expect(code == 1 and last == "peek: error not-repo", f"не репозиторий: {out}")
    bare = root / "nocoddoc"
    g(root, "init", "-q", str(bare))
    put(bare, "README.md", "# Без coddoc\n")
    commit(bare, "Я", "2026-11-01T10:00:00+03:00", "init")
    code, out, last = peek(bare, "LM-1")
    expect(code == 1 and last == "peek: error no-coddoc" and "origin нет" in out, f"нет coddoc: {out}")
    code, out, last = peek(bare, "слово")
    expect(code == 1 and last == "peek: error no-coddoc", f"нет coddoc, слова: {out}")
    unchanged("ошибки")

    # ---------------------------------------------------------------- origin недоступен
    me2 = root / "me2"
    g(root, "clone", "-q", str(origin), str(me2))
    g(me2, "remote", "set-url", "origin", str(root / "nowhere.git"))
    code, out, last = peek(me2, "LM-1")
    expect("origin не обновлён" in out, f"нет доступа к origin — строка: {out}")
    expect(code == 0 and "ветка origin/feature/lm-1 · Алиса" in out, f"нет доступа к origin — ищет по тому, что есть: {out}")

    # ---------------------------------------------------------------- --list: документы в работе с открытыми вопросами
    def br(key, status):
        return (f"# Бизнес-требования: {key}\n\n> **Задача:** {key}\n> **Редакция:** 1\n>\n"
                f"> **Статус готовности:** {status}\n\nТекст.\n")

    def notebook(theme, key, *lines):
        return (f"---\nтема: {theme}\nключ: {key}\nо чём: —\nроли: —\n---\n# Ноут: {theme}\n\n## 2026-11-01\n\n"
                "### 1 · чат\n" + "".join(line + "\n" for line in lines))

    boats = ("- [открыто] Кто выдаёт вёсла — ждёт: смотритель · 2026-11-01 №1.1",
             "- [открыто] Нужен ли инструктаж — ждёт: инструктор · 2026-11-01 №1.2 ‖ закрыт: 2026-11-02 №1.1",
             "> - [открыто] цитата, а не пункт",
             "- [решено] Вёсла выдаёт смотритель — решил: Лаврова Е. · 2026-11-01 №1.3")
    lorigin, lme = root / "list-origin.git", root / "lister"
    g(root, "init", "-q", "--bare", str(lorigin))
    g(root, "clone", "-q", str(lorigin), str(lme))
    put(lme, "README.md", "# Список\n")
    put(lme, "coddoc/AB-1/business_requirements.md", br("AB-1", "Требуются уточнения (3)"))
    put(lme, "notes/лодки/notebook.md", notebook("лодки", "—", *boats))
    put(lme, "notes/закрыт/notebook.md", notebook("закрыт", "AB-1",
                                                  "- [открыто] Старый вопрос — ждёт: — · 2026-11-01 №1.1 ‖ снят: 2026-11-02 №1"))
    put(lme, "notes/склад/notebook.md", notebook("склад", "—", "- [открыто] Где хранить вёсла — ждёт: — · 2026-11-01 №1.1"))
    commit(lme, "Боб", "2026-11-01T10:00:00+03:00", "основная")
    g(lme, "push", "-q", "origin", "main")
    g(lme, "remote", "set-head", "origin", "-a")
    # Невлитая ветка: в БТ два вопроса, спека готова, у этапов статуса нет.
    g(lme, "checkout", "-q", "-b", "feature/ab-2")
    put(lme, "coddoc/AB-2/business_requirements.md", br("AB-2", "Требуются уточнения (2)"))
    put(lme, "coddoc/AB-2/technical_specification.md", br("AB-2", "Готово к разработке"))
    put(lme, "coddoc/AB-2/stages.md", "# Этапы\n")
    commit(lme, "Алиса", "2026-11-05T12:00:00+03:00", "AB-2")
    # Влитая ветка: её вопрос уже в основной — не в работе.
    g(lme, "checkout", "-q", "main")
    g(lme, "checkout", "-q", "-b", "feature/ab-3")
    put(lme, "coddoc/AB-3/business_requirements.md", br("AB-3", "Требуются уточнения (1)"))
    commit(lme, "Алиса", "2026-11-03T12:00:00+03:00", "AB-3")
    g(lme, "checkout", "-q", "main")
    g(lme, "merge", "-q", "--no-ff", "-m", "влить AB-3", "feature/ab-3", who="Боб", date="2026-11-04T10:00:00+03:00")
    g(lme, "push", "-q", "origin", "main")
    # Невлитая ветка без правок документов: AB-1 в ней унаследован от основной — не в работе.
    g(lme, "checkout", "-q", "-b", "feature/readme")
    put(lme, "README.md", "# Список, правка\n")
    commit(lme, "Боб", "2026-11-06T10:00:00+03:00", "readme")
    # Невлитая ветка дописала ноут основной: её версия свежее.
    g(lme, "checkout", "-q", "main")
    g(lme, "checkout", "-q", "-b", "feature/boats")
    put(lme, "notes/лодки/notebook.md", notebook("лодки", "—", *boats,
                                                 "- [открыто] Сколько лодок в прокате — ждёт: — · 2026-11-06 №1.1"))
    commit(lme, "Боб", "2026-11-06T12:00:00+03:00", "ноут")
    # Текущая ветка: БТ закоммичен с четырьмя вопросами, на диске — один; старый файл удалён с диска; новый ноут не в git.
    g(lme, "checkout", "-q", "main")
    g(lme, "checkout", "-q", "-b", "feature/ab-5")
    put(lme, "coddoc/AB-5/business_requirements.md", br("AB-5", "Требуются уточнения (4)"))
    put(lme, "coddoc/AB-5/technical_specification.md", br("AB-5", "Требуются уточнения (2)"))
    put(lme, "coddoc/AB-5/old.md", br("AB-5", "Требуются уточнения (5)"))
    commit(lme, "Я", "2026-11-07T12:00:00+03:00", "AB-5")
    put(lme, "coddoc/AB-5/business_requirements.md", br("AB-5", "Требуются уточнения (1)"))
    (lme / "coddoc" / "AB-5" / "old.md").unlink()
    put(lme, "notes/новый/notebook.md", notebook("новый", "AB-5", "- [открыто] Кто согласует — ждёт: — · 2026-11-18 №1.1"))

    def lstate():
        return [g(lme, *args) for args in (("rev-parse", "HEAD"), ("symbolic-ref", "HEAD"), ("status", "--porcelain=v1", "-uall"),
                                            ("diff",), ("diff", "--cached"), ("for-each-ref", "refs/heads"))]

    lbefore = lstate()
    listed = lme / ".coddoc-tmp" / "peek" / "list"

    def list_rows(out):
        return [re.sub(r" · \d{4}-\d\d-\d\d \d\d:\d\d", "", line.strip()) for line in out.splitlines()
                if line.startswith("  ") and " · " in line]

    code, out, last = peek(lme, "--list")
    expect(code == 0 and last == f"peek: list 6 path={listed.as_posix()}", f"--list: {out}")
    expect("в работе — основная ветка origin/main, невлитых веток: 4" in out, f"--list: основная и невлитые: {out}")
    want = ["AB-2 · coddoc/AB-2/business_requirements.md · feature/ab-2 · Алиса · открытых: 2",
            "AB-5 · coddoc/AB-5/business_requirements.md · рабочая копия · не закоммичено · открытых: 1",
            "AB-5 · coddoc/AB-5/technical_specification.md · feature/ab-5 · Я · открытых: 2",
            "AB-5 · notes/новый/notebook.md · рабочая копия · не закоммичено · открытых: 1 · тема: новый",
            "— · notes/лодки/notebook.md · feature/boats · Боб · открытых: 2 · тема: лодки",
            "— · notes/склад/notebook.md · origin/main · Боб · открытых: 1 · тема: склад"]
    expect(list_rows(out) == want, f"--list — строки: {list_rows(out)}")
    expect("feature/ab-2 · Алиса · 2026-11-05" in out, f"--list: дата коммита: {out}")
    copied = sorted(p.relative_to(listed).as_posix() for p in listed.rglob("*") if p.is_file())
    expect(copied == ["coddoc/AB-2/business_requirements.md", "coddoc/AB-5/business_requirements.md",
                      "coddoc/AB-5/technical_specification.md", "notes/лодки/notebook.md", "notes/новый/notebook.md",
                      "notes/склад/notebook.md"],
           f"--list: скопировано {copied}")
    expect((listed / "coddoc" / "AB-5" / "business_requirements.md").read_bytes()
           == (lme / "coddoc" / "AB-5" / "business_requirements.md").read_bytes(), "--list: копия с диска")
    expect((listed / "notes" / "лодки" / "notebook.md").read_bytes()
           == subprocess.run(["git", "cat-file", "blob", "feature/boats:notes/лодки/notebook.md"], cwd=lme, env=env,
                             capture_output=True).stdout, "--list: копия ноута из ветки")
    expect(lstate() == lbefore, "--list: репозиторий изменился")

    # Вопрос ноута закрыт на диске — ноут уходит; старая копия из папки убрана.
    put(listed, "stale.md", "от прошлого списка\n")
    put(lme, "notes/новый/notebook.md", notebook("новый", "AB-5",
                                                 "- [открыто] Кто согласует — ждёт: — · 2026-11-18 №1.1 ‖ закрыт: 2026-11-18 №2.1"))
    code, out, last = peek(lme, "--list")
    expect(code == 0 and last.startswith("peek: list 5 ") and "notes/новый" not in out, f"--list: закрытый ноут: {out}")
    expect(not (listed / "stale.md").exists() and not (listed / "notes" / "новый").exists(), "--list: папка не пересоздана")
    # origin/HEAD нет — основная всё равно origin/main, а не локальная main.
    g(lme, "remote", "set-head", "origin", "-d")
    code, out, last = peek(lme, "--list")
    expect(code == 0 and "основная ветка origin/main," in out, f"--list без origin/HEAD: {out}")
    # origin/HEAD на develop — основная develop.
    g(lme, "push", "-q", "origin", "main:develop")
    g(lme, "remote", "set-head", "origin", "develop")
    code, out, last = peek(lme, "--list")
    expect(code == 0 and "основная ветка origin/develop," in out, f"--list, origin/HEAD на develop: {out}")
    g(lme, "remote", "set-head", "origin", "main")
    # Задачи вливают в dev, origin/HEAD — на main: без --base влитая в dev задача «в работе»; с --base dev — нет,
    # и сами dev и влитая ветка невлитыми не считаются.
    flow = root / "flow"
    g(root, "clone", "-q", str(lorigin), str(flow))
    g(flow, "checkout", "-q", "-b", "dev")
    g(flow, "checkout", "-q", "-b", "feature/ab-7")
    put(flow, "coddoc/AB-7/business_requirements.md", br("AB-7", "Требуются уточнения (1)"))
    commit(flow, "Алиса", "2026-11-08T10:00:00+03:00", "AB-7")
    g(flow, "checkout", "-q", "dev")
    g(flow, "merge", "-q", "--no-ff", "-m", "влить AB-7", "feature/ab-7", who="Боб", date="2026-11-08T12:00:00+03:00")
    g(flow, "push", "-q", "origin", "dev", "feature/ab-7")
    g(lme, "fetch", "-q", "origin")
    g(lme, "branch", "-q", "dev", "origin/dev")
    g(lme, "branch", "-q", "feature/ab-7", "origin/feature/ab-7")
    code, out, last = peek(lme, "--list")
    expect(code == 0 and last.startswith("peek: list 6 ") and "AB-7 ·" in out, f"--list, dev без --base: {out}")
    code, out, last = peek(lme, "--list", "--base", "dev")
    expect(code == 0 and last.startswith("peek: list 5 ") and "AB-7" not in out
           and "в работе — основная ветка origin/dev, невлитых веток: 4" in out, f"--list --base dev: {out}")
    code, out, last = peek(lme, "--list", "--base", "origin/dev")
    expect(code == 0 and "основная ветка origin/dev," in out and "AB-7" not in out, f"--list --base origin/dev: {out}")
    g(lme, "branch", "-q", "stage", "main")
    code, out, last = peek(lme, "--list", "--base", "stage")
    expect(code == 0 and "основная ветка stage," in out, f"--list --base локальная: {out}")
    code, out, last = peek(lme, "--list", "--base", "нет-такой")
    expect(code == 1 and last == "peek: error no-branch" and "нет-такой" in out, f"--list --base, ветки нет: {out}")
    code, out, last = peek(lme, "--list", "--base")
    expect(code == 1 and last == "peek: error usage", f"--list --base без ветки: {out}")

    # Основной ветки нет — все локальные ветки целиком.
    trunk = root / "trunk"
    g(root, "init", "-q", "-b", "trunk", str(trunk))
    put(trunk, "coddoc/ZZ-1/business_requirements.md", br("ZZ-1", "Требуются уточнения (1)"))
    commit(trunk, "Я", "2026-11-01T10:00:00+03:00", "init")
    code, out, last = peek(trunk, "--list")
    expect(code == 0 and last.startswith("peek: list 1 ") and "основную ветку не нашёл" in out
           and "ZZ-1 · coddoc/ZZ-1/business_requirements.md · trunk · Я" in out, f"--list без основной: {out}")
    # Основная — локальная main; документов нет.
    code, out, last = peek(bare, "--list")
    expect(code == 0 and last.startswith("peek: list 0 ") and "основная ветка main" in out
           and "документов с открытыми вопросами в работе нет" in out, f"--list без документов: {out}")
    # Песочница коллеги: у невлитых веток вопросов нет; рабочая копия не тронута.
    code, out, last = peek(me, "--list")
    expect(code == 0 and last.startswith("peek: list 0 "), f"--list у me: {out}")
    unchanged("--list")
    code, out, last = peek(me, "--list", "LM-1")
    expect(code == 1 and last == "peek: error usage", f"--list с аргументом: {out}")

    if failures:
        print("\n".join(failures))
        print(f"selftest-peek: провалов {len(failures)} из {checks}; папка оставлена: {root}")
        return 1
    remove_tree(root)
    print(f"selftest-peek: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
