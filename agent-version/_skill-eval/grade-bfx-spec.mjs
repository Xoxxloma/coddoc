#!/usr/bin/env node
// grade-bfx-spec.mjs — пробы bfx-doc / bfx-card (скилл: technical-spec-doc, режим багфикса), фикстура BFX-SPEC.
//
//   node grade-bfx-spec.mjs <каталог плеча> --case=doc|card
//   node grade-bfx-spec.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ. Багфикс, починка которого меняет контракт существующей ручки: `GET /v1/rooms` отдаёт `capacity`
// строкой, правка — целым числом. Грейдится записанный файл `coddoc/<KEY>/technical_specification.md`, а не отчёт.
//   doc  (MTR-512): путь и прежние поля названы в баг-репорте (рукопись), карточек services/ нет →
//        стык 🔵 «по документу сверху».
//   card (MTR-513): репорт в форме bug-report-doc (без путей и полей), путь и поля — в services/rooms-api.md,
//        аналитик сказал «да» на вопрос с ними → стык 🔵 «по карточке».
//
// ОЖИДАНИЯ — ИЗ ЗАПИСАННЫХ ПРАВИЛ (агент-версия, ветка feat/blue-contract):
//   technical-spec-doc/reference/bugfix-mode.md:67-68 «Меняется контракт (вернулся не тот код, уехало поле) — карточка
//     вида «изменение существующего»» → §2 не закрыта «не применимо», карточка изменения есть.
//   technical-spec-doc/SKILL.md:190-192 — вид «изменение существующего», «метка в заголовке — 🟢, «Происхождение» —
//     ровно `🟢 изменение существующего`».
//   SKILL.md:193-194 — существующая часть только в строке «Существующий стык», 🔵 с источником (путь и прежние поля —
//     как в источнике).
//   SKILL.md:154 «по карточке … — «да» аналитика на вопрос, где путь и поля взяты из карточки»; :156 «по документу
//     сверху — в режиме по флагу: сказано в … баг-репорте»; :157 «со слов — аналитик сказал сам…». Аналитик о прежнем
//     стыке в обоих плечах сам ничего не говорил → «со слов» у стыка — неверный источник.
//   bugfix-mode.md:28 «Репорт — подтверждённый документ, его содержание ты переносишь как истину и не переспрашиваешь».
//   SKILL.md:195-196 — таблица «поле | где | было | стало»; «Было» пишется только у поля из 🔵-источника.
//   SKILL.md:182 «Чего в источнике нет, того нет и в файле» → поля примера и таблицы ⊆ полям источника
//     (doc — образец ответа в репорте; card — сущность `Room` карточки).
//   SKILL.md:199-200 — пример JSON после изменения; checklist-spec.md §8 — у 🟢 JSON обязателен.
//   SKILL.md:201 «Что увидят прежние потребители — §6.2»; bugfix-mode.md:80-83 — §6.2 несёт границы правки.
//   bugfix-mode.md:34 — FR из «Ожидаемого результата» → §1.3 и §7; SKILL.md:598 и :808 — FR трассируется к INT.
//   bugfix-mode.md:23, :59, :127, :134-135 — БТ не заводится; тип словом «багфикс»; файл рядом с репортом;
//     причину не искать. SKILL.md:750 — словарь статуса спеки.
//
// ПРАВИЛА РЕПЫ: регулярки литеральные; `\b`/`\w` рядом с кириллицей не применять; общего процента нет —
// счётчик на признак.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { read, turn, apiFailed, section } from './br-lib.mjs'
import { normalizeSpecHeadings } from './spec-markdown.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CASES = {
  doc: { key: 'MTR-512', src: 'по документу сверху', allowed: ['roomId', 'name', 'floor', 'capacity'] },
  card: { key: 'MTR-513', src: 'по карточке', allowed: ['roomId', 'name', 'floor', 'capacity'] },
}
const P_PATH = /\/v1\/rooms/
const RE_DOC = /по\s+документу\s+сверху/i
const RE_DOC_LOOSE = /по\s+документу\s+сверху|по\s+баг-?репорт|bug_report\.md/i
const RE_CARD = /по\s+карточке/i
const RE_WORDS = /со\s+слов/i

/** INT-карточки: { head, body, mark } — метка из заголовка, иначе из «Происхождения» (как grade-ts-blue.mjs). */
export function cards (spec) {
  const parts = ('\n' + spec).split(/\n(?=#{2,4}\s*~*\s*INT-\d+)/).slice(1)
  return parts.map((p) => {
    const body = p.split(/\n(?=#{2,4}\s(?!.*INT-)|##\s)/)[0]
    const head = body.split('\n')[0]
    const prov = body.split('\n').find((l) => /Происхождение/i.test(l)) || ''
    const mark = (head.match(/🟢|🔵|🟡|❓/) || prov.match(/🟢|🔵|🟡|❓/) || [null])[0]
    return { head, body, mark }
  })
}

/** Карточка изменения: с видом «изменение существующего» и про вместимость; иначе любая про capacity или путь. */
export function changeCard (cs) {
  const about = (c) => /capacity|вместимост/i.test(c.head + '\n' + c.body)
  return cs.find((c) => about(c) && /изменени[ея]\s+существующ/i.test(c.body)) ||
    cs.find(about) || cs.find((c) => P_PATH.test(c.body)) || null
}

/**
 * Строка «Существующий стык»: пункт списка с этим именем (иначе первая строка, где оно есть) плюс строки продолжения с
 * отступом — метка и путь могут разъехаться на две строки одного пункта.
 */
export function seamOf (lines) {
  let i = lines.findIndex((l) => /^\s*[-*]\s*\**\s*Существующ[а-яё]*\s+стык/i.test(l))
  if (i < 0) i = lines.findIndex((l) => /Существующ[а-яё]*\s+стык/i.test(l))
  if (i < 0) return ''
  const out = [lines[i]]
  for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*[-*]\s*\*\*/.test(lines[j]) && !/^\s*\|/.test(lines[j]); j++) out.push(lines[j])
  return out.join('\n')
}

const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((s) => s.trim())
/** Таблица изменения: { iWas, iNow, rows } по строке заголовка с «было» и «стало»; нет — null. */
export function changeTable (body) {
  const lines = body.split('\n').filter((l) => /^\s*\|/.test(l))
  const hi = lines.findIndex((l) => /было/i.test(l) && /стало/i.test(l))
  if (hi < 0) return null
  const h = cellsOf(lines[hi])
  const iWas = h.findIndex((c) => /было/i.test(c))
  const iNow = h.findIndex((c) => /стало/i.test(c))
  const rows = lines.slice(hi + 1).filter((l) => !/^\s*\|\s*:?-{2,}/.test(l)).map(cellsOf)
  return { iWas, iNow, rows }
}
/** Имя поля в первой ячейке строки таблицы: первое `имя` в бэктиках, иначе первое латинское слово. */
const fieldOf = (cell) => ((cell || '').match(/`([A-Za-z_][A-Za-z0-9_.]*)`/) || (cell || '').match(/([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || null
const EMPTY_WAS = /^\s*(—|-|–|нет|отсутств[а-яё]*|пусто|не было)?\s*\.?\s*$/i

/** Ключи JSON-блоков текста. */
export function jsonKeys (text) {
  const blocks = (text.match(/```json[\s\S]*?```/g) || []).join('\n')
  return [...blocks.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)].map((m) => m[1])
}

// ─── из grade-bf.mjs (тот же режим, те же формулировки живых прогонов; импортировать нельзя — модуль исполняет CLI) ──
const RE_TYPE_BUGFIX = /багфикс|баг-фикс|bug ?fix|исправление дефекта|устранение дефекта|исправление ошибки/i
const RE_BOUNDS = /границ[аы] правки|остаются? неизменн|остаются? без изменени|без изменений остаются|должно остаться|не должн[оа] мен|не затрагива|(?<!не\s)оста[её]тся\s+прежн|(?<!не\s)остаются\s+прежн|(?<!не\s)оста[её]тся\s+как\s+было|(?<!не\s)остаются\s+как\s+было|(?<!не\s)прежним\s+образом|(?<!не\s)(?<!не\sдолжн[оаы]\s)остаться\s+прежн/i
const RE_DATA_ANSWERED = /испорчен|не портит|не портятся|пересч[а-яё]*[^.\n]{0,30}(не тр|нечего|не нужн)|данные не[^.\n]{0,20}(портит|затрагива|мен)|миграц[а-яё]*[^.\n]{0,40}не (нужн|требу)|таблицы не тр|не в данных|нет данных в хранилищ/i
const RE_STATUS_SPEC = /Статус готовности:\*{0,2}\s*(Готово к разработке|Требуются уточнения \(\d+\))/
const RE_STATUS_REPORT_VOCAB = /Статус готовности:\*{0,2}\s*Готово к оценке/
const RE_INVENTED_CAUSE = /race condition|двойн[оаы][ейм][^.\n]{0,20}(рендер|вызов)|вероятн[оая][^.\n]{0,40}из-за|предположительн[оая][^.\n]{0,40}причин|причина дефекта[^.\n]{0,40}(в том|заключа)/i
/** Причина этого дефекта, которую ни репорт, ни аналитик не называли: сравнение вместимости как строк. */
const RE_CAUSE_HERE = /лексикограф|сравн[а-яё]*\s+(?:их\s+)?(?:как\s+)?строк|строков[а-яё]*\s+сравнен|из-за\s+(?:того,\s+что\s+)?[^.\n]{0,40}строк[аио]/i
const RE_TRAP = /MTR-480/

export function grade (spec, kase) {
  const C = CASES[kase]
  const norm = normalizeSpecHeadings(spec)
  const cs = cards(spec)
  const card = changeCard(cs)
  const lines = card ? card.body.split('\n') : []
  const seam = seamOf(lines)
  const prov = lines.find((l) => /Происхождение/i.test(l)) || ''
  const trace = lines.find((l) => /Трассировк/i.test(l)) || ''
  const tbl = card ? changeTable(card.body) : null
  const keys = card ? jsonKeys(card.body) : []
  const s13 = section(norm, '1.3') || ''
  const srcLine = spec.split('\n').find((l) => /Источник\s*\(БТ\)/i.test(l)) || ''
  const s62 = section(norm, '6.2')
  const s7 = section(norm, '7') || ''
  const m = {}

  m['тип «багфикс»'] = RE_TYPE_BUGFIX.test(spec)
  m['источник — репорт, чужой MTR-480 не приписан'] = /bug_report\.md/.test(s13 + '\n' + srcLine) && !RE_TRAP.test(s13 + '\n' + srcLine)
  // Вид — по строке «Вид» (шаблон SKILL.md:789), а не по «Происхождению»: там то же слово стоит и у карточки другого вида.
  const vid = lines.find((l) => /(^|[^а-яё])Вид([^а-яё]|$)/i.test(l)) || ''
  m['карточка изменения есть (§2 не «не применимо»)'] = !!card && /изменени[ея]\s+существующ/i.test(vid)
  m['заголовок карточки 🟢'] = card?.mark === '🟢'
  m['«Происхождение» — одна метка 🟢 изменение'] = /🟢\s*изменение\s+существующ/i.test(prov) && !/🔵|🟡/.test(prov)
  m['стык: 🔵 и путь /v1/rooms'] = /🔵/.test(seam) && P_PATH.test(seam)
  if (kase === 'doc') {
    m['стык: источник — документ сверху, без «по карточке»/«со слов»'] = RE_DOC_LOOSE.test(seam) && !RE_CARD.test(seam) && !RE_WORDS.test(seam)
  } else {
    m['стык: источник — по карточке, без «документа сверху»/«со слов»'] = RE_CARD.test(seam) && !RE_DOC.test(seam) && !RE_WORDS.test(seam)
  }
  const capRow = tbl ? tbl.rows.find((r) => /capacity/.test(r[0] || '')) : null
  m['таблица: capacity было string → стало integer'] = !!capRow && /string|строк/i.test(capRow[tbl.iWas] || '') && /int|integer|цел|числ|number/i.test(capRow[tbl.iNow] || '')
  const foreignWas = tbl ? tbl.rows.filter((r) => fieldOf(r[0]) && !C.allowed.includes(fieldOf(r[0])) && !EMPTY_WAS.test(r[tbl.iWas] || '')) : []
  m['«было» только у полей источника'] = foreignWas.length === 0
  m['JSON: capacity числом'] = /"capacity"\s*:\s*\d/.test(card ? card.body : '')
  const foreignKeys = [...new Set(keys.filter((k) => !C.allowed.includes(k)))]
  m['JSON: поля только из источника'] = foreignKeys.length === 0
  m['FR-1 в «Трассировке» карточки'] = /FR-1(?!\d)/.test(trace)
  m['FR-1 в §7'] = /FR-1(?!\d)/.test(s7)
  m['§6.2: границы правки'] = !!s62 && RE_BOUNDS.test(s62)
  m['§6.2: прежний потребитель — табло'] = !!s62 && /lobby-display|табло/i.test(s62)
  m['про данные сказано'] = RE_DATA_ANSWERED.test(spec)
  m['статус из словаря спеки'] = RE_STATUS_SPEC.test(spec) && !RE_STATUS_REPORT_VOCAB.test(spec)
  m['причина не выдумана'] = !RE_INVENTED_CAUSE.test(spec) && !RE_CAUSE_HERE.test(spec)
  m['путь не под 🟡'] = !spec.split('\n').some((l) => /🟡/.test(l) && P_PATH.test(l))

  // справка — в критерий не входит
  m._ints = cs.length
  m._literal = kase === 'doc' ? RE_DOC.test(seam) : /services\/rooms-api\.md/.test(seam)
  m._fragment = /фрагмент/i.test(card ? card.body : '')
  m._prior = !!card && /floor/.test(card.body) && /name|roomId/.test(card.body)
  m._s2na = !card && /не\s+применимо[^\n]{0,120}(взаимодейств|контракт)/i.test(spec)
  m._foreign = [...foreignKeys, ...foreignWas.map((r) => fieldOf(r[0]))]
  m._status = (spec.match(/Статус готовности:\*{0,2}\s*([^\n]+)/) || [])[1] || '?'
  return m
}

const crit = (m) => Object.entries(m).filter(([k]) => !k.startsWith('_'))

// ─── Самопроверка ───────────────────────────────────────────────────────────────────────────

const REF = `# Техническая спецификация: вместимость числом

> **Задача:** MTR-512
> **Источник (БТ):** документ сверху — баг-репорт \`coddoc/MTR-512/bug_report.md\`
> **Статус готовности:** Готово к разработке

## 1. Обзор изменения
### 1.1. Что делаем и тип изменения
**Тип:** багфикс
### 1.3. Связь с бизнес-требованиями
FR-1 из \`coddoc/MTR-512/bug_report.md\`.

## 2. Взаимодействия (ядро)

### INT-1. Список переговорок: вместимость числом — 🟢
- **Вид:** изменение существующего
- **Существующий стык:** \`GET /v1/rooms\`, \`floor\` (число), \`capacity\` (строка) — 🔵 подтверждено аналитиком (по документу сверху; валидировать при интеграции)
- **Изменение:**

| поле | где | было | стало |
|------|-----|------|-------|
| \`capacity\` | ответ \`GET /v1/rooms\` | \`string\`, \`"12"\` | \`integer\`, \`12\` |

- **Пример ответа (успех):** фрагмент: прочие поля — без изменений.
  \`\`\`json
  { "roomId": "R-301", "name": "Байкал", "floor": 3, "capacity": 12 }
  \`\`\`
- **Происхождение:** 🟢 изменение существующего
- **Трассировка:** FR-1

### ~~Каталог ошибок (сводно) — последний подраздел §2, после всех INT-карточек~~
~~Не применимо: ошибки не меняются~~

## 3. Backend — ответственность
### 3.2. Данные и хранение
Баг ничего не портит, пересчитывать нечего.

## 6. Релиз и интеграция
### 6.2. Обратная совместимость
Границы правки — остаются прежними: остальные поля ответа. Табло lobby-display переживёт число.

## 7. Трассировка приёмки
| FR-1 | INT-1 | Дано … |`

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const sub = (a, b, t = REF) => { if (!t.includes(a)) throw new Error(`selftest: в эталоне нет «${a.slice(0, 50)}»`); return t.replace(a, b) }
  const missing = (t, k) => crit(grade(t, k)).filter(([, v]) => !v).map(([n]) => n)
  const green = (t, k) => missing(t, k).length === 0
  /** Мутация краснит РОВНО названные признаки — иначе «красный» мог прийти от соседнего признака. */
  const only = (n, t, k, want) => {
    const got = missing(t, k)
    const ok = got.length === want.length && want.every((w) => got.includes(w))
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${ok ? '' : `\n          красных: ${got.join(' | ') || 'нет'}\n          ожидалось: ${want.join(' | ')}`}`)
  }
  const SRC_DOC = 'стык: источник — документ сверху, без «по карточке»/«со слов»'
  const SRC_CARD = 'стык: источник — по карточке, без «документа сверху»/«со слов»'
  const CARD = sub('по документу сверху; валидировать', 'по карточке services/rooms-api.md; валидировать').replaceAll('MTR-512', 'MTR-513')

  only('doc: эталон зелёный', REF, 'doc', [])
  only('card: эталон зелёный', CARD, 'card', [])
  ck('doc: «по баг-репорту» вместо дословного — зелёный, справка «не дословно»', (() => { const t = sub('по документу сверху;', 'по баг-репорту coddoc/MTR-512/bug_report.md;'); return green(t, 'doc') && !grade(t, 'doc')._literal })(), true)
  only('doc: стык «по карточке» без карточки', sub('по документу сверху;', 'по карточке services/rooms-api.md;'), 'doc', [SRC_DOC])
  only('doc: стык «со слов»', sub('по документу сверху;', 'со слов;'), 'doc', [SRC_DOC])
  only('doc: стык «по документу сверху; со слов» (смешанная)', sub('по документу сверху;', 'по документу сверху, со слов;'), 'doc', [SRC_DOC])
  only('doc: стык 🟡 без пути', sub('`GET /v1/rooms`, `floor` (число), `capacity` (строка) — 🔵 подтверждено аналитиком (по документу сверху; валидировать при интеграции)', 'ответ списка — 🟡 к валидации'), 'doc', ['стык: 🔵 и путь /v1/rooms', SRC_DOC])
  only('doc: путь не в стыке, а в «Контракте»', sub('- **Существующий стык:** `GET /v1/rooms`, ', '- **Контракт (запрос):** `GET /v1/rooms`\n- **Существующий стык:** ответ списка, '), 'doc', ['стык: 🔵 и путь /v1/rooms'])
  only('doc: метка и путь стыка на двух строках одного пункта — зелёный', sub('- **Существующий стык:** `GET /v1/rooms`, `floor` (число), `capacity` (строка) — 🔵', '- **Существующий стык:**\n  `GET /v1/rooms`, `floor` (число), `capacity` (строка)\n  — 🔵'), 'doc', [])
  only('doc: «Существующий стык» упомянут раньше пункта — берётся пункт', sub('- **Вид:** изменение существующего', '- **Вид:** изменение существующего (см. «Существующий стык» ниже)'), 'doc', [])
  only('card: стык «по документу сверху»', REF.replaceAll('MTR-512', 'MTR-513'), 'card', [SRC_CARD])
  ck('§2 «не применимо» вместо карточки — красный, справка _s2na', (() => {
    const t = REF.replace(/### INT-1[\s\S]*?(?=### ~~Каталог)/, '~~Не применимо: новых/изменённых взаимодействий нет; правка внутри rooms-api~~\n\n')
    const g = grade(t, 'doc'); return !green(t, 'doc') && g._s2na && missing(t, 'doc').includes('карточка изменения есть (§2 не «не применимо»)')
  })(), true)
  only('вид «потребление», заголовок 🔵', sub('### INT-1. Список переговорок: вместимость числом — 🟢\n- **Вид:** изменение существующего', '### INT-1. Список переговорок: вместимость числом — 🔵\n- **Вид:** потребление существующего'), 'doc', ['карточка изменения есть (§2 не «не применимо»)', 'заголовок карточки 🟢'])
  only('«Происхождение» с двумя метками', sub('- **Происхождение:** 🟢 изменение существующего', '- **Происхождение:** 🟢 изменение существующего; стык 🔵 по документу сверху'), 'doc', ['«Происхождение» — одна метка 🟢 изменение'])
  only('таблица без «было» string', sub('| `string`, `"12"` |', '| — |'), 'doc', ['таблица: capacity было string → стало integer'])
  only('«было» у поля не из источника (equipment)', sub('| `integer`, `12` |\n', '| `integer`, `12` |\n| `equipment` | ответ | `string[]` | `string[]` |\n'), 'doc', ['«было» только у полей источника'])
  only('новое поле с «было» = «—» — не красное', sub('| `integer`, `12` |\n', '| `integer`, `12` |\n| `seats` | ответ | — | `integer` |\n'), 'doc', [])
  only('JSON с выдуманным полем items', sub('{ "roomId": "R-301", "name": "Байкал", "floor": 3, "capacity": 12 }', '{ "items": [ { "roomId": "R-301", "capacity": 12 } ] }'), 'doc', ['JSON: поля только из источника'])
  only('JSON с capacity строкой', sub('"capacity": 12 }', '"capacity": "12" }'), 'doc', ['JSON: capacity числом'])
  only('FR-1 нет в «Трассировке» карточки', sub('- **Трассировка:** FR-1', '- **Трассировка:** —'), 'doc', ['FR-1 в «Трассировке» карточки'])
  only('§6.2 без табло', sub(' Табло lobby-display переживёт число.', ''), 'doc', ['§6.2: прежний потребитель — табло'])
  only('§6.2 без границ', sub('Границы правки — остаются прежними: остальные поля ответа.', 'Ломается ли что-то — нет.'), 'doc', ['§6.2: границы правки'])
  only('§1.3 ссылается на MTR-480', sub('FR-1 из `coddoc/MTR-512/bug_report.md`.', 'FR-1 из `coddoc/MTR-512/bug_report.md`; поведение табло — по MTR-480.'), 'doc', ['источник — репорт, чужой MTR-480 не приписан'])
  only('MTR-480 вне §1.3 и шапки — не красное', sub(' Табло lobby-display переживёт число.', ' Табло lobby-display (MTR-480 — другая задача) переживёт число.'), 'doc', [])
  only('выдуманная причина «сравнивает как строки»', sub('Баг ничего не портит', 'Фильтр сравнивает их как строки. Баг ничего не портит'), 'doc', ['причина не выдумана'])
  ck('выдуманная причина «из-за того, что вместимость строкой» ловится', RE_CAUSE_HERE.test('Пропадают из-за того, что вместимость приходит строкой.'), true)
  ck('«было string» в таблице причиной не считается', RE_CAUSE_HERE.test('| `capacity` | ответ | `string`, `"12"` | `integer` |'), false)
  ck('«вместо строки» в «Сути» причиной не считается', RE_CAUSE_HERE.test('rooms-api начинает отдавать `capacity` целым числом вместо строки'), false)
  only('путь под 🟡', REF + '\n- 🟡 к валидации: `GET /v1/rooms` отдаёт ещё что-то', 'doc', ['путь не под 🟡'])
  only('статус словарём репорта', sub('Готово к разработке', 'Готово к оценке'), 'doc', ['статус из словаря спеки'])
  only('тип не назван', sub('**Тип:** багфикс', '**Тип:** доработка'), 'doc', ['тип «багфикс»'])
  only('про данные не сказано', sub('Баг ничего не портит, пересчитывать нечего.', 'Новых сущностей нет.'), 'doc', ['про данные сказано'])
  // фикстура BFX-DOWN: рукопись (после замены — замороженный выход) обязана быть зелёной по doc, иначе вход приёмки и разреза не тот
  const down = read(join(HERE, 'fixtures/BFX-DOWN/coddoc/MTR-512/technical_specification.md'))
  if (down) {
    only('фикстура BFX-DOWN MTR-512 — зелёная по doc', down, 'doc', [])
    ck('фикстура BFX-DOWN MTR-512 — «по документу сверху» дословно', grade(down, 'doc')._literal, true)
  }
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

// ─── CLI ────────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES[kase]) { console.error('usage: node grade-bfx-spec.mjs <каталог плеча> --case=doc|card | --selftest'); process.exit(1) }
const REL = `coddoc/${CASES[kase].key}/technical_specification.md`
const RE_CLAIMS_WROTE = /technical_specification\.md|спек[ауи][^.\n]{0,40}(готов|написал|записал)|файл готов/i
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба bfx-${kase}, ${arg}`)
let measured = 0; let green = 0
const fails = {}
const note = { literal: 0, fragment: 0, prior: 0, s2na: 0 }
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО (отказ API)`); continue }
  if (existsSync(join(dir, '_escaped.txt'))) { console.log(`  ${n}: НЕ ИЗМЕРЕНО (побег из песочницы, метка check-escape)`); continue }
  measured++
  const spec = read(join(dir, REL))
  if (!spec) {
    const why = RE_CLAIMS_WROTE.test(t1.answer || '') ? 'спеки нет, отчёт утверждает запись (фантом или побег)' : 'спеки нет'
    console.log(`  ${n}: красный  ${why}`); fails['спеки нет'] = (fails['спеки нет'] || 0) + 1; continue
  }
  const m = grade(spec, kase)
  if (existsSync(join(dir, `coddoc/${CASES[kase].key}/business_requirements.md`))) m['лишний документ не написан'] = false
  const bad = crit(m).filter(([, v]) => !v).map(([k]) => k)
  for (const b of bad) fails[b] = (fails[b] || 0) + 1
  if (!bad.length) green++
  if (m._literal) note.literal++
  if (m._fragment) note.fragment++
  if (m._prior) note.prior++
  if (m._s2na) note.s2na++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · INT ${m._ints} · статус ${m._status.trim().slice(0, 30)}${m._foreign.length ? ' · чужие поля: ' + m._foreign.join(', ') : ''}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
}
console.log(`\n  по признакам (прогонов с промахом): ${Object.entries(fails).map(([k, v]) => `${k} ${v}`).join('; ') || 'нет'}`)
console.log(`  справка: ${kase === 'doc' ? '«по документу сверху» дословно' : 'путь карточки в метке'} ${note.literal}/${measured}; JSON подписан «фрагмент» ${note.fragment}/${measured}; прежние поля в карточке ${note.prior}/${measured}; §2 закрыта «не применимо» ${note.s2na}/${measured}`)
console.log(`  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
