# опись shop-web (frontend)

## экраны

/ — src/App.tsx
/cart — src/App.tsx
  · корзина хранится локально — src/cart.ts
/orders/:id — src/App.tsx
/profile — src/App.tsx
⟹ экранов 4, из них с фактами 1

## вызовы

GET /v1/items — src/api/items.ts
POST /v1/orders — src/api/orders.ts
GET /search — src/geo.ts
⟹ вызовов 3

## роли

CUSTOMER — src/roles.ts
без входа — src/App.tsx

## внешние узлы

geo.example.org — src/geo.ts

## клиентское состояние

состояние: корзина — localStorage — src/cart.ts
