#!/usr/bin/env node
// grade-fnd-resume.mjs — проба fnd-resume (скилл: analyst-workspace, под-скиллы — заглушки).
//
//   node grade-fnd-resume.mjs <каталог плеча>
//   node grade-fnd-resume.mjs --selftest
//
// Фикстура FND-RESUME: эпик PRT-600 со спекой #0, спек детей нет, «Продолжить начатое» одним ходом. Связь детей
// с #0 стоит только в заголовке INT-0 спеки #0 («наследуют: PRT-601, PRT-602»), в decomposition.md её нет.
// Грейдится `_trace.log`, который пишет заглушка technical-spec-doc, а не формулировка отчёта:
//   - у каждого вызова по ребёнку `режим=наследует #0` и `спека_0=` с путём `_foundation/technical_specification.md`;
//   - спека #0 не позвана заново и файл её не изменён;
//   - спека на самом эпике не позвана.
// Ни одного вызова по ребёнку — красный: маршрут до спек детей не дошёл.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { turn, apiFailed } from './br-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FOUNDATION = 'coddoc/PRT-600/_foundation/technical_specification.md'
const KIDS = ['PRT-601', 'PRT-602']

/** Строки вызова спеки из трассы: { src, mode, zero }. */
export function specCalls(trace) {
  return trace.split(/\r?\n/).filter((l) => /^technical-spec-doc\b/.test(l.trim())).map((l) => l.replace(/\\/g, '/')).map((l) => ({
    src: (l.match(/источник=(\S+)/) || [])[1] || '',
    mode: (l.match(/режим=(.*?)(?=\s+спека_0=|$)/) || [])[1]?.trim() || '',
    zero: (l.match(/спека_0=(\S+)/) || [])[1] || '',
  }))
}

export function grade(trace, foundationSame) {
  const calls = specCalls(trace)
  const kid = calls.filter((c) => KIDS.some((k) => c.src.includes(`/${k}/`)))
  const m = {}
  m['спека ребёнка позвана'] = kid.length > 0
  m['у ребёнка режим «наследует #0»'] = kid.length > 0 && kid.every((c) => /наслед/i.test(c.mode))
  m['у ребёнка путь к спеке #0'] = kid.length > 0 && kid.every((c) => c.zero.includes('_foundation/technical_specification.md'))
  m['спека #0 не позвана заново'] = !calls.some((c) => c.src.includes('_foundation') || /узел/i.test(c.mode))
  m['спека на эпике не позвана'] = !calls.some((c) => /coddoc\/PRT-600\/business_requirements\.md$/.test(c.src))
  m['файл спеки #0 не изменён'] = foundationSame
  m._kids = kid.map((c) => `${(c.src.match(/PRT-600\/(PRT-\d+)/) || [])[1] || '?'}: ${c.mode || '—'}`)
  return m
}

function selftest() {
  let f = 0
  const ok = (name, cond) => { if (!cond) f++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}`) }
  const green = (t, same = true) => Object.entries(grade(t, same)).filter(([k]) => !k.startsWith('_')).every(([, v]) => v)
  const kidB = (k) => `technical-spec-doc источник=coddoc/PRT-600/${k}/business_requirements.md режим=наследует #0 спека_0=coddoc/PRT-600/_foundation/technical_specification.md`
  const both = `${kidB('PRT-601')}\nspec-review coddoc/PRT-600/PRT-601/technical_specification.md\n${kidB('PRT-602')}`
  ok('оба ребёнка в режиме B — зелёный', green(both))
  ok('один ребёнок в режиме B (маршрут встал после него) — зелёный', green(kidB('PRT-601')))
  ok('CRLF не мешает', green(both.replace(/\n/g, '\r\n')))
  ok('виндовые пути не мешают', green(`C:\\w\\${kidB('PRT-601')}`.slice(5).replace(/\//g, '\\')))
  ok('режим «обычный» — красный', !green(kidB('PRT-601').replace('наследует #0', 'обычный')))
  ok('без пути к #0 — красный', !green(kidB('PRT-601').replace(/спека_0=\S+/, 'спека_0=—')))
  ok('второй ребёнок обычным — красный', !green(`${kidB('PRT-601')}\n${kidB('PRT-602').replace('наследует #0', 'обычный')}`))
  ok('спека #0 позвана заново — красный', !green(`technical-spec-doc источник=${FOUNDATION} режим=узел #0 спека_0=—\n${kidB('PRT-601')}`))
  ok('спека на эпике — красный', !green(`technical-spec-doc источник=coddoc/PRT-600/business_requirements.md режим=обычный спека_0=—`))
  ok('вызовов нет — красный', !green('spec-review coddoc/PRT-600/_foundation/technical_specification.md'))
  ok('файл #0 изменён — красный', !green(both, false))
  console.log(f === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${f}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
if (!arg || !existsSync(arg)) { console.error('usage: node grade-fnd-resume.mjs <каталог плеча>'); process.exit(1) }
const etalon = readFileSync(join(here, 'fixtures', 'FND-RESUME', FOUNDATION), 'utf8').replace(/\r\n/g, '\n')
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба fnd-resume, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const trace = existsSync(join(dir, '_trace.log')) ? readFileSync(join(dir, '_trace.log'), 'utf8') : ''
  const fp = join(dir, FOUNDATION)
  const same = existsSync(fp) && readFileSync(fp, 'utf8').replace(/\r\n/g, '\n') === etalon
  const g = grade(trace, same)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · дети: ${g._kids.join('; ') || '—'}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
