# telescope-api — backend

## Публичный контракт

### `GET /nights`
Календарь ночей.
- только ночи без закрытия по погоде

### `GET /nights/{id}`
Одна ночь.
- `null` в `forecast` — прогноз недоступен

### `POST /reservations`
Бронь ночи.
- четвёртая бронь в месяц — 409

### `POST /reservations/{id}/cancel`
Отмена брони.
- повтор безопасен
