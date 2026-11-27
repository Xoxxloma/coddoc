# sky — backend

## Бизнес-правила

### `Reservation` — заявка на наблюдение
- запрошена (`REQUESTED`) — наблюдатель подаёт заявку
- подтверждена (`CONFIRMED`) — дежурный подтверждает заявку
- отменена (`CANCELLED`) — не определено: перехода в коде нет

## Публичный контракт

### `POST /api/reservations/{id}/confirm`
сущности: ← `id` · → `Reservation`
меняет: `Reservation.status` `REQUESTED` → `CONFIRMED`
меняет: `Dome.state` → `OPEN`
меняет: `Observer.active` → «ложь»
меняет: `Night.moonPhase` → `FULL`
- подтверждает заявку и открывает купол

## Владеет данными

### `Reservation`
- `status`: `ReservationStatus` — `REQUESTED` | `CONFIRMED` | `CANCELLED`

### `Dome`
- `state`: `DomeState`
- `telescope`: `TelescopeEntity`

### `Observer`
- `active`: `Boolean`

### `Night`
- `moonPhase`: `MoonPhase` — `NEW` | `QUARTER` | `FULL`

### `Filter`
- `kind`: `FilterKind` — `BROAD` | `NARROW`
