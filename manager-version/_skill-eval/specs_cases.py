#!/usr/bin/env python3
"""Случаи стенда specs-quality: документы фикстуры SQ-AUDIT и точечные правки поверх них.

Документы фикстуры несут эталон из прогона sdd-quality-audit 1.4.0 (agent-version/_skill-eval/runs/
2026-10-28-sq-zero-sonnet, sonnet, 3 прогона): какие баллы встречались, подсвечен ли документ, шаблонно ли, не по
форме ли, происхождение спеки. Точечные случаи — та же фикстура с одной правкой и одним ожиданием.
"""

from __future__ import annotations

import os

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.normpath(os.path.join(HERE, "..", "..", "agent-version", "_skill-eval", "fixtures", "SQ-AUDIT", "coddoc"))

BT, SPEC = "business_requirements.md", "technical_specification.md"
NOT_PASSED, NO_SOURCE = "не передан", "нет документа сверху"


def read(rel):
    with open(os.path.join(FIXTURE, rel), encoding="utf-8") as handle:
        return handle.read().replace("\r\n", "\n")


def sub(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"правка случая: не найдено ровно один раз: {old[:60]!r}")
    return text.replace(old, new)


def cut(text, start, end, replacement):
    i, j = text.index(start), text.index(end)
    return text[:i] + replacement + text[j:]


# Эталон 1.4.0: баллы по шкале рубрики (как встречались), подсветка, шаблонно, не по форме, происхождение.
def ref(parts, attention, template=False, off_structure=False, origin=None):
    return {"parts": [tuple(p) for p in parts], "attention": attention, "template": template, "off_structure": off_structure,
            "origin": origin}


NA = "н/п"
REFERENCE = {
    "PSS-2210/" + BT: ref([(0.5, 1, 1, 1, 1)], False),
    "PSS-2210/" + SPEC: ref([(1, 1, 0.5, 1, 1)], False, origin="skill"),
    "PSS-2211/" + BT: ref([(0.5, 1, 1, 1, 1)], False),
    "PSS-2212/" + BT: ref([(0.5, 1, 0.5, 0.5, 1)], False),
    "PSS-2212/" + SPEC: ref([(1, 0.5, 0.5, 1, 1), (1, 0.5, 1, 1, 1)], False, origin="skill"),
    "PSS-2213/" + BT: ref([(0, 0, 0, 0, 0), (0, 0.5, 0.5, 0, 0)], True, template=True),
    "PSS-2213/" + SPEC: ref([(0, 0, 0, 0.5, 0)], True, template=True, origin="skill"),
    "PSS-2214/" + BT: ref([(0.5, 1, 1, 1, 1)], True, off_structure=True),
    "PSS-2214/" + SPEC: ref([(1, 1, 0.5, 1, 1)], False, origin="skill"),
    "PSS-2215/" + SPEC: ref([(0, 1, 0, 0.5, 0.5), (0, 1, 0, 1, 0.5)], True, off_structure=True, origin="by_code"),
    "PSS-2216/" + BT: ref([(0.5, 1, 1, 1, 1)], False),
    "PSS-2216/" + SPEC: ref([(1, 1, 0.5, 1, 1)], True, off_structure=True, origin="skill_edited"),
    "ARS-312/" + SPEC: ref([(1, NA, NA, 1, NA)], False, origin="skill"),
    "ARS-100/" + BT: ref([(0.25, 0.5, 1, 0, 1)], True, off_structure=True),
    "ARS-100/_foundation/" + SPEC: ref([(NA, 0, 0, 0, 0)], True, template=True, off_structure=True, origin="outside"),
    "ARS-100/ARS-101/" + BT: ref([(0, 0, 0, 0, 0)], True, template=True, off_structure=True),
    "ARS-100/ARS-101/" + SPEC: ref([(0, 0, 0, 0, 0)], True, template=True, off_structure=True, origin="outside"),
}

# Источник спеки — как в таблице шага 1.
SOURCES = {
    "PSS-2210/" + SPEC: "PSS-2210/" + BT, "PSS-2212/" + SPEC: "PSS-2212/" + BT, "PSS-2213/" + SPEC: "PSS-2213/" + BT,
    "PSS-2214/" + SPEC: "PSS-2214/" + BT, "PSS-2216/" + SPEC: "PSS-2216/" + BT, "PSS-2215/" + SPEC: NO_SOURCE,
    "ARS-312/" + SPEC: "ARS-312/bug_report.md", "ARS-100/_foundation/" + SPEC: NOT_PASSED,
    "ARS-100/ARS-101/" + SPEC: "ARS-100/ARS-101/" + BT,
}


# БТ с одним исполнителем на все действия — для случая «одна роль»: варианты отличаются только ролевой моделью,
# других действующих лиц в тексте нет (заказчик — подразделение, не исполнитель).
ONE_ACTOR_BT = """# Бизнес-требования: заметки к карточке прибора

> **Статус готовности:** Готово к оценке
> **Задача:** PSS-2290

## 1. Введение и контекст

### 1.0. Тип изменения
Новая функциональность в карточке прибора.

### 1.1. Описание проблемы (Problem Statement)
Наблюдения о приборе — «плавает показание после прогрева», «заедает кнопка» — записывают в бумажный журнал у
стенда. За квартал журнал потерялся дважды, а при поверке наблюдения по прибору найти не удаётся.

### 1.2. Конечные потребители (End Users)
Пользователи портала.

### 1.3. Заказчик и стейкхолдеры (Stakeholder / Sponsor)
Служба метрологии.

## 2. Бизнес-требования (цели и ценность)

### 2.1. Бизнес-цель
Наблюдения о приборе хранятся в его карточке, чтобы при поверке они были под рукой — сейчас их ищут по
бумажному журналу.

### 2.2. Ценность для бизнеса
В цехе 340 приборов; поиск наблюдений по журналу занимает около 15 минут на прибор при каждой поверке.

### 2.3. Бизнес-риски и меры по снижению (Mitigation)
Заметки могут дублировать друг друга. Мера — заметки показываются списком по дате, свежие сверху.

## 3. Объём проекта (Scope)

### 3.1. Входит в проект (In-scope)
Добавление заметки к прибору, просмотр заметок прибора, удаление своей заметки.

### 3.2. Не входит в проект (Out-of-scope)
Вложения к заметкам, поиск по тексту заметок.

### 3.3. Архитектурные изменения и интеграции
Заметки хранятся при карточке прибора; внешних интеграций нет.

## 4. Функциональные требования

### 4.1. Описание функционала / бизнес-процесса
- **FR-1.** Пользователь добавляет к карточке прибора заметку: текст до 500 символов, дата проставляется сама.
- **FR-2.** Пользователь видит заметки прибора списком, свежие сверху, с автором и датой.
- **FR-3.** Пользователь удаляет свою заметку; чужую удалить нельзя.

### 4.2. Критерии приёмки (Acceptance Criteria)
- **[FR-1]** Дано: открыта карточка прибора. Когда: пользователь сохраняет заметку из 120 символов. Тогда:
  заметка первой в списке, с его именем и сегодняшней датой.
- **[FR-2]** Дано: у прибора три заметки за разные дни. Когда: пользователь открывает карточку. Тогда: заметки
  идут от новой к старой.
- **[FR-3]** Дано: в списке своя и чужая заметка. Когда: пользователь удаляет обе. Тогда: своя удалена, у чужой
  кнопки удаления нет.

## 4.5. Разбиение на части
Не применимо: одна поставка.

## 5. Ограничения и атрибуты качества

### 5.1. Приоритет
Средний.

### 5.2. Сроки
До следующей плановой поверки цеха.

### 5.3. Ролевая модель
<РОЛИ>
"""


def case(name, kind, path, text, source=None, source_text=None, reference=None, expect=None):
    return {"name": name, "kind": kind, "path": path, "text": text, "source": source, "source_text": source_text,
            "reference": reference, "expect": expect}


def fixture_cases():
    out = []
    for rel, reference in REFERENCE.items():
        kind = "bt" if rel.endswith(BT) else "spec"
        source = SOURCES.get(rel)
        source_text = read(source) if source and source not in (NOT_PASSED, NO_SOURCE) else None
        name = rel.replace("/" + BT, "-bt").replace("/" + SPEC, "-spec").replace("/", "-")
        out.append(case(name, kind, "coddoc/" + rel, read(rel), source and (source if source in (NOT_PASSED, NO_SOURCE) else "coddoc/" + source),
                        source_text, reference=reference))
    return out


def point_cases():
    """Ожидание: (критерий или поле, значение). Для критериев — балл по шкале рубрики или «н/п»."""
    bug = read("ARS-312/bug_report.md")
    spec312 = read("ARS-312/" + SPEC)
    bt10 = read("PSS-2210/" + BT)
    spec10 = read("PSS-2210/" + SPEC)

    negation = sub(spec312, "Не применимо: баг не портит записи, в базе ничего неверного не сохраняется",
                   "Новых сущностей нет, существующие не меняются: баг не портит записи, в базе ничего неверного не сохраняется")
    negation = sub(negation, "### 3.3. Авторизация/доступ на бэке\nНе применимо: доступ не меняется.",
                   "### 3.3. Авторизация/доступ на бэке\nДоступ не меняется.")

    marker = "🔵 подтверждено аналитиком (не по коду; валидировать при интеграции)"
    marked = spec10.replace(marker, "🔵 подтверждено аналитиком (по коду staff-directory, ветка develop; валидировать при интеграции)", 1)
    marked = marked.replace(marker, "🔵 подтверждено аналитиком (по карточке services/notify-gw.md; валидировать при интеграции)", 1)

    named = ONE_ACTOR_BT.replace("<РОЛИ>", "Пользователь — метролог цеха; выполняет все действия.")
    bare = ONE_ACTOR_BT.replace("<РОЛИ>", "Пользователь.")

    # Одно противоречие: требование разрешает отзыв до решения, критерий приёмки отзывает согласованную заявку.
    contra_bt = sub(bt10, "- **[FR-3]** Дано: заявка со статусом «на согласовании». Когда: заявитель нажимает «отозвать».",
                    "- **[FR-3]** Дано: заявка со статусом «согласована». Когда: заявитель нажимает «отозвать».")
    # Одно противоречие с источником: спека разрешает отзыв согласованной заявки, БТ — только до решения.
    contra_spec = sub(spec10, "Переходы статуса: `submitted` → `approved`, `submitted` → `rejected`, `submitted` → `withdrawn`.\n"
                              "Из `approved`, `rejected` и `withdrawn` переходов нет — это конечные статусы.",
                      "Переходы статуса: `submitted` → `approved`, `submitted` → `rejected`, `submitted` → `withdrawn`,\n"
                      "`approved` → `withdrawn`. Из `rejected` и `withdrawn` переходов нет — это конечные статусы.")
    caught = (0, 0.5)  # противоречие замечено: одно (0.5) или модель насчитала больше (0)

    return [
        case("A-negation", "spec", "coddoc/ARS-312/" + SPEC, negation, "coddoc/ARS-312/bug_report.md", bug,
             expect=[("data_model", NA), ("security", NA)]),
        case("C-marker", "spec", "coddoc/PSS-2210/" + SPEC, marked, "coddoc/PSS-2210/" + BT, bt10,
             expect=[("origin", "skill"), ("code_signs", 0)]),
        case("D1-role-named", "bt", "coddoc/PSS-2290/" + BT, named, expect=[("actors", 1)]),
        case("D2-role-bare", "bt", "coddoc/PSS-2290/" + BT, bare, expect=[("actors", 0)]),
        case("F1-contra-bt", "bt", "coddoc/PSS-2210/" + BT, contra_bt, expect=[("consistency", caught)]),
        case("F2-contra-spec", "spec", "coddoc/PSS-2210/" + SPEC, contra_spec, "coddoc/PSS-2210/" + BT, bt10,
             expect=[("consistency", caught)]),
    ]


def zero_only_folder():
    """Случай E для прогона ведущего: хороший БТ без критериев приёмки (TBD), форма цела; спека — как у PSS-2210.
    Ждём: БТ подсвечен только нулём (78%), спека не подсвечена."""
    bt = cut(read("PSS-2210/" + BT), "### 4.2. Критерии приёмки (Acceptance Criteria)\n", "## 4.5. Разбиение на слайсы",
             "### 4.2. Критерии приёмки (Acceptance Criteria)\nTBD\n\n")
    return {BT: bt.replace("PSS-2210", "PSS-2290"), SPEC: read("PSS-2210/" + SPEC).replace("PSS-2210", "PSS-2290")}


def all_cases():
    return fixture_cases() + point_cases()


if __name__ == "__main__":
    for item in all_cases():
        print(item["name"], item["kind"], item["path"], len(item["text"]), item["source"] or "—")
