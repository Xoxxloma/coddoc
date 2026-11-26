<!-- service-map: часть 02 2026-10-19 -->
## Публичный контракт

### `GET /api/nights/{id}`
Ночь наблюдений.
- ночь, закрытая по погоде, — ошибка доступа

### `GET /api/observers/{observerId}`
Один наблюдатель (маршрут под `v2`).
- `observerId` (path, uuid)

### `GET /files/{name}`
Снимок по имени файла.
- `name` (path, строка)
