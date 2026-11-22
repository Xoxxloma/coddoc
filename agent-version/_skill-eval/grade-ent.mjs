#!/usr/bin/env node
// grade-ent.mjs — 5.133 (`technical-spec-doc` 2.4.0): поля сущностей §3.2 «Данные и хранение» таблицей.
//
//   node grade-ent.mjs --case=gaps|gaps-src|ctx|fix|sb|rv <каталог плеча> [<каталог плеча> …]
//   node grade-ent.mjs --selftest
//
// Плечо — каталог с run-N. Старое плечо той же пробы передаётся рядом — счётчики печатаются по каждому плечу,
// это и есть сверка «до/после». Разбор понимает обе формы §3.2: строку (`` `id` (uuid), … ``, вложенные пункты)
// и таблицу под пунктом сущности.
//
// Кейсы:
//   gaps      — TS-GAPS: у `offices` полей в источнике нет → в таблице только `timezone` («новое»); прочие поля,
//               кроме `id`, — выдумка.
//   gaps-src  — TS-GAPS-SRC: аналитик назвал `id`, `name`, `city` → все три + `timezone` («новое»); сверх — выдумка.
//   ctx       — TS-CTX: новая сущность журнала таблицей с типами; у `Инцидент` полей сверх `id`/`incidentId` нет.
//   fix       — TS-FIX: 12 полей `VisitorPass` из засева с типом и обязательностью на месте + `withdrawnAt`.
//               Старая таблица в 4 колонки — норма; красный — только потеря поля, типа или обязательности.
//   sb        — SB-SET-T: `bikeRack` с типом `boolean` дошёл до файла этапа.
//   rv        — RV-CLEAN-T: приёмка не называет сущность §3.2 «без пометки».

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MARK_RE = /🟢|🔵|🟡|❓/
const REST_RE = /остальн\S*\s+(?:прежн\S*\s+)?пол\S*\s+не\s+меня/i
const NEW_RE = /нов(?:ое|ый|ая)|добавл/i

// ─── Разбор ─────────────────────────────────────────────────────────────────

export function section32(text) {
  const ls = text.split(/\r?\n/)
  const start = ls.findIndex((l) => /^#{2,4}\s+(?:~~)?\s*(?:3\.2\.?\s|.*Данные\s+и\s+хранение)/.test(l))
  if (start < 0) return null
  let end = ls.length
  for (let i = start + 1; i < ls.length; i += 1) if (/^#{1,3}\s/.test(ls[i])) { end = i; break }
  const out = []
  let fence = false
  for (const l of ls.slice(start + 1, end)) {
    if (/^\s*```/.test(l)) { fence = !fence; continue }
    if (!fence) out.push(l)
  }
  return out
}

const cellsOf = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim())
const clean = (s) => s.replace(/[`*]/g, '').replace(/\\\|/g, '|').trim()
const isSep = (l) => /^\s*\|\s*:?-{2,}/.test(l)
const isRow = (l) => /^\s*\|/.test(l)

function markOf(head) {
  const m = head.match(MARK_RE)
  if (!m) return null
  return { '🟢': 'new', '🔵': 'blue', '🟡': 'yellow', '❓': 'q' }[m[0]]
}

function isHead(l) {
  if (/^[-*]\s+/.test(l)) return true
  if (/^#{4,6}\s+/.test(l)) return true
  if (/^(\*\*)?\s*\[?(🟢|🔵|🟡|❓)/.test(l)) return true
  if (/^(\*\*)?Нов\S*\s+сущност\S*\s+`/.test(l)) return true
  return false
}

function headName(head) {
  const t = head.replace(/^[-*#\s]+/, '').replace(/\[?(🟢|🔵|🟡|❓)[^\]\s`]*\]?\s*/g, '')
  const b = t.replace(/``/g, '').match(/`([^`\s][^`]*)`/) || t.match(/\*\*([^*]+)\*\*/)
  if (b) return b[1].replace(/^Таблица\s+/i, '').trim()
  return t.replace(/\[?(🟢|🔵|🟡|❓)\S*\]?/g, '').split(/\s[—–-]\s/)[0].trim()
}

/** Поля из строки/вложенных пунктов старой формы. Грубо: имя в бэктиках + тип в скобках или после двоеточия. */
function inlineFields(text, entName) {
  const out = []
  const seen = new Set()
  const add = (name, type) => {
    if (!name || name === entName || seen.has(name) || /\s/.test(name) || !/^[\w.[\]]+$/.test(name)) return
    seen.add(name); out.push({ name, type: (type || '').trim(), desc: '', oblig: null })
  }
  for (const m of text.matchAll(/`([\w.[\]]+):\s*([^`]+)`/g)) add(m[1], m[2])
  for (const m of text.matchAll(/`([\w.[\]]+)`\s*(?:\(([^)]*)\)|:\s*([A-Za-zА-Яа-яё][\w|<>\- ]*)|\s+([a-z][\w|]*)\b)/g)) {
    add(m[1], m[2] ?? m[3] ?? m[4])
  }
  return out
}

export function parseEntities(sec) {
  const ents = []
  let cur = null
  const flush = () => { if (cur) ents.push(finish(cur)) }
  for (const l of sec) {
    // Старая форма: поля пунктами верхнего уровня сразу под сущностью с пометкой — это поля, не сущности.
    const fieldBullet = /^[-*]\s+`[\w.[\]]+`/.test(l) && !MARK_RE.test(l) && cur && MARK_RE.test(cur.head)
    if (!isRow(l) && isHead(l) && !/^\s/.test(l) && !fieldBullet) {
      const name = headName(l)
      const group = !/`/.test(l) && /сущност|индекс|миграц/i.test(name)
      if (!group && (MARK_RE.test(l) || /`/.test(l))) { flush(); cur = { head: l, name, lines: [] }; continue }
    }
    if (cur) cur.lines.push(l)
  }
  flush()
  return ents
}

function finish(e) {
  const fields = []
  let hdr = null
  let fieldHdr = null // шапка таблицы полей — не последней таблицы (под сущностью бывает таблица заполнения)
  let cols = null
  let prevRow = false
  for (const l of e.lines) {
    if (!isRow(l)) { prevRow = false; continue }
    if (isSep(l)) { prevRow = true; continue }
    const cells = cellsOf(l)
    if (!prevRow) { // первая строка таблицы — шапка
      hdr = cells.map((c) => clean(c))
      const find = (re, d) => { const i = hdr.findIndex((h) => re.test(h)); return i < 0 ? d : i }
      // Тип: столбец «Тип»; нет его — «Было»/«Стало» таблицы изменения; нет и их — типа нет (-1).
      cols = {
        name: find(/Поле|Field|Имя/i, 0), type: find(/Тип|Type/i, -1), was: find(/^Было/i, -1), now: find(/^Стало/i, -1),
        desc: find(/Описан|Назнач|Примечан|Смысл/i, -1), oblig: find(/Обяз/i, -1),
      }
      if (cols.desc < 0) cols.desc = cols.now >= 0 ? cols.now : hdr.length - 1
      prevRow = true
      continue
    }
    prevRow = true
    const name = clean(cells[cols.name] ?? '')
    // Строка без имени-идентификатора — не поле: «остальные поля | не меняются», таблица заполнения «Москва | …».
    if (!/^[A-Za-z_][\w.[\]]*(\s*[,/]\s*[A-Za-z_][\w.[\]]*)*$/.test(name)) { if (REST_RE.test(l) || /остальн/i.test(name)) e.restRow = true; continue }
    const cell = (i) => (i >= 0 ? clean(cells[i] ?? '') : '')
    fieldHdr ??= hdr
    fields.push({
      name,
      type: cols.type >= 0 ? cell(cols.type) : `${cell(cols.was)} ${cell(cols.now)}`.trim(),
      desc: cell(cols.desc),
      oblig: cols.oblig >= 0 ? cell(cols.oblig) : null,
      row: clean(l),
    })
  }
  const table = fields.length > 0
  const nested = e.lines.filter((l) => /^\s*[-*]\s+/.test(l)).join('\n')
  const inl = table ? [] : inlineFields(`${e.head}\n${nested}`, e.name)
  const block = [e.head, ...e.lines].join('\n')
  return {
    head: e.head.trim(), name: e.name, mark: markOf(e.head), codes: e.head.match(/(🟢|🔵)[А-ЯA-Zа-яд#0-9]*/g) || [],
    form: table ? 'table' : (inl.length ? 'inline' : 'none'),
    cols: table ? fieldHdr : null,
    fields: table ? fields : inl,
    rest: REST_RE.test(block) || !!e.restRow,
  }
}

// ─── Файлы прогона ──────────────────────────────────────────────────────────

function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === '.claude' || n === '_skills' || n.startsWith('.git')) continue
    const p = join(dir, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, pred, out)
    else if (pred(p)) out.push(p)
  }
  return out
}

const specOf = (run) => walk(run, (p) => /[\\/](coddoc|docs)[\\/].*technical_specification\.md$/.test(p))[0] ?? null

// ─── Проверки ───────────────────────────────────────────────────────────────

/** Из одноимённых пунктов — с полями (остаток старой формы «Новая сущность `X`:» над пунктом — не сущность). */
const best = (xs) => xs.reduce((a, e) => (!a || e.fields.length > a.fields.length ? e : a), null)
const OFFICE = (e) => /offic|офис/i.test(e.name)
const TZ = (f) => /time_?zone|^tz$|часов/i.test(f.name)

function common(ents) {
  const withFields = ents.filter((e) => e.fields.length)
  return {
    ents: ents.length,
    own: ents.filter((e) => e.mark === 'new').length,
    fields: ents.reduce((a, e) => a + e.fields.length, 0),
    inline: withFields.filter((e) => e.form === 'inline').map((e) => e.name),
    untyped: ents.flatMap((e) => e.fields.filter((f) => !f.type || /^(—|-|\.\.\.)$/.test(f.type)).map((f) => `${e.name}.${f.name}`)),
    unmarked: ents.filter((e) => !e.mark).map((e) => e.name),
  }
}

function gradeSpec(kase, text) {
  const sec = section32(text)
  if (!sec) return { measured: false, why: 'нет §3.2' }
  const ents = parseEntities(sec)
  const c = common(ents)
  const r = { measured: true, c, ents, notes: [] }
  if (kase === 'gaps' || kase === 'gaps-src') {
    const off = best(ents.filter(OFFICE))
    if (!off) { r.green = false; r.notes.push('офисов в §3.2 нет'); return r }
    const tz = off.fields.find(TZ)
    const allowed = kase === 'gaps' ? [/^id$/i] : [/^id$/i, /^name$|title|назв/i, /^city$|город/i]
    const extra = off.fields.filter((f) => !TZ(f) && !allowed.some((re) => re.test(f.name))).map((f) => f.name)
    r.office = { form: off.form, cols: off.cols, fields: off.fields.map((f) => f.name), tz: !!tz, tzNew: !!tz && (NEW_RE.test(tz.row ?? `${tz.desc} ${tz.type}`) || /не\s+было/i.test(tz.row ?? '')), extra, rest: off.rest, codes: off.codes }
    if (kase === 'gaps-src') {
      const need = allowed.map((re) => off.fields.some((f) => re.test(f.name)))
      r.office.src = need.every(Boolean)
      r.office.priorMarkedNew = off.fields.filter((f) => !TZ(f) && NEW_RE.test(f.desc)).map((f) => f.name)
      r.office.blueCode = /🔵/.test(off.head)
    }
    r.green = !!tz && r.office.tzNew && extra.length === 0 && (kase === 'gaps' || r.office.src)
    return r
  }
  if (kase === 'ctx') {
    const log = best(ents.filter((e) => /notif|log|журнал|attempt|попыт/i.test(e.name)))
    const inc = ents.find((e) => /incident|инцидент/i.test(e.name) && !/notif|log|журнал/i.test(e.name))
    r.log = log ? { form: log.form, fields: log.fields.map((f) => `${f.name}:${f.type}`), untyped: log.fields.filter((f) => !f.type).length } : null
    r.incExtra = inc ? inc.fields.filter((f) => !/^(id|incidentId|incident_id)$/i.test(f.name)).map((f) => f.name) : []
    r.green = !!log && log.fields.length >= 3 && r.log.untyped === 0 && r.incExtra.length === 0
    return r
  }
  if (kase === 'fix') {
    const vp = best(ents.filter((e) => /VisitorPass/i.test(e.name))) ?? (ents.length === 0 ? parseLooseVisitorPass(sec) : null)
    if (!vp) { r.green = false; r.notes.push('VisitorPass в §3.2 нет'); return r }
    const lost = []
    for (const [name, type, req] of SEED_VP) {
      const f = vp.fields.find((x) => x.name === name)
      if (!f) { lost.push(`${name}: нет`); continue }
      if (!TYPE_OK[type](f.type)) lost.push(`${name}: тип «${f.type}»`)
      const opt = f.oblig != null ? /^нет|необяз|no/i.test(f.oblig) : /null|необяз|nullable|опцион/i.test(`${f.type} ${f.desc}`)
      if (req && opt) lost.push(`${name}: стало необязательным`)
      if (!req && !opt) lost.push(`${name}: обязательность «нет» потеряна`)
    }
    r.vp = { form: vp.form, cols: vp.cols, n: vp.fields.length, lost, withdrawnAt: vp.fields.some((f) => /withdrawn/i.test(f.name)) }
    r.green = lost.length === 0
    return r
  }
  return r
}

/** Засев TS-FIX: у старой таблицы `VisitorPass` нет пункта-сущности — заголовок абзацем «Новая сущность `VisitorPass`:». */
function parseLooseVisitorPass(sec) {
  return finish({ head: 'Новая сущность `VisitorPass`', name: 'VisitorPass', lines: sec })
}

const SEED_VP = [
  ['id', 'uuid', true], ['requesterId', 'string', true], ['departmentId', 'string', true], ['visitorName', 'string', true],
  ['documentNumber', 'string', true], ['visitDate', 'date', true], ['purpose', 'string', true], ['status', 'enum', true],
  ['decidedBy', 'string', false], ['decidedAt', 'timestamp', false], ['comment', 'string', false], ['createdAt', 'timestamp', true],
]
const TYPE_OK = {
  uuid: (t) => /uuid/i.test(t), string: (t) => /string|строк|text/i.test(t), date: (t) => /^date|\bdate\b|дата/i.test(t) && !/time/i.test(t),
  enum: (t) => /enum/i.test(t), timestamp: (t) => /timestamp|datetime|iso.?8601|date-time/i.test(t),
}

function gradeRun(kase, run) {
  if (existsSync(join(run, '_api-failure.txt'))) return { measured: false, why: 'сбой API' }
  if (kase === 'sb') {
    const stages = walk(run, (p) => /[\\/]stages[\\/][^\\/]+\.md$/.test(p))
    if (!stages.length) return { measured: false, why: 'файлов этапов нет' }
    const hit = stages.some((p) => readFileSync(p, 'utf8').split(/\r?\n/).some((l) => /bikeRack/.test(l) && /boolean/i.test(l)))
    const blue = stages.some((p) => /badgeId/.test(readFileSync(p, 'utf8')))
    return { measured: true, green: hit, notes: [`bikeRack+boolean в этапе: ${hit ? 'да' : 'нет'}`, `badgeId во входе этапа: ${blue ? 'да' : 'нет'}`] }
  }
  if (kase === 'rv') {
    const a = join(run, 'answer.md')
    if (!existsSync(a)) return { measured: false, why: 'нет answer.md' }
    const t = readFileSync(a, 'utf8')
    const v = t.match(/нарушени[а-яё]*\s*[:—-]\s*\**\s*(\d+)/i)
    const false32 = t.split(/\r?\n/).filter((l) => /(3\.2|RoomOccupancySnapshot|Данные и хранение)/.test(l) && /пометк|происхожден/i.test(l) && !/есть|на месте|стоит|проставлен/i.test(l))
    return { measured: true, green: false32.length === 0, notes: [`нарушений: ${v ? v[1] : '?'}`, ...false32.map((l) => `ЛОЖНОЕ §3.2: ${l.trim().slice(0, 160)}`)] }
  }
  const spec = specOf(run)
  if (!spec) return { measured: false, why: 'спеки нет' }
  return gradeSpec(kase, readFileSync(spec, 'utf8'))
}

function line(kase, r) {
  if (!r.measured) return `НЕ ИЗМЕРЕНО (${r.why})`
  const v = r.green ? 'зелёный' : 'красный'
  if (kase === 'sb' || kase === 'rv') return `${v}  ${r.notes.join('; ')}`
  const c = r.c
  const parts = [`сущностей ${c.ents} (🟢 ${c.own}), полей ${c.fields}`]
  if (c.inline.length) parts.push(`в строку: ${c.inline.join(', ')}`)
  if (c.untyped.length) parts.push(`без типа: ${c.untyped.join(', ')}`)
  if (c.unmarked.length) parts.push(`без пометки: ${c.unmarked.join(', ')}`)
  if (r.office) {
    const o = r.office
    parts.push(`офисы [${o.form}${o.cols ? `: ${o.cols.join(' | ')}` : ''}]: ${o.fields.join(', ') || '—'}; timezone ${o.tz ? (o.tzNew ? '«новое»' : 'без пометки') : 'нет'}`)
    if (o.extra.length) parts.push(`ВЫДУМКА: ${o.extra.join(', ')}`)
    parts.push(`«остальные поля не меняются»: ${o.rest ? 'да' : 'нет'}`)
    if ('src' in o) parts.push(`поля источника: ${o.src ? 'все' : 'НЕ ВСЕ'}; 🔵 у пункта: ${o.blueCode ? 'да' : 'нет'}${o.priorMarkedNew.length ? `; прежние как «новое»: ${o.priorMarkedNew.join(', ')}` : ''}`)
  }
  if ('log' in r) {
    parts.push(r.log ? `журнал [${r.log.form}]: ${r.log.fields.join(', ')}` : 'журнала нет')
    if (r.incExtra.length) parts.push(`ВЫДУМКА у инцидента: ${r.incExtra.join(', ')}`)
  }
  if (r.vp) {
    parts.push(`VisitorPass [${r.vp.form}${r.vp.cols ? `: ${r.vp.cols.join(' | ')}` : ''}], полей ${r.vp.n}, withdrawnAt ${r.vp.withdrawnAt ? 'да' : 'нет'}`)
    if (r.vp.lost.length) parts.push(`ПОТЕРЯ: ${r.vp.lost.join('; ')}`)
  }
  parts.push(...(r.notes ?? []))
  return `${v}  ${parts.join(' | ')}`
}

// ─── Самопроверка ───────────────────────────────────────────────────────────

function selftest() {
  let bad = 0
  const ck = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad += 1; console.log(`${ok ? 'ок  ' : 'FAIL'} ${name}${ok ? '' : `: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`}`) }
  const tbl = `## 3. Backend
### 3.2. Данные и хранение
- 🟢Н \`transport_requests\` — заявка

  | Поле | Тип | Описание |
  |------|-----|----------|
  | \`id\` | uuid | ключ |
  | \`status\` | enum \`a \\| b\` | статус |

- 🟢И \`offices\` — справочник офисов; прежние поля — 🔵С

  | Поле | Тип | Описание |
  |------|-----|----------|
  | \`id\` | uuid | ключ |
  | \`name\` | string | название |
  | \`city\` | string | город |
  | \`timezone\` | string | новое; IANA |

Миграция: да.
### 3.3. Авторизация`
  let r = gradeSpec('gaps-src', tbl)
  ck('таблица: две сущности', r.c.ents, 2)
  ck('таблица: поля', r.c.fields, 6)
  ck('enum с \\| — один столбец типа', r.ents[0].fields[1].type, 'enum a | b')
  ck('gaps-src зелёный', r.green, true)
  ck('gaps на том же — выдумка name, city', r.green === undefined ? null : gradeSpec('gaps', tbl).office.extra, ['name', 'city'])
  const rest = tbl.replace(/  \| `id` \| uuid \| ключ \|\n  \| `name`[^\n]*\n  \| `city`[^\n]*\n/, '').replace('Миграция', '  Остальные поля не меняются.\n\nМиграция')
  r = gradeSpec('gaps', rest)
  ck('gaps: только timezone + строка «остальные» — зелёный', [r.green, r.office.rest, r.office.fields], [true, true, ['timezone']])
  const inline = `### 3.2. Данные и хранение
- 🟢Н \`NotificationLogEntry\` — поля: \`id\` (string), \`incidentId\` (string, ссылка на инцидент), \`status\` (enum: \`a|b\`), \`occurredAt\` (iso8601, UTC).
- 🔵С \`Инцидент\` — существующая сущность, используется как есть по \`incidentId\`; новых полей в ней не требуется.
### 3.3. x`
  r = gradeSpec('ctx', inline)
  ck('строка: 4 поля журнала', r.log && r.log.fields.length, 4)
  ck('строка: форма inline', r.log && r.log.form, 'inline')
  ck('инцидент без выдумки', r.incExtra, [])
  const fixSeed = readFileSync(join(import.meta.dirname, 'fixtures/TS-FIX/coddoc/PSS-2210/technical_specification.md'), 'utf8')
  r = gradeSpec('fix', fixSeed)
  ck('засев TS-FIX: 12 полей, потерь нет', [r.vp.n, r.vp.lost], [12, []])
  const fix3 = fixSeed.replace(/\| Поле \| Тип \| Обязательность \| Примечание \|[\s\S]*?\| `createdAt` \| timestamp \| да \| \|/, [
    '| Поле | Тип | Описание |', '|---|---|---|', '| `id` | uuid | ключ |', '| `requesterId` | string | заявитель |', '| `departmentId` | string | отдел |',
    '| `visitorName` | string | имя |', '| `documentNumber` | string | документ |', '| `visitDate` | date | дата |', '| `purpose` | string | цель |',
    '| `status` | enum | статусы |', '| `decidedBy` | string \\| null | кто решил |', '| `decidedAt` | timestamp | когда |', '| `comment` | string \\| null | комментарий |',
    '| `createdAt` | timestamp | создано |', '| `withdrawnAt` | timestamp \\| null | новое |'].join('\n'))
  r = gradeSpec('fix', fix3)
  ck('fix: 3 колонки, у decidedAt потерян null — красный', [r.green, r.vp.lost], [false, ['decidedAt: обязательность «нет» потеряна']])
  ck('fix: withdrawnAt найден', r.vp.withdrawnAt, true)
  console.log(bad ? `\nПРОВАЛОВ: ${bad}` : '\nвсе проверки прошли')
  process.exit(bad ? 1 : 0)
}

// ─── Вход ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.includes('--selftest')) selftest()
const kase = (args.find((a) => a.startsWith('--case=')) || '').slice(7)
const arms = args.filter((a) => !a.startsWith('--'))
if (!['gaps', 'gaps-src', 'ctx', 'fix', 'sb', 'rv'].includes(kase) || !arms.length) {
  console.error('usage: node grade-ent.mjs --case=gaps|gaps-src|ctx|fix|sb|rv <плечо> [<плечо> …] | --selftest'); process.exit(1)
}
for (const arm of arms) {
  if (!existsSync(arm)) { console.log(`нет каталога: ${arm}`); continue }
  const runs = readdirSync(arm).filter((n) => /^run-\d+$/.test(n) && statSync(join(arm, n)).isDirectory()).sort((a, b) => +a.slice(4) - +b.slice(4))
  console.log(`\nплечо: ${arm}   кейс: ${kase}`)
  const rows = runs.map((n) => [n, gradeRun(kase, join(arm, n))])
  for (const [n, r] of rows) console.log(`  ${n}: ${line(kase, r)}`)
  const m = rows.filter(([, r]) => r.measured)
  console.log(`  ИТОГ: зелёных ${m.filter(([, r]) => r.green).length} из ${m.length} измеренных (всего ${rows.length})`)
}
