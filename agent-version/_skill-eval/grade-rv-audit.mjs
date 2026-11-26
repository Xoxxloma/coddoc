#!/usr/bin/env node
// grade-rv-audit.mjs — пробы фикстуры RV-AUDIT: исключения чек-листов приёмки (аудит 2026-09-17).
//
//   node grade-rv-audit.mjs <каталог с песочницами> --probe=bt-clean|bt-dirty|bt-empty|bt-no43|fe|tpl-clean|tpl-dirty|tpl-count|stage-na
//   node grade-rv-audit.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ. Четыре ложных срабатывания приёмки и одно у индекса этапов (К1–К4, К8.2 в
// `PLAN-AUDIT.md`): имя роли как «внутренний код»; «требование без контракта» при явно закрытом
// §2; подзаголовок «❓ Открытые решения» как развилка; счёт статуса по §8 вместо блока шапки;
// индекс «не применимо» без таблиц и порядка. Чистые плечи обязаны дать «нарушений: 0», грязные —
// по-прежнему поймать посаженное. Состав фикстуры — `fixtures/RV-AUDIT/README.md`.
//
// С `spec-review` 1.1.0 (PLAN-BR-SECTIONS D11, п.9): `bt-empty` — законные пустые ответы новых
// разделов БТ («сейчас никак», «внешних зависимостей нет», «не применимо: причина») → 0 нарушений;
// `bt-no43` — БТ без §4.3 «Бизнес-данные» → нарушение п.9 названо.
//
// Правила репы: артефакт приёмки — `answer.md` из stdout; песочница без ответа или с отказом API —
// «НЕ ИЗМЕРЕНО»; регулярки литеральные, `\b`/`\w` рядом с кириллицей не применяются.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RE_VIOLATIONS = /нарушений[:*\s]+(\d+)/gi
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
const RE_ROLE = /ROLE_FACILITY_ADMIN|ROLE_EMPLOYEE/
const RE_PLANTED_DTO = /PassportDto/
const RE_PLANTED_NO43 = /4\.3|бизнес-данн/i
const RE_PLANTED_FORK = /Порядок комнат|порядок комнат|roomId/
const RE_FORK_SIGN = /❓|развилк/i

const CLEAN = new Set(['bt-clean', 'bt-empty', 'fe', 'tpl-clean', 'tpl-count', 'stage-na'])
const DIRTY = new Set(['bt-dirty', 'bt-no43', 'tpl-dirty'])

/** Все числа «нарушений: N» в ответе: папка и пара «документ + источник» дают несколько отчётов. */
export function counts (text) { return [...text.matchAll(RE_VIOLATIONS)].map((m) => Number(m[1])) }

export function gradeText (text, probe) {
  const c = counts(text)
  const max = c.length ? Math.max(...c) : null
  const r = { measured: true, counts: c, max, role: RE_ROLE.test(text) }
  if (CLEAN.has(probe)) {
    r.pass = c.length > 0 && max === 0
  } else if (probe === 'bt-dirty' || probe === 'bt-no43') {
    r.planted = (probe === 'bt-dirty' ? RE_PLANTED_DTO : RE_PLANTED_NO43).test(text)
    // Роль названа нарушением: находок больше одной посаженной И в отчёте стоит токен роли.
    r.roleFlagged = max !== null && max > 1 && r.role
    r.pass = max !== null && max >= 1 && r.planted && !r.roleFlagged
  } else {
    r.planted = RE_PLANTED_FORK.test(text) && RE_FORK_SIGN.test(text)
    r.pass = max !== null && max >= 1 && r.planted
  }
  return r
}

function gradeOne (dir, probe) {
  if (existsSync(join(dir, '_api-failure.txt'))) return { measured: false, why: 'отказ API' }
  const p = join(dir, 'answer.md')
  if (!existsSync(p)) return { measured: false, why: 'нет answer.md' }
  const text = readFileSync(p, 'utf8')
  if (!text.trim()) return { measured: false, why: 'пустой answer.md' }
  if (RE_API_FAILURE.test(text.slice(0, 300))) return { measured: false, why: 'отказ API' }
  return gradeText(text, probe)
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  ck('чистый отчёт — зелёный', gradeText('чек-лист прочитан, тип: бизнес-требования\nнарушений: 0', 'bt-clean').pass, true)
  ck('жирная разметка в счёте', gradeText('**нарушений:** 0', 'fe').pass, true)
  ck('роль названа нарушением на чистом — красный', gradeText('нарушений: 2\n1. §5.3 — `ROLE_FACILITY_ADMIN`', 'bt-clean').pass, false)
  ck('без счётной строки — красный', gradeText('Документ выглядит хорошо.', 'tpl-clean').pass, false)
  ck('два отчёта, один ненулевой — красный', gradeText('нарушений: 0\n...\nнарушений: 1', 'stage-na').pass, false)
  ck('грязный БТ: посаженное найдено', gradeText('нарушений: 1\n1. §3.3 — «берутся из `PassportDto`»', 'bt-dirty').pass, true)
  ck('грязный БТ: посаженное пропущено', gradeText('нарушений: 0', 'bt-dirty').pass, false)
  ck('грязный БТ: заодно названа роль — красный', gradeText('нарушений: 3\n`PassportDto`, `ROLE_EMPLOYEE`, `ROLE_FACILITY_ADMIN`', 'bt-dirty').pass, false)
  ck('пустые ответы новых разделов — зелёный', gradeText('нарушений: 0', 'bt-empty').pass, true)
  ck('«не применимо» в §4.3 названо нарушением — красный', gradeText('нарушений: 1\n1. §4.3 — «Не применимо: бизнес-данные не меняются»', 'bt-empty').pass, false)
  ck('нет §4.3: нарушение п.9 названо', gradeText('нарушений: 1\n1. п.9 — нет раздела «4.3. Бизнес-данные»', 'bt-no43').pass, true)
  ck('нет §4.3: пропущено', gradeText('нарушений: 0', 'bt-no43').pass, false)
  ck('нет §4.3: заодно названа роль — красный', gradeText('нарушений: 2\n1. нет §4.3\n2. `ROLE_EMPLOYEE`', 'bt-no43').pass, false)
  ck('грязная спека: развилка найдена', gradeText('нарушений: 2\n1. INT-1 — «Порядок комнат в ответе: ❓ не выбран»', 'tpl-dirty').pass, true)
  ck('грязная спека: развилка пропущена', gradeText('нарушений: 0', 'tpl-dirty').pass, false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) selftest()
const root = argv.find((x) => !x.startsWith('--'))
const pa = argv.find((x) => x.startsWith('--probe='))
const PROBE = pa ? pa.slice('--probe='.length) : ''
if (!root || !(CLEAN.has(PROBE) || DIRTY.has(PROBE))) {
  console.error('usage: node grade-rv-audit.mjs <каталог> --probe=bt-clean|bt-dirty|bt-empty|bt-no43|fe|tpl-clean|tpl-dirty|tpl-count|stage-na'); process.exit(1)
}
const runs = readdirSync(root).filter((n) => /^run-\d+$/.test(n) && statSync(join(root, n)).isDirectory()).sort()
const rows = runs.map((n) => [n, gradeOne(join(root, n), PROBE)])
const ok = rows.filter(([, r]) => r.measured)
console.log(`\nпроба rv-${PROBE}, ${root}`)
console.log(`прогонов: ${rows.length}, измерено: ${ok.length}`)
for (const [n, r] of rows) {
  if (!r.measured) { console.log(`  ${n}: НЕ ИЗМЕРЕНО (${r.why})`); continue }
  const extra = DIRTY.has(PROBE) ? `  посаженное: ${r.planted ? 'найдено' : 'ПРОПУЩЕНО'}${r.roleFlagged ? '  ЛОЖНОЕ: роль названа нарушением' : ''}` : (r.role && r.max ? '  в отчёте назван токен роли' : '')
  console.log(`  ${n}: ${r.pass ? 'зелёный' : 'красный'}  нарушений: ${r.counts.length ? r.counts.join('/') : '?'}${extra}`)
}
const green = ok.filter(([, r]) => r.pass).length
console.log(`\n  ${green}/${ok.length}\tзелёных — ${CLEAN.has(PROBE) ? '«нарушений: 0», ложного срабатывания нет' : 'посаженное нарушение поймано'}  ← КРИТЕРИЙ\n`)
