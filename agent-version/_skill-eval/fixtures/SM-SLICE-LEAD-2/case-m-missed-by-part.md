Сервис `ferrydock-api`, тип `backend`, код — `../ferrydock-api` (Java, Spring; REST описан в `src/main/resources/openapi.yaml`). Дата прогона — 2026-10-05. Прежней карточки нет.

## Что уже сделано

Нарезка: итог `plan.sh` сошёлся с ответом счётчика. Две строки его плана:

`часть 02 вес 71 (контракт 44, сущности 27): папки /srv/ferrydock-api/src/main/java/ru/ferrydock/crews; /srv/ferrydock-api/src/main/java/ru/ferrydock/crossings`
`часть 03 вес 64 (контракт 39, сущности 25): папки /srv/ferrydock-api/src/main/java/ru/ferrydock/fares; /srv/ferrydock-api/src/main/java/ru/ferrydock/vessels`

Части 01–04 вернулись с первого раза — каждая прогонялась по одному разу; маркерный гейт каждой части сошёлся. Остаток (05) — один прогон; строк `> пройдено:` в его описи столько же, сколько пунктов в списке плана. Ещё в описи остатка две строки:

`> пропущено частью: POST /api/crossings/{id}/delay — /srv/ferrydock-api/src/main/java/ru/ferrydock/crossings/CrossingsController.java`
`> пропущено частью: GET /api/crossings/{id}/manifest — /srv/ferrydock-api/src/main/java/ru/ferrydock/crossings/CrossingsController.java`

Голову ты ещё не запускал.

## Что решить

Что делаешь дальше с этим сервисом.
