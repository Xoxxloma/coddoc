"""complexity — блок complexity выхода: класс сложности по пунктам, которые выписал субагент, с проверкой цитат.

Пункт засчитывается, если его цитата есть в своём тексте документа или в его файлах задачи (document.py): дословно
или, у цитаты от QUOTE_MIN_FUZZY знаков, когда не меньше QUOTE_MATCH_SHARE её длины совпадает с одной строкой одним
куском — модель изредка ошибается в окончании слова, а выдуманная цитата так не совпадёт. Цитата нашлась только в
унаследованном от родителя эпика — пункт засчитан родителю. Повторы склеиваются по имени пункта, без имени — по
цитате. Корзины признаков и пороги классов — из params.json, раздел complexity.

У признака в выходе — значение, балл и excluded: что не засчитано и почему, с цитатой. Как findings у качества,
пишется то, что снизило счёт. Спека багфикса или мелкой правки получает класс 1 без подсчёта признаков, если в
запросе на правку не записано, что объём выше порога. Долг — число открытых пунктов, в класс он не входит. Формула
класса — здесь же: contract.py проверяет ею выход.
"""

from __future__ import annotations

import os
import re
import sys
from difflib import SequenceMatcher

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # соседние модули находятся и при `python -I`
import document  # noqa: E402
import params  # noqa: E402
import sheets  # noqa: E402

SIMPLE_CHANGES = {"багфикс": "bugfix", "мелкая правка": "change_request"}  # тип изменения из выписки → simple_change
CHANGE_REQUEST = "change_request.md"
TITLES = {
    "B1": "Сценарии приёмки", "B2": "Роли", "B3": "Бизнес-объекты", "B4": "Границы объёма", "B5": "Разрез на части",
    "C1": "Сервисы", "C2": "Взаимодействия", "C3": "Контракт", "C4": "Ошибки", "C5": "Данные", "C6": "Состояния экрана",
    "C7": "Доступ и НФТ", "C8": "Выкат и откат", "C9": "Подтверждённые факты",
}
FACTORS = {"bt": ("B1", "B2", "B3", "B4", "B5"), "spec": ("C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9")}
CHECKS_MAX = 3  # C5 и C8 — не больше 3 баллов
NFR_SECTIONS = 5  # C7: разделов доступа и НФТ в шаблоне спеки пять
OBJECT_WEIGHTS = {"new": 2, "changed": 1}  # B3: новый объект — 2, изменённый или задействованный — 1, неизменный — 0
CONSUMPTION = "consumption"  # C2: потребление существующего — 1, новое взаимодействие и изменение — 2
# Почему пункт не засчитан — excluded[].reason.
NOT_FOUND, INHERITED, UNCHANGED, SINGLE_SERVICE = "not_found", "inherited", "unchanged", "single_service"
QUOTE_MAX = 300


def normalize(text: str) -> str:
    text = sheets.TEXT_LINK.sub(r"\1", text)
    text = text.replace("\u00a0", " ").replace("**", "").replace("`", "").replace("~~", "")
    return re.sub(r"\s+", " ", text).strip().lower()


def bucket(value: int, thresholds) -> int:
    """Балл 0–3: сколько нижних границ корзин 1, 2 и 3 значение достигло."""
    return sum(1 for threshold in thresholds if value >= threshold)


def excluded(reason: str, item: dict) -> list[dict]:
    """Строка excluded: причина и цитата пункта (цитаты нет — его имя); показать нечего — пусто."""
    quote = str(item.get("quote") or item.get("name") or "").strip()[:QUOTE_MAX]
    return [{"reason": reason, "quote": quote}] if quote else []


def unique(entries: list[dict]) -> list[dict]:
    kept = []
    for entry in entries:
        if entry not in kept:
            kept.append(entry)
    return kept


class Quotes:
    """Сверка цитат: настоящая ли цитата и засчитывать ли её этому документу."""

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

    @staticmethod
    def parts(item: dict) -> list[str]:
        """Цитата по ячейкам таблицы: агент может склеить ячейки через «|». Знак препинания в конце не сверяется."""
        parts = (normalize(part).rstrip(" .,;:") for part in str(item.get("quote") or "").split("|"))
        return [part for part in parts if part]

    def present(self, part: str, text: str, lines: list[str]) -> bool:
        if part in text:
            return True
        if len(part) < self.QUOTE_MIN_FUZZY:
            return False
        need = self.QUOTE_MATCH_SHARE * len(part)
        return any(SequenceMatcher(None, part, line, autojunk=False).find_longest_match(0, len(part), 0, len(line)).size
                   >= need for line in lines if len(line) >= need)

    def reason(self, item: dict) -> str | None:
        """Почему пункт не засчитан: цитаты нет в тексте — not_found, она только в унаследованном — inherited; None — засчитан."""
        parts = self.parts(item)
        if not parts or not all(self.present(part, self.full_text, self.full_lines) for part in parts):
            return NOT_FOUND
        if not all(self.present(part, self.own_text, self.own_lines) for part in parts):
            return INHERITED
        return None

    def sort(self, items, key=None) -> tuple[list[dict], list[dict]]:
        """Пункты признака → (засчитанные без повторов, excluded). Пункт отличается от другого по key, иначе по имени,
        а без имени — по цитате: у нескольких пунктов одной строки цитата бывает общей. Не засчитанный пункт, который
        засчитан под тем же именем с другой цитатой, в excluded не идёт: счёт он не снизил."""
        seen, kept, rejected = set(), [], []
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            name = normalize(str(item.get("name") or ""))
            identity = key(item) if key else (name or "|".join(self.parts(item)))
            why = self.reason(item)
            if why:
                rejected.append((identity, why, item))
            elif identity not in seen:
                seen.add(identity)
                kept.append(item)
        return kept, unique([entry for identity, why, item in rejected if identity not in seen for entry in excluded(why, item)])

    def flag(self, value) -> tuple[bool, list[dict]]:
        """Проверка «да / нет» → (засчитана, excluded). «Да» засчитывается только с цитатой в своём тексте."""
        if not isinstance(value, dict) or value.get("yes", value.get("needed")) is not True:
            return False, []
        why = self.reason(value)
        return why is None, excluded(why, value) if why else []


def contract_key(item: dict) -> str:
    """Один стык — один раз: метод и путь без параметров запроса, имена параметров пути не различаются.
    Пути нет (стык ещё к валидации) — стык отличается цитатой."""
    path = re.sub(r"[?#].*$", "", str(item.get("path") or "").strip().strip("`"))
    if not path:
        return "|".join(Quotes.parts(item))
    return f"{str(item.get('method', '')).upper()} {re.sub(r'{[^}]*}', '{}', path)}"


def complexity_class(points: int, thresholds, simple_change: str | None) -> int:
    """Класс 1–5 по сумме баллов; багфикс и мелкая правка — класс 1 без счёта."""
    return 1 if simple_change else 1 + bucket(points, thresholds)


def factor(code: str, value: int, points: int, out: list[dict]) -> dict:
    return {"id": code, "title": TITLES[code], "value": value, "points": points, "excluded": out}


def counted(code: str, sorted_items: tuple[list[dict], list[dict]], buckets: dict) -> dict:
    """Признак, у которого значение — число засчитанных пунктов, балл — корзина значения."""
    kept, out = sorted_items
    return factor(code, len(kept), bucket(len(kept), buckets[code]), out)


def bt_factors(items: dict, quotes: Quotes, cfg: dict) -> list[dict]:
    buckets = params.complexity_buckets(cfg)
    objects, objects_out = quotes.sort(items.get("objects"))
    weights = [OBJECT_WEIGHTS.get(str(item.get("change")), 0) for item in objects]
    objects_out += [entry for item, weight in zip(objects, weights) if not weight for entry in excluded(UNCHANGED, item)]
    return [counted("B1", quotes.sort(items.get("scenarios")), buckets), counted("B2", quotes.sort(items.get("roles")), buckets),
            factor("B3", sum(weights), bucket(sum(weights), buckets["B3"]), unique(objects_out)),
            counted("B4", quotes.sort(items.get("out_of_scope")), buckets), counted("B5", quotes.sort(items.get("parts")), buckets)]


def spec_factors(items: dict, quotes: Quotes, cfg: dict) -> list[dict]:
    buckets = params.complexity_buckets(cfg)
    services, services_out = quotes.sort(items.get("services"))
    interactions, interactions_out = quotes.sort(items.get("interactions"))
    interaction_value = sum(1 if str(item.get("kind")) == CONSUMPTION else 2 for item in interactions)
    contracts, contracts_out = quotes.sort(items.get("contracts"), key=contract_key)
    fields, fields_out = quotes.sort(items.get("field_changes"))
    entities, entities_out = quotes.sort(items.get("data_entities"))
    migration, migration_out = quotes.flag(items.get("ddl_migration"))
    zones, zones_out = quotes.sort(items.get("access_nfr"), key=lambda item: normalize(str(item.get("section"))))
    release = items.get("release") if isinstance(items.get("release"), dict) else {}
    checks, checks_out = 0, []
    for name in ("rollout_order", "rollback_plan", "presetup_open"):
        yes, out = quotes.flag(release.get(name))
        if yes and name == "rollout_order" and len(services) < 2:  # порядок выката считается, когда сервисов больше одного
            yes, out = False, excluded(SINGLE_SERVICE, release[name])
        checks += yes
        checks_out += out
    data_points = min(CHECKS_MAX, bucket(len(entities), buckets["C5"]) + migration)  # миграция — плюс 1 к баллу
    nfr = min(NFR_SECTIONS, len(zones))
    return [factor("C1", len(services), bucket(len(services), buckets["C1"]), services_out),
            factor("C2", interaction_value, bucket(interaction_value, buckets["C2"]), interactions_out),
            counted("C3", (contracts + fields, unique(contracts_out + fields_out)), buckets),
            counted("C4", quotes.sort(items.get("errors")), buckets),
            factor("C5", len(entities) + migration, data_points, unique(entities_out + migration_out)),
            counted("C6", quotes.sort(items.get("ui_states")), buckets),
            factor("C7", nfr, bucket(nfr, buckets["C7"]), zones_out),
            factor("C8", checks, min(CHECKS_MAX, checks), unique(checks_out)),
            counted("C9", quotes.sort(items.get("confirmed_facts")), buckets)]


def simple_change(path: str, items: dict, quotes: Quotes) -> str | None:
    """Тип изменения спеки, при котором класс 1 ставится без признаков: bugfix, change_request или None."""
    change_type = items.get("change_type")
    if not isinstance(change_type, dict) or quotes.reason(change_type):
        return None
    value = normalize(str(change_type.get("value", "")))
    kind = next((name for name in SIMPLE_CHANGES if value.startswith(name)), None)
    verdict = items.get("above_threshold")
    if kind == "мелкая правка" and isinstance(verdict, dict) and verdict.get("yes") is True:
        request = os.path.join(os.path.dirname(os.path.abspath(path)), CHANGE_REQUEST)  # спеку правки пишут рядом с запросом
        request_text = normalize("\n".join(document.read_lines(request))) if os.path.isfile(request) else ""
        parts = Quotes.parts(verdict)
        if parts and all(part in request_text for part in parts):
            return None  # мелкая правка выше порога — считается по признакам
    return SIMPLE_CHANGES.get(kind)


def assess(path: str, kind: str, items, cfg: dict) -> dict:
    """Блок complexity выхода по пунктам субагента; items не объект — сложность не оценена."""
    if not isinstance(items, dict):
        return {"scored": False, "skip_reason": "в ответе нет блока complexity"}
    quotes = Quotes(path, kind)
    change = simple_change(path, items, quotes) if kind == "spec" else None
    factors = (bt_factors if kind == "bt" else spec_factors)(items, quotes, cfg)
    points = sum(item["points"] for item in factors)
    return {"scored": True, "class": complexity_class(points, params.complexity_class_thresholds(cfg, kind), change),
            "points": points, "simple_change": change, "debt": len(quotes.sort(items.get("open_items"))[0]), "factors": factors}


def template_version(path: str) -> str | None:
    """Версия скилла, которым написан документ: последняя запись «Версия скилла» в шапке."""
    return document.template_version(document.read_lines(path))


def volume(path: str, kind: str) -> dict:
    """Блок volume выхода: листы по 1800 знаков, знаки и иллюстрации (sheets.py)."""
    measured = sheets.measure(path, kind)
    return {"sheets": measured.sheets, "chars": measured.chars, "illustrations": measured.illustrations}
