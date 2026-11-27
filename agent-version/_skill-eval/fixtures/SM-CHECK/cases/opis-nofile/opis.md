Эндпоинты:
GET /v1/a — api/a.ts
GET /v1/b
GET /v1/c — api/c.ts
  · факт — api/c.ts
Сущности:
Order — domain/Order.kt (@Entity)
Бизнес-правила:
ограничение: приём отключён
сообщение: «напоминание» — пользователю — mail/Reminder.kt
состояние: Order.status NEW | DONE
справочник: Order.kind A | B — domain/Order.kt
⟹ эндпоинтов 3, из них с фактами 1
