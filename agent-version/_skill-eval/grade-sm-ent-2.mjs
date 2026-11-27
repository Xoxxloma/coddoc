#!/usr/bin/env node
// grade-sm-ent-2.mjs — проба «сущности — сверка сверху» под разведчика (фикстура SM-ENT-2).
//
//   node grade-sm-ent-2.mjs <папка-раунда>/sm-ent-2 [--json]
//   node grade-sm-ent-2.mjs --selftest            ответы руками из fixtures/SM-ENT-2/grader-selftest/
//
// Логика — grade-sm-ent.mjs без изменений: ПОСЛЕДНЯЯ строка «СУЩНОСТИ: …»; у ДОБОР в ответе обязаны быть
// «убери» (из «Владеет данными») и перезапись строки `сущности:` (без неё добор порождает тупик «Сущности у
// ручек»); «прежняя карточка остаётся» считается отдельно. Отличия: ожидания — из fixtures/SM-ENT-2/expect.json,
// пустой ответ — НЕ ИЗМЕРЕНО (в знаменатель не идёт), есть --json и --selftest.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FIX = join(import.meta.dirname, 'fixtures', 'SM-ENT-2')
const loadExpect = () => JSON.parse(readFileSync(join(FIX, 'expect.json'), 'utf8'))
const RE = /СУЩНОСТИ:\s*\**\s*(ПРОЙДЕН|ДОБОР)/g
const STAY = /прежняя карточка остаётся|карточк[аи] не (будет|пишется)|не продвига/i

export function grade (t, w) {
  const m = [...t.matchAll(RE)]; const got = m.length ? m[m.length - 1][1] : null
  if (!got) return { verdict: null, pass: false, stay: STAY.test(t), note: 'строки «СУЩНОСТИ: …» нет' }
  let pass = got === w.want; let note = pass ? '' : (got === 'ДОБОР' ? 'ЛОЖНЫЙ добор' : 'добор ПРОПУЩЕН')
  if (pass && got === 'ДОБОР') {
    const hasRemove = /убери|убрать|удали/i.test(t), hasRewrite = /сущности:/.test(t) && /перепиш|не сущность/i.test(t)
    if (!hasRemove || !hasRewrite) { pass = false; note = `добор без ${!hasRemove ? '«убери»' : ''}${!hasRemove && !hasRewrite ? ' и ' : ''}${!hasRewrite ? 'перезаписи сущности:' : ''}` }
  }
  const stay = STAY.test(t)
  return { verdict: got, pass, stay, note: [note, stay ? 'оставил прежнюю карточку' : ''].filter(Boolean).join('; ') }
}

function gradeDir (out) {
  const expect = loadExpect(); const rows = []; let green = 0, total = 0, empty = 0, stays = 0, cost = 0
  for (const v of Object.keys(expect)) {
    const dir = join(out, v); const w = expect[v]
    if (!existsSync(dir)) { rows.push({ v, want: w.want, ok: 0, measured: 0, empty: 0, verdicts: [], notes: ['нет прогонов'], missing: true }); continue }
    const files = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).sort()
    const res = files.map((f) => {
      const t = readFileSync(join(dir, f), 'utf8')
      const cf = join(dir, f.replace('answer', 'cost').replace('.md', '.txt')); if (existsSync(cf)) cost += parseFloat(readFileSync(cf, 'utf8')) || 0
      return t.trim() ? { f, ...grade(t, w) } : { f, verdict: null, pass: false, empty: true, note: 'пустой ответ — НЕ ИЗМЕРЕНО' }
    })
    const measured = res.filter((r) => !r.empty); const ok = measured.filter((r) => r.pass).length
    green += ok; total += measured.length; empty += res.length - measured.length; stays += measured.filter((r) => r.stay).length
    rows.push({ v, want: w.want, ok, measured: measured.length, empty: res.length - measured.length, verdicts: measured.map((r) => (r.verdict ?? '—') + (r.pass ? '' : '✗')), notes: res.filter((r) => r.note).map((r) => `${r.f}: ${r.note}`) })
  }
  return { rows, green, total, empty, stays, cost }
}

function selftest () {
  const dir = join(FIX, 'grader-selftest'); const expect = loadExpect()
  const map = JSON.parse(readFileSync(join(dir, 'selftest.json'), 'utf8'))
  let bad = 0
  console.log('ответ → ожидалось → получено')
  for (const [file, { case: c, pass: want }] of Object.entries(map)) {
    const r = grade(readFileSync(join(dir, file), 'utf8'), expect[c])
    const ok = r.pass === want; if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${file.padEnd(30)} → ${want ? 'зелёный' : 'красный'} → ${r.pass ? 'зелёный' : 'красный'}${r.note ? '  · ' + r.note : ''}`)
  }
  console.log(bad === 0 ? `\nсамопроверка: ok (${Object.keys(map).length})` : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const args = process.argv.slice(2)
if (args[0] === '--selftest') selftest()
else if (args[0] && existsSync(args[0]) && statSync(args[0]).isDirectory()) {
  const r = gradeDir(args[0])
  if (args.includes('--json')) console.log(JSON.stringify(r))
  else {
    console.log(`проба sm-ent-2, ${args[0]}`)
    for (const x of r.rows) console.log(`  ${x.v.padEnd(30)} ожидание ${x.want.padEnd(8)} ${x.ok}/${x.measured}  [${x.verdicts.join(', ')}]${x.empty ? `  не измерено ${x.empty}` : ''}${x.notes.length ? '  · ' + x.notes.join(' | ') : ''}`)
    console.log(`\n  ${r.green}/${r.total} зелёных · не измерено ${r.empty} · «прежняя остаётся» в ${r.stays} · цена: $${r.cost.toFixed(2)}`)
  }
} else { console.error('usage: node grade-sm-ent-2.mjs <раунд>/sm-ent-2 [--json] | --selftest'); process.exit(1) }
