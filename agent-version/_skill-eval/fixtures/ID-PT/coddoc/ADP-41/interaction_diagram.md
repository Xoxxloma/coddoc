# Схема взаимодействий — ADP-41

> Проекция INT-карточек `technical_specification.md`, по стрелке на звено границы; порядок стрелок —
> по номерам карточек, не по времени. Руками не править: изменились карточки — перерисуй скиллом `interaction-diagram`.

```mermaid
sequenceDiagram
    participant S1 as Кабинет волонтёра
    participant S2 as Реестр животных
    participant S3 as Календарь знакомств
    participant S4 as СМС-шлюз
    S1->>S2: INT-1 · POST /v1/animals/{id}/photos
    S3->>S4: INT-2 · POST /v1/sms
```
