---
service: casedesk
type: backend
repo: ../casedesk
scanned: 2026-10-04
description: синтетика самопроверки
---
# casedesk — backend

## Назначение

Синтетика.

## Бизнес-правила

### `Attachments0Entity` — объект
- статус: NEW → DONE

### `Attachments1Entity` — объект
- статус: NEW → DONE

### `Cases0Entity` — объект
- статус: NEW → DONE

## Публичный контракт

### `GET /api/v1/cases/{id}`
- сущности: → не сущность

### `POST /api/v1/cases`
- сущности: → не сущность

### `GET /api/v1/dictionaries`
- сущности: → не сущность

### `PUT /api/v1/dictionaries/:id`
- сущности: → не сущность

### `GET /api/v1/files/{id}`
- сущности: → не сущность

### `POST /api/v1/files`
- сущности: → не сущность

### `DELETE /api/v1/files/{id}`
- сущности: → не сущность

### `GET /health`
- сущности: → не сущность

### `POST /api/v1/import`
- сущности: → не сущность

### `PUT /api/v1/import/:id`
- сущности: → не сущность

### `GET /users/{id}`
- сущности: → не сущность

### `POST /users/search`
- сущности: → не сущность

### `query findattachments0`
- сущности: → не сущность

### `Mutation.saveattachments1`
- сущности: → не сущность

### `saveattachments2 (mutation)`
- сущности: → не сущность

### `mutation archiveattachments3`
- сущности: → не сущность

### `Query.findcases0`
- сущности: → не сущность

### `findcases1 (query)`
- сущности: → не сущность

### `query findcases2`
- сущности: → не сущность

### `Query.findcases3`
- сущности: → не сущность

### `findcases4 (query)`
- сущности: → не сущность

### `query findcases5`
- сущности: → не сущность

### `Query.findcases6`
- сущности: → не сущность

### `findcases7 (query)`
- сущности: → не сущность

### `query findcases8`
- сущности: → не сущность

### `Query.findcases9`
- сущности: → не сущность

### `savecases10 (mutation)`
- сущности: → не сущность

### `mutation savecases11`
- сущности: → не сущность

### `Mutation.savecases12`
- сущности: → не сущность

### `savecases13 (mutation)`
- сущности: → не сущность

### `mutation savecases14`
- сущности: → не сущность

### `Mutation.savecases15`
- сущности: → не сущность

### `savecases16 (mutation)`
- сущности: → не сущность

### `mutation savecases17`
- сущности: → не сущность

### `Mutation.savecases18`
- сущности: → не сущность

### `casespage19 (query)`
- сущности: → не сущность

### `query casespage20`
- сущности: → не сущность

### `Query.casespage21`
- сущности: → не сущность

### `casespage22 (query)`
- сущности: → не сущность

### `mutation archivecases23`
- сущности: → не сущность

### `Mutation.archivecases24`
- сущности: → не сущность

### `archivecases25 (mutation)`
- сущности: → не сущность

### `query findchecks0`
- сущности: → не сущность

### `Query.findchecks1`
- сущности: → не сущность

### `findchecks2 (query)`
- сущности: → не сущность

### `query findchecks3`
- сущности: → не сущность

### `Query.findchecks4`
- сущности: → не сущность

### `savechecks5 (mutation)`
- сущности: → не сущность

### `mutation savechecks6`
- сущности: → не сущность

### `Mutation.savechecks7`
- сущности: → не сущность

### `savechecks8 (mutation)`
- сущности: → не сущность

### `query checkspage9`
- сущности: → не сущность

### `Query.checkspage10`
- сущности: → не сущность

### `archivechecks11 (mutation)`
- сущности: → не сущность

### `query findcomments0`
- сущности: → не сущность

### `Mutation.savecomments1`
- сущности: → не сущность

### `savecomments2 (mutation)`
- сущности: → не сущность

### `query finddictionaries0`
- сущности: → не сущность

### `Query.finddictionaries1`
- сущности: → не сущность

### `finddictionaries2 (query)`
- сущности: → не сущность

### `query finddictionaries3`
- сущности: → не сущность

### `Mutation.savedictionaries4`
- сущности: → не сущность

### `savedictionaries5 (mutation)`
- сущности: → не сущность

### `query dictionariespage6`
- сущности: → не сущность

### `Query.findfindings0`
- сущности: → не сущность

### `findfindings1 (query)`
- сущности: → не сущность

### `query findfindings2`
- сущности: → не сущность

### `Mutation.savefindings3`
- сущности: → не сущность

### `savefindings4 (mutation)`
- сущности: → не сущность

### `mutation savefindings5`
- сущности: → не сущность

### `Query.findingspage6`
- сущности: → не сущность

### `archivefindings7 (mutation)`
- сущности: → не сущность

### `query findgroups0`
- сущности: → не сущность

### `Query.findgroups1`
- сущности: → не сущность

### `savegroups2 (mutation)`
- сущности: → не сущность

### `mutation savegroups3`
- сущности: → не сущность

### `Mutation.savegroups4`
- сущности: → не сущность

### `groupspage5 (query)`
- сущности: → не сущность

### `mutation archivegroups6`
- сущности: → не сущность

### `Query.findhistory0`
- сущности: → не сущность

### `historypage1 (query)`
- сущности: → не сущность

### `POST /api/v2/integration/webhook/:id`
- сущности: → не сущность

### `Query.findnotifications0`
- сущности: → не сущность

### `savenotifications1 (mutation)`
- сущности: → не сущность

### `subscription notificationschanged2`
- сущности: → не сущность

### `Subscription.notificationschanged3`
- сущности: → не сущность

### `findreports0 (query)`
- сущности: → не сущность

### `query findreports1`
- сущности: → не сущность

### `Query.findreports2`
- сущности: → не сущность

### `reportspage3 (query)`
- сущности: → не сущность

### `GET /api/v2/reports/export/xlsx/{id}`
- сущности: → не сущность

### `GET /api/v2/reports/export/pdf/:id`
- сущности: → не сущность

### `GET /api/v2/reports/export/csv/{id}`
- сущности: → не сущность

### `query findsanctions0`
- сущности: → не сущность

### `Query.findsanctions1`
- сущности: → не сущность

### `findsanctions2 (query)`
- сущности: → не сущность

### `mutation savesanctions3`
- сущности: → не сущность

### `Mutation.savesanctions4`
- сущности: → не сущность

### `savesanctions5 (mutation)`
- сущности: → не сущность

### `query sanctionspage6`
- сущности: → не сущность

### `Mutation.archivesanctions7`
- сущности: → не сущность

### `findsettings0 (query)`
- сущности: → не сущность

### `mutation savesettings1`
- сущности: → не сущность

### `Query.findsla0`
- сущности: → не сущность

### `savesla1 (mutation)`
- сущности: → не сущность

### `query findtemplates0`
- сущности: → не сущность

### `Query.findtemplates1`
- сущности: → не сущность

### `savetemplates2 (mutation)`
- сущности: → не сущность

### `mutation savetemplates3`
- сущности: → не сущность

### `Mutation.archivetemplates4`
- сущности: → не сущность

### `findterritory0 (query)`
- сущности: → не сущность

### `query territorypage1`
- сущности: → не сущность

### `Query.findusers0`
- сущности: → не сущность

### `findusers1 (query)`
- сущности: → не сущность

### `query findusers2`
- сущности: → не сущность

### `Mutation.saveusers3`
- сущности: → не сущность

### `saveusers4 (mutation)`
- сущности: → не сущность

### `mutation saveusers5`
- сущности: → не сущность

### `Query.userspage6`
- сущности: → не сущность

### `archiveusers7 (mutation)`
- сущности: → не сущность

## События

### публикует `kontrol.case.intake.v1`
- ключ: caseId

### публикует `kontrol.case.reopen.v1`
- ключ: caseId

### потребляет `kontrol.registry.person.v1`
- ключ: caseId

### потребляет `kontrol.registry.org.v1`
- ключ: caseId

### потребляет `kontrol.court.decision.v1`
- ключ: caseId

### потребляет `kontrol.court.appeal.v1`
- ключ: caseId

### потребляет `kontrol.payment.fine.v1`
- ключ: caseId

### потребляет `kontrol.geo.region.v1`
- ключ: caseId

### публикует `kontrol.case.status.v1`
- ключ: caseId

### публикует `kontrol.finding.created.v1`
- ключ: caseId

### публикует `kontrol.sanction.issued.v1`
- ключ: caseId

### публикует `kontrol.notification.outbound.v1`
- ключ: caseId

## Фоновые задачи

### `OutboxJob0`
- расписание: cron

### `OutboxJob1.run`
- расписание: cron

### `ReportsJob0`
- расписание: cron

### `SlaJob0.run`
- расписание: cron

### `SlaJob1`
- расписание: cron

### `SlaJob2.run`
- расписание: cron

### `SlaJob3`
- расписание: cron

### `SlaJob4.run`
- расписание: cron

### `SlaJob5`
- расписание: cron

### `SlaJob6.run`
- расписание: cron

## Владеет данными

### `Attachments0Entity` — сущность
- id: UUID

### `Attachments1Entity` — сущность
- id: UUID

### `Cases0Entity` — сущность
- id: UUID

### `Cases10Entity` — сущность
- id: UUID

### `cd_cases_11` — сущность
- id: UUID

### `Cases12Entity` — сущность
- id: UUID

### `Cases1Entity` — сущность
- id: UUID

### `Cases2Entity` — сущность
- id: UUID

### `Cases3Entity` — сущность
- id: UUID

### `cd_cases_4` — сущность
- id: UUID

### `Cases5Entity` — сущность
- id: UUID

### `Cases6Entity` — сущность
- id: UUID

### `Cases7Entity` — сущность
- id: UUID

### `Cases8Entity` — сущность
- id: UUID

### `cd_cases_9` — сущность
- id: UUID

### `Checks0Entity` — сущность
- id: UUID

### `Checks1Entity` — сущность
- id: UUID

### `Checks2Entity` — сущность
- id: UUID

### `Checks3Entity` — сущность
- id: UUID

### `cd_checks_4` — сущность
- id: UUID

### `Checks5Entity` — сущность
- id: UUID

### `Comments0Entity` — сущность
- id: UUID

### `Dictionaries0Entity` — сущность
- id: UUID

### `Dictionaries1Entity` — сущность
- id: UUID

### `cd_dictionaries_2` — сущность
- id: UUID

### `Dictionaries3Entity` — сущность
- id: UUID

### `Dictionaries4Entity` — сущность
- id: UUID

### `Dictionaries5Entity` — сущность
- id: UUID

### `Findings0Entity` — сущность
- id: UUID

### `cd_findings_1` — сущность
- id: UUID

### `Findings2Entity` — сущность
- id: UUID

### `Findings3Entity` — сущность
- id: UUID

### `Findings4Entity` — сущность
- id: UUID

### `Groups0Entity` — сущность
- id: UUID

### `cd_groups_1` — сущность
- id: UUID

### `History0Entity` — сущность
- id: UUID

### `Integration0Entity` — сущность
- id: UUID

### `Integration1Entity` — сущность
- id: UUID

### `Notifications0Entity` — сущность
- id: UUID

### `cd_notifications_1` — сущность
- id: UUID

### `Outbox0Entity` — сущность
- id: UUID

### `Reports0Entity` — сущность
- id: UUID

### `Reports1Entity` — сущность
- id: UUID

### `Reports2Entity` — сущность
- id: UUID

### `cd_sanctions_0` — сущность
- id: UUID

### `Sanctions1Entity` — сущность
- id: UUID

### `Sanctions2Entity` — сущность
- id: UUID

### `Sanctions3Entity` — сущность
- id: UUID

### `Settings0Entity` — сущность
- id: UUID

### `cd_sla_0` — сущность
- id: UUID

### `Templates0Entity` — сущность
- id: UUID

### `Templates1Entity` — сущность
- id: UUID

### `Templates2Entity` — сущность
- id: UUID

### `Territory0Entity` — сущность
- id: UUID

### `cd_territory_1` — сущность
- id: UUID

### `Users0Entity` — сущность
- id: UUID

### `Users1Entity` — сущность
- id: UUID

### `Users2Entity` — сущность
- id: UUID

### `Users3Entity` — сущность
- id: UUID

### `cd_users_4` — сущность
- id: UUID

## Зависит от

| Сервис или система | Зачем |
|---|---|
| — | |
