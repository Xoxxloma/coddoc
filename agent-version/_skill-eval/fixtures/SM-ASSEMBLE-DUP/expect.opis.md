night_operator — src/security/roles.ts

GET /api/nights/free-count — src/spec/openapi.yaml + src/nights/nights.controller.ts
потребляет sky.cloud-alert — src/weather/cloud-alert.consumer.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
ShiftLogEntry — src/shifts/shift-log.entry.ts (@Entity)
Telescope — src/telescopes/telescope.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED — src/reservations/reservation.entity.ts
  · REQUESTED — при создании брони — src/reservations/reservations.service.ts
  · CONFIRMED — оператором — src/reservations/reservations.service.ts
сообщение: «бронь изменена» — подписчикам, telescope.reservation.events — src/reservations/outbox.ts

GET /api/nights/free-count?telescopeId= — src/spec/openapi.yaml + src/nights/nights.controller.ts
  · ответ кэшируется на минуту — src/nights/nights.controller.ts
потребляет sky.cloud-alert — src/reservations/weather-cancel.listener.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
ShiftLogEntry — src/shifts/shift-log.entry.ts (@Entity)
Telescope — src/telescopes/telescope.entity.ts (@Entity)
Dome — src/domes/dome.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED | CANCELLED — src/reservations/reservation.entity.ts

⟹ эндпоинтов 2, из них с фактами 2
⟹ состояний 2 (значений 5), справочников 0, сообщений 1, ограничений 0
