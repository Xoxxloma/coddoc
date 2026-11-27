GET /api/tasks — src/main/java/web/TaskController.java
  · список только своих задач — src/main/java/web/TaskController.java
POST /api/tasks — src/main/java/web/TaskController.java
  · без шаблона — отказ 400 — src/main/java/web/TaskController.java
GET /api/tasks/{id} — src/main/java/web/TaskController.java
  · чужая задача — 403 — src/main/java/web/TaskController.java
DELETE /api/tasks/{id} — src/main/java/web/TaskController.java
  · закрытую удалить нельзя — src/main/java/web/TaskController.java
⟹ эндпоинтов 4, из них с фактами 4
GET /api/dict/regions — src/main/resources/openapi.yaml + src/main/java/web/DictController.java
  · только активные регионы — src/main/java/web/DictController.java
GET /api/dict/statuses — src/main/resources/openapi.yaml + src/main/java/web/DictController.java
GET /api/dict/priorities — src/main/resources/openapi.yaml + src/main/java/web/DictController.java
GET /api/dict/territories — src/main/resources/openapi.yaml + src/main/java/web/DictController.java
GET /api/dict/causes — src/main/resources/openapi.yaml + src/main/java/web/DictController.java
⟹ эндпоинтов 5, из них с фактами 1
