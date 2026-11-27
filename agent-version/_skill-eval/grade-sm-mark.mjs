#!/usr/bin/env node
// grade-sm-mark.mjs — изолированная проба маркерного гейта под разведчика (фикстура SM-MARK).
//
//   node grade-sm-mark.mjs <папка-раунда>/sm-mark [--json]
//   node grade-sm-mark.mjs --selftest            ответы руками из fixtures/SM-MARK/grader-selftest/
//
// Читается ПОСЛЕДНЯЯ строка «МАРКЕРЫ: ПРОЙДЕН|ДОБОР»; ожидания — fixtures/SM-MARK/expect.json:
//   want               вердикт;
//   dobor_must         числа, которые обязаны стоять в блоке «## Добор» (N класса — сумма строк `ключ`);
//   dobor_soft         слово, отсутствие которого в блоке добора — мягкая пометка, не провал;
//   dobor_forbid       регэкспы, которых в блоке добора быть не должно (добор по классу, которому не положен);
//   dobor_forbid_pairs [N, M] — строки блока добора с обоими числами (узкий класс в перечне) — провал;
//   detector           [N, M] — обязана быть строка `ОТЧЁТ:` с обоими числами и смыслом «сверки нет»;
//   no_detector        [N, M] — строки детектора с этими числами быть не должно;
//   report_must        регэксп, которому обязана отвечать хотя бы одна строка `ОТЧЁТ:`.
// Пустой ответ — НЕ ИЗМЕРЕНО, в знаменатель не идёт. Грейдится файл ответа, не пересказ.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const FIX = join(HERE, 'fixtures', 'SM-MARK')
const loadExpect = () => JSON.parse(readFileSync(join(FIX, 'expect.json'), 'utf8'))

const RE_VERDICT = /МАРКЕРЫ:\s*\**\s*(ПРОЙДЕН|ДОБОР)/g
const RE_REPORT = /^[\s>*_\-•]*ОТЧ[ЁЕ]Т[\s*_]*:(.*)$/i
const RE_DOBOR_HEAD = /^\s*#{1,4}\s*\**\s*добор(?![а-яё])/i
const NO = '(?<![а-яё])нет(?![а-яё])'
// строгий детектор: «видит N из M», «внешней сверки», «сверки … нет», «нет … сверки», «узкий маркер»
const DET_STRICT = new RegExp(`видит\\s*\\d+\\s*из\\s*\\d+|внешн\\S*\\s+сверк|сверк\\S*[^\\n]{0,40}${NO}|${NO}[^\\n]{0,25}сверк|узк\\S*\\s+маркер|маркер\\S*\\s+узк`, 'i')
const DET_LOOSE = /сверк|видит|узк|внешн/i
const BENIGN = /сошл|совпа/i
const hasNum = (s, n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(s)
const hasPair = (s, [a, b]) => hasNum(s, a) && hasNum(s, b)

// строки «ОТЧЁТ:»; пустой «ОТЧЁТ:» берёт следующие строки до пустой или до вердикта
export function reportLines (text) {
  const lines = text.split('\n'); const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(RE_REPORT); if (!m) continue
    if (m[1].replace(/[*_\s]/g, '')) { out.push(lines[i]); continue }
    for (let k = i + 1; k < lines.length && lines[k].trim() && !/МАРКЕРЫ:/.test(lines[k]) && !RE_REPORT.test(lines[k]); k++) out.push(lines[k])
  }
  return out
}
// блок «## Добор»: от заголовка до строки ОТЧЁТ/МАРКЕРЫ или конца
export function doborBlock (text) {
  const lines = text.split('\n'); const i = lines.findIndex((l) => RE_DOBOR_HEAD.test(l))
  if (i < 0) return null
  const body = []
  for (let k = i + 1; k < lines.length; k++) { if (RE_REPORT.test(lines[k]) || /МАРКЕРЫ:/.test(lines[k])) break; body.push(lines[k]) }
  return body.join('\n').trim()
}

export function grade (text, w) {
  const all = [...text.matchAll(RE_VERDICT)]
  if (!all.length) return { verdict: null, pass: false, note: 'строки «МАРКЕРЫ: …» нет' }
  const verdict = all[all.length - 1][1]
  if (verdict !== w.want) return { verdict, pass: false, note: verdict === 'ДОБОР' ? 'ЛОЖНЫЙ добор' : 'добор ПРОПУЩЕН' }
  const notes = []; let pass = true
  const fail = (n) => { pass = false; notes.push(n) }
  const block = doborBlock(text); const reports = reportLines(text)
  if (w.want === 'ДОБОР') {
    if (!block) fail('блока «## Добор» нет')
    else {
      for (const n of w.dobor_must || []) if (!hasNum(block, n)) fail(`в доборе нет числа ${n}`)
      if (w.dobor_soft && !block.includes(w.dobor_soft)) notes.push(`(мягко) в доборе нет «${w.dobor_soft}»`)
    }
  } else if (block && /не меньше\s*\d|найди недостающ/i.test(block)) fail('перечень добора при ПРОЙДЕН')
  if (block) {
    for (const r of w.dobor_forbid || []) { const m = block.match(new RegExp(r, 'i')); if (m) fail(`в доборе лишнее: «${m[0]}»`) }
    for (const p of w.dobor_forbid_pairs || []) if (block.split('\n').some((l) => hasPair(l, p))) fail(`в перечне добора класс ${p[0]}/${p[1]} — ему добор не положен`)
  }
  for (const p of w.detector || []) {
    if (!reports.some((l) => hasPair(l, p) && (DET_STRICT.test(l) || DET_LOOSE.test(l)))) {
      const inBody = text.split('\n').some((l) => hasPair(l, p) && DET_STRICT.test(l))
      fail(`строки детектора ${p[0]} и ${p[1]} в ОТЧЁТ нет${inBody ? ' (есть только в разборе)' : ''}`)
    }
  }
  for (const p of w.no_detector || []) {
    const bad = reports.find((l) => hasPair(l, p) && DET_STRICT.test(l) && !BENIGN.test(l))
    if (bad) fail(`ложный детектор: ${bad.trim().slice(0, 90)}`)
  }
  if (w.report_must && !reports.some((l) => new RegExp(w.report_must, 'i').test(l))) fail('нужной строки ОТЧЁТ нет')
  return { verdict, pass, note: notes.join('; ') }
}

function gradeDir (out) {
  const expect = loadExpect()
  const rows = []; let green = 0, total = 0, empty = 0, cost = 0
  for (const v of Object.keys(expect)) {
    const dir = join(out, v); const w = expect[v]
    if (!existsSync(dir)) { rows.push({ v, want: w.want, ok: 0, measured: 0, empty: 0, verdicts: [], notes: ['нет прогонов'], missing: true }); continue }
    const files = readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).sort()
    const res = files.map((f) => {
      const t = readFileSync(join(dir, f), 'utf8')
      const cf = join(dir, f.replace('answer', 'cost').replace('.md', '.txt')); if (existsSync(cf)) cost += Number(readFileSync(cf, 'utf8')) || 0
      return t.trim() ? { f, ...grade(t, w) } : { f, verdict: null, pass: false, empty: true, note: 'пустой ответ — НЕ ИЗМЕРЕНО' }
    })
    const measured = res.filter((r) => !r.empty); const ok = measured.filter((r) => r.pass).length
    green += ok; total += measured.length; empty += res.length - measured.length
    rows.push({ v, want: w.want, ok, measured: measured.length, empty: res.length - measured.length, verdicts: measured.map((r) => r.verdict ?? '?'), notes: res.filter((r) => r.note).map((r) => `${r.f}: ${r.note}`) })
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
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${file.padEnd(34)} → ${want ? 'зелёный' : 'красный'} → ${r.pass ? 'зелёный' : 'красный'}${r.note ? '  · ' + r.note : ''}`)
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
    console.log(`проба sm-mark, ${args[0]}`)
    for (const x of r.rows) console.log(`  ${x.v.padEnd(46)} ожидание ${x.want.padEnd(8)} ${x.ok}/${x.measured}  [${x.verdicts.join(', ')}]${x.empty ? `  не измерено ${x.empty}` : ''}${x.notes.length ? '  · ' + x.notes.join(' | ') : ''}`)
    console.log(`\n  ${r.green}/${r.total} зелёных · не измерено ${r.empty} · цена: $${r.cost.toFixed(2)}`)
  }
} else { console.error('usage: node grade-sm-mark.mjs <раунд>/sm-mark [--json] | --selftest'); process.exit(1) }
