#!/usr/bin/env node
// grade-bfx-sb.mjs — проба sb-bfx (скилл: stage-breakdown-doc), фикстура BFX-DOWN, спека MTR-512.
//
//   node grade-bfx-sb.mjs <каталог плеча>
//   node grade-bfx-sb.mjs --selftest
//
// Спека на багфикс, починка меняет контракт: одна INT-карточка «изменение существующего» (🟢), новых сущностей §3.2
// нет. Ход 1 — «разбей», ход 2 — «годится, пиши» (go-turn2.txt). Грейдится диск: `stages/index.md` и `owns:` в шапках
// файлов этапов.
//
// ОЖИДАНИЯ — ИЗ ЗАПИСАННЫХ ПРАВИЛ stage-breakdown-doc/SKILL.md:
//   :24-25 и :127-129 — стык это INT-карточка 🟢, «новое или изменение существующего (контракт уже работает, эта работа
//     его меняет)» → INT-1 в инвентаре, инвентарь = 1;
//   :384-385 «Один стык → один этап: stage-01.md плюс индекс. Не «не применимо» — стык есть»;
//   :174-176 «Этап без собственного стыка на выходе — не этап» → этапов ровно один.
// О багфиксе в stage-breakdown-doc ни слова; «Разбиения на части нет» (technical-spec-doc/reference/bugfix-mode.md:133)
// — правило автора спеки, не разреза. Справкой: скопирована ли у этапа строка «Существующий стык» (приёмка этапа после
// 5.81 на неё опирается — spec-review/reference/checklist-stage.md:40).

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { turn, apiFailed } from './br-lib.mjs'

const KEY = 'MTR-512'

/** `owns:` из шапки файла этапа: INT-N в строке `owns: [...]` или в списке под ней (как grade-sb-blue.mjs). */
export function owns (stage) {
  const fm = stage.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  const m = fm[1].match(/^owns:(.*(?:\n\s+-.*)*)/m)
  return m ? (m[1].match(/INT-\d+/g) || []) : []
}

/** stages: { 'stage-01.md': текст }, index: текст или null. */
export function grade (stages, index) {
  const names = Object.keys(stages)
  const owners = names.filter((n) => owns(stages[n]).includes('INT-1'))
  const na = !!index && /не\s+применимо/i.test(index)
  const m = {}
  m['индекс есть, не «не применимо»'] = !!index && !na
  m['INT-1 во владении этапа'] = owners.length >= 1
  m['ровно один этап'] = names.length === 1
  m['у INT-1 ровно один владелец'] = owners.length <= 1
  m._n = names.length
  m._seam = owners.some((n) => /Существующ[а-яё]*\s+стык/i.test(stages[n]))
  m._na = na
  return m
}

function selftest () {
  let f = 0
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) f++ }
  const crit = (g) => Object.entries(g).filter(([k]) => !k.startsWith('_'))
  const allOk = (g) => crit(g).every(([, v]) => v)
  const failing = (g) => crit(g).filter(([, v]) => !v).map(([k]) => k).sort().join(' | ')
  const st = (o, extra = '') => `---\ntype: stage\nowns: [${o}]\ndepends_on: []\n---\n# Этап\n${extra}`
  const ix = '# Этапы работ\n| INT-1 | вместимость числом | 01 | — |'
  ok('один этап под INT-1 — зелёный, справка: стык скопирован', (() => { const g = grade({ 'stage-01.md': st('INT-1', '- **Существующий стык:** `GET /v1/rooms` — 🔵 …') }, ix); return allOk(g) && g._seam })())
  ok('«не применимо» без этапов — красный по индексу и владению', failing(grade({}, '**Не применимо: багфикс, один дефект — одна поставка.**')) === ['INT-1 во владении этапа', 'индекс есть, не «не применимо»', 'ровно один этап'].sort().join(' | '))
  ok('нет индекса, один этап — красный только по индексу', failing(grade({ 'stage-01.md': st('INT-1') }, null)) === 'индекс есть, не «не применимо»')
  ok('разрез по слоям: фронт без своего стыка — красный по числу этапов', failing(grade({ 'stage-01.md': st('INT-1'), 'stage-02.md': st('') }, ix)) === 'ровно один этап')
  ok('два владельца INT-1 — красный', !allOk(grade({ 'stage-01.md': st('INT-1'), 'stage-02.md': st('INT-1') }, ix)))
  ok('owns списком', owns('---\nowns:\n  - INT-1\ndepends_on: []\n---').includes('INT-1'))
  ok('справка: стык не скопирован', !grade({ 'stage-01.md': st('INT-1') }, ix)._seam)
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
if (!arg || !existsSync(arg)) { console.error('usage: node grade-bfx-sb.mjs <каталог плеча> | --selftest'); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба sb-bfx, ${arg}`)
let measured = 0; let green = 0; let seam = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const sdir = join(dir, 'coddoc', KEY, 'stages')
  const index = existsSync(join(sdir, 'index.md')) ? readFileSync(join(sdir, 'index.md'), 'utf8') : null
  const stages = {}
  if (existsSync(sdir)) for (const x of readdirSync(sdir).filter((x) => /^stage-\d+\.md$/.test(x))) stages[x] = readFileSync(join(sdir, x), 'utf8')
  const g = grade(stages, index)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  if (!bad.length) green++
  if (g._seam) seam++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'} · этапов ${g._n}${g._na ? ' · индекс «не применимо»' : ''}${g._n && !g._seam ? ' · справка: «Существующий стык» не скопирован' : ''}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
}
console.log(`\n  справка: «Существующий стык» у этапа-владельца ${seam}/${measured}`)
console.log(`  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
