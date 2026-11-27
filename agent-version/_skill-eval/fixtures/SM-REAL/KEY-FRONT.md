# Ключ плеча `front` (SM-REAL)

Засев — `seed.sh <куда> front`, манифест — `manifest-front.yaml`, промпт — `prompt-front.md` раунда
`runs/2026-08-24-sm-real/stand/`, грейдер — `grade-sm-front.mjs`. В песочницу ключ не едет.

Зачем плечо: механику v2 (разведчик, `plan.sh`, нарезка, `check.sh`) мерили только на бэкенд-монолитах.
Здесь типы и случаи, которых другие плечи не дают. У v1 (`service-map` 2.2.x) на них отказов не было.

| Сервис | Тип | Откуда | Правда |
|---|---|---|---|
| `resonance-web` | frontend | `projects/resonance/frontend` | экраны: `/`, `/report/:reportId`, `/me` (→ `teams`), `/me/teams`, `/me/teams/:teamId`, `/me/history`, `/__phrase-test`, `/__stats`, `/__status` — 9 |
| `webapp-shop` | frontend | `projects/webAppShop` (без `build/`) | экраны: `/`, `info`, `shop` — 3 |
| `skydesk` | fullstack | синтетика `front/skydesk` | ручки под `/api`: `GET /nights`, `GET /nights/:id`, `POST /reservations`, `POST /reservations/:id/cancel`, `GET /observers/me` — 5; экраны: `/`, `/nights`, `/nights/:id`, `/reservations`, `/login` — 5; во фронте `api.get(…)` / `api.post(…)` — вызовы, не ручки |
| `dome-control` | backend | синтетика `front/dome-control` | ручки: `GET /api/domes`, `GET /api/domes/{id}`, `POST /api/domes/{id}/open`, `POST /api/domes/{id}/close` — 4; сущность `Dome`; сосед `weather-feed`. `src/main/resources/openapi/weather-feed.yaml` — спека СОСЕДА (4 операции: `/forecast`, `/cloud-alerts`, `/stations`, `/alerts/subscriptions`), по ней генерируется клиент (`pom.xml`, `generatorName java`, `library feign`) — это не контракт сервиса |
| `resonance-api` | backend | `projects/resonance/backend` | ручки под `/api` — 30 (+ `GET *` — раздача фронта, если собран); хранение — JSON-файлы, ORM нет; вес у порога нарезки K = 30 |

## Критерии (грейдер)

- **F1** фронты (`resonance-web`, `webapp-shop`) записаны в `services/`, не в `_pending/`.
- **F2** экраны: `resonance-web` ≥ 7 из 9, `webapp-shop` 3 из 3.
- **F3** у фронтов нет блоков «Публичного контракта».
- **S1** `skydesk` записан; ручек ровно 5, все под `/api`; экранов ≥ 4 из 5.
- **D1** `dome-control` записан; ручек ровно 4 (`/api/domes…`).
- **D2** у `dome-control` нет ни блока, ни строки контракта с операциями спеки соседа (`/forecast`,
  `/cloud-alerts`, `/stations`, `/alerts/subscriptions`) — ни блоком, ни «объявлено без реализации».
- **D3** у `dome-control` в «Зависит от» есть `weather-feed`.
- **R1** `resonance-api` записан; ручек ≥ 28 из 30.
- Справочно: путь `resonance-api` (один читающий или части), цена прогона, строки «СПЕКА НЕ РАЗМЕЧЕНА» и
  «маркеры … НЕ ПРОЙДЕН» в `actions.log`.

Ожидание на 4.2.0 до правок паритета с v1: F1 — красный (класса «экраны» у разведчика нет, роуты фронта
идут в «контракт» → маркерный гейт → `_pending`), D2 — под угрозой (клиентская спека попадает в сверку
`plan.sh` → добор «найди обработчик и допиши блок»), S1 — под угрозой (вызовы фронта как ручки).
