<!-- service-map: часть 06 2026-10-06 -->

## Публичный контракт

### `GET /tasks`
- возвращает задачи пользователя

### `POST /tasks`
- без шаблона — отказ 400

### `GET /tasks/{taskId}`
- чужая задача — 403

### `PATCH /api/task-manager/tasks/{taskId}`
- закрытую задачу менять нельзя

## Владеет данными

### `TaskEntity`
- id: UUID

### `StepZopEntity`
- id: UUID
