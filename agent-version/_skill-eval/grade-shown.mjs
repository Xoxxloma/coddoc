#!/usr/bin/env node
// grade-shown.mjs — показ 🟢 на «годится» до записи (technical-spec-doc 2.6.0: дерево «не показал — ❓», гейты 7а/7б).
//
//   node grade-shown.mjs <папка-плеча> [--sub=stage-2/run-1] [--fields=<поле,поле,…> — названные аналитиком]
//
// Без самоотчёта агента (реестр не читается): текст агента ходов ДО записи спеки берётся из stream*.jsonl (все
// текстовые блоки, не только итоговый result хода), спека — с диска.
// - ход записи — первый Write/Edit с file_path …technical_specification.md или Bash с `>`/`tee` в этот файл;
// - показано до записи: пути (любой токен `/…`, сверка по пути без метода), ```json, строки таблиц полей
//   (`| Поле |`), пункты `- \`имя\` —`, ключи JSON;
// - в спеке: 🟢-карточки §2 (заголовок `INT-N` с 🟢 где угодно, в т.ч. «🟢И / 🟡») и 🟢-сущности §3.2 (у 🟢И — только
//   строки «новое»/«стало»); таблицы под сущностью, кроме `| Поле |` (индексы, переходы), не считаются полями;
// - КРАСНОЕ: 🟢-карточка, ни одного пути которой нет в ходах до записи (карточка без пути — по упоминанию INT-N,
//   слабая проверка); 🟢-сущность без показанных полей; поля сущности сверх показанных и --fields; запись в ходе 1
//   при 🟢 в спеке.
// Не видит: имена полей из документа сверху и реплик двойника (кроме --fields) — такие «лишние» сверять руками.
// Эмодзи — только в JS (в Git Bash grep их не находит).

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GREEN = /\u{1F7E2}/u
const ID = '[A-Za-zА-Яа-яЁё_][\\wА-Яа-яЁё]*'
const PATH_TOKEN = /(?:^|[\s`|(«"'])(\/[A-Za-z0-9_{}:.\-/]*[A-Za-z0-9_}])/g

const normPath = (p) => p.replace(/`/g, '').replace(/\{[^}]*\}|:\w+/g, '{}').replace(/[.:,;)]+$/, '').replace(/\/+$/, '').toLowerCase()

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return null
}

function isSpecWrite (x) {
  if (!x || x.type !== 'tool_use') return false
  const inp = x.input || {}
  if ((x.name === 'Write' || x.name === 'Edit' || x.name === 'MultiEdit') && /technical_specification\.md$/.test(inp.file_path || '')) return true
  if (x.name === 'Bash' && /(>|\btee\b)[^\n]*technical_specification\.md/.test(inp.command || '')) return true
  return false
}

export function beforeWrite (dir) {
  const st = readdirSync(dir).filter((x) => /^stream(-\d+)?\.jsonl$/.test(x))
    .sort((a, b) => (a === 'stream.jsonl' ? -1 : b === 'stream.jsonl' ? 1 : a.localeCompare(b, 'en', { numeric: true })))
  const texts = []
  let wroteAt = null
  let turns = 0
  for (let t = 0; t < st.length && wroteAt === null; t++) {
    const turnText = []
    for (const line of readFileSync(join(dir, st[t]), 'utf8').split('\n')) {
      let j
      try { j = JSON.parse(line) } catch { continue }
      if (j.type !== 'assistant' || !j.message || !Array.isArray(j.message.content)) continue
      for (const c of j.message.content) {
        if (isSpecWrite(c)) { wroteAt = t + 1; break }
        if (c.type === 'text' && c.text) turnText.push(c.text)
      }
      if (wroteAt !== null) break
    }
    if (wroteAt === null) { texts.push(turnText.join('\n\n')); turns++ }
  }
  return { text: texts.join('\n\n'), turns, wroteAt }
}

export function shownFields (text) {
  const out = new Set()
  let inFieldTable = false
  for (const line of text.split('\n')) {
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|\s*\**(Поле|Field|Параметр)\**\s*\|/i.test(line)) { inFieldTable = true; continue }
      const cell = line.match(new RegExp(`^\\s*\\|\\s*\`?(${ID}(?:\\[\\])?(?:\\.${ID})*)\`?\\s*\\|`))
      if (inFieldTable && cell) out.add(cell[1].replace(/\[\]/g, '').split('.').pop().toLowerCase())
    } else if (line.trim()) inFieldTable = false
    const li = line.match(new RegExp(`^\\s*[-*]\\s*\`(${ID})\`\\s*[—:(–-]`))
    if (li) out.add(li[1].toLowerCase())
  }
  for (const m of text.matchAll(new RegExp(`"(${ID})"\\s*:`, 'g'))) out.add(m[1].toLowerCase())
  // Поля перечислением и в прозе: любое имя в обратных кавычках — `name`, `name: тип`, `a.b`, `name?` (пилот 26.11:
  // «поля: `id`, `appId`, …» и «- `auto_create_users: bool` —» давали ложное красное).
  for (const m of text.matchAll(new RegExp('`(' + ID + '(?:\\.' + ID + ')*)[?]?(?:\\s*[:(][^`]*)?`', 'g'))) out.add(m[1].split('.').pop().toLowerCase())
  // Несколько полей в одной паре обратных кавычек: `id, employeeId, pickupAt(UTC), status(enum: A|B), comment?` и
  // `{officeId, pickupAt: "…", phone}` — имя в начале каждого куска между запятыми и скобками.
  // Пары кавычек берём подряд, запятую проверяем внутри: иначе «`Имя` (новая, …): `a, b`» спаривается через границу.
  for (const m of text.matchAll(/`([^`\n]*)`/g)) {
    if (!m[1].includes(',')) continue
    const flat = m[1].replace(/"[^"]*"/g, '').replace(/\([^)]*\)/g, '')
    for (const piece of flat.split(/[,{}[\]]/)) {
      const id = piece.match(new RegExp('^\\s*(' + ID + '(?:\\.' + ID + ')*)\\s*[?]?\\s*(?::|$)'))
      if (id) out.add(id[1].split('.').pop().toLowerCase())
    }
  }
  return out
}

// Путь показан и тогда, когда в ходе он без префикса версии (`/car-requests/{}/confirm` против
// `/api/v1/car-requests/{}/confirm` в файле) или наоборот: совпадение хвоста от двух сегментов.
export function pathShown (p, shown) {
  if (shown.has(p)) return true
  for (const s of shown) {
    if (s.split('/').length < 3) continue
    if (p.endsWith(s) || s.endsWith(p)) return true
  }
  return false
}

export function specGreen (spec) {
  const s = spec.replace(/\r/g, '')
  const cards = []
  const sec2 = (s.match(/\n## 2\.[^\n]*\n([\s\S]*?)\n## 3\./) || [null, ''])[1]
  for (const block of sec2.split(/\n(?=#{2,5}\s)/)) {
    const h = block.match(/^#{2,5}\s*\**(INT-\d+)[^\n]*/)
    if (!h) continue
    const green = GREEN.test(h[0]) || /Происхождение[^\n]*\u{1F7E2}/u.test(block)
    if (!green) continue
    const paths = [...block.matchAll(PATH_TOKEN)].map((m) => normPath(m[1])).filter((p) => p.length > 1)
    cards.push({ id: h[1], paths: [...new Set(paths)] })
  }
  const ents = []
  const sec32 = (s.match(/\n### ~*3\.2\.[^\n]*\n([\s\S]*?)\n### ~*3\.3/) || [null, ''])[1]
  let cur = null
  let inFields = false
  for (const raw of sec32.split('\n')) {
    const line = raw.replace(/\\\|/g, '¦')
    const e = line.match(/^(?:-|#{3,5})\s*(?:\*\*)?`?\[?((?:\u{1F7E2}|\u{1F535}|\u{1F7E1}|❓)[^`\]*]*?)\]?`?(?:\*\*)?\s*(?:\*\*)?`([^`]+)`/u)
    if (e && !/индекс/i.test(line)) {
      cur = GREEN.test(e[1]) ? { mark: e[1].trim(), name: e[2], changed: /И|изм/i.test(e[1]), fields: [] } : null
      if (cur) ents.push(cur)
      inFields = false
      continue
    }
    if (!cur) continue
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|\s*\**(Поле|Field)\**\s*\|/i.test(line)) { inFields = true; continue }
      if (!inFields || /^\s*\|[-\s|:]+\|\s*$/.test(line)) continue
      if (cur.changed && !/новое|стало/i.test(line)) continue
      const cell = line.match(new RegExp(`^\\s*\\|\\s*\`?(${ID})\`?\\s*\\|`))
      if (cell) cur.fields.push(cell[1])
    } else if (line.trim()) inFields = false
  }
  return { cards, ents }
}

// Вопросы до записи по теме (критерий владельца 26.11: без спама по каждому стыку, вопрос по БД есть). Вопрос — строка с «?»
// вне кода; тема — по строке и до двух строк перед ней (сводка стоит над вопросом). Стыки: по одной карточке — в
// окне ровно один `INT-N`; сводкой — два и больше или «стыки/карточки/контракты» во множественном. Данные — поля, таблица, БД.
const Q_INT = /INT-\d|стык|ручк|эндпоинт|endpoint|контракт|карточк|\b(GET|POST|PUT|PATCH|DELETE)\b/i
const Q_DATA = /табли|(^|[^а-яё])пол[яей]([^а-яё]|$)|сущност|хранен|(^|[^а-яё])БД([^а-яё]|$)|баз[аеуы] данн|миграц|колон/i
export function classifyQuestions (text) {
  const lines = text.replace(/```[\s\S]*?```/g, '').split('\n')
  const out = { int: 0, intPerCard: 0, intSummary: 0, data: 0, dataFields: 0, other: 0 }
  lines.forEach((l, i) => {
    if (!/\?/.test(l.replace(/`[^`]*`/g, ''))) return
    const win = lines.slice(Math.max(0, i - 2), i + 1).join('\n')
    const ints = new Set(win.match(/INT-\d+/g) || [])
    if (Q_INT.test(l) || (ints.size && Q_INT.test(win))) {
      out.int++
      if (ints.size === 1 && !/стыки|карточки|контракты|все\s/i.test(l)) out.intPerCard++
      else out.intSummary++
    } else if (Q_DATA.test(win)) {
      out.data++
      if (/\|\s*\**(Поле|Field)\**\s*\|/i.test(lines.slice(Math.max(0, i - 25), i + 1).join('\n')) || /пол[яей]/i.test(l)) out.dataFields++
    } else out.other++
  })
  return out
}

export function gradeRun (dir, o) {
  const r = { run: dir }
  if (!existsSync(join(dir, 'stream.jsonl')) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) { r.measured = false; return r }
  r.measured = true
  const b = beforeWrite(dir)
  r.turns = b.turns
  r.wroteAt = b.wroteAt
  r.q = (b.text.replace(/`[^`]*`/g, '').match(/\?/g) || []).length
  r.qs = classifyQuestions(b.text)
  const shownPaths = new Set([...b.text.matchAll(PATH_TOKEN)].map((m) => normPath(m[1])))
  r.shownJson = (b.text.match(/```json/g) || []).length
  const fieldsShown = shownFields(b.text)
  r.shownFieldTables = (b.text.match(/^\s*\|\s*\**(Поле|Field)\**\s*\|/gim) || []).length
  const f = findSpec(dir)
  r.file = !!f
  r.red = []
  if (!f) return r
  const g = specGreen(readFileSync(f, 'utf8'))
  r.greenCards = g.cards.length
  r.greenEnts = g.ents.length
  r.cardsShown = 0
  for (const c of g.cards) {
    const ok = c.paths.length ? c.paths.some((p) => pathShown(p, shownPaths)) : new RegExp(`${c.id}\\b`).test(b.text)
    if (ok) r.cardsShown++
    else r.red.push(`🟢 ${c.id} в спеке, ${c.paths.length ? 'ни одного пути (' + c.paths.slice(0, 3).join(', ') + ')' : 'упоминания'} нет в ходах до записи`)
  }
  r.entsShown = 0
  const said = new Set((o.fields || []).map((x) => x.toLowerCase()))
  for (const e of g.ents) {
    const low = e.fields.map((x) => x.toLowerCase())
    const anyShown = low.some((x) => fieldsShown.has(x) || said.has(x))
    const extra = e.fields.filter((x, i) => !fieldsShown.has(low[i]) && !said.has(low[i]))
    if (anyShown) r.entsShown++
    if (!anyShown && e.fields.length) r.red.push(`🟢 сущность ${e.name}: полей (${e.fields.length}) нет в ходах до записи`)
    else if (extra.length) r.red.push(`🟢 сущность ${e.name}: поля сверх показанных и названных аналитиком (сверить с документом сверху руками): ${extra.join(', ')}`)
  }
  if (b.wroteAt === 1 && (g.cards.length || g.ents.length)) r.red.push('спека записана в ходе 1 при 🟢 в спеке')
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3)
  const arm = process.argv[2]
  if (!arm) { console.error('usage: node grade-shown.mjs <папка-плеча> [--sub=..] [--fields=a,b,..]'); process.exit(1) }
  const o = { fields: arg('fields') ? arg('fields').split(',') : null }
  const sub = arg('sub')
  console.log('прогон | ходов до записи | запись на ходе | «?» до записи | json показано | таблиц полей показано | 🟢 INT: показано | 🟢 сущностей: показано | красное')
  console.log('   вопросы: стыки (по карточке / сводкой) | данные (с полями) | прочее')
  for (const d of readdirSync(arm).filter((x) => /^run-\d+$/.test(x)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const r = gradeRun(join(arm, d, sub), o)
    if (!r.measured) { console.log(`${d} | не измерен`); continue }
    const head = [d, r.turns, r.wroteAt ?? '—', r.q, `${r.shownJson} json`, r.shownFieldTables]
    if (!r.file) { console.log([...head, 'спеки нет'].join(' | ')); continue }
    console.log([...head, `${r.cardsShown}/${r.greenCards}`, `${r.entsShown}/${r.greenEnts}`, r.red.length ? 'КРАСНОЕ ' + r.red.length : '—'].join(' | '))
    for (const x of r.red) console.log(`   КРАСНОЕ: ${x}`)
    console.log(`   вопросы: стыки ${r.qs.int} (${r.qs.intPerCard} / ${r.qs.intSummary}) | данные ${r.qs.data} (${r.qs.dataFields}) | прочее ${r.qs.other}`)
  }
}
