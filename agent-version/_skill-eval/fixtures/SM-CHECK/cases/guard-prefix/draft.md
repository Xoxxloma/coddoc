# telescope-api — backend

## Публичный контракт

### `GET /api/nights`
Календарь ночей.
- только ночи без закрытия по погоде

### `GET /api/nights/{id}`
Одна ночь.
- `null` в `forecast` — прогноз недоступен

### `POST /api/reservations`
Бронь ночи.
- четвёртая бронь в месяц — 409

### `POST /api/reservations/{id}/cancel`
Отмена брони.
- повтор безопасен
