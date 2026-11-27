GET /carts/:id — src/routes/index.js + src/controllers/carts.js
  · чужая корзина — 404 — src/controllers/carts.js
POST /carts/:id/items — src/routes/index.js + src/controllers/carts.js
  · количество от 1 до 99 — src/validators/cart.js
DELETE /carts/:id/items/:itemId — src/routes/index.js + src/controllers/carts.js
  · удаление отсутствующей позиции — 204 — src/controllers/carts.js
⟹ эндпоинтов 3, из них с фактами 3
> пройдено: папка /w/shop/src/controllers — ключей 0
