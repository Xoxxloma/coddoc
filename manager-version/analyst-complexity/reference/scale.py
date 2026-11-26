"""scale — шкала методики: корзины признаков и пороги классов.

Корзина переводит сырое число в балл 0–3: сколько нижних границ корзин 1, 2 и 3 число достигло.
"""

from __future__ import annotations

FEATURE_THRESHOLDS = {
    "Б1": (1, 4, 9), "Б2": (2, 4, 6), "Б3": (1, 3, 6), "Б4": (1, 3, 5), "Б5": (2, 3, 4),
    "С1": (2, 3, 5), "С2": (1, 3, 6), "С3": (3, 7, 13), "С4": (1, 3, 6), "С6": (1, 5, 9), "С7": (1, 2, 4),
    "С9": (1, 4, 9),
}
OWN_DATA_THRESHOLDS = (1, 3)  # С5: своих сущностей 0 → 0, 1–2 → 1, 3+ → 2, плюс 1 за миграцию схемы
CHECKS_MAX = 3  # С5 и С8 — сумма проверок, не больше 3
CLASS_THRESHOLDS = {"bt": (3, 6, 9, 12), "spec": (6, 11, 17, 23)}


def bucket(value: int, thresholds) -> int:
    return sum(1 for threshold in thresholds if value >= threshold)


def points(feature: str, value: int) -> int:
    return bucket(value, FEATURE_THRESHOLDS[feature])


def data_points(own_entities: int, migration: bool) -> int:
    return min(CHECKS_MAX, bucket(own_entities, OWN_DATA_THRESHOLDS) + int(migration))


def complexity_class(total: int, kind: str) -> int:
    return 1 + bucket(total, CLASS_THRESHOLDS[kind])
