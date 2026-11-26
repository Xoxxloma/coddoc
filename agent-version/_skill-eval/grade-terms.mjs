#!/usr/bin/env node
// grade-terms.mjs — замена терминов 5.35 (2026-10-06): «слайс» → «часть», «деливербл» → «поставка»,
// английские дубли заголовков БТ убраны.
//
//   node grade-terms.mjs <каталог плеча> --case=cut|one|td
//   node grade-terms.mjs --selftest
//
//   cut — `br-cut`  (BR-CUT): БТ режется на части → таблица §4.5, каждое FR ровно в одной части, в ответе
//         строки «Разбиение:» и «Предлагаю:» и вопрос последним.
//   one — `br-yes`  (BR-YES): одна поставка → §4.5 «не применимо», в ответе «одна работа». Основной грейдер
//         пробы — `grade-br-yes.mjs`, здесь только разрез и слова.
//   td  — `td-ru-w` (TD-RU): §4.5 у ребёнка — «не применимо: это часть эпика», а не таблица. Пути — `grade-td-path.mjs`.
//
// Во всех трёх: ни в файлах, ни в ответе нет «слайс», «деливербл», slice, deliverable; у заголовков нет
// английских скобок. Грейдится файл на диске и `answer.md` (stdout прогона), не пересказ.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, apiFailed } from './br-lib.mjs'

export const OLD_TERMS = /слайс|деливерб|\bslices?\b|\bdeliverables?\b/i
// `slice:` во frontmatter ребёнка — машинный ключ рядом с `owned_fr`, его не переименовывали (5.35).
export const hasOld = (t) => OLD_TERMS.test(t.replace(/^slice:.*$/gm, ''))
export const EN_HEADING = /^#{1,4} .*\((Problem Statement|End Users|Stakeholder[^)]*|Mitigation|Scope|In-scope|Out-of-scope|Acceptance Criteria)\)\s*$/m

/** Текст секции от заголовка, совпавшего с `head`, до следующего заголовка того же или старшего уровня. */
export function section (doc, head) {
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

const H45 = /^#{2,4}\s*(§\s*)?4\.5\.?\s/
const H41 = /^#{2,4}\s*(§\s*)?4\.1\.?\s/

/** Строки таблицы §4.5 с FR (без шапки и разделителя). */
export function cutRows (s45) {
  return s45.split('\n').filter((l) => /^\s*\|/.test(l) && /FR-\d+/.test(l) && !/^\s*\|[\s:-]+\|/.test(l))
}

export function frIds (s) {
  return [...new Set((s.match(/FR-\d+/g) || []))].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
}

/** Каждое FR из §4.1 — ровно в одной строке таблицы (строка с «сквозн» может делить FR). */
export function coverage (doc, rows) {
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

// Скелет ответа модель часто отдаёт в ``` — закрывающая ограда не последняя строка ответа.
const lastLine = (t) => t.trim().split('\n').map((l) => l.trim()).filter((l) => l && !/^```/.test(l)).pop() || ''

function gradeBt (doc, answer, mode) {
  const c = {}
  const s45 = section(doc, H45)
  c['§4.5 «Разбиение на части»'] = /^#{2,4}\s*(§\s*)?4\.5\.?\s*Разбиение на части\s*$/m.test(doc)
  const rows = s45 ? cutRows(s45) : []
  if (mode === 'cut') {
    c['§4.5 — таблица ≥2 частей'] = rows.length >= 2 && !/не применимо/i.test(s45 || '')
    const cov = coverage(doc, rows)
    c[`каждое FR ровно в одной части${cov.bad.length ? ' (' + cov.bad.join(', ') + ')' : ''}`] = cov.ids.length > 0 && cov.bad.length === 0
    c['ответ: «Разбиение:» и «Предлагаю:» с FR'] = /^\s*\**Разбиение:?\**:?/m.test(answer) && /Предлагаю[\s\S]{0,400}?FR-\d+[\s\S]{0,400}?FR-\d+/.test(answer)
  } else {
    c['§4.5 — «не применимо», таблицы нет'] = !!s45 && /не применимо/i.test(s45) && rows.length === 0
    c['ответ: «Разбиение:» и «одна работа»'] = /^\s*\**Разбиение:?\**:?/m.test(answer) && /одна работа|не применимо/i.test(answer)
  }
  c['ответ кончается вопросом'] = /\?/.test(lastLine(answer))
  c['нет старых слов (файл и ответ)'] = !hasOld(doc) && !hasOld(answer)
  c['заголовки без английских скобок'] = !EN_HEADING.test(doc)
  return c
}

function gradeTd (dir, answer) {
  const base = join(dir, 'AI-SDD', 'coddoc', 'PSS-40')
  const kids = ['PSS-41', 'PSS-42'].map((k) => read(join(base, k, 'business_requirements.md')))
  const index = read(join(base, 'decomposition.md')) || ''
  const c = {}
  c['оба ребёнка записаны'] = kids.every(Boolean)
  c['§4.5 ребёнка — «не применимо: это часть эпика»'] = kids.every((k) => {
    const s = k && section(k, H45)
    // `\w` в JS — только латиница: «част\w*» на «часть» не срабатывает, отсюда явный класс.
    return !!s && /не применимо/i.test(s) && /част[а-яё]*\s+эпика/i.test(s) && cutRows(s).length === 0
  })
  c['нет старых слов (дети, индекс, ответ)'] = ![...kids, index, answer].some((t) => t && hasOld(t))
  c['заголовки детей без английских скобок'] = kids.every((k) => !k || !EN_HEADING.test(k))
  return c
}

function selftest () {
  const doc = `# Бизнес-требования: x\n### 1.1. Описание проблемы\n## 4. Функциональные требования\n### 4.1. Описание\n- FR-1 a\n- FR-2 b\n- FR-3 c\n### 4.2. Критерии приёмки\n- [FR-1] …\n\n### 4.5. Разбиение на части\n| # | Часть | Владеет FR-* |\n|---|---|---|\n| 1 | А | FR-1, FR-2 | — |\n| 2 | Б | FR-3 | 1 |\n\n## 5. Ограничения\n`
  const ans = 'Файл записан.\nРазбиение: 3 FR, отдельных поставок: 2.\nПредлагаю: А (FR-1, FR-2), Б (FR-3).\nГодится?'
  const cases = [
    ['чистый cut — всё зелёное', () => Object.values(gradeBt(doc, ans, 'cut')).every(Boolean)],
    ['FR-3 потерян — покрытие красное', () => Object.entries(gradeBt(doc.replace('| 2 | Б | FR-3 | 1 |', '| 2 | Б | — | 1 |'), ans, 'cut')).some(([k, v]) => k.startsWith('каждое FR') && !v)],
    ['FR-12 не засчитывается за FR-1', () => coverage(doc.replace('FR-1 a', 'FR-1 a\n- FR-12 d'), cutRows(section(doc, H45))).bad.includes('FR-12×0')],
    ['«слайс» в ответе — красное', () => !gradeBt(doc, ans.replace('Предлагаю', 'Слайсы. Предлагаю'), 'cut')['нет старых слов (файл и ответ)']],
    ['«деливербл» в файле — красное', () => !gradeBt(doc + '\nодин деливербл', ans, 'cut')['нет старых слов (файл и ответ)']],
    ['(In-scope) в заголовке — красное', () => !gradeBt(doc.replace('### 1.1. Описание проблемы', '### 3.1. Входит в проект (In-scope)'), ans, 'cut')['заголовки без английских скобок']],
    ['старый заголовок §4.5 — красное', () => !gradeBt(doc.replace('Разбиение на части', 'Разбиение на слайсы'), ans, 'cut')['§4.5 «Разбиение на части»']],
    ['вопрос перед закрывающей ``` — последний', () => gradeBt(doc, '```\nРазбиение: 3 FR, отдельных поставок: 2.\nПредлагаю: А (FR-1, FR-2), Б (FR-3).\nГодится?\n```', 'cut')['ответ кончается вопросом']],
    ['пояснение после вопроса — красное', () => !gradeBt(doc, ans + '\n- Зависимости: Б от А.', 'cut')['ответ кончается вопросом']],
    ['ответ без вопроса — красное', () => !gradeBt(doc, ans.replace('Годится?', 'Готово.'), 'cut')['ответ кончается вопросом']],
    ['one: «не применимо» — зелёное', () => Object.values(gradeBt(doc.replace(/\| #[\s\S]*?\| 2 \| Б \| FR-3 \| 1 \|/, 'не применимо: одна поставка'), 'Разбиение: 3 FR, отдельных поставок: 1.\nПредлагаю: одна работа, в §4.5 написал «не применимо».\nГодится?', 'one')).every(Boolean)],
    ['ключ `slice:` во frontmatter — не старое слово', () => !hasOld('---\nslice: [А]\nowned_fr: [FR-1]\n---') && hasOld('один слайс')],
    ['§4.5 ребёнка «это часть эпика» узнаётся', () => /част[а-яё]*\s+эпика/i.test(section('## 4.5. Разбиение на части\n\nНе применимо: это часть эпика PSS-40.\n\n## 5. X', H45))],
    ['«сквозной» FR в двух строках — не задвоение', () => coverage(doc.replace('| 2 | Б | FR-3 | 1 |', '| 2 | Б | FR-3, FR-2 (сквозной) | 1 |'), cutRows(section(doc.replace('| 2 | Б | FR-3 | 1 |', '| 2 | Б | FR-3, FR-2 (сквозной) | 1 |'), H45))).bad.length === 0],
  ]
  let fail = 0
  for (const [name, fn] of cases) { const ok = fn(); if (!ok) fail++; console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}`) }
  console.log(fail ? `\n${fail} из ${cases.length} самотестов красные` : `\nвсе ${cases.length} самотестов зелёные`)
  process.exit(fail ? 1 : 0)
}

if (process.argv.includes('--selftest')) selftest()

const arg = process.argv[2]
const mode = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['cut', 'one', 'td'].includes(mode)) {
  console.error('usage: node grade-terms.mjs <каталог плеча> --case=cut|one|td'); process.exit(1)
}
const REL = { cut: 'coddoc/ARS-180/business_requirements.md', one: 'coddoc/LIB-208/business_requirements.md' }[mode]
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\ngrade-terms --case=${mode}, ${arg}`)
const tally = {}; let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const answer = read(join(dir, 'answer.md'))
  if (apiFailed(dir, [answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  let c
  if (mode === 'td') c = gradeTd(dir, answer)
  else {
    const doc = read(join(dir, REL))
    c = doc ? gradeBt(doc, answer, mode) : { 'файл записан': false }
  }
  const pass = Object.values(c).every(Boolean)
  if (pass) green++
  for (const [k, v] of Object.entries(c)) { const key = k.replace(/ \(.*\)$/, ''); tally[key] = (tally[key] || 0) + (v ? 1 : 0) }
  console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}${pass ? '' : '  ✗ ' + Object.entries(c).filter(([, v]) => !v).map(([k]) => k).join(' · ')}`)
}
console.log('')
for (const [k, v] of Object.entries(tally)) console.log(`  ${v}/${measured}\t${k}`)
console.log(`  ${green}/${measured}\tзелёных — всё сразу  ← КРИТЕРИЙ\n`)
