<!-- service-map: часть 01 2026-10-08 -->
GET /api/tasks — src/main/java/web/TaskController.java
  · список только своих задач — src/main/java/web/TaskController.java
POST /api/tasks — src/main/java/web/TaskController.java
  · без шаблона — отказ 400 — src/main/java/web/TaskController.java
GET /api/tasks/{id} — src/main/java/web/TaskController.java
  · чужая задача — 403 — src/main/java/web/TaskController.java
DELETE /api/tasks/{id} — src/main/java/web/TaskController.java
  · закрытую удалить нельзя — src/main/java/web/TaskController.java
⟹ эндпоинтов 4, из них с фактами 4
