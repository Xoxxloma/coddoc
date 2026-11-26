#!/usr/bin/env node
// grade-header.mjs — шапка документа: строки «Редакция» и «Версия скилла».
//
//   node grade-header.mjs <папка раунда> [--probe=имя]
//   node grade-header.mjs --selftest
//
// Грейдится файл в песочнице, а не отчёт. Версия сверяется со снимком скилла в `<раунд>/_skills/`, дата —
// с днём записи файла (±1 день: часовой пояс). Файла нет — «не измерено», а не провал: уход в вопросы
// законен, и шапка тут ни при чём. Песочница `<раунд>/<проба>/run-NN/`.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const BR = 'business_requirements.md'
const BUG = 'bug_report.md'
const CR = 'change_request.md'
const TS = 'technical_specification.md'

// rel — файл из засева, который обязан быть доработан; name — новый файл, найти по имени.
// keep — записи «Версии скилла» из засева. redaction — ожидаемый номер.
export const PROBES = {
  'br-yes': { name: BR, skill: 'business-requirements-doc', redaction: 1 },
  'br-rework': { rel: 'coddoc/RMS-5102/' + BR, skill: 'business-requirements-doc', redaction: 2 },
  'bg-form-w': { name: BUG, skill: 'bug-report-doc', redaction: 1 },
  'bg-rework-w': { rel: 'coddoc/ARS-411/' + BUG, skill: 'bug-report-doc', redaction: 2, keep: ['bug-report-doc 1.2.0'] },
  'cr-btn-w': { name: CR, skill: 'change-request-doc', redaction: 1 },
  'cr-rework-w': { rel: 'coddoc/ARS-326/' + CR, skill: 'change-request-doc', redaction: 2, keep: ['change-request-doc 1.3.0'] },
  'ts-live': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'ts-fix': { rel: 'coddoc/PSS-2210/' + TS, skill: 'technical-spec-doc', redaction: 2 },
  'bf-spec': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'td-ru-w': { name: BR, skill: 'task-decomposition-doc', redaction: 1 },
  'br-half': { name: BR, skill: 'business-requirements-doc', redaction: 1 },
  'br-open-w': { name: BR, skill: 'business-requirements-doc', redaction: 1 },
  'br-roles-w': { name: BR, skill: 'business-requirements-doc', redaction: 1 },
  'bg-role-w': { name: BUG, skill: 'bug-report-doc', redaction: 1 },
  'cr-api-w': { name: CR, skill: 'change-request-doc', redaction: 1 },
  'ts-conv': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'ts-ctx': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'ts-noctx': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'ts-gaps': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'ts-cr-api': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
  'bfx-doc': { name: TS, skill: 'technical-spec-doc', redaction: 1 },
}

const RE_REDACTION = /^>\s*\*\*Редакция:\*\*\s*(\d+)(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*$/m
const RE_VERSION_LINE = /^>\s*\*\*Версия скилла:\*\*\s*(.*?)\s*$/m

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)
const dayDiff = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000

/** Чистая проверка текста: ver — версия из снимка, day — день записи файла. */
export function gradeDoc (text, spec, ver, day) {
  const miss = []
  const t = text.replace(/\r\n/g, '\n')
  const red = t.match(RE_REDACTION)
  if (!red) miss.push('нет строки «Редакция» в форме `N (дата)`')
  else {
    if (Number(red[1]) !== spec.redaction) miss.push(`редакция ${red[1]}, ожидалась ${spec.redaction}`)
    if (!red[2]) miss.push('дата не проставлена')
    else if (dayDiff(red[2], day) > 1) miss.push(`дата ${red[2]}, файл записан ${day}`)
  }
  const line = t.match(RE_VERSION_LINE)
  if (!line) miss.push('нет строки «Версия скилла»')
  else {
    const items = line[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean)
    const want = `${spec.skill} ${ver}`
    if (!items.includes(want)) miss.push(`нет «${want}»: ${line[1] || 'пусто'}`)
    for (const k of spec.keep ?? []) if (!items.includes(k)) miss.push(`потеряна запись «${k}»`)
    const odd = items.filter((i) => !new RegExp(`^${spec.skill} \\d+\\.\\d+\\.\\d+$`).test(i) && !(spec.keep ?? []).includes(i))
    if (odd.length) miss.push(`лишнее: ${odd.join(', ')}`)
    if (new Set(items).size !== items.length) miss.push(`повтор: ${line[1]}`)
  }
  return { pass: miss.length === 0, miss }
}

function walk (dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.claude' || e.name === '.git' || e.name === 'node_modules') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Что записал прогон: файл засева по `rel`, новые файлы — по имени, без засеянных. */
function docsOf (run, spec) {
  if (spec.rel) {
    const p = join(run, spec.rel)
    return existsSync(p) ? [p] : []
  }
  const seededFile = join(run, '_seeded.txt')
  const seeded = new Set(existsSync(seededFile)
    ? readFileSync(seededFile, 'utf8').split(/\r?\n/).map((s) => s.replace(/^\.\//, '').trim()).filter(Boolean)
    : [])
  return walk(run).filter((p) => basename(p) === spec.name && !seeded.has(relative(run, p).replace(/\\/g, '/')))
}

function snapshotVersion (round, skill) {
  for (const p of [join(round, '_skills', `${skill}.SKILL.md`), join(round, '_skills', skill, 'SKILL.md')]) {
    if (existsSync(p)) return (readFileSync(p, 'utf8').match(/^version:\s*(\S+)/m) || [])[1]
  }
  return null
}

function gradeProbe (round, probe) {
  const spec = PROBES[probe]
  const dir = join(round, probe)
  const ver = snapshotVersion(round, spec.skill)
  const rows = []
  if (!existsSync(dir)) return { probe, rows, why: 'папки пробы нет' }
  if (!ver) return { probe, rows, why: `нет снимка ${spec.skill}` }
  for (const run of readdirSync(dir).filter((n) => /^run-\d+$/.test(n)).sort()) {
    const sb = join(dir, run)
    const docs = docsOf(sb, spec)
    if (!docs.length) { rows.push({ run, measured: false, why: 'файл не записан' }); continue }
    for (const p of docs) {
      const r = gradeDoc(readFileSync(p, 'utf8'), spec, ver, dayOf(statSync(p).mtimeMs))
      rows.push({ run, measured: true, file: relative(sb, p).replace(/\\/g, '/'), ...r })
    }
  }
  return { probe, rows }
}

function selftest () {
  const spec = { skill: 'bug-report-doc', redaction: 2, keep: ['bug-report-doc 1.2.0'] }
  const day = '2026-10-30'
  const ok = '> **Задача:** A-1\n> **Редакция:** 2 (2026-10-30)\n> **Версия скилла:** bug-report-doc 1.2.0, bug-report-doc 1.3.0\n'
  let bad = 0
  const ck = (name, got, want) => { if (got !== want) { bad++; console.log(`ОШИБКА ${name}`) } }
  const g = (t, s = spec) => gradeDoc(t, s, '1.3.0', day).pass
  ck('верная шапка — зелёная', g(ok), true)
  ck('CRLF — зелёная', g(ok.replace(/\n/g, '\r\n')), true)
  ck('±1 день — зелёная', g(ok.replace('2026-10-30', '2026-10-31')), true)
  ck('пустой файл — красный', g(''), false)
  ck('нет строки редакции — красный', g(ok.replace(/> \*\*Редакция.*\n/, '')), false)
  ck('редакция не поднята — красный', g(ok.replace('Редакция:** 2', 'Редакция:** 1')), false)
  ck('дата не обновлена — красный', g(ok.replace('2026-10-30', '2026-10-02')), false)
  ck('без даты — красный', g(ok.replace(' (2026-10-30)', '')), false)
  ck('инструкция шаблона осталась — красный', g(ok.replace('2 (2026-10-30)', '[N (ГГГГ-ММ-ДД): первая запись 1]')), false)
  ck('нет строки версии — красный', g(ok.replace(/> \*\*Версия.*\n/, '')), false)
  ck('старая версия потеряна — красный', g(ok.replace('bug-report-doc 1.2.0, ', '')), false)
  ck('новая не дописана — красный', g(ok.replace(', bug-report-doc 1.3.0', '')), false)
  ck('чужой скилл в списке — красный', g(ok.replace('1.3.0\n', '1.3.0, analyst-workspace 2.1.1\n')), false)
  ck('повтор версии — красный', g(ok.replace('1.3.0\n', '1.3.0, bug-report-doc 1.3.0\n')), false)
  ck('новый документ — зелёный', g(ok.replace('Редакция:** 2', 'Редакция:** 1').replace('bug-report-doc 1.2.0, ', ''), { skill: 'bug-report-doc', redaction: 1 }), true)
  console.log(bad ? `selftest: ${bad} ошибок` : 'selftest: ок')
  process.exit(bad ? 1 : 0)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--selftest')) selftest()
  const round = process.argv[2]
  const only = (process.argv.find((a) => a.startsWith('--probe=')) || '').slice('--probe='.length)
  if (!round) { console.error('usage: grade-header.mjs <папка раунда> [--probe=имя]'); process.exit(2) }
  let pass = 0, total = 0, unmeasured = 0
  for (const probe of only ? [only] : Object.keys(PROBES)) {
    const { rows, why } = gradeProbe(round, probe)
    if (why) { console.log(`${probe}: не измерено — ${why}`); continue }
    if (!rows.length) { console.log(`${probe}: не измерено — прогонов нет`); continue }
    for (const r of rows) {
      if (!r.measured) { unmeasured++; console.log(`${probe}/${r.run}: не измерено — ${r.why}`); continue }
      total++
      if (r.pass) pass++
      console.log(`${probe}/${r.run}: ${r.pass ? 'зелёный' : 'КРАСНЫЙ'} ${r.file}${r.miss.length ? ' — ' + r.miss.join('; ') : ''}`)
    }
  }
  console.log(`\nИТОГО: ${pass}/${total} зелёных, не измерено ${unmeasured}`)
}
