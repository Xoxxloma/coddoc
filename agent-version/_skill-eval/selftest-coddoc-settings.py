#!/usr/bin/env python3
"""Самопроверка coddoc-settings/reference/settings.py в песочнице.

    python3 selftest-coddoc-settings.py

Песочница — временная папка: repo/ (git, запуск из корня и из подпапки), plain/ (без git), broken/ (копия скрипта без
соседних скиллов). Скрипт настоящий, шаблоны базовых разделов — из business-requirements-doc и technical-spec-doc
этого репозитория. Кириллица — в аргументах и в пути песочницы. Git изолирован: GIT_CEILING_DIRECTORIES.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
# SETTINGS_SCRIPT — подсунуть испорченную копию и убедиться, что самопроверка её ловит.
SCRIPT = Path(os.environ.get("SETTINGS_SCRIPT") or HERE.parent / "coddoc-settings" / "reference" / "settings.py")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    root = Path(os.path.realpath(tempfile.mkdtemp(prefix="coddoc-settings-selftest-"))) / "песочница"
    repo, plain = root / "repo", root / "plain"
    for folder in (repo / "coddoc" / "AB-1", plain):
        folder.mkdir(parents=True)
    env = dict(os.environ, GIT_CEILING_DIRECTORIES=str(root), GIT_CONFIG_NOSYSTEM="1")
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"):
        env.pop(name, None)
    subprocess.run(["git", "init", "-q", str(repo)], env=env, check=True, capture_output=True)

    failures, checks = [], 0

    def expect(condition, message):
        nonlocal checks
        checks += 1
        if not condition:
            failures.append(message)

    def run(cwd, *args, script=SCRIPT):
        done = subprocess.run([sys.executable, str(script), *args], cwd=cwd, env=env, capture_output=True)
        out = done.stdout.decode("utf-8", "replace")
        return done.returncode, out, (out.strip().splitlines() or [""])[-1]

    folder = repo / ".coddoc-tmp" / "coddoc-settings"
    bt, spec = folder / "sections-bt.md", folder / "sections-spec.md"

    # Пусто: show без файлов.
    code, out, last = run(repo, "show")
    expect(code == 0 and last == "coddoc-settings: show" and out.count("не настроено") == 2, f"show пусто: {out}")

    # dry-run не пишет.
    code, out, last = run(repo, "add", "bt", "--name", "Метрики успеха", "--what", "метрика, текущее значение, цель",
                          "--question", "Как поймём, что фича сработала?", "--dry-run")
    expect(code == 0 and last.startswith("coddoc-settings: dry-run doc=bt sections=1 ")
           and "## Метрики успеха" in out and not bt.exists(), f"add --dry-run: {out}")

    # add из подпапки — в корень репозитория; .gitignore создан.
    code, out, last = run(repo / "coddoc" / "AB-1", "add", "bt", "--name", "Метрики успеха", "--what",
                          "метрика, текущее значение, цель", "--question", "Как поймём, что фича сработала?")
    expect(code == 0 and last.startswith("coddoc-settings: ok doc=bt sections=1 ") and bt.exists(), f"add: {out}")
    expect(not (repo / "coddoc" / "AB-1" / ".coddoc-tmp").exists(), "из подпапки своей .coddoc-tmp нет")
    ignore = repo / ".coddoc-tmp" / ".gitignore"
    expect(ignore.exists() and ignore.read_text(encoding="utf-8").strip() == "*", ".coddoc-tmp/.gitignore = «*»")
    raw = bt.read_bytes()
    expect(raw == ("# Дополнительные разделы: БТ\n\n## Метрики успеха\n- что писать: метрика, текущее значение, цель\n"
                   "- вопрос: Как поймём, что фича сработала?\n").encode("utf-8"), f"формат файла: {raw!r}")

    code, out, last = run(repo, "add", "bt", "--name", "Согласование с ИБ", "--what", "кто согласует, срок",
                          "--question", "Нужно ли согласование с ИБ и кто его даёт?")
    expect(code == 0 and "sections=2" in last, f"add второй: {out}")
    text = bt.read_text(encoding="utf-8")
    expect(text.index("## Метрики успеха") < text.index("## Согласование с ИБ"), "новый раздел — в конец")

    # Отказы add.
    cases = [
        (("bt", "Описание проблемы"), "base-name", "совпадение с базовым БТ"),
        (("bt", "приложения"), "base-name", "базовый без пояснения в скобках и регистра"),
        (("bt", "Дополнительные разделы"), "base-name", "имя обёртки"),
        (("spec", "Порядок выката"), "base-name", "совпадение с базовым спеки"),
        (("spec", "Каталог ошибок"), "base-name", "базовый спеки без номера"),
        (("bt", "метрики  УСПЕХА"), "duplicate", "повтор без учёта регистра и пробелов"),
    ]
    for (doc, name), code_name, label in cases:
        code, out, last = run(repo, "add", doc, "--name", name, "--what", "что-то", "--question", "Что?")
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"{label}: {out}")
    code, out, last = run(repo, "add", "spec", "--name", "Описание проблемы", "--what", "x", "--question", "Что?")
    expect(code == 0 and "sections=1" in last, f"базовый БТ — не базовый спеки: {out}")
    for name, count in (("Согласование (ИБ)", 2), ("Согласование (юристы)", 3)):
        code, out, last = run(repo, "add", "spec", "--name", name, "--what", "кто согласует", "--question", "Кто?")
        expect(code == 0 and f"sections={count}" in last, f"разные пояснения в скобках — разные разделы: {out}")
    code, out, last = run(repo, "remove", "spec", "--name", "Согласование")
    expect(code == 1 and last == "coddoc-settings: error not-found", f"remove без пояснения не цепляет «(ИБ)»: {out}")
    for name in ("Согласование (ИБ)", "Согласование (юристы)"):
        run(repo, "remove", "spec", "--name", name)
    for args, code_name, label in [
        (("--name", "Риски ИБ", "--what", " ", "--question", "Что?"), "empty", "пустое поле"),
        (("--name", "Риски ИБ", "--what", "x", "--question", "Что? И как?"), "question", "два «?»"),
        (("--name", "Риски ИБ", "--what", "x", "--question", "Что"), "question", "нет «?»"),
        (("--name", "Риски ИБ", "--what", "a\nb", "--question", "Что?"), "multiline", "перевод строки"),
        (("--name", "Риски ИБ", "--what", "x"), "usage", "нет --question"),
        (("--name", "Риски ИБ", "--what", "x", "--question", "Что?", "--bogus", "1"), "usage", "чужой ключ"),
    ]:
        code, out, last = run(repo, "add", "bt", *args)
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"{label}: {out}")
    expect(bt.read_text(encoding="utf-8") == text, "после отказов файл не изменился")

    # edit: поле и название, место сохраняется; переименование в базовое — отказ.
    code, out, last = run(repo, "edit", "bt", "--name", "метрики успеха", "--new-name", "Метрики", "--what",
                          "метрика и цель")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "## Метрики\n- что писать: метрика и цель\n- вопрос: Как поймём, что фича сработала?" in text
           and text.index("## Метрики") < text.index("## Согласование"), f"edit: {out}\n{text}")
    code, out, last = run(repo, "edit", "bt", "--name", "Метрики", "--new-name", "Сроки")
    expect(code == 1 and last == "coddoc-settings: error base-name", f"edit в базовое: {out}")
    code, out, last = run(repo, "edit", "bt", "--name", "Нет такого", "--what", "x")
    expect(code == 1 and last == "coddoc-settings: error not-found", f"edit несуществующего: {out}")
    code, out, last = run(repo, "edit", "bt", "--name", "Метрики")
    expect(code == 1 and last == "coddoc-settings: error usage", f"edit без полей: {out}")

    # remove: dry-run не трогает; последний раздел — файл удаляется.
    code, out, last = run(repo, "remove", "bt", "--name", "Метрики", "--dry-run")
    expect(code == 0 and "sections=1" in last and "## Метрики\n" in bt.read_text(encoding="utf-8"), f"remove dry: {out}")
    code, out, last = run(repo, "remove", "bt", "--name", "Метрики")
    expect(code == 0 and "sections=1" in last and "## Метрики\n" not in bt.read_text(encoding="utf-8"), f"remove: {out}")
    code, out, last = run(repo, "remove", "spec", "--name", "Описание проблемы")
    expect(code == 0 and "sections=0" in last and not spec.exists(), f"remove последнего: {out}")

    # show и check по готовому файлу.
    code, out, last = run(repo, "show")
    expect(code == 0 and "## Согласование с ИБ" in out and "спека: не настроено" in out, f"show: {out}")
    code, out, last = run(repo, "check")
    expect(code == 0 and last == "coddoc-settings: check ok", f"check: {out}")

    # Ручная правка: BOM и CRLF читаются; чужая строка, нет поля, базовое имя — check ловит.
    bt.write_bytes("﻿# Дополнительные разделы: БТ\r\n\r\n## Свой\r\n- что писать: x\r\n- вопрос: Что?\r\n".encode())
    code, out, last = run(repo, "check", "bt")
    expect(code == 0 and last == "coddoc-settings: check ok", f"check BOM/CRLF: {out}")
    for content, code_name, label in [
        ("# Дополнительные разделы: БТ\n\n## Свой\nтекст\n- что писать: x\n- вопрос: Что?\n", "bad-file", "чужая строка"),
        ("# Дополнительные разделы: БТ\n\n## Свой\n- что писать: x\n", "bad-file", "нет поля «вопрос»"),
        ("# Разделы\n\n## Свой\n- что писать: x\n- вопрос: Что?\n", "bad-file", "не тот заголовок"),
        ("# Дополнительные разделы: БТ\n\n## Как сейчас\n- что писать: x\n- вопрос: Что?\n", "base-name", "базовое руками"),
    ]:
        bt.write_text(content, encoding="utf-8")
        code, out, last = run(repo, "check")
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"check, {label}: {out}")
        code, out, last = run(repo, "add", "bt", "--name", "Новый", "--what", "x", "--question", "Что?")
        expect(code == 1 and bt.read_text(encoding="utf-8") == content, f"add поверх битого файла, {label}: {out}")

    # Вне git — от текущей папки.
    code, out, last = run(plain, "add", "spec", "--name", "Логирование", "--what", "что пишем в журнал",
                          "--question", "Что нужно писать в журнал?")
    expect(code == 0 and (plain / ".coddoc-tmp" / "coddoc-settings" / "sections-spec.md").exists(), f"вне git: {out}")

    # Скилл установлен не полностью: соседнего SKILL.md нет.
    broken = root / "broken" / "coddoc-settings" / "reference"
    broken.mkdir(parents=True)
    shutil.copy(SCRIPT, broken / "settings.py")
    code, out, last = run(repo, "add", "spec", "--name", "Х", "--what", "x", "--question", "Что?",
                          script=broken / "settings.py")
    expect(code == 1 and last == "coddoc-settings: error no-skill" and "technical-spec-doc" in out, f"нет SKILL.md: {out}")

    # Без команды — подсказка.
    code, out, last = run(repo)
    expect(code == 1 and last == "coddoc-settings: error usage", f"без аргументов: {out}")

    if failures:
        print("\n".join(failures))
        print(f"selftest-coddoc-settings: провалов {len(failures)} из {checks}; папка оставлена: {root.parent}")
        return 1
    shutil.rmtree(root.parent, ignore_errors=True)
    print(f"selftest-coddoc-settings: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
