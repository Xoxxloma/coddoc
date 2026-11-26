#!/usr/bin/env node
// grade-ts-blue.mjs — пробы ts-blue-yes / ts-blue-idk (скилл: technical-spec-doc), п.2б PLAN-FROM-POCOCK.
//
//   node grade-ts-blue.mjs <каталог плеча> --case=yes|idk
//   node grade-ts-blue.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ (фикстура TS-BLUE, SHT-410) — путь и модель у 🔵 по источнику; вид «изменение существующего».
//   yes: (а) пропуска — 🔵 «по карточке», путь `/api/v3/badges`; (б) карточка рейса — вид «изменение», заголовок 🟢,
//        «Существующий стык» с `/v1/trips/{tripId}` под 🔵 «по карточке», таблица «было → стало» с `bikeRack`, JSON с
//        `bikeRack`; (г) справочник — 🔵 «со слов», путь `/org/v1/employees`.
//   idk: (в) пропуска и справочник — 🟡, без пути и JSON; (ж) рейс — вид «изменение», 🟢, «Существующий стык» 🟡 без
//        пути, в таблице только добавленное поле, JSON подписан фрагментом. Ни одного пути неподтверждённой ручки в спеке.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, turn, apiFailed } from './br-lib.mjs'

const REL = 'coddoc/SHT-410/technical_specification.md'
const P_BADGE = /\/api\/v3\/badges/
const P_ORG = /\/org\/v1\/employees/
const P_TRIP = /\/v1\/trips\/\{?:?tripId/

/** INT-карточки: { head, body, mark } — метка из заголовка, иначе из строки «Происхождение». */
export function cards (spec) {
  const parts = ('\n' + spec).split(/\n(?=#{2,4}\s*~*\s*INT-\d+)/).slice(1)
  return parts.map((p) => {
    const body = p.split(/\n(?=#{2,4}\s(?!.*INT-)|##\s)/)[0]
    const head = body.split('\n')[0]
    const prov = body.split('\n').find((l) => /Происхождение/i.test(l)) || ''
    const mark = (head.match(/🟢|🔵|🟡|❓/) || prov.match(/🟢|🔵|🟡|❓/) || [null])[0]
    const border = body.split('\n').find((l) => /Граница/i.test(l)) || ''
    return { head, body, mark, border }
  })
}
// Сначала по строке «Граница» (с кем стык), затем по заголовку: «Запись с проверкой пропуска» (фронт → бэк) — не стык со
// службой пропусков, хотя слово в заголовке есть.
const pick = (cs, re) => cs.find((c) => re.test(c.border)) || cs.find((c) => re.test(c.head))
const pickTrip = (cs) => {
  const withField = cs.filter((c) => /bikeRack/.test(c.body))
  return withField.find((c) => /карточк|\{?:?tripId/.test(c.head + c.border)) || withField[0]
}

export function grade (spec, kase) {
  const cs = cards(spec)
  const badge = pick(cs, /badge|служб[а-яё]*\s+пропуск/i)
  const org = pick(cs, /org-directory|справочник[а-яё]*\s+сотрудник/i)
  const trip = pickTrip(cs)
  const seam = trip ? trip.body.split('\n').find((l) => /существующ[а-яё]*\s+стык/i.test(l)) || '' : ''
  const tableRows = trip ? trip.body.split('\n').filter((l) => /^\s*\|/.test(l)) : []
  const json = trip ? (trip.body.match(/```json[\s\S]*?```/g) || []).join('\n') : ''
  // Ревью шага 1 (К3): у изменения в «Происхождении» одна метка — «🟢 изменение существующего»; метка основы — в «Существующем стыке».
  const tripProv = trip ? trip.body.split('\n').find((l) => /Происхождение/i.test(l)) || '' : ''
  const provOne = /🟢\s*изменение\s+существующ/i.test(tripProv) && !/🔵|🟡/.test(tripProv)
  const m = {}
  if (kase === 'yes') {
    m['(а) пропуска: 🔵'] = badge?.mark === '🔵'
    m['(а) пропуска: путь'] = !!badge && P_BADGE.test(badge.body)
    // Источник — в строке с 🔵 (метка происхождения), а не где-то в тексте карточки.
    m['(а) пропуска: «по карточке»'] = !!badge && badge.body.split('\n').some((l) => /🔵/.test(l) && /по\s+карточке/i.test(l))
    m['(б) рейс: вид «изменение»'] = !!trip && /изменени[ея]\s+существующ/i.test(trip.body)
    m['(б) рейс: заголовок 🟢'] = trip?.mark === '🟢'
    m['(б) стык: путь под 🔵 «по карточке»'] = P_TRIP.test(seam) && /🔵/.test(seam) && /по\s+карточке/i.test(seam)
    m['(б) таблица было → стало'] = /было/i.test(tableRows.join(' ')) && /стало/i.test(tableRows.join(' ')) && tableRows.some((l) => /bikeRack/.test(l))
    m['(б) JSON с bikeRack'] = /bikeRack/.test(json)
    // Ревью шага 1 (К1): прежние поля ответа — из сущности Trip по строке `сущности:` карточки (в блоке ручки их нет).
    m['(б) прежние поля из сущности'] = !!trip && /seatsLeft/.test(trip.body) && /route/.test(trip.body)
    m['(б) «Происхождение» — одна метка'] = provOne
    m['(г) справочник: 🔵'] = org?.mark === '🔵'
    m['(г) справочник: путь'] = !!org && P_ORG.test(org.body)
    m['(г) справочник: «со слов»'] = !!org && org.body.split('\n').some((l) => /🔵/.test(l) && /со\s+слов/i.test(l))
    m['страж: путь под 🟡'] = !spec.split('\n').some((l) => /🟡/.test(l) && (P_BADGE.test(l) || P_ORG.test(l) || P_TRIP.test(l)))
  } else {
    m['(в) пропуска: 🟡'] = badge?.mark === '🟡'
    m['(в) пропуска: без пути и JSON'] = !!badge && !P_BADGE.test(badge.body) && !/```json/.test(badge.body)
    m['(в) справочник: 🟡'] = org?.mark === '🟡'
    m['(в) справочник: без пути и JSON'] = !!org && !P_ORG.test(org.body) && !/```json/.test(org.body)
    m['(ж) рейс: вид «изменение»'] = !!trip && /изменени[ея]\s+существующ/i.test(trip.body)
    m['(ж) рейс: заголовок 🟢'] = trip?.mark === '🟢'
    m['(ж) стык: 🟡 без пути'] = /🟡/.test(seam) && !P_TRIP.test(seam)
    m['(ж) таблица: только добавленное'] = tableRows.some((l) => /bikeRack/.test(l)) && !tableRows.some((l) => /seatsLeft|departureAt|`route`/.test(l))
    m['(ж) JSON — фрагмент с подписью'] = /bikeRack/.test(json) && /фрагмент|прочие\s+поля/i.test(trip?.body || '')
    m['(ж) «Происхождение» — одна метка'] = provOne
    m['страж: путей неподтверждённого нет'] = !P_BADGE.test(spec) && !P_ORG.test(spec) && !P_TRIP.test(spec)
  }
  return m
}

function selftest () {
  const Y = `## 2. Взаимодействия
### INT-1. Проверка пропуска — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** shuttle-api → badge-service
- **Контракт (запрос):** \`GET /api/v3/badges?holderLogin={login}\`
- **Происхождение:** 🔵 подтверждено аналитиком (по карточке \`services/badge-service.md\`; валидировать при интеграции)
### INT-2. Карточка рейса — 🟢
- **Вид:** изменение существующего
- **Граница/направление:** shuttle-web → shuttle-api, карточка рейса
- **Существующий стык:** \`GET /v1/trips/{tripId}\` — 🔵 подтверждено аналитиком (по карточке \`services/shuttle-api.md\`)
| Поле | Где | Было | Стало |
|---|---|---|---|
| \`bikeRack\` | ответ | — | \`boolean\` |
\`\`\`json
{ "tripId": "t1", "route": "Север — Центр", "seatsLeft": 3, "bikeRack": true }
\`\`\`
- **Происхождение:** 🟢 изменение существующего
### INT-3. Офис сотрудника — 🔵
- **Граница/направление:** shuttle-api → org-directory
- **Контракт (запрос):** \`GET /org/v1/employees/{login}\`
- **Происхождение:** 🔵 подтверждено аналитиком (со слов; валидировать при интеграции)
## 3. Backend`
  const I = `### INT-1. Проверка пропуска — 🟡
- **Граница/направление:** shuttle-api → badge-service
- **Контракт (запрос):** 🟡 к валидации
### INT-2. Карточка рейса — 🟢
- **Вид:** изменение существующего
- **Граница/направление:** shuttle-web → shuttle-api, карточка рейса
- **Существующий стык:** ответ карточки рейса — 🟡 к валидации
| Поле | Где | Было | Стало |
|---|---|---|---|
| \`bikeRack\` | ответ | — | \`boolean\` |
Фрагмент ответа: только новые поля; прочие поля — без изменений.
\`\`\`json
{ "bikeRack": true }
\`\`\`
- **Происхождение:** 🟢 изменение существующего
### INT-3. Офис сотрудника — 🟡
- **Граница/направление:** shuttle-api → справочник сотрудников
## 3. Backend`
  const all = (o) => Object.values(o).every(Boolean)
  const checks = [
    ['yes: эталон зелёный', all(grade(Y, 'yes')), true],
    ['yes: прежний скилл (путь пропусков словами) красный', all(grade(Y.replace('`GET /api/v3/badges?holderLogin={login}`', 'словами — проверка пропуска'), 'yes')), false],
    ['yes: без вида красный', all(grade(Y.replaceAll('изменение существующего', 'новое'), 'yes')), false],
    ['yes: путь под 🟡 ловится', all(grade(Y + '\n- 🟡 к валидации: GET /org/v1/employees/{login}', 'yes')), false],
    ['idk: эталон зелёный', all(grade(I, 'idk')), true],
    ['idk: путь пропусков под 🟡 красный', all(grade(I.replace('🟡 к валидации\n### INT-2', '🟡 к валидации `GET /api/v3/badges`\n### INT-2'), 'idk')), false],
    ['idk: старое поле в таблице красное', all(grade(I.replace('| `bikeRack` | ответ | — | `boolean` |', '| `bikeRack` | ответ | — | `boolean` |\n| `seatsLeft` | ответ | `int` | `int` |'), 'idk')), false],
    ['idk: JSON без подписи красный', all(grade(I.replace('Фрагмент ответа: только новые поля; прочие поля — без изменений.\n', ''), 'idk')), false],
  ]
  let ok = 0
  for (const [name, got, want] of checks) { const pass = got === want; if (pass) ok++; console.log(`  ${pass ? '✅' : '❌'} ${name}`) }
  if (!all(grade(I, 'idk'))) console.log('    idk эталон, промахи:', Object.entries(grade(I, 'idk')).filter(([, v]) => !v).map(([k]) => k).join('; '))
  console.log(`самопроверка: ${ok}/${checks.length}`)
  process.exit(ok === checks.length ? 0 : 1)
}

if (process.argv.includes('--selftest')) selftest()
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['yes', 'idk'].includes(kase)) { console.error('usage: node grade-ts-blue.mjs <каталог плеча> --case=yes|idk | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба ts-blue-${kase}, ${arg}`)
let measured = 0; let green = 0
const fails = {}
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const spec = read(join(dir, REL))
  if (!spec) { console.log(`  ${n}: красный  спеки нет`); fails['спеки нет'] = (fails['спеки нет'] || 0) + 1; continue }
  const m = grade(spec, kase)
  const bad = Object.entries(m).filter(([, v]) => !v).map(([k]) => k)
  for (const b of bad) fails[b] = (fails[b] || 0) + 1
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
}
console.log(`\n  по признакам (прогонов с промахом): ${Object.entries(fails).map(([k, v]) => `${k} ${v}`).join('; ') || 'нет'}`)
console.log(`  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
