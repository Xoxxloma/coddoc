# orders — backend

## Стек
- Java 17, Spring Boot
- Kafka

## Публичный контракт

### `GET /orders/{orderId}`
сущности: → не сущность, ответ orders
- заказ по номеру

## События

### потребляет `orders.created`
- кладёт заказ в очередь сборки

### публикует `orders.paid`
- после оплаты
