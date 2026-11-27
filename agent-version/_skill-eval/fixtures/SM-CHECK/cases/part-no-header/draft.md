# svc — backend

## Публичный контракт

### `GET /api/tasks`
- список только своих задач

### `POST /api/tasks`
- без шаблона — отказ 400

### `GET /api/tasks/{id}`
- чужая задача — 403

### `DELETE /api/tasks/{id}`
- закрытую удалить нельзя

### `GET /api/dict/regions`
- только активные регионы

### `GET /api/dict/statuses`

### `GET /api/dict/priorities`

### `GET /api/dict/territories`

### `GET /api/dict/causes`

