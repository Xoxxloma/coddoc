Сервис `cargo-yard`, тип `backend`, код — `../cargo-yard`, абсолютный путь `C:/work/cargo-yard` (Java, Spring Boot, JPA). Ты на Шаге 3. Дата прогона — 2026-10-04.

## Разведчик (Шаг 3.0) — строки, как он их вернул; после тире — счёт твоего грепа по строке (Шаг 3.1)

Счёт — `Grep output_mode="count"` по всем путям сервиса, число совпадений.

`контракт :: @(Get|Post|Put|Delete)Mapping\( :: *.java :: ключ` — совпадений 139
`сущности :: @Entity\b :: *.java :: ключ` — совпадений 88
`задачи :: @Scheduled\( :: *.java :: ключ` — совпадений 9
`топики :: class \w+MessageHandler\d*\b :: *.java :: ориентир` — совпадений 6

## Окружение

Командная строка у субагентов в этом запуске есть: субагенту можно дать Bash, он работает внутри репозитория спек.

## Что уже сделано

Ты записал вывод своих грепов по файлам в `services/.work/cargo-yard/counts.txt`. Субагент с командной строкой запустил `plan.sh` и вернул его вывод дословно:

```
итог по классам: контракт 139, сущности 88, задачи 7 | ориентир: топики 6
вес сервиса 237 при K=80, w=0.5
часть 01 вес 74 (контракт 41, сущности 33): папки C:/work/cargo-yard/src/main/java/ru/cargoyard/v2/analytics; C:/work/cargo-yard/src/main/java/ru/cargoyard/v2/billing
часть 02 вес 79 (контракт 38, сущности 38, задачи 3): папки C:/work/cargo-yard/src/main/java/ru/cargoyard/v2/consignment
часть 03 вес 57 (контракт 36, сущности 17, задачи 4): папки C:/work/cargo-yard/src/main/java/ru/cargoyard/v2/dispatch; C:/work/cargo-yard/src/main/java/ru/cargoyard/v2/tariff
часть 04 вес 27 (контракт 24): папки C:/work/cargo-yard/src/main/java/ru/cargoyard/legacy; C:/work/cargo-yard/src/main/java/ru/cargoyard/v2/exchange
частей 4; остаток — всё вне папок и файлов частей (пометок там нет)
```

Читающих субагентов ты ещё не запускал.

## Что решить

Что делаешь дальше с этим планом и как читаешь сервис.
