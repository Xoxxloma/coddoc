GET /api/nights — src/nights/nights.controller.ts
  · только ночи без закрытия по погоде — src/nights/nights.repository.ts
GET /api/nights/{id} — src/nights/nights.controller.ts
  · null в forecast — прогноз недоступен — src/nights/night.dto.ts
POST /api/reservations — src/reservations/reservations.controller.ts
  · четвёртая бронь в месяц — 409 — src/reservations/reservations.service.ts
POST /api/reservations/{id}/cancel — src/reservations/reservations.controller.ts
  · повтор безопасен — src/reservations/reservations.service.ts
⟹ эндпоинтов 4, из них с фактами 4
