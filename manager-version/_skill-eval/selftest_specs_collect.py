#!/usr/bin/env python3
"""Самопроверка collect.py specs-quality: фикстура SQ-AUDIT и синтетические папки → известные строки и документы.

    python3 selftest_specs_collect.py

Проверяется: таблица шага 1 (источник спеки по соседям, баг-репорт, запрос на правку, фундамент, спека без
документа сверху, только баг-репорт — строки нет), stages/ и decomposition.md пропущены, ключ, автор и название из
шапки всех видов, вход папкой coddoc/, корнем, папкой фичи, файлом и ключом, ошибки входа, суффикс -2 у
повторного прогона, задания субагентам.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_NAME = os.environ.get("SQ_SKILL", "specs-quality")  # какой скилл гоняет стенд: specs-quality или specs-assess
sys.path.insert(0, os.path.join(HERE, "..", SKILL_NAME, "reference"))
sys.path.insert(0, HERE)
import collect  # noqa: E402
import specs_cases  # noqa: E402

TODAY = "2026-10-28"
failures = []
checks = 0


def check(name, condition, detail=""):
    global checks
    checks += 1
    if not condition:
        failures.append(f"{name}: {detail}")


def write(root, rel, text):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def fixture_repo(base):
    root = os.path.join(base, "repo-fixture")
    shutil.copytree(specs_cases.FIXTURE, os.path.join(root, "coddoc"))
    os.makedirs(os.path.join(root, ".git"))  # корень итога — корень репозитория
    return root


def rows_by_folder(data):
    return {row["folder"]: row for row in data["rows"]}


def docs_by_path(data):
    return {doc["path"]: doc for doc in data["documents"]}


def fixture_checks(base):
    root = fixture_repo(base)
    data = collect.collect("coddoc/", root, repo="pss", today=TODAY)
    rows, docs = rows_by_folder(data), docs_by_path(data)
    check("фикстура: строк", len(rows) == 11, sorted(rows))
    check("фикстура: документов", len(docs) == 17, len(docs))
    expected_bt = {"coddoc/PSS-2215": {"none": "absent"}, "coddoc/ARS-312": {"none": "bug_report"},
                   "coddoc/ARS-100/_foundation": {"none": "foundation"}}
    for folder, cell in expected_bt.items():
        check(f"фикстура: колонка БТ {folder}", rows.get(folder, {}).get("bt") == cell, rows.get(folder))
    check("фикстура: спеки нет у PSS-2211 и эпика", rows["coddoc/PSS-2211"]["spec"] == {"none": "absent"} and
          rows["coddoc/ARS-100"]["spec"] == {"none": "absent"}, (rows["coddoc/PSS-2211"], rows["coddoc/ARS-100"]))
    sources = {path: doc["source"] for path, doc in docs.items() if doc["kind"] == "spec"}
    check("фикстура: источник спеки по БТ", sources["coddoc/PSS-2210/technical_specification.md"] ==
          {"kind": "bt", "path": "coddoc/PSS-2210/business_requirements.md"}, sources["coddoc/PSS-2210/technical_specification.md"])
    check("фикстура: источник багфикса", sources["coddoc/ARS-312/technical_specification.md"] ==
          {"kind": "bug_report", "path": "coddoc/ARS-312/bug_report.md"}, sources["coddoc/ARS-312/technical_specification.md"])
    check("фикстура: источник фундамента", sources["coddoc/ARS-100/_foundation/technical_specification.md"] ==
          {"kind": "not_passed", "path": None}, sources["coddoc/ARS-100/_foundation/technical_specification.md"])
    check("фикстура: спека без документа сверху", sources["coddoc/PSS-2215/technical_specification.md"] ==
          {"kind": "none", "path": None}, sources["coddoc/PSS-2215/technical_specification.md"])
    check("фикстура: decomposition.md не документ", not any("decomposition" in p for p in docs), sorted(docs))
    keys = {folder: row["key"] for folder, row in rows.items()}
    check("фикстура: ключ «Задача Jira/SberTrack»", keys["coddoc/PSS-2211"] == "PSS-2211", keys["coddoc/PSS-2211"])
    check("фикстура: ключ «Задача:» без оформления", keys["coddoc/PSS-2214"] == "PSS-2214", keys["coddoc/PSS-2214"])
    check("фикстура: ключ фундамента — папка эпика", keys["coddoc/ARS-100/_foundation"] == "ARS-100", keys["coddoc/ARS-100/_foundation"])
    check("фикстура: ключ без шапки — папка", keys["coddoc/ARS-100/ARS-101"] == "ARS-101", keys["coddoc/ARS-100/ARS-101"])
    check("фикстура: ключ багфикса из frontmatter", keys["coddoc/ARS-312"] == "ARS-312", keys["coddoc/ARS-312"])
    check("фикстура: автор из шапки", docs["coddoc/PSS-2211/business_requirements.md"]["author"] == "ivanova.ma" and
          docs["coddoc/PSS-2214/business_requirements.md"]["author"] == "ivanova.ma", "")
    check("фикстура: автора нет — null", docs["coddoc/PSS-2210/business_requirements.md"]["author"] is None, "")
    check("фикстура: название без «Бизнес-требования:»", rows["coddoc/PSS-2210"]["feature"] == "заявка на разовый пропуск для посетителя",
          rows["coddoc/PSS-2210"]["feature"])
    check("фикстура: название без приставки", rows["coddoc/PSS-2214"]["feature"] == "Заявка на разовый пропуск для посетителя",
          rows["coddoc/PSS-2214"]["feature"])
    check("фикстура: название по спеке, если БТ нет", rows["coddoc/PSS-2215"]["feature"] == "PSS-2215 — Техническое решение",
          rows["coddoc/PSS-2215"]["feature"])
    check("фикстура: работа в корне, итог — рядом с документом", data["work"] == os.path.join(root, f"{SKILL_NAME}-{TODAY}.work") and
          all(d["output"] == d["path"][:-len(".md")] + ".quality.json" for d in data["documents"]),
          (data["work"], [d["output"] for d in data["documents"]][:2]))
    tasks = sorted(f for f in os.listdir(data["work"]) if f.endswith(".task.txt"))
    check("фикстура: задание на документ", len(tasks) == 17, len(tasks))
    spec_task = next(d for d in data["documents"] if d["path"].endswith("PSS-2215/technical_specification.md"))["task"]
    with open(os.path.join(data["work"], spec_task), encoding="utf-8") as handle:
        text = handle.read()
    check("фикстура: задание — рубрика, файл, источник", "rubric-spec.md" in text and "PSS-2215" in text and
          "Источник требований: нет документа сверху." in text and "JSON" in text and "без текста до и после" in text and
          (SKILL_NAME != "specs-assess" or "complexity-spec.md" in text), text)
    with open(os.path.join(data["work"], "collect.json"), encoding="utf-8") as handle:
        saved = json.load(handle)
    check("фикстура: collect.json", saved["repo"] == "pss" and "team" not in saved and len(saved["documents"]) == 17, "")
    check("фикстура: documents_dir — папка поиска от корня", saved["documents_dir"] == "coddoc", saved["documents_dir"])
    check("фикстура: в coddoc ничего не создано", sorted(os.listdir(os.path.join(root, "coddoc"))) == sorted(os.listdir(specs_cases.FIXTURE)), "")

    again = collect.collect("coddoc/", root, today=TODAY)
    check("повтор: суффикс -2", again["work"].endswith(f"{SKILL_NAME}-{TODAY}-2.work"), again["work"])

    by_root = collect.collect(root, base, today="2026-10-29")
    check("вход корнем репо", len(by_root["rows"]) == 11 and by_root["documents_dir"] == "." and
          by_root["work"] == os.path.join(root, SKILL_NAME + "-2026-10-29.work"), (len(by_root["rows"]), by_root["documents_dir"]))
    feature = collect.collect(os.path.join(root, "coddoc", "ARS-100"), base, today="2026-10-30")
    check("вход папкой эпика — с детьми и фундаментом", sorted(rows_by_folder(feature)) ==
          ["coddoc/ARS-100", "coddoc/ARS-100/ARS-101", "coddoc/ARS-100/_foundation"], sorted(rows_by_folder(feature)))
    single = collect.collect(os.path.join(root, "coddoc", "PSS-2210", "business_requirements.md"), base, today="2026-10-31")
    check("вход файлом — только он", sorted(rows_by_folder(single)) == ["coddoc/PSS-2210"] and
          [d["path"] for d in single["documents"]] == ["coddoc/PSS-2210/business_requirements.md"] and
          single["documents_dir"] == "coddoc/PSS-2210", ([d["path"] for d in single["documents"]], single["documents_dir"]))
    spec_only = collect.collect(os.path.join(root, "coddoc", "PSS-2210", "technical_specification.md"), base, today="2026-11-02")
    check("вход файлом спеки — БТ рядом остаётся источником", [d["path"] for d in spec_only["documents"]] ==
          ["coddoc/PSS-2210/technical_specification.md"] and spec_only["documents"][0]["source"] ==
          {"kind": "bt", "path": "coddoc/PSS-2210/business_requirements.md"}, spec_only["documents"])
    keyed = collect.collect("ARS-101", root, today="2026-11-01")
    check("вход ключом ребёнка эпика", sorted(rows_by_folder(keyed)) == ["coddoc/ARS-100/ARS-101"], sorted(rows_by_folder(keyed)))
    check("вход папкой фичи — работа в корне репо", feature["work"] == os.path.join(root, SKILL_NAME + "-2026-10-30.work"), feature["work"])


def any_folder_checks(base):
    """Папка с документами — любая: имя не важно; без git итог рядом со входом; скрытые папки не сканируются."""
    repo = os.path.join(base, "repo-any")
    shutil.copytree(os.path.join(specs_cases.FIXTURE, "PSS-2210"), os.path.join(repo, "specs", "PSS-2210"))
    shutil.copytree(os.path.join(specs_cases.FIXTURE, "PSS-2210"), os.path.join(repo, ".claude", "worktrees", "x", "specs", "PSS-2210"))
    os.makedirs(os.path.join(repo, ".git"))
    data = collect.collect("specs", repo, today="2026-10-28")
    check("любая папка: документы найдены", sorted(rows_by_folder(data)) == ["specs/PSS-2210"] and len(data["documents"]) == 2,
          sorted(rows_by_folder(data)))
    check("любая папка: работа в корне репо", data["work"] == os.path.join(repo, SKILL_NAME + "-2026-10-28.work") and
          data["documents_dir"] == "specs", (data["work"], data["documents_dir"]))
    whole = collect.collect(repo, base, today="2026-10-29")
    check("скрытая папка с копией не сканируется", sorted(rows_by_folder(whole)) == ["specs/PSS-2210"], sorted(rows_by_folder(whole)))

    loose = os.path.join(base, "no-git", "docs")
    shutil.copytree(os.path.join(specs_cases.FIXTURE, "ARS-312"), os.path.join(loose, "ARS-312"))
    alone = collect.collect(loose, base, today="2026-10-28")
    check("без git: работа рядом с папкой входа, не внутри", alone["work"] == os.path.join(base, "no-git", SKILL_NAME + "-2026-10-28.work") and
          sorted(rows_by_folder(alone)) == ["docs/ARS-312"], (alone["work"], sorted(rows_by_folder(alone))))


def synthetic_checks(base):
    root = os.path.join(base, "repo-synthetic")
    os.makedirs(os.path.join(root, ".git"))
    spec = "# Техническая спецификация: правка\n\n> **Задача:** SYN-{n}\n> **Автор:** petrov, sidorova\n\n## 1. Обзор\n"
    write(root, "coddoc/SYN-1/bug_report.md", "---\ntype: bug-report\ntask: SYN-1\n---\n\n# Баг\n")
    write(root, "coddoc/SYN-2/change_request.md", "# Запрос на правку\n\n> **Задача:** SYN-2\n")
    write(root, "coddoc/SYN-2/technical_specification.md", spec.format(n=2))
    write(root, "coddoc/SYN-3/business_requirements.md", "# Бизнес-требования: x\n\n> **Задача:** SYN-3\n> **Автор:** —\n")
    write(root, "coddoc/SYN-3/bug_report.md", "# Баг\n")
    write(root, "coddoc/SYN-3/technical_specification.md", spec.format(n=3))
    write(root, "coddoc/SYN-3/stages/technical_specification.md", spec.format(n=3))
    write(root, "coddoc/SYN-4/_foundation/business_requirements.md", "# Бизнес-требования: лишний\n")
    write(root, "coddoc/SYN-4/_foundation/technical_specification.md", "# Техническая спецификация: фундамент\n")
    write(root, "coddoc/SYN-5/technical_specification.md", "# Техническая спецификация: [название задачи]\n\n> **Задача:** [номер задачи — напр. ARS-123]\n")
    data = collect.collect("coddoc", root, today=TODAY)
    rows, docs = rows_by_folder(data), docs_by_path(data)
    check("только баг-репорт — строки нет", "coddoc/SYN-1" not in rows, sorted(rows))
    check("только баг-репорт — в «не оцениваются»", "coddoc/SYN-1/bug_report.md" in data["skipped"], data["skipped"])
    check("запрос на правку — источник спеки", rows["coddoc/SYN-2"]["bt"] == {"none": "change_request"} and
          docs["coddoc/SYN-2/technical_specification.md"]["source"] == {"kind": "change_request", "path": "coddoc/SYN-2/change_request.md"}, "")
    check("БТ и баг-репорт — источник БТ", docs["coddoc/SYN-3/technical_specification.md"]["source"]["kind"] == "bt", "")
    check("stages/ пропущена", not any("stages" in p for p in docs) and "coddoc/SYN-3/stages/technical_specification.md" in data["skipped"],
          data["skipped"])
    check("автор «—» — null", docs["coddoc/SYN-3/business_requirements.md"]["author"] is None, "")
    check("автор списком — как есть", docs["coddoc/SYN-2/technical_specification.md"]["author"] == "petrov, sidorova", "")
    check("БТ в _foundation не оценивается", "coddoc/SYN-4/_foundation/business_requirements.md" not in docs and
          rows["coddoc/SYN-4/_foundation"]["bt"] == {"none": "foundation"}, "")
    check("заглушка шаблона — не ключ и не название", rows["coddoc/SYN-5"]["key"] == "SYN-5" and
          rows["coddoc/SYN-5"]["feature"] == "[название задачи]", rows["coddoc/SYN-5"])

    for name, raw, piece in (("ссылка", "https://git.example/repo", "нужен путь к локальному клону"),
                             ("пусто", "  ", "Не передан путь"), ("нет пути", "coddoc/NOPE/x.md", "Нет такого пути"),
                             ("чужой файл", "coddoc/SYN-1/notes.txt", "не БТ"), ("ключа нет", "SYN-9", "Папки SYN-9"),
                             ("баг-репорт файлом", "coddoc/SYN-1/bug_report.md", "не БТ и не спека")):
        if name == "чужой файл":
            write(root, "coddoc/SYN-1/notes.txt", "x")
        try:
            collect.collect(raw, root, today="2026-12-01")
            failures.append(f"вход «{name}»: ждали ошибку «{piece}», получили успех")
        except collect.InputError as error:
            check(f"вход «{name}»", piece in str(error), str(error))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    base = tempfile.mkdtemp(prefix="specs-collect-")
    try:
        fixture_checks(base)
        any_folder_checks(base)
        synthetic_checks(base)
    finally:
        shutil.rmtree(base, ignore_errors=True)
    if failures:
        print("\n".join(failures))
        print(f"selftest collect: провалов {len(failures)} из {checks}")
        return 1
    print(f"selftest collect: {checks}/{checks}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
