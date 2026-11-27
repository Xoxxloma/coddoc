## Сущности

Session — domain/Session.kt (@Entity)
Device — domain/Device.kt (@Entity)

## Бизнес-правила

состояние: Session.status ACTIVE | EXPIRED | REVOKED — domain/Session.kt
состояние: Session открыта / закрыта (openedAt, closedAt) — domain/Session.kt
состояние: `Session`.kind WEB | MOBILE — domain/Session.kt
состояние: Device.state NEW | TRUSTED — domain/Device.kt
справочник: Device.os IOS | ANDROID — domain/Device.kt

⟹ сущностей 2
⟹ состояний 4 (значений 9), справочников 1
