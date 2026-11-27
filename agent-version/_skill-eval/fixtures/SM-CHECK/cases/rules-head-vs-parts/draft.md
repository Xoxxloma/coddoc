# telescope-api — backend

## Бизнес-правила

### `Reservation` — бронь
- запрошена (`REQUESTED`) — наблюдателем
- подтверждена (`CONFIRMED`) — оператором

### сообщение «бронь подтверждена»
- при подтверждении; событие `telescope.reservation.events`

### сообщение «напоминание о ночи»
- за сутки до ночи; отправка `sendNightReminder`

## Публичный контракт

### `GET /api/nights`
сущности: → не сущность, ответ weather
- открытые ночи

## Владеет данными

### `Dome`
- `state`: `OPEN` | `CLOSED`

### `Reservation`
- `status`: `REQUESTED` | `CONFIRMED` | `CANCELLED`
