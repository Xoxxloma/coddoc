#!/usr/bin/env node
// grade-br-roles.mjs — пробы BR-ROLES-W и BR-ROLES-Q (скилл: business-requirements-doc).
//
//   node grade-br-roles.mjs <каталог с песочницами> --expect=write      ← BR-ROLES-W (w-prompt)
//   node grade-br-roles.mjs <каталог с песочницами> --expect=questions  ← BR-ROLES-Q (q-prompt)
//   node grade-br-roles.mjs --selftest                                  ← проверка грейдера
//
// ЧТО МЕРЯЕТСЯ. Роли живут в засеянных карточках `services/*.md` енамами. Скилл обязан взять
// имя ДОСЛОВНО (правка 2026-08-13: §5.3 выведена из-под запрета кодовых имён). Два дефекта
// разные и живут в разных артефактах, поэтому и плеча два:
//   W — роли подтверждены ссылкой на карточки → ждём ФАЙЛ, грейдим §5.3;
//   Q — гейт ролей открыт → ждём ВОПРОС, грейдим ОТВЕТ (несёт ли он точные имена).
// Грейдить W-критериями Q-плечо нельзя: законный исход Q — вопрос без файла.
//
// Правила репы, из-за которых он написан именно так:
//   - главный анкер снимается с ДИСКА (файл есть или нет), а не с формулировки ответа;
//   - песочница без `answer.md` или с `_api-failure.txt` — «НЕ ИЗМЕРЕНО», а не «провалено»;
//   - регулярки ЛИТЕРАЛЬНЫЕ, из строк не собираются (иначе `\b` + конкатенация дают тихий
//     промах, а выглядит рабочим);
//   - имя роли и имя сервиса не пересекаются как подстроки НАМЕРЕННО (`SRM_*`/`EXECUTOR`
//     против `vendor-registry`/`tender-desk`): иначе проверка утечки ловит легальную роль;
//   - `ADMIN` ищется по границам слова и ТОЛЬКО внутри разобранной §5.3 — как подстрока он
//     сидит в `SRM_BUSINESS_ADMIN`, и грубый греп по файлу дал бы ложный сигнал;
//   - путь файла — отдельная колонка, а не часть вердикта: «записал не туда» и «не записал»
//     чинятся разными правками и слипаться в один красный не должны.
//
// ЧЕГО НЕ МЕРЯЕТ. «Все четыре роли реестра обязаны быть в §5.3» — не критерий: задача может
// касаться не всех. Красное — имя, которого в карточках НЕТ, и роль, названная только
// по-русски (у неё потерян ключ доступа). Полнота печатается числом для глаз.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ─── Литеральные регулярки. Ни одна не собирается из строки. ────────────────────────────────

/** Роли из засеянных карточек. `label` — только для печати. */
const ROLE_PATTERNS = [
  { label: 'SRM_BUSINESS_ADMIN', re: /\bSRM_BUSINESS_ADMIN\b/ },
  { label: 'SRM_INTERNAL_USER', re: /\bSRM_INTERNAL_USER\b/ },
  { label: 'SRM_EXTERNAL_USER', re: /\bSRM_EXTERNAL_USER\b/ },
  { label: 'SRM_ACCREDIT_MODERATOR', re: /\bSRM_ACCREDIT_MODERATOR\b/ },
  { label: 'EXECUTOR', re: /\bEXECUTOR\b/ },
  { label: 'ADMIN', re: /\bADMIN\b/ },
  { label: 'VIEWER', re: /\bVIEWER\b/ },
]

/** Имена ролей реестра — их ждём в W и в вопросе Q. `EXECUTOR` добавляется только в W. */
const REGISTRY_ROLES = ROLE_PATTERNS.slice(0, 4)

/** Кодовые имена из карточек, которым в тексте спеки быть НЕЛЬЗЯ (кроме §5.3). */
const LEAK_PATTERNS = [
  { label: 'vendor-registry', re: /vendor-registry/ },
  { label: 'tender-desk', re: /tender-desk/ },
  { label: 'AccreditationRequestDto', re: /AccreditationRequestDto/ },
  { label: 'LotDto', re: /LotDto/ },
  { label: 'POST /v1/vendors', re: /\/v1\/vendors/ },
  { label: 'GET /v1/lots', re: /\/v1\/lots/ },
  { label: 'Kafka', re: /\bKafka\b/ },
  { label: 'Redis', re: /\bRedis\b/ },
  { label: 'PostgreSQL', re: /\bPostgreSQL\b/ },
  { label: 'S3', re: /\bS3\b/ },
  { label: 'accreditation-expiry-scan', re: /accreditation-expiry-scan/ },
  { label: 'vendor.accreditation.expiring', re: /vendor\.accreditation\.expiring/ },
]

/**
 * Режим `--expect=br2` — регресс на ЧУЖОЙ фикстуре `_skill-eval/fixtures/br2-prompt.txt`.
 * Там роли названы пользователем ПРОЗОЙ («клиент», «оператор поддержки»), а база знаний
 * набита кодовыми именами. Правка 2026-08-13 разрешила писать роли кодом — риск в том, что
 * агент сочтёт код обязательным ВСЕГДА и приделает токен к роли, которой в источнике нет.
 */
const BR2_LEAK_PATTERNS = [
  { label: 'client-cabinet', re: /client-cabinet/ },
  { label: 'reports', re: /\breports\b/ },
  { label: 'MinIO', re: /MinIO/ },
  { label: 'ReportRequestDto', re: /ReportRequestDto/ },
  { label: 'POST /report/export', re: /\/report\/export/ },
  { label: 'IN_PROGRESS', re: /\bIN_PROGRESS\b/ },
  { label: 'READY', re: /\bREADY\b/ },
]

/**
 * Факты, которые есть ТОЛЬКО в карточках: ни в одном промпте фикстуры их нет (инвариант 2 в
 * README, перепроверяется грепом). Появились в ответе — карточка открыта.
 */
const CARD_ONLY_PATTERNS = [
  { label: 'vendor-registry', re: /vendor-registry/ },
  { label: 'tender-desk', re: /tender-desk/ },
]

/** Заглавные токены, которые ролями не являются и в «выдуманные» не идут. */
const NOT_A_ROLE = new Set([
  'TBD', 'FR', 'SMSEC', 'PDF', 'UX', 'CRUD', 'API', 'ID', 'IDS', 'URL', 'HTTP', 'UI', 'ТБ',
])

const RE_H53 = /^###\s*5\.3/
const RE_ANY_HEADING = /^#{2,4}\s/
const RE_UPPER_TOKEN = /\b[A-Z][A-Z0-9_]{2,}\b/g
const RE_RU_EXECUTOR = /исполнител/i
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

// ─── Разбор ────────────────────────────────────────────────────────────────────────────────

/** Тело §5.3: от её заголовка до следующего заголовка любого уровня. '' — секции нет. */
export function section53(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => RE_H53.test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => RE_ANY_HEADING.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

/** Текст файла без §5.3 — зона, где кодовым именам быть нельзя. */
function outside53(text) {
  const sec = section53(text)
  return sec === '' ? text : text.replace(sec, '')
}

/** Оценка ОДНОГО документа БТ. Чистая функция — на ней же идёт самопроверка. */
export function gradeSpec(text) {
  const sec = section53(text)
  const hits = ROLE_PATTERNS.filter((r) => r.re.test(sec)).map((r) => r.label)
  const tokens = [...new Set(sec.match(RE_UPPER_TOKEN) ?? [])]
  const known = new Set(ROLE_PATTERNS.map((r) => r.label))
  const invented = tokens.filter((t) => !known.has(t) && !NOT_A_ROLE.has(t))
  const leaks = LEAK_PATTERNS.filter((p) => p.re.test(outside53(text))).map((p) => p.label)
  return {
    has53: sec.trim() !== '',
    roleHits: hits,
    registryHits: REGISTRY_ROLES.filter((r) => r.re.test(sec)).length,
    invented,
    // Роль названа по-русски, а токен потерян — ровно тот обход, ради которого правка и делалась.
    ruOnlyExecutor: RE_RU_EXECUTOR.test(sec) && !/\bEXECUTOR\b/.test(sec),
    leaks,
  }
}

/**
 * Оценка документа в плече BR-2. Красное — имя из базы знаний где угодно в спеке ИЛИ
 * псевдо-енам в §5.3: роль была названа прозой, кодового имени у неё нет и взяться ему неоткуда.
 */
export function gradeBr2(text) {
  const sec = section53(text)
  const tokens = [...new Set(sec.match(RE_UPPER_TOKEN) ?? [])].filter((t) => !NOT_A_ROLE.has(t))
  return {
    has53: sec.trim() !== '',
    leaks: BR2_LEAK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label),
    pseudoEnums: tokens,
    roleRows: sec.split(/\r?\n/).filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|?\s*$/.test(l)).length,
  }
}

/** Оценка ОТВЕТА в плече Q: несёт ли вопрос точные имена из карточки. */
export function gradeAnswer(text) {
  const named = REGISTRY_ROLES.filter((r) => r.re.test(text)).map((r) => r.label)
  return { namedRoles: named, asksAboutRoles: /рол/i.test(text) }
}

/**
 * Режим `--expect=turn1` — тонкий бриф ПЕРВЫМ сообщением. Меряет то, ради чего проба и
 * заведена: пойдёт ли скилл в `services/` сам, без указания пользователя.
 *
 * ДОКАЗАТЕЛЬСТВО ЧТЕНИЯ — только токен из карточки. Слово «карточка» в доказательства НЕ
 * годится: в этом домене есть и карточка сервиса, и карточка поставщика в интерфейсе. На
 * пробе 3 прогонов (`t1-probe3/run-3`) четыре совпадения «карточк» оказались про вторую —
 * готовый ложный плюс, если грейдить словарём.
 */
export function gradeTurn1(text) {
  // Доказательство чтения — ЛЮБОЙ факт, который есть только в карточке: имя роли ИЛИ имя
  // сервиса. Считать по одним ролям — недосчёт: прогон может открыть карточку и пересказать
  // события, не цитируя ролей (`ts-control/run-10` так и сделал, а грейдер покрасил красным).
  const proof = [...REGISTRY_ROLES, ROLE_PATTERNS[4], ...CARD_ONLY_PATTERNS]
    .filter((r) => r.re.test(text))
    .map((r) => r.label)
  const named = [...REGISTRY_ROLES, ROLE_PATTERNS[4]].filter((r) => r.re.test(text)).map((r) => r.label)
  return { readCards: proof.length > 0, namedRoles: named, asksAboutRoles: /рол/i.test(text) }
}

// ─── Обход песочниц ────────────────────────────────────────────────────────────────────────

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

function gradeSandbox(sb, mode) {
  const r = { name: sb.split(/[\\/]/).pop(), measured: false }
  if (existsSync(join(sb, '_api-failure.txt'))) return { ...r, why: 'отказ API' }
  const ans = join(sb, 'answer.md')
  if (!existsSync(ans) || statSync(ans).size === 0) return { ...r, why: 'нет ответа' }
  const answer = readFileSync(ans, 'utf8')
  if (RE_API_FAILURE.test(answer)) return { ...r, why: 'отказ API в тексте ответа' }
  r.measured = true

  const seeded = new Set(
    existsSync(join(sb, '_seeded.txt'))
      ? readFileSync(join(sb, '_seeded.txt'), 'utf8').split(/\r?\n/).filter(Boolean)
      : []
  )
  const created = walk(sb)
    .map((p) => p.slice(sb.length + 1).split(/[\\/]/).join('/'))
    .filter((p) => !seeded.has(p) && p !== 'answer.md' && p !== '_seeded.txt' && !p.startsWith('_'))
  const brds = created.filter((p) => p.endsWith('business_requirements.md'))

  r.createdCount = created.length
  r.brdPaths = brds
  r.wrote = brds.length > 0
  r.pathOk = brds.some((p) => p === 'coddoc/SMSEC-3120/business_requirements.md')

  if (mode === 'cards') {
    // Контроль «ходит ли скилл в services/ сам». Скилл здесь ЧУЖОЙ (тех-спека), артефакт у
    // него свой, поэтому доказательство ищем и в ответе, и во всех созданных файлах.
    const body = [answer, ...created.map((p) => readFileSync(join(sb, p), 'utf8'))].join('\n')
    const t = gradeTurn1(body)
    Object.assign(r, t)
    r.pass = t.readCards
    return r
  }

  if (mode === 'turn1') {
    const t = gradeTurn1(answer)
    Object.assign(r, t)
    // Первый ход = только вопросы, поэтому записанный файл — отдельный красный, а не «ок».
    r.pass = t.readCards && !r.wrote
    return r
  }

  if (mode === 'questions') {
    const a = gradeAnswer(answer)
    r.namedRoles = a.namedRoles
    r.asksAboutRoles = a.asksAboutRoles
    // Зелёный: файла нет И вопрос несёт хотя бы два точных имени из карточки.
    r.pass = !r.wrote && a.namedRoles.length >= 2
    return r
  }

  if (!r.wrote) return { ...r, pass: false, why: 'файл не записан' }

  if (mode === 'br2') {
    const b = gradeBr2(readFileSync(join(sb, brds[0]), 'utf8'))
    Object.assign(r, b)
    // Заголовок таблицы «| Роль | Права |» — тоже строка; ролей ждём две, значит строк три.
    r.pass = b.has53 && b.leaks.length === 0 && b.pseudoEnums.length === 0
    return r
  }

  const spec = gradeSpec(readFileSync(join(sb, brds[0]), 'utf8'))
  Object.assign(r, spec)
  r.pass =
    spec.has53 &&
    spec.registryHits >= 1 &&
    spec.roleHits.includes('EXECUTOR') &&
    spec.invented.length === 0 &&
    !spec.ruOnlyExecutor &&
    spec.leaks.length === 0
  return r
}

// ─── Самопроверка: грейдер обязан отличать известный зелёный от известного красного ─────────

const SPEC_GOOD = `# Бизнес-требования: предупреждение об истечении аккредитации
> **Задача Jira/SberTrack:** SMSEC-3120
## 1. Введение и контекст
### 1.2. Конечные потребители
Закупщики и сотрудники, ведущие аккредитацию.
## 4. Функциональные требования
FR-1. За 30 дней до истечения в анкете видно предупреждение.
## 5. Приоритет, сроки, роли
### 5.3. Ролевая модель
| Роль | Права / доступные действия |
|---|---|
| Бизнес-администратор (\`SRM_BUSINESS_ADMIN\`) | права не меняются; видит предупреждение |
| \`SRM_INTERNAL_USER\` | права не меняются; видит предупреждение |
| \`SRM_EXTERNAL_USER\` | права не меняются |
| \`SRM_ACCREDIT_MODERATOR\` | права не меняются; видит предупреждение |
| Исполнитель (\`EXECUTOR\`) | получает предупреждение по своим лотам |
## 6. Приложения
—`

// Красный №1 — имя выдумано (в карточках такого нет).
const SPEC_INVENTED = SPEC_GOOD.replace('`SRM_EXTERNAL_USER`', '`SRM_VENDOR_ADMIN`')
// Красный №2 — короткая роль названа только по-русски, токен потерян.
const SPEC_RU_ONLY = SPEC_GOOD.replace('| Исполнитель (`EXECUTOR`) |', '| Исполнитель |')
// Красный №3 — кодовое имя из карточки утекло за пределы §5.3.
const SPEC_LEAK = SPEC_GOOD.replace(
  'FR-1. За 30 дней до истечения в анкете видно предупреждение.',
  'FR-1. Сервис vendor-registry шлёт событие через Kafka за 30 дней до истечения.'
)
// Красный №4 — секции §5.3 нет вовсе.
const SPEC_NO_53 = SPEC_GOOD.replace(/### 5\.3[\s\S]*?## 6\./, '## 6.')

const ANSWER_GOOD = `Прежде чем писать спеку — уточню ролевую модель.
В карточке реестра поставщиков четыре роли: \`SRM_BUSINESS_ADMIN\` (настройки реестра),
\`SRM_INTERNAL_USER\` (поиск и статистика), \`SRM_EXTERNAL_USER\` (опубликованные анкеты),
\`SRM_ACCREDIT_MODERATOR\` (заявки и модерация). Кто из них должен видеть предупреждение?`
const ANSWER_COLD = `Уточните, пожалуйста, ролевую модель: какие роли участвуют и что каждая может?`

// BR-2: роли названы прозой, кодовых имён у них нет и быть не должно.
const BR2_GOOD = `## 3.3. Архитектурные изменения
Используется существующий механизм генерации файлов.
### 5.3. Ролевая модель
| Роль | Права / доступные действия |
|---|---|
| Клиент | видит и выгружает только свои операции |
| Оператор поддержки | выгрузку не делает |`
// Красный: агент приделал енам роли, названной прозой.
const BR2_PSEUDO = BR2_GOOD.replace('| Клиент |', '| Клиент (`ROLE_CLIENT`) |')
// Красный: имя из базы знаний утекло в спеку.
const BR2_LEAK = BR2_GOOD.replace(
  'существующий механизм генерации файлов',
  'сервис reports, файлы в MinIO'
)

function selftest() {
  const g = gradeSpec(SPEC_GOOD)
  const checks = [
    ['зелёный: §5.3 разобрана', g.has53 === true],
    ['зелёный: 4 роли реестра найдены', g.registryHits === 4],
    ['зелёный: EXECUTOR найден', g.roleHits.includes('EXECUTOR')],
    ['зелёный: выдуманных нет', g.invented.length === 0],
    ['зелёный: утечек нет', g.leaks.length === 0],
    ['зелёный: русская подпись рядом с токеном не считается потерей', g.ruOnlyExecutor === false],
    ['красный: выдуманное имя поймано', gradeSpec(SPEC_INVENTED).invented.length === 1],
    ['красный: роль только по-русски поймана', gradeSpec(SPEC_RU_ONLY).ruOnlyExecutor === true],
    ['красный: утечка поймана', gradeSpec(SPEC_LEAK).leaks.length === 2],
    ['красный: нет §5.3', gradeSpec(SPEC_NO_53).has53 === false],
    // Ловушка подстроки: ADMIN сидит внутри SRM_BUSINESS_ADMIN — как отдельная роль не считается.
    ['ADMIN как подстрока не засчитан ролью', g.roleHits.includes('ADMIN') === false],
    // Ловушка секции: утечка ищется ВНЕ §5.3, легальные токены ролей её не поднимают.
    ['токены ролей в §5.3 не считаются утечкой', gradeSpec(SPEC_GOOD).leaks.length === 0],
    ['Q: вопрос с точными именами', gradeAnswer(ANSWER_GOOD).namedRoles.length === 4],
    ['Q: холодный вопрос без имён', gradeAnswer(ANSWER_COLD).namedRoles.length === 0],
    ['BR-2 зелёный: роли прозой, утечек нет',
      gradeBr2(BR2_GOOD).leaks.length === 0 && gradeBr2(BR2_GOOD).pseudoEnums.length === 0],
    ['BR-2 красный: приделан псевдо-енам', gradeBr2(BR2_PSEUDO).pseudoEnums.length === 1],
    ['BR-2 красный: утечка из базы знаний', gradeBr2(BR2_LEAK).leaks.length === 2],
    ['T1: токен из карточки = чтение доказано', gradeTurn1(ANSWER_GOOD).readCards === true],
    ['T1: «карточка поставщика» чтением НЕ считается',
      gradeTurn1('Что видит закупщик на карточке поставщика? Какие роли участвуют?').readCards === false],
    ['T1: имя сервиса из карточки тоже доказывает чтение',
      gradeTurn1('Реестр уже есть в `vendor-registry`, там событие об истечении.').readCards === true],
    ['T1: имя сервиса ролью НЕ считается',
      gradeTurn1('Реестр уже есть в `vendor-registry`.').namedRoles.length === 0],
  ]
  let bad = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`)
    if (!ok) bad++
  }
  console.log(bad === 0 ? '\nсамопроверка пройдена' : `\nсамопроверка ПРОВАЛЕНА: ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) selftest()

const root = argv.find((a) => !a.startsWith('--'))
const modeArg = argv.find((a) => a.startsWith('--expect='))
const mode = modeArg ? modeArg.slice('--expect='.length) : null
if (!root || !existsSync(root) || !['write', 'questions', 'br2', 'turn1', 'cards'].includes(mode)) {
  console.error('usage: node grade-br-roles.mjs <каталог с песочницами> --expect=write|questions|br2|questions')
  console.error('       node grade-br-roles.mjs --selftest')
  process.exit(1)
}

const sandboxes = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('run-'))
  .map((e) => join(root, e.name))
  .sort()

const rows = sandboxes.map((sb) => gradeSandbox(sb, mode))
const measured = rows.filter((r) => r.measured)

console.log(`плечо: ${root}   режим: ${mode}`)
console.log(`измерено: ${measured.length} из ${rows.length}` +
  (measured.length < rows.length
    ? `  (не измерено: ${rows.filter((r) => !r.measured).map((r) => `${r.name} — ${r.why}`).join(', ')})`
    : ''))

for (const r of measured) {
  if (mode === 'questions') {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  файл ${r.wrote ? 'ЗАПИСАН' : 'нет'}` +
      `  точных имён в вопросе: ${r.namedRoles.length} [${r.namedRoles.join(', ')}]`)
  } else if (mode === 'cards') {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  карточки ${r.readCards ? 'ПРОЧИТАНЫ' : 'нет'}` +
      `  создано файлов ${r.createdCount}` + (r.namedRoles?.length ? `  имена: ${r.namedRoles.join(', ')}` : ''))
  } else if (mode === 'turn1') {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  карточки ${r.readCards ? 'ПРОЧИТАНЫ' : 'нет'}` +
      `  файл ${r.wrote ? 'ЗАПИСАН (первый ход — нельзя)' : 'нет'}` +
      (r.namedRoles?.length ? `  имена: ${r.namedRoles.join(', ')}` : ''))
  } else if (mode === 'br2') {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  файл ${r.wrote ? 'да' : 'НЕТ'}` +
      (r.wrote
        ? `  §5.3 ${r.has53 ? 'есть' : 'НЕТ'}  строк ${r.roleRows ?? 0}` +
          (r.pseudoEnums?.length ? `  \x1b[31mпсевдо-енам: ${r.pseudoEnums.join(', ')}\x1b[0m` : '') +
          (r.leaks?.length ? `  \x1b[31mутечка: ${r.leaks.join(', ')}\x1b[0m` : '')
        : `  (${r.why ?? '—'})`))
  } else {
    console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  файл ${r.wrote ? 'да' : 'НЕТ'}` +
      `  путь ${r.wrote ? (r.pathOk ? 'ок' : 'НЕ ТУДА: ' + r.brdPaths.join(',')) : '—'}` +
      (r.wrote
        ? `  §5.3 ${r.has53 ? 'есть' : 'НЕТ'}  ролей реестра ${r.registryHits}/4` +
          `  EXECUTOR ${r.roleHits.includes('EXECUTOR') ? 'есть' : 'НЕТ'}` +
          (r.ruOnlyExecutor ? '  \x1b[31mтолько по-русски\x1b[0m' : '') +
          (r.invented.length ? `  \x1b[31mвыдумано: ${r.invented.join(', ')}\x1b[0m` : '') +
          (r.leaks.length ? `  \x1b[31mутечка: ${r.leaks.join(', ')}\x1b[0m` : '')
        : ''))
  }
}

const green = measured.filter((r) => r.pass).length
console.log(`\nИТОГ: ${green}/${measured.length}` +
  (measured.length ? ` (${Math.round((green / measured.length) * 100)}%)` : ''))
