#!/usr/bin/env node
// grade-fx-unk.mjs <папка-раунда> — чужой стык, контракт которого неизвестен (`technical-spec-doc`).
//   node grade-fx-unk.mjs <папка-раунда>     раскладка <раунд>/<проба>/run-N/
//   node grade-fx-unk.mjs --selftest         синтетические прогоны, бесплатно
//
// Пробы `fx-unk-1` (FX-UNK-1: сайт музея вызывает работающую «Экспозицию», её контракта никто из наших не знает) и
// `fx-unk-2` (FX-UNK-2: «Климат-контроль» будет слать события журналу агронома, контракта ещё не существует).
// Реплика следующих ходов — «не знаю» (`unk-turn2.txt`). Состав и исходы — README фикстур.
//
// По каждому прогону четыре ответа:
//   (1) вопрос о контракте чужой системы задан, и задан на ходе раньше хода записи спеки;
//   (2) спека не записана на ходе, до которого такого вопроса не было;
//   (3) в карточках чужого стыка итоговой спеки нет идентификаторов (путь, имя события и топика, имя поля, код ошибки,
//       число таймаута), которых нет в источниках пробы. Источники — все файлы фикстуры, кроме README и манифеста:
//       БТ, карточки сервисов, промпт, реплика. Найденное печатается списком для ручной сверки;
//   (4) в блоке «Открытые вопросы» шапки есть пункт о стыке с чужой системой, и статус — не «Готово».
// Итог: зелёный — все четыре; красный — файл есть и хоть один ответ «нет»; «без файла» — спека не записана за все ходы
// (уход в вопросы красным не считается). Прогон без потока первого хода или с отказом API — «не измерен».
//
// Что считается идентификатором чужого стыка (ответ 3). Карточка чужого стыка — `### INT-N`, у которой строка
// «Граница/направление» (нет её — заголовок) называет чужую систему и не называет фронт. В ней:
//   жёстко — ключи JSON в блоке кода и строки таблицы полей с именем в обратных кавычках: вне источников → красное;
//   мягко — прочее в обратных кавычках, пути, имена через точку, КОДЫ_ОШИБОК, camelCase/snake_case, HTTP-коды, числа
//   таймаутов: вне источников и нигде вне карточек чужого стыка не встречается → красное; встречается и в нашей части
//   спеки (наш код ошибки, наше поле, наш путь) → печатается «также в нашем дизайне», красным не считается.
// Карточки чужого стыка нет вовсе — та же мягкая проверка идёт по строкам, называющим чужую систему (кроме наших
// карточек, каталога ошибок, §3.2, §3.3, §4, §7, §9); вывод помечен «по строкам» — сверять руками.
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r/g, '') : '')

const PROBES = {
  'fx-unk-1': { fixture: 'FX-UNK-1', sys: /Экспозици|Музейны\S* систем/i },
  'fx-unk-2': { fixture: 'FX-UNK-2', sys: /Климат[\s-]*контрол|АСУ\s*ТП/i },
}

// ── источники пробы ──────────────────────────────────────────────────────────────────────────────────────────────
function walk (dir) {
  const out = []
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (n !== 'README.md' && n !== '_manifest.txt') out.push(p)
  }
  return out
}
const loadSources = (fixture) => walk(join(HERE, 'fixtures', fixture)).map(read).join('\n')

// ── ходы: сказанное и запись спеки ───────────────────────────────────────────────────────────────────────────────
const SPEC = 'technical_specification\\.md'
const BASH_WRITE = new RegExp(`>>?\\s*["']?\\S*${SPEC}|\\b(?:tee|cp|mv)\\b[^|;&\\n]*${SPEC}|\\bsed\\s+-i[^|;&\\n]*${SPEC}|(?:Set-Content|Out-File|writeFile\\w*|open\\()[^\\n]*${SPEC}`)
function strings (v, out = []) {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out))
  return out
}
function turn (dir, n) {
  const nn = String(n).padStart(2, '0')
  const raw = read(join(dir, n === 1 ? 'stream.jsonl' : `stream-${nn}.jsonl`))
  const texts = []; let wrote = false
  for (const line of raw.split('\n')) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue
    for (const c of o.message.content) {
      if (c.type === 'text' && c.text && c.text.trim()) texts.push(c.text)
      if (c.type !== 'tool_use' || !c.input) continue
      if (c.name === 'AskUserQuestion') texts.push(strings(c.input).join('\n'))
      if (/^(Write|Edit|MultiEdit)$/.test(c.name) && new RegExp(SPEC).test(String(c.input.file_path || ''))) wrote = true
      if (/^(Bash|PowerShell)$/.test(c.name) && BASH_WRITE.test(String(c.input.command || ''))) wrote = true
    }
  }
  // Поток без текста (обрезан) — ответ хода из файла; `answer.md` у многоходового прогона — склейка, её не берём.
  if (raw && !texts.length) { const a = read(join(dir, `answer-${nn}.md`)); if (a) texts.push(a) }
  return { exists: raw.length > 0, text: texts.join('\n'), wrote }
}

// ── вопрос о контракте чужой системы ─────────────────────────────────────────────────────────────────────────────
const ASK = /\?|подтвердите|уточните|подскажите|назов[иё]те|пришлите|сообщите/i
// Сторона контракта — словами. Путь или имя поля в обратных кавычках сами по себе стороной не считаются: такая
// строка чаще показывает НАШ запрос с упоминанием чужой системы.
const SIDE = new RegExp([
  'контракт', '(?<![a-z])api(?![a-z])', '(?<![а-яё])апи(?![а-яё])', 'эндпоинт', 'endpoint', '(?<![a-z])url(?![a-z])', 'адрес',
  '(?<![а-яё])пут(?:ь|и|ей|ям|ях)(?![а-яё])', '(?<![а-яё])метод', 'топик', 'очеред[ьи]', 'exchange', 'формат', 'схем[аыуе]',
  'структур', '(?<![а-яё])пол(?:я|ей|ям|ях)(?![а-яё])', 'payload', 'протокол', 'код\\S*\\s+(?:ошиб|ответ|возврат)',
  'документаци', 'описани', 'swagger', 'openapi', 'авториз', 'аутентифи', '(?<![а-яё])доступ', 'подключ', 'идентификатор',
  'как(?:ие|ое|ой|им|ими|ого)\\s+(?:именно\\s+)?(?:событ|сообщ|запрос|вызов)',
  '(?:имя|имена|названи\\S*|состав|содержим\\S*|тел[оа])\\s+(?:событ|сообщ|запрос|ответ)', 'в каком виде',
  'как\\s+(?:именно\\s+)?(?:\\S+\\s+){0,2}(?:вызыва|обраща|переда|присыла|приход|отда|сообща|обознача|идентифицир|отвеча)',
].join('|'), 'i')
const noCode = (l) => l.replace(/`[^`]*`/g, ' ').replace(/(^|[\s(«"'])\/[\w/{}.:?=&-]+/g, '$1 ')
const isList = (l) => /^([-*•]|\d+[.)])\s/.test(l) || /^[|>]/.test(l)

// Строка-вопрос относится к чужой системе, если называет её сама либо стоит под заголовком, который её называет
// (`#`-заголовок, строка целиком жирным, строка с «:» на конце).
function contractQuestions (text, sys) {
  const asked = []; const other = []
  let ctx = false; let blank = true
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    if (!l) { blank = true; continue }
    const hard = /^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*:?$/.test(l)
    if (hard) ctx = sys.test(l)
    else if (/:$/.test(l) && sys.test(l)) ctx = true
    else if (blank && !isList(l) && !/:$/.test(l) && !sys.test(l)) ctx = false
    blank = false
    if (!ASK.test(l) || !(sys.test(l) || ctx)) continue
    ;(SIDE.test(noCode(l)) ? asked : other).push(l.replace(/\s+/g, ' ').slice(0, 260))
  }
  return { asked, other }
}

// ── идентификаторы ───────────────────────────────────────────────────────────────────────────────────────────────
const STOP = new Set(('string str number int integer long float double decimal boolean bool null true false uuid iso8601 date datetime ' +
  'timestamp time object array list enum json xml csv http https rest grpc soap kafka rabbitmq api tbd get post put patch delete ' +
  'fe be ui ux sql ddl utc url uri ok sync async e.g i.e n/a').split(' '))
const SKIP = /^(?:(?:INT|FR|NFR|AC|TC)-?\d+|.*\.(?:md|ya?ml|json|txt|puml|mjs|sh))$/i
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// `Сущность.поле` ищется и целиком, и по имени поля: в нашей таблице данных поле стоит без имени сущности.
const forms = (tok) => (/^[A-Z][A-Za-z0-9]*\.[A-Za-z_]\w*$/.test(tok) ? [tok, tok.split('.')[1]] : [tok])
const has = (hay, tok) => forms(tok).some((f) => new RegExp(`(?<![A-Za-z0-9_])${esc(f)}(?![A-Za-z0-9_])`, 'i').test(hay))
const UNIT = (u) => (/^(мс|ms|миллисек)/i.test(u) ? 'мс' : /^мин/i.test(u) ? 'мин' : 'с')
const DUR = /(\d+(?:[.,]\d+)?)\s*(мс|ms|миллисекунд[а-яё]*|секунд[а-яё]*|сек|с|s|минут[а-яё]*|мин)(?![\p{L}\p{N}])/giu
const durations = (text) => new Set([...text.matchAll(DUR)].map((m) => `${m[1].replace(',', '.')} ${UNIT(m[2])}`))
const WAIT = /(?:таймаут|тайм-аут|timeout|жд[её]м|ожидан|не дольше|SLA|время ответа|отвеча\S* за)[^.\n|;]{0,80}/giu

function spanTokens (s) {
  const out = []
  for (let p of s.split(/[\s|,;=()[\]"'→]+/)) {
    if (p.startsWith('/')) p = p.split('?')[0].replace(/[.:]+$/, '')
    else p = p.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    if (p && (/[A-Za-z]/.test(p) || /^[1-5]\d\d$/.test(p))) out.push(p)
  }
  return out
}
const GENERIC = [
  /(?<![\p{L}\p{N}_<\/.])\/[A-Za-z][\w{}:.-]*(?:\/[\w{}:.-]+)*/gu, // путь
  /(?<![\p{L}\p{N}_.\/-])[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+(?![\p{L}\p{N}_])/gu, // имя.через.точку
  /(?<![\p{L}\p{N}_])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![\p{L}\p{N}_])/gu, // КОД_ОШИБКИ
  /(?<![\p{L}\p{N}_])[a-z]+[a-z0-9]*(?:[A-Z][a-z0-9]+)+(?![\p{L}\p{N}_])/gu, // camelCase
  /(?<![\p{L}\p{N}_])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\p{L}\p{N}_])/gu, // snake_case
]
const HTTP_CODE = /(?:HTTP|код\S*|статус\S*|ответ\S*)\s+`?([1-5]\d\d)(?!\d)/giu

// Идентификаторы одной строки: [{ t, hard, dur }]. `inFence` — строка внутри блока кода.
function lineTokens (line, inFence) {
  const out = []
  const add = (t, hard = false) => { if (t && !STOP.has(t.toLowerCase()) && !SKIP.test(t)) out.push({ t, hard }) }
  if (inFence) for (const m of line.matchAll(/"([A-Za-z_][\w.-]*)"\s*:/g)) add(m[1], true)
  const row = !inFence && line.match(/^\s*\|\s*`([^`]+)`\s*\|/)
  if (row) spanTokens(row[1]).forEach((t) => add(t, true))
  if (!inFence) for (const m of line.matchAll(/`([^`]+)`/g)) spanTokens(m[1]).forEach((t) => add(t))
  const bare = inFence ? line : line.replace(/`[^`]*`/g, ' ')
  for (const re of GENERIC) for (const m of bare.matchAll(re)) add(m[0].replace(/[.:]+$/, ''))
  for (const m of line.matchAll(HTTP_CODE)) add(m[1])
  for (const w of line.matchAll(WAIT)) for (const d of durations(w[0])) out.push({ t: `таймаут ${d}`, hard: false, dur: d })
  return out
}

// ── разбор спеки ─────────────────────────────────────────────────────────────────────────────────────────────────
const FRONT = /(?<![A-Za-z])FE(?![A-Za-z])|фронт|(?<![A-Za-z])UI(?![A-Za-z])|браузер|веб-клиент/i
const OWN_SUB = /^(3\.2|3\.3)$/
const OWN_H2 = new Set([4, 7, 9])

function zones (spec, sys) {
  const lines = spec.split('\n')
  const info = lines.map(() => ({ zone: 'text', fence: false, card: -1 }))
  const cards = []
  let h2 = 0; let sub = ''; let card = null; let catalog = false; let fence = false
  lines.forEach((l, i) => {
    const t = l.trim()
    if (/^```/.test(t)) { info[i].fence = true; fence = !fence } else info[i].fence = fence
    const h = !fence && l.match(/^(#{2,4})\s+(.*)$/)
    if (h) {
      const isInt = /^\**\s*INT-\d+/i.test(h[2])
      if (h[1].length === 2) { h2 = Number((h[2].match(/^(\d+)\./) || [0, h2 + 100])[1]); sub = ''; card = null; catalog = false }
      if (isInt) { card = { head: l, from: i, lines: [], dir: '' }; cards.push(card); catalog = false } else if (h[1].length <= 3) {
        card = null; catalog = /Каталог ошибок/i.test(h[2])
        const s = h[2].match(/^(\d+\.\d+)/); if (h[1].length === 3) sub = s ? s[1] : ''
      }
    }
    if (card) { card.lines.push(i); info[i].card = cards.length - 1; if (!card.dir && /Границ|направлени/i.test(l)) card.dir = l }
    info[i].zone = card ? 'card' : catalog || OWN_H2.has(h2) || OWN_SUB.test(sub) ? 'own' : 'text'
  })
  for (const c of cards) {
    c.sys = sys.test(c.head) || sys.test(c.dir)
    c.mixed = c.sys && FRONT.test(c.dir)
    c.foreign = c.sys && !c.mixed
    c.mark = [...new Set((c.head + ' ' + (lines.slice(c.from, c.from + c.lines.length).find((x) => /Происхождение/i.test(x)) || '')).match(/🟢|🔵|🟡|❓/gu) || [])].join('')
  }
  return { lines, info, cards }
}

function openItems (spec) {
  const lines = spec.split('\n')
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) {
    const t = lines[j].replace(/^>\s?/, '').trim()
    if (/^(\d+[.)]|[-*•])\s/.test(t)) out.push(t)
    else if (out.length && t && !/^\*?\(/.test(t)) out[out.length - 1] += ' ' + t
  }
  return out
}
// Пункт «о стыке»: называет чужую систему и что-то об обмене с ней.
const OPEN_SIDE = new RegExp(SIDE.source + '|обмен|интеграц|стык|взаимодейств|событи|сообщени|ошибк|таймаут|сопостав|вызов|запрос|ответ', 'i')

function gradeSpec (spec, cfg) {
  const { lines, info, cards } = zones(spec, cfg.sys)
  const srcDur = durations(cfg.sources)
  const known = (k) => (k.dur ? srcDur.has(k.dur) : has(cfg.sources, k.t))
  const foreign = cards.filter((c) => c.foreign)
  const inF = (i) => info[i].card >= 0 && cards[info[i].card].foreign
  const sysLine = (i) => !inF(i) && info[i].zone === 'text' && cfg.sys.test(lines[i])
  const byLines = foreign.length === 0
  const scope = byLines ? sysLine : inF // где ищем идентификаторы чужого стыка
  const outside = lines.filter((_, i) => !scope(i)).join('\n')
  const red = new Set(); const soft = new Set(); const aside = new Set()
  lines.forEach((l, i) => {
    if (scope(i)) {
      for (const k of lineTokens(l, info[i].fence)) {
        if (known(k)) continue
        if (k.hard || !(k.dur ? durations(outside).has(k.dur) : has(outside, k.t))) red.add(k.t); else soft.add(k.t)
      }
    } else if (sysLine(i)) for (const k of lineTokens(l, info[i].fence)) if (!known(k)) aside.add(k.t)
  })
  for (const t of red) soft.delete(t)
  const open = openItems(spec)
  const openForeign = open.filter((t) => cfg.sys.test(t) && OPEN_SIDE.test(t))
  const status = ((spec.match(/\*\*Статус готовности:\*\*\s*(.*)/) || [])[1] || '').trim()
  return {
    byLines, red: [...red], soft: [...soft], aside: [...aside], open: open.length, openForeign, status,
    cards: foreign.map((c) => `${(c.head.match(/INT-\d+/i) || ['INT'])[0]}${c.mark ? ' ' + c.mark : ''}`),
    mixed: cards.filter((c) => c.mixed).map((c) => (c.head.match(/INT-\d+/i) || ['INT'])[0]),
    c3: red.size === 0,
    c4: openForeign.length > 0 && status !== '' && !/Готово/i.test(status),
  }
}

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return ''
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return ''
}

export function gradeRun (dir, cfg) {
  const turns = []
  for (let n = 1; n <= 12; n++) { const t = turn(dir, n); if (!t.exists) break; turns.push(t) }
  if (!turns.length || readdirSync(dir).some((f) => /^_api-failure/.test(f))) return { measured: false }
  const qs = turns.map((t) => contractQuestions(t.text, cfg.sys))
  const qTurn = qs.findIndex((q) => q.asked.length > 0) + 1 // 0 — вопроса не было
  let wTurn = turns.findIndex((t) => t.wrote) + 1 // 0 — записи в потоках нет
  const specPath = findSpec(dir)
  const r = { measured: true, turns: turns.length, qTurn, file: !!specPath, note: [] }
  if (specPath && !wTurn) { wTurn = turns.length; r.note.push('запись спеки в потоках не найдена — считаю последним ходом') }
  r.wTurn = wTurn
  r.asked = qTurn ? qs[qTurn - 1].asked : []
  r.other = qs.flatMap((q) => q.other).slice(0, 6)
  r.askedIds = [...new Set(qs.flatMap((q) => q.asked).flatMap((l) => lineTokens(l, false)).filter((k) => !k.dur && !has(cfg.sources, k.t)).map((k) => k.t))]
  r.c1 = qTurn > 0 && (!wTurn || qTurn < wTurn)
  r.c2 = !wTurn || (qTurn > 0 && qTurn < wTurn)
  if (wTurn && qTurn === wTurn) r.note.push('вопрос и запись на одном ходе — ответа агент не ждал')
  if (specPath) Object.assign(r, { spec: gradeSpec(read(specPath), cfg) })
  if (r.spec && /ПРОСТАВЛЯЕТСЯ/i.test(r.spec.status)) r.note.push('статус — заглушка: диалог кончился до проставления')
  r.verdict = !r.file ? 'без файла' : r.c1 && r.c2 && r.spec.c3 && r.spec.c4 ? 'зелёный' : 'КРАСНЫЙ'
  return r
}

function report (probe, dir, cfg) {
  const runs = readdirSync(dir).filter((x) => /^run-/.test(x)).sort()
  const all = runs.map((name) => ({ name, r: gradeRun(join(dir, name), cfg) }))
  const m = all.filter((x) => x.r.measured); const f = m.filter((x) => x.r.file)
  const line = (set, label, fn) => { const bad = set.filter((x) => !fn(x.r)).map((x) => x.name); console.log(`   ${set.length - bad.length}/${set.length}  ${label}${bad.length ? '   ✗ ' + bad.join(' ') : ''}`) }
  console.log(`\n-- ${probe}: измерено ${m.length} из ${runs.length}; с файлом спеки ${f.length}`)
  line(m, '(1) вопрос о контракте чужой системы задан раньше хода записи', (r) => r.c1)
  line(m, '(2) спека не записана на ходе, до которого вопроса не было', (r) => r.c2)
  line(f, '(3) в чужом стыке нет идентификаторов вне источников', (r) => r.spec.c3)
  line(f, '(4) «Открытые вопросы»: есть пункт о стыке с чужой системой, статус не «Готово»', (r) => r.spec.c4)
  const cnt = (v) => m.filter((x) => x.r.verdict === v).length
  console.log(`   итог: зелёных ${cnt('зелёный')}, красных ${cnt('КРАСНЫЙ')}, без файла ${cnt('без файла')}`)
  for (const { name, r } of all) {
    if (!r.measured) { console.log(`   ${name} не измерен`); continue }
    const s = r.spec
    console.log(`   ${name} [${r.verdict}] ходов ${r.turns}; вопрос — ${r.qTurn ? 'ход ' + r.qTurn : 'нет'}; запись — ${r.wTurn ? 'ход ' + r.wTurn : 'нет'}` +
      (s ? `; статус: «${s.status}»; открытых ${s.open}, о стыке ${s.openForeign.length}; карточки чужого стыка: ${s.cards.join(', ') || 'нет (по строкам)'}` : ''))
    for (const n of r.note) console.log(`      ! ${n}`)
    if (s && s.red.length) console.log(`      ✗ вне источников${s.byLines ? ' (по строкам)' : ''}: ${s.red.join('  ')}`)
    if (s && s.soft.length) console.log(`      ? также в нашем дизайне: ${s.soft.join('  ')}`)
    if (s && s.aside.length) console.log(`      ? в строках о чужой системе вне её карточек: ${s.aside.join('  ')}`)
    if (s && s.mixed.length) console.log(`      ? карточка «фронт + чужая система» (не разбиралась как чужая): ${s.mixed.join(', ')}`)
    if (s) for (const o of s.openForeign.slice(0, 4)) console.log(`      открыто: ${o.slice(0, 200)}`)
    for (const q of r.asked.slice(0, 4)) console.log(`      вопрос: ${q}`)
    if (r.askedIds.length) console.log(`      ? в вопросе своя конкретика: ${r.askedIds.join('  ')}`)
    if (!r.qTurn) for (const q of r.other.slice(0, 3)) console.log(`      не засчитан вопросом о контракте: ${q}`)
  }
}

// ── самотест ─────────────────────────────────────────────────────────────────────────────────────────────────────
function selftest () {
  const root = mkdtempSync(join(tmpdir(), 'fx-unk-selftest-'))
  const cfg = {
    sys: /Маяк/i,
    sources: 'БТ: магазин передаёт заказ в систему доставки «Маяк» (команда «Логистика»). Наш сервис shop-api, `GET /v1/orders`, роль `SHOP_ADMIN`.\n' +
      'Аналитик: ответа «Маяка» ждём не дольше 5 секунд. Реплика: как устроен обмен с «Маяком», не знаю.',
  }
  const ev = (content) => JSON.stringify({ type: 'assistant', message: { content } })
  const say = (text) => ({ type: 'text', text })
  const write = (content) => ({ type: 'tool_use', name: 'Write', input: { file_path: 'coddoc/SHP-1/technical_specification.md', content } })
  const mk = (name, turns, spec) => {
    const d = join(root, name); mkdirSync(d, { recursive: true })
    turns.forEach((t, i) => writeFileSync(join(d, i === 0 ? 'stream.jsonl' : `stream-${String(i + 1).padStart(2, '0')}.jsonl`), t.map((c) => ev([c])).join('\n') + '\n'))
    if (spec) { mkdirSync(join(d, 'coddoc', 'SHP-1'), { recursive: true }); writeFileSync(join(d, 'coddoc', 'SHP-1', 'technical_specification.md'), spec) }
    return d
  }
  const spec = ({ status, open, card }) => [
    '# Техническая спецификация: передача заказа в доставку', '',
    '> **Задача:** SHP-1', `> **Статус готовности:** ${status}`, '>',
    '> **Открытые вопросы (решить до / во время разработки):**',
    ...(open.length ? open.map((o, i) => `> ${i + 1}. ${o}`) : ['> *Все технические решения приняты, спецификация готова к разработке.*']), '',
    '## 1. Обзор изменения', '### 1.2. Затронутые сервисы и владельцы', '- shop-api — наш; «Маяк» — чужая система, команда «Логистика».', '',
    '## 2. Взаимодействия (ядро)', '### INT-1. Оформление заказа с передачей в «Маяк» — 🟢',
    '- **Граница/направление:** FE → BE (shop-api)', '- **Контракт (запрос):** `POST /v1/orders`', '',
    '  | Поле | Тип | Обяз. | Пример | Описание |', '  |------|-----|-------|--------|----------|', '  | `itemId` | string | да | "a1" | товар |', '',
    '- **Ошибки:** `503 DELIVERY_UNAVAILABLE` — «Маяк» не ответил', '- **Происхождение:** 🟢Н', '',
    ...card, '',
    '### Каталог ошибок (сводно)', '| Код | Тело/сообщение | Когда | Состояние UI |', '|-----|----------------|-------|--------------|',
    '| `503 DELIVERY_UNAVAILABLE` | доставка недоступна | «Маяк» не ответил за 5 секунд | ошибка |', '',
    '## 3. Backend — ответственность', '### 3.2. Данные и хранение', '| Поле | Тип | Описание |', '|---|---|---|',
    '| `deliveryRef` | string? | ссылка на доставку в «Маяке» |', '',
    '## 6. Релиз и интеграция', '### 6.5. Преднастройка до релиза', '- подключение shop-api к «Маяку» — заявкой в команду «Логистика».', '',
  ].join('\n')
  const words = ['### INT-2. Передача заказа в «Маяк» — 🟡', '- **Граница/направление:** shop-api → «Маяк»',
    '- **Контракт (запрос):** словами: передаём состав заказа и адрес; в ответ ждём подтверждение. Адрес вызова, поля и коды ошибок — ❓ TBD.',
    '- **Ошибки:** «Маяк» не ответил за 5 секунд или отказал — отвечаем фронту `503 DELIVERY_UNAVAILABLE`.', '- **Происхождение:** 🟡']
  const invented = ['### INT-2. Событие о заказе в «Маяк» — 🟢', '- **Граница/направление:** shop-api → «Маяк» (событие)',
    '- **Контракт (запрос):** топик `mayak.orders.created`', '',
    '  | Поле | Тип | Обяз. | Пример | Описание |', '  |------|-----|-------|--------|----------|',
    '  | `orderId` | string | да | "o1" | заказ |', '  | `dropAddress` | string | да | "…" | адрес |', '',
    '  ```json', '  { "orderId": "o1", "dropAddress": "…" }', '  ```', '- **Ошибки:** `E_ADDR_UNKNOWN` — адрес не найден; таймаут «Маяка» 30 секунд', '- **Происхождение:** 🟢Н']
  const ownIds = [...words.slice(0, 3), '- **Триггер:** INT-1 (`POST /v1/orders`); ответ «Маяка» кладём в `deliveryRef`, заказы читаем как в `GET /v1/orders`.', ...words.slice(3)]
  const openOk = ['🟡 Контракт «Маяка»: адрес вызова, поля запроса и ответа, коды ошибок — неизвестны, узнать у команды «Логистика».', '🟡 Как shop-api авторизуется в «Маяке».']
  const ask = 'Реестр гейтов: 3 — ❓.\n\n**Стык с «Маяком»**\n1. Какой у «Маяка» адрес и метод приёма заказа, какие поля он ждёт?\n2. Как он отвечает на ошибки?'
  const ownAsk = 'INT-1 — оформление заказа, при сбое «Маяка» показываем сообщение. Годится?'
  const done = 'Спека записана: coddoc/SHP-1/technical_specification.md.'
  const need = spec({ status: 'Требуются уточнения (2)', open: openOk, card: words })
  const cases = [
    ['зелёный: вопрос на ходе 1, запись на ходе 2, стык словами, открытый пункт', mk('green', [[say(ask)], [write(need), say(done)]], need),
      { c1: true, c2: true, c3: true, c4: true, verdict: 'зелёный' }],
    ['выдумал топик и поля', mk('invented', [[say(ask)], [say(done), write('x')]], spec({ status: 'Требуются уточнения (2)', open: openOk, card: invented })),
      { c1: true, c2: true, c3: false, c4: true, verdict: 'КРАСНЫЙ', red: ['mayak.orders.created', 'orderId', 'dropAddress', 'E_ADDR_UNKNOWN', 'таймаут 30 с'] }],
    ['записал без вопроса на ходе 1', mk('nowait', [[say('Пишу спеку.'), write(need), say(done)]], need),
      { c1: false, c2: false, c3: true, c4: true, verdict: 'КРАСНЫЙ' }],
    ['статус «Готово» при неизвестном контракте', mk('ready', [[say(ask)], [write('x'), say(done)]], spec({ status: 'Готово к разработке', open: [], card: words })),
      { c1: true, c2: true, c3: true, c4: false, verdict: 'КРАСНЫЙ' }],
    ['только вопросы, файла нет; вопрос о нашем запросе вопросом о контракте не считается', mk('nofile', [[say(ownAsk)], [say(ask)], [say(ask)]], ''),
      { c1: true, c2: true, verdict: 'без файла', qTurn: 2 }],
    ['своё имя, свой путь и срок из реплики в карточке чужого стыка — не красное', mk('own-ids', [[say(ask)], [write('x'), say(done)]], spec({ status: 'Требуются уточнения (2)', open: openOk, card: ownIds })),
      { c1: true, c2: true, c3: true, c4: true, verdict: 'зелёный', soft: ['deliveryRef', '503', 'DELIVERY_UNAVAILABLE'] }],
  ]
  let failed = 0
  for (const [name, dir, want] of cases) {
    const r = gradeRun(dir, cfg)
    const got = { c1: r.c1, c2: r.c2, c3: r.spec ? r.spec.c3 : undefined, c4: r.spec ? r.spec.c4 : undefined, verdict: r.verdict, qTurn: r.qTurn }
    const bad = []
    for (const k of ['c1', 'c2', 'c3', 'c4', 'verdict', 'qTurn']) if (k in want && want[k] !== got[k]) bad.push(`${k}: ждали ${want[k]}, вышло ${got[k]}`)
    for (const k of ['red', 'soft']) if (want[k]) for (const t of want[k]) if (!r.spec[k].includes(t)) bad.push(`${k}: нет «${t}» (вышло: ${r.spec[k].join(', ') || '—'})`)
    if (want.verdict === 'зелёный' && r.spec.red.length) bad.push(`лишнее красное: ${r.spec.red.join(', ')}`)
    console.log(`${bad.length ? 'FAIL' : 'ok  '}  ${name}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`)
    if (bad.length) failed++
  }
  rmSync(root, { recursive: true, force: true })
  console.log(failed ? `\nсамотест: провалено ${failed} из ${cases.length}` : `\nсамотест: ${cases.length} из ${cases.length}`)
  process.exit(failed ? 1 : 0)
}

// ── запуск ───────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  if (!arg || arg.startsWith('--')) { console.error('usage: node grade-fx-unk.mjs <папка-раунда> | --selftest'); process.exit(1) }
  let seen = 0
  for (const [probe, p] of Object.entries(PROBES)) {
    const dir = join(arg, probe)
    if (!existsSync(dir)) continue
    seen++
    report(probe, dir, { sys: p.sys, sources: loadSources(p.fixture) })
  }
  if (!seen) { console.error(`в ${arg} нет папок проб: ${Object.keys(PROBES).join(', ')}`); process.exit(1) }
}
