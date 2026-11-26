# Техническая спецификация: Перенос экзамена по уважительной причине через студенческий портал

> **Задача:** UNI-303
> **Автор:** mock
> **Источник (БТ):** coddoc/UNI-303/business_requirements.md — «Бизнес-требования: Перенос экзамена по уважительной причине через студенческий портал»
> **Редакция:** 1 (2026-11-12)
> **Версия скилла:** technical-spec-doc 1.8.1
>
> **Статус готовности:** Готово к разработке
>
> **Легенда происхождения:**
> 🟢 НОВОЕ — спроектировано в этом документе, реализуется как есть.
> 🔵 подтверждено аналитиком — факт о существующей системе; источник указан у пункта; валидировать при интеграции. Пункт закрыт.
> 🟡 к валидации — допущение о существующей системе, не подтверждено — уточнить.
> ❓ — открытое архитектурное решение.
> ⚠️ — подтверждено, но расплывчато: требует уточнения перед разработкой.
> 🟢 и 🔵 — пункт закрыт; 🟡, ❓ и ⚠️ — открыт и идёт в «Открытые вопросы».
>
> **Открытые вопросы (решить до / во время разработки):**
>
> Все технические решения приняты, спецификация готова к разработке.

## 1. Обзор изменения

### 1.1. Что делаем и тип изменения
**Суть:** Новый сервис `requests-service` хранит заявки на перенос экзамена, документы к ним (файлы — в `files-service`), решения преподавателя и деканата, историю статусов и настройки сроков; в `student-portal` появляются экраны студента (черновик, подача, отзыв), преподавателя (согласование слота), сотрудника деканата (утверждение) и администратора учебного отдела (сроки). При утверждении `requests-service` вызывает новый метод `schedule-service` `POST /api/v2/slots/{slotId}/reservations` — экзамен студента переносится в расписании; о смене статуса студент получает уведомление через существующий `notifications`. Фоновая задача передаёт заявку в деканат, если преподаватель не ответил за 2 рабочих дня, и помечает просроченные заявки.
**Тип:** новый функционал
**Стороны:** Fullstack — новые FE↔BE контракты `student-portal` ↔ `requests-service`, новый метод в чужом `schedule-service`, потребление `schedule-service`, `files-service`, `notifications`.

### 1.2. Затронутые сервисы и владельцы
| Сервис | Роль в задаче | Владелец/команда | Происхождение |
|--------|---------------|------------------|---------------|
| `student-portal` | изменение: новые экраны для четырёх ролей, вызовы `requests-service` | команда «Портал» (наша) | 🔵 подтв. аналитиком (со слов) |
| `requests-service` | новый сервис: заявки, документы, решения, история, сроки, фоновая задача, отправка уведомлений | команда «Портал» (наша) | 🟢 |
| `schedule-service` | изменение: новый метод резервирования слота (INT-14); потребитель: экзамены студента, свободные слоты, рабочие дни | команда «Расписание» | 🔵 подтв. аналитиком (по карточке services/schedule-service.md) |
| `files-service` | потребитель: загрузка документа, временная ссылка на скачивание | команда «Платформа» | 🔵 подтв. аналитиком (по карточке services/files-service.md) |
| `notifications` | потребитель: отправка уведомления в портал и на почту | команда «Коммуникации» | 🔵 подтв. аналитиком (по коду notifications, ветка main) |
| SSO университета | токен пользователя с ролями; сервисный аккаунт `requests-service` | команда «Платформа» | 🔵 подтв. аналитиком (со слов) |

### 1.3. Связь с бизнес-требованиями
Реализует цель БТ: заменить бумажное заявление на перенос экзамена электронной заявкой с отслеживаемыми сроками, чтобы решение принималось не дольше 4 рабочих дней, а расписание обновлялось в момент утверждения без ручного ввода.

## 2. Взаимодействия (ядро)

Общие правила 🟢-контрактов `requests-service`:
- базовый путь `/api/v1`; JSON в UTF-8; время — ISO 8601 в UTC (`Z`), фронт показывает по Москве (Europe/Moscow);
- аутентификация — заголовок `Authorization: Bearer <токен SSO пользователя>`;
- тело ошибки: `{ "error": { "code": "<КОД>", "message": "<текст для пользователя>", "details": { … } | null } }`;
- при выключенном флаге `exam-transfer-requests` все пользовательские ручки отвечают 404 `FEATURE_DISABLED` (§6.3).

Объект «заявка» (`TransferRequest`) — общий ответ INT-1, INT-2, INT-3, INT-4, INT-6, INT-8, INT-9, INT-10:

| Поле | Тип | Семантика |
|------|-----|-----------|
| `id` | string (UUID) | идентификатор заявки |
| `status` | enum | `DRAFT` черновик, `SUBMITTED` подана, `AT_TEACHER` у преподавателя, `AT_DEANERY` в деканате, `APPROVED` утверждена, `REJECTED` отклонена, `WITHDRAWN` отозвана, `EXPIRED` просрочена |
| `student` | object | `id`, `fullName`, `groupName` — все string, не `null` |
| `exam` | object | `id`, `disciplineName`, `startsAt`, `room`, `teacherId`, `teacherName` — снимок на момент создания, при подаче обновляется; не `null` |
| `reasonType` | enum | `ILLNESS` болезнь, `FAMILY` семейные обстоятельства, `UNIVERSITY_EVENT` мероприятие от университета, `OTHER` другое |
| `reasonComment` | string \| null | до 1 000 символов; при `OTHER` обязателен |
| `document` | object \| null | `null` — документ не приложен; иначе `fileName`, `contentType`, `sizeBytes`, `uploadedAt`, `downloadUrl` (string \| null — `null`, если ссылку получить не удалось), `downloadUrlExpiresAt` (string \| null) |
| `submissionDeadlineAt` | string | крайний срок подачи: у `DRAFT` — по текущим настройкам, после подачи — зафиксирован |
| `submittedAt` | string \| null | `null` у `DRAFT` |
| `teacherDeadlineAt` | string \| null | срок ответа преподавателя; `null` до прихода к преподавателю и до выпуска части 3 |
| `escalated` | boolean | `true` — в деканат передана по истечении срока преподавателя |
| `teacherDecision` | object \| null | `null` — решения нет; иначе `decision` (`AGREED` \| `REJECTED`), `slot` (object \| null — у `AGREED`: `slotId`, `startsAt`, `endsAt`, `room`), `comment` (string \| null — обязателен у `REJECTED`), `decidedAt`, `decidedBy` (`id`, `fullName`) |
| `deaneryDecision` | object \| null | `null` — решения нет; иначе `decision` (`APPROVED` \| `REJECTED`), `slot` (object \| null — у `APPROVED`), `comment` (string \| null — обязателен у `REJECTED`), `decidedAt`, `decidedBy` |
| `allowedActions` | array of enum | действия, доступные текущему пользователю сейчас: `EDIT`, `UPLOAD_DOCUMENT`, `SUBMIT`, `WITHDRAW`, `TEACHER_AGREE`, `TEACHER_REJECT`, `DEANERY_APPROVE`, `DEANERY_REJECT`; пустой массив — действий нет |
| `history` | array | только в INT-6; элементы: `fromStatus` (enum \| null — `null` у первого), `toStatus`, `actorRole` (`STUDENT` \| `TEACHER` \| `DEANERY_OFFICER` \| `SYSTEM`), `actorId` и `actorName` (`null` у `SYSTEM`), `comment` (string \| null), `at`; по возрастанию `at` |
| `createdAt`, `updatedAt` | string | — |

### INT-1. Создание черновика заявки — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service`
- **Триггер:** студент на экране «Мои экзамены» нажимает «Перенести экзамен» и сохраняет форму
- **Контракт (запрос):** `POST /api/v1/transfer-requests`
  - `examId` — string, обязательное;
  - `reasonType` — enum, обязательное;
  - `reasonComment` — string \| null, до 1 000 символов; при `OTHER` обязательное.
- **Контракт (ответ):** `201 Created`, `TransferRequest` в статусе `DRAFT`, `document: null`.
- **Пример запроса:**
  ```json
  {
    "examId": "ex-77120",
    "reasonType": "ILLNESS",
    "reasonComment": "ОРВИ, справка из поликлиники"
  }
  ```
- **Пример ответа (успех):**
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "DRAFT",
    "student": { "id": "st-204518", "fullName": "Кузнецов Илья Андреевич", "groupName": "ИВТ-21" },
    "exam": {
      "id": "ex-77120",
      "disciplineName": "Математический анализ",
      "startsAt": "2026-11-20T07:00:00Z",
      "room": "214",
      "teacherId": "t-1093",
      "teacherName": "Миронова Ольга Петровна"
    },
    "reasonType": "ILLNESS",
    "reasonComment": "ОРВИ, справка из поликлиники",
    "document": null,
    "submissionDeadlineAt": "2026-11-17T20:59:59Z",
    "submittedAt": null,
    "teacherDeadlineAt": null,
    "escalated": false,
    "teacherDecision": null,
    "deaneryDecision": null,
    "allowedActions": ["EDIT", "UPLOAD_DOCUMENT"],
    "createdAt": "2026-11-15T16:20:03Z",
    "updatedAt": "2026-11-15T16:20:03Z"
  }
  ```
- **Ошибки:** 400 `VALIDATION_ERROR`; 403 `FORBIDDEN`; 404 `EXAM_NOT_FOUND`; 409 `ACTIVE_REQUEST_EXISTS`; 422 `SUBMISSION_DEADLINE_PASSED`; 503 `DEPENDENCY_UNAVAILABLE`.
- **Состояния UI по ответу (если есть фронт):** значение → переход в форму черновика; загрузка → `action_pending`; ошибки → состояния из «Каталога ошибок».
- **Авторизация:** роль `STUDENT`; экзамен должен быть среди экзаменов студента по INT-12 (иначе 404 `EXAM_NOT_FOUND`).
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-1, FR-8

### INT-2. Правка черновика — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service`
- **Триггер:** студент меняет причину или пояснение и нажимает «Сохранить черновик»
- **Контракт (запрос):** `PATCH /api/v1/transfer-requests/{requestId}` — передаются только меняемые поля: `reasonType` (enum), `reasonComment` (string \| null). Итог проверяется по правилам INT-1.
- **Контракт (ответ):** `200 OK`, `TransferRequest`.
- **Пример запроса:**
  ```json
  { "reasonType": "OTHER", "reasonComment": "Сборы национальной команды по волейболу 18–21 ноября" }
  ```
- **Пример ответа (успех):** `TransferRequest` из INT-1 с новыми `reasonType`, `reasonComment`, `updatedAt`.
- **Ошибки:** 400 `VALIDATION_ERROR`; 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `INVALID_STATUS` (не `DRAFT`); 409 `REQUEST_ALREADY_DECIDED` (`EXPIRED`).
- **Состояния UI по ответу (если есть фронт):** значение → `card_value`; загрузка → `action_pending`; ошибки — по каталогу.
- **Авторизация:** роль `STUDENT`, автор заявки.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-1, FR-8, FR-9

### INT-3. Загрузка документа-подтверждения — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service` (→ INT-16)
- **Триггер:** студент выбирает файл в форме черновика
- **Контракт (запрос):** `PUT /api/v1/transfer-requests/{requestId}/document`, `multipart/form-data`, часть `file` — обязательная. Допустимо: `application/pdf`, `image/jpeg`, `image/png` (тип определяется по содержимому файла, не по расширению); размер ≤ 10 485 760 байт. Повторная загрузка заменяет документ.
- **Контракт (ответ):** `200 OK`, `TransferRequest` с заполненным `document`.
- **Пример запроса:** `multipart/form-data`, часть `file`: `spravka-095u.pdf`, 482 113 байт.
- **Пример ответа (успех):** фрагмент `TransferRequest` — прочие поля как в INT-1
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "DRAFT",
    "document": {
      "fileName": "spravka-095u.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 482113,
      "uploadedAt": "2026-11-15T16:22:40Z",
      "downloadUrl": "https://files.univ.example/d/7Qm2c1Xk",
      "downloadUrlExpiresAt": "2026-11-15T16:27:40Z"
    },
    "allowedActions": ["EDIT", "UPLOAD_DOCUMENT", "SUBMIT"]
  }
  ```
- **Ошибки:** 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `INVALID_STATUS` (не `DRAFT`); 413 `FILE_TOO_LARGE`; 415 `UNSUPPORTED_FILE_TYPE`; 503 `DEPENDENCY_UNAVAILABLE` (`files-service` недоступен).
- **Состояния UI по ответу (если есть фронт):** загрузка → `doc_uploading`; значение → `doc_attached`; 413 → `doc_error_too_large`; 415 → `doc_error_type`; 503 → `action_error_source`.
- **Авторизация:** роль `STUDENT`, автор заявки.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-2, FR-8

### INT-4. Подача заявки — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service` (→ INT-12, INT-15, INT-18)
- **Триггер:** студент нажимает «Подать заявку»
- **Контракт (запрос):** `POST /api/v1/transfer-requests/{requestId}/submit`, тела нет.
- **Контракт (ответ):** `200 OK`, `TransferRequest` в статусе `AT_TEACHER`; `SUBMITTED` — если передача преподавателю отложена из-за недоступности календаря (часть 3, §5.2). `submissionDeadlineAt` и `exam` фиксируются на момент подачи.
- **Пример запроса:** тело отсутствует; `POST /api/v1/transfer-requests/5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13/submit`
- **Пример ответа (успех):** фрагмент `TransferRequest` — прочие поля как в INT-1
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "AT_TEACHER",
    "submissionDeadlineAt": "2026-11-17T20:59:59Z",
    "submittedAt": "2026-11-16T07:00:00Z",
    "teacherDeadlineAt": "2026-11-18T07:00:00Z",
    "allowedActions": ["WITHDRAW"]
  }
  ```
- **Ошибки:** 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `INVALID_STATUS`; 409 `REQUEST_ALREADY_DECIDED` (`EXPIRED`); 422 `DOCUMENT_REQUIRED`; 422 `SUBMISSION_DEADLINE_PASSED` (`details.submissionDeadlineAt`); 503 `DEPENDENCY_UNAVAILABLE` (`schedule-service` недоступен — заявка остаётся `DRAFT`).
- **Состояния UI по ответу (если есть фронт):** загрузка → `action_pending`; значение → `card_value`; 422 → `action_error_deadline` / `action_error_document_required`; 503 → `action_error_source`.
- **Авторизация:** роль `STUDENT`, автор заявки.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-3, FR-7, FR-8, FR-9

### INT-5. Список заявок — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service`
- **Триггер:** открытие экранов «Мои заявки», «Заявки на перенос» (преподаватель), «Заявки на перенос — деканат»; экран «Мои экзамены» — чтобы знать, по каким экзаменам уже есть незавершённая заявка
- **Контракт (запрос):** `GET /api/v1/transfer-requests`
  - `view` — enum `student` \| `teacher` \| `deanery`, обязательный;
  - `status` — список enum через запятую, необязательный; по умолчанию: `student` — все, `teacher` — `AT_TEACHER`, `deanery` — `AT_DEANERY`;
  - `page` — integer ≥ 0, по умолчанию 0; `size` — integer 1–100, по умолчанию 20.
- **Контракт (ответ):** `200 OK`
  - `items` — массив кратких заявок: `id`, `status`, `student`, `exam` (`id`, `disciplineName`, `startsAt`), `reasonType`, `submittedAt`, `teacherDeadlineAt`, `escalated`, `proposedSlot` (object \| null — слот из решения преподавателя); пустой массив — заявок нет;
  - `page`, `size`, `total` — integer.
  - Сортировка: `student` — `createdAt` по убыванию; `teacher` — `teacherDeadlineAt` по возрастанию (`null` в конце), затем `submittedAt`; `deanery` — `exam.startsAt` по возрастанию.
- **Пример запроса:** тело отсутствует; `GET /api/v1/transfer-requests?view=deanery&page=0&size=20`
- **Пример ответа (успех):**
  ```json
  {
    "items": [
      {
        "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
        "status": "AT_DEANERY",
        "student": { "id": "st-204518", "fullName": "Кузнецов Илья Андреевич", "groupName": "ИВТ-21" },
        "exam": { "id": "ex-77120", "disciplineName": "Математический анализ", "startsAt": "2026-11-20T07:00:00Z" },
        "reasonType": "ILLNESS",
        "submittedAt": "2026-11-16T07:00:00Z",
        "teacherDeadlineAt": "2026-11-18T07:00:00Z",
        "escalated": false,
        "proposedSlot": { "slotId": "sl-55021", "startsAt": "2026-11-27T07:00:00Z", "endsAt": "2026-11-27T08:30:00Z", "room": "305" }
      }
    ],
    "page": 0,
    "size": 20,
    "total": 1
  }
  ```
- **Ошибки:** 400 `VALIDATION_ERROR`; 403 `FORBIDDEN` (`view` не соответствует роли).
- **Состояния UI по ответу (если есть фронт):** загрузка → `list_loading`; значение → `list_value`; `items: []` → `list_empty`; 5xx / сеть → `list_error_source`; 403 → `error_forbidden`.
- **Авторизация:** `view=student` — роль `STUDENT`, только свои; `view=teacher` — роль `TEACHER`, заявки по его экзаменам, кроме `DRAFT`; `view=deanery` — роль `DEANERY_OFFICER`, заявки студентов его факультета, кроме `DRAFT`.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-4, FR-8, FR-11

### INT-6. Карточка заявки — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service` (→ INT-17)
- **Триггер:** открытие карточки заявки любой ролью
- **Контракт (запрос):** `GET /api/v1/transfer-requests/{requestId}`, тела нет.
- **Контракт (ответ):** `200 OK`, `TransferRequest` с `history`; `document.downloadUrl` получается при каждом запросе через INT-17 со сроком жизни 5 минут.
- **Пример запроса:** тело отсутствует; `GET /api/v1/transfer-requests/5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13`
- **Пример ответа (успех):** для сотрудника деканата
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "AT_DEANERY",
    "student": { "id": "st-204518", "fullName": "Кузнецов Илья Андреевич", "groupName": "ИВТ-21" },
    "exam": {
      "id": "ex-77120",
      "disciplineName": "Математический анализ",
      "startsAt": "2026-11-20T07:00:00Z",
      "room": "214",
      "teacherId": "t-1093",
      "teacherName": "Миронова Ольга Петровна"
    },
    "reasonType": "ILLNESS",
    "reasonComment": "ОРВИ, справка из поликлиники",
    "document": {
      "fileName": "spravka-095u.pdf",
      "contentType": "application/pdf",
      "sizeBytes": 482113,
      "uploadedAt": "2026-11-15T16:22:40Z",
      "downloadUrl": "https://files.univ.example/d/9Rt4p0Lw",
      "downloadUrlExpiresAt": "2026-11-18T09:05:00Z"
    },
    "submissionDeadlineAt": "2026-11-17T20:59:59Z",
    "submittedAt": "2026-11-16T07:00:00Z",
    "teacherDeadlineAt": "2026-11-18T07:00:00Z",
    "escalated": false,
    "teacherDecision": {
      "decision": "AGREED",
      "slot": { "slotId": "sl-55021", "startsAt": "2026-11-27T07:00:00Z", "endsAt": "2026-11-27T08:30:00Z", "room": "305" },
      "comment": null,
      "decidedAt": "2026-11-17T11:45:10Z",
      "decidedBy": { "id": "t-1093", "fullName": "Миронова Ольга Петровна" }
    },
    "deaneryDecision": null,
    "allowedActions": ["DEANERY_APPROVE", "DEANERY_REJECT"],
    "history": [
      { "fromStatus": null, "toStatus": "DRAFT", "actorRole": "STUDENT", "actorId": "st-204518", "actorName": "Кузнецов Илья Андреевич", "comment": null, "at": "2026-11-15T16:20:03Z" },
      { "fromStatus": "DRAFT", "toStatus": "SUBMITTED", "actorRole": "STUDENT", "actorId": "st-204518", "actorName": "Кузнецов Илья Андреевич", "comment": null, "at": "2026-11-16T07:00:00Z" },
      { "fromStatus": "SUBMITTED", "toStatus": "AT_TEACHER", "actorRole": "SYSTEM", "actorId": null, "actorName": null, "comment": null, "at": "2026-11-16T07:00:01Z" },
      { "fromStatus": "AT_TEACHER", "toStatus": "AT_DEANERY", "actorRole": "TEACHER", "actorId": "t-1093", "actorName": "Миронова Ольга Петровна", "comment": null, "at": "2026-11-17T11:45:10Z" }
    ],
    "createdAt": "2026-11-15T16:20:03Z",
    "updatedAt": "2026-11-17T11:45:10Z"
  }
  ```
- **Ошибки:** 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`.
- **Состояния UI по ответу (если есть фронт):** загрузка → `card_loading`; значение → `card_value`; `document: null` → `doc_none`; `downloadUrl: null` → `doc_link_unavailable`; 404 → `card_not_found`; 403 → `error_forbidden`; 5xx / сеть → `card_error_source`.
- **Авторизация:** студент — свои заявки в любом статусе; преподаватель — заявки по своим экзаменам, кроме `DRAFT`; сотрудник деканата — заявки студентов своего факультета, кроме `DRAFT`; иначе 403. `allowedActions` вычисляется для текущего пользователя.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-4, FR-8, FR-10, FR-11

### INT-7. Свободные слоты для заявки — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service` (→ INT-13)
- **Триггер:** преподаватель открывает выбор даты в карточке заявки `AT_TEACHER`; сотрудник деканата нажимает «Выбрать другой слот» в карточке `AT_DEANERY`
- **Контракт (запрос):** `GET /api/v1/transfer-requests/{requestId}/available-slots`; диапазон задаёт сервис: со следующего дня до `exam.startsAt` + 30 дней.
- **Контракт (ответ):** `200 OK`, `items` — массив: `slotId` (string), `startsAt`, `endsAt` (string), `room` (string), `freePlaces` (integer ≥ 1); по возрастанию `startsAt`; пустой массив — свободных слотов нет.
- **Пример запроса:** тело отсутствует; `GET /api/v1/transfer-requests/5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13/available-slots`
- **Пример ответа (успех):**
  ```json
  {
    "items": [
      { "slotId": "sl-55021", "startsAt": "2026-11-27T07:00:00Z", "endsAt": "2026-11-27T08:30:00Z", "room": "305", "freePlaces": 2 },
      { "slotId": "sl-55034", "startsAt": "2026-11-28T11:00:00Z", "endsAt": "2026-11-28T12:30:00Z", "room": "305", "freePlaces": 1 }
    ]
  }
  ```
- **Ошибки:** 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `INVALID_STATUS`; 409 `REQUEST_ALREADY_DECIDED`; 503 `DEPENDENCY_UNAVAILABLE`.
- **Состояния UI по ответу (если есть фронт):** загрузка → `slots_loading`; значение → `slots_value`; `items: []` → `slots_empty`; 503 / сеть → `slots_error_source`.
- **Авторизация:** `TEACHER` — преподаватель экзамена при `AT_TEACHER`; `DEANERY_OFFICER` своего факультета при `AT_DEANERY`.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-4, FR-11

### INT-8. Решение преподавателя — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service` (→ INT-13, INT-18)
- **Триггер:** преподаватель нажимает «Согласовать» (со слотом) или «Отклонить» (с комментарием)
- **Контракт (запрос):** `POST /api/v1/transfer-requests/{requestId}/teacher-decision`
  - `decision` — enum `AGREED` \| `REJECTED`, обязательное;
  - `slotId` — string \| null; при `AGREED` обязательное, при `REJECTED` — `null`;
  - `comment` — string \| null, до 1 000 символов; при `REJECTED` обязательное (не пустое).
- **Контракт (ответ):** `200 OK`, `TransferRequest`: `AGREED` → `AT_DEANERY`, `REJECTED` → `REJECTED`; `teacherDecision` заполнен.
- **Пример запроса:**
  ```json
  { "decision": "AGREED", "slotId": "sl-55021", "comment": null }
  ```
- **Пример ответа (успех):** фрагмент `TransferRequest` — прочие поля как в INT-6
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "AT_DEANERY",
    "teacherDecision": {
      "decision": "AGREED",
      "slot": { "slotId": "sl-55021", "startsAt": "2026-11-27T07:00:00Z", "endsAt": "2026-11-27T08:30:00Z", "room": "305" },
      "comment": null,
      "decidedAt": "2026-11-17T11:45:10Z",
      "decidedBy": { "id": "t-1093", "fullName": "Миронова Ольга Петровна" }
    },
    "allowedActions": []
  }
  ```
- **Ошибки:** 400 `VALIDATION_ERROR`; 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `SLOT_TAKEN` (слота нет среди свободных по INT-13); 409 `INVALID_STATUS` (`AT_DEANERY` после эскалации — `details.currentStatus`); 409 `REQUEST_ALREADY_DECIDED`; 503 `DEPENDENCY_UNAVAILABLE`.
- **Состояния UI по ответу (если есть фронт):** загрузка → `action_pending`; значение → `card_value`; 409 `SLOT_TAKEN` → `action_error_slot_taken`; 409 `INVALID_STATUS` → `action_error_stale`; 409 `REQUEST_ALREADY_DECIDED` → `action_error_already_decided`.
- **Авторизация:** роль `TEACHER`, `teacherId` экзамена = пользователь; иначе 403.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-4, FR-5, FR-7, FR-8, FR-9

### INT-9. Решение деканата — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service` (→ INT-14, INT-18)
- **Триггер:** сотрудник деканата нажимает «Утвердить» или «Отклонить»
- **Контракт (запрос):** `POST /api/v1/transfer-requests/{requestId}/deanery-decision`
  - `decision` — enum `APPROVED` \| `REJECTED`, обязательное;
  - `slotId` — string \| null; при `APPROVED` обязательное (фронт подставляет слот преподавателя, сотрудник может выбрать другой из INT-7; после эскалации выбирает сам); при `REJECTED` — `null`;
  - `comment` — string \| null, до 1 000 символов; при `REJECTED` обязательное.
- **Контракт (ответ):** `200 OK`, `TransferRequest`: `APPROVED` (слот зарезервирован, расписание обновлено) или `REJECTED`; `deaneryDecision` заполнен.
- **Пример запроса:**
  ```json
  { "decision": "APPROVED", "slotId": "sl-55021", "comment": null }
  ```
- **Пример ответа (успех):** фрагмент `TransferRequest` — прочие поля как в INT-6
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "APPROVED",
    "deaneryDecision": {
      "decision": "APPROVED",
      "slot": { "slotId": "sl-55021", "startsAt": "2026-11-27T07:00:00Z", "endsAt": "2026-11-27T08:30:00Z", "room": "305" },
      "comment": null,
      "decidedAt": "2026-11-18T09:12:44Z",
      "decidedBy": { "id": "dn-0412", "fullName": "Белова Татьяна Николаевна" }
    },
    "allowedActions": []
  }
  ```
- **Ошибки:** 400 `VALIDATION_ERROR`; 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `SLOT_TAKEN` (ответ INT-14 — заявка остаётся `AT_DEANERY`); 409 `INVALID_STATUS`; 409 `REQUEST_ALREADY_DECIDED`; 503 `DEPENDENCY_UNAVAILABLE` (`schedule-service` недоступен или таймаут — заявка остаётся `AT_DEANERY`).
- **Состояния UI по ответу (если есть фронт):** загрузка → `action_pending`; значение → `card_value`; 409 `SLOT_TAKEN` → `action_error_slot_taken`, список слотов перезапрашивается; 503 → `action_error_source`, выбранный слот сохраняется для повтора.
- **Авторизация:** роль `DEANERY_OFFICER`, `facultyId` из токена = факультет студента заявки; иначе 403.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-8, FR-9, FR-11, FR-12, FR-13

### INT-10. Отзыв заявки — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service`
- **Триггер:** студент нажимает «Отозвать заявку» и подтверждает
- **Контракт (запрос):** `POST /api/v1/transfer-requests/{requestId}/withdraw`, тела нет.
- **Контракт (ответ):** `200 OK`, `TransferRequest` в статусе `WITHDRAWN`. Допустим из `SUBMITTED`, `AT_TEACHER`, `AT_DEANERY`.
- **Пример запроса:** тело отсутствует; `POST /api/v1/transfer-requests/5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13/withdraw`
- **Пример ответа (успех):** фрагмент `TransferRequest` — прочие поля как в INT-6
  ```json
  {
    "id": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13",
    "status": "WITHDRAWN",
    "allowedActions": [],
    "updatedAt": "2026-11-17T08:03:51Z"
  }
  ```
- **Ошибки:** 403 `FORBIDDEN`; 404 `REQUEST_NOT_FOUND`; 409 `INVALID_STATUS` (`DRAFT`); 409 `REQUEST_ALREADY_DECIDED` (`APPROVED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`).
- **Состояния UI по ответу (если есть фронт):** загрузка → `action_pending`; значение → `card_value`; 409 → `action_error_already_decided` / `action_error_stale`.
- **Авторизация:** роль `STUDENT`, автор заявки.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-6, FR-8, FR-9

### INT-11. Настройки сроков — 🟢
- **Вид:** новое
- **Граница/направление:** FE `student-portal` → BE `requests-service`
- **Триггер:** администратор учебного отдела открывает экран «Сроки переноса экзаменов» (GET) и сохраняет изменения (PUT)
- **Контракт (запрос):**
  - `GET /api/v1/settings/deadlines` — тела нет;
  - `PUT /api/v1/settings/deadlines` — `submissionLeadDays` (integer 1–14, обязательное), `teacherResponseWorkingDays` (integer 1–10, обязательное).
- **Контракт (ответ):** `200 OK`: `submissionLeadDays`, `teacherResponseWorkingDays` (integer), `updatedAt` (string), `updatedBy` (object \| null — `null`, пока значения по умолчанию не менялись; иначе `id`, `fullName`). Новые значения действуют для подач и передач преподавателю после сохранения.
- **Пример запроса:**
  ```json
  { "submissionLeadDays": 5, "teacherResponseWorkingDays": 3 }
  ```
- **Пример ответа (успех):**
  ```json
  {
    "submissionLeadDays": 5,
    "teacherResponseWorkingDays": 3,
    "updatedAt": "2027-02-02T10:15:00Z",
    "updatedBy": { "id": "aa-0007", "fullName": "Громова Светлана Игоревна" }
  }
  ```
- **Ошибки:** 400 `VALIDATION_ERROR` (вне диапазона, не целое); 403 `FORBIDDEN`.
- **Состояния UI по ответу (если есть фронт):** загрузка → `settings_loading`; значение → `settings_value`; сохранение → `settings_saving`; 400 → `settings_error_validation`; 5xx / сеть → `settings_error_source`.
- **Авторизация:** только роль `ACADEMIC_ADMIN`, для GET и PUT.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-16

### INT-12. Экзамены студента — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** `requests-service` → `schedule-service`
- **Триггер:** INT-1 (проверить, что экзамен студента, и снять данные), INT-4 (обновить дату и преподавателя перед проверкой срока)
- **Контракт (запрос):** `GET /api/v2/students/{studentId}/exams` — 🔵 подтверждено аналитиком (по карточке services/schedule-service.md; валидировать при интеграции)
- **Контракт (ответ):** `items[]`: `examId`, `disciplineName`, `startsAt`, `room`, `teacherId`, `teacherName`, `facultyId`, `groupName` — 🔵 по карточке.
- **Пример запроса:** тело отсутствует; `GET /api/v2/students/st-204518/exams`
- **Пример ответа (успех):** фрагмент: прочие поля — без изменений
  ```json
  {
    "items": [
      {
        "examId": "ex-77120",
        "disciplineName": "Математический анализ",
        "startsAt": "2026-11-20T07:00:00Z",
        "room": "214",
        "teacherId": "t-1093",
        "teacherName": "Миронова Ольга Петровна",
        "facultyId": "fac-it",
        "groupName": "ИВТ-21"
      }
    ]
  }
  ```
- **Ошибки:** 5xx / таймаут 5 с → наш 503 `DEPENDENCY_UNAVAILABLE`.
- **Состояния UI по ответу (если есть фронт):** фронт не вызывает; см. INT-1, INT-4.
- **Авторизация:** 🔵 сервисный токен `requests-service` (со слов; валидировать при интеграции).
- **Происхождение:** 🔵 подтверждено аналитиком (по карточке services/schedule-service.md)
- **Трассировка:** FR-1, FR-3

### INT-13. Свободные слоты преподавателя — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** `requests-service` → `schedule-service`
- **Триггер:** INT-7 (показать слоты), INT-8 (проверить, что выбранный слот ещё свободен)
- **Контракт (запрос):** `GET /api/v2/teachers/{teacherId}/slots?status=FREE&from=<дата>&to=<дата>` — 🔵 подтверждено аналитиком (по коду schedule-service, ветка master; валидировать при интеграции)
- **Контракт (ответ):** `items[]`: `slotId`, `startsAt`, `endsAt`, `room`, `freePlaces` — 🔵 по коду.
- **Пример запроса:** тело отсутствует; `GET /api/v2/teachers/t-1093/slots?status=FREE&from=2026-11-18&to=2026-12-20`
- **Пример ответа (успех):**
  ```json
  {
    "items": [
      { "slotId": "sl-55021", "startsAt": "2026-11-27T07:00:00Z", "endsAt": "2026-11-27T08:30:00Z", "room": "305", "freePlaces": 2 }
    ]
  }
  ```
- **Ошибки:** 5xx / таймаут 5 с → наш 503 `DEPENDENCY_UNAVAILABLE`.
- **Состояния UI по ответу (если есть фронт):** через INT-7.
- **Авторизация:** 🔵 сервисный токен `requests-service` (со слов; валидировать при интеграции).
- **Происхождение:** 🔵 подтверждено аналитиком (по коду schedule-service, ветка master)
- **Трассировка:** FR-4, FR-11

### INT-14. Резервирование слота под перенесённый экзамен — 🟢
- **Вид:** новое (новый метод в существующем `schedule-service`; реализует команда «Расписание» по этому контракту)
- **Граница/направление:** `requests-service` → `schedule-service`
- **Триггер:** INT-9 с `decision = APPROVED`
- **Контракт (запрос):** `POST /api/v2/slots/{slotId}/reservations`
  - `slotId` — путь, string, обязательный;
  - `studentId` — string, обязательное;
  - `examId` — string, обязательное — экзамен студента, который переносится;
  - `externalRequestId` — string, обязательное — `id` заявки; ключ идемпотентности.
- **Контракт (ответ):**
  - `201 Created` — резерв создан: место в слоте занято (`freePlaces` − 1), экзамен `examId` студента в расписании перенесён на время и аудиторию слота — INT-12 для этого студента дальше отдаёт новые `startsAt` и `room`. Всё атомарно на стороне `schedule-service`;
  - `200 OK` — повтор с тем же `externalRequestId` и тем же `slotId`: прежний резерв, ничего не меняется;
  - поля: `reservationId`, `slotId`, `examId`, `studentId` (string), `startsAt`, `endsAt`, `createdAt` (string, ISO 8601 UTC), `room` (string); `null` не бывает.
- **Пример запроса:**
  ```json
  {
    "studentId": "st-204518",
    "examId": "ex-77120",
    "externalRequestId": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13"
  }
  ```
- **Пример ответа (успех):**
  ```json
  {
    "reservationId": "rsv-90412",
    "slotId": "sl-55021",
    "examId": "ex-77120",
    "studentId": "st-204518",
    "startsAt": "2026-11-27T07:00:00Z",
    "endsAt": "2026-11-27T08:30:00Z",
    "room": "305",
    "createdAt": "2026-11-18T09:12:44Z"
  }
  ```
- **Ошибки:** тело по общему формату §2:
  - 404 `SLOT_NOT_FOUND` — слота нет или он отменён;
  - 409 `SLOT_TAKEN` — `freePlaces` = 0;
  - 409 `ALREADY_RESERVED` — `externalRequestId` уже использован с другим слотом; `details.reservation` — существующий резерв в форме ответа 201;
  - 422 `STUDENT_NOT_IN_EXAM` — студент не записан на `examId`;
  - 403 `FORBIDDEN` — вызывающий не сервисный аккаунт `requests-service`.
- **Состояния UI по ответу (если есть фронт):** через INT-9: `SLOT_TAKEN`, `SLOT_NOT_FOUND` → наш 409 `SLOT_TAKEN`; `ALREADY_RESERVED` → заявка утверждается на слот существующего резерва (§3.1); 5xx / таймаут 5 с → наш 503.
- **Авторизация:** только сервисный аккаунт `requests-service` (SSO, client credentials); проверяет `schedule-service`.
- **Происхождение:** 🟢 новое
- **Трассировка:** FR-11

### INT-15. Рабочие дни — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** `requests-service` → `schedule-service`
- **Триггер:** расчёт `teacherDeadlineAt` при передаче заявки преподавателю (часть 3)
- **Контракт (запрос):** `GET /api/v2/calendar/working-days?from=<YYYY-MM-DD>&to=<YYYY-MM-DD>` — 🔵 подтверждено аналитиком (по карточке services/schedule-service.md; валидировать при интеграции)
- **Контракт (ответ):** `days[]`: `date` (string, `YYYY-MM-DD`), `working` (boolean) — 🔵 по карточке.
- **Пример запроса:** тело отсутствует; `GET /api/v2/calendar/working-days?from=2026-11-01&to=2026-11-30`
- **Пример ответа (успех):** фрагмент массива
  ```json
  {
    "days": [
      { "date": "2026-11-20", "working": true },
      { "date": "2026-11-21", "working": false },
      { "date": "2026-11-22", "working": false },
      { "date": "2026-11-23", "working": true }
    ]
  }
  ```
- **Ошибки:** 5xx / таймаут 5 с → заявка остаётся `SUBMITTED`, передачу повторяет фоновая задача (§5.2).
- **Состояния UI по ответу (если есть фронт):** фронт не вызывает.
- **Авторизация:** 🔵 сервисный токен `requests-service` (со слов; валидировать при интеграции).
- **Происхождение:** 🔵 подтверждено аналитиком (по карточке services/schedule-service.md)
- **Трассировка:** FR-14

### INT-16. Сохранение документа в файловом хранилище — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** `requests-service` → `files-service`
- **Триггер:** INT-3 после проверки размера и типа
- **Контракт (запрос):** `POST /api/v1/buckets/{bucket}/files`, `multipart/form-data`, часть `file` — 🔵 подтверждено аналитиком (по карточке services/files-service.md; валидировать при интеграции); `bucket` = `exam-transfer-documents`.
- **Контракт (ответ):** `201`: `fileId`, `size`, `contentType` — 🔵 по карточке.
- **Пример запроса:** `multipart/form-data`, часть `file`: `spravka-095u.pdf`.
- **Пример ответа (успех):**
  ```json
  { "fileId": "f-3c9a71e0", "size": 482113, "contentType": "application/pdf" }
  ```
- **Ошибки:** 5xx / таймаут 30 с → наш 503 `DEPENDENCY_UNAVAILABLE`, черновик без изменений.
- **Состояния UI по ответу (если есть фронт):** через INT-3.
- **Авторизация:** 🔵 сервисный токен с доступом к бакету (по карточке services/files-service.md; валидировать при интеграции).
- **Происхождение:** 🔵 подтверждено аналитиком (по карточке services/files-service.md)
- **Трассировка:** FR-2

### INT-17. Временная ссылка на документ — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** `requests-service` → `files-service`
- **Триггер:** INT-6 и ответы с объектом `document`
- **Контракт (запрос):** `GET /api/v1/files/{fileId}/download-link?ttlSeconds=300` — 🔵 подтверждено аналитиком (по карточке services/files-service.md; валидировать при интеграции)
- **Контракт (ответ):** `url`, `expiresAt` — 🔵 по карточке.
- **Пример запроса:** тело отсутствует; `GET /api/v1/files/f-3c9a71e0/download-link?ttlSeconds=300`
- **Пример ответа (успех):**
  ```json
  { "url": "https://files.univ.example/d/9Rt4p0Lw", "expiresAt": "2026-11-18T09:05:00Z" }
  ```
- **Ошибки:** 5xx / таймаут 3 с → `document.downloadUrl: null`, карточка отдаётся без ссылки.
- **Состояния UI по ответу (если есть фронт):** через INT-6: `doc_link_unavailable`.
- **Авторизация:** 🔵 сервисный токен (по карточке services/files-service.md; валидировать при интеграции); пользователю ссылку отдаёт только INT-6 после своей проверки доступа.
- **Происхождение:** 🔵 подтверждено аналитиком (по карточке services/files-service.md)
- **Трассировка:** FR-4, FR-11

### INT-18. Отправка уведомления — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** `requests-service` (отправитель очереди уведомлений) → `notifications`
- **Триггер:** смена статуса заявки (§3.1, таблица уведомлений)
- **Контракт (запрос):** `POST /api/v1/notifications` — 🔵 подтверждено аналитиком (по коду notifications, ветка main; валидировать при интеграции): `recipientId`, `channels` (`EMAIL`, `PORTAL`), `subject`, `body`, `dedupKey`; повтор с тем же `dedupKey` второе уведомление не создаёт.
- **Контракт (ответ):** `202`: `notificationId` — 🔵 по коду.
- **Пример запроса:**
  ```json
  {
    "recipientId": "st-204518",
    "channels": ["EMAIL", "PORTAL"],
    "subject": "Перенос экзамена утверждён",
    "body": "Экзамен «Математический анализ» перенесён на 27.11.2026, 10:00, аудитория 305.",
    "dedupKey": "5d0e8a1c-3b7f-4e2a-9c61-7f4b2d8e0a13:APPROVED:st-204518"
  }
  ```
- **Пример ответа (успех):**
  ```json
  { "notificationId": "ntf-6619028" }
  ```
- **Ошибки:** 5xx / таймаут 5 с → повтор из очереди (§5.2); статус заявки от этого не зависит.
- **Состояния UI по ответу (если есть фронт):** фронт не вызывает.
- **Авторизация:** 🔵 сервисный токен `requests-service` (со слов; валидировать при интеграции).
- **Происхождение:** 🔵 подтверждено аналитиком (по коду notifications, ветка main)
- **Трассировка:** FR-3, FR-7, FR-13, FR-14, FR-15

### Каталог ошибок (сводно) — последний подраздел §2, после всех INT-карточек
| Код | Тело/сообщение | Когда | Состояние UI |
|-----|----------------|-------|--------------|
| 400 | `VALIDATION_ERROR` — «Проверьте заполнение полей»; `details.fields` — список полей | нет обязательного поля, пустой комментарий при отклонении, нет пояснения при `OTHER`, значение вне диапазона | подсветка полей формы; в настройках — `settings_error_validation` |
| 401 | `UNAUTHORIZED` | нет или истёк токен SSO | существующий переход на вход |
| 403 | `FORBIDDEN` — «Нет прав» | чужая заявка, не та роль, чужой факультет или экзамен (FR-8) | `error_forbidden` |
| 404 | `REQUEST_NOT_FOUND` — «Заявка не найдена» | заявки нет | `card_not_found` |
| 404 | `EXAM_NOT_FOUND` — «Экзамен не найден в вашем расписании» | INT-1: экзамена нет среди экзаменов студента | сообщение в форме, `action_error_source` |
| 404 | `FEATURE_DISABLED` | флаг `exam-transfer-requests` выключен | `feature_disabled` |
| 409 | `ACTIVE_REQUEST_EXISTS` — «По этому экзамену уже есть заявка»; `details.requestId` | INT-1: есть незавершённая заявка по экзамену | `action_error_active_exists`, ссылка на заявку |
| 409 | `INVALID_STATUS` — «Заявка изменилась, обновите страницу»; `details.currentStatus` | действие не допускается в текущем незавершённом статусе (правка поданной, решение преподавателя после эскалации) | `action_error_stale`, карточка перезапрашивается |
| 409 | `REQUEST_ALREADY_DECIDED` — «Заявка уже решена»; `details.currentStatus` | статус `APPROVED`, `REJECTED`, `WITHDRAWN` или `EXPIRED` (FR-9) | `action_error_already_decided`, карточка перезапрашивается |
| 409 | `SLOT_TAKEN` — «Слот уже занят, выберите другой»; `details.slotId` | INT-8: слота нет среди свободных; INT-9: INT-14 ответил `SLOT_TAKEN` или `SLOT_NOT_FOUND` | `action_error_slot_taken`, слоты перезапрашиваются |
| 413 | `FILE_TOO_LARGE` — «Файл слишком большой: не более 10 МБ» | файл больше 10 485 760 байт | `doc_error_too_large` |
| 415 | `UNSUPPORTED_FILE_TYPE` — «Допустимы PDF, JPG, PNG» | тип файла не из списка | `doc_error_type` |
| 422 | `SUBMISSION_DEADLINE_PASSED` — «Срок подачи прошёл»; `details.submissionDeadlineAt` | INT-1, INT-4: после крайнего срока подачи | `action_error_deadline` |
| 422 | `DOCUMENT_REQUIRED` — «Приложите документ-подтверждение» | INT-4: документа нет | `action_error_document_required` |
| 500 | `INTERNAL_ERROR` — «Что-то пошло не так, повторите позже» | внутренняя ошибка `requests-service` | `action_error_source` / `card_error_source` / `list_error_source` |
| 503 | `DEPENDENCY_UNAVAILABLE` — «Сервис временно недоступен, повторите позже» | `schedule-service` или `files-service` недоступны / таймаут | `action_error_source`, `slots_error_source` |

## 3. Backend — ответственность

### 3.1. По сервисам
**`requests-service`** (🟢, новый):
- Реализует INT-1 – INT-11; вызывает INT-12 – INT-18.
- Переходы статусов (каждый переход — строка истории в той же транзакции):

  | Из | Действие | Кто | В | Часть |
  |----|----------|-----|---|-------|
  | — | создать (INT-1) | `STUDENT` | `DRAFT` | 1 |
  | `DRAFT` | подать (INT-4) | `STUDENT` | `SUBMITTED` | 1 |
  | `SUBMITTED` | передать преподавателю | `SYSTEM` | `AT_TEACHER` | 1 |
  | `AT_TEACHER` | согласовать (INT-8) | `TEACHER` | `AT_DEANERY` | 1 |
  | `AT_TEACHER` | отклонить (INT-8) | `TEACHER` | `REJECTED` | 1 |
  | `SUBMITTED`, `AT_TEACHER`, `AT_DEANERY` | отозвать (INT-10) | `STUDENT` | `WITHDRAWN` | 1 |
  | `AT_DEANERY` | утвердить (INT-9) | `DEANERY_OFFICER` | `APPROVED` | 2 |
  | `AT_DEANERY` | отклонить (INT-9) | `DEANERY_OFFICER` | `REJECTED` | 2 |
  | `AT_TEACHER` | истёк `teacherDeadlineAt` | `SYSTEM` | `AT_DEANERY`, `escalated = true` | 3 |
  | `SUBMITTED`, `AT_TEACHER`, `AT_DEANERY` | наступил `exam.startsAt` | `SYSTEM` | `EXPIRED` | 3 |
  | `DRAFT` | прошёл крайний срок подачи | `SYSTEM` | `EXPIRED` | 3 |

- Каждый переход — условное обновление «`WHERE id = … AND status = <ожидаемый>`»; 0 строк → 409 `REQUEST_ALREADY_DECIDED` (финальный статус) или `INVALID_STATUS` (прочие).
- **Крайний срок подачи** = 23:59:59 по Москве даты (`exam.startsAt` по Москве − `submissionLeadDays` календарных дней). Экзамен 20.11 → 17.11 23:59:59; 18.11 00:00:00 — 422.
- **Подача (INT-4):** проверить автора и `DRAFT` → документ есть, иначе 422 `DOCUMENT_REQUIRED` → INT-12: актуальные дата, аудитория, преподаватель (экзамена больше нет у студента → 404 `EXAM_NOT_FOUND`) → проверка срока по текущим настройкам → транзакция: снимок `exam`, `submissionDeadlineAt`, `submittedAt`, `DRAFT → SUBMITTED`, уведомление студенту в очередь → затем передача преподавателю.
- **Передача преподавателю:** `SUBMITTED → AT_TEACHER`, `atTeacherAt` = now, уведомление преподавателю в очередь; с части 3 — расчёт `teacherDeadlineAt`. Не удалась (часть 3: INT-15 недоступен) — остаётся `SUBMITTED`, повторяет фоновая задача.
- **`teacherDeadlineAt`** (часть 3) = `atTeacherAt` + `teacherResponseWorkingDays` рабочих дней по INT-15 с сохранением времени суток; пришла в нерабочий день — отсчёт с 00:00 следующего рабочего дня. Понедельник 16.11 10:00 → среда 18.11 10:00; пятница 20.11 18:00 → вторник 24.11 18:00.
- **Решение преподавателя (INT-8):** `AGREED` — слот должен быть в INT-13 с `freePlaces` ≥ 1, иначе 409 `SLOT_TAKEN`; слот не резервируется, только запоминается; с части 3 — после `exam.startsAt` → 409 `REQUEST_ALREADY_DECIDED` и перевод в `EXPIRED`.
- **Утверждение (INT-9, `APPROVED`):** в транзакции блокировка строки заявки (`SELECT … FOR UPDATE`, статус `AT_DEANERY`) → INT-14 с таймаутом 5 с → 201/200: `deaneryDecision`, итоговый слот, `reservationId`, `APPROVED`, история, уведомление → фиксация. `SLOT_TAKEN` / `SLOT_NOT_FOUND` → откат, 409 `SLOT_TAKEN`. `ALREADY_RESERVED` → утверждение на слот из `details.reservation` (расписание уже обновлено, источник истины — `schedule-service`). 5xx / таймаут → откат, 503. Блокировка не даёт отзыву (INT-10) и фоновой задаче изменить заявку во время вызова.
- **Уведомления** (через очередь `notification_outbox` → INT-18; `dedupKey` = `<requestId>:<toStatus>:<recipientId>`):

  | Переход | Кому | Тема | Текст |
  |---------|------|------|-------|
  | `DRAFT → SUBMITTED` | студент | «Заявка на перенос экзамена подана» | дисциплина, дата экзамена |
  | `SUBMITTED → AT_TEACHER` | преподаватель | «Новая заявка на перенос экзамена» | дисциплина, ФИО и группа студента, срок ответа (с части 3) |
  | `AT_TEACHER → AT_DEANERY` (согласовано) | студент | «Преподаватель согласовал перенос» | предложенные дата, время, аудитория; ждёт утверждения деканатом |
  | `AT_TEACHER → REJECTED` | студент | «Преподаватель отклонил заявку» | комментарий преподавателя |
  | `AT_DEANERY → APPROVED` | студент | «Перенос экзамена утверждён» | новые дата, время, аудитория |
  | `AT_DEANERY → REJECTED` | студент | «Деканат отклонил заявку» | комментарий деканата |
  | `AT_TEACHER → AT_DEANERY` (эскалация) | студент | «Заявка передана в деканат» | преподаватель не ответил в срок, дату выберет деканат |
  | `→ EXPIRED` | студент | «Заявка на перенос просрочена» | дисциплина, причина: нет решения к экзамену / черновик не подан в срок |

  `→ WITHDRAWN` — без уведомления: действие самого студента.
- **Фоновая задача `transfer-requests-scheduler`:** каждые 10 минут на каждом экземпляре, строки берутся `FOR UPDATE SKIP LOCKED` пачками по 100; не работает при выключенном флаге:
  1. передача преподавателю заявок `SUBMITTED` старше 1 минуты;
  2. часть 3: эскалация `AT_TEACHER` с `teacherDeadlineAt` ≤ now;
  3. часть 3: просрочка `SUBMITTED` / `AT_TEACHER` / `AT_DEANERY` с `exam.startsAt` ≤ now и `DRAFT` после крайнего срока подачи (по текущим настройкам);
  4. часть 3, первый запуск после выпуска: `teacherDeadlineAt` для заявок `AT_TEACHER` без срока — от момента выпуска, а не от `atTeacherAt`.
- **Отправитель очереди уведомлений:** каждые 30 секунд, `PENDING` с `next_attempt_at` ≤ now; до 10 попыток с паузой 1, 2, 4 … минуты (не больше 30); после 10-й — `FAILED`, ошибка в журнал сервиса.
- **Кэш:** настройки сроков — 60 с в памяти экземпляра; календарь INT-15 — по месяцу на 24 ч.

**`schedule-service`** (команда «Расписание»):
- 🟢 Реализует INT-14 по контракту §2: атомарно занять место в слоте и перенести экзамен студента в расписании; идемпотентность по `externalRequestId`; доступ только сервисному аккаунту `requests-service`.
- 🔵 INT-12, INT-13, INT-15 — существующие методы, без изменений (источники — в карточках INT).

**`files-service`, `notifications`:** 🔵 только потребление (INT-16, INT-17, INT-18), изменений нет.

### 3.2. Данные и хранение
Хранилище `requests-service` — новая собственная БД. Все сущности ниже 🟢, кроме отмеченных.
- 🟢 `transfer_request` — заявка:
  - `id` (uuid, PK); `status` (enum, §2); `version` (integer);
  - `student_id`, `student_full_name`, `group_name` (string);
  - `exam_id`, `discipline_name`, `exam_room`, `teacher_id`, `teacher_name`, `faculty_id` (string); `exam_starts_at` (timestamptz) — снимок INT-12, обновляется при подаче;
  - `reason_type` (enum), `reason_comment` (string ≤ 1 000 | null);
  - `document_file_id`, `document_file_name`, `document_content_type` (string | null), `document_size_bytes` (integer | null), `document_uploaded_at` (timestamptz | null);
  - `submission_deadline_at`, `submitted_at`, `at_teacher_at` (timestamptz | null);
  - `final_slot_id`, `final_room`, `reservation_id` (string | null), `final_slot_starts_at`, `final_slot_ends_at`, `decided_at` (timestamptz | null) — часть 2;
  - `teacher_deadline_at` (timestamptz | null), `escalated` (boolean, default `false`) — часть 3;
  - `created_at`, `updated_at` (timestamptz).
  - Уникальный частичный индекс (`student_id`, `exam_id`) при `status` ∈ (`DRAFT`, `SUBMITTED`, `AT_TEACHER`, `AT_DEANERY`) — одна незавершённая заявка на экзамен; нарушение → 409 `ACTIVE_REQUEST_EXISTS`.
  - Индексы: (`teacher_id`, `status`), (`faculty_id`, `status`), (`student_id`, `created_at`), (`status`, `teacher_deadline_at`), (`status`, `exam_starts_at`).
- 🟢 `teacher_decision` — `request_id` (PK, FK), `decision` (`AGREED` | `REJECTED`), `slot_id`, `room` (string | null), `slot_starts_at`, `slot_ends_at` (timestamptz | null), `comment` (string ≤ 1 000 | null), `decided_by`, `decided_by_name` (string), `decided_at` (timestamptz).
- 🟢 `deanery_decision` — часть 2: `request_id` (PK, FK), `decision` (`APPROVED` | `REJECTED`), `slot_id` (string | null), `comment` (string ≤ 1 000 | null), `decided_by`, `decided_by_name` (string), `decided_at` (timestamptz).
- 🟢 `request_status_history` — `id` (uuid), `request_id` (FK), `from_status` (enum | null), `to_status` (enum), `actor_role` (enum), `actor_id`, `actor_name` (string | null — `null` у `SYSTEM`), `comment` (string | null), `created_at` (timestamptz). Индекс (`request_id`, `created_at`). Только добавление.
- 🟢 `deadline_settings` — одна строка: `submission_lead_days` (integer 1–14, по умолчанию 3), `teacher_response_working_days` (integer 1–10, по умолчанию 2), `updated_by`, `updated_by_name` (string | null), `updated_at` (timestamptz). Строка с умолчаниями создаётся миграцией части 1; до части 3 только читается.
- 🟢 `notification_outbox` — `id` (uuid), `request_id` (FK), `recipient_id`, `subject`, `body` (string), `channels` (массив enum), `dedup_key` (string, уникальный), `status` (`PENDING` | `SENT` | `FAILED`), `attempts` (integer), `next_attempt_at`, `created_at`, `sent_at` (timestamptz | null). Индекс (`status`, `next_attempt_at`).
- 🟢 Хранение без удаления: заявки и история — учебные документы; файлы — в `files-service`, бакет `exam-transfer-documents`.
- 🔵 Экзамен, слот, рабочие дни, файл — не храним, читаем (INT-12, INT-13, INT-15, INT-16/INT-17; источники — в карточках).
- 🟢 Хранение резерва в `schedule-service` — по решению команды «Расписание»; от неё требуются контракт INT-14 и идемпотентность по `externalRequestId`.
- Миграции `requests-service` по частям:
  - часть 1 — `transfer_request` (без столбцов частей 2 и 3), `teacher_decision`, `request_status_history`, `deadline_settings` со строкой умолчаний, `notification_outbox`;
  - часть 2 — `deanery_decision`; столбцы итогового слота, `reservation_id`, `decided_at` в `transfer_request` — в существующих строках пусто;
  - часть 3 — `teacher_deadline_at` (в существующих строках пусто, у `AT_TEACHER` досчитывает фоновая задача, §3.1 п. 4) и `escalated` (по умолчанию `false`).
  - Точный DDL финализирует `requests-service`.

### 3.3. Авторизация/доступ на бэке
- 🔵 Портал передаёт токен SSO пользователя; `requests-service` проверяет подпись по ключам SSO; в токене `sub` — идентификатор персоны, совпадающий со `studentId` / `teacherId` в `schedule-service`, `roles`, `name`, у сотрудника деканата — `facultyId` (со слов; валидировать при интеграции).
- 🟢 Проверки `requests-service`:
  - `STUDENT` — только свои заявки (`student_id` = `sub`);
  - `TEACHER` — заявки, где `teacher_id` = `sub`, кроме `DRAFT`;
  - `DEANERY_OFFICER` — заявки, где `faculty_id` = `facultyId` токена, кроме `DRAFT`;
  - `ACADEMIC_ADMIN` — только INT-11;
  - пользователь с несколькими ролями получает права каждой; `view` в INT-5 выбирает, какой.
- Негативные случаи: студент — чужая заявка → 403; преподаватель Б — заявка по экзамену преподавателя А → 403; деканат другого факультета → 403; `TEACHER` вызывает INT-9 → 403; не `ACADEMIC_ADMIN` вызывает INT-11 → 403.
- 🟢 `schedule-service` в INT-14 пускает только сервисный аккаунт `requests-service`.
- 🔵 Межсервисные вызовы — сервисным токеном SSO (client credentials) аккаунта `requests-service` (со слов; валидировать при интеграции).

## 4. Frontend — ответственность

### 4.1. Где и что меняется в UI
Все экраны — в `student-portal`, пункты меню по ролям из токена; при выключенном флаге не показываются.
- 🔵 «Мои экзамены» — существующий экран студента со списком экзаменов (со слов; валидировать при интеграции):
  - 🟢 кнопка «Перенести экзамен» у экзамена, если крайний срок подачи не прошёл и по экзамену нет незавершённой заявки (INT-5 `view=student`); иначе ссылка «Заявка на перенос» на существующую.
- 🟢 «Заявка на перенос» — форма черновика: причина (список из четырёх), пояснение, загрузка документа (INT-3), подсказка «Подать можно до {submissionDeadlineAt}», кнопки «Сохранить черновик» (INT-1 / INT-2) и «Подать заявку» (INT-4).
- 🟢 «Мои заявки» — список студента (INT-5 `view=student`).
- 🟢 «Карточка заявки» — общая для всех ролей (INT-6): шкала этапов «подана → у преподавателя → в деканате → решение» с отметкой текущего; экзамен, причина, документ (ссылка на скачивание); решения преподавателя и деканата; история; кнопки — только из `allowedActions`:
  - `WITHDRAW` → «Отозвать заявку» с подтверждением (INT-10);
  - `TEACHER_AGREE` → выбор слота (INT-7) и «Согласовать» (INT-8);
  - `TEACHER_REJECT` → «Отклонить» с обязательным комментарием (INT-8);
  - `DEANERY_APPROVE` → слот преподавателя выбран заранее, «Выбрать другой слот» (INT-7), «Утвердить» (INT-9); после эскалации слот выбирается обязательно;
  - `DEANERY_REJECT` → «Отклонить» с обязательным комментарием (INT-9).
- 🟢 «Заявки на перенос» — список преподавателя (INT-5 `view=teacher`), с пометкой срока ответа (часть 3).
- 🟢 «Заявки на перенос — деканат» — список сотрудника деканата (INT-5 `view=deanery`), с пометкой «передана автоматически» у `escalated = true`.
- 🟢 «Сроки переноса экзаменов» — экран администратора учебного отдела (INT-11), часть 3.
- Подписи статусов: `DRAFT` «Черновик», `SUBMITTED` «Подана», `AT_TEACHER` «У преподавателя», `AT_DEANERY` «В деканате», `APPROVED` «Утверждена», `REJECTED` «Отклонена», `WITHDRAWN` «Отозвана», `EXPIRED` «Просрочена»; в истории `actorRole = SYSTEM` — «автоматически».

### 4.2. Пользовательские сценарии
- **Студент создаёт и подаёт заявку** (FR-1, FR-2, FR-3, FR-7): «Мои экзамены» → «Перенести экзамен» → причина, пояснение → «Сохранить черновик» → документ → «Подать заявку» → карточка «У преподавателя», уведомление «подана». Ветки: срок прошёл → `action_error_deadline`; нет документа → `action_error_document_required`; файл больше 10 МБ → `doc_error_too_large`; по экзамену уже есть заявка → `action_error_active_exists`.
- **Преподаватель согласует или отклоняет** (FR-4, FR-5): «Заявки на перенос» → карточка → документ → выбор слота → «Согласовать» → «В деканате»; или «Отклонить» с комментарием. Ветки: слот заняли → `action_error_slot_taken`, список слотов обновляется; свободных слотов нет → `slots_empty` с подсказкой добавить слот в расписании; заявка уже у деканата по сроку → `action_error_stale`.
- **Студент отзывает** (FR-6): карточка → «Отозвать заявку» → подтверждение → «Отозвана». Решение уже принято → `action_error_already_decided`.
- **Деканат утверждает или отклоняет** (FR-11, FR-12, FR-13): «Заявки на перенос — деканат» → карточка → проверка документа → слот преподавателя или другой → «Утвердить» → «Утверждена», в «Мои экзамены» студента — новая дата. Ветки: слот занят → `action_error_slot_taken`, выбор другого слота; расписание недоступно → `action_error_source`, повтор с тем же слотом.
- **Эскалация и просрочка** (FR-14, FR-15): без действий пользователя; студент видит новый статус и получает уведомление, деканат видит заявку с пометкой «передана автоматически».
- **Администратор меняет сроки** (FR-16): «Сроки переноса экзаменов» → значения → «Сохранить» → подтверждение «Новые сроки действуют для заявок, поданных после сохранения».
- **Нет прав** (FR-8): прямая ссылка на чужую заявку → `error_forbidden`.

### 4.3. Состояния (именованные — обязательно, если есть FE)
| Имя состояния | Условие | Что видит пользователь |
|---------------|---------|------------------------|
| `list_loading` | INT-5 выполняется | скелетон списка |
| `list_value` | 200, `items` не пуст | список заявок |
| `list_empty` | 200, `items: []` | «Заявок нет» (студент), «Нет заявок, ожидающих вашего решения» (преподаватель, деканат) |
| `list_error_source` | INT-5: 5xx / таймаут / сеть | «Не удалось загрузить заявки» + «Повторить» |
| `card_loading` | INT-6 выполняется | скелетон карточки |
| `card_value` | 200 | карточка, кнопки по `allowedActions` |
| `card_not_found` | 404 `REQUEST_NOT_FOUND` | «Заявка не найдена» |
| `card_error_source` | INT-6: 5xx / таймаут / сеть | «Не удалось загрузить заявку» + «Повторить» |
| `doc_none` | `document: null` | «Документ не приложен» + кнопка загрузки (у черновика) |
| `doc_uploading` | INT-3 выполняется | прогресс загрузки |
| `doc_attached` | `document` есть, `downloadUrl` не `null` | имя файла, размер, ссылка «Скачать» |
| `doc_link_unavailable` | `document` есть, `downloadUrl: null` | имя файла, «Документ временно недоступен для скачивания» |
| `doc_error_too_large` | 413 `FILE_TOO_LARGE` | «Файл слишком большой: не более 10 МБ» |
| `doc_error_type` | 415 `UNSUPPORTED_FILE_TYPE` | «Допустимы PDF, JPG, PNG» |
| `slots_loading` | INT-7 выполняется | спиннер в выборе слота |
| `slots_value` | 200, `items` не пуст | слоты: дата, время, аудитория, свободных мест |
| `slots_empty` | 200, `items: []` | «Свободных слотов нет — добавьте слот в расписании»; «Согласовать» / «Утвердить» неактивны |
| `slots_error_source` | INT-7: 503 / сеть | «Не удалось загрузить слоты» + «Повторить» |
| `action_pending` | INT-1, INT-2, INT-4, INT-8, INT-9, INT-10 выполняются | кнопки неактивны, спиннер на нажатой |
| `action_error_deadline` | 422 `SUBMISSION_DEADLINE_PASSED` | «Срок подачи прошёл {submissionDeadlineAt}» |
| `action_error_document_required` | 422 `DOCUMENT_REQUIRED` | «Приложите документ-подтверждение» |
| `action_error_active_exists` | 409 `ACTIVE_REQUEST_EXISTS` | «По этому экзамену уже есть заявка» + ссылка на неё |
| `action_error_slot_taken` | 409 `SLOT_TAKEN` | «Слот уже занят, выберите другой»; слоты перезапрашиваются |
| `action_error_stale` | 409 `INVALID_STATUS` | «Заявка изменилась»; карточка перезапрашивается |
| `action_error_already_decided` | 409 `REQUEST_ALREADY_DECIDED` | «Заявка уже решена»; карточка перезапрашивается |
| `action_error_source` | 500, 503, 404 `EXAM_NOT_FOUND`, таймаут, сеть | текст ошибки + «Повторить»; введённые данные и выбранный слот сохраняются |
| `settings_loading` | GET INT-11 выполняется | скелетон формы |
| `settings_value` | 200 | текущие значения, кто и когда менял |
| `settings_saving` | PUT INT-11 выполняется | «Сохранить» неактивна, спиннер |
| `settings_error_validation` | 400 `VALIDATION_ERROR` | подсветка поля: «от 1 до 14» / «от 1 до 10» |
| `settings_error_source` | INT-11: 5xx / сеть | «Не удалось сохранить» + «Повторить» |
| `error_forbidden` | 403 `FORBIDDEN` | «Нет прав» |
| `feature_disabled` | 404 `FEATURE_DISABLED` | экраны и пункты меню скрыты; по прямой ссылке — «Раздел недоступен» |

`zero` не применимо: числовых значений, где 0 отличается от «нет данных», нет — пустые списки покрыты `list_empty` и `slots_empty`.

### 4.3.1. Loading и таймауты (обязательно, если есть FE)
- **Чтение** (INT-5, INT-6, INT-7, GET INT-11): cold-path 15 с (первый запрос после входа в раздел), warm-path 8 с.
- **Действия** (INT-1, INT-2, INT-4, INT-8, INT-9, INT-10, PUT INT-11): cold-path 20 с (первое действие в сессии), warm-path 15 с; INT-9 ждёт `schedule-service` до 5 с.
- **Загрузка документа** (INT-3): cold-path 60 с, warm-path 45 с.
- **Polling:** нет — статус обновляется при открытии или обновлении экрана; о смене статуса сообщают уведомления.
- Таймаут, 5xx, сеть → состояния `*_error_source` из §4.3; повтор действия после таймаута безопасен — переходы условные, резерв идемпотентен.

### 4.4. Доступ по ролям в UI
- `STUDENT` — «Мои экзамены» (кнопка «Перенести экзамен»), «Мои заявки», свои карточки.
- `TEACHER` — «Заявки на перенос», карточки заявок по своим экзаменам.
- `DEANERY_OFFICER` — «Заявки на перенос — деканат», карточки заявок своего факультета.
- `ACADEMIC_ADMIN` — «Сроки переноса экзаменов».
- Кнопки действий в карточке — только по `allowedActions`; роли на фронте для кнопок не сравниваются.

## 5. Нефункциональные требования

### 5.1. Синхронность, кэш, производительность
- Пользовательские операции INT-1 – INT-11 — синхронные.
- Уведомления — асинхронно через очередь `notification_outbox`, отправитель каждые 30 с.
- Эскалация, просрочка, повтор передачи преподавателю — фоновая задача раз в 10 минут; точность срока эскалации — до 10 минут.
- Кэш в `requests-service`: настройки сроков — 60 с; календарь INT-15 — по месяцу на 24 ч; слоты (INT-13) и экзамены (INT-12) не кэшируются.
- Таймауты к зависимостям: `schedule-service` — 5 с; `files-service` — загрузка 30 с, ссылка 3 с; `notifications` — 5 с.
- Нагрузка: около 1 500 заявок за сессию, в пике до 200 подач в день; чтений — до 5 000 в день; документы до 10 МБ, около 15 ГБ в год.
- Целевое время ответа p95: чтение ≤ 500 мс, действия ≤ 1 с, утверждение (INT-9) ≤ 3 с.

### 5.2. Надёжность/деградация
- `schedule-service` недоступен:
  - INT-1, INT-4 → 503, черновик не меняется;
  - INT-7, INT-8 → 503, заявка остаётся `AT_TEACHER`;
  - INT-9 → 503, заявка остаётся `AT_DEANERY`, у нас ничего не записано; повтор безопасен — INT-14 идемпотентен по `externalRequestId`;
  - INT-15 (часть 3) → заявка остаётся `SUBMITTED` (подача записана), передачу преподавателю повторяет фоновая задача.
- Резерв в `schedule-service` создан, а наша транзакция не зафиксировалась (сбой после ответа INT-14) → заявка остаётся `AT_DEANERY`; повторное утверждение получает 200 (тот же слот) или `ALREADY_RESERVED` (другой слот) и утверждает на фактический резерв.
- `files-service` недоступен → INT-3 503, черновик без изменений; в карточке `downloadUrl: null`, прочие данные отдаются.
- `notifications` недоступен → переходы статусов не блокируются; уведомление ждёт в очереди и уходит после восстановления; `dedupKey` исключает дубль.
- БД `requests-service` недоступна → 500 на все ручки; фоновая задача пропускает запуск и догоняет на следующем.
- Падение экземпляра во время фоновой задачи → незавершённая транзакция откатывается, строки подхватывает следующий запуск.

### 5.3. Безопасность/доступ (сводно)
| Действие | `STUDENT` | `TEACHER` | `DEANERY_OFFICER` | `ACADEMIC_ADMIN` |
|----------|-----------|-----------|-------------------|------------------|
| INT-1, INT-2, INT-3, INT-4 — черновик и подача | свои | 403 | 403 | 403 |
| INT-5 — список | `view=student`, свои | `view=teacher`, по своим экзаменам | `view=deanery`, свой факультет | 403 |
| INT-6 — карточка | свои, любой статус | по своим экзаменам, кроме `DRAFT` | свой факультет, кроме `DRAFT` | 403 |
| INT-7 — слоты | 403 | свой экзамен, `AT_TEACHER` | свой факультет, `AT_DEANERY` | 403 |
| INT-8 — решение преподавателя | 403 | свой экзамен | 403 | 403 |
| INT-9 — решение деканата | 403 | 403 | свой факультет | 403 |
| INT-10 — отзыв | свои | 403 | 403 | 403 |
| INT-11 — сроки | 403 | 403 | 403 | да |
| INT-14 — резерв слота | — | — | — | — (только сервисный аккаунт `requests-service`) |

## 6. Релиз и интеграция

### 6.1. Порядок выката
В каждой части: `requests-service` (вместе с миграциями части) → `schedule-service` → `student-portal`.
- **Часть 1:** `requests-service` → `student-portal`; `schedule-service` не меняется. Флаг `exam-transfer-requests` включается после деплоя портала.
- **Часть 2:** `requests-service` → `schedule-service` с INT-14 → `student-portal` с экранами деканата. Портал последним: экраны, вызывающие INT-9, появляются, когда INT-14 уже в проде.
- **Часть 3:** `requests-service` (фоновая эскалация, просрочка, INT-11) → `student-portal` (экран сроков, сроки в списках); `schedule-service` не меняется.

### 6.2. Обратная совместимость
- `schedule-service`: INT-14 — новый метод, прежние методы и их потребители не меняются. После резерва INT-12 для студента отдаёт новую дату и аудиторию экзамена — так и задумано: «Мои экзамены» и другие потребители видят перенесённый экзамен.
- `requests-service`: части только добавляют поля (`deaneryDecision` в части 2; `teacherDeadlineAt`, `escalated` в части 3) и ручки; портал предыдущей части новые поля игнорирует.
- Заявки `AT_TEACHER`, пришедшие преподавателю до выпуска части 3, получают срок ответа от момента выпуска (§3.1) — массовой эскалации в день выпуска нет.
- `student-portal`: новые экраны за флагом, существующие экраны не меняются, кроме кнопки «Перенести экзамен» в «Мои экзамены».

### 6.3. Фиче-флаги
- `exam-transfer-requests` — `boolean`, по умолчанию выключен.
- Где проверяется: `student-portal` — пункты меню, экраны, кнопка «Перенести экзамен»; `requests-service` — все пользовательские ручки (404 `FEATURE_DISABLED`), фоновая задача и отправитель очереди не запускаются.
- 🔵 Флаги порталов и сервисов университета ведутся в общем сервисе конфигурации и переключаются без перезапуска (со слов; валидировать при интеграции).
- Кто переключает: команда «Портал» по решению учебного управления; включение — после выката части 1, дальше флаг остаётся включённым.

### 6.4. План отката (обязательно, если задача деплоится — иначе «не применимо: причина»)
Основной откат — выключить `exam-transfer-requests`: экраны пропадают, новые заявки не принимаются, незавершённые заявки замирают в своих статусах, деканат на это время работает по бумаге; после включения фоновая задача догоняет эскалации и просрочки.
- **Откат только BE** (`requests-service` на версию предыдущей части, FE новее): экраны новой части получают 404 на свои ручки → откатывать портал синхронно или выключать флаг. Откат `schedule-service` (часть 2): INT-14 пропадает → INT-9 отвечает 503, деканат не может утвердить → откатить портал к версии части 1 или выключить флаг.
- **Откат только FE** (`student-portal` на предыдущую версию): экраны новой части скрываются; `requests-service` работает дальше, фоновая задача продолжает эскалации и просрочки — допустимо.
- **Откат DDL** (down-миграция): не планируется — миграции каждой части только добавляют таблицы и столбцы, предыдущая версия их не читает; данные заявок между выкатом и откатом сохраняются.

### 6.5. Преднастройка до релиза (чек-лист — каждый пункт: заполни или «не применимо: причина»)
- [ ] Роли в security-сервисе — в SSO: 🔵 `STUDENT`, `TEACHER` уже есть (со слов); завести и выдать `DEANERY_OFFICER` с атрибутом `facultyId` (к части 2) и `ACADEMIC_ADMIN` (к части 3).
- [ ] DDL-миграция в репо владеющего сервиса — миграции `requests-service` по частям (§3.2); хранение резерва INT-14 — в репо `schedule-service`, по решению команды «Расписание» (к части 2).
- [ ] Конфиги по окружениям (dev/staging/prod) — адреса `schedule-service`, `files-service`, `notifications`, ключи проверки токенов SSO; бакет `exam-transfer-documents` в `files-service` заведён командой «Платформа» (к части 1); лимит тела запроса на входе портала и `requests-service` — не меньше 11 МБ; интервалы фоновой задачи (10 мин) и очереди (30 с); часовой пояс Europe/Moscow.
- [ ] Сервисные аккаунты для межсервисных вызовов — аккаунт `requests-service` в SSO с доступом к `schedule-service` (INT-12, INT-13, INT-15; INT-14 — к части 2), к бакету `exam-transfer-documents` и к `notifications`.
- [ ] Фиче-флаги заведены — `exam-transfer-requests` во всех окружениях, выключен.

## 7. Трассировка приёмки
| FR из БТ | Взаимодействие(я) | Тест-кейс (Дано–Когда–Тогда) |
|----------|-------------------|------------------------------|
| FR-1 | INT-1, INT-2, INT-12 | Дано студент записан на `ex-77120` (20.11), когда `POST /transfer-requests` с `ILLNESS`, тогда 201, `DRAFT`, снимок экзамена; `PATCH` меняет причину — 200. Дано `OTHER` без `reasonComment` — 400. Дано по `ex-77120` есть заявка `AT_TEACHER` — 409 `ACTIVE_REQUEST_EXISTS`. Дано экзамена нет у студента — 404 `EXAM_NOT_FOUND` |
| FR-2 | INT-3, INT-16 | Дано `DRAFT`, когда загружается PDF 10 485 760 байт, тогда 200, `document` заполнен; 10 485 761 байт — 413 `FILE_TOO_LARGE`, INT-16 не вызывается; DOCX — 415. Дано повторная загрузка — в заявке новый `fileId` |
| FR-3 | INT-4, INT-12, INT-18 | Дано экзамен 20.11 10:00 МСК, документ есть, когда подача 17.11 23:59:59 МСК, тогда 200, история `DRAFT → SUBMITTED → AT_TEACHER`, в очереди уведомления студенту и преподавателю; подача 18.11 00:00:00 — 422 `SUBMISSION_DEADLINE_PASSED`. Дано документа нет — 422 `DOCUMENT_REQUIRED`. Дано `schedule-service` недоступен — 503, статус `DRAFT` |
| FR-4 | INT-5, INT-6, INT-7, INT-8, INT-13, INT-17 | Дано заявка `AT_TEACHER` по экзамену преподавателя `t-1093`, когда он видит её в `view=teacher`, открывает документ по `downloadUrl`, получает слоты и отправляет `AGREED` со `sl-55021`, тогда 200, `AT_DEANERY`, `teacherDecision.slot` = `sl-55021`. Дано `sl-55021` пропал из свободных — 409 `SLOT_TAKEN`, статус `AT_TEACHER` |
| FR-5 | INT-8 | Дано `AT_TEACHER`, когда `REJECTED` с комментарием, тогда 200, `REJECTED`; без комментария — 400 |
| FR-6 | INT-10 | Дано `AT_DEANERY`, когда студент вызывает `withdraw`, тогда 200, `WITHDRAWN`, заявки нет в `view=deanery`. Дано `APPROVED` — 409 `REQUEST_ALREADY_DECIDED`. Дано одновременно идёт утверждение — отзыв ждёт блокировку и получает 409 `REQUEST_ALREADY_DECIDED` |
| FR-7 | INT-18 | Дано переходы `DRAFT → SUBMITTED`, `AT_TEACHER → AT_DEANERY` (`AGREED`), `AT_TEACHER → REJECTED`, тогда студенту уходят три уведомления с темами из §3.1 по каналам `EMAIL` и `PORTAL`; при недоступном `notifications` уходят после восстановления, без дублей |
| FR-8 | INT-1 – INT-11 | Дано преподаватель `t-2001` открывает заявку по экзамену `t-1093` — 403. Дано сотрудник деканата `fac-econ` вызывает INT-9 по заявке `fac-it` — 403. Дано студент открывает чужую заявку — 403. Дано `TEACHER` вызывает INT-11 — 403 |
| FR-9 | INT-8, INT-9, INT-10 | Дано заявка `REJECTED` преподавателем, когда деканат вызывает INT-9, тогда 409 `REQUEST_ALREADY_DECIDED`. Дано `EXPIRED`, когда преподаватель вызывает INT-8, — 409 `REQUEST_ALREADY_DECIDED` |
| FR-10 | INT-6 | Дано заявка прошла `DRAFT → SUBMITTED → AT_TEACHER → AT_DEANERY → APPROVED`, когда студент открывает карточку, тогда `history` содержит 5 записей по возрастанию `at`; переход `SUBMITTED → AT_TEACHER` — `actorRole: SYSTEM`, на экране «автоматически» |
| FR-11 | INT-5, INT-6, INT-7, INT-9, INT-14 | Дано `AT_DEANERY` со слотом преподавателя `sl-55021`, когда сотрудник `fac-it` отправляет `APPROVED`, тогда INT-14 → 201, заявка `APPROVED`, INT-12 для студента отдаёт `ex-77120` на 27.11 10:00, ауд. 305. Дано INT-14 → 409 `SLOT_TAKEN` — 409 `SLOT_TAKEN`, статус `AT_DEANERY`; повтор с `sl-55034` (28.11 14:00) — `APPROVED`. Дано INT-14 таймаут — 503, повтор с `sl-55021` → INT-14 200, `APPROVED` |
| FR-12 | INT-9 | Дано `AT_DEANERY`, когда `REJECTED` с комментарием, тогда 200, `REJECTED`, INT-14 не вызывается; без комментария — 400 |
| FR-13 | INT-18 | Дано `APPROVED` на 27.11 10:00, ауд. 305, тогда студенту уходит уведомление с датой, временем и аудиторией. Дано `REJECTED` деканатом — уведомление с комментарием |
| FR-14 | INT-15, INT-18, фоновая задача §3.1 | Дано заявка пришла преподавателю в пн 16.11 10:00 МСК, срок 2 рабочих дня, когда запуск задачи в ср 18.11 10:00–10:10, тогда `AT_DEANERY`, `escalated = true`, история с `SYSTEM`, уведомление студенту. Дано пришла в пт 20.11 18:00 — `teacherDeadlineAt` = вт 24.11 18:00. Дано INT-15 недоступен при передаче — `SUBMITTED`, передача на следующем запуске |
| FR-15 | фоновая задача §3.1, INT-18 | Дано `AT_TEACHER`, `exam.startsAt` = 20.11 10:00 МСК, когда запуск в 10:00–10:10, тогда `EXPIRED`, уведомление студенту. Дано `DRAFT` по экзамену 20.11 при сроке 3 дня, когда запуск после 18.11 00:00, тогда `EXPIRED` |
| FR-16 | INT-11 | Дано `ACADEMIC_ADMIN` сохраняет `submissionLeadDays: 5`, когда студент подаёт заявку по экзамену 20.11 в 16.11, тогда 422; 15.11 23:59:59 — 200. Дано `teacherResponseWorkingDays: 3` — заявки, пришедшие преподавателю до сохранения, сохраняют прежний `teacherDeadlineAt`. Дано `submissionLeadDays: 0` — 400 |

## 8. Допущения и открытые вопросы
- **🔵 Подтверждено аналитиком:**
  - `GET /api/v2/students/{studentId}/exams` и его поля, `GET /api/v2/calendar/working-days` и его поля (по карточке services/schedule-service.md);
  - `GET /api/v2/teachers/{teacherId}/slots?status=FREE` и его поля (по коду schedule-service, ветка master);
  - `POST /api/v1/buckets/{bucket}/files`, `GET /api/v1/files/{fileId}/download-link`, доступ к бакету сервисным токеном (по карточке services/files-service.md);
  - `POST /api/v1/notifications` с `dedupKey` (по коду notifications, ветка main);
  - токен SSO с `sub`, `roles`, `name`, `facultyId`; совпадение `sub` со `studentId` / `teacherId`; сервисный аккаунт с client credentials; роли `STUDENT`, `TEACHER` уже есть; экран «Мои экзамены»; флаги в общем сервисе конфигурации (со слов).
  Все — валидировать при интеграции.
- **🟡 К валидации:** нет.
- **❓ Открытые решения:** нет.
- **⚠️ Требует уточнения:** нет.
- **Технические риски:**
  - дата экзамена в заявке — снимок на момент подачи; перенос экзамена в расписании после подачи заявку не меняет → снимок обновляется при подаче, преподаватель и деканат видят дату заявки рядом с актуальным расписанием студента;
  - строка заявки заблокирована на время вызова INT-14 (до 5 с) → таймаут вызова ограничен 5 с, отзыв и фоновая задача ждут блокировку, а не падают;
  - при замене документа прежний файл остаётся в бакете без ссылки → объём мал (до 10 МБ на замену), удаление файлов вне объёма задачи;
  - уведомление может уйти позже смены статуса при сбое `notifications` → очередь с повторами, статус в портале виден сразу.
- **Унаследовано из БТ (бизнес-пробелы):** Унаследованных бизнес-пробелов нет.
- **Приложения из БТ:** Пожелание по UX — шкала этапов заявки «подана → у преподавателя → в деканате → решение» с отметкой текущего этапа; учтено в §4.1 («Карточка заявки»).
