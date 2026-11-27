# sky — backend

## Бизнес-правила

### `Telescope` — телескоп
- наведён (`POINTED`) — оператором
- на парковке (`PARKED`) — по окончании ночи

## Публичный контракт

### `POST /api/observations/{id}/start`
сущности: ← `id` · → `Observation`
меняет: `Night.phase` `new` → `full`
меняет: `Shift.closedAt` → сейчас
меняет: `Observation.assignee` → текущий оператор
меняет: `Observation.payload` → новый
меняет: `DomeEntity.Status` `Open` → `Closed`
меняет: `TelescopeEntity.state` `PARKED` → `POINTED`
меняет: `Camera.cooling` → «истина» — охлаждение до старта; `Camera.mode` → съёмка
меняет: `Filter.band` → из запроса
меняет: покрытие `primaryMirror.coating` → обновлено
- начинает наблюдение

## Владеет данными

### `Night`
- `phase`: `new` \| `quarter` \| `full`

### `Shift`
- `closedAt`: `Timestamp`

### `Observation`
- `assignee`: `Operator`
- `payload`: `Optional<JsonNode>`

### `Operator`
- `name`: `String`

### `DomeEntity`
- `Status`: `DomeStatus` — `Open` | `Closed`

### `TelescopeEntity`
- `state`: `TelescopeState` — `PARKED` | `POINTED`

### `Camera`
- `mode`: `CameraMode`
- `cooling`: `Boolean`

### `Filter`
- `band`: `String|null`

### `Mirror`
- `coating`: `CoatingState`
