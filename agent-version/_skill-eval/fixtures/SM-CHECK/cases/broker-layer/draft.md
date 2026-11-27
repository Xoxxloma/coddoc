# orders — backend

## Стек
| Слой | Чем |
|---|---|
| Язык и фреймворк | Kotlin, Spring Boot |
| Асинхронные вызовы и шина | WebClient, Reactor Kafka |
| Машина состояний | Spring Statemachine |

## Публичный контракт

### `GET /orders`
сущности: → не сущность, ответ orders
- список заказов

## События

### потребляет `orders.created`
- кладёт заказ в очередь сборки
