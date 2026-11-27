<!-- service-map: часть 02 2026-10-06 -->
GET /carts/:id — src/controllers/carts.js
  · чужая корзина — 404 — src/controllers/carts.js
POST /carts/:id/items — src/controllers/carts.js
  · количество от 1 до 99 — src/validators/cart.js
DELETE /carts/:id/items/:itemId — src/controllers/carts.js
  · удаление отсутствующей позиции — 204 — src/controllers/carts.js
⟹ эндпоинтов 3, из них с фактами 3
