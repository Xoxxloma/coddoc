# report — backend

## Назначение

Сервис отчётов: выгрузка в `CSV` и PDF.
Принимает запрос GET от фронта.
Хранит отчёты по ключу reportId.
Работает с api.reports.internal напрямую.
Отдаёт файлы по пути /files и /export.
Обычная строка без кода.

## Что умеет для пользователя
| Возможность GET /x | Для кого |
|---|---|
| Выгрузить отчёт за период | Аналитик |
| Скачать через GET | Аналитик |
| Найти отчёт по reportId | Аналитик |
| Посмотреть список | вызов /v1/reports в коде |
| Открыть `reportId` в бэктиках | Аналитик |

## Стек
| Слой | Чем |
|---|---|
| Язык и фреймворк | Java 17, Spring Boot |
| Хранилище | PostgreSQL |
| Шина | Azure Service Bus |

## Публичный контракт

### `GET /v1/reports/export.csv`
Выгрузка.
сущности: → не сущность, файл
- формат описан в src/report/ExportService.java
- пример в (docs/export/sample.json)
- путь `src/report/Mapper.kt`
- шаблон лежит в config/templates/report.yaml   
- выгрузка по /v1/reports/export.csv
- ссылка заканчивается точкой: src/a/b.ts.
- токен abcdefghijklmnopqrstu в тексте
- токен abcdefghijklmnopqrst короче порога
- токен `ABCDEFGHIJKLMNOPQRSTUVWXYZ` в бэктиках не считается
- ключ AAAA/BBBB+CCCC=DDDD_EEEE-FF подряд

### POST /v2/auth/account/delete-request-confirmation
сущности: → не сущность
- тело

### GET /v2/projects/estimate.pdf
сущности: → не сущность, файл
