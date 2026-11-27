POST /api/reservations/{id}/confirm — src/reservations/reservations.controller.ts
  · подтверждает заявку и открывает купол — src/reservations/reservations.service.ts
  меняет: Reservation.status REQUESTED → CONFIRMED — src/reservations/reservations.service.ts
  меняет: Observer.active → false — src/observers/observers.service.ts
  меняет: Night.moonPhase → FULL — src/nights/nights.service.ts
  меняет: Filter.kind → NARROW — src/filters/filters.service.ts
Reservation — src/reservations/reservation.entity.ts (@Entity)
Dome — src/dome/dome.entity.ts (@Entity)
Observer — src/observers/observer.entity.ts (@Entity)
Night — src/nights/night.entity.ts (@Entity)
Filter — src/filters/filter.entity.ts (@Entity)
состояние: Reservation.status REQUESTED | CONFIRMED | CANCELLED — src/reservations/reservation.entity.ts
справочник: Night.moonPhase NEW | QUARTER | FULL — src/nights/night.entity.ts

⟹ эндпоинтов 1, из них с фактами 1
⟹ сущностей 5
⟹ состояний 1 (значений 3), справочников 1
