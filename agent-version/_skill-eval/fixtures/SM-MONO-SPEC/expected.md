# SM-MONO-SPEC — правда фикстуры

Репа `casedesk`: дерево SM-MONO-DGS плюс надстройка `make.sh` этой папки. Числа напечатаны `make.sh`
по собранному дереву.

| Класс | Правда | Откуда |
|---|---|---|
| контракт | **148** | 120 базы (104 DGS + 16 REST с аннотациями) + 28 операций `openapi.yaml`, реализованных в `v2/{checks,findings,sanctions,templates,groups}/web/*DeskApiController.java` (`implements …DeskApi`, без аннотаций маршрутов) |
| сущности | **60** | как в базе |
| задачи | **10** | как в базе |
| топики | **12** | `src/main/resources/application.yaml`, как в базе |

## Чего в карточке быть не должно

| Что | Сколько | Где |
|---|---|---|
| операции, объявленные без реализации | 2 | `GET /api/desk/archive/{id}`, `POST /api/desk/archive/{id}/restore` — только в `openapi.yaml` |
| топики тестового конфига | 4 | `kontrol.test.intake.v1`, `kontrol.test.reopen.v1`, `kontrol.test.status.v1`, `kontrol.test.finding.v1` — `src/test/resources/application.yaml` |
| один ключ дважды | 0 повторов | операция объявлена в `resources/`, реализована в папке модуля |

Счёт по аннотациям маршрутов видит 16 REST-операций из 44.

## Вариант с клиентской спекой

`bash make.sh <куда> --with-client` добавляет `src/main/resources/neighbour.yaml`, генератор
`java`/`resttemplate` с этим `inputSpec` и `integration/NeighbourGateway.java`. Серверный генератор
`spring` по-прежнему читает `openapi.yaml`. Правда всех классов прежняя: контракт **148**, клиентские
**6** операций не считаются. Четыре `operationId` и часть путей повторяют серверные: исключать по
имени операции нельзя, область маркерного поиска — точный серверный файл.

Маркер `^\s+operationId:` в серверном файле даёт **30** объявлений, из них **28** реализованы;
глобальный поиск по `*.yaml` в варианте даёт **36**. Два объявления без реализации остаются
пометками `> объявлено без реализации:`, клиентские вызовы — за пределами публичного контракта.
Операции спеки берёт часть с её маркером; если маркера нет — часть с реализацией. Повторов нет.
Источник реализованной операции в описи — `openapi.yaml` + обработчик; две строки без реализации
учитываются только в сверке источников спеки, не в ключах и гейте. При полной описи дефицита по файлу нет.

Без моделей: `bash test-spec.sh` — проверяет оба дерева, связь генератора с файлом, реализации,
пересечение имён и исключение клиентских операций из счёта с заданной областью.

## Вариант с большой спекой

`bash make.sh <куда> --big-spec` — как прод adjutant 2026-10-08: спека на ~100 операций, реализации без
аннотаций маршрутов. `src/main/resources/openapi.yaml` описывает **100** операций: по 14 у семи модулей
(`checks`, `findings`, `sanctions`, `templates`, `groups`, `reports`, `notifications`) и две архивные без
реализации, как в базе. 98 реализованы в `v2/<модуль>/web/*DeskApiController.java` (`implements …DeskApi`,
`@Override`, без аннотаций маршрутов); 28 операций базы этим вариантом заменены.

| Класс | Правда | Откуда |
|---|---|---|
| контракт | **218** | 120 базы (104 DGS + 16 REST с аннотациями) + 98 реализованных операций `openapi.yaml` |
| сущности / задачи / топики | 60 / 10 / 12 | как в базе |

Чего в карточке быть не должно — как в базе: `GET /api/desk/archive/{id}`,
`POST /api/desk/archive/{id}/restore`, четыре топика `kontrol.test.*.v1`.

Факты. У каждой реализованной операции в методе контроллера ровно одна ветка: условие → исключение с
кодом — 403 ×21 (нет права), 404 ×15, 409 ×19, 422 ×34, 423 ×9. Ключ ответов — `big-spec-key.tsv` рядом с
`make.sh` (98 строк: глагол, путь, operationId, код, вид, анкер); по нему же `make.sh` собирает спеку и
контроллеры, в дерево он не едет. Анкер — имя поля тела или записи (`inspectionDate`, `signedAt`) либо
строка права (`CHECKS_REGISTRY_READ`): в дереве он встречается только в методе своей операции, в спеке
его нет. Факт засчитан, если в блоке своей операции в карточке есть и анкер, и код.

Раннер вариантов не знает: на раунд `fixtures/SM-MONO-SPEC/out` собирается с `--big-spec` и после
возвращается обычным. `grade-sm-mono.mjs` узнаёт вариант по дереву песочницы (все operationId ключа есть
в её `openapi.yaml`) или по `_variant.txt` раунда с `--big-spec`. `bash test-spec.sh` проверяет и это
дерево: 100 операций, 98 реализаций в семи контроллерах, нет аннотаций маршрутов, ключ ↔ спека ↔
методы, каждый анкер — только в методе своей операции, контракт 218.

## Вариант «владение по файлу»

`bash make.sh <куда> --owners` (стенд держит дерево в `out/owners`) — то, на чём нарезка теряла ключи и двоила
сущности:

| Что | Где | Правда |
|---|---|---|
| ручки JAX-RS (`@Path` + `@GET`/`@PUT`), других пометок в папках нет; регистрирует их `v2/config/JerseyConfig.java` | `v2/inspectors/web/InspectorResource.java` (4), `v2/regions/web/RegionCatalogResource.java` (2) | в контракте все 6 |
| общие сущности: лежат в папках ручек JAX-RS, их же возвращают ручки модулей | `InspectorEntity` ← `v2/checks/web/CheckAssigneeController.java`; `RegionEntity`, `OfficeEntity` ← `v2/findings/web/FindingRegionController.java` | по одному блоку на сущность |
| поля из базового класса `@MappedSuperclass` (`id`, `createdAt`, `updatedAt`, `createdBy`) | `v2/common/persistence/AuditedEntity.java`; наследуют три общие сущности и `SanctionAppealEntity`, `TemplateVersionEntity`, `GroupMemberEntity` | в перечне полей каждой из шести |

Правда классов: контракт **156** (148 + 6 JAX-RS + 2 ручки модулей), сущности **66** (60 + 6), задачи **10**, топики
**12**. Грейдер — `grade-sm-mono.mjs`, фикстура `SM-MONO-SPEC-OWN`: строки «ручки без пометок разведчика», «поля из
базового класса», «общие сущности» и «повторов» у сущностей.

## Вариант «сквозные факты»

`bash make.sh <куда> --crosscut` (стенд держит дерево в `out/crosscut`) — роли, переходы и отправки лежат там, где
их используют, а не там, где объявлены (раздел 6 `make.sh`):

| Что | Где | Правда |
|---|---|---|
| статус проверки `InspectionStatus` — пять значений | ставят `v2/inspections/service/InspectionService.java` (PLANNED, STARTED, PAUSED, FINISHED, CANCELLED), `v2/scheduling/InspectionTimeoutJob.java` (CANCELLED), `v2/integration/consumer/InspectionHaltProcessor.java` (PAUSED) | блок `InspectionEntity` в «Бизнес-правилах», строка на каждое значение, ни одно не «не определено» |
| роли на ручках | `@PreAuthorize` в `v2/inspections/web/InspectionController.java`: PLANNER, INSPECTOR, SUPERVISOR | строки ролей и `доступ:` у ручек |
| правило по шаблону пути | `v2/config/SecurityConfig.java`: `/api/admin/**` → ADMIN | роль ADMIN у `GET /api/admin/inspections/stats` |
| роль внутри объекта | `InspectorRole.LEAD` в `v2/inspections/service/InspectionAccess.java` — завершить может руководитель проверки | строка роли LEAD, `доступ:` у `POST /api/inspections/{id}/finish` |
| ручка без проверки | `GET /api/inspections/{id}` | строка «без входа» |
| отправки | общий отправитель `InspectionEventPublisher.publishStarted` → `kontrol.inspection.started.v1`; outbox → `OutboxRelayJob` → `kontrol.inspection.finished.v1`; письмо `inspection-report` | блок-сообщение на каждую; метки у блоков «публикует» |
| копия статуса и справочник | `InspectionHistoryEntity.status` (переписывается из проверки), `Urgency` (LOW, HIGH) | блоков в «Бизнес-правилах» нет |
| клиент к соседу | `v2/inspections/client/RegistryClient.java` — `registry-service` | строка «Зависит от»; БД и брокера там нет |

Правда классов: контракт **155** (148 + 7), сущности **64** (60 + 4), задачи **12** (10 + 2), топики **15** (12 + 3).
Грейдер — `grade-sm-mono.mjs`, фикстура `SM-MONO-SPEC-CROSS`.
