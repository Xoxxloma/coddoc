#!/usr/bin/env python3
"""collect — первый шаг оценки: найти БТ и спеки, собрать строки, прочитать шапки, написать задания субагентам.

    python3 collect.py --input <папка с документами | файл | ключ> [--repo <репозиторий>] [--params <файл>]

Документы ищутся во всей вложенности входа; скрытые папки, stages/ и node_modules пропускаются; вход файлом — только
этот документ. Корень — ближайшая папка с .git выше по пути входа; репозитория нет — папка, где лежит вход. Пишет
<корень>/specs-quality-<дата>.work/ (занято — -2, -3): collect.json (строки, документы, источники, шапка) и по
заданию на документ — <id>.task.txt. Итог merge запишет рядом с каждым документом — <имя>.quality.json. На экран —
список строк с источником каждой спеки и путь рабочей папки. В папке документов collect ничего не пишет.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # соседние модули находятся и при `python -I`

import params  # noqa: E402
RUBRICS = {"bt": os.path.join(HERE, "rubric-bt.md"), "spec": os.path.join(HERE, "rubric-spec.md")}
BT, SPEC, BUG, CR = "business_requirements.md", "technical_specification.md", "bug_report.md", "change_request.md"
NAMES = (BT, SPEC, BUG, CR)
SKIP_DIRS = {"stages", "node_modules"}  # и все скрытые: .git, .claude с копиями ворктри
FOUNDATION = "_foundation"
TITLE_PREFIXES = ("бизнес-требования:", "техническая спецификация:")
KEY_RE = re.compile(r"\b[A-Z][A-Z0-9_]*-\d+\b")
EMPTY = {"", "—", "-", "–"}
SOURCE_LABELS = {"not_passed": "не передан", "none": "нет документа сверху"}
ROW_LABELS = {"bug_report": "н/п: баг-репорт", "change_request": "н/п: запрос на правку", "foundation": "н/п: узел-фундамент",
              "absent": "нет"}


class InputError(ValueError):
    pass


# ---------------------------------------------------------------- шапка документа


def read_text(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read().replace("\r\n", "\n")


def header(text):
    """Ключ задачи, автор и название из шапки: строки до первого «## » и YAML-frontmatter в начале."""
    lines = text.split("\n")
    fields = {}
    if lines and lines[0].strip() == "---":
        for number in range(1, min(len(lines), 40)):
            line = lines[number].strip()
            if line == "---":
                lines = lines[number + 1:]
                break
            match = re.match(r"^(task|author|title)\s*:\s*(.*)$", line)
            if match:
                fields.setdefault(match.group(1), match.group(2).strip().strip("\"'"))
    title = None
    for line in lines:
        if line.startswith("## "):
            break
        if title is None and line.startswith("# "):
            title = line[2:].strip()
            for prefix in TITLE_PREFIXES:
                if title.lower().startswith(prefix):
                    title = title[len(prefix):].strip()
            continue
        plain = line.strip().lstrip(">").strip().replace("**", "")
        match = re.match(r"^Задача(?:\s[^:]*)?:\s*(.*)$", plain)
        if match:
            fields.setdefault("task", match.group(1).strip())
        match = re.match(r"^Автор\s*:\s*(.*)$", plain)
        if match:
            fields.setdefault("author", match.group(1).strip())
    if "title" in fields and not title:
        title = fields["title"]
    task = fields.get("task", "").strip()
    if task in EMPTY or task.startswith("["):  # «[номер задачи — напр. ARS-123]» — заглушка шаблона, не ключ
        task = None
    else:
        found = KEY_RE.search(task)
        task = found.group(0) if found else task
    author = fields.get("author", "").strip()
    author = None if author in EMPTY or author.startswith("[") else author
    return {"task": task, "author": author, "title": title or None}


# ---------------------------------------------------------------- вход и поиск


def git_root(path):
    """Ближайшая папка с .git выше по пути (или сама папка); нет — None."""
    probe = os.path.abspath(path)
    while True:
        if os.path.exists(os.path.join(probe, ".git")):
            return probe
        parent = os.path.dirname(probe)
        if parent == probe:
            return None
        probe = parent


def root_for(scope):
    """Куда класть итог: корень репозитория; без репозитория — рядом с папкой входа, а не внутри неё."""
    return git_root(scope) or os.path.dirname(scope)


def skipped(name):
    return name in SKIP_DIRS or name.startswith(".")


def resolve_input(raw, cwd):
    """→ (корень, папка поиска, рекурсивно ли, имя файла — если вход один документ)."""
    if not raw or not raw.strip():
        raise InputError("Не передан путь: нужна папка с документами, файл или ключ задачи.")
    raw = raw.strip()
    if re.match(r"^[a-z]+://", raw):
        raise InputError("Ссылку открыть нельзя — нужен путь к локальному клону репозитория.")
    path = os.path.abspath(raw if os.path.isabs(raw) else os.path.join(cwd, raw))
    if os.path.isfile(path):
        if os.path.basename(path) not in (BT, SPEC):
            raise InputError(f"Файл {raw} — не БТ и не спека: оцениваются {BT} и {SPEC}.")
        scope = os.path.dirname(path)
        return root_for(scope), scope, False, os.path.basename(path)
    if os.path.isdir(path):
        return root_for(path), path, True, None
    if KEY_RE.fullmatch(raw) or re.fullmatch(r"[A-Za-z][\w-]*", raw):
        base = git_root(cwd) or os.path.abspath(cwd)
        hits = []
        for folder, dirs, _ in os.walk(base):
            dirs[:] = [d for d in dirs if not skipped(d)]
            hits += [os.path.join(folder, d) for d in dirs if d == raw]
        if not hits:
            raise InputError(f"Папки {raw} в {base} нет.")
        if len(hits) > 1:
            raise InputError(f"Папок {raw} несколько: " + ", ".join(rel(base, d) for d in hits) + " — передай путь.")
        return root_for(hits[0]), hits[0], True, None
    raise InputError(f"Нет такого пути: {raw}")


def rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def scan(scope, recursive):
    """Папки с любым из четырёх файлов → {папка: набор имён}; stages/ — в «не оцениваются», скрытые и node_modules — мимо."""
    found, ignored = {}, []
    walker = os.walk(scope) if recursive else [(scope, [], os.listdir(scope))]
    for folder, dirs, files in walker:
        if recursive:
            for name in sorted(dirs):
                if name == "stages":
                    for sub, _, sub_files in os.walk(os.path.join(folder, name)):
                        ignored += [os.path.join(sub, f) for f in sub_files if f in NAMES]
            dirs[:] = sorted(d for d in dirs if not skipped(d))
        names = {f for f in files if f in NAMES and os.path.isfile(os.path.join(folder, f))}
        if names:
            found[folder] = names
    return found, ignored


# ---------------------------------------------------------------- строки и документы


def build(root, found, ignored):
    rows, documents, skipped = [], [], [rel(root, path) for path in ignored]
    for folder in sorted(found, key=lambda f: rel(root, f)):
        names = found[folder]
        folder_rel = rel(root, folder)
        foundation = os.path.basename(folder) == FOUNDATION
        has_bt, has_spec = BT in names and not foundation, SPEC in names
        if foundation and BT in names:
            skipped.append(f"{folder_rel}/{BT}")
        if not has_bt and not has_spec:
            skipped += [f"{folder_rel}/{name}" for name in sorted(names)]  # только баг-репорт или запрос: оценивать нечего
            continue
        heads = {name: header(read_text(os.path.join(folder, name))) for name in names}

        bt_cell, source = None, None
        if has_bt:
            bt_cell = {"document": f"{folder_rel}/{BT}"}
            source = {"kind": "bt", "path": f"{folder_rel}/{BT}"}
        elif foundation:
            bt_cell, source = {"none": "foundation"}, {"kind": "not_passed", "path": None}
        elif BUG in names:
            bt_cell, source = {"none": "bug_report"}, {"kind": "bug_report", "path": f"{folder_rel}/{BUG}"}
        elif CR in names:
            bt_cell, source = {"none": "change_request"}, {"kind": "change_request", "path": f"{folder_rel}/{CR}"}
        else:
            bt_cell, source = {"none": "absent"}, {"kind": "none", "path": None}
        spec_cell = {"document": f"{folder_rel}/{SPEC}"} if has_spec else {"none": "absent"}

        order = [BT, SPEC, BUG, CR]
        task = next((heads[n]["task"] for n in order if n in heads and heads[n]["task"]), None)
        if task is None:
            task = os.path.basename(os.path.dirname(folder)) if foundation else os.path.basename(folder)
        feature = next((heads[n]["title"] for n in (BT, SPEC) if n in heads and heads[n]["title"]), None)
        rows.append({"folder": folder_rel, "key": task, "feature": feature, "bt": bt_cell, "spec": spec_cell})

        for kind, name, doc_source in (("bt", BT, None), ("spec", SPEC, source)):
            if (kind == "bt" and not has_bt) or (kind == "spec" and not has_spec):
                continue
            number = len(documents) + 1
            doc_id = f"{number:02d}-{re.sub(r'[^A-Za-z0-9_-]+', '_', task)}-{kind}"
            documents.append({"id": doc_id, "path": f"{folder_rel}/{name}", "kind": kind,
                              "author": heads[name]["author"], "title": heads[name]["title"], "source": doc_source,
                              "task": f"{doc_id}.task.txt", "answer": f"{doc_id}.findings.txt",
                              "output": f"{folder_rel}/{name[:-len('.md')]}.quality.json"})
    return rows, documents, skipped


def task_text(root, document):
    path = os.path.join(root, document["path"])
    lines = [f"Прочитай рубрику по пути {RUBRICS[document['kind']]} и оцени по ней файл {path}."]
    if document["kind"] == "spec":
        source = document["source"]
        where = os.path.join(root, source["path"]) if source["path"] else SOURCE_LABELS[source["kind"]]
        lines.append(f"Источник требований: {where}.")
    lines += ["", "Ответ — только JSON по форме из раздела «Что вернуть» рубрики, без текста до и после.",
              "Ничего не правь и не создавай файлов."]
    return "\n".join(lines) + "\n"


def work_path(root, today):
    """Рабочая папка прогона; занята — следующий номер."""
    number = 1
    while True:
        work = os.path.join(root, f"specs-quality-{today}" + ("" if number == 1 else f"-{number}") + ".work")
        if not os.path.exists(work):
            return work
        number += 1


def describe(rows, documents):
    by_path = {doc["path"]: doc for doc in documents}
    lines = []
    for row in rows:
        if "document" in row["bt"]:
            bt = "БТ" if row["bt"]["document"] in by_path else "БТ не на входе"
        else:
            bt = ROW_LABELS[row["bt"]["none"]]
        if "document" in row["spec"] and row["spec"]["document"] not in by_path:
            spec = "спека не на входе"
        elif "document" in row["spec"]:
            source = by_path[row["spec"]["document"]]["source"]
            where = source["path"].rsplit("/", 1)[-1] if source["path"] else SOURCE_LABELS[source["kind"]]
            spec = f"спека ← {where}"
        else:
            spec = "спеки нет"
        lines.append(f"- {row['folder']} ({row['key']}): {bt}; {spec}")
    return lines


def collect(raw_input, cwd, repo=None, params_path=None, today=None):
    params.load(params_path)  # битые параметры — остановка до работы
    root, scope, recursive, only = resolve_input(raw_input, cwd)
    found, ignored = scan(scope, recursive)
    rows, documents, skipped = build(root, found, ignored)
    if only:  # вход файлом — оценивается только он; соседние файлы папки нужны только как документ сверху
        documents = [document for document in documents if document["path"].endswith("/" + only) or document["path"] == only]
    work = work_path(root, today or date.today().isoformat())
    os.makedirs(work)
    for document in documents:
        with open(os.path.join(work, document["task"]), "w", encoding="utf-8", newline="\n") as handle:
            handle.write(task_text(root, document))
    data = {"schema": "specs-quality/collect/2", "input": raw_input, "documents_dir": rel(root, scope), "root": root,
            "work": work, "repo": repo or None,
            "params": os.path.abspath(params_path) if params_path else params.DEFAULT_PATH,
            "rubrics": RUBRICS, "rows": rows, "documents": documents, "skipped": skipped}
    with open(os.path.join(work, "collect.json"), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=1)
    return data


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--input", required=True)
    parser.add_argument("--repo")
    parser.add_argument("--params")
    args = parser.parse_args(argv)
    try:
        data = collect(args.input, os.getcwd(), args.repo, args.params)
    except (InputError, params.ParamsError) as error:
        print(error)
        return 2
    documents = data["documents"]
    bt_count = sum(1 for doc in documents if doc["kind"] == "bt")
    print(f"Корень: {data['root']}")
    print(f"Строк: {len(data['rows'])}, документов: {len(documents)} (БТ {bt_count}, спек {len(documents) - bt_count})")
    print("\n".join(describe(data["rows"], documents)))
    if data["skipped"]:
        print("Не оцениваются: " + ", ".join(data["skipped"]))
    print(f"Работа: {data['work']}")
    print("Итоги: рядом с каждым документом — <имя>.quality.json")
    if not documents:
        print("Документов: 0 — оценивать нечего.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
