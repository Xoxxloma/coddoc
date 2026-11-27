<!-- service-map: часть 01 2026-10-21 -->
## Публичный контракт

### `POST /api/reservations/cancel`
Отмена брони.
сущности: → `Reservation`
доступ: `NIGHT_OPERATOR` — src/reservations/ReservationController.java
меняет: `Reservation.status` `CONFIRMED` → `CANCELLED`
- ошибки: `409` — бронь уже отменена

## События

### публикует `telescope.reservation.cancelled`
Бронь отменена.
- тело: `ReservationCancelled`
- ключ: `observerId`
- гарантия: отдельным вызовом

## Зависит от
| `dome-control` | состояние купола |
