<!-- service-map: часть 07 2026-10-06 -->
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
