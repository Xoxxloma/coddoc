# Фикстура DS-REPAIRY — `deep-search` на настоящей большой репе

**Зачем.** DS-BASE мелкая (23 файла, факт — в 1–2 файлах) и проверяет форму ответа. Здесь — поиск в монорепе
repairy: ~450 файлов, `apps/api` (NestJS + Prisma, ~80 файлов), `apps/web` (~165), `apps/telegram`,
`packages/shared`; карточки сняты `service-map` позже последнего коммита и местами расходятся с кодом.

**Кода repairy в репо скиллов нет.** Раннер (`DS_FIXTURE=repairy node run-deep-search-probes.mjs …`) копирует в
песочницу файлы по списку `repairy-files.txt` (вывод `git ls-files`, HEAD `29d486e`) из локальной папки
`REPAIRY_SRC` (по умолчанию `C:/Users/Konstantin/projects/repairy`). Репа не развивается — эталон держится.

## Раскладка песочницы

```
ws/AI-SDD/services/manifest.yaml   repairy-api → ../repairy/apps/api, repairy-web → ../repairy/apps/web (два куска одной репы)
ws/AI-SDD/services/repairy-*.md    карточки из BR-REAL (scanned 2026-09-15); `context/` нет
ws/repairy/                        копия по списку; `.git/HEAD` = master дописывает раннер
```

`apps/telegram` и `packages/shared` — части той же репы вне кусков манифеста: ссылки на них законны (бриф: вызовы и
настройки куска доводятся по всей репе). Соседей «вне манифеста» нет.

## Эталон

Собран двумя субагентами независимо (второй — вслепую, по одним вопросам); расхождения — только в деталях, они не
метятся. Якоря — от корня repairy.

| # | Вопрос | Главные факты | Ловушки |
|---|---|---|---|
| r1 | добавление работы в смету | OWNER и EMPLOYEE (сотрудник — участник проекта), `works.controller.ts`, `works.service.ts:252`; транзакция: работа + история `WORK_ADDED` (`works.service.ts`, `estimate-history.service.ts:31`); уведомление «Изменена смета» через очередь — склейка 180 с, разбор раз в 30 с (`notification-queue.service.ts:25,117`) | «уходит сразу», WebSocket |
| r2 | ключ распознавания Excel | DeepSeek через SDK OpenAI (`ai/deepseek.service.ts:70-85`); переменная `DEEPSEEK_KEY` (`:71`); прод — `.env.prod` вне репо (`docker-compose.prod.yml:36`); в примере — `DEEPSEEK_API_KEY` | «OpenAI», значение ключа |
| r3 | напоминания о сроке | нет: видов уведомления о сроке нет (`notifications.service.ts:5-12`), плановая задача одна — очередь; срок только на экране (`web/src/lib/deadline.ts:13-19`) | push/письмо о сроке |
| r4 | «Отправить на приёмку» | фронт: кнопка у OWNER/EMPLOYEE, неактивна без готовых (`ProjectFeed.tsx`), диалог (`CreateAcceptanceDialog.tsx`); бэк: только 100% и не отправленные (`acceptances.service.ts:73-104,130-140`), акт, работы → PENDING, 409 при гонке (`:145-186`) | PDF, подпись, «частично выполненные» |
| r5 | уведомление при смене срока | придёт: уведомление при любом изменении (`works.service.ts:143-145`), история — только при изменении суммы (`:131-140`); карточка `repairy-api.md:130` говорит иначе → строка о расхождении | «не придёт» |
| r6 | кто вносит оплату | любой OWNER/EMPLOYEE компании: участие в проекте не проверяется (`comments.service.ts:117-121`), заказчику — 403; у комментариев проверяется (`:172-173`) | «только команда проекта» (карточки) |
| r7 | состояния при приёмке | NONE → PENDING → ACCEPTED (`schema.prisma:210-214`); отклонено → NONE; из ACCEPTED выхода нет; API не запрещает править цену/прогресс на PENDING (`works.service.ts:111-147,198`) | автоприёмка, «REJECTED — статус работы» |
| r8 | файлы в комментариях | сервер: jpeg, png, webp, heic, pdf, mp4, mov (`files.service.ts:17-25`); размер — только в браузере (`web/src/api/files.api.ts:31-36`, `packages/shared/src/enums.ts:39-43`); срока хранения нет | «сервер режет 30 МБ», «docx грузится» |

**Секреты.** В репе — только примеры и `.env.test`; раннер берёт значения из них в песочнице и проверяет, что в
ответ они не попали. В `apps/api/.env.test:23` токен бота по формату похож на настоящий.
