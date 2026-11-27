# desk — backend

## Публичный контракт

### mutation addGroup
сущности: ← GroupInput · → GroupEntity
- куратор обязателен

### `mutation saveTask(taskRequest)`
сущности: ← TaskRequest · → TaskEntity

### `query goal`
- отклонённая цель недоступна

### `subscription listenNotifications(currentUserId: String!)`
- только свои уведомления

### `GET /api/files/{name}(v2)`
- отдаёт файл
