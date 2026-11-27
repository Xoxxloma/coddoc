<!-- service-map: часть 01 2026-10-19 -->
GET /api/nights — src/nights/nights.controller.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED | CANCELLED — src/reservations/reservation.entity.ts
  · CANCELLED — по облачности — src/weather/cancel.ts
сообщение: «бронь подтверждена» — наблюдателю, telescope.reservation.events — src/reservations/outbox.ts
сообщение: «письмо об отмене» — наблюдателю, sendCancelMail — src/mail/mailer.ts
сообщение: «напоминание о ночи» — наблюдателю, sendNightReminder, night-reminder.html — src/mail/mailer.ts
