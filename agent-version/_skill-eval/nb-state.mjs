// nb-state.mjs — разбор ноута analyst-notebook 2.0.0 и проверки его состояния (PLAN-NOTEBOOK-STATE.md, «Форма строки»).
//   import { parseNotebook, activeItems, checkIds, checkPairs, historyIntact } from './nb-state.mjs'
//   node nb-state.mjs --selftest
// Строка пункта: `- [<вид>] <текст> — <хвост>[; вместо: <номер>][; отвечает на: <номер>] · <свой номер>[ ‖ <состояние>: <номер>]…`
// Номер пункта — `<ГГГГ-ММ-ДД> №<запись>.<позиция>`. Действует — строка без `‖`.
import { fileURLToPath } from 'node:url'
import { resolve as pathResolve } from 'node:path'

export const lf = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/^﻿/, '')
export const ID = '\\d{4}-\\d{2}-\\d{2},?\\s*№\\s*\\d+\\.\\d+'
export const ID_RE = new RegExp(ID)
const ID_CAP = /(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+)\.(\d+)/
export const normId = (s) => { const m = String(s).match(ID_CAP); return m ? `${m[1]} №${Number(m[2])}.${Number(m[3])}` : null }
// Номер записи (для `снят:`): `<дата> №<запись>` без позиции.
const ENTRY_CAP = /(\d{4}-\d{2}-\d{2}),?\s*№\s*(\d+)(?!\.\d)/
const STATES = { заменён: 'вместо', закрыт: 'отвечает на', оспорен: 'спор', снят: 'исправление' }
const MARK_RE = /^(заменен|заменён|закрыт|оспорен|снят)\s*:\s*(.+)$/i
const norm = (s) => s.toLowerCase().replace(/ё/g, 'е')

function splitFront (text) {
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/)
  return m ? { front: m[1], bodyStart: m[0].split('\n').length - (m[2] ? 1 : 0) } : { front: null, bodyStart: 0 }
}

// Разбор строки пункта (без позиции): вид, текст до хвостов, связи, свой номер, пометки.
export function parseItemLine (l) {
  const m = l.match(/^- \[([^\]]*)\]\s?(.*)$/)
  if (!m) return null
  const [main, ...markParts] = m[2].split(/\s*‖\s*/)
  const marks = []
  const badMarks = []
  for (const p of markParts) {
    const x = p.trim().match(MARK_RE)
    if (!x) { badMarks.push(p.trim()); continue }
    const state = norm(x[1]).replace('заменен', 'заменён')
    const st = state === 'заменен' ? 'заменён' : state
    marks.push({ state: st, to: normId(x[2]) || (x[2].match(ENTRY_CAP) ? `${x[2].match(ENTRY_CAP)[1]} №${Number(x[2].match(ENTRY_CAP)[2])}` : null), raw: p.trim() })
  }
  let body = main
  let id = null
  const im = body.match(new RegExp(`\\s*·\\s*(${ID})\\s*$`))
  if (im) { id = normId(im[1]); body = body.slice(0, im.index) }
  const links = []
  body = body.replace(new RegExp(`;\\s*(вместо|отвечает\\s+на)\\s*:\\s*(${ID}|[^;·]*)`, 'gi'), (all, k, ref) => {
    links.push({ kind: /вместо/i.test(k) ? 'вместо' : 'отвечает на', to: normId(ref), raw: ref.trim() })
    return ''
  })
  let disputes = null
  if (/что\s+верно\s*:/i.test(body)) {
    const s = body.match(new RegExp(`\\([^()]*?,\\s*(${ID})\\s*\\)`))
    if (s) disputes = normId(s[1])
  }
  return { kind: m[1], text: body.trim(), id, links, marks, badMarks, disputes, line: l }
}

export function parseNotebook (text) {
  const t = lf(text)
  const lines = t.split('\n')
  const { front, bodyStart } = splitFront(t)
  const items = []; const entries = []
  let date = null; let entry = null; let pos = 0
  for (let i = bodyStart; i < lines.length; i++) {
    const l = lines[i]
    let m
    if ((m = l.match(/^## (\d{4}-\d{2}-\d{2})\s*$/))) { date = m[1]; entry = null; continue }
    if ((m = l.match(/^### (\d+)\s*[·•.:—–-]?\s*(.*)$/))) { entry = { date, n: Number(m[1]), title: m[2].trim(), line: i, items: [] }; entries.push(entry); pos = 0; continue }
    if (!/^- \[/.test(l) || !entry) continue
    pos++
    const it = parseItemLine(l)
    it.idx = i; it.date = date; it.entry = entry.n; it.pos = pos
    it.where = `${date} №${entry.n}.${pos}`
    it.ref = it.id || it.where
    entry.items.push(it); items.push(it)
  }
  const byId = new Map(items.map((x) => [x.ref, x]))
  return { front, lines, items, entries, byId }
}

export const isActive = (it) => it.marks.length === 0 && it.badMarks.length === 0
export const activeItems = (nb) => nb.items.filter(isActive)

// Номера: у каждого пункта есть свой номер, он совпадает с местом строки, не повторяется.
export function checkIds (nb, only = null) {
  const bad = []
  const seen = new Map()
  for (const it of nb.items) {
    if (only && !only(it)) continue
    if (!it.id) { bad.push(`без номера: «${short(it.line)}»`); continue }
    if (it.id !== it.where) bad.push(`номер ${it.id} у пункта на месте ${it.where}`)
    if (seen.has(it.id)) bad.push(`номер ${it.id} дважды`)
    seen.set(it.id, it)
  }
  return bad
}

// Пары «связь ↔ пометка»: у связи нового пункта — пометка на старом и наоборот; у спора — `оспорен` на оспоренном.
export function checkPairs (nb) {
  const bad = []
  const want = (target, state, from, why) => {
    const t = nb.byId.get(target)
    if (!t) { bad.push(`${why}: нет пункта ${target}`); return }
    if (!t.marks.some((m) => m.state === state && m.to === from)) bad.push(`${why}: у ${target} нет «‖ ${state}: ${from}»`)
  }
  for (const it of nb.items) {
    for (const k of it.links) {
      if (!k.to) { bad.push(`связь «${k.kind}: ${k.raw}» у ${it.ref} — не номер пункта`); continue }
      want(k.to, k.kind === 'вместо' ? 'заменён' : 'закрыт', it.ref, `${it.ref} ${k.kind} ${k.to}`)
    }
    if (it.disputes) want(it.disputes, 'оспорен', it.ref, `спор ${it.ref} о ${it.disputes}`)
    for (const b of it.badMarks) bad.push(`пометка не по форме у ${it.ref}: «${b}»`)
    for (const mk of it.marks) {
      if (!mk.to) { bad.push(`пометка «${mk.raw}» у ${it.ref} — без номера`); continue }
      if (mk.state === 'снят') continue
      const src = nb.byId.get(mk.to)
      const ok = src && (mk.state === 'оспорен' ? src.disputes === it.ref : src.links.some((k) => k.to === it.ref && (k.kind === 'вместо') === (mk.state === 'заменён')))
      if (!ok) bad.push(`«‖ ${mk.state}: ${mk.to}» у ${it.ref} — у ${mk.to} нет парной связи`)
    }
  }
  return bad
}

// Связь на уже выбывший пункт: новый пункт ссылается на строку, у которой до него уже была пометка.
export function staleLinks (nb) {
  const bad = []
  for (const it of nb.items) {
    for (const k of it.links) {
      const t = k.to && nb.byId.get(k.to)
      if (!t) continue
      // Пометки от пунктов, записанных раньше этого: пункт уже выбыл, когда на него сослались.
      const before = t.marks.filter((m) => { const s = nb.byId.get(m.to); return m.to !== it.ref && (!s || s.idx < it.idx) })
      if (before.some((m) => m.state !== 'оспорен' || k.kind !== 'вместо')) bad.push(`${it.ref} ${k.kind} ${k.to}, а ${k.to} уже выбыл (${before.map((m) => m.raw).join('; ')})`)
    }
  }
  return bad
}

// История цела: каждая строка засева — в выходе на своём месте, как была или с пометками ` ‖ …` в конце; ниже последней
// строки засева — только новое. Шапка (между `---`) правиться может. Возвращает список нарушений и новые строки.
export function historyIntact (seedText, finalText) {
  const S = lf(seedText).replace(/\n+$/, '').split('\n')
  const F = lf(finalText).split('\n')
  const sf = splitFront(S.join('\n')); const ff = splitFront(F.join('\n'))
  const sb = S.slice(sf.bodyStart); const fb = F.slice(ff.bodyStart)
  const bad = []
  for (let i = 0; i < sb.length; i++) {
    const a = sb[i]; const b = fb[i]
    if (b === undefined) { bad.push(`строки засева «${short(a)}» нет`); break }
    if (a === b) continue
    if (b.startsWith(a) && /^(\s*‖\s*[^‖]+)+$/.test(b.slice(a.length))) continue
    // Пометки засева на месте, дописаны новые.
    bad.push(`строка засева изменена: «${short(a)}» → «${short(b)}»`)
  }
  return { bad, newLines: fb.slice(sb.length) }
}

// Пометки, добавленные к строкам засева: [{ id, state, to }].
export function addedMarks (seedText, finalText) {
  const s = parseNotebook(seedText); const f = parseNotebook(finalText)
  const out = []
  for (const it of f.items) {
    const old = s.byId.get(it.ref)
    if (!old) continue
    for (const m of it.marks.slice(old.marks.length)) out.push({ id: it.ref, state: m.state, to: m.to })
  }
  return out
}

const short = (s) => (s.length > 100 ? s.slice(0, 97) + '…' : s)

// Строка выгрузки: без пометок и хвостов связей, концевая ссылка — номер пункта.
export function exportLineOk (l) {
  if (/‖/.test(l)) return 'пометка ‖ в выгрузке'
  if (/;\s*(вместо|отвечает\s+на)\s*:/i.test(l)) return 'хвост связи в выгрузке'
  if (!new RegExp(`·\\s*${ID}\\s*$`).test(l)) return 'в конце нет « · <номер пункта>»'
  return null
}

// ---------- самопроверка ----------
function selftest () {
  let fails = 0
  const ck = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`}`) }
  const seed = [
    '---', 'тема: т', '---', '# Ноут: т', '', '## 2026-10-01', '', '### 1 · письмо Ковригина С.',
    '- [решено] Обычную заявку выполняем за 10 рабочих дней — решил: Ковригин С. · 2026-10-01 №1.1',
    '- [открыто] Может ли сотрудник войти без жильца — ждёт: Ковригин С. · 2026-10-01 №1.2',
    '> текст', '',
  ].join('\n')
  const fin = seed.replace('№1.1', '№1.1 ‖ заменён: 2026-10-08 №1.1').replace('ждёт: Ковригин С. · 2026-10-01 №1.2', 'ждёт: Ковригин С. · 2026-10-01 №1.2 ‖ закрыт: 2026-10-08 №1.2') +
    ['## 2026-10-08', '', '### 1 · письмо Ковригина С.',
      '- [решено] Обычную заявку выполняем за 8 рабочих дней — решил: Ковригин С.; вместо: 2026-10-01 №1.1 · 2026-10-08 №1.1',
      '- [решено] Сотрудник входит без жильца только вдвоём с комендантом — решил: Ковригин С.; отвечает на: 2026-10-01 №1.2 · 2026-10-08 №1.2',
      '> текст', ''].join('\n')
  const nb = parseNotebook(fin)
  ck('пунктов 4', nb.items.length, 4)
  ck('действуют 2 новых', activeItems(nb).map((x) => x.ref), ['2026-10-08 №1.1', '2026-10-08 №1.2'])
  ck('номера ок', checkIds(nb), [])
  ck('пары ок', checkPairs(nb), [])
  ck('история цела', historyIntact(seed, fin).bad, [])
  ck('добавлено пометок 2', addedMarks(seed, fin).length, 2)
  const noMark = fin.replace(' ‖ заменён: 2026-10-08 №1.1', '')
  ck('пометку забыли → пара', checkPairs(parseNotebook(noMark)).length, 1)
  const wrongMark = fin.replace(' ‖ заменён: 2026-10-08 №1.1', '').replace('№1.2 ‖ закрыт: 2026-10-08 №1.2', '№1.2 ‖ закрыт: 2026-10-08 №1.2 ‖ заменён: 2026-10-08 №1.1')
  ck('пометка не на том → пары', checkPairs(parseNotebook(wrongMark)).length, 2)
  const rewritten = fin.replace('за 10 рабочих дней', 'за 8 рабочих дней')
  ck('переписан старый текст → история', historyIntact(seed, rewritten).bad.length, 1)
  const dupId = fin.replace('отвечает на: 2026-10-01 №1.2 · 2026-10-08 №1.2', 'отвечает на: 2026-10-01 №1.2 · 2026-10-08 №1.1')
  ck('номер повторён → номера', checkIds(parseNotebook(dupId)).length >= 1, true)
  const twoActive = noMark
  ck('два действующих о сроке', activeItems(parseNotebook(twoActive)).filter((x) => /рабочих дней/.test(x.text)).length, 2)
  const stale = fin + ['## 2026-10-09', '', '### 1 · письмо Ковригина С.', '- [решено] Обычную заявку выполняем за 6 рабочих дней — решил: Ковригин С.; вместо: 2026-10-01 №1.1 · 2026-10-09 №1.1', ''].join('\n')
  ck('связь на уже заменённый → staleLinks', staleLinks(parseNotebook(stale.replace('№1.1 ‖ заменён: 2026-10-08 №1.1', '№1.1 ‖ заменён: 2026-10-08 №1.1 ‖ заменён: 2026-10-09 №1.1'))).length, 1)
  const spor = [
    '## 2026-10-01', '', '### 1 · чат', '- [решено] Вахта заявки не принимает — решил: Харитонова Л. · 2026-10-01 №1.1 ‖ оспорен: 2026-10-05 №1.1',
    '## 2026-10-05', '', '### 1 · письмо', '- [открыто] что верно: Вахта заявки не принимает (Харитонова Л., 2026-10-01 №1.1) или вахтёр заводит заявку за жильца (Сагитова В.) — ждёт: Харитонова Л. · 2026-10-05 №1.1', '']
  const sp = parseNotebook(spor.join('\n'))
  ck('спор: сторона распознана', sp.items[1].disputes, '2026-10-01 №1.1')
  ck('спор: пары ок', checkPairs(sp), [])
  ck('спор: действует только спор', activeItems(sp).map((x) => x.ref), ['2026-10-05 №1.1'])
  ck('выгрузка: строка ок', exportLineOk('- [решено] Х — решил: К. · 2026-10-08 №1.1'), null)
  ck('выгрузка: пометка', exportLineOk('- [решено] Х — решил: К. · 2026-10-08 №1.1 ‖ заменён: 2026-10-09 №1.1'), 'пометка ‖ в выгрузке')
  ck('выгрузка: связь', exportLineOk('- [решено] Х — решил: К.; вместо: 2026-10-01 №1.1 · 2026-10-08 №1.1'), 'хвост связи в выгрузке')
  ck('выгрузка: ссылка на запись', exportLineOk('- [решено] Х — решил: К. · 2026-10-08 №1'), 'в конце нет « · <номер пункта>»')
  console.log(fails ? `самопроверка: ${fails} FAIL` : 'самопроверка: ok')
  process.exit(fails ? 1 : 0)
}

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN && process.argv.includes('--selftest')) selftest()
