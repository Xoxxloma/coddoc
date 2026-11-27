#!/usr/bin/env node
// grade-sm-slice-lead.mjs — изолированные случаи решений ведущего при нарезке (фикстура SM-SLICE-LEAD).
//
//   node grade-sm-slice-lead.mjs <папка-раунда>/sm-slice-lead [--json]
//   node grade-sm-slice-lead.mjs --selftest        ответы руками из fixtures/SM-SLICE-LEAD/grader-selftest/
//
// Читается ПОСЛЕДНЯЯ строка «РЕШЕНИЕ: …»; ожидания — fixtures/SM-SLICE-LEAD/expect.json:
//   want              вердикт: ОДИН ЧИТАЮЩИЙ | НАРЕЗКА | ДОБОР | СКЛЕЙКА ЗАНОВО | ПРОДВИЖЕНИЕ | КАРТОЧКУ НЕ ПИСАТЬ;
//   to                у ДОБОР — кому: номер части («02») | остаток | голова | читающий;
//   report_must       [[регэксп, зачем]] — хотя бы одна строка «ОТЧЁТ:» отвечает КАЖДОМУ регэкспу
//                     (все регэкспы — в одной и той же строке);
//   report_forbid     [[регэксп, зачем]] — ни одна строка «ОТЧЁТ:» не отвечает;
//   action_forbid     [[регэксп, зачем]] — ни одна строка «ДЕЙСТВИЕ:» без отрицания («не», «нельзя») не отвечает;
//   action_must       [[регэксп, зачем]] — на каждый регэксп есть строка «ДЕЙСТВИЕ:» (любая: «…4, а не 5» — не отказ);
//   soft_action_must / soft_action_forbid — то же, но только пометкой «(мягко)», не провал.
// Пустой ответ и _api-failure-N.txt — НЕ ИЗМЕРЕНО, в знаменатель не идут. Грейдится файл ответа.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const FIX = process.env.SM_FIX || join(HERE, 'fixtures', 'SM-SLICE-LEAD')   // SM_FIX — другая фикстура того же формата (SM-SLICE-LEAD-2)
const loadExpect = () => JSON.parse(readFileSync(join(FIX, 'expect.json'), 'utf8'))

// «В PENDING» — это «В _PENDING»: подчёркивание снимается вместе с разметкой; «СКЛЕЙКА» стоит после «СКЛЕЙКА ЗАНОВО»
const VERDICTS = ['ОДИН ЧИТАЮЩИЙ', 'НАРЕЗКА', 'ВТОРОЙ ЗАПУСК СЧЁТЧИКА', 'ДОБОР', 'СКЛЕЙКА ЗАНОВО', 'СКЛЕЙКА', 'ПРОДВИЖЕНИЕ', 'В PENDING', 'КАРТОЧКУ НЕ ПИСАТЬ']
const RE_LINE = (tag) => new RegExp(`^[\\s>*_\\-•\\d.)]*${tag}[\\s*_]*:(.*)$`, 'i')
const RE_REPORT = RE_LINE('ОТЧ[ЁЕ]Т')
const RE_ACTION = RE_LINE('ДЕЙСТВИЕ')
const NEG = /(^|[^а-яё])(не|нельзя|запрещ[а-яё]*)(?![а-яё])/i

export function verdictOf (text) {
  const lines = text.split('\n').filter((l) => /РЕШЕНИЕ\s*:/.test(l))
  if (!lines.length) return null
  const raw = lines[lines.length - 1].replace(/^.*?РЕШЕНИЕ\s*:/, '').replace(/[*`_]/g, '').trim()
  const v = VERDICTS.find((x) => raw.toUpperCase().startsWith(x))
  if (!v) return { v: null, raw }
  let to = null
  if (v === 'ДОБОР') {
    const rest = raw.slice(v.length).toLowerCase()
    const m = rest.match(/част\S*\s*(?:№\s*)?0?(\d+)/)
    to = m ? m[1].padStart(2, '0') : /остат/.test(rest) ? 'остаток' : /голов/.test(rest) ? 'голова' : /читающ/.test(rest) ? 'читающий' : (rest.trim() || '?')
  }
  return { v, to, raw }
}
// строки с меткой; пустая метка берёт следующие строки до пустой
function tagged (text, re) {
  const L = text.split('\n'); const out = []
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(re); if (!m) continue
    if (m[1].replace(/[*_\s]/g, '')) { out.push(m[1].trim()); continue }
    for (let k = i + 1; k < L.length && L[k].trim() && !RE_REPORT.test(L[k]) && !RE_ACTION.test(L[k]) && !/РЕШЕНИЕ\s*:/.test(L[k]); k++) out.push(L[k].trim())
  }
  return out
}
export const reportLines = (t) => tagged(t, RE_REPORT)
export const actionLines = (t) => tagged(t, RE_ACTION)

export function grade (text, w) {
  const V = verdictOf(text)
  if (!V) return { verdict: null, pass: false, note: 'строки «РЕШЕНИЕ: …» нет' }
  if (!V.v) return { verdict: V.raw.slice(0, 30), pass: false, note: `вердикт вне списка: «${V.raw.slice(0, 40)}»` }
  const shown = V.v + (V.to ? ` — ${V.to}` : '')
  if (V.v !== w.want) return { verdict: shown, pass: false, note: `ждали ${w.want}${w.to ? ' — ' + w.to : ''}` }
  const notes = []; let pass = true
  const fail = (n) => { pass = false; notes.push(n) }
  if (w.to && V.to !== w.to) fail(`добор не той части: ${V.to}, ждали ${w.to}`)
  const rep = reportLines(text); const act = actionLines(text).filter((l) => !NEG.test(l))
  if (w.report_must?.length && !rep.some((l) => w.report_must.every(([re]) => new RegExp(re, 'i').test(l)))) fail(`нет строки ОТЧЁТ: ${w.report_must.map(([, why]) => why).join('; ')}`)
  for (const [re, why] of w.report_forbid || []) { const l = rep.find((x) => new RegExp(re, 'i').test(x)); if (l) fail(`${why}: «${l.slice(0, 70)}»`) }
  for (const [re, why] of w.action_forbid || []) { const l = act.find((x) => new RegExp(re, 'i').test(x)); if (l) fail(`${why}: «${l.slice(0, 70)}»`) }
  for (const [re, why] of w.action_must || []) if (!actionLines(text).some((x) => new RegExp(re, 'i').test(x))) fail(`нет действия: ${why}`)
  for (const [re, why] of w.soft_action_forbid || []) if (act.some((x) => new RegExp(re, 'i').test(x))) notes.push(`(мягко) ${why}`)
  for (const [re, why] of w.soft_action_must || []) if (!act.some((x) => new RegExp(re, 'i').test(x))) notes.push(`(мягко) нет действия: ${why}`)
  return { verdict: shown, pass, note: notes.join('; ') }
}

function gradeDir (out) {
  const expect = loadExpect()
  const rows = []; let green = 0, total = 0, empty = 0, cost = 0
  for (const v of Object.keys(expect)) {
    const dir = join(out, v); const w = expect[v]
    if (!existsSync(dir)) { rows.push({ v, want: w.want, ok: 0, measured: 0, empty: 0, verdicts: [], notes: ['нет прогонов'] }); continue }
    const files = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).sort()
    const failures = readdirSync(dir).filter((f) => /^_api-failure-\d+\.txt$/.test(f)).length
    const res = files.map((f) => {
      const t = readFileSync(join(dir, f), 'utf8')
      const cf = join(dir, f.replace('answer', 'cost').replace('.md', '.txt')); if (existsSync(cf)) cost += Number(readFileSync(cf, 'utf8')) || 0
      return t.trim() ? { f, ...grade(t, w) } : { f, verdict: null, pass: false, empty: true, note: 'пустой ответ — НЕ ИЗМЕРЕНО' }
    })
    const measured = res.filter((r) => !r.empty); const ok = measured.filter((r) => r.pass).length
    green += ok; total += measured.length; empty += res.length - measured.length + failures
    rows.push({ v, want: w.want + (w.to ? ` — ${w.to}` : ''), ok, measured: measured.length, empty: res.length - measured.length + failures, verdicts: measured.map((r) => r.verdict ?? '?'), notes: res.filter((r) => r.note).map((r) => `${r.f}: ${r.note}`) })
  }
  return { rows, green, total, empty, cost }
}

function selftest () {
  const dir = join(FIX, 'grader-selftest'); const expect = loadExpect()
  const map = JSON.parse(readFileSync(join(dir, 'selftest.json'), 'utf8'))
  let bad = 0
  console.log('ответ → ожидалось → получено')
  for (const [file, { case: c, pass: want }] of Object.entries(map)) {
    const r = grade(readFileSync(join(dir, file), 'utf8'), expect[c])
    const ok = r.pass === want; if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${file.padEnd(30)} → ${want ? 'зелёный' : 'красный'} → ${r.pass ? 'зелёный' : 'красный'}  [${r.verdict ?? '—'}]${r.note ? '  · ' + r.note : ''}`)
  }
  const covered = new Set(Object.values(map).map((x) => x.case))
  const missing = Object.keys(expect).filter((c) => !covered.has(c))
  if (missing.length) { bad++; console.log(`  FAIL  случаи без ответов самопроверки: ${missing.join(', ')}`) }
  console.log(bad === 0 ? `\nсамопроверка: ok (${Object.keys(map).length})` : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

const args = process.argv.slice(2)
if (args[0] === '--selftest') selftest()
else if (args[0] && existsSync(args[0]) && statSync(args[0]).isDirectory()) {
  const r = gradeDir(args[0])
  if (args.includes('--json')) console.log(JSON.stringify(r))
  else {
    console.log(`проба sm-slice-lead, ${args[0]}`)
    for (const x of r.rows) console.log(`  ${x.v.padEnd(22)} ожидание ${x.want.padEnd(22)} ${x.ok}/${x.measured}  [${x.verdicts.join(', ')}]${x.empty ? `  не измерено ${x.empty}` : ''}${x.notes.length ? '  · ' + x.notes.join(' | ') : ''}`)
    console.log(`\n  ${r.green}/${r.total} зелёных · не измерено ${r.empty} · цена: $${r.cost.toFixed(2)}`)
  }
} else { console.error('usage: node grade-sm-slice-lead.mjs <раунд>/sm-slice-lead [--json] | --selftest'); process.exit(1) }
