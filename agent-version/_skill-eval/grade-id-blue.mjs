#!/usr/bin/env node
// grade-id-blue.mjs — проба id-blue (скилл: interaction-diagram, inputs/spec.md), ревью покрытия п.2б.
//
//   node grade-id-blue.mjs <каталог плеча>
//   node grade-id-blue.mjs --selftest
//
// Фикстура ID-BLUE: спека SHT-410. У карточек «изменение существующего» в «Контракт» — «без изменений», путь —
// в строке «Существующий стык». Подпись стрелки: INT-3 · GET /v1/trips/{tripId}, INT-4 · GET /v1/trips (без
// полей из строки стыка), INT-2 — путь из «Контракт», INT-1 (стык 🟡 словами) — без пути.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

const label = (text, id) => (text.split('\n').filter((l) => new RegExp(`\\b${id}\\b`).test(l) && /->>|-\)|<<->>|:/.test(l)))

export function grade (text) {
  const m = {}
  const l1 = label(text, 'INT-1'); const l2 = label(text, 'INT-2'); const l3 = label(text, 'INT-3'); const l4 = label(text, 'INT-4')
  m['INT-3 · GET /v1/trips/{tripId}'] = l3.some((l) => /GET \/v1\/trips\/\{tripId\}/.test(l))
  m['INT-4 · GET /v1/trips'] = l4.some((l) => /GET \/v1\/trips(?![\w/{])/.test(l))
  m['INT-2 · путь из «Контракт»'] = l2.some((l) => /GET \/api\/v3\/badges/.test(l))
  m['INT-1 без пути'] = l1.length > 0 && !l1.some((l) => /\b(GET|POST|PUT|PATCH|DELETE)\s+\//.test(l))
  m['в подписях нет полей стыка'] = ![...l3, ...l4].some((l) => /seatsLeft|departureAt|officeCode|отдаёт/.test(l))
  return m
}

function selftest () {
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); return cond ? 0 : 1 }
  const all = (g) => Object.values(g).every(Boolean)
  let f = 0
  const g = 'FE->>BE: INT-1\nBE->>shuttle-api: x\nBE->>badge-service: INT-2 · GET /api/v3/badges?holderLogin={login}\nFE->>BE: INT-3 · GET /v1/trips/{tripId}\nFE->>BE: INT-4 · GET /v1/trips\n'
  f += ok('зелёный', all(grade(g)))
  f += ok('голая подпись INT-3 — красный', !grade(g.replace('INT-3 · GET /v1/trips/{tripId}', 'INT-3'))['INT-3 · GET /v1/trips/{tripId}'])
  f += ok('поля в подписи — красный', !grade(g.replace('INT-4 · GET /v1/trips', 'INT-4 · GET /v1/trips отдаёт officeCode'))['в подписях нет полей стыка'])
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
if (!arg || !existsSync(arg)) { console.error('usage: node grade-id-blue.mjs <каталог плеча>'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\n${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const p = join(dir, 'coddoc', 'SHT-410', 'interaction_diagram.md')
  if (!existsSync(p)) { console.log(`  ${n}: красный · файла схемы нет`); continue }
  const g = grade(readFileSync(p, 'utf8'))
  const bad = Object.entries(g).filter(([, v]) => !v).map(([k]) => k)
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный  ✗ ' + bad.join(' · ') : 'зелёный'}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
