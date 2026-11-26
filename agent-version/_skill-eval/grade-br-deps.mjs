#!/usr/bin/env node
// grade-br-deps.mjs — пробы гейта 17 «Внешние зависимости» (скилл: business-requirements-doc 1.2.0),
// PLAN-BR-SECTIONS §1.1, батч B.
//
//   node grade-br-deps.mjs <каталог плеча> --case=yes|no
//   node grade-br-deps.mjs --selftest
//
// ЧТО МЕРЯЕТСЯ. Один ход «ПРОДОЛЖЕНИЕ» (CNT-88, электронный чек в приложении столовой), все гейты
// закрыты → БТ этим ходом.
//   yes — «ждём от команды платёжного шлюза подтверждения реквизитов чека»: §3.4 называет команду и
//         что ждём; срок не выдуман (его не давали: срок — атомарный факт, гипотезой не предлагается и
//         в «Закрыт:» не требуется); в §3.4 нет TBD/⚠️; зависимость не переехала в §3.3 (там —
//         затронутые системы: платёжный шлюз как связь уже есть).
//   no  — «внешних зависимостей нет»: §3.4 говорит «нет», без TBD/⚠️.
//
// Критерии названы до прогонов (PLAN-BR-SECTIONS §1.0: N = 3, провал новой пробы → разбор).

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { read, turn, apiFailed, section, sectionByTitle } from './br-lib.mjs'

const REL = 'coddoc/CNT-88/business_requirements.md'
export const RE_DATE = /\b\d{1,2}\.\d{1,2}(\.\d{2,4})?\b|(?<!\p{L})до\s+\d|(?<!\p{L})к\s+\d{1,2}(?!\d)|\b20\d\d\b|недел|квартал|(?<!\p{L})срок\p{L}*\s*[:—-]\s*(?=\S)(?!(не|нет)(?!\p{L}))/iu
const RE_DEP = /подтвержд/i
// Зависимость в §3.3: ожидание от команды, а не слово «подтверждение» (шлюз законно «присылает подтверждение оплаты»).
const RE_WAIT = /(жд[её]м|ожида\p{L}*\s+от|зависим\p{L}*\s+от\s+команд|подтвержд\p{L}*[^\n]{0,60}реквизит|реквизит\p{L}*[^\n]{0,60}подтвержд)/iu

export function gradeDoc (cs, text) {
  const r = { exists: text !== null }
  if (!r.exists) { r.ok = false; return r }
  const sec = sectionByTitle(text, /внешн\S*\s+зависим/i); const s34 = sec ? sec.body : null; r.num = sec ? sec.num : null
  const s33 = section(text, '3.3') || (sectionByTitle(text, /архитектур|интеграц/i) || {}).body || ''
  r.has34 = !!s34
  if (!r.has34) { r.ok = false; return r }
  r.open = /TBD|⚠/.test(s34)
  if (cs === 'yes') {
    r.dep = /шлюз/i.test(s34) && RE_DEP.test(s34)
    r.date = RE_DATE.test(s34)
    r.mix = RE_WAIT.test(s33)
    r.ok = r.dep && !r.date && !r.open && !r.mix
  } else {
    r.none = /(?<!\p{L})нет(?!\p{L})|отсутству/iu.test(s34)
    r.ok = r.none && !r.open
  }
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`) }
  const doc = (s33, s34) => `# БТ\n\n### 3.3. Архитектурные изменения и интеграции\n${s33}\n\n### 3.4. Внешние зависимости\n${s34}\n\n## 4. Функциональные требования\n`
  const s33 = 'Данные чека приложение берёт у платёжного шлюза — эта связь уже есть.'
  ck('yes: команда и что ждём — зелёный', gradeDoc('yes', doc(s33, 'Ждём от команды платёжного шлюза подтверждения, что она отдаёт все реквизиты чека.')).ok, true)
  ck('yes: выдуманный срок «до 15.01» — красный', gradeDoc('yes', doc(s33, 'Ждём от команды платёжного шлюза подтверждения реквизитов чека до 15.01.2027.')).ok, false)
  ck('yes: «срок: TBD» — красный', gradeDoc('yes', doc(s33, 'Ждём от команды платёжного шлюза подтверждения реквизитов. Срок — TBD.')).ok, false)
  ck('yes: «срок не назван» — зелёный', gradeDoc('yes', doc(s33, 'Ждём от команды платёжного шлюза подтверждения реквизитов чека; срок не назван.')).ok, true)
  ck('yes: «срок: не назван» — зелёный', gradeDoc('yes', doc(s33, 'Ждём от команды платёжного шлюза подтверждения реквизитов чека. Срок: не назван.')).ok, true)
  ck('yes: «к 15 марта» — красный', gradeDoc('yes', doc(s33, 'Ждём от команды платёжного шлюза подтверждения реквизитов чека к 15 марта.')).ok, false)
  ck('yes: зависимость в §3.3 — красный', gradeDoc('yes', doc(s33 + ' Ждём подтверждения реквизитов от шлюза.', 'Ждём от команды платёжного шлюза подтверждения реквизитов чека.')).ok, false)
  ck('yes: «шлюз присылает подтверждение оплаты» в §3.3 — не смешение', gradeDoc('yes', doc(s33 + ' После оплаты шлюз присылает подтверждение оплаты.', 'Ждём от команды платёжного шлюза подтверждения реквизитов чека.')).ok, true)
  ck('yes: §3.4 нет — красный', gradeDoc('yes', `# БТ\n### 3.3. Интеграции\n${s33}\n## 4. ФТ\n`).ok, false)
  ck('no: «Внешних зависимостей нет» — зелёный', gradeDoc('no', doc(s33, 'Внешних зависимостей нет.')).ok, true)
  ck('no: «Отсутствуют» — зелёный', gradeDoc('no', doc(s33, 'Отсутствуют.')).ok, true)
  ck('no: «нетривиальная интеграция» без «нет» — красный', gradeDoc('no', doc(s33, 'Нетривиальная интеграция со шлюзом.')).ok, false)
  ck('no: «§5.5 Интеграции и зависимости» — не раздел зависимостей, красный', gradeDoc('no', `# БТ\n### 3.3. Интеграции\nX\n### 5.5 Интеграции и зависимости\nВнешних зависимостей нет.\n`).ok, false)
  ck('no: TBD — красный', gradeDoc('no', doc(s33, 'TBD')).ok, false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const arg = process.argv[2]
if (arg === '--selftest') selftest()
const cs = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !['yes', 'no'].includes(cs)) { console.error('usage: node grade-br-deps.mjs <каталог плеча> --case=yes|no | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба br-deps-${cs}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const b = gradeDoc(cs, read(join(dir, REL)))
  if (b.ok) green++
  const notes = [
    !b.exists && 'файла нет', b.exists && !b.has34 && 'раздела «Внешние зависимости» нет', b.num && b.num !== '3.4' && `«Внешние зависимости» под номером ${b.num}`, b.open && '§3.4: TBD/⚠️',
    b.dep === false && '§3.4: не названо, чего и от кого ждём', b.date && '§3.4: срок, которого не давали', b.mix && 'зависимость переехала в §3.3',
    b.none === false && '§3.4: нет «нет»',
  ].filter(Boolean)
  console.log(`  ${n}: ${b.ok ? 'зелёный' : 'красный'}${notes.length ? ' · ' + notes.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ (N = 3: провал → разбор)\n`)
