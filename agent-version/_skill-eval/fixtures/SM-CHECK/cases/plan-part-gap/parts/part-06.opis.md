<!-- service-map: часть 06 2026-10-06 -->
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
