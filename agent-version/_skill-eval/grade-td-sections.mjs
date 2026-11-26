#!/usr/bin/env node
// grade-td-sections.mjs — новые разделы БТ у детей эпика (task-decomposition-doc 1.1.0, PLAN-BR-SECTIONS D12).
//
//   node grade-td-sections.mjs <каталог плеча> --mode=copy|na
//   node grade-td-sections.mjs --selftest
//
// `grade-td-path.mjs` меряет пути и раскладку FR; разделы-копии он не смотрит. Здесь — только они:
//   copy (td-ru-w, эпик TD-RU с §1.4, §3.4, §4.3) — у каждого ребёнка эти разделы дословно как в эпике,
//        §4.3 — первой строкой «Унаследовано из эпика PSS-40»;
//   na   (td-path-w, эпик TD-PATH без них) — у каждого ребёнка раздел есть и говорит «не применимо»
//        со ссылкой на эпик («в эпике PSS-40 раздела нет»).
// Раздел ищется по заголовку (`sectionByTitle`): номер у прогона может съехать.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sectionByTitle } from './br-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const EPIC = join('AI-SDD', 'coddoc', 'PSS-40')
const KIDS = ['PSS-41', 'PSS-42']
const SECTIONS = [['1.4', /как\s+сейчас/i], ['3.4', /внешн\S*\s+зависим/i], ['4.3', /бизнес[- ]?данн/i]]
const RE_INHERITED = /^\s*унаследовано из эпика\s+`?PSS-40`?\.?\s*$/im

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const norm = (s) => (s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()

/** Один ребёнок: { num → 'ok' | причина }. */
export function gradeKid (kid, epic, mode) {
  const out = {}
  for (const [num, re] of SECTIONS) {
    const k = sectionByTitle(kid, re)
    if (!k) { out[num] = 'раздела нет'; continue }
    if (mode === 'na') {
      out[num] = /не\s+применимо/i.test(k.body) && /PSS-40|эпик/i.test(k.body) ? 'ok' : 'нет «не применимо: в эпике … раздела нет»'
      continue
    }
    const e = sectionByTitle(epic, re)
    let body = k.body
    if (num === '4.3') {
      if (!RE_INHERITED.test(body)) { out[num] = 'нет строки «Унаследовано из эпика PSS-40»'; continue }
      body = body.replace(RE_INHERITED, '')
    }
    out[num] = e && norm(body) === norm(e.body) ? 'ok' : 'не дословно'
  }
  return out
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const epic = '# Э\n### 1.4. Как сейчас\nВручную.\n### 3.4. Внешние зависимости\nВнешних зависимостей нет.\n### 4.3. Бизнес-данные\n| 1 | Пропуск |\n## 5. Ограничения\n'
  const kid = '# Р\n### 1.4. Как сейчас\nВручную.\n### 3.4. Внешние зависимости\nВнешних зависимостей нет.\n### 4.3. Бизнес-данные\nУнаследовано из эпика PSS-40.\n\n| 1 | Пропуск |\n## 5. Ограничения\n'
  const all = (r) => Object.values(r).every((v) => v === 'ok')
  ck('copy: дословная копия — зелёный', all(gradeKid(kid, epic, 'copy')), true)
  ck('copy: §4.3 без строки «Унаследовано» — красный', all(gradeKid(kid.replace('Унаследовано из эпика PSS-40.\n', ''), epic, 'copy')), false)
  ck('copy: §1.4 пересказан — красный', all(gradeKid(kid.replace('### 1.4. Как сейчас\nВручную.', '### 1.4. Как сейчас\nСейчас всё делают руками.'), epic, 'copy')), false)
  const na = '# Р\n### 1.4. Как сейчас\nНе применимо: в эпике PSS-40 раздела нет.\n### 3.4. Внешние зависимости\nНе применимо: в эпике PSS-40 раздела нет.\n### 4.3. Бизнес-данные\nНе применимо: в эпике PSS-40 раздела нет.\n'
  ck('na: «не применимо: в эпике PSS-40 раздела нет» — зелёный', all(gradeKid(na, '', 'na')), true)
  ck('na: раздела нет — красный', all(gradeKid('# Р\n### 1.3. Заказчик\nX\n', '', 'na')), false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['copy', 'na'].includes(mode)) { console.error('usage: node grade-td-sections.mjs <каталог плеча> --mode=copy|na | --selftest'); process.exit(1) }
const fixture = mode === 'copy' ? 'TD-RU' : 'TD-PATH'
const epic = read(join(HERE, 'fixtures', fixture, 'seed', EPIC, 'business_requirements.md'))
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nразделы детей (${mode}, эпик ${fixture}), ${arg}`)
let green = 0; let measured = 0
for (const n of runs) {
  const kids = KIDS.map((k) => read(join(arg, n, EPIC, k, 'business_requirements.md')))
  if (kids.some((k) => k === null)) { console.log(`  ${n}: детей нет — не измерено`); continue }
  measured++
  const res = kids.map((k) => gradeKid(k, epic, mode))
  const bad = res.flatMap((r, i) => Object.entries(r).filter(([, v]) => v !== 'ok').map(([num, v]) => `${KIDS[i]} §${num}: ${v}`))
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный · ' + bad.join(' · ') : 'зелёный'}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← разделы-копии у детей\n`)
