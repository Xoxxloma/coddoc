# SM-MONO-DGS — правда фикстуры

Репа `casedesk`: одно приложение, 1052 java-файла, 17 схем `*.graphqls`, один `application.yaml`.
Числа ниже напечатаны `make.sh` по собранному дереву (`grep`), а не взяты из замысла.

## Ключи по всей репе

| Класс | Правда | Чем меряется | Что даёт наивный маркер |
|---|---|---|---|
| контракт | **120** | `@(Get\|Post\|Put\|Patch\|Delete)Mapping\(` 16 + `@Dgs(Query\|Mutation\|Subscription)\b` 80 + `@DgsData\(parentType\s*=\s*"(Query\|Mutation\|Subscription)"` 24 | только REST — **16**; `@Dgs(Query\|Mutation\|Subscription\|Data)\b` + REST — **192**; + `@Query\(` — **164**; + `@DgsComponent` — **175**; `@(…\|Request)Mapping\(` + DGS — **125**; `DgsQuery\b` без `@` — 72 вместо 42 (ловит 30 строк `import`) |
| сущности | **60** | `@Entity\b` | `@Entity\b\|@Table\(` — **120** |
| задачи | **10** | `@Scheduled\(` | `@EnableScheduling` — 1 (не задача) |
| топики | **12** | `kontrol\.[a-z]+\.[a-z]+\.v1` в `application.yaml` | `class \w+EventProcessor\b` — **6** (5 + абстрактный); `*KafkaProducer` — 4; `topics?:` — 9; элементы списков `^\s+- ` — 8 (только потребляемые); `kontrol\.` — 13 (+ строка `logging.level.ru.kontrol.casedesk`) |

Разбивка контракта: `@DgsQuery` 42, `@DgsMutation` 36, `@DgsSubscription` 2, `@DgsData(parentType =
"Query")` 14, `@DgsData(parentType = "Mutation")` 10; REST по глаголам — GET 8, POST 5, PUT 2, DELETE 1
(12 в `controllers/`, 3 GET в `v2/reports/web`, 1 POST в `v2/integration/web`).

Топики: потребляемые (8) — `kontrol.case.intake.v1`, `kontrol.case.reopen.v1`,
`kontrol.registry.person.v1`, `kontrol.registry.org.v1`, `kontrol.court.decision.v1`,
`kontrol.court.appeal.v1`, `kontrol.payment.fine.v1`, `kontrol.geo.region.v1` — группы `intake`,
`registry`, `court` по два, `payment`, `geo` по одному; публикуемые (4) — `kontrol.case.status.v1`,
`kontrol.finding.created.v1`, `kontrol.sanction.issued.v1`, `kontrol.notification.outbound.v1`.

## Ловушки поимённо

| Пометка | Сколько | Где | Почему не ключ |
|---|---|---|---|
| `@DgsData(parentType = "<Пакет>Item", …)` | 72 | `*/datafetcher/*FieldResolver*.java` | резолвер поля не-корневого типа, не операция |
| `@DgsComponent` | 55 | все `*DataFetcher*` и `*FieldResolver*` | пометка класса |
| `@RequestMapping("…")` на классе | 5 | 4 в `controllers/`, 1 `ReportExportController` | префикс пути, пометка класса |
| `@RestController` | 8 | `controllers/` 6, `reports/web` 1, `integration/web` 1 | пометка класса |
| `@Query("select …")` | 44 | `*/repository/*Repository*.java` | JPQL в репозитории |
| `@Table(name = …)` | 60 | на тех же классах, что `@Entity` | вторая пометка того же объявления |
| `class *EventProcessor` | 6 | `v2/integration/consumer` | обработчик группы топиков, не топик; `BaseEventProcessor` абстрактный |
| `class *KafkaProducer` | 4 | `v2/integration/producer` | отправитель, имя топика берёт из конфига |
| `@EnableScheduling` | 1 | `v2/config/SchedulingConfig` | включает планировщик, не задача |

## Ключи по верхним папкам (вход нарезки)

Корень пакетов — `src/main/java/ru/kontrol/casedesk/`. Столбцы ловушек — справочно: ключами не являются.

| Папка | Файлов | контракт | сущности | задачи | топики | `@DgsData` полей | `@Query` | `@DgsComponent` | `@RequestMapping` |
|---|---|---|---|---|---|---|---|---|---|
| `v2/cases` | 170 | 26 | 13 | 0 | 0 | 21 | 9 | 13 | 0 |
| `v2/integration` | 180 | 1 | 2 | 0 | 0 | 0 | 1 | 0 | 0 |
| `v2/printforms` | 120 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2/checks` | 60 | 12 | 6 | 0 | 0 | 8 | 4 | 5 | 0 |
| `v2/findings` | 45 | 8 | 5 | 0 | 0 | 6 | 3 | 4 | 0 |
| `v2/sanctions` | 40 | 8 | 4 | 0 | 0 | 5 | 3 | 4 | 0 |
| `v2/dictionaries` | 40 | 7 | 6 | 0 | 0 | 4 | 4 | 3 | 0 |
| `v2/reports` | 35 | 7 | 3 | 1 | 0 | 3 | 3 | 2 | 1 |
| `v2/users` | 30 | 8 | 5 | 0 | 0 | 6 | 3 | 4 | 0 |
| `v2/permissions` | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2/common` | 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2/sla` | 24 | 2 | 1 | 7 | 0 | 1 | 1 | 2 | 0 |
| `v2/templates` | 22 | 5 | 3 | 0 | 0 | 3 | 2 | 3 | 0 |
| `v2/notifications` | 20 | 4 | 2 | 0 | 0 | 2 | 2 | 2 | 0 |
| `v2/attachments` | 18 | 4 | 2 | 0 | 0 | 2 | 2 | 2 | 0 |
| `v2/groups` | 18 | 7 | 2 | 0 | 0 | 4 | 2 | 3 | 0 |
| `v2/outbox` | 16 | 0 | 1 | 2 | 0 | 0 | 1 | 0 | 0 |
| `v2/exception` | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2/security` | 15 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2/territory` | 14 | 2 | 2 | 0 | 0 | 2 | 1 | 2 | 0 |
| `v2/comments` | 12 | 3 | 1 | 0 | 0 | 2 | 1 | 2 | 0 |
| `v2/config` | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v2/history` | 12 | 2 | 1 | 0 | 0 | 2 | 1 | 2 | 0 |
| `v2/settings` | 10 | 2 | 1 | 0 | 0 | 1 | 1 | 2 | 0 |
| `controllers` | 15 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 4 |
| `utils` | 37 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `v3` | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `CasedeskApplication.java` | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `src/main/resources` (`application.yaml`) | — | 0 | 0 | 0 | **12** | — | — | — | — |
| **итого** | **1052** | **120** | **60** | **10** | **12** | 72 | 44 | 55 | 5 |

Контракт `v2/reports` — 4 DGS + 3 REST; `v2/notifications` — 2 из 4 подписки. Топики живут в
`src/main/resources`, а код, который их слушает и пишет, — в `v2/integration`: при нарезке по папкам
кода топики попадают в «остаток» (`PLAN-AUTOSPLIT.md` §4.2).

## Зелёный исход пробы разведчика

Строки `ключ` по классам дают сумму в [0,8; 1,5] × правды: контракт 96…180, сущности 48…90, задачи
8…15, топики 10…18; ни одна строка `ключ` не насчитывает `@Query`, `@Table`, `@DgsComponent` /
`@RestController` / класс-уровневый `@RequestMapping`, `@DgsData` не-корневого типа. Топики строкой
`ориентир` по `*EventProcessor` — красный строго (0 из 12), зелёный мягко (план разрешает ориентир для
ключей без пометки в коде, §2, §8).
