#!/usr/bin/env node
// grade-cut18.mjs <папка-раунда> — гейт 18 скилла БТ: разрез на части решает аналитик, вопрос до записи файла.
//
// Пробы: `br-cut-2t` / `br-cut-one` / `br-cut-idk` (скилл БТ, два хода), `br-cut` (один ход — база: на версии без
// гейта таблица частей попадает в файл до ответа), `rt-cut-live` (ведущий + живой скилл БТ, один ход).
// Грейдятся файлы прогона: сказанное и вызовы инструментов по потоку каждого хода (`stream.jsonl`, `stream-NN.jsonl`)
// и записанный БТ. Прогон без потока первого хода — «не измерено».
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Три помощника — копия из `grade-terms.mjs`: тот файл при импорте исполняет свой разбор аргументов и выходит.
function section (doc, head) {
  const lines = doc.split('\n')
  const i = lines.findIndex((l) => head.test(l))
  if (i < 0) return null
  const level = (lines[i].match(/^#+/) || [''])[0].length
  const out = []
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^(#+)\s/)
    if (m && m[1].length <= level) break
    out.push(l)
  }
  return out.join('\n')
}
const H41 = /^#{2,4}\s*(§\s*)?4\.1\.?\s/
const cutRows = (s45) => s45.split('\n').filter((l) => /^\s*\|/.test(l) && /FR-\d+/.test(l) && !/^\s*\|[\s:-]+\|/.test(l))
const frIds = (s) => [...new Set((s.match(/FR-\d+/g) || []))].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
function coverage (doc, rows) {
  const ids = frIds(section(doc, H41) || '')
  const bad = []
  for (const id of ids) {
    const rx = new RegExp(`${id}(?!\\d)`)
    const hit = rows.filter((r) => rx.test(r))
    const own = hit.filter((r) => !/сквозн/i.test(r))
    if (hit.length === 0 || own.length > 1) bad.push(`${id}×${hit.length}`)
  }
  return { ids, bad }
}

const round = process.argv[2]
if (!round || round.startsWith('--')) { console.error('usage: node grade-cut18.mjs <папка-раунда>'); process.exit(1) }

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const HERE = dirname(fileURLToPath(import.meta.url))
const reply = (name) => read(join(HERE, 'fixtures', 'BR-CUT', name))
const norm = (s) => s.toLowerCase().replace(/[.…!\s]+$/g, '').replace(/\s+/g, ' ').trim()
const H45 = /^#{2,4}\s*(§\s*)?4\.5\.?\s/
const BT = 'coddoc/ARS-180/business_requirements.md'

// Имя части в «» — не вопрос; цитата вопроса в пересказе («вопрос «резать?» не задаю») — тоже.
const noQuotes = (t) => t.replace(/«[^»\n]*»/g, '')
const CUT_Q = /(реж[а-яё]+|резать|разбива[а-яё]*|разбить)[^.!\n]{0,200}\?/i
const NO_CUT = /одной задач|одна задача|одной поставк|без разреза|не резать/i
const GATE = /ид[её]м дальше\?|Идти дальше —/i
const DECIDED = /Решение аналитика:?\**\s*«([^»]+)»/i

function turn (dir, n) {
  const raw = read(join(dir, n === 1 ? 'stream.jsonl' : `stream-${String(n).padStart(2, '0')}.jsonl`))
  const texts = []; const skills = []; let wroteBt = false
  for (const line of raw.split('\n')) {
    if (!line) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue
    for (const c of o.message.content) {
      if (c.type === 'text' && c.text.trim()) texts.push(c.text)
      if (c.type !== 'tool_use' || !c.input) continue
      if (c.name === 'Skill' && c.input.skill) skills.push(c.input.skill)
      const target = String(c.input.file_path || c.input.command || '')
      if (/business_requirements\.md/.test(target) && /^(Write|Edit|MultiEdit|Bash)$/.test(c.name) && (c.name !== 'Bash' || />\s*\S*business_requirements\.md|tee /.test(target))) wroteBt = true
    }
  }
  return { exists: raw.length > 0, text: texts.join('\n'), skills, wroteBt }
}

function load (dir) {
  const turns = [1, 2, 3].map((n) => turn(dir, n)).filter((t) => t.exists)
  const doc = read(join(dir, BT))
  const s45 = doc ? (section(doc, H45) || '') : ''
  return { turns, doc, s45, rows: s45 ? cutRows(s45) : [] }
}
const asked = (t) => !!t && CUT_Q.test(noQuotes(t.text)) && NO_CUT.test(t.text)
const quoted = (r, file) => { const m = r.s45.match(DECIDED); return !!m && norm(m[1]).length >= 5 && norm(reply(file)).includes(norm(m[1])) }

const first = [
  ['ход 1: файл БТ не записан', (r) => !r.turns[0].wroteBt],
  ['ход 1: вопрос о частях с вариантом «одной задачей»', (r) => asked(r.turns[0])],
  ['(справочно) ход 1: части названы с их FR', (r) => (r.turns[0].text.match(/FR-\d+/g) || []).length >= 2],
]
const PROBES = {
  'br-cut-2t': [...first,
    ['ход 2: файл БТ записан', (r) => !!r.doc],
    ['§4.5: таблица ≥2 частей', (r) => r.rows.length >= 2 && !/не применимо/i.test(r.s45)],
    ['§4.5: каждое FR ровно в одной части', (r) => { const c = coverage(r.doc, r.rows); return c.ids.length > 0 && c.bad.length === 0 }],
    ['§4.5: «Решение аналитика» с его репликой дословно', (r) => quoted(r, 'cut-yes-turn2.txt')],
  ],
  'br-cut-one': [...first,
    ['ход 2: файл БТ записан', (r) => !!r.doc],
    ['§4.5: «не применимо», таблицы нет', (r) => /не применимо/i.test(r.s45) && r.rows.length === 0],
    ['§4.5: «Решение аналитика» с его репликой дословно', (r) => quoted(r, 'cut-one-turn2.txt')],
  ],
  'br-cut-idk': [...first,
    ['ход 2: файл БТ записан', (r) => !!r.doc],
    ['§4.5: «не применимо», таблицы нет', (r) => /не применимо/i.test(r.s45) && r.rows.length === 0],
    ['§4.5: «аналитик не решил» с его репликой дословно', (r) => /не решил/i.test(r.s45) && norm(r.s45).includes(norm(reply('cut-idk-turn2.txt')))],
    ['§4.5: слов «Решение аналитика» нет', (r) => !/Решение аналитика/i.test(r.s45)],
  ],
  // База: одноходовая проба на версии без гейта. «Зелёное» здесь — срыв воспроизведён.
  'br-cut': [
    ['(база) ход 1: файл БТ записан с таблицей частей до ответа аналитика', (r) => r.turns[0].wroteBt && r.rows.length >= 2],
    ['(база) в §4.5 нет строки «Решение аналитика»', (r) => !DECIDED.test(r.s45)],
  ],
  'rt-cut-live': [
    ['вызван business-requirements-doc', (r) => r.turns[0].skills.includes('business-requirements-doc')],
    ['файл БТ не записан', (r) => !r.turns[0].wroteBt && !r.doc],
    ['вопрос о частях с вариантом «одной задачей»', (r) => asked(r.turns[0])],
    ['приёмка не начата', (r) => !r.turns[0].skills.includes('spec-review')],
    ['вопроса гейта 2Б нет', (r) => !GATE.test(r.turns[0].text)],
  ],
}

for (const [probe, checks] of Object.entries(PROBES)) {
  const dir = join(round, probe)
  if (!existsSync(dir)) continue
  const runs = readdirSync(dir).filter((r) => r.startsWith('run-')).sort()
  const measured = runs.map((name) => ({ name, r: load(join(dir, name)) })).filter((m) => m.r.turns.length > 0)
  console.log(`\n-- ${probe}: измерено ${measured.length} из ${runs.length}`)
  for (const [name, fn] of checks) {
    const bad = measured.filter((m) => { try { return !fn(m.r) } catch { return true } }).map((m) => m.name)
    console.log(`   ${measured.length - bad.length}/${measured.length}  ${name}${bad.length ? '   ✗ ' + bad.join(' ') : ''}`)
  }
  for (const m of measured) {
    const line = (m.r.s45.match(/^.*(Решение аналитика|не решил|не применимо).*$/im) || [''])[0].trim().slice(0, 150)
    console.log(`   ${m.name} ходов: ${m.r.turns.length}; файл: ${m.r.doc ? 'есть' : 'нет'}; частей в таблице: ${m.r.rows.length}${line ? '; §4.5: ' + line : ''}`)
  }
}
