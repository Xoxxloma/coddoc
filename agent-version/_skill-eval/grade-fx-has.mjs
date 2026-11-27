#!/usr/bin/env node
// grade-fx-has.mjs — чужой стык с известным контрактом: спросил ли агент о нём до записи спеки и не выдумал ли лишнего.
// Пробы `fx-has-1` (контракт в карточке `services/`) и `fx-has-2` (контракт знает аналитик, называет в реплике хода 2).
//
//   node grade-fx-has.mjs <папка-раунда>      раскладка <раунд>/<проба>/run-N/{stream.jsonl, stream-NN.jsonl, answer*.md, coddoc/…}
//   node grade-fx-has.mjs --selftest          шесть синтетических прогонов, без стенда
//
// По каждому прогону четыре ответа:
//   1. вопрос о чужом контракте задан до записи файла спеки;
//   2. файл записан не раньше хода, следующего за вопросом (на ходе, где вопроса ещё не было, файла нет);
//   3. в зоне чужого стыка итоговой спеки нет идентификаторов (пути, топики и события, поля, коды ошибок), которых нет
//      в источниках пробы; источники — все файлы фикстуры, кроме README.md и _manifest.txt (БТ, карточки, промпт, реплика);
//   4. названное аналитиком (или подтверждённое им по карточке) стоит в зоне чужого стыка.
// Итог: зелёный — все четыре; «без файла» — спека к потолку ходов не записана, 3 и 4 не меряются; иначе красный.
// Найденные идентификаторы печатаются списком с местом — вердикт 3 сверяется глазами (см. README фикстур, «Сомнения»).
//
// Зона чужого стыка: INT-карточки §2, у которых чужая система названа в заголовке или в строках до контракта (вид,
// граница, триггер) при границе без FE, либо заголовок с 🔵/🟡 и система в теле; плюс строки вне INT-карточек, где
// система названа. Не в счёт вердикта 3, а справкой:
// идентификатор на строке с 🟢 (своя сторона стыка); числовой HTTP-код; идентификатор, который есть в своих карточках или
// в §3.2 и стоит не на месте контракта (место контракта — строка таблицы, пример в заборе кода, строки «Контракт»,
// «Пример», «Существующий стык» чужой карточки). Ячейки колонки «Пример» и строковые значения JSON не проверяются.

import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r/g, '') : '')
const ident = (name) => new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`)

const PROBES = {
  'fx-has-1': {
    fixture: 'FX-HAS-1',
    sys: /истори[а-яё]* заказов|order-history/i, // «сервис заказов» не берём: так начинается наше сообщение о сбое
    said: [
      ['путь /api/v2/orders/{orderNumber}', /\/api\/v2\/orders\/\{\s*orderNumber\s*\}/],
      ['shippedAt', ident('shippedAt')], ['shippedQty', ident('shippedQty')], ['sku', ident('sku')],
    ],
    extra: [['ORDER_NOT_FOUND', ident('ORDER_NOT_FOUND')], ['title', ident('title')], ['customerName', ident('customerName')], ['status', ident('status')]],
  },
  'fx-has-2': {
    fixture: 'FX-HAS-2',
    sys: /экзаменатор|систем[а-яё]* аттестаци|examiner/i,
    said: [
      ['топик examiner.attempt-completed', /(?<![A-Za-z0-9_.\-])examiner\.attempt-completed(?![A-Za-z0-9_.\-])/],
      ...['attemptUid', 'personLogin', 'testCode', 'scorePct', 'isPassed', 'submittedAt'].map((f) => [f, ident(f)]),
    ],
    extra: [],
  },
}

// ---------- идентификаторы ----------

const PATH_RE = /(?<![A-Za-z0-9_.\-}])\/(?:[A-Za-z0-9_.\-]+|\{[^}\s]*\}|:[A-Za-z_]+)(?:\/(?:[A-Za-z0-9_.\-]+|\{[^}\s]*\}|:[A-Za-z_]+))*/g
const TOKEN_RE = /(?<![A-Za-z0-9_.\-])[A-Za-z_][A-Za-z0-9_]*(?:[.\-][A-Za-z0-9_]+)*/g
const KEY_RE = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g
const BARE_RES = [
  /(?<![A-Za-z0-9_.\-])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![A-Za-z0-9_])/g, // UPPER_SNAKE
  /(?<![A-Za-z0-9_.\-])[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*(?![A-Za-z0-9_])/g, // camelCase
  /(?<![A-Za-z0-9_.\-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![A-Za-z0-9_])/g, // snake_case
  /(?<![A-Za-z0-9_.\-/])[a-z][a-z0-9_\-]+(?:\.[a-z][a-z0-9_\-]+)+(?![A-Za-z0-9_])/g, // точечное имя: топик, событие
  /(?<![A-Za-z0-9_.\-])X-[A-Za-z][A-Za-z\-]+/g, // заголовок
]
const HTTP_RE = /(?<![A-Za-z0-9_.,:\-/№#])([45]\d\d)(?![A-Za-z0-9_\-/]|[.,]\d|\s*(?:мс|ms|сек|с(?![а-яё])|мин|час|дн|шт|руб|строк|попыт|заяв|реклам|%))/g
const FILE_EXT = /\.(md|ya?ml|json|jsonl|txt|mjs|js|sh|html|ru|com|org)$/i
const GENERIC = new Set(('string int integer long number decimal float double boolean bool uuid iso8601 iso-8601 timestamp date datetime time ' +
  'null true false object array enum json http https rest kafka tbd get post put patch delete fe be ui api url utc utf-8 application ' +
  'content-type accept charset loading value zero empty error error_source error_forbidden camelcase snake_case ms ttl ' +
  'technical_specification business_requirements topic offset partition consumer group commit ack retry backoff timeout ' +
  'at-least-once at-most-once exactly-once').split(' '))

const normPath = (p) => p.replace(/\{[^}]*\}|:[A-Za-z_]+/g, '{}').replace(/[.,;:]+$/, '').replace(/\/+$/, '')
const hasLatin = (s) => /[A-Za-z]/.test(s)

// Идентификаторы одной строки: пути, слова в обратных кавычках, ключи JSON, «голые» имена вне кавычек, числовые коды.
export function idsOf (line) {
  const out = []
  let rest = line.replace(PATH_RE, (p) => { if (hasLatin(p.replace(/\{[^}]*\}/g, ''))) out.push({ kind: 'path', t: normPath(p) }); return ' ' })
  for (const m of rest.matchAll(KEY_RE)) out.push({ kind: 'word', t: m[1] })
  rest = rest.replace(/:\s*"[^"\n]*"/g, ': ') // строковое значение в примере — данные, не идентификатор
  rest = rest.replace(/`([^`\n]*)`/g, (_, span) => {
    for (const t of span.match(TOKEN_RE) || []) if (t.length > 1 && !FILE_EXT.test(t)) out.push({ kind: 'word', t })
    for (const m of span.matchAll(HTTP_RE)) out.push({ kind: 'http', t: m[1] })
    return ' '
  })
  for (const re of BARE_RES) for (const t of rest.match(re) || []) if (!FILE_EXT.test(t)) out.push({ kind: 'word', t })
  for (const m of rest.matchAll(HTTP_RE)) out.push({ kind: 'http', t: m[1] })
  return out
}
const keyOf = (id) => `${id.kind}:${id.t}`

function walk (dir) {
  const out = []
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p) }
  return out
}

// Источники пробы: всё, что агент мог прочитать или услышать. README и манифест — материал стенда, в источники не идут.
export function loadSources (fixture) {
  const root = join(HERE, 'fixtures', fixture)
  const files = walk(root).filter((f) => !/(^|[\\/])(README\.md|_manifest\.txt)$/.test(f))
  const text = files.map(read).join('\n') + '\n' + files.map((f) => relative(root, f).replace(/\\/g, '/')).join('\n')
  const src = { words: new Set(), paths: new Set(), http: new Set(), text }
  for (const m of text.matchAll(PATH_RE)) src.paths.add(normPath(m[0]))
  const rest = text.replace(PATH_RE, ' ')
  for (const t of rest.match(TOKEN_RE) || []) src.words.add(t)
  for (const m of text.matchAll(HTTP_RE)) src.http.add(m[1])
  return src
}

export function known (id, src) {
  if (id.kind === 'path') {
    if (src.paths.has(id.t)) return true
    const seg = id.t.split('/') // `/api/v2/orders/10482` — пример вызова по пути `/api/v2/orders/{}` из источника
    return [...src.paths].some((p) => { const s = p.split('/'); return s.length === seg.length && s.includes('{}') && s.every((x, i) => x === seg[i] || (x === '{}' && /\d/.test(seg[i]))) })
  }
  if (id.kind === 'http') return src.http.has(id.t) || /^50[0234]$/.test(id.t)
  const ok = (t) => src.words.has(t) || GENERIC.has(t.toLowerCase()) || /^(INT|FR)-?\d+$/i.test(t) || !hasLatin(t)
  if (ok(id.t)) return true
  const parts = id.t.split('.')
  return parts.length > 1 && parts.every(ok)
}

// ---------- спека ----------

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return null
}

// Открытые пункты шапки — как в grade-hd.mjs.
function openItems (spec) {
  const lines = spec.split('\n')
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) {
    const t = lines[j].replace(/^>\s?/, '').trim()
    if (/^\d+[.)]\s/.test(t)) out.push(t)
    else if (out.length && t && !/^\*?\(/.test(t)) out[out.length - 1] += ' ' + t
  }
  return out
}

// Зона чужого стыка: строки { n, text, where, strict, contract }. strict — строка чужой INT-карточки, contract — место контракта в ней.
export function foreignZone (spec, sys) {
  const lines = spec.split('\n')
  const heads = []
  lines.forEach((l, i) => { const m = l.match(/^(#{1,6})\s+(.*)$/); if (m) heads.push({ i, level: m[1].length, title: m[2] }) })
  const span = (h) => { const next = heads.find((x) => x.i > h.i && x.level <= h.level); return [h.i, next ? next.i : lines.length] }
  const cards = heads.filter((h) => /^\W*INT-\d+/.test(h.title)).map((h) => {
    const [from, to] = span(h)
    const body = lines.slice(from + 1, to)
    const bound = body.filter((l) => /Граница|направлени/i.test(l)).join(' ')
    const k = body.findIndex((l) => /Контракт/i.test(l))
    const pre = body.slice(0, k < 0 ? 6 : k).join(' ') // строки до контракта: вид, граница, триггер, существующий стык
    const foreign = sys.test(h.title) || (sys.test(pre) && !/(?<![A-Za-z])FE(?![A-Za-z])|фронт|(?<![A-Za-z])UI(?![A-Za-z])|браузер|экран/i.test(bound)) ||
      (/[🔵🟡]/u.test(h.title) && sys.test(body.join('\n')))
    return { from, to, foreign, name: (h.title.match(/INT-\d+/) || ['INT'])[0] }
  })
  const h32 = heads.find((h) => /^~*\s*3\.2\.?\s/.test(h.title))
  const own = new Set()
  const ownLines = []
  for (const c of cards) if (!c.foreign) ownLines.push(...lines.slice(c.from, c.to))
  if (h32) { const [f, t] = span(h32); ownLines.push(...lines.slice(f, t)) }
  for (const l of ownLines) for (const id of idsOf(l)) own.add(keyOf(id))
  const inCard = (i) => cards.find((c) => i >= c.from && i < c.to)
  const hasForeignCard = cards.some((c) => c.foreign)
  const zone = []
  let fence = false; let exCol = -1
  lines.forEach((raw, i) => {
    let text = raw
    if (/^\s*```/.test(raw)) fence = !fence
    // Таблица: колонка «Пример» — данные, а не имена; её ячейки из проверки вычёркиваются.
    if (/^\s*\|/.test(raw)) {
      const cells = raw.split(/(?<!\\)\|/)
      if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) exCol = cells.findIndex((x) => /^\s*Пример/i.test(x))
      else if (exCol >= 0 && cells.length > exCol) { cells[exCol] = ' '; text = cells.join('|') }
    } else exCol = -1
    const c = inCard(i)
    // Место контракта: строка таблицы, пример в заборе кода, строки «Контракт / Пример / Существующий стык».
    const contract = fence || /^\s*\|/.test(raw) || /Контракт|Пример|Существующий стык/i.test(raw)
    if (c && c.foreign) zone.push({ n: i + 1, text, where: c.name, strict: true, contract })
    else if (sys.test(text) && (!c || !hasForeignCard)) zone.push({ n: i + 1, text, where: c ? `${c.name} (своя)` : 'вне карточек', strict: false, contract: false })
  })
  return { zone, own, hasForeignCard, cards: cards.filter((c) => c.foreign).map((c) => c.name) }
}

export function gradeSpec (spec, cfg, src) {
  const { zone, own, hasForeignCard, cards } = foreignZone(spec, cfg.sys)
  const red = new Map(); const soft = new Map()
  for (const z of zone) {
    for (const id of idsOf(z.text)) {
      if (known(id, src)) continue
      const why = id.kind === 'http' ? 'числовой код' : /🟢/u.test(z.text) ? 'строка с 🟢' : (!z.contract && own.has(keyOf(id))) ? 'есть в своих карточках' : null
      const bucket = why ? soft : red
      if (!bucket.has(keyOf(id))) bucket.set(keyOf(id), { t: id.t, where: `${z.where}, стр. ${z.n}`, why })
    }
  }
  const zoneText = hasForeignCard ? zone.map((z) => z.text).join('\n') : spec
  const lost = cfg.said.filter(([, re]) => !re.test(zoneText)).map(([n]) => n)
  const extraLost = cfg.extra.filter(([, re]) => !re.test(zoneText)).map(([n]) => n)
  const open = openItems(spec)
  return {
    red: [...red.values()], soft: [...soft.values()], lost, extraLost, hasForeignCard, cards,
    openAll: open.length, openForeign: open.filter((t) => cfg.sys.test(t)).length,
    status: ((spec.match(/^>\s*\*\*Статус готовности:\*\*\s*(.*)$/m) || [])[1] || '').trim(),
  }
}

// ---------- ходы ----------

const ASK = /\?|подтверд|годится|назов[иё]те|уточните|подскажите|верно(?![а-яё])/i
const CONFIRM = /верно(?![а-яё])|подтверд|так и есть|беру так|актуальн|годится|правильно/i
const ASPECT = /контракт|карточк|ручк|эндпоинт|endpoint|(?<![A-Za-z])API(?![A-Za-z])|пут[ьией](?![а-яё])|адрес|метод|запрос|ответ|(?<![а-яё])пол[яейю](?![а-яё])|полями|полях|схем|формат|топик|topic|очеред|событи|сообщени|payload|код[а-яё]{0,2} (ошиб|ответ)|`[^`\n]+`|(?<![A-Za-z])(GET|POST|PUT|PATCH|DELETE)(?![A-Za-z])/i

// Вопрос о чужом контракте: абзац с вопросом; в нём и двух абзацах перед ним названы чужая система и сторона контракта.
export function contractQuestions (text, sys) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  const out = []
  blocks.forEach((b, i) => {
    if (!ASK.test(b)) return
    const win = blocks.slice(Math.max(0, i - 2), i + 1)
    const all = win.join('\n')
    if (!sys.test(all) || !ASPECT.test(all)) return
    if (!(sys.test(b) || ASPECT.test(b) || CONFIRM.test(b))) return
    out.push(win.filter((w) => w === b || sys.test(w)).join(' ¶ ').replace(/\s+/g, ' ').slice(0, 320))
  })
  return out
}

const SPEC_FILE = /technical_specification\.md/
function isSpecWrite (c) {
  const input = c.input || {}
  if (/^(Write|Edit|MultiEdit)$/.test(c.name)) return SPEC_FILE.test(String(input.file_path || input.path || ''))
  if (/^(Bash|PowerShell)$/.test(c.name)) {
    const cmd = String(input.command || '')
    return />{1,2}\s*["']?[^\s"'|;&<>]*technical_specification\.md|(?<![A-Za-z])(tee|cp|mv)(?![A-Za-z])[^|;&]*technical_specification\.md|(Set-Content|Out-File|Add-Content)[^|;]*technical_specification\.md|open\([^)]*technical_specification\.md[^)]*['"][wa]/.test(cmd)
  }
  return false
}

const streamName = (n) => (n === 1 ? 'stream.jsonl' : `stream-${String(n).padStart(2, '0')}.jsonl`)
const answerName = (n) => `answer-${String(n).padStart(2, '0')}.md`

// Ход: события по порядку потока — сказанное ведущим (текст и вопросы инструмента вопросов) и запись файла спеки.
function loadTurn (dir, n) {
  const raw = read(join(dir, streamName(n)))
  const events = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue
    for (const c of o.message.content) {
      if (c.type === 'text' && c.text && c.text.trim() && !o.parent_tool_use_id) events.push({ kind: 'say', text: c.text })
      if (c.type !== 'tool_use') continue
      if (/AskUserQuestion|ask_?user/i.test(c.name) && !o.parent_tool_use_id) {
        const qs = Array.isArray(c.input && c.input.questions) ? c.input.questions : [c.input || {}]
        events.push({ kind: 'say', text: qs.map((q) => [q.header, q.question, ...(q.options || []).map((x) => `${x.label || ''} ${x.description || ''}`)].filter(Boolean).join('\n')).join('\n\n') })
      } else if (isSpecWrite(c)) events.push({ kind: 'write' })
    }
  }
  let answer = read(join(dir, answerName(n)))
  if (!answer && n === 1 && !existsSync(join(dir, answerName(2)))) answer = read(join(dir, 'answer.md'))
  if (!events.some((e) => e.kind === 'say') && answer.trim()) events.unshift({ kind: 'say', text: answer })
  return { n, exists: raw.length > 0 || answer.length > 0, events }
}

export function gradeRun (dir, cfg, src) {
  const r = { measured: false }
  if (!existsSync(join(dir, 'stream.jsonl')) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) return r
  r.measured = true
  const turns = []
  for (let n = 1; n <= 20; n++) { const t = loadTurn(dir, n); if (!t.exists) break; turns.push(t) }
  r.turns = turns.length
  const specPath = findSpec(dir)
  r.file = !!specPath
  let writeTurn = null
  const qs = []
  for (const t of turns) {
    const cut = t.events.findIndex((e) => e.kind === 'write')
    const before = (writeTurn === null ? (cut < 0 ? t.events : t.events.slice(0, cut)) : []).filter((e) => e.kind === 'say').map((e) => e.text).join('\n\n')
    for (const q of contractQuestions(before, cfg.sys)) qs.push({ turn: t.n, q })
    if (cut >= 0 && writeTurn === null) writeTurn = t.n
  }
  // Файл есть, а запись в потоках не опознана (необычная команда): диалог кончается на записанном файле — значит, последний ход.
  r.writeAssumed = r.file && writeTurn === null
  if (r.writeAssumed) writeTurn = turns.length
  r.writeTurn = writeTurn
  r.askTurn = qs.length ? qs[0].turn : null
  r.questions = qs
  r.c1 = qs.length > 0
  r.c2 = writeTurn === null || (qs.length > 0 && qs[0].turn < writeTurn)
  if (r.file) {
    r.spec = gradeSpec(read(specPath), cfg, src)
    r.c3 = r.spec.red.length === 0
    r.c4 = r.spec.lost.length === 0
  }
  r.verdict = !r.file ? 'без файла' : (r.c1 && r.c2 && r.c3 && r.c4) ? 'зелёный' : 'КРАСНЫЙ'
  return r
}

function report (round) {
  for (const [probe, cfg] of Object.entries(PROBES)) {
    const dir = join(round, probe)
    if (!existsSync(dir)) continue
    const src = loadSources(cfg.fixture)
    const runs = readdirSync(dir).filter((x) => /^run-\d+$/.test(x)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    const res = runs.map((name) => ({ name, r: gradeRun(join(dir, name), cfg, src) }))
    const ok = res.filter((x) => x.r.measured)
    const cnt = (fn) => ok.filter((x) => fn(x.r)).length
    const withFile = ok.filter((x) => x.r.file).length
    console.log(`\n-- ${probe} (${cfg.fixture}): измерено ${ok.length} из ${runs.length}`)
    console.log(`   ${cnt((r) => r.c1)}/${ok.length}  1. вопрос о чужом контракте до записи`)
    console.log(`   ${cnt((r) => r.c2)}/${ok.length}  2. файл записан не раньше хода после вопроса`)
    console.log(`   ${cnt((r) => r.file && r.c3)}/${withFile}  3. в зоне чужого стыка нет идентификаторов вне источников (из прогонов с файлом)`)
    console.log(`   ${cnt((r) => r.file && r.c4)}/${withFile}  4. названное аналитиком стоит в зоне чужого стыка (из прогонов с файлом)`)
    console.log(`   зелёных ${cnt((r) => r.verdict === 'зелёный')}, красных ${cnt((r) => r.verdict === 'КРАСНЫЙ')}, без файла ${cnt((r) => r.verdict === 'без файла')}`)
    console.log('   прогон | ходов | вопрос (ход) | запись (ход) | 1 | 2 | 3 вне источников | 4 потеряно | открытых о стыке / всего | итог')
    for (const { name, r } of res) {
      if (!r.measured) { console.log(`   ${name} | не измерен`); continue }
      const s = r.spec
      console.log('   ' + [name, r.turns, r.askTurn ?? '—', r.writeTurn === null ? '—' : `${r.writeTurn}${r.writeAssumed ? ' (по файлу)' : ''}`,
        r.c1 ? 'да' : 'НЕТ', r.c2 ? 'да' : 'НЕТ', s ? s.red.length : '·', s ? (s.lost.length ? s.lost.join(', ') : '0') : '·',
        s ? `${s.openForeign} / ${s.openAll}` : '·', r.verdict].join(' | '))
      if (r.questions.length) console.log(`      вопрос (ход ${r.questions[0].turn}): ${r.questions[0].q}`)
      if (!s) continue
      if (!s.hasForeignCard) console.log('      INT-карточки чужого стыка не найдено — проверены только строки с именем системы; 4 — по всей спеке')
      else console.log(`      карточки чужого стыка: ${s.cards.join(', ')}; статус: ${s.status || '—'}`)
      for (const x of s.red) console.log(`      нет в источниках: ${x.t}   (${x.where})`)
      for (const x of s.soft) console.log(`      справочно, ${x.why}: ${x.t}   (${x.where})`)
      if (s.extraLost.length) console.log(`      справочно, из источника не перенесено: ${s.extraLost.join(', ')}`)
    }
  }
}

// ---------- самотест ----------

function selftest () {
  const root = mkdtempSync(join(tmpdir(), 'fx-has-selftest-'))
  const say = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
  const tool = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name, input }] } })
  const mk = (probe, run, key, streams, spec) => {
    const dir = join(root, probe, run)
    mkdirSync(dir, { recursive: true })
    streams.forEach((lines, i) => writeFileSync(join(dir, streamName(i + 1)), lines.join('\n') + '\n'))
    if (spec) { mkdirSync(join(dir, 'coddoc', key), { recursive: true }); writeFileSync(join(dir, 'coddoc', key, 'technical_specification.md'), spec) }
    return dir
  }
  const head = (n, items) => `# Техническая спецификация: проба\n\n> **Задача:** X-1\n> **Статус готовности:** ${n ? `Требуются уточнения (${n})` : 'Готово к разработке'}\n>\n> **Открытые вопросы (решить до / во время разработки):**\n${items.map((t, i) => `> ${i + 1}. ${t}`).join('\n')}\n`
  const wSpec2 = (p) => tool('Write', { file_path: `${p}/coddoc/EDU-127/technical_specification.md`, content: '…' })

  // fx-has-2: спека с событием «Экзаменатора». Своя сторона стыка (группа читателя) — на строке с 🟢.
  const spec2 = head(1, ['🟡 Как edu-portal подключается к Kafka «Экзаменатора»: адрес брокера и учётные данные — к валидации.']) + `
## 2. Взаимодействия (ядро)

### INT-1. Результаты аттестаций сотрудников — 🟢
- **Граница/направление:** FE → BE edu-portal
- **Контракт (запрос):** \`GET /v1/team/attempt-results\`, параметр \`courseId\`

  | Поле | Тип | Пример | Описание |
  |------|-----|--------|----------|
  | \`items[].employeeName\` | string | Лаптев | сотрудник |
  | \`items[].resultPct\` | int | 85 | балл |

- **Происхождение:** 🟢Н

### INT-2. Событие о завершённой попытке — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** «Экзаменатор» → Kafka → BE edu-portal
- **Триггер:** сотрудник завершил попытку; результат пишем в \`AttemptResult\` (§3.2)
- **Контракт (запрос):** топик \`examiner.attempt-completed\`, JSON 🔵С

  | Поле | Тип | Пример | Описание |
  |------|-----|--------|----------|
  | \`attemptUid\` | string | \`a-7f3c\` | идентификатор попытки |
  | \`personLogin\` | string | \`laptev.av\` | доменный логин сотрудника |
  | \`testCode\` | string | \`OT-2027\` | код теста |
  | \`scorePct\` | int | 85 | балл, 0–100 |
  | \`isPassed\` | boolean | true | сдал или нет |
  | \`submittedAt\` | iso8601 | 2027-03-02T10:15:00Z | время завершения |

- 🟢 Группа читателя — \`edu-portal-attempts\`; повтор по \`attemptUid\` не сохраняем.
- **Ошибки:** сообщение не разобрано — пропускаем, пишем в журнал.
- **Происхождение:** 🔵С

## 3. Backend — ответственность
### 3.2. Данные и хранение
- 🟢 \`AttemptResult\` — результат попытки

  | Поле | Тип | Описание |
  |------|-----|----------|
  | \`attemptUid\` | string | ключ |
  | \`resultPct\` | int | балл |

## 8. Допущения и открытые вопросы
- **🟡 К валидации:** подключение edu-portal к Kafka «Экзаменатора».
`
  // fx-has-1: спека с вызовом истории заказов по карточке; свой код ошибки — на строке с 🟢.
  const spec1 = head(1, ['🟡 Как claims-desk авторизуется в сервисе «История заказов» — в карточке нет, аналитик не знает.']) + `
## 2. Взаимодействия (ядро)

### INT-1. Поиск заказа для рекламации — 🟢
- **Граница/направление:** FE → BE claims-desk (BE дальше идёт в order-history, INT-2)
- **Контракт (запрос):** \`GET /v1/order-lookup/{orderNumber}\`
- **Контракт (ответ):** \`claimable: boolean\`, \`refusalReason\`, \`lines[].sku\`
- **Ошибки:** \`404 ORDER_NOT_FOUND\`, \`503 ORDER_SOURCE_UNAVAILABLE\`

### INT-2. Заказ по номеру из истории заказов — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** BE claims-desk → order-history
- **Триггер:** INT-1; выбранные позиции потом копируются в \`ClaimLine\` (§3.2)
- **Пример запроса:** \`GET /api/v2/orders/10482\`
- **Контракт (запрос):** \`GET /api/v2/orders/{orderNumber}\` 🔵К, тело отсутствует
- **Контракт (ответ):** \`Order\`: \`orderNumber\`, \`customerName\`, \`status\` (\`placed\` \\| \`shipped\` \\| \`cancelled\`), \`shippedAt\`, \`lines[]\`: \`sku\`, \`title\`, \`shippedQty\`
- **Пример ответа (успех):** фрагмент: прочие поля — без изменений
  \`\`\`json
  { "orderNumber": "10482", "status": "shipped", "shippedAt": "2026-11-03T09:00:00Z", "lines": [{ "sku": "DB-840", "title": "Дюбель 8×40", "shippedQty": 200 }] }
  \`\`\`
- **Ошибки:** \`404 ORDER_NOT_FOUND\` — заказа нет; таймаут или 5xx — сбой источника.
- 🟢 На сбой отвечаем фронту своим \`ORDER_SOURCE_UNAVAILABLE\` (INT-1).
- **Авторизация:** 🟡 к валидации.
- **Происхождение:** 🔵К

## 3. Backend — ответственность
### 3.1. По сервисам
claims-desk: отдаёт INT-1 (\`GET /v1/order-lookup/{orderNumber}\`), ходит в order-history (INT-2).
### 3.2. Данные и хранение
- 🟢 \`ClaimLine\` — позиция рекламации: \`claimId\`, \`sku\`, \`title\`, \`qty\`, \`reason\`
`
  const ask2 = 'Гейты из ваших ответов закрыты.\n\n**Чужой стык — события «Экзаменатора».** Карточки этой системы нет. Какой топик читаем и какие поля в событии о завершённой попытке? Назовёте — запишу фактом; не знаете — оставлю открытым.\n\nINT-1 (фронт → бэк edu-portal, результаты сотрудников): `GET /v1/team/attempt-results` — годится?'
  const ask1 = 'В `services/order-history.md`: `GET /api/v2/orders/{orderNumber}` → `Order` с `lines` (`sku`, `title`, `shippedQty`), `shippedAt`, `status`; `404 ORDER_NOT_FOUND`.\n\nБеру так — верно? Карточку этого сервиса вы не подтверждали.'
  const other = 'Номер задачи — RCL-318, верно?\n\nINT-1 (фронт → бэк claims-desk, поиск заказа по номеру): `GET /v1/order-lookup/{orderNumber}` — годится или поправить?'

  const cases = [
    ['зелёный: спросил про события, записал названное (fx-has-2)', 'fx-has-2',
      mk('fx-has-2', 'run-1', 'EDU-127', [[say(ask2)], [say('Реестр чист, пишу.'), wSpec2('/sb'), say('Готово.')]], spec2),
      { c1: true, c2: true, c3: true, c4: true, verdict: 'зелёный' }],
    ['зелёный: пересказал карточку на подтверждение, записал по ней (fx-has-1)', 'fx-has-1',
      mk('fx-has-1', 'run-1', 'RCL-318', [[say(ask1)], [tool('Write', { file_path: 'C:\\sb\\coddoc\\RCL-318\\technical_specification.md', content: '…' }), tool('Edit', { file_path: 'C:\\sb\\coddoc\\RCL-318\\technical_specification.md' })]], spec1),
      { c1: true, c2: true, c3: true, c4: true, verdict: 'зелёный' }],
    ['выдумал поле, ключ в примере и топик (fx-has-2)', 'fx-has-2',
      mk('fx-has-2', 'run-2', 'EDU-127', [[say(ask2)], [wSpec2('/sb')]],
        spec2.replace('  | `submittedAt` |', '  | `attemptNumber` | int | 2 | номер попытки |\n  | `submittedAt` |')
          .replace('- **Ошибки:** сообщение', '- **Пример:** `{ "attemptUid": "a-1", "maxScore": 100 }`; неразобранное уходит в `examiner.attempt-completed.dlq`\n- **Ошибки:** сообщение')),
      { c1: true, c2: true, c3: false, c4: true, verdict: 'КРАСНЫЙ', red: ['attemptNumber', 'maxScore', 'examiner.attempt-completed.dlq'] }],
    ['записал без вопроса на первом ходе (fx-has-1)', 'fx-has-1',
      mk('fx-has-1', 'run-2', 'RCL-318', [[say('Все гейты закрыты ответами, контракт истории заказов беру из карточки. Пишу спеку.'), tool('Bash', { command: 'cat > coddoc/RCL-318/technical_specification.md <<EOF\n…\nEOF' }), say('Готово.')]], spec1),
      { c1: false, c2: false, c3: true, c4: true, verdict: 'КРАСНЫЙ' }],
    ['потерял сказанное: `score` вместо `scorePct`, нет `attemptUid` (fx-has-2)', 'fx-has-2',
      mk('fx-has-2', 'run-3', 'EDU-127', [[say(ask2)], [wSpec2('/sb')]],
        spec2.replace('  | `attemptUid` | string | `a-7f3c` | идентификатор попытки |\n', '').replace('  | `scorePct` | int | 85 | балл, 0–100 |', '  | `score` | int | 85 | балл |').replace('повтор по `attemptUid` не', 'повтор не')),
      { c1: true, c2: true, c3: false, c4: false, verdict: 'КРАСНЫЙ', lost: ['attemptUid', 'scorePct'], red: ['score'] }],
    ['спросил о своём, о чужом контракте — нет; записал на втором ходе (fx-has-1)', 'fx-has-1',
      mk('fx-has-1', 'run-3', 'RCL-318', [[say(other)], [tool('Write', { file_path: '/sb/coddoc/RCL-318/technical_specification.md', content: '…' })]], spec1),
      { c1: false, c2: false, c3: true, c4: true, verdict: 'КРАСНЫЙ' }],
  ]
  let fail = 0
  const check = (label, cond, detail) => { if (!cond) fail++; console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${cond ? '' : '   ' + detail}`) }
  for (const [label, probe, dir, want] of cases) {
    const cfg = PROBES[probe]
    const r = gradeRun(dir, cfg, loadSources(cfg.fixture))
    const got = { c1: r.c1, c2: r.c2, c3: r.c3, c4: r.c4, verdict: r.verdict }
    const bad = Object.keys(got).filter((k) => got[k] !== want[k])
    const redGot = r.spec.red.map((x) => x.t)
    if (want.red && (want.red.some((t) => !redGot.includes(t)) || redGot.length !== want.red.length)) bad.push('red')
    if (!want.red && redGot.length) bad.push('red')
    if (want.lost && want.lost.join() !== r.spec.lost.join()) bad.push('lost')
    check(label, bad.length === 0, `расхождение: ${bad.join(', ')}; получено ${JSON.stringify(got)}; вне источников: ${redGot.join(', ') || '—'}; потеряно: ${r.spec.lost.join(', ') || '—'}`)
  }
  // Сверка самого грейдера с фикстурами: каждое «названное аналитиком» есть в источниках пробы.
  for (const [probe, cfg] of Object.entries(PROBES)) {
    const src = loadSources(cfg.fixture)
    const miss = [...cfg.said, ...cfg.extra].filter(([, re]) => !re.test(src.text)).map(([n]) => n)
    check(`якоря ${probe} есть в источниках фикстуры ${cfg.fixture}`, miss.length === 0, `нет: ${miss.join(', ')}`)
  }
  // Проверки 1 и 2 расходятся: вопрос и запись в одном ходе — вопрос был (1 — да), ответа не ждал (2 — нет).
  const same = gradeRun(mk('fx-has-2', 'run-9', 'EDU-127', [[say(ask2), wSpec2('/sb')]], spec2), PROBES['fx-has-2'], loadSources('FX-HAS-2'))
  check('вопрос и запись в одном ходе: 1 — да, 2 — нет', same.c1 === true && same.c2 === false, JSON.stringify({ c1: same.c1, c2: same.c2 }))
  // Карточка события без имени системы в заголовке и границе, система — только в триггере: всё равно чужая.
  const bare = spec2.replace('«Экзаменатор» → Kafka → BE edu-portal', 'Kafka → BE edu-portal').replace('сотрудник завершил попытку;', '«Экзаменатор» публикует событие;')
    .replace('  | `submittedAt` |', '  | `attemptNumber` | int | 2 | номер попытки |\n  | `submittedAt` |')
  const gz = gradeSpec(bare, PROBES['fx-has-2'], loadSources('FX-HAS-2'))
  check('система названа только в триггере: карточка чужая, выдуманное поле поймано', gz.hasForeignCard && gz.red.map((x) => x.t).join() === 'attemptNumber', JSON.stringify(gz.red))
  console.log('\nотчёт по синтетическому раунду:')
  report(root)
  rmSync(root, { recursive: true, force: true })
  console.log(fail ? `\nСАМОТЕСТ: провалено ${fail}` : '\nСАМОТЕСТ: всё сошлось')
  process.exit(fail ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  else if (!arg || arg.startsWith('--')) { console.error('usage: node grade-fx-has.mjs <папка-раунда> | --selftest'); process.exit(1) } else report(arg)
}
