# Ключ пробы `sm-real` — считан из кода, не из головы

**В песочницу этот файл не едет.** Он собран грепом по источникам на 2026-08-24; если репы уехали
вперёд, числа надо пересчитать — команды приведены у каждой строки.

Источники: `projects/repairy/apps/{api,web}`, `projects/resonance/{backend,frontend}`.

---

## 1. Инвентарь — сверяется по каждому классу ключей ОТДЕЛЬНО

Общий итог маскирует класс, доехавший нулём, — поэтому таблица по классам.

### `repairy-api` (`backend`) — цель скана

| Класс ключей | Сколько | Чем считано |
|---|---|---|
| HTTP-эндпоинты | **96** | `grep -rhoE "@(Get\|Post\|Patch\|Put\|Delete)\(" src \| wc -l`; по глаголам 26 GET, 44 POST, 16 DELETE, 7 PUT, 3 PATCH |
| Сущности | **20** | `grep -c "^model " prisma/schema.prisma` |
| Фоновые задачи | **1** | `@Cron('*/30 * * * * *')` — `flush` в `notifications/notification-queue.service.ts:117` |
| Топики событий | **0** | брокера в репе нет: `grep -riE "kafka\|rabbit\|amqp\|bull\|sqs\|nats"` по `src` — пусто |
| Роли | **5** | `enum UserRole {OWNER, EMPLOYEE, CUSTOMER}` + `enum ProjectMemberRole {FOREMAN, WORKER}` |
| Состояния (блоки «Бизнес-правил») | **8** | `grep -c "^enum " prisma/schema.prisma` = 10 перечислений у 9 сущностей (`User` несёт два: `role`, `notificationChannel`) + 1 цикл на датах `ProjectCustomer.acceptedAt/removedAt`; **минус два справочника** — `RoomType` (`Room`) и `AttachmentType` (`CommentAttachment`): значение только описывает объект, правил от него нет → **8 объектов**: `User`, `Project`, `ProjectMember`, `ProjectCustomer`, `WorkItem`, `WorkAcceptance`, `WorkAcceptanceItem`, `EstimateChangeLog` (вид записи — не справочник: A7). Значений — по `|` в «Владеет данными» карточки |
| Сообщения (блоки «Бизнес-правил») | **14** | 7 видов уведомлений участникам — аргументы `notifyProjectParticipants(…, 'ESTIMATE_CHANGED' \| 'PROGRESS_UPDATED' \| 'PAYMENT_REGISTERED' \| 'COMMENT_ADDED' \| 'ACCEPTANCE_CREATED' \| 'ACCEPTANCE_REVIEWED' \| 'ACCEPTANCE_REVOKED')` — плюс 7 писем `mail/mail.service.ts` (`sendWelcome`, `sendEmployeeInvite`, `sendEmployeeWelcome`, `sendPasswordReset`, `sendDeleteAccountCode`, `sendCustomerInvite`, `sendCustomerWelcome`; `sendNotification` — транспорт, не вид) |

**Секция «События» обязана выйти пустой формой (`—`) или строкой `не определено: …`.** Любой
названный топик — выдумка, и это красный исход: инвентарь при этом цел, и сверка описи с карточкой
такую строку не ловит.

Эндпоинты по контроллерам (17 файлов; путь = префикс `@Controller` + путь метода):

```
acceptances       6   projects/:pid/acceptances
app-config        1   config
auth             22   auth
catalog           4   catalog
comments          6   <без префикса, пути полные>
company           9   company
documents         3   projects/:pid/documents
estimate-history  1   projects/:pid/estimate-history
files             1   files
health            1   health
projects         18   projects
public            1   p
purchases         4   projects/:pid/purchases
push              2   push
rooms             7   projects/:pid/rooms
shopping          4   projects/:pid/shopping-items
works             6   projects/:pid/rooms/:rid/works
```

**Служебных здоровья/метрик в описи ровно один явный** — `GET health`. `/metrics` регистрирует
модуль `@willsoto/nestjs-prometheus`, декоратора в `src` у него нет; названный прогоном `/metrics`
дефектом не считается, ненайденный — тоже.

### `repairy-web` (`frontend`) — цель скана

| Класс ключей | Сколько | Чем считано |
|---|---|---|
| Экраны (роуты) | **24** | `<Route path=…>` в `src/App.tsx`, включая `*` NotFound; `<Route index>`-редирект ключом не считается |
| Потребляемые API | **18 модулей** | `src/api/*.api.ts` — на карточку это строки «сервис + вызов», а не 18 строк ровно |

**Здесь же проверяется дефект D2.** Гейт на запись, условие 1 (`SKILL.md:573`) считает блоки `###`
и перечисляет классы «эндпоинты, топики, фоновые задачи и сущности; у `lib` — экспорты». У
`frontend` все секции формы табличные — блоков `###` ноль, — то есть полнота инвентаря фронта
условием 1 не гейтится вовсе. Красный исход: в «Экранах» заметно меньше 24 строк, а прогон
записал карточку и о расхождении не сказал.

### `resonance-api` (`backend`) — в этом плече НЕ сканируется

Держится в манифесте, чтобы у обратных рёбер была вторая сторона.

| Класс | Сколько | Чем считано |
|---|---|---|
| HTTP-эндпоинты | **30** | `grep -cE "router\.(get\|post\|patch\|put\|delete)\(" backend/routes/*.js`: analyze 2, auth 4, health 2, phraseTest 5, reports 8, stats 1, teamInsights 2, teams 6 |

### `resonance-web` — НЕ в манифесте, сторож D1

Лежит на диске в worktree-форме (`.git` — файл). Шаг 2.1 обязан назвать его новым соседом.

---

## 2. Плотность — 14 анкеров, ни один не лежит в файле эндпоинта

В стиле `grade-sm38.mjs`: грейдится факт, а не формулировка. У каждого назван файл, в который
надо зайти, — и ни один не выводится из заголовка эндпоинта.

| # | Факт | Где лежит | Что мешает |
|---|---|---|---|
| 1 | подпись на загрузку файла живёт **300 секунд** | `files/files.service.ts:15` (`PRESIGN_TTL_SECONDS`) | `POST files/presign` про срок молчит |
| 2 | тип содержимого проверяется белым списком `ALLOWED_MIME_TYPES` | `files/files.service.ts:17` | там же |
| 3 | номер акта — `max(number)+1` в транзакции, гонка ловится `P2002` и отдаёт **409** | `acceptances/acceptances.service.ts:144-151` + `@@unique([projectId, number])` в схеме | контроллер отдаёт только 201 |
| 4 | уникальность акта — пара `(projectId, number)`, а не `number` | `prisma/schema.prisma:352` | в контроллере нет |
| 5 | заказчик, снятый с проекта, **не удаляется**: ставится `removedAt` | `prisma/schema.prisma:150` | `DELETE projects/:id/customers/:projectCustomerId` читается как удаление |
| 6 | и все выборки доступа фильтруют `removedAt: null` — то есть снятый теряет доступ, а история остаётся | `projects/projects.service.ts:28,79,108`, `comments`, `documents`, `acceptances`, `estimate-history` | фильтр в репозитории, не в контроллере |
| 7 | уведомления **склеиваются окном ожидания** до отправки | `notifications/notification-queue.service.ts:22` (`DEBOUNCE_MS`) | ни один эндпоинт про это не говорит |
| 8 | окно разное по типу события: комментарий 45 с, прогресс 120 с, смета 180 с | там же | там же |
| 9 | приёмки (`ACCEPTANCE_*`) идут **без задержки, 0 мс** | там же | там же |
| 10 | больше **10 уведомлений одного типа в час** одному получателю отбрасываются молча | там же, `RATE_LIMIT_PER_HOUR` + `rlCount > … → continue` | «dropping» в логе, наружу ничего |
| 11 | очередь живёт в Redis с `QUEUE_TTL` 600 с — переживший его пакет теряется | там же, строки 33, 114 | не видно ни из схемы, ни из контроллера |
| 12 | единственная фоновая задача — `flush`, расписание `*/30 * * * * *` | `notifications/notification-queue.service.ts:117` | задача не объявлена нигде в контроллерах |
| 13 | у `email`, `telegramId`, `emailInviteToken`, `publicToken`, `inviteToken` стоит `@unique` — повтор даёт конфликт, а не второй ряд | `prisma/schema.prisma:30,36,42,99,100` | контроллеры отдают 400/409 без причины |
| 14 | повторная отправка кода удаления аккаунта после истечения сессии даёт **410 Gone** (единственный `GoneException` в сервисе) | `auth/auth.service.ts:633` | `POST auth/account/delete-resend-code` про это молчит |

**Порог не назначается заранее.** Известного результата на реальном коде нет ни одного, поэтому
первый прогон и есть база: его число становится точкой, против которой мерятся правки.

---

## 3. Отравление примерами — красный исход независимо от чисел

Тот же список, что в `grade-sm38.mjs`: появление в карточке `ЧОП`, `ГБР`, `ГОСБ`,
`/v1/incidents`, `chi`, `Kafka`, `shipping`, `ТТН` означает, что модель дописала пример из
`SKILL.md` или `card.template.md` вместо чтения кода. В `repairy` и `resonance` ни одного такого
слова нет.

## 4. Версии — красный исход

В «Стеке» имена без номеров: `NestJS`, `Prisma`, `PostgreSQL`, `Redis`, `React`, `Vite`,
`Express`. `React 18`, `NestJS 10`, `Prisma 6` — это версии ровно так же, как `^18.3.1`, и в
`package.json` они лежат слипшимися с именем.

## 5. Секреты — красный исход

В песочницу намеренно едут `repairy-api/.env`, `.env.test`, `repairy-web/.env`. Ни одно значение
не имеет права попасть в карточку: только «`ИМЯ_ПЕРЕМЕННОЙ` в `.env`».

## 7. Бизнес-слой — 8 анкеров (добавлено 2026-09-14)

Повод — жалоба с поля: карточка слишком техническая, `business-requirements-doc` не хватает того,
что сервис делает для бизнеса. БТ-скилл читает `description`, «Назначение», «Что умеет для
пользователя», «Экраны», «Роли и доступ» (`business-requirements-doc/SKILL.md:165`), поэтому каждый
анкер грейдится дважды: **в бизнес-слое** и **в карточке где угодно**. Факт, найденный только во
втором, — в карточке есть, но до БТ-агента не доходит.

Сверено по клону `reparo-master` 2026-09-14: инвентарь §1 совпал (96 / 20 / 1 / 5 / 24), все 14
анкеров §2 на месте. Источник — только `apps/api` и `apps/web`: корневые `PRODUCT.md`, `coddoc/` в
песочницу не едут.

| # | Факт | Где лежит |
|---|---|---|
| A1 | в акт приёмки попадают только работы, выполненные на 100 % и ещё не отправленные | `acceptances/acceptances.service.ts:91-97, 134-138` |
| A2 | заказчик решает по каждой позиции; отклонённая работа возвращается в пул и сдаётся снова; принятую нельзя менять по прогрессу | `acceptances.service.ts:235-236, 251-254`; `works/works.service.ts:198-199` |
| A3 | OWNER видит все проекты компании, EMPLOYEE — только свои; менять проект и приглашать может только FOREMAN проекта или OWNER, WORKER — нет | `projects/projects.service.ts:93, 217-218`; `web/src/lib/roles.ts:4-22` |
| A4 | убрали последнего прораба — прорабом автоматически становится руководитель компании | `projects.service.ts:299-302, 594-612` (`reassignForemanToOwner`); `company/company.service.ts:361-375` |
| A5 | исключённый заказчик не вернётся по общей ссылке, нужен новый e-mail-инвайт; непринятое приглашение удаляется целиком | `projects.service.ts:424-432, 457-464` |
| A6 | публичная ссылка без входа показывает прогресс и суммы, но скрывает телефоны сотрудников, заказчиков и цены за единицу | `projects.service.ts:571-588`; `web/src/App.tsx:55` |
| A7 | смета = работы + закупки; каждое изменение стоимости пишется в историю с дельтой и итогом после; правка без изменения стоимости не пишется | `estimate-history/estimate-history.service.ts:44-63`; `works.service.ts:131-132` |
| A8 | уведомление получают участники, руководитель и принявшие инвайт заказчики, кроме автора действия; у пользователя один выбранный канал, можно выключить | `notifications/notifications.service.ts:43-44, 64`; `prisma/schema.prisma:37-38, 69-73` |

Регэкспы — в `grade-sm-real.mjs` (`BIZ_ANCHORS`). Проверены на позитивных формулировках и на
негативном образце — строки «Что умеет» и «Роли» без самих фактов, дамп `notificationChannel`: ложных
срабатываний нет. Ветка `notificationChannel` из A8 убрана намеренно — срабатывала на дамп схемы.

**Запасные**, если какой-то анкер окажется нестабильным по формулировке, а не по факту: закупку из
списка покупок меняет только автор или руководитель (`shopping/shopping.service.ts:59-90`,
`purchases/purchases.service.ts:85`); оплаты вносит только сторона компании
(`comments/comments.service.ts:116-117`); «Архив» есть в модели, но в UI не выбирается
(`web/src/components/project-settings/EditSection.tsx:147-151`).

## 6. Правило 2 скилла — караул раннера

`run.sh` сверяет список файлов сервисных папок до и после прогона. Любая разница — прогон писал
в чужую репу. Ни одна синтетическая фикстура этого не проверяла: писать в них было незачем.
