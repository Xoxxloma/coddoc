GET /api/nights — src/nights/nights.controller.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED | CANCELLED — src/reservations/reservation.entity.ts
  · CANCELLED — по облачности — src/weather/cancel.ts
сообщение: «бронь подтверждена» — наблюдателю, telescope.reservation.events — src/reservations/outbox.ts
сообщение: «письмо об отмене» — наблюдателю, sendCancelMail — src/mail/mailer.ts
сообщение: «напоминание о ночи» — наблюдателю, sendNightReminder, night-reminder.html — src/mail/mailer.ts

Dome — src/domes/dome.entity.ts (@Entity)
состояние: Dome.state OPEN | CLOSED — src/domes/dome.entity.ts
Filter — src/filters/filter.entity.ts (@Entity)
  меняет: Filter.kind → NARROW — src/filters/filters.service.ts

