#!/usr/bin/env node
// grade-sm-k.mjs <папка-раунда> — таблица замера K-1/K-2 (run-sm-k.sh): кусок → ключей по правде → ключей
// в описи → карточка записана → пик контекста → цена → длительность; затем оценка K по кускам repairy-api.
//
//   node grade-sm-k.mjs runs/<раунд>          (SM_K_LIMIT — порог пика, по умолчанию 200000)
//
// Пик — max по ходам (input_tokens + cache_creation_input_tokens + cache_read_input_tokens) у событий БЕЗ
// parent_tool_use_id: читающий в run-sm-k.sh — верхний уровень `claude -p`. Если в потоке есть субагенты
// (Agent был разрешён или это чужой стрим), их пики печатаются отдельно, в столбец не идут.
//
// Ключи в описи — строки без отступа с « — », по классам: эндпоинт (глагол HTTP или путь от «/»), топик
// («потребляет|публикует …»), сущность (имя в PascalCase и источник .prisma или маркер хранения в скобках),
// задача (одиночный идентификатор). Бизнес-строки (состояние/справочник/сообщение/ограничение), роли,
// экраны, заголовки и пояснения ключами не считаются и идут в «прочих». Форма классов снята с настоящих
// описей стенда (у сущностей Prisma маркера в скобках обычно нет, у ролей источник — та же схема).
//
// K — МНК по точкам K-1 со статусом «измерено» и записанной карточкой: x = ключей по правде (пересчёт по
// засеву из _piece.json), y = пик; K = наибольшее число ключей с прогнозом пика ≤ порога. K-2 — пик против
// числа файлов, без оценки. Грейдить ТОЛЬКО после завершения всех прогонов раунда.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROUND = process.argv[2]
if (!ROUND) { console.error('grade-sm-k: нужна папка раунда'); process.exit(1) }
const LIMIT = Number(process.env.SM_K_LIMIT || 200000)
const PIECES = JSON.parse(readFileSync(join(HERE, 'fixtures', 'SM-K', 'pieces.json'), 'utf8')).pieces
const ORDER = Object.keys(PIECES)
const SB = join(ROUND, 'sandbox')
if (!existsSync(SB)) { console.error(`grade-sm-k: нет ${SB}`); process.exit(1) }

const fmt = n => (n == null || Number.isNaN(n)) ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const read = f => existsSync(f) ? readFileSync(f, 'utf8') : ''
const norm = p => String(p || '').replace(/\\/g, '/').toLowerCase()

function stream(f) {
  const r = { peak: 0, first: 0, turns: 0, reads: [], subs: new Map(), result: null }
  for (const line of read(f).split('\n')) {
    if (!line.trim()) continue
    let e; try { e = JSON.parse(line) } catch { continue }
    if (e.type === 'result' && !e.parent_tool_use_id) { r.result = e; continue }
    if (e.type !== 'assistant' || !e.message) continue
    const u = e.message.usage || {}
    const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    if (e.parent_tool_use_id) {
      const s = r.subs.get(e.parent_tool_use_id) || { desc: e.task_description || '?', peak: 0 }
      s.peak = Math.max(s.peak, ctx); r.subs.set(e.parent_tool_use_id, s)
      continue
    }
    if (!r.first && ctx) r.first = ctx
    r.peak = Math.max(r.peak, ctx); r.turns++
    for (const c of e.message.content || []) if (c.type === 'tool_use' && c.name === 'Read') r.reads.push(c.input?.file_path || '')
  }
  return r
}

const SKIP = ['состояние:', 'справочник:', 'сообщение:', 'ограничение:', 'сущности:', '·', '⟹', '#', '|', '```', '(']
const VERB = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s/
const MARK = /\((model|@Entity|@Table|@Document|@Schema)[^)]*\)/
function opis(text) {
  const c = { э: 0, т: 0, с: 0, з: 0, прочих: 0 }
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!raw.trim() || /^\s/.test(raw)) continue                 // второй уровень — с отступом
    const l = raw.replace(/^[-*]\s+/, '').replace(/`/g, '')
    if (!l.includes(' — ')) continue
    if (SKIP.some(s => l.toLowerCase().startsWith(s))) continue
    const head = l.slice(0, l.indexOf(' — ')).trim()
    const src = l.slice(l.lastIndexOf(' — ') + 3)
    if (VERB.test(l) || l.startsWith('/')) c.э++
    else if (/^(потребляет|публикует)\s/.test(l)) c.т++
    else if (/^[A-Z][a-z][A-Za-z0-9_]*(\s*\([^)]*\))?$/.test(head) && (src.includes('.prisma') || MARK.test(l))) c.с++
    else if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(head)) c.з++
    else c.прочих++
  }
  return { keys: c.э + c.т + c.с + c.з, ...c }
}

const runs = []
for (const d of readdirSync(SB).sort()) {
  const sb = join(SB, d)
  if (!statSync(sb).isDirectory()) continue
  const m = d.match(/^(.+)-(\d+)$/)
  const metaF = join(sb, '_piece.json')
  const meta = existsSync(metaF) ? JSON.parse(readFileSync(metaF, 'utf8')) : (m && PIECES[m[1]] ? { piece: m[1], ...PIECES[m[1]] } : null)
  if (!meta) { console.error(`  пропуск ${d}: нет _piece.json и кусок не опознан`); continue }
  const piece = meta.piece, def = PIECES[piece] || {}
  const run = { name: d, piece, n: m ? Number(m[2]) : 0, kind: meta.kind || def.kind || '?', fixture: meta.fixture || def.fixture }
  run.truth = meta.recountKeys ?? meta.keys ?? def.keys
  run.truthNote = meta.recountKeys != null && meta.keys != null && meta.recountKeys !== meta.keys ? `правда pieces.json ${meta.keys}, пересчёт по засеву ${meta.recountKeys}` : ''
  run.files = meta.files ?? def.files
  const sf = join(sb, '_stream.jsonl')
  if (!existsSync(sf)) { run.status = 'не запущен'; runs.push(run); continue }
  const s = stream(sf)
  Object.assign(run, { peak: s.peak, first: s.first, turns: s.turns, subs: [...s.subs.values()] })
  if (existsSync(join(sb, '_api-failure.txt'))) run.status = 'не измерено (API)'
  else if (read(join(sb, 'answer.md')).trim() && s.result && !s.result.is_error) run.status = 'измерено'
  else run.status = s.result ? `отказ (${s.result.subtype || 'ошибка'})` : 'отказ (нет result — таймаут/обрыв)'
  const cost = read(join(sb, 'cost.txt')).trim() || read(join(sb, '_cost.txt')).trim()
  run.cost = cost ? Number(cost) : s.result?.total_cost_usd
  const t = read(join(sb, '_time.txt')).trim().split(/\s+/).map(Number)
  run.min = s.result?.duration_ms ? s.result.duration_ms / 60000 : (t.length === 2 && t[1] > t[0] ? (t[1] - t[0]) / 60 : null)
  const work = join(sb, 'w', 'AI-SDD', 'services', '.work')
  const repo = { repairy: 'repairy-api', 'nrs-tail': 'cargonet' }[run.fixture] || 'repairy-api'
  const bn = p => String(p || '').replace(/\\/g, '/').split('/').pop()
  const of = join(work, bn(meta.opis) || `${repo}.opis.md`)
  const cf = join(work, bn(meta.draft) || `${repo}.md`)
  run.opis = existsSync(of) ? opis(read(of)) : null
  if (existsSync(cf) && statSync(cf).size > 0) run.card = `да, ${Math.round(statSync(cf).size / 1024)} КБ`
  else {
    // Не там, где велел бриф? Любая .md в services/, кроме описи.
    const svc = join(sb, 'w', 'AI-SDD', 'services'), alt = []
    const walk = p => { if (!existsSync(p)) return; for (const x of readdirSync(p)) { const q = join(p, x); if (statSync(q).isDirectory()) walk(q); else if (x.endsWith('.md') && !x.endsWith('.opis.md')) alt.push(relative(svc, q)) } }
    walk(svc)
    run.card = alt.length ? `нет (не там: ${alt.join(', ')})` : 'нет'
  }
  run.written = run.card.startsWith('да')
  const paths = (meta.paths || []).map(norm)
  run.reads = s.reads.length
  run.readsIn = s.reads.filter(r => paths.some(p => norm(r).startsWith(p))).length
  runs.push(run)
}
runs.sort((a, b) => (ORDER.indexOf(a.piece) - ORDER.indexOf(b.piece)) || (a.n - b.n))

console.log(`Раунд: ${ROUND}   порог пика: ${fmt(LIMIT)}\n`)
console.log('| прогон | вид | ключей (правда) | в описи | карточка | файлов | пик | цена | мин | статус |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
for (const r of runs) {
  const o = r.opis ? `${r.opis.keys} (э${r.opis.э}${r.opis.т ? ' т' + r.opis.т : ''} с${r.opis.с} з${r.opis.з}; прочих ${r.opis.прочих})` : (r.status === 'не запущен' ? '—' : 'нет описи')
  console.log(`| ${r.name} | ${r.kind} | ${fmt(r.truth)} | ${o} | ${r.card || '—'} | ${fmt(r.files)} | ${fmt(r.peak)} | ${r.cost != null && !Number.isNaN(r.cost) ? '$' + r.cost.toFixed(2) : '—'} | ${r.min != null ? r.min.toFixed(0) : '—'} | ${r.status} |`)
}

function ols(pts) {
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0)
  const syy = pts.reduce((s, p) => s + (p.y - my) ** 2, 0)
  const a = sxy / sxx, b = my - a * mx
  return { a, b, r2: syy ? (sxy * sxy) / (sxx * syy) : 1, K: a > 0 ? Math.floor((LIMIT - b) / a) : null }
}
const k1 = runs.filter(r => r.kind === 'K-1' && r.status === 'измерено' && r.written && r.peak)
const sizes = new Set(k1.map(r => r.truth)).size
console.log(`\nK-1 (repairy-api): точек ${k1.length}, размеров ${sizes}`)
if (sizes >= 2) {
  const t = ols(k1.map(r => ({ x: r.truth, y: r.peak })))
  console.log(`  по правде: токенов на ключ ≈ ${fmt(t.a)}, старт ≈ ${fmt(t.b)} (R² ${t.r2.toFixed(2)})`)
  console.log(t.K != null ? `  K = ${t.K} — наибольшее число ключей с прогнозом пика ≤ ${fmt(LIMIT)}` : '  K: наклон ≤ 0 — оценки нет')
  const ko = k1.filter(r => r.opis && r.opis.keys)
  if (new Set(ko.map(r => r.opis.keys)).size >= 2) {
    const o = ols(ko.map(r => ({ x: r.opis.keys, y: r.peak })))
    console.log(`  по описи вместо правды: на ключ ≈ ${fmt(o.a)}, старт ≈ ${fmt(o.b)}, K = ${o.K ?? '—'}`)
  }
} else console.log('  оценки нет: нужно ≥ 2 размеров с записанной карточкой')
const firsts = runs.filter(r => r.first).map(r => r.first)
if (firsts.length) console.log(`  первый ход (старт по замеру, все прогоны): ${fmt(Math.min(...firsts))}–${fmt(Math.max(...firsts))}`)

const k2 = runs.filter(r => r.kind === 'K-2' && r.peak)
if (k2.length) {
  console.log('\nK-2 (пик против числа файлов, без оценки):')
  for (const r of k2) console.log(`  ${r.name}: пик ${fmt(r.peak)} на ${fmt(r.files)} файлах, ключей ${fmt(r.truth)} (в описи ${r.opis ? r.opis.keys : '—'}); Read ${r.reads}, из них в путях куска ${r.readsIn}; ${r.status}`)
}

const warn = []
for (const r of runs) {
  if (r.truthNote) warn.push(`${r.name}: ${r.truthNote}`)
  if (r.subs && r.subs.length) warn.push(`${r.name}: в потоке субагенты (${r.subs.length}) — пик в таблице только верхнего уровня: ${r.subs.map(s => `«${s.desc}» ${fmt(s.peak)}`).join('; ')}`)
  if (r.status === 'измерено' && !r.written) warn.push(`${r.name}: измерено, но карточки на месте нет — в оценку K не идёт`)
}
if (runs.some(r => r.status === 'не запущен')) warn.push('есть песочницы без _stream.jsonl — прогоны не шли или ещё идут: грейдить после завершения всех')
if (warn.length) { console.log('\nПредупреждения:'); for (const w of warn) console.log('  ' + w) }
