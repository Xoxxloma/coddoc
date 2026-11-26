// Подготовка изолированных проб. Инференс выполняется встроенными субагентами,
// этот скрипт только копирует входные документы и неизменяемые снимки скиллов.
import { mkdirSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const repo = resolve(import.meta.dirname, '../..')
const primaryRound = join(import.meta.dirname, 'runs/2026-10-06-na-strike')
const roundName = process.argv[3] ?? '2026-10-06-na-strike'
if (!/^2026-10-06-na-strike(?:-v\d+)?$/.test(roundName)) throw new Error('Неверное имя раунда')
const round = join(import.meta.dirname, 'runs', roundName)
const arm = process.argv[2]
if (!['before', 'after', 'review'].includes(arm)) throw new Error('usage: node prepare-na.mjs before|after|review [round]')
const snapshot = join(round, arm === 'before' ? '_src-base' : '_skills')
if (arm !== 'review') {
  if (existsSync(snapshot)) throw new Error('Снимок уже существует: новый текст требует отдельного раунда')
  mkdirSync(snapshot, { recursive: true })
  for (const name of ['technical-spec-doc', 'spec-review']) cpSync(join(repo, 'agent-version', name), join(snapshot, name), { recursive: true })
  writeFileSync(join(snapshot, 'commit.txt'), execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }))
}
if (arm === 'after' && round !== primaryRound) {
  cpSync(join(primaryRound, '_src-base'), join(round, '_src-base'), { recursive: true })
  cpSync(join(primaryRound, 'before-manifest.json'), join(round, 'before-manifest.json'))
}

const skill = readFileSync(join(snapshot, 'technical-spec-doc/SKILL.md'), 'utf8')
const template = skill.replace(/\r\n/g, '\n').split('````markdown\n')[1]?.split('\n````')[0]
if (!template) throw new Error('Шаблон спеки не найден')
const headings = template.split('\n').filter((l) => /^#{2,3} \d+\./.test(l))
const change = `---
type: change-request
task: NA-410
source: решение аналитика
---
# Запрос на правку: текст кнопки
> **Задача:** NA-410
> **Статус готовности:** Готово к оценке
## 1. Затронутый бизнес-процесс
Отправка заявки на согласование на экране списка заявок portal-web.
## 2. Что тронуто
| Предмет | Тронуто | Как сейчас → как должно стать |
|---|---|---|
| Контракт | нет | — |
| Данные | нет | — |
| Интерфейс | да | «Сохранить» → «Отправить на согласование» |
| Зависимость | нет | — |
| Конфигурация | нет | — |
Вердикт: мелкая правка.
## 3. Как сейчас
Кнопка называется «Сохранить», её действие уже отправляет заявку на согласование.
## 4. Как должно стать
- FR-1: назвать кнопку «Отправить на согласование». 🔵 Решение аналитика Иванова.
## 5. Как проверят, что сделано
FR-1: открыть список заявок — кнопка имеет новый текст; нажать — заявка отправлена на согласование как прежде.
## 6. Что рядом остаётся прежним
Отправка заявки, права, автоматическое сохранение черновика и переход после отправки.
## 7. Критичность и срочность
Низкая, общий релиз.
## Открытые вопросы
Нет.
`
const feature = `# Бизнес-требования: справка о согласовании
> **Задача:** NA-420
> **Статус готовности:** Готово к оценке
## 1. Введение и контекст
Новый функционал. Сотрудникам неясно, что происходит после отправки заявки.
Потребители: сотрудники, заказчик: руководитель операций.
## 2. Бизнес-требования
Цель: показать правила согласования непосредственно в списке заявок portal-web.
Ценность: сотрудник получает ответ без обращения в поддержку.
Риск устаревшего текста: статическая справка обновляется вместе с релизом.
## 3. Объём проекта
Кнопка «Как работает согласование» и локальный диалог со статическим текстом.
Текст: «Заявку рассматривает руководитель. Результат появится в списке заявок».
Новых обращений к бэкенду, интеграций, данных и изменений ролей нет.
## 4. Функциональные требования
### 4.1. Функционал
- FR-1: по кнопке открыть диалог с указанным текстом.
- FR-2: закрыть диалог кнопкой «Закрыть», Escape или нажатием на фон.
### 4.2. Критерии приёмки
- FR-1: открыть список и нажать кнопку — появился диалог с дословным текстом.
- FR-2: каждое из трёх действий закрывает диалог, фокус возвращается на кнопку открытия.
## 5. Ограничения и атрибуты качества
Приоритет низкий, общий релиз, срок текущий квартал.
Сотрудник и руководитель видят кнопку, как и существующий список заявок.
## 6. Приложения
Нет.
`

const answered = `Это ПРОДОЛЖЕНИЕ: вопросы по тех-гейтам уже заданы, аналитик отвечает.
Все существующие сведения ниже подтверждаю своими словами.
Ключ и путь берутся из источника, спеку клади рядом с ним.
Только FE, portal-web, владелец — команда портала.
Новых/изменённых контрактов нет, бэкенд и данные не меняются.
Испорченных записей нет, пересчёт и миграции не нужны.
Роли, доступ, нагрузка, синхронность и кэш не меняются.
Сервисных аккаунтов, преднастройки и фиче-флагов нет.
Общий релиз только portal-web; откат — предыдущий FE-бандл, BE и DDL не деплоятся.
Границы: отправка заявки, права, автосохранение черновика, переход после отправки прежние.
Контроль приёмки — по FR и критериям источника.
`

const bodies = {
  '1.1': '**Суть:** переименовать кнопку списка заявок.\n**Тип:** мелкая правка\n**Стороны:** FE-only',
  '1.2': '| Сервис | Роль в задаче | Владелец/команда | Происхождение |\n|---|---|---|---|\n| portal-web | изменение текста | команда портала | 🔵 подтверждено аналитиком |',
  '1.3': 'change_request.md — FR-1, понятное название действия.',
  '2': 'Не применимо: контракт не меняется; задето: кнопка отправки заявки на списке заявок.',
  '3.1': 'Не применимо: бэкенд не меняется.',
  '3.2': '🔵 Подтверждено аналитиком: новых сущностей нет; испорченных записей нет, пересчёт и миграции не нужны.',
  '3.3': 'Не применимо: доступ не меняется.',
  '4.1': '🟢 Текст кнопки: «Сохранить» → «Отправить на согласование».',
  '4.2': '🔵 Подтверждено аналитиком: нажатие отправляет заявку на согласование как прежде.',
  '4.3': 'Не применимо: состояния прежние.',
  '4.3.1': 'Не применимо: загрузка и таймауты прежние.',
  '4.4': 'Не применимо: доступ по ролям прежний.',
  '5.1': 'Не применимо: нагрузка и синхронность прежние.',
  '5.2': 'Не применимо: работа с зависимостями не меняется.',
  '5.3': 'Не применимо: права прежние.',
  '6.1': '🟢 Общий релиз portal-web, BE не деплоится.',
  '6.2': '🔵 Подтверждено аналитиком: отправка, права, автосохранение и переход после отправки остаются прежними.',
  '6.3': 'Не применимо: фиче-флага нет.',
  '6.4': '🟢 Откат предыдущего FE-бандла; BE и DDL не деплоятся.',
  '6.5': 'Не применимо: преднастройки нет.',
  '7': '| FR из БТ | Взаимодействие(я) | Тест-кейс (Дано–Когда–Тогда) |\n|---|---|---|\n| FR-1 | Не применимо: контракт прежний | Открыть список: новый текст; нажать: заявка отправлена как прежде |',
  '8': 'Открытых решений и рисков нет. Приложений нет.'
}
const seed = '# Техническая спецификация: текст кнопки\n\n> **Задача:** NA-410\n> **Источник (БТ):** change_request.md\n> **Редакция:** 1\n> **Статус готовности:** Готово к разработке\n> **Открытые вопросы:** нет\n\n' + headings.map((h) => h + '\n' + (bodies[h.match(/^#+ (\d+(?:\.\d+)*)\./)[1]] ?? '')).join('\n\n') + '\n'

if (arm === 'review') {
  const na = new Set(['2', '3.1', '3.3', '4.3', '4.3.1', '4.4', '5', '5.1', '5.2', '5.3', '6.3', '6.5'])
  let clean = seed.split('\n').map((line) => {
    const h = /^(#{2,3}) (\d+(?:\.\d+)*)\./.exec(line)
    if (h && na.has(h[2])) return h[1] + ' ~~' + line.slice(h[1].length + 1) + '~~'
    if (/^Не применимо:/.test(line)) return '~~' + line + '~~'
    return line.replace('Не применимо: контракт прежний', '~~Не применимо: контракт прежний~~')
  }).join('\n')
  const catalog = template.split('\n').find((l) => l.startsWith('### Каталог ошибок'))
  clean = clean.replace('## 3. Backend', catalog.replace('### ', '### ~~') + '~~\n~~Не применимо: контракты и ошибки не меняются.~~\n\n## 3. Backend')
  const stateHeading = headings.find((h) => h.startsWith('### 4.3. '))
  const flagHeading = headings.find((h) => h.startsWith('### 6.2. '))
  const mixed = clean.replace(stateHeading.replace('### ', '### ~~') + '~~\n~~Не применимо: состояния прежние.~~',
    stateHeading + '\n| Имя состояния | Условие | Что видит пользователь |\n|---|---|---|\n| value | заявка отправляется как прежде | прежний экран |\n| ~~empty~~ | ~~Не применимо: данных из сети нет~~ | ~~пустого ответа нет~~ |')
  const open = clean.replace('~~Не применимо: доступ не меняется.~~', '~~❓ TBD: нужна проверка роли~~')
    .replace('> **Статус готовности:** Готово к разработке', '> **Статус готовности:** Требуются уточнения (1)')
    .replace('> **Открытые вопросы:** нет', '> **Открытые вопросы:**\n> 1. ❓ TBD: нужна проверка роли')
    .replace('Открытых решений и рисков нет. Приложений нет.', '- ❓ TBD: нужна проверка роли.\nРисков и приложений нет.')
  const variants = [
    { name: 'clean', text: clean, expected: 0 },
    { name: 'mixed', text: mixed, expected: 0 },
    { name: 'partial-reason', text: clean.replace('~~Не применимо: доступ не меняется.~~', '~~Не применимо~~: доступ не меняется.'), expected: 1 },
    { name: 'applied-heading', text: clean.replace(flagHeading, flagHeading.replace('### ', '### ~~') + '~~'), expected: 1 },
    { name: 'open-struck', text: open, expected: 1 }
  ]
  const manifest = variants.map((v, i) => {
    const work = join(round, 'review', `run-${String(i + 1).padStart(2, '0')}`)
    const docs = join(work, 'coddoc/NA-410')
    if (existsSync(work)) throw new Error('Проба приёмки уже существует')
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, 'technical_specification.md'), v.text)
    writeFileSync(join(docs, 'change_request.md'), change)
    return { name: v.name, work, target: 'coddoc/NA-410/technical_specification.md', source: 'coddoc/NA-410/change_request.md',
      checklist: join(snapshot, 'spec-review/reference/checklist-spec.md'), expected: v.expected }
  })
  writeFileSync(join(round, 'review-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`review: ${manifest.length} песочниц`)
  process.exit(0)
}

const cases = ['bug', 'change', 'feature', 'refine', 'bug', 'change', 'feature', 'refine', 'bug', 'change']
const manifest = []
for (let i = 0; i < cases.length; i++) {
  const scenario = cases[i]
  const work = join(round, arm, `run-${String(i + 1).padStart(2, '0')}`)
  mkdirSync(work, { recursive: true })
  let prompt, target
  if (scenario === 'bug') {
    cpSync(join(import.meta.dirname, 'fixtures/BF-SPEC/coddoc/ARS-312'), join(work, 'coddoc/ARS-312'), { recursive: true })
    prompt = readFileSync(join(import.meta.dirname, 'fixtures/BF-SPEC/spec-prompt.txt'), 'utf8')
    target = 'coddoc/ARS-312/technical_specification.md'
  } else {
    const key = scenario === 'feature' ? 'NA-420' : 'NA-410'
    const docs = join(work, 'coddoc', key)
    mkdirSync(docs, { recursive: true })
    const source = scenario === 'feature' ? 'business_requirements.md' : 'change_request.md'
    writeFileSync(join(docs, source), scenario === 'feature' ? feature : change)
    prompt = `Документ сверху: coddoc/${key}/${source}. ${scenario === 'feature' ? 'Обычный режим по БТ.' : 'Явный флаг от analyst-workspace: режим мелкой правки.'}\n\n${answered}`
    if (scenario === 'feature') prompt += '\nЛокальный диалог без сети: закрыт/открыт. Открываем синхронно, ожидание и таймауты не возникают; нет числовых значений, пустого ответа, ошибок источника и 403. Фокус и закрытие — по БТ. Новую локальную UI-логику проектируй по этим решениям.'
    if (scenario === 'change') prompt += '\nМеняется только текст кнопки, новых состояний UI нет.'
    if (scenario === 'refine') {
      writeFileSync(join(docs, 'technical_specification.md'), seed)
      prompt = `Явный флаг от analyst-workspace: мелкая правка. Доработай существующую coddoc/${key}/technical_specification.md по change_request.md; это проход доработки, первоначальное интервью закончено.\nОтвет аналитика: для выката переименования теперь согласован фиче-флаг approvalButtonLabel в portal-web. Значение false оставляет «Сохранить», true — «Отправить на согласование». Флаг локальный, задаётся сборкой FE, изначально true; переключает команда портала. Откат — предыдущий FE-бандл. Остальные подтверждённые решения прежние. Подними редакцию и пересчитай статус.`
    }
    target = `coddoc/${key}/technical_specification.md`
  }
  writeFileSync(join(work, 'prompt.txt'), prompt)
  manifest.push({ arm, scenario, work, skill: join(snapshot, 'technical-spec-doc/SKILL.md'), target })
}
writeFileSync(join(round, `${arm}-manifest.json`), JSON.stringify(manifest, null, 2) + '\n')
console.log(`${arm}: ${manifest.length} песочниц; снимок ${snapshot}`)
