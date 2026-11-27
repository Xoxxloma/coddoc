GET /tasks — v2/tasks/controller/TaskController.java
  · возвращает задачи пользователя — v2/tasks/TaskService.java
POST /tasks — v2/tasks/controller/TaskController.java
  · без шаблона отказ 400 — v2/tasks/TaskService.java
GET /tasks/{taskId} — v2/tasks/controller/TaskController.java
  · чужая задача — 403 — v2/tasks/permission/TaskPermissions.java
PATCH /api/task-manager/tasks/{taskId} — v2/tasks/controller/TaskController.java
  · закрытую задачу менять нельзя — v2/tasks/TaskService.java
TaskEntity — v2/tasks/storage/TaskEntity.java (@Entity)
StepZopEntity — `v2/tasks/storage/StepZopEntity.java` (@Entity)
⟹ эндпоинтов 4, из них с фактами 4
GET /api/task-manager/users — v2/users/UserController.java
  · только активные — v2/users/UserService.java
POST /api/task-manager/users — v2/users/UserController.java
  · логин уникален — v2/users/UserService.java
GET /api/task-manager/users/{id} — v2/users/UserController.java
  · нет пользователя — 404 — v2/users/UserController.java
PUT /api/task-manager/users/{id} — v2/users/UserController.java
  · роль меняет только админ — v2/users/UserPermissions.java
DELETE /api/task-manager/users/{id} — v2/users/UserController.java
  · мягкое удаление: active = false — v2/users/UserService.java
UserEntity — v2/users/UserEntity.java (@Entity)
