# SM-LISTMONK — ключ ответов (в песочницу не едет)

Настоящий код не на Java: listmonk (`knadh/listmonk`, AGPL-3.0) — рассылки на Go (echo), Postgres без ORM (SQL в
`queries/*.sql`, схема в `schema.sql`), админка рендерится на сервере. Клон в `projects/listmonk`, коммит
`8216c4f15fa918ffe7e1a9e692701df5134a5f4b` (2026-10-23). Песочница копирует репу целиком без `.git`; цель скана —
`listmonk` (`type: backend`), соседей в манифесте нет.

## Инвентарь

| Класс | Сколько | Чем считано |
|---|---|---|
| ручки | **185** | `routes.tsv` — регистрации `g.METHOD(…)` в `cmd/handlers.go` и `cmd/init.go` (`uriAdmin` → `/admin`, `path.Join` раскрыт): 107 `/api/*`, 52 страницы `/admin*`, 26 публичных (подписка, отписка, архив, вебхуки отказов, OIDC, медиа). 9 ручек — только при настройке (колонка «условие») |
| таблицы | **16** | `schema.sql`: subscribers, lists, subscriber_lists, templates, campaigns, campaign_lists, campaign_views, media, campaign_media, links, link_clicks, settings, bounces, roles, users, sessions. ORM нет — что считать «сущностью», решает читающий; грейдер считает справочно |
| фоновые задачи | **6** | сканер кампаний (`internal/manager/manager.go` `scanCampaigns`, раз в 5 с — `cmd/init.go:679`); разбор ящика отказов POP3 (`internal/bounce`, при `bounce.enabled`); cron кэша медленных запросов (`cmd/init.go:1171`, при `app.cache_slow_queries`); cron VACUUM БД (`cmd/init.go:1193`, при `maintenance.db.vacuum`); проверка обновлений (`cmd/updates.go`, при `app.check_updates`); чистка временных токенов раз в час (`internal/tmptokens`) |
| топики брокера | **0** | брокера нет |

Путь ручки в карточке, которого нет в `routes.tsv`, — выдумка (грейдер считает).

## Опорные факты — проверены по коду

| № | Факт | Где | Что должно быть в карточке |
|---|---|---|---|
| L1 | вход: сессия по cookie после логина; API — заголовок `Authorization: token <пользователь>:<токен>` (Basic — для совместимости); есть cookie сессии — заголовок не смотрится | `internal/auth/auth.go:354–371, 542–563` | в «Ролях и доступе» — и cookie/сессия, и токен в заголовке |
| L2 | вход через OIDC — по настройке `security.oidc.enabled` (`/auth/oidc`) | `cmd/handlers.go:300` | OIDC-провайдер в «Зависит от» или в «Ролях» |
| L3 | двухфакторный вход (TOTP) — шаг `/admin/login/twofa` | `cmd/handlers.go:293` | 2FA / TOTP |
| L4 | два набора ролей: роли пользователя (права из `permissions.json`) и роли списков (права на отдельные списки) | `permissions.json`, `cmd/roles.go` | оба набора в «Ролях и доступе» |
| L5 | отказы `soft` / `hard` / `complaint`: после N отказов по настройке `bounce.actions` — отписка, блок-лист или удаление подписчика | `queries/bounces.sql:2–30`, `internal/core/bounces.go:61` | порог и действия |
| L6 | отказы приходят из почтового ящика POP3 (сканирование с интервалом) и вебхуками сервисов (SES, SendGrid, Postmark и др.) | `internal/bounce/mailbox/pop.go`, `internal/bounce/webhooks/*.go` | ящик POP3 и сервисы отказов в «Зависит от» |
| L7 | письма — через SMTP (несколько серверов) и «postback»-мессенджеры — HTTP-вызов на внешний адрес | `internal/messenger/email`, `internal/messenger/postback/postback.go` | SMTP и HTTP-postback в «Зависит от» |
| L8 | медиа — в файловой системе или в S3, по настройке | `internal/media/providers/{filesystem,s3}` | S3 |
| L9 | проверка обновлений: через 15 мин после старта, дальше по интервалу — `GET https://update.listmonk.app/update.json`, при `app.check_updates` | `cmd/updates.go:13, 39–93` | сервер обновлений в «Зависит от» или в блоке задачи |
| L10 | скорость рассылки: `app.message_rate`, `app.concurrency`, скользящее окно `app.message_sliding_window` (лимит писем за период) | `cmd/init.go:661–678` | лимиты в блоке задачи рассылки |
| L11 | кампании ищутся раз в 5 секунд — интервал зашит в код | `cmd/init.go:679` | 5 секунд |
| L12 | подписчик сам выгружает и стирает свои данные (`/subscription/export`, `/subscription/wipe`) — только если разрешено `privacy.allow_export` / `allow_wipe` | `cmd/public.go:706, 762` | условие в блоках этих ручек |
| L13 | публичный архив кампаний (`/archive…`, `/api/public/archive`) — только при включённом архиве | `cmd/handlers.go` (условие `EnablePublicArchive`) | условие в блоках архива |
| L14 | чистка сессий объявлена периодической (раз в 12 ч), а выполняется один раз при старте: в горутине нет цикла | `internal/auth/auth.go:87, 120–126` | справочно — «один раз», «не повторяется» |

«Что умеет» — справочно: число строк и склеенные строки.
