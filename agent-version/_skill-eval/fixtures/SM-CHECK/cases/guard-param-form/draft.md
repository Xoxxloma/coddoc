# shop — backend

## Публичный контракт

### `GET /carts/{id}`
сущности: → Cart
- корзина

### `GET /health`
сущности: → не сущность, ответ ok
- живость

### `GET /orders/{id}`
сущности: → Order
- заказ

### `POST /carts/{cartId}/items`
сущности: → CartItem
- добавляет товар в корзину
