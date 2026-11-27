#!/usr/bin/env node
// grade-dm.mjs — модель данных в спеке (technical-spec-doc 2.6.0, §3.2 и гейт 7).
//
//   node grade-dm.mjs <папка-плеча> [--sub=stage-2/run-1] [--shared=<регэксп сущности-границы>]
//        [--fields=<поле,поле,…> — имена полей, которые назвал аналитик]
//        [--bt=<БТ: ссылка FR-N в «Источник» сверяется с темой правила>] [--prompt=<промпт аналитика>]
//        [--turn2=<реплика хода 2>] [--data=<рэ,рэ,…> — данные из FR для «Храним»]
//
// По итоговой спеке, без самоотчёта агента:
// - сущности §3.2: пометка, форма (таблица полей / таблица правил / правила списком), строки правил и их источник;
// - КРАСНОЕ: правило без источника / пустая «Источник»; «аналитик» (или 🔵С) в источнике, а тема правила не звучала ни
//   в словах аналитика (--prompt/--turn2), ни в вопросе хода до записи; ссылка FR-N, где темы правила нет (или срок
//   хранения со ссылкой на FR без срока); у внутренней новой — таблица полей без --fields; правила у внутренней не
//   таблицей; с --fields — потеряно поле аналитика (сравнение имён на равенство); у границы нет таблицы полей; с --data —
//   в «Храним» нет данных из FR; ❓-правила есть, а пункта «правила данных» в шапке не ровно один; N ≠ числу пунктов шапки;
//   таблица правил вне разобранной сущности;
// - справка: понятийные типы; «❓ предложение», хотя тема спрошена до записи и ход 2 — согласие;
// - срез 2: в ответе хода ДО записи спеки — абзац-вопрос с ≥ 2 видами правил данных (заголовок гейта 7 вырезан).

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTITY = /^(?:-|#{3,5})\s*(?:\*\*)?`?\[?((?:🟢|🔵|🟡|❓)[^`\]*]*?)\]?`?(?:\*\*)?\s*(?:\*\*)?`([^`]+)`/u
const RULE = /^\s*(?:(?:[-*]|\d+[.)])\s*)?(?:\*\*)?(Храним|Хранени|Срок хранени|Уникальн|Обязательн|При (?:удалении|изменении))[^:|]*:/i
const SRC = /аналитик|со слов|документ\S* сверху|(^|[^а-яё])БТ([^а-яё]|$)|FR-\d|🔵/iu
const TYPES = /\buuid\b|\bbigint\b|\bint(?:eger)?\b|\bvarchar\b|\btimestamp\b|\bboolean\b|индекс|\bFK\b|внешн\S* ключ|первичн\S* ключ/i
const KINDS = [/Храним|хранени/i, /Уникальн/i, /Обязательн/i, /удалени/i]
const GATE7 = /Данные и хранение/gi
// Ссылка «FR-N» в источнике честна, только если названный FR (раздел + его критерии приёмки) содержит тему правила.
const FR_TOPIC = { Уникально: /уникальн|дубл|повтор|не более одн/i, Обязательно: /обязательн|по желанию|заполня|указ/i, 'При удалении': /удален|удалени|удаля|удалит|измен|статус|переход/i }
const KEEP_TERM = /бессрочн|срок|\d+\s*(дн|дне|лет|год|мес|сут)|архив|истори/i
// Тема правила в словах аналитика или в вопросе агента до записи.
const TOPIC = { Храним: /(?<![Сс]о)хран|бессрочн|истори[яюи] заяв/i, Уникально: /уникальн|дубл/i, Обязательно: /обязательн|пуст/i, 'При удалении': /удален|удалени|удаля|удалит/i }
const RTAB = /^\s*\|\s*\**(Храним|Хранени|Срок хранени|Уникальн|Обязательн|При (?:удалении|изменении))[^|]*?\**\s*\|([^|]*)\|([^|]*)\|/i
const isNotNamed = (s) => /❓|🟡/u.test(s) && /не назван/i.test(s)
function srcKind (src) {
  if (!src.replace(/[—–\-\s]/g, '')) return 'ПУСТО'
  if (isNotNamed(src)) return 'не названо'
  if (/❓|🟡/u.test(src)) return 'предложение'
  if (/FR-\d|(^|[^а-яё])БТ([^а-яё]|$)|документ\S* сверху/iu.test(src)) return 'БТ'
  if (/аналитик|со слов|🔵/iu.test(src)) return 'аналитик'
  return 'БЕЗ ИСТОЧНИКА'
}
const ruleName = (s) => /^(Хран|Срок)/i.test(s) ? 'Храним' : /^Уник/i.test(s) ? 'Уникально' : /^Обяз/i.test(s) ? 'Обязательно' : 'При удалении'
const OFFICE = /офис|office/iu

export function frTexts (bt) {
  const out = {}
  let cur = null
  for (const l of bt.replace(/\r/g, '').split('\n')) {
    const h = l.match(/^\*\*FR-(\d+)\./)
    if (h) cur = h[1]
    else if (/^#|^\*\*[^F]/.test(l)) cur = null
    if (cur) out[cur] = (out[cur] || '') + l + '\n'
    for (const m of l.matchAll(/\[FR-(\d+)\]/g)) out[m[1]] = (out[m[1]] || '') + l + '\n'
  }
  return out
}

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return null
}

export function entities (spec) {
  const s = spec.replace(/\r/g, '')
  const m = s.match(/\n### ~*3\.2\.[^\n]*\n([\s\S]*?)\n### ~*3\.3/)
  const res = { ents: [], orphanRules: 0 }
  if (!m) return res
  let cur = null
  let orphanMode = false
  for (const raw of m[1].split('\n')) {
    const line = raw.replace(/\\\|/g, '¦')
    const e = line.match(ENTITY)
    if (e && !/индекс/i.test(line)) { cur = { mark: e[1].trim(), name: e[2], table: false, fields: [], rules: [], typesHit: false, mode: null, newHint: false }; res.ents.push(cur); orphanMode = false; continue }
    if (/^\s*\|\s*\**Правило\**\s*\|/.test(line)) { if (cur) cur.mode = 'rules'; else orphanMode = true; continue }
    if (orphanMode && RTAB.test(line)) { res.orphanRules++; continue }
    if (!cur) continue
    if (/^\s*\|/.test(line) && cur.mode === null && !/^\s*\|[-\s|:]+\|\s*$/.test(line)) { cur.table = true; cur.mode = 'fields'; continue }
    if (!/^\s*\|/.test(line) && line.trim()) cur.mode = null
    const rt = cur.mode === 'rules' && line.match(RTAB)
    if (rt) { cur.rules.push({ name: ruleName(rt[1]), value: rt[2].trim(), text: raw.trim().slice(0, 160), kind: srcKind(rt[3]), src: rt[3], form: 'таблица' }); continue }
    if (cur.mode === 'fields' && /^\s*\|/.test(line) && !/^\s*\|[-\s|:]+\|\s*$/.test(line)) {
      const cell = line.split('|')[1] || ''
      const f = (cell.match(/`([^`]+)`/) || [null, cell.replace(/[*\s]/g, '')])[1]
      if (f) cur.fields.push(f)
      if (TYPES.test(line)) cur.typesHit = true
      if (/новое|было\s/i.test(line)) cur.newHint = true
    }
    if (cur.mode !== 'rules' && RULE.test(line)) {
      const t = line.trim()
      const name = ruleName(t.replace(/^\s*(?:(?:[-*]|\d+[.)])\s*)?\**/, ''))
      cur.rules.push({ name, value: t, text: t.slice(0, 160), kind: srcKind(t.replace(/^[^:]*:/, '').match(/—([^—]*)$/)?.[1] ?? t), src: t, form: 'список' })
    }
  }
  return res
}

function openBlock (spec) {
  const lines = spec.replace(/\r/g, '').split('\n')
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) { const t = lines[j].replace(/^>\s?/, '').trim(); if (/^\d+[.)]\s/.test(t)) out.push(t) }
  return out
}

function turnsBeforeWrite (dir) {
  const st = readdirSync(dir).filter((x) => /^stream(-\d+)?\.jsonl$/.test(x)).sort((a, b) => (a === 'stream.jsonl' ? -1 : b === 'stream.jsonl' ? 1 : a.localeCompare(b)))
  const out = []
  for (let t = 0; t < st.length; t++) {
    if (/technical_specification\.md/.test(readFileSync(join(dir, st[t]), 'utf8').match(/"name":"(Write|Bash)"[^\n]*/g)?.join('\n') || '')) break
    const ans = join(dir, t === 0 ? (existsSync(join(dir, 'answer-01.md')) ? 'answer-01.md' : 'answer.md') : `answer-${String(t + 1).padStart(2, '0')}.md`)
    if (existsSync(ans)) out.push(readFileSync(ans, 'utf8').replace(GATE7, ''))
  }
  return out
}

export function gradeRun (dir, o) {
  const r = { run: dir }
  if (!existsSync(join(dir, 'stream.jsonl')) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) { r.measured = false; return r }
  r.measured = true
  const f = findSpec(dir)
  r.file = !!f
  if (!f) return r
  const spec = readFileSync(f, 'utf8')
  const parsed = entities(spec)
  r.ents = parsed.ents
  const before = turnsBeforeWrite(dir)
  r.askedBefore = ''
  r.summaryBefore = false
  for (const a of before) {
    const paras = a.split(/\n\s*\n/)
    paras.forEach((p, i) => {
      const block = paras.slice(Math.max(0, i - 2), i + 1).join('\n')
      if (/\?|годится|верно|предлага|моё предложени/i.test(p)) r.askedBefore += block + '\n'
      if (/\?|годится|верно/i.test(p) && KINDS.filter((k) => k.test(block)).length >= 2) r.summaryBefore = true
    })
  }
  const agreed = /^\s*да\b/i.test(o.turn2 || '')
  const m = spec.match(/Требуются уточнения \((\d+)\)/)
  r.n = m ? +m[1] : (/Готово к разработке/.test(spec) ? 0 : null)
  const open = openBlock(spec)
  r.openCount = open.length
  r.dmOpen = open.filter((t) => /правил\S* данных/i.test(t)).length
  r.dmSplit = open.filter((t) => !/правил\S* данных/i.test(t) && /❓/u.test(t) && /хранени|уникальн|обязательн|удалени/i.test(t)).length
  r.len32 = (spec.replace(/\r/g, '').match(/\n### ~*3\.2\.[^\n]*\n([\s\S]*?)\n### ~*3\.3/) || ['', ''])[1].length
  r.red = []
  r.note = []
  if (r.n !== null && r.n !== r.openCount) r.red.push(`N в статусе ${r.n} ≠ пунктов в «Открытых вопросах» ${r.openCount}`)
  if (parsed.orphanRules) r.red.push(`таблица правил вне разобранной сущности (${parsed.orphanRules} строк) — смотреть руками`)
  let qRules = 0
  for (const e of r.ents) {
    for (const rule of e.rules) {
      if (rule.kind === 'БЕЗ ИСТОЧНИКА' || rule.kind === 'ПУСТО') {
        if (!(/~~|не применимо/i.test(rule.value) && rule.kind === 'ПУСТО')) r.red.push(`правило без источника у ${e.name}: ${rule.text}`)
      }
      // Часть источника «аналитик» без FR/БТ/❓ в той же части (через «;») — тема должна звучать у аналитика.
      const saysAnalyst = (rule.form === 'таблица' ? rule.src : (rule.src || '').replace(/^[^—]*—/, '')).split(';')
        .some((c) => /аналитик|со слов|🔵\s*С/iu.test(c) && !/❓|🟡|FR-\d|(^|[^а-яё])БТ([^а-яё]|$)/iu.test(c))
      if (saysAnalyst && !(TOPIC[rule.name].test(o.said || '') || TOPIC[rule.name].test(r.askedBefore))) r.red.push(`«аналитик» без его слов у ${e.name}: ${rule.text}`)
      if (rule.kind === 'предложение' || rule.kind === 'не названо') qRules++
      if (rule.kind === 'предложение' && agreed && TOPIC[rule.name].test(r.askedBefore)) r.note.push(`«❓ предложение», хотя тема спрошена до записи и ход 2 — согласие: ${e.name} / ${rule.name}`)
      if (o.frs) {
        const nums = [...(rule.src || '').matchAll(/FR-(\d+)/g)].map((x) => x[1])
        const miss = nums.filter((n) => !o.frs[n])
        if (miss.length) r.red.push(`ссылка на FR, которого нет в БТ (${miss.join(', ')}), у ${e.name}: ${rule.text}`)
        const txt = nums.map((n) => o.frs[n] || '').join('\n')
        if (nums.length && rule.kind === 'БТ') {
          if (rule.name === 'Храним' && KEEP_TERM.test(rule.value) && !/хран|бессрочн|архив/i.test(txt)) r.red.push(`срок хранения со ссылкой на FR, где его нет, у ${e.name}: ${rule.text}`)
          if (FR_TOPIC[rule.name] && !FR_TOPIC[rule.name].test(txt)) r.red.push(`FR-${nums.join(',')} не про «${rule.name}» у ${e.name}: ${rule.text}`)
        }
      }
    }
    const shared = o.shared && o.shared.test(e.name)
    const changed = /🟢\s*И|изм/iu.test(e.mark) || e.newHint || OFFICE.test(e.name)
    const internal = /🟢/u.test(e.mark) && !changed && !shared
    e.role = shared ? 'граница' : internal ? 'внутренняя' : changed ? 'изменённая' : 'чужая'
    if (internal && e.table && !o.fields) r.red.push(`внутренняя ${e.name} — таблица полей (${e.fields.length}) без полей от аналитика`)
    if (internal && e.rules.some((x) => x.form === 'список')) r.red.push(`внутренняя ${e.name} — правила не таблицей`)
    if (internal && o.data) {
      const keep = e.rules.filter((x) => x.name === 'Храним').map((x) => x.value).join(' ').replace(/«[^»]*»/g, '')
      const lost = o.data.filter((d) => !new RegExp(d, 'iu').test(keep))
      if (lost.length) r.red.push(`внутренняя ${e.name} — в «Храним» нет данных из FR: ${lost.join(', ')}`)
    }
    if (internal && o.fields) {
      if (!e.table) r.red.push(`внутренняя ${e.name} — поля аналитика не записаны таблицей`)
      else {
        const missing = o.fields.filter((g) => !e.fields.includes(g))
        if (missing.length) r.red.push(`внутренняя ${e.name} — потеряны или переименованы поля аналитика: ${missing.join(', ')}`)
        e.extra = e.fields.filter((x) => !o.fields.includes(x))
      }
    }
    if (shared && !e.table) r.red.push(`граница ${e.name} без таблицы полей`)
  }
  if (qRules && r.dmOpen !== 1) r.red.push(`❓-правил ${qRules}, а пунктов «правила данных» в шапке ${r.dmOpen}${r.dmSplit ? ` (ещё ${r.dmSplit} пунктов по отдельным правилам)` : ''}`)
  if (!r.ents.length) r.red.push('в §3.2 не разобрано ни одной сущности — смотреть руками')
  if (o.data && !r.ents.some((e) => e.role === 'внутренняя')) r.red.push('внутренняя сущность не опознана — смотреть руками')
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3)
  const arm = process.argv[2]
  if (!arm) { console.error('usage: node grade-dm.mjs <папка-плеча> [--sub=..] [--shared=..] [--fields=a,b,..] [--bt=..] [--prompt=..] [--turn2=..] [--data=..]'); process.exit(1) }
  const rd = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : '')
  const turn2 = rd(arg('turn2'))
  const o = { shared: arg('shared') ? new RegExp(arg('shared'), 'iu') : null, fields: arg('fields') ? arg('fields').split(',') : null,
    said: rd(arg('prompt')) + '\n' + turn2, turn2, data: arg('data') ? arg('data').split(',') : null,
    frs: arg('bt') ? frTexts(rd(arg('bt'))) : null }
  const sub = arg('sub')
  console.log('прогон | сущностей | N / пунктов шапки | пунктов «правила данных» | §3.2 знаков | сводка до записи | ❓ предложений / правил (не названо) | красное')
  for (const d of readdirSync(arm).filter((x) => /^run-\d+$/.test(x)).sort()) {
    const r = gradeRun(join(arm, d, sub), o)
    if (!r.measured) { console.log(`${d} | не измерен`); continue }
    if (!r.file) { console.log(`${d} | спеки нет`); continue }
    const all = r.ents.flatMap((e) => e.rules)
    const prop = all.filter((x) => x.kind === 'предложение').length
    console.log([d, r.ents.length, `${r.n ?? '·'} / ${r.openCount}`, r.dmOpen, r.len32, r.summaryBefore ? 'да' : '—', `${prop}/${all.length} (не названо ${all.filter((x) => x.kind === 'не названо').length})`, r.red.length ? 'КРАСНОЕ ' + r.red.length : '—'].join(' | '))
    for (const e of r.ents) {
      const kinds = e.rules.reduce((a, x) => { a[x.kind] = (a[x.kind] || 0) + 1; return a }, {})
      const forms = [...new Set(e.rules.map((x) => x.form))].join('+') || '—'
      console.log(`   ${e.mark} ${e.name} [${e.role}]: ${e.table ? `таблица ${e.fields.length} полей${e.typesHit ? ' (есть типы — справка)' : ''}` : 'без таблицы полей'}; правил ${e.rules.length} (${forms}) ${JSON.stringify(kinds)}`)
    }
    for (const e of r.ents) if (e.extra?.length) console.log(`   справка: ${e.name} — поля сверх названных аналитиком (сверить с БТ): ${e.extra.join(', ')}`)
    for (const x of r.note) console.log(`   справка: ${x}`)
    for (const x of r.red) console.log(`   КРАСНОЕ: ${x}`)
  }
}
