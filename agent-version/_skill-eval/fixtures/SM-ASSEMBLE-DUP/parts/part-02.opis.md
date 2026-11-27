<!-- service-map: часть 02 2026-10-19 -->
GET /api/nights/free-count?telescopeId= — src/spec/openapi.yaml + src/nights/nights.controller.ts
  · ответ кэшируется на минуту — src/nights/nights.controller.ts
потребляет sky.cloud-alert — src/reservations/weather-cancel.listener.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
ShiftLogEntry — src/shifts/shift-log.entry.ts (@Entity)
Telescope — src/telescopes/telescope.entity.ts (@Entity)
Dome — src/domes/dome.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED — src/reservations/reservation.entity.ts
  · CONFIRMED — оператором — src/reservations/reservations.service.ts
состояние: Reservation.status REQUESTED | CONFIRMED | CANCELLED — src/reservations/reservation.entity.ts
⟹ эндпоинтов 1, из них с фактами 1
⟹ состояний 1 (значений 3), справочников 0, сообщений 0, ограничений 0
