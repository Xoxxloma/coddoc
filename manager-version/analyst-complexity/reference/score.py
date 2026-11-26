#!/usr/bin/env python3
"""score — класс сложности по выписке агента и строка результата документа.

    python score.py bt|spec <документ> <выписка.json>

Выписка — JSON, который агент вернул по заданию из prompts.py. Пункт засчитывается, если его цитата есть в своём
тексте документа или в его файлах задачи (document.py), дословно или с ошибкой в окончании слова (см. Quotes). Цитата не нашлась — пункт отброшен; нашлась только
в унаследованном от родителя эпика — пункт засчитан родителю. Повторы склеиваются. Дальше — шкала (scale.py).

Спека багфикса или мелкой правки получает класс 1 без подсчёта признаков, если в запросе на правку не записано,
что объём выше порога. Долг — число открытых пунктов, в класс он не входит.

Строка результата: листы, класс, долг, иллюстрации, версия шаблона и пометки; ниже — признаки и баллы.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # соседние модули находятся и при `python -I`
import document  # noqa: E402
import scale  # noqa: E402
import sheets  # noqa: E402

SIMPLIFIED_TYPES = ("багфикс", "мелкая правка")  # типы изменения, которые методика не считает по признакам
CHANGE_REQUEST = "change_request.md"


def normalize(text: str) -> str:
    text = sheets.TEXT_LINK.sub(r"\1", text)
    text = text.replace(" ", " ").replace("**", "").replace("`", "").replace("~~", "")
    return re.sub(r"\s+", " ", text).strip().lower()


class Quotes:
    """Сверка цитат: настоящая ли цитата и засчитывать ли её этому документу.

    Цитата настоящая, если она есть в тексте дословно или, когда она не короче QUOTE_MIN_FUZZY знаков, если не меньше
    QUOTE_MATCH_SHARE её длины совпадает с одной строкой текста одним куском: модель изредка ошибается в окончании
    слова, а выдуманная цитата с документом так не совпадёт.
    """

    QUOTE_MIN_FUZZY = 20
    QUOTE_MATCH_SHARE = 0.85

    def __init__(self, path: str, kind: str):
        lines = document.read_lines(path)
        own = document.own_lines(path, kind, lines)
        task_lines = [line for file in document.task_files(path, own) for line in document.read_lines(file)]
        self.full_lines = [normalize(line) for line in lines + task_lines]
        self.own_lines = [normalize(line) for line in own + task_lines]
        self.full_text = normalize("\n".join(lines)) + " " + normalize("\n".join(task_lines))
        self.own_text = normalize("\n".join(own)) + " " + normalize("\n".join(task_lines))
        self.missing = 0
        self.inherited = 0

    def present(self, part: str, text: str, lines: list[str]) -> bool:
        if part in text:
            return True
        if len(part) < self.QUOTE_MIN_FUZZY:
            return False
        need = self.QUOTE_MATCH_SHARE * len(part)
        return any(SequenceMatcher(None, part, line, autojunk=False).find_longest_match(0, len(part), 0, len(line)).size
                   >= need for line in lines if len(line) >= need)

    @staticmethod
    def parts(item: dict) -> list[str]:
        """Цитата по ячейкам таблицы: агент может склеить ячейки через «|». Знак препинания в конце не сверяется."""
        parts = (normalize(part).rstrip(" .,;:") for part in str(item.get("quote") or "").split("|"))
        return [part for part in parts if part]

    def counts(self, item) -> bool:
        parts = self.parts(item) if isinstance(item, dict) else []
        if not parts or not all(self.present(part, self.full_text, self.full_lines) for part in parts):
            self.missing += 1
            return False
        if not all(self.present(part, self.own_text, self.own_lines) for part in parts):
            self.inherited += 1
            return False
        return True

    def distinct(self, items, key=None) -> list[dict]:
        """Засчитанные пункты без повторов. Пункт отличается от другого по key, иначе по имени, а без имени — по
        цитате: у нескольких пунктов одной строки цитата бывает общей."""
        seen, kept = set(), []
        for item in items if isinstance(items, list) else []:
            if not self.counts(item):
                continue
            name = normalize(str(item.get("name") or ""))
            identity = key(item) if key else (name or "|".join(self.parts(item)))
            if identity not in seen:
                seen.add(identity)
                kept.append(item)
        return kept

    def flag(self, value) -> bool:
        """Проверка «да / нет»: «да» засчитывается только с найденной цитатой."""
        return (isinstance(value, dict) and value.get("yes", value.get("needed")) is True and self.counts(value))


@dataclass
class Result:
    name: str
    kind: str
    volume: sheets.Volume
    features: list[tuple[str, str, object, int]] = field(default_factory=list)  # код, название, значение, балл
    total: int = 0
    complexity_class: int = 1
    debt: int = 0
    template: str | None = None
    notes: list[str] = field(default_factory=list)

    def line(self) -> str:
        sheets_text = f"{self.volume.sheets:.1f}".replace(".", ",")
        template = f"шаблон {self.template}" if self.template else "версия шаблона не указана"
        return (f"{self.name}: {sheets_text} листа, класс {self.complexity_class}, долг {self.debt}, "
                f"иллюстраций {self.volume.illustrations}, {template}" + "".join(f"; {note}" for note in self.notes))


def contract_key(item: dict) -> str:
    """Один стык — один раз: метод и путь без параметров запроса, имена параметров пути не различаются.
    Пути нет (стык ещё к валидации) — стык отличается цитатой."""
    path = re.sub(r"[?#].*$", "", str(item.get("path") or "").strip().strip("`"))
    if not path:
        return "|".join(Quotes.parts(item))
    return f"{str(item.get('method', '')).upper()} {re.sub(r'{[^}]*}', '{}', path)}"


def load_items(text: str) -> dict:
    """Выписка агента: JSON-объект, в том числе обёрнутый в ``` или с текстом вокруг."""
    return json.loads(text[text.find("{"):text.rfind("}") + 1])


def bt_features(items: dict, quotes: Quotes) -> list[tuple[str, str, object, int]]:
    scenarios = len(quotes.distinct(items.get("scenarios")))
    roles = len(quotes.distinct(items.get("roles")))
    objects = sum({"new": 2, "changed": 1}.get(str(item.get("change")), 0) for item in quotes.distinct(items.get("objects")))
    scope = len(quotes.distinct(items.get("out_of_scope")))
    parts = len(quotes.distinct(items.get("parts")))
    return [("Б1", "Сценарии приёмки", scenarios, scale.points("Б1", scenarios)),
            ("Б2", "Роли", roles, scale.points("Б2", roles)),
            ("Б3", "Бизнес-объекты", objects, scale.points("Б3", objects)),
            ("Б4", "Границы объёма", scope, scale.points("Б4", scope)),
            ("Б5", "Разрез на части", parts, scale.points("Б5", parts))]


def spec_features(items: dict, quotes: Quotes) -> list[tuple[str, str, object, int]]:
    services = len(quotes.distinct(items.get("services")))
    interactions = sum(1 if str(item.get("kind")) == "consumption" else 2 for item in quotes.distinct(items.get("interactions")))
    contract = len(quotes.distinct(items.get("contracts"), key=contract_key)) + len(quotes.distinct(items.get("field_changes")))
    errors = len(quotes.distinct(items.get("errors")))
    entities = len(quotes.distinct(items.get("data_entities")))
    migration = quotes.flag(items.get("ddl_migration"))
    states = len(quotes.distinct(items.get("ui_states")))
    zones = min(5, len(quotes.distinct(items.get("access_nfr"), key=lambda item: normalize(str(item.get("section"))))))
    release = items.get("release") if isinstance(items.get("release"), dict) else {}
    checks = (int(services >= 2 and quotes.flag(release.get("rollout_order"))) + int(quotes.flag(release.get("rollback_plan")))
              + int(quotes.flag(release.get("presetup_open"))))
    facts = len(quotes.distinct(items.get("confirmed_facts")))
    return [("С1", "Сервисы", services, scale.points("С1", services)),
            ("С2", "Взаимодействия", interactions, scale.points("С2", interactions)),
            ("С3", "Контракт", contract, scale.points("С3", contract)),
            ("С4", "Ошибки", errors, scale.points("С4", errors)),
            ("С5", "Данные", f"{entities}{' + миграция' if migration else ''}", scale.data_points(entities, migration)),
            ("С6", "Состояния экрана", states, scale.points("С6", states)),
            ("С7", "Доступ и НФТ", zones, scale.points("С7", zones)),
            ("С8", "Выкат и откат", checks, min(scale.CHECKS_MAX, checks)),
            ("С9", "Подтверждённые факты", facts, scale.points("С9", facts))]


def simplified_type(path: str, items: dict, quotes: Quotes) -> tuple[str | None, list[str]]:
    """Тип изменения спеки, при котором класс 1 ставится без признаков, и пометки о нём."""
    change_type = items.get("change_type")
    if not isinstance(change_type, dict):
        return None, ["тип изменения не выписан"]
    if not quotes.counts(change_type):
        return None, ["тип изменения без найденной цитаты"]
    value = normalize(str(change_type.get("value", "")))
    kind = next((name for name in SIMPLIFIED_TYPES if value.startswith(name)), None)
    if kind != "мелкая правка":
        return kind, []
    verdict = items.get("above_threshold")
    if not isinstance(verdict, dict) or verdict.get("yes") is not True:
        return kind, []
    request = os.path.join(os.path.dirname(os.path.abspath(path)), CHANGE_REQUEST)  # спеку правки пишут рядом с запросом
    request_text = normalize("\n".join(document.read_lines(request))) if os.path.isfile(request) else ""
    parts = Quotes.parts(verdict)
    if parts and all(part in request_text for part in parts):
        return None, ["мелкая правка выше порога — считается по признакам"]
    return kind, ["вердикт «выше порога» без найденной цитаты в запросе на правку"]


def assess(path: str, kind: str, items: dict) -> Result:
    lines = document.read_lines(path)
    result = Result(name="/".join(Path(path).parts[-2:]), kind=kind, volume=sheets.measure(path, kind),
                    template=document.template_version(lines))
    quotes = Quotes(path, kind)
    shortcut = None
    if kind == "spec":
        shortcut, notes = simplified_type(path, items, quotes)
        result.notes += notes
    result.features = (bt_features if kind == "bt" else spec_features)(items, quotes)
    result.total = sum(feature[3] for feature in result.features)
    result.complexity_class = 1 if shortcut else scale.complexity_class(result.total, kind)
    if shortcut:
        result.notes.append(f"класс 1: {shortcut}, признаки не в счёт")
    result.debt = len(quotes.distinct(items.get("open_items")))
    if quotes.missing:
        result.notes.append(f"цитат не найдено: {quotes.missing}")
    if quotes.inherited:
        result.notes.append(f"засчитано родителю: {quotes.inherited}")
    if kind == "bt" and document.frontmatter_field(lines, "source") and not document.parent_document(path, lines):
        result.notes.append("БТ эпика по source: не найден — наследство не вычтено")
    return result


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("kind", choices=("bt", "spec"))
    parser.add_argument("file")
    parser.add_argument("items", help="выписка агента, JSON")
    args = parser.parse_args(argv)
    with open(args.items, encoding="utf-8-sig") as handle:  # PowerShell 5.1 сохраняет UTF-8 с BOM
        items = load_items(handle.read())
    result = assess(args.file, args.kind, items)
    print(result.line())
    for code, title, value, points in result.features:
        print(f"  {code}. {title}: {value} → {points}")
    print(f"  баллы {result.total} → класс {result.complexity_class}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
