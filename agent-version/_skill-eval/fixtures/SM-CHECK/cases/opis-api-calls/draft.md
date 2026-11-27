---
service: observer-web
type: frontend
scanned: 2026-10-22
---
# observer-web — frontend

## Экраны
| Роут | Экран | Что делает пользователь |
|---|---|---|
| `/nights` | Календарь ночей | выбирает ночь |

## Потребляемые API
| Сервис | Вызов | Зачем |
|---|---|---|
| `telescope-api` | `GET /api/nights` | календарь ночей |
| `telescope-api` | `GET /api/observers/me` | имя в шапке |
| `telescope-api` | `POST /api/reservations` | бронь ночи |
