## Операции

mutation addGroup(groupInput) — groups/GroupsResolver.java
  · куратор обязателен — groups/GroupsService.java
mutation saveTask — tasks/TasksResolver.java
  · контрольный срок обязателен — tasks/TaskService.java
query goal(goalId: UUID!) — goal/GoalResolver.java
  · отклонённая цель недоступна — goal/GoalService.java
subscription listenNotifications — notifications/NotificationResolver.java
GET /api/files/{name}(v2) — files/FileController.java
query metrics(goalId: UUID!) — goal/GoalResolver.java
⟹ операций 6, из них с фактами 3
