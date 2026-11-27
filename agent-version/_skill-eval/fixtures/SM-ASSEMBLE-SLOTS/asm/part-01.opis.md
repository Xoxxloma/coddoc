<!-- service-map: часть 01 2026-10-21 -->
POST /api/reservations/cancel — src/reservations/ReservationController.java
  доступ: NIGHT_OPERATOR — src/reservations/ReservationController.java
  меняет: Reservation.status CONFIRMED → CANCELLED — src/reservations/ReservationService.java
  шлёт: telescope.reservation.cancelled — при отмене — src/reservations/ReservationService.java
публикует telescope.reservation.cancelled — src/outbox/OutboxJob.java
зависит: dome-control — состояние купола — src/reservations/DomeClient.java
⟹ эндпоинтов 1, из них с фактами 1
