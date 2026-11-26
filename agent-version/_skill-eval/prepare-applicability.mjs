// Изолированные входы и снимки; модель запускается встроенным независимым агентом.
import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const name = process.argv[2]
if (!/^2026-10-06-applicability-r[1-9]\d*$/.test(name ?? '')) throw new Error('Укажите новый раунд')
const round = join(import.meta.dirname, 'runs', name)
if (existsSync(round)) throw new Error('Раунд уже существует; снимки не перезаписываются')
const snap = join(round, '_skills')
mkdirSync(snap, { recursive: true })
for (const s of ['technical-spec-doc', 'spec-review', 'analyst-workspace']) cpSync(join(root, 'agent-version', s), join(snap, s), { recursive: true })
writeFileSync(join(round, 'DIFF.patch'), execFileSync('git', ['diff'], { cwd: root, encoding: 'utf8' }))
const hash = t => createHash('sha256').update(t).digest('hex')
function files (dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(join(dir, e.name), base) : [{ path: relative(base, join(dir, e.name)).replaceAll('\\', '/'), sha256: hash(readFileSync(join(dir, e.name))) }])
}
const settings = { model: 'gpt-6-luna', reasoning_effort: 'max', fork_turns: 'none', repeats: 1,
  stop: 'full green on final snapshot OR 3 confirmed current-change defects for one probe',
  attribution: 'requires a comparable baseline; observed rule failures alone do not count',
  exclude: ['fixture error', 'grader error', 'runner failure', 'un-attributed historical failure'], commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }
writeFileSync(join(round, 'SETTINGS.json'), JSON.stringify(settings, null, 2) + '\n')
writeFileSync(join(round, 'SNAPSHOT.json'), JSON.stringify(files(snap), null, 2) + '\n')
const specSkill = join(snap, 'technical-spec-doc/SKILL.md')
const manifest = []
function add (id, inputs, prompt, extra = {}) {
  const work = join(round, id, 'run-01')
  mkdirSync(work, { recursive: true })
  for (const [p, t] of Object.entries(inputs)) { mkdirSync(join(work, p, '..'), { recursive: true }); writeFileSync(join(work, p), t) }
  writeFileSync(join(work, 'prompt.txt'), prompt)
  writeFileSync(join(work, 'INPUT-HASHES.json'), JSON.stringify(files(work), null, 2) + '\n')
  manifest.push({ id, work, skill: specSkill, ...extra })
}
const baseSource = `# Запрос на правку: текст кнопки
> **Задача:** UA-410
> **Статус готовности:** Готово к оценке
## 1. Затронутый бизнес-процесс
Отправка заявки на согласование в portal-web.
## 2. Что тронуто
| Предмет | Тронуто | Как сейчас → как должно стать |
|---|---|---|
| Контракт | нет | — |
| Данные | нет | — |
| Интерфейс | да | «Сохранить» → «Отправить на согласование» |
| Зависимость | нет | — |
| Конфигурация | нет | — |
Вердикт: мелкая правка; одна поставка.
## 3. Как сейчас
Кнопка «Сохранить» уже отправляет заявку на согласование.
## 4. Как должно стать
- FR-1: назвать кнопку «Отправить на согласование». 🔵 Решение аналитика Иванова.
## 5. Как проверят, что сделано
FR-1: открыть список — новый текст; нажать — заявка отправлена как прежде.
## 6. Что рядом остаётся прежним
Отправка, права и их проверка, автосохранение, переход после отправки, все состояния и их
отображение, загрузка, таймауты и polling остаются прежними. Ошибки и их обработка неизменны.
Подтверждённое поведение при сбоях: при отказе отправки показывается прежнее сообщение
«Не удалось отправить», заявка остаётся черновиком, повторная попытка доступна вручную;
после успеха — прежний переход. Это поведение правка не меняет.
## 7. Критичность и срочность
Общий релиз: независимо выкатывается только FE portal-web, BE/DDL не деплоятся.
Откат — предыдущий FE-бандл. Флаги задачей не используются; подготовки до релиза нет.
## Открытые вопросы
Унаследованных бизнес-пробелов нет.
## Приложения
Приложений нет.
`
const answers = `Это ПРОДОЛЖЕНИЕ интервью: вопросы по тех-гейтам уже заданы, аналитик отвечает.
Все перечисленные сведения подтверждаю своими словами. Ключ UA-410 подтверждаю.
FE portal-web, владелец команда портала. Бэкенд и взаимодействия на границах не меняются,
данные/поля прежние; миграции, пересчёт и исправление старых записей не нужны.
Синхронность, кэш/TTL, опрос/обновление, таймауты и нагрузка неизменны.
Остальные решения — явно подтверждённое содержание документа-источника.
`
const sourcePath = 'coddoc/UA-410/change_request.md'
const specPath = 'coddoc/UA-410/technical_specification.md'
const request = `Явный флаг от analyst-workspace: мелкая правка. Документ сверху: ${sourcePath}.\n${answers}`
add('ua-label', { [sourcePath]: baseSource }, request, { target: specPath, kind: 'write' })
const timeout = baseSource.replace('текст кнопки', 'таймаут отправки')
  .replace('«Сохранить» → «Отправить на согласование»', 'таймаут ожидания отправки в FE: 3 → 10 секунд')
  .replace('| Конфигурация | нет | — |', '| Конфигурация | да | таймаут ожидания отправки 3 → 10 секунд |')
  .replace('Кнопка «Сохранить» уже отправляет заявку на согласование.', 'Список заявок ожидает отправку 3 секунды.')
  .replace('назвать кнопку «Отправить на согласование»', 'ожидать ответ отправки 10 секунд вместо 3')
  .replace('открыть список — новый текст; нажать — заявка отправлена как прежде.', 'отправить заявку: ответ на 7-й секунде принимается успешно; по истечении 10 секунд показывается прежняя ошибка.')
  .replace('загрузка, таймауты и polling остаются прежними', 'загрузка и polling прежние; только таймаут первого и последующих вызовов отправки повышается до 10 секунд')
add('ua-timeout', { [sourcePath]: timeout }, request.replace('таймауты и нагрузка неизменны', 'нагрузка неизменна; таймаут в FE повышается по запросу'), { target: specPath, kind: 'write' })
const damaged = `# Баг-репорт: двойные суммы
> **Задача:** UA-410
> **Статус готовности:** Готово к оценке
## Затронутый бизнес-процесс
Расчёт суммы заявки billing-service; BE-only, владелец — команда биллинга.
## Шаги воспроизведения
Запустить пересчёт суммы существующей заявки дважды.
## Фактический результат
Второй запуск удваивает сумму.
## Ожидаемый результат
- FR-1: повторный пересчёт не меняет итоговую сумму.
## Критичность и срочность
Общий релиз только billing-service, независимый деплой; откат предыдущей версии BE.
## Подтверждённые границы
Контракт/использование на границе, схема/поля, роли, доступ, ошибки, нагрузка, кэш, таймауты
прежние. При сбое пересчёта прежняя сумма остаётся записанной, ошибка логируется, повтора нет.
Флагов нет. Миграции не нужны. Испорченные суммы уже есть; пересчитать заявки со статусом
approved, созданные с 1 по 5 октября 2026. Пересчёт обязателен после выката, повторяем безопасно.
## Открытые вопросы
Унаследованных бизнес-пробелов нет.
## Приложения
Приложений нет.
`
add('ua-damaged', { 'coddoc/UA-410/bug_report.md': damaged }, `Явный флаг багфикса от analyst-workspace.
Документ сверху coddoc/UA-410/bug_report.md. Это ПРОДОЛЖЕНИЕ: на заданные вопросы подтверждаю
все границы из репорта. Данные испорчены: нужен именно указанный пересчёт старых заявок.
Схему не меняем. Откат кода не отменяет уже исправленные суммы; это допустимо. Ключ UA-410.
`, { target: specPath, kind: 'write' })
const feature = `# Бизнес-требования: справка
> **Задача:** UA-410
> **Статус готовности:** Готово к оценке
## Контекст
Новый функционал: сотрудники открывают статическую справку о согласовании в portal-web.
Цель — ответ без поддержки; заказчик — руководитель операций.
## Функциональные требования
- FR-1: новая кнопка открывает локальный диалог с текстом «Заявку рассматривает руководитель».
- FR-2: закрыть диалог кнопкой «Закрыть», Escape или по фону; фокус вернуть на кнопку открытия.
## Критерии приёмки
FR-1: нажать новую кнопку — виден дословный текст; FR-2: каждое действие закрывает диалог.
## Границы
Только FE; соседние сервисы/контракты, данные, права и проверка доступа прежние.
Локальное открытие/закрытие синхронно; сети, ожидания, polling, таймаутов и записи данных нет.
Поведение при недоступности соседей: справка открывается локально и доступна как прежде.
## Релиз
Общий релиз только portal-web; откат предыдущим FE-бандлом, флаги и подготовка не нужны.
## Открытые вопросы
Унаследованных бизнес-пробелов нет.
## Приложения
Приложений нет.
`
add('ua-feature', { 'coddoc/UA-410/business_requirements.md': feature }, `Документ сверху coddoc/UA-410/business_requirements.md, обычный режим.
${answers} Вместо изменения текста делаем новый локальный диалог по БТ. Локальные состояния
и открытие/закрытие спроектируй по подтверждённому поведению; фокус и закрытие по БТ.
`, { target: specPath, kind: 'write' })
const state = baseSource.replace('текст кнопки', 'поведение существующего состояния')
  .replace('«Сохранить» → «Отправить на согласование»', 'при прежнем состоянии error_source добавляется доступная кнопка «Повторить»')
  .replace('назвать кнопку «Отправить на согласование»', 'в прежнем состоянии error_source показать кнопку «Повторить»')
  .replace('открыть список — новый текст; нажать — заявка отправлена как прежде.', 'вызвать ошибку отправки — видна кнопка «Повторить»; нажать — повторяется прежний вызов.')
  .replace('все состояния и их\nотображение, загрузка, таймауты и polling остаются прежними. Ошибки и их обработка неизменны.', 'набор состояний прежний, но в error_source меняется действие: новая кнопка ручного повтора. Загрузка, таймауты и polling прежние; обработка ошибки меняется только этой кнопкой.')
add('ua-state', { [sourcePath]: state }, request, { target: specPath, kind: 'write' })
const access = baseSource.replace('текст кнопки', 'проверка доступа')
  .replace('«Сохранить» → «Отправить на согласование»', 'кнопка отправки доступна роли author только для своей заявки')
  .replace('| Конфигурация | нет | — |', '| Конфигурация | да | прежняя роль author: проверять владельца заявки |')
  .replace('назвать кнопку «Отправить на согласование»', 'при прежней роли author разрешать кнопку только владельцу заявки')
  .replace('открыть список — новый текст; нажать — заявка отправлена как прежде.', 'author открывает чужую заявку — кнопка недоступна; свою — отправка доступна.')
  .replace('Отправка, права и их проверка,', 'Отправка; роли прежние, но UI проверяет владельца заявки; сервер уже отклоняет чужую отправку как прежде;')
add('ua-access', { [sourcePath]: access }, request, { target: specPath, kind: 'write' })
const unknown = baseSource.replace(/Подтверждённое поведение при сбоях:[\s\S]*?Это поведение правка не меняет\.\n/, '')
add('ua-reliability-q', { [sourcePath]: unknown }, request, { target: specPath, kind: 'write', expected: ['no extra question about untouched failure handling'] })
add('ua-reliability-deferred', { [sourcePath]: unknown }, request + '\nНа ранее заданный вопрос о сбое отправки отвечаю: не знаю; оставьте это открытым до уточнения у владельца.', { target: specPath, kind: 'write' })
const sourceUnknown = baseSource.replace('Унаследованных бизнес-пробелов нет.', 'Сведения о бизнес-пробелах не предоставлены.').replace('Приложений нет.', 'Сведения о приложениях не предоставлены.')
add('ua-source-q', { [sourcePath]: sourceUnknown }, request, { target: specPath, kind: 'question' })
// Seed для независимой приёмки: заголовки извлечены из неизменной формы шаблона.
const template = readFileSync(specSkill, 'utf8').replaceAll('\r\n', '\n').split('````markdown\n')[1].split('\n````')[0]
const headings = template.split('\n').filter(l => /^#{2,3} \d+\./.test(l) || l.startsWith('### Каталог ошибок'))
const body = {
  '1.1': '**Суть:** переименовать кнопку отправки заявки.\n**Тип:** мелкая правка\n**Стороны:** FE-only',
  '1.2': '| Сервис | Роль в задаче | Владелец/команда | Происхождение |\n|---|---|---|---|\n| portal-web | текст кнопки | команда портала | 🔵 подтверждено аналитиком |',
  '1.3': 'change_request.md: FR-1 — понятное название действия.',
  '2': 'Не применимо: новых/изменённых взаимодействий нет; задето: кнопка отправки списка заявок.',
  catalog: 'Не применимо: ошибки и их обработка не меняются, новых нет.',
  '3.1': 'Не применимо: работ на бэкенде нет.',
  '3.2': '🔵 Подтверждено аналитиком: новых/изменённых сущностей и полей нет; старые записи целы, миграции и пересчёт не нужны.',
  '3.3': 'Не применимо: доступ и его проверка не меняются.',
  '4.1': '🟢 Список заявок: текст кнопки «Сохранить» → «Отправить на согласование».',
  '4.2': '🔵 Подтверждено аналитиком: нажатие отправляет заявку и переводит на прежний экран.',
  '4.3': 'Не применимо: состояния, их условия, переходы и отображение не меняются.',
  '4.3.1': 'Не применимо: загрузка, таймауты, polling и реакция на сбои не меняются.',
  '4.4': 'Не применимо: доступ по ролям и его проверка не меняются.',
  '5.1': 'Не применимо: синхронность, кэш/TTL, опрос, таймауты и нагрузка не меняются.',
  '5.2': 'Не применимо: поведение при сбоях не тронуто.',
  '5.3': 'Не применимо: доступ и его проверка не меняются.',
  '6.1': '🔵 Общий релиз: одна независимая поставка portal-web, BE и DDL не деплоятся.',
  '6.2': '🔵 Подтверждено аналитиком: отправка, права и их проверка, автосохранение и переход после отправки остаются прежними.',
  '6.3': 'Не применимо: задача не использует фиче-флаги.',
  '6.4': '🔵 Откат предыдущим FE-бандлом; локальное состояние черновика сохраняется.\n- ~~Откат только BE — не применимо: BE не деплоится.~~\n- ~~Откат DDL — не применимо: миграций нет.~~',
  '6.5': ['Роли в security-сервисе', 'DDL-миграция в репо владеющего сервиса', 'Конфиги по окружениям (dev/staging/prod)', 'Сервисные аккаунты для межсервисных вызовов', 'Фиче-флаги заведены'].map(p => '- [ ] ~~' + p + ': Не применимо: подготовки по этому пункту задача не требует.~~').join('\n'),
  '7': '| FR из БТ | Взаимодействие(я) | Тест-кейс (Дано–Когда–Тогда) |\n|---|---|---|\n| FR-1 | ~~Не применимо: новых/изменённых взаимодействий нет~~ | Дано: список заявок; когда открыт — новый текст; нажать — отправлено как прежде |',
  '8': '- **🔵 Подтверждено аналитиком (не по коду):** сценарий отправки, данные, доступ и независимый релиз — по источнику и интервью; валидировать при интеграции.\n- **🟡 К валидации:** нет.\n- **❓ Открытые решения:** нет.\n- **⚠️ Требует уточнения:** нет.\n- **Технические риски:** —.\n- **Унаследовано из БТ (бизнес-пробелы):** Унаследованных бизнес-пробелов нет.\n- **Приложения из БТ:** Приложений нет.'
}
const na = new Set(['2', 'catalog', '3.1', '3.3', '4.3', '4.3.1', '4.4', '5', '5.1', '5.2', '5.3', '6.3', '6.5'])
const clean = '# Техническая спецификация: текст кнопки\n\n> **Задача:** UA-410\n> **Источник (БТ):** change_request.md\n> **Редакция:** 1\n> **Статус готовности:** Готово к разработке\n> **Открытые вопросы:** Все технические решения приняты, спецификация готова к разработке\n\n' + headings.map(h => {
  const id = h.match(/^#+ (\d+(?:\.\d+)*)\./)?.[1] ?? 'catalog'
  const text = body[id] ?? ''
  return (na.has(id) ? h.replace(/^(#+) (.*)$/, '$1 ~~$2~~') : h) + '\n' + (na.has(id) && id !== '6.5' ? '~~' + text + '~~' : text)
}).join('\n\n') + '\n'
add('ua-refine', { [sourcePath]: baseSource, [specPath]: clean }, `Явный флаг мелкой правки. Доработай ${specPath} по ${sourcePath}; это проход доработки, первоначальное интервью закончено.
Ответ аналитика: согласован фиче-флаг approvalButtonLabel в portal-web: false — «Сохранить», true — «Отправить на согласование».
Локальный флаг задаётся сборкой FE, начально true, переключает команда портала. Откат — предыдущий FE-бандл.
Остальные решения прежние. Подними редакцию и пересчитай статус.`, { target: specPath, kind: 'refine' })
const reviewPrompt = `Проведи приёмку технической спецификации ${specPath}. Источник ${sourcePath}, режим мелкой правки. Выполни spec-review.`
for (const [id, spec, expect] of [
  ['ua-review-clean', clean, []],
  ['ua-review-format', clean.replace('### ~~4.3.1.', '### 4.3.1.').replace('Loading и таймауты (обязательно, если есть FE)~~', 'Loading и таймауты (обязательно, если есть FE)'), ['11: heading not struck']],
  ['ua-review-reliability', clean.replace(body['6.1'], '🔵 Общий релиз.'), []],
  ['ua-review-source', clean.replace('Унаследованных бизнес-пробелов нет.', '~~Не применимо: документ сверху не БТ~~').replace('Приложений нет.', '~~Не применимо: документ сверху не БТ~~'), ['11: source substitution']],
  ['ua-review-flags', clean.replace(body['6.1'], 'Флагов нет, поэтому релизим атомарно.'), ['11: atomicity inferred from absent flags']],
  ['ua-review-open', clean.replace('Не применимо: доступ и его проверка не меняются.', '❓ TBD: требуется подтвердить доступ'), ['11: open item struck', '6/10: open status']]
]) {
  const inputs = { [sourcePath]: baseSource, [specPath]: spec }
  if (id === 'ua-review-reliability') inputs['coddoc/UA-410/business_requirements.md'] = readFileSync(join(import.meta.dirname, 'fixtures/TS-CONV/coddoc/ARS-201/business_requirements.md'), 'utf8').replaceAll('ARS-201', 'UA-410')
  add(id, inputs, reviewPrompt, { skill: join(snap, 'spec-review/SKILL.md'), target: specPath, kind: 'review', expected: expect })
}

const registry = [
  ['ts-live','TS-LIVE','spec-prompt.txt'], ['ts-conv','TS-CONV','spec-prompt.txt'], ['ts-conv2','TS-CONV2','spec-prompt.txt'],
  ['ts-opt','TS-CONV','opt-prompt.txt'], ['ts-conv-2t','TS-CONV','opt-prompt.txt','conv-turn2.txt'],
  ['ts-ctx','TS-CTX','spec-prompt.txt'], ['ts-noctx','TS-NOCTX','spec-prompt.txt'],
  ['ts-gaps','TS-GAPS','spec-prompt.txt'], ['ts-gaps-q','TS-GAPS','q-prompt.txt'],
  ['ts-fix','TS-FIX','fix-prompt.txt','fix-turn2.txt'], ['ts-fix-yes','TS-FIX','fix-prompt.txt','fix-yes-turn2.txt'],
  ['bf-spec','BF-SPEC','spec-prompt.txt'], ['bfg-scroll','BF-GATE','scroll-q-prompt.txt'], ['bfg-role','BF-GATE','role-q-prompt.txt'],
  ['rv-clean','RV-CLEAN','rv-prompt.txt'], ['rv-conv','RV-CONV','rv-prompt.txt'],
  ['rv-fe','RV-AUDIT','fe-prompt.txt'], ['rv-tpl-clean','RV-AUDIT','tpl-clean-prompt.txt'],
  ['rv-tpl-dirty','RV-AUDIT','tpl-dirty-prompt.txt'], ['rv-tpl-count','RV-AUDIT','tpl-count-prompt.txt'],
  ['rv-bug-spec','RV-BUG','spec-prompt.txt'], ['rv-bug-src','RV-BUG','src-prompt.txt']
]
for (const [id, fixture, p, second] of registry) {
  const dir = join(import.meta.dirname, 'fixtures', fixture)
  if (!existsSync(join(dir, p))) throw new Error('Нет входа ' + fixture + '/' + p)
  const work = join(round, id, 'run-01')
  mkdirSync(work, { recursive: true })
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && ['coddoc','services','context'].includes(e.name)) cpSync(join(dir, e.name), join(work, e.name), { recursive: true })
  const prompt = readFileSync(join(dir, p), 'utf8')
  writeFileSync(join(work, 'prompt.txt'), prompt)
  if (second) writeFileSync(join(work, 'turn2.txt'), readFileSync(join(dir, second), 'utf8'))
  writeFileSync(join(work, 'INPUT-HASHES.json'), JSON.stringify(files(work), null, 2) + '\n')
  const taskPath = prompt.match(/coddoc\/[A-Za-z0-9_-]+\/(?:business_requirements|bug_report|technical_specification)\.md/)?.[0]
  const target = id.startsWith('bfg-') ? null : taskPath?.replace(/[^/]+$/, 'technical_specification.md')
  if (id.startsWith('bfg-')) writeFileSync(join(work, '_seeded.txt'), files(work).filter(f => f.path.endsWith('.md')).map(f => f.path).join('\n') + '\n')
  manifest.push({ id, work, target, skill: join(snap, id.startsWith('rv-') ? 'spec-review/SKILL.md' : 'technical-spec-doc/SKILL.md'),
    kind: id.startsWith('rv-') ? 'review-regression' : 'regression', second: second ? 'turn2.txt' : null, fixture })
}
writeFileSync(join(round, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(join(round, 'STATE.md'), '# Применимость: ' + name + '\n\nМодель gpt-6-luna, reasoning max. Условия в SETTINGS.json.\n' + manifest.map(r => '- ' + r.id + ': pending').join('\n') + '\n')
console.log(JSON.stringify({ round, probes: manifest.length, ids: manifest.map(r => r.id) }, null, 2))
