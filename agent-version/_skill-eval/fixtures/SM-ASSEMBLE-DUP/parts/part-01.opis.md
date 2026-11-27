<!-- service-map: часть 01 2026-10-19 -->
GET /api/nights/free-count — src/spec/openapi.yaml + src/nights/nights.controller.ts
потребляет sky.cloud-alert — src/weather/cloud-alert.consumer.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
ShiftLogEntry — src/shifts/shift-log.entry.ts (@Entity)
Telescope — src/telescopes/telescope.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED — src/reservations/reservation.entity.ts
  · REQUESTED — при создании брони — src/reservations/reservations.service.ts
сообщение: «бронь изменена» — подписчикам, telescope.reservation.events — src/reservations/outbox.ts
⟹ эндпоинтов 1, из них с фактами 1
⟹ состояний 1 (значений 2), справочников 0, сообщений 1, ограничений 0
