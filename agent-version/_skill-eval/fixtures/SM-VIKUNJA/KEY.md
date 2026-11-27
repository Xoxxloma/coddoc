# SM-VIKUNJA — ключ ответов (в песочницу не едет)

Настоящий фронт: vikunja frontend (`go-vikunja/frontend`, AGPL-3.0) — Vue 3 + TS, роутер в конфиге, вызовы REST в
`src/services` (наследники `AbstractService`) и прямыми `HTTP.get/post`. Клон в `projects/vikunja-frontend`, коммит
`652d3c738438b5fd170cc941bdedae916f99ba09` (2024-02-07, репа архивная). Песочница копирует репу целиком без `.git`;
цель скана — `vikunja-frontend` (`type: frontend`). API vikunja в манифесте нет — сосед «вне манифеста».

## Инвентарь

| Класс | Сколько | Чем считано |
|---|---|---|
| экраны (роуты) | **50** записей роутера, **45** без ловушек | `routes.tsv` — `path:` в `src/router/index.ts`; ловушки `/:pathMatch…` и редирект `/lists:pathMatch…` экранами не считаются, два пути записаны дважды (модальное окно и страница) |
| вызовы API | **111** (приблизительно) | `api-calls.tsv` — пути сервисов (`create` → PUT, `get`/`getAll` → GET, `update` → POST, `delete` → DELETE) и прямые вызовы; вызовы, собранные строкой в рантайме, могли не попасть — эталон приблизительный |

## Опорные факты — проверены по коду

| № | Факт | Где | Что должно быть в карточке |
|---|---|---|---|
| V1 | вход: JWT в localStorage, к каждому запросу — заголовок `Authorization: Bearer <токен>` | `src/helpers/fetcher.ts:21–30` | в «Ролях и доступе» — токен в заголовке |
| V2 | токен продлевается при возврате фокуса окну, если жить ему осталось меньше 60 часов | `src/composables/useRenewTokenOnFocus.ts:8, 22–42`, `src/stores/auth.ts:377` | продление токена |
| V3 | вход по ссылке-шаре: хэш шары в адресе → экран `/share/:share/auth`, вход с правами ссылки | `src/router/index.ts:507–520` | вход по ссылке |
| V4 | вход через OpenID Connect — экран `/auth/openid/:provider` | `src/router/index.ts`, `src/helpers/redirectToProvider.ts` | OpenID / OIDC |
| V5 | права: только чтение, чтение и запись, администратор | `src/constants/rights.ts` | три уровня прав |
| V6 | адрес API задаётся при запуске (`window.API_URL`), к адресу дописывается `/api/v1`, если его нет | `src/helpers/checkAndSetApiUrl.ts` | адрес API в конфигурации |
| V7 | уведомления опрашиваются каждые 10 секунд | `src/components/notifications/notifications.vue:104, 127` | частота опроса |
| V8 | импорт из Todoist, Trello, Microsoft To Do — экраны `/migrate`, `/migrate/:service` | `src/views/migrate/migrators.ts` | внешние сервисы импорта |
| V9 | Sentry — по флагу `SENTRY_ENABLED` | `src/main.ts:107`, `src/sentry.ts` | Sentry |
| V10 | часть функций включает сервер флагами из `/info`: регистрация, TOTP, CalDAV, удаление пользователя, вложения | `src/stores/config.ts:17–60` | зависимость интерфейса от флагов сервера |
| V11 | фоны проектов — поиск Unsplash через API | `src/services/backgroundUnsplash.ts` | Unsplash |
| V12 | двухфакторный вход (TOTP) — экран настроек и вызовы `/user/settings/totp/*` | `src/services/totp.ts` | TOTP / 2FA |

«Что умеет» — справочно: число строк и склеенные строки.
