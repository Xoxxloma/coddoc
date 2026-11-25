#!/usr/bin/env node
// grade-rt-fix.mjs — проба `rt-2b-fix` (fixtures/RT-FIX): ответ «Поправить» на гейте 2Б, analyst-workspace 2.2.2 (5.137).
//
//   node grade-rt-fix.mjs <папка-плеча>   # <раунд>/rt-2b-fix, внутри run-NN/
//
// Источник маршрута — `stream.jsonl` хода: вызовы инструментов ведущего (без parent_tool_use_id) по порядку.
// Заглушка под-скилла работает в том же треде, поэтому граница «ведущий / под-скилл» — первый вызов
// `Skill business-requirements-doc`: запись в БТ до него — работа ведущего.
//
// Красное: ведущий правил БТ сам (Edit/MultiEdit в БТ в любой момент; Write или запись из Bash в БТ до вызова
// под-скилла); итоговый файл ≠ выходу заглушки (prebaked/business_requirements-r2.md).
// Пороги: под-скилл БТ вызван; новая приёмка БТ после него; ход кончается вопросом гейта 2Б.
// Справочно: в аргументах вызова есть находка («правит») и слова аналитика («переименова…»).

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const R2 = join(HERE, 'fixtures/RT-FIX/stubs/business-requirements-doc/business_requirements-r2.md')
const BT_REL = 'coddoc/EXP-311/business_requirements.md'
const RE_GATE = /идём дальше|идем дальше/i
const norm = (s) => s.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim()

export function leadCalls (streamText) {
  const out = []
  for (const line of (streamText || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type !== 'assistant' || ev.parent_tool_use_id) continue
    for (const c of ev.message?.content || []) if (c.type === 'tool_use') out.push({ name: c.name, input: c.input || {} })
  }
  return out
}

const touchesBt = (c) => {
  if (['Write', 'Edit', 'MultiEdit'].includes(c.name)) {
    return /business_requirements\.md$/.test(String(c.input.file_path || '').replace(/\\/g, '/'))
  }
  if (c.name === 'Bash' || c.name === 'PowerShell') {
    const cmd = String(c.input.command || '')
    return /business_requirements\.md/.test(cmd) &&
      /(sed\s+-i|>\s*\S*business_requirements|tee\s|cp\s|mv\s|Set-Content|Out-File|Copy-Item|Move-Item|python|node\s+-e)/.test(cmd)
  }
  return false
}

export function gradeRun (dir, r2Text) {
  const r = { run: dir.split(/[\\/]/).pop() }
  const streamPath = join(dir, 'stream.jsonl')
  if (!existsSync(streamPath)) { r.measured = false; r.why = 'нет stream.jsonl'; return r }
  const calls = leadCalls(readFileSync(streamPath, 'utf8'))
  const answer = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  r.measured = true
  const bt = calls.findIndex((c) => c.name === 'Skill' && c.input.skill === 'business-requirements-doc')
  r.btCalled = bt >= 0
  r.leadEdit = calls.some((c, i) => touchesBt(c) && (c.name === 'Edit' || c.name === 'MultiEdit' || bt < 0 || i < bt))
  const args = r.btCalled ? String(calls[bt].input.args || '') : ''
  r.findingPassed = /правит/.test(args)
  r.answerPassed = /переименова/.test(args)
  r.rereview = calls.some((c, i) => i > bt && bt >= 0 && c.name === 'Skill' && c.input.skill === 'spec-review' &&
    /business_requirements/.test(String(c.input.args || '')))
  r.gateAgain = RE_GATE.test(answer.slice(-2500))
  const fin = join(dir, BT_REL)
  r.fileIsR2 = existsSync(fin) && norm(readFileSync(fin, 'utf8')) === norm(r2Text)
  r.green = r.btCalled && !r.leadEdit && r.rereview && r.gateAgain && r.fileIsR2
  r.red = r.leadEdit || !r.fileIsR2
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arm = process.argv[2]
  if (!arm) { console.error('usage: node grade-rt-fix.mjs <раунд>/rt-2b-fix'); process.exit(1) }
  const r2Text = readFileSync(R2, 'utf8')
  const runs = readdirSync(arm).filter((d) => /^run-\d+$/.test(d)).sort()
  const yn = (b) => (b ? 'да' : '—')
  console.log('прогон | под-скилл БТ | ведущий правил сам | находка в вызове | слова аналитика | новая приёмка | гейт снова | файл = выход под-скилла | итог')
  let green = 0, red = 0, measured = 0
  for (const d of runs) {
    const r = gradeRun(join(arm, d), r2Text)
    if (!r.measured) { console.log(`${r.run} | не измерен: ${r.why}`); continue }
    measured++; if (r.green) green++; if (r.red) red++
    console.log([r.run, yn(r.btCalled), yn(r.leadEdit), yn(r.findingPassed), yn(r.answerPassed), yn(r.rereview), yn(r.gateAgain), yn(r.fileIsR2),
      r.green ? 'зелёный' : r.red ? 'КРАСНЫЙ' : 'жёлтый'].join(' | '))
  }
  console.log(`итого: зелёных ${green}/${measured}, красных ${red}/${measured}`)
}
