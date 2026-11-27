GET /orders — internal/http/router.go + internal/http/handlers/orders.go
  · постранично, limit по умолчанию 20 — internal/http/handlers/orders.go
POST /orders — internal/http/router.go + internal/http/handlers/orders.go
  · пустая корзина — 400 — internal/http/handlers/orders.go
GET /payments/{id} — internal/http/router.go + internal/http/handlers/payments.go
  · чужой платёж — 404 — internal/http/handlers/payments.go
POST /payments — internal/http/router.go + internal/http/handlers/payments.go
  · повтор ключа идемпотентности возвращает прежний платёж — internal/payments/service.go
⟹ эндпоинтов 4, из них с фактами 4
