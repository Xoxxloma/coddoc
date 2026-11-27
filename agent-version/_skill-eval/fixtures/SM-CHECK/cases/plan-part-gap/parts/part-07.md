<!-- service-map: часть 07 2026-10-06 -->

## Публичный контракт

### `GET /api/task-manager/users`
- только активные

### `POST /api/task-manager/users`
- логин уникален

### `GET /api/task-manager/users/{id}`
- нет пользователя — 404

### `PUT /api/task-manager/users/{id}`
- роль меняет только админ

### `DELETE /api/task-manager/users/{id}`
Удаление пользователя.

## Владеет данными

### `UserEntity`
- id: UUID
