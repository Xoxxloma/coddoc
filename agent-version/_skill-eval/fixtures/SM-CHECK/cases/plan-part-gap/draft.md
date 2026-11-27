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

### `PATCH /api/task-manager/tasks/{taskId}`
- закрытую задачу менять нельзя

### `GET /tasks`
- возвращает задачи пользователя

### `POST /tasks`
- без шаблона — отказ 400

### `GET /tasks/{taskId}`
- чужая задача — 403

## Владеет данными

### `StepZopEntity`
- id: UUID

### `TaskEntity`
- id: UUID

### `UserEntity`
- id: UUID

## Роли и доступ
| Роль | Что может |
|---|---|
| `ADMIN` | всё |
