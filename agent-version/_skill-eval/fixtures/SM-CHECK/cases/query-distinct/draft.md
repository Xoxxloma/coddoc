# rpc — backend

## Публичный контракт

### `GET /api?action=list`
- список

### `POST /rpc?method=pay`
- оплата

### `GET /files/:name(.*)?/meta`
- метаданные

## Потребляемые API
| Сервис | Вызов | Зачем |
|---|---|---|
| `orders` | `GET /orders?status=open` | открытые заказы |
