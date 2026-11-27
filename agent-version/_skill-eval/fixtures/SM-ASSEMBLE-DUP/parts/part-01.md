<!-- service-map: часть 01 2026-10-19 -->
## Бизнес-правила

### `Reservation` — бронь
- запрошена (`REQUESTED`) — не определено: перехода в коде этой части нет

## Публичный контракт

### `GET /api/nights/free-count`
Счётчик свободных ночей.
сущности: → не сущность, агрегат по `Reservation`
- `telescopeId` (query, uuid, обязателен) — телескоп
- закрытые по погоде ночи не считаются

### GET /api/nights/forecast — прогноз облачности на ночь
- сущности: → не сущность, ответ weather-feed
- `cloudCover: int` — процент облачности

### `query night(id)`
Ночь наблюдений по идентификатору.
сущности: → `ObservingNight`
- ночь, закрытая по погоде, — ошибка доступа

### `GET /api/domes/status`
Блок без дубля — должен выйти как есть.
сущности: → `Dome`
— строка семантики посреди
- факт после семантики

## События

### потребляет `sky.cloud-alert` (закрытие ночи)
Облачность — ночь закрывается.
- из тела читается только `nightDate`

### публикует `telescope.reservation.events`
Событие по брони всем подписчикам.
- ключ — идентификатор брони
- шлётся из outbox отдельной задачей

## Владеет данными

### `Reservation`
Бронь ночи.
- `id`: `UUID`
- `observerId`, `telescopeId`: `string?`
- `night` (ссылка), `dome` (ссылка)
- `status` (ReservationStatus), `statusChangedAt`: `offset-datetime?`
- `version` (версия записи)
— отменённая по погоде бронь в очередь не возвращается

### `Telescope`
Телескоп.
- `id`: `uuid`
- `aperture`: `int`

### `ShiftLogEntry`
Запись журнала смен.
- id, operatorId, domeId, note
- `createdAt`, `updatedAt` проставляются автоматически
