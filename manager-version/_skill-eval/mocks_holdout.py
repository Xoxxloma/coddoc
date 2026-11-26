"""Отложенный набор моков: проверка задания модели на подгон.

Другие настоящие сессии Claude Code (не из mocks.SOURCES), обрезанные до размера моков, и заложенные случаи,
написанные заново субагентом, который не видел ни brief.md, ни mocks.py, с запретом на формулировки из них.
Тексты случаев — в product/session-quality/holdout/plants.json, вне Git: набор нужен, чтобы проверять, не подогнан ли
скилл под пробы, поэтому по его провалам скилл не правят — только смотрят.
"""

from __future__ import annotations

import json
import os

import mocks
from mocks import ask, clarify_mid, ending, exchange, false_success, off_topic, reask, said

HERE = os.path.dirname(os.path.abspath(__file__))
PLANTS_FILE = os.path.join(HERE, "..", "..", "product", "session-quality", "holdout", "plants.json")
SOURCES = {"h1": "805643d5", "h2": "f9aad063", "h3": "689e7377", "h4": "3db65138",
           "h5": "dc923e0a", "h6": "7f348438", "h7": "19f5babf", "h8": "3d10e3ab"}
KEEP = {"h1": 22, "h2": 15, "h3": 15, "h4": 17, "h5": 34, "h6": 23, "h7": 19, "h8": 15}


def options(case_id, spec):
    questions = [(item["header"], item["question"], item["options"], False) for item in spec["questions"]]
    return ask(f"holdout-{case_id}", questions, spec["answers"])


def plants(texts):
    def pair(case_id, first, second):
        """Своё решение пользователя (ловушка на ложный обман) и позже повторный вопрос агента о нём. Вердикт ответа
        не оцениваем: «значение из предложенных + уже говорил» — и выбор готового варианта, и поправка агента."""
        part = texts[case_id]
        later = {}
        return [(first, said(part["said_user"], part["said_agent"]),
                 {"forbid": ("deception",)}),
                (second, reask(part["reask_agent"], part["reask_user"]), later)]

    def line(case_id):
        return said(texts[case_id]["user"], texts[case_id]["agent"])

    def answer(case_id, delay):
        return exchange(texts[case_id]["agent"], texts[case_id]["user"], delay)

    def mid(case_id):
        part = texts[case_id]
        return clarify_mid(part["agent_report"], part["user"], part["agent_question"], part["user_answer"])

    def failed_write(case_id):
        part = texts[case_id]
        return false_success(f"holdout-{case_id}", part["path"], part["error"], part["claim"], part.get("catch"))

    def finish(case_id):
        part = texts[case_id]
        return ending(f"holdout-{case_id}", part["skill"], part["question"], path=part.get("path"))

    for case_id in ("h2-I", "h4-I", "h8-I"):
        assert len(texts[case_id]["agent"]) > 1600, (case_id, len(texts[case_id]["agent"]))
    return {
        "h1": pair("h1-A", 3, 18) + [
            (8, line("h1-F"), {"finding": ("bypass", "said")}),
            (12, options("h1-J", texts["h1-J"]), {"check": ("decision", "answer", "engaged")}),
            (15, failed_write("h1-O"), {}),
        ],
        "h2": [
            (4, off_topic(texts["h2-C"]["pairs"]), {"off_topic": "personal"}),
            (7, answer("h2-I", 3), {"check": ("decision", "answer", "accepted")}),
            (10, answer("h2-K", 40), {"check": ("decision", "answer", "engaged")}),
            (12, mid("h2-L"), {}),
            (0, finish("h2-P"), {"check": ("ending", "question", "no")}),
        ],
        "h3": pair("h3-B", 2, 11) + [
            (5, line("h3-E"), {"finding": ("deception", "said")}),
            # выбор готового варианта «Нет, …» — accepted (решение владельца 2026-10-28)
            (7, options("h3-J", texts["h3-J"]), {"check": ("decision", "answer", "accepted")}),
            (13, line("h3-M"), {}),
        ],
        "h4": [
            (3, off_topic(texts["h4-C"]["pairs"]), {"off_topic": "non_work"}),
            (6, answer("h4-I", 4), {"check": ("decision", "answer", "no")}),
            (9, answer("h4-K", 30), {"check": ("decision", "answer", "delegated")}),
            (12, line("h4-N"), {}),
        ],
        "h5": pair("h5-A", 4, 26) + [
            (10, line("h5-G"), {"forbid": ("deception", "bypass")}),
            (16, options("h5-J", texts["h5-J"]), {"check": ("decision", "answer", "engaged")}),
            (21, line("h5-N"), {}),
        ],
        "h6": [
            (5, off_topic(texts["h6-C"]["pairs"]), {"off_topic": "personal"}),
            (9, line("h6-E"), {"finding": ("deception", "said")}),
            (13, options("h6-J", texts["h6-J"]), {"check": ("decision", "answer", "accepted")}),
            (17, mid("h6-L"), {}),
            (0, finish("h6-P"), {"check": ("ending", "question", "yes")}),
        ],
        "h7": pair("h7-B", 3, 15) + [
            (7, line("h7-F"), {"finding": ("bypass", "said")}),
            (10, options("h7-J", texts["h7-J"]), {}),
            (12, line("h7-M"), {}),
        ],
        "h8": [
            (3, line("h8-D"), {"trap": "other_work"}),
            (6, answer("h8-I", 3), {"check": ("decision", "answer", "accepted")}),
            (9, answer("h8-K", 10), {"check": ("decision", "answer", "ignored")}),
            (12, failed_write("h8-O"), {}),
        ],
    }


def build(folder):
    with open(PLANTS_FILE, encoding="utf-8") as handle:
        texts = json.load(handle)
    return mocks.build(folder, SOURCES, plants(texts), KEEP)
