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

    # 5.129: плоский файл 5.127 — байт в байт после правки без изменений.
    flat = ("# Дополнительные разделы: БТ\n\n## Метрики успеха\n- что писать: метрика, её значение сейчас и цель\n"
            "- вопрос: По какой метрике поймём, что доработка сработала, и какая у неё цель?\n\n## Согласование с ИБ\n"
            "- что писать: нужно ли согласование и кто его даёт\n- вопрос: Нужно ли согласование с ИБ и кто его даёт?\n")
    bt.write_bytes(flat.encode("utf-8"))
    code, out, last = run(repo, "edit", "bt", "--name", "Метрики успеха", "--what", "метрика, её значение сейчас и цель")
    expect(code == 0 and bt.read_bytes() == flat.encode("utf-8"), f"плоский файл байт в байт: {out}")
    code, out, last = run(repo, "show")
    expect("  ## Метрики успеха — что писать: метрика, её значение сейчас и цель · вопрос: По какой метрике" in out,
           f"show плоского: {out}")

    # Несколько вопросов: порядок сохраняется; edit --question заменяет все; каждый — с одним «?».
    code, out, last = run(repo, "add", "bt", "--name", "Риски ИБ", "--what", "риски и кто их снимает",
                          "--question", "Какие риски для ИБ?", "--question", "Кто их снимает?")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "sections=3" in last and text.endswith(
        "\n\n## Риски ИБ\n- что писать: риски и кто их снимает\n- вопрос: Какие риски для ИБ?\n- вопрос: Кто их снимает?\n"),
        f"add с двумя вопросами: {out}\n{text}")
    code, out, last = run(repo, "show")
    expect("· вопрос: Какие риски для ИБ? · вопрос: Кто их снимает?" in out, f"show двух вопросов: {out}")
    for asks, code_name, label in [
        (("Какие риски?", "Кто"), "question", "второй вопрос без «?»"),
        (("Какие риски?", " "), "empty", "второй вопрос пустой"),
    ]:
        args = [part for ask in asks for part in ("--question", ask)]
        code, out, last = run(repo, "add", "bt", "--name", "Ещё", "--what", "x", *args)
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"{label}: {out}")
    code, out, last = run(repo, "edit", "bt", "--name", "Риски ИБ", "--question", "Что с рисками?")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "- вопрос: Что с рисками?\n" in text and "Кто их снимает" not in text,
           f"edit --question заменяет все вопросы: {out}")

    # Подразделы: --parent заводит раздел, следующий подраздел — в конец раздела; формат файла.
    code, out, last = run(repo, "add", "bt", "--parent", "Наблюдаемость", "--name", "Логирование", "--what",
                          "что пишем", "--question", "Что пишем в журнал?")
    expect(code == 0 and "sections=4" in last, f"add --parent нового раздела: {out}")
    code, out, last = run(repo, "add", "bt", "--parent", "наблюдаемость", "--name", "Мониторинг", "--what", "алерты",
                          "--question", "Какие алерты заводим?", "--question", "Кто дежурит?")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "sections=4" in last and text.endswith(
        "\n\n## Наблюдаемость\n### Логирование\n- что писать: что пишем\n- вопрос: Что пишем в журнал?\n"
        "### Мониторинг\n- что писать: алерты\n- вопрос: Какие алерты заводим?\n- вопрос: Кто дежурит?\n"),
        f"формат подразделов: {out}\n{text}")
    code, out, last = run(repo, "show")
    expect("  ## Наблюдаемость\n    ### Логирование — что писать: что пишем · вопрос: Что пишем в журнал?"
           in out.replace("\r\n", "\n"),
           f"show подразделов: {out}")
    code, out, last = run(repo, "check")
    expect(code == 0 and last == "coddoc-settings: check ok", f"check с подразделами: {out}")

    # Отказы с подразделами; файл не меняется.
    before = bt.read_bytes()
    one = ("--what", "x", "--question", "Что?")
    for args, code_name, label in [
        (("add", "bt", "--parent", "Риски ИБ", "--name", "Х", *one), "mixed", "подраздел в раздел со своими полями"),
        (("add", "bt", "--parent", "Логирование", "--name", "Х", *one), "depth", "подраздел в подраздел"),
        (("add", "bt", "--name", "логирование", *one), "duplicate", "раздел с именем подраздела"),
        (("add", "bt", "--parent", "Наблюдаемость", "--name", "Риски ИБ", *one), "duplicate", "подраздел с именем раздела"),
        (("add", "bt", "--parent", "Наблюдаемость", "--name", "Сроки", *one), "base-name", "подраздел с базовым именем"),
        (("add", "bt", "--parent", "Приложения", "--name", "Х", *one), "base-name", "новый раздел с базовым именем"),
        (("edit", "bt", "--name", "Наблюдаемость", "--what", "x"), "mixed", "свои поля разделу с подразделами"),
        (("edit", "bt", "--name", "Мониторинг", "--new-name", "Риски ИБ"), "duplicate", "подраздел переименован в повтор"),
        (("edit", "bt", "--name", "Наблюдаемость", "--parent", "Х"), "usage", "edit не переносит подразделы"),
    ]:
        code, out, last = run(repo, *args)
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"{label}: {out}")
    expect(bt.read_bytes() == before, "после отказов с подразделами файл не изменился")

    # edit и remove подраздела; последний подраздел не убрать; раздел уходит вместе с подразделами.
    code, out, last = run(repo, "edit", "bt", "--name", "Мониторинг", "--new-name", "Алерты", "--question", "Какие алерты?")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "### Алерты\n- что писать: алерты\n- вопрос: Какие алерты?\n" in text
           and "Кто дежурит" not in text, f"edit подраздела: {out}")
    code, out, last = run(repo, "remove", "bt", "--name", "Логирование")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "sections=4" in last and "## Наблюдаемость\n### Алерты\n" in text and "Логирование" not in text,
           f"remove подраздела: {out}")
    code, out, last = run(repo, "remove", "bt", "--name", "Алерты")
    expect(code == 1 and last == "coddoc-settings: error empty" and "### Алерты" in bt.read_text(encoding="utf-8"),
           f"remove последнего подраздела: {out}")
    code, out, last = run(repo, "remove", "bt", "--name", "Наблюдаемость")
    expect(code == 0 and "sections=3" in last and "Алерты" not in bt.read_text(encoding="utf-8"),
           f"remove раздела с подразделами: {out}")

    # Несколько узлов одной командой: --dry-run показывает итоговый файл целиком и не пишет; --parent действует на все
    # следующие --name; голый --name — только раздел, который ниже стоит в --parent.
    before = bt.read_bytes()
    two = ("add", "bt", "--parent", "Согласования", "--name", "ИБ", "--what", "кто даёт", "--question", "Кто даёт?",
           "--name", "Юристы", "--what", "что проверяют", "--question", "Нужно ли?", "--question", "Что проверяют?")
    tail = ("\n\n## Согласования\n### ИБ\n- что писать: кто даёт\n- вопрос: Кто даёт?\n### Юристы\n"
            "- что писать: что проверяют\n- вопрос: Нужно ли?\n- вопрос: Что проверяют?\n")
    code, out, last = run(repo, *two, "--dry-run")
    expect(code == 0 and "sections=4" in last and tail.strip() in out.replace("\r\n", "\n") and bt.read_bytes() == before,
           f"два подраздела одной командой, --dry-run: {out}")
    code, out, last = run(repo, *two)
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "sections=4" in last and text.endswith(tail), f"два подраздела одной командой: {out}\n{text}")
    code, out, last = run(repo, "add", "bt", "--name", "Эксплуатация", "--parent", "Эксплуатация", "--name", "Поддержка",
                          "--what", "кто сопровождает", "--question", "Кто сопровождает?", "--name", "Обучение", "--what",
                          "кого учим", "--question", "Кого учим?")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "sections=5" in last and text.endswith(
        "\n\n## Эксплуатация\n### Поддержка\n- что писать: кто сопровождает\n- вопрос: Кто сопровождает?\n"
        "### Обучение\n- что писать: кого учим\n- вопрос: Кого учим?\n"), f"голый раздел и --parent на него: {out}\n{text}")
    code, out, last = run(repo, "add", "bt", "--name", "Запуск", "--what", "когда", "--question", "Когда запуск?",
                          "--name", "Откат", "--what", "как", "--question", "Как откатываем?")
    text = bt.read_text(encoding="utf-8")
    expect(code == 0 and "sections=7" in last and text.endswith(
        "\n\n## Запуск\n- что писать: когда\n- вопрос: Когда запуск?\n\n## Откат\n- что писать: как\n- вопрос: Как откатываем?\n"),
        f"два раздела одной командой: {out}\n{text}")
    before = bt.read_bytes()
    for args, code_name, label in [
        (("--what", "x", "--name", "А1", "--question", "Что?"), "usage", "--what до первого --name"),
        (("--name", "А1", "--what", "x", "--what", "y", "--question", "Что?"), "usage", "два --what у узла"),
        (("--name", "Голый", "--name", "А1", "--what", "x", "--question", "Что?"), "usage", "голый --name не родитель"),
        (("--name", "А1", "--what", "x", "--question", "Что?", "--name", "А2", "--what", "y", "--question", "Нет"),
         "question", "ошибка во втором узле"),
        (("--parent", "Новый", "--name", "А1", "--what", "x", "--question", "Что?", "--name", "Сроки", "--what", "y",
          "--question", "Что?"), "base-name", "базовое имя во втором узле"),
        (("--parent", "Р1", "--name", "П1", "--what", "x", "--question", "Что?", "--parent", "П1", "--name", "П2",
          "--what", "y", "--question", "Что?"), "depth", "подраздел в подраздел этой же команды"),
    ]:
        code, out, last = run(repo, "add", "bt", *args)
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"{label}: {out}")
    expect(bt.read_bytes() == before, "после отказов нескольких узлов файл не изменился — ни первый узел, ни родитель")

    # Ручная правка с подразделами: check ловит.
    for content, code_name, label in [
        ("# Дополнительные разделы: БТ\n\n### Свой\n- что писать: x\n- вопрос: Что?\n", "bad-file", "подраздел до раздела"),
        ("# Дополнительные разделы: БТ\n\n## Свой\n### Под\n#### Глубже\n- что писать: x\n- вопрос: Что?\n", "bad-file",
         "заголовок глубже «###»"),
        ("# Дополнительные разделы: БТ\n\n## Свой\n- что писать: x\n- вопрос: Что?\n### Под\n- что писать: y\n"
         "- вопрос: Где?\n", "mixed", "раздел и с полями, и с подразделами"),
        ("# Дополнительные разделы: БТ\n\n## Свой\n### Под\n- что писать: y\n", "bad-file", "у подраздела нет вопроса"),
    ]:
        bt.write_text(content, encoding="utf-8")
        code, out, last = run(repo, "check", "bt")
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"check, {label}: {out}")

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

    # Слежка за планом (work-plan следи): интервал из списка → строка cron; без файла — каждые 10 минут.
    watch = folder / "work-plan.md"
    bt.unlink()  # битый файл разделов от случаев выше
    code, out, last = run(repo, "show")
    expect(code == 0 and "слежка за планом: каждые 10 минут — по умолчанию" in out, f"show слежки без файла: {out}")
    code, out, last = run(repo, "watch", "--every", "15m", "--dry-run")
    expect(code == 0 and last.startswith("coddoc-settings: dry-run watch=15m path=") and last.endswith("/work-plan.md")
           and "расписание: */15 * * * *" in out and not watch.exists(), f"watch --dry-run: {out}")
    code, out, last = run(repo / "coddoc" / "AB-1", "watch", "--every", "15m")
    expect(code == 0 and last.startswith("coddoc-settings: ok watch=15m ") and watch.read_bytes() == (
        "# Слежка за планом работы\n\nслежка: каждые 15 минут\nрасписание: */15 * * * *\n").encode("utf-8"),
        f"watch из подпапки — в корень: {out}")
    code, out, last = run(repo, "show")
    expect(code == 0 and "слежка за планом: каждые 15 минут (" in out, f"show слежки: {out}")
    for args in (("check",), ("check", "watch")):
        code, out, last = run(repo, *args)
        expect(code == 0 and last == "coddoc-settings: check ok" and "слежка за планом: по форме" in out, f"{args}: {out}")
    for every, cron in [("5m", "*/5 * * * *"), ("10m", "*/10 * * * *"), ("20m", "*/20 * * * *"),
                        ("30m", "*/30 * * * *"), ("1h", "0 * * * *"), ("2h", "0 */2 * * *")]:
        code, out, last = run(repo, "watch", "--every", every, "--dry-run")
        expect(code == 0 and f"\nрасписание: {cron}\n" in out.replace("\r\n", "\n"), f"watch {every} → {cron}: {out}")
    before = watch.read_bytes()
    for args, code_name, label in [
        (("--every", "7m"), "every", "интервал не из списка"),
        (("--every", "3h"), "every", "часы не из списка"),
        ((), "every", "без --every"),
        (("--every",), "usage", "--every без значения"),
        (("--every", "15m", "--name", "x"), "usage", "чужой аргумент"),
    ]:
        code, out, last = run(repo, "watch", *args)
        expect(code == 1 and last == f"coddoc-settings: error {code_name}", f"watch, {label}: {out}")
    expect(watch.read_bytes() == before, "после отказов watch файл не изменился")
    watch.write_bytes("﻿# Слежка за планом работы\r\n\r\nслежка: каждый час\r\nрасписание: 0 * * * *\r\n".encode())
    code, out, last = run(repo, "check", "watch")
    expect(code == 0 and last == "coddoc-settings: check ok", f"check watch BOM/CRLF: {out}")
    for content, label in [
        ("# Слежка за планом работы\n\nслежка: каждые 15 минут\nрасписание: */10 * * * *\n", "пара разных интервалов"),
        ("# Слежка за планом работы\n\nрасписание: */7 * * * *\n", "свой cron руками"),
        ("слежка: каждые 15 минут\nрасписание: */15 * * * *\n", "нет заголовка"),
    ]:
        watch.write_text(content, encoding="utf-8")
        code, out, last = run(repo, "check")
        expect(code == 1 and last == "coddoc-settings: error bad-file", f"check watch, {label}: {out}")
    code, out, last = run(repo, "watch", "--every", "10m")
    expect(code == 0 and "расписание: */10 * * * *" in watch.read_text(encoding="utf-8"), f"watch поверх битого: {out}")

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
