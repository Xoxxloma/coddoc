// views.js — описания вида «Обзор» (overview.js) для БТ, спеки, баг-репорта и запроса на правку.
// Поля и блоки — в reference/views.md скилла to-html. Раздел ищется по номеру ("num") или по названию ("title",
// регулярное выражение без учёта регистра); всё, что не взял ни один блок, показывается как есть.
window.CODDOC_VIEWS = [
  {
    "id": "brd",
    "kind": "brd",
    "label": "БТ",
    "role": "source",
    "files": ["business_requirements.md"],
    "hero": { "sibling": "spec", "questions": "list" },
    "sections": [
      { "title": "^Введение", "num": "1", "block": "rows", "rows": [
        [{ "title": "^Описание проблемы", "num": "1.1", "style": "problem" }, { "title": "^Как сейчас", "num": "1.4" }],
        [{ "title": "^Тип изменения", "num": "1.0", "small": true }, { "title": "^Конечные потребители", "num": "1.2", "small": true }, { "title": "^Заказчик", "num": "1.3", "small": true }]
      ] },
      { "title": "^Бизнес-требования", "num": "2", "block": "rows", "rows": [
        [{ "title": "^Бизнес-цель", "num": "2.1", "block": "stories" }],
        [{ "title": "^Ценность", "num": "2.2" }],
        [{ "title": "риски", "num": "2.3", "scroll": true }]
      ] },
      { "title": "^Объём", "num": "3", "block": "rows", "rows": [
        [{ "title": "^Входит", "num": "3.1", "style": "scope-in" }, { "title": "^Не входит", "num": "3.2", "style": "scope-out" }],
        [{ "title": "^Архитектурные", "num": "3.3" }, { "title": "^Внешние зависимости", "num": "3.4" }]
      ] },
      { "title": "^Функциональные требования", "num": "4", "block": "requirements", "data": { "title": "^Бизнес-данные", "num": "4.3" } },
      { "title": "^Ограничения", "num": "5", "block": "rows", "rows": [
        [{ "title": "^Приоритет", "num": "5.1" }, { "title": "^Сроки", "num": "5.2" }],
        [{ "title": "^Ролевая модель", "num": "5.3", "block": "table-cards", "cards": "roles" }]
      ] }
    ]
  },
  {
    "id": "spec",
    "kind": "spec",
    "label": "Спека",
    "role": "spec",
    "files": ["technical_specification.md"],
    "hero": { "sibling": "source", "line": "Источник", "questions": "numbered", "legend": true, "foundation": true },
    "sections": [
      { "title": "^Обзор изменения", "num": "1", "block": "rows", "rows": [
        [{ "title": "^Что делаем|^Тип и стороны", "num": "1.1", "block": "labeled" }],
        [{ "title": "^Затронутые сервисы", "num": "1.2", "block": "table-cards", "cards": "services" }]
      ] },
      { "title": "^Взаимодействия", "num": "2", "block": "interactions" },
      { "title": "^Релиз|^Совместимость и выкатка", "num": "6", "block": "release", "checklist": { "title": "^Преднастройка", "num": "6.5" } },
      { "title": "^Трассировка", "num": "7", "block": "trace" }
    ]
  },
  {
    "id": "bug",
    "kind": "bug",
    "label": "Баг-репорт",
    "role": "source",
    "files": ["bug_report.md"],
    "hero": { "sibling": "spec", "questions": "list", "critical": { "title": "^Критичность", "num": "5" } },
    "sections": [
      { "title": "^Открытые вопросы", "block": "questions" },
      { "title": "процесс", "num": "1", "style": "proc" },
      { "title": "^Шаги воспроизведения", "num": "2", "block": "steps" },
      { "title": "^Фактический", "num": "3", "block": "pair", "with": { "title": "^Ожидаемый", "num": "4" }, "style": "fact" }
    ]
  },
  {
    "id": "cr",
    "kind": "cr",
    "label": "Запрос на правку",
    "role": "source",
    "files": ["change_request.md"],
    "hero": { "sibling": "spec", "questions": "list", "critical": { "title": "^Критичность", "num": "6" } },
    "sections": [
      { "title": "^Открытые вопросы", "block": "questions" },
      { "title": "процесс", "num": "1", "style": "proc" },
      { "title": "^Что тронуто", "num": "2", "block": "touched" },
      { "title": "^Как сейчас", "num": "3", "block": "pair", "with": { "title": "^Как должно стать", "num": "4" }, "style": "was-card" },
      { "title": "^Как проверят", "num": "5", "style": "goal" },
      { "title": "остаётся прежним", "style": "scope-out" }
    ]
  }
];
