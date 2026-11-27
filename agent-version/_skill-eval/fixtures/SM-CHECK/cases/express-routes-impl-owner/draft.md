## Публичный контракт

### `GET /carts/:id`
- чужая корзина — 404

### `POST /carts/:id/items`
- количество от 1 до 99

### `DELETE /carts/:id/items/:itemId`
- удаление отсутствующей позиции — 204
