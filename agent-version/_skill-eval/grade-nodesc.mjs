#!/usr/bin/env node
// grade-nodesc.mjs — проба TS-NODESC: назван ли файл `context/`, у которого нет `description`.
//
//   node grade-nodesc.mjs <каталог с песочницами>
//   node grade-nodesc.mjs --selftest
//
// Конвенционные слоты этой пробы меряет `grade-ts.mjs` (фикстура — клон `TS-CONV`), здесь только
// два анкера, которых там нет:
//   1. файл без шапки НАЗВАН — отказ перестал быть тихим;
//   2. правило из него НЕ применено — «не читаю» осталось правдой.
//
// Второй анкер красным не считается: применить прочитанное правило не значит потерять знание.
// Но счётчик нужен: он показывает, держится ли запрет на слабой модели.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i

/**
 * Настоящий отказ CLI — это ВЕСЬ вывод прогона: короткий и с маркером в начале. Слова
 * `rate limit` в тексте спеки отказом не являются. Замер 2026-08-14: два прогона `ts-ctx` из
 * десяти написали «429 (rate limit)» и молча выпали из знаменателя — а это ровно те прогоны,
 * что перенесли больше чужой конкретики, то есть стенд врал в пользу скилла.
 */
function isApiFailure(text) {
  if (!text) return false
  return text.length < 600 ? RE_API_FAILURE.test(text) : RE_API_FAILURE.test(text.slice(0, 200))
}

/** Имя файла без шапки. Ищем и в ответе аналитику, и в спеке — сказать можно в любом месте. */
const RE_FILE_NAMED = /ui-polling/i
/** Причина названа: без описания/шапки/фронтматтера. */
const RE_WHY = /description|шапк|фронтматтер|frontmatter|без описани/i
/** Правило из файла: 45 секунд. Число некруглое — угадать нельзя. */
const RE_RULE_APPLIED = /\b45\s*(?:с\b|сек|секунд)/i

export function gradeTexts(answer, spec) {
  const both = `${answer}\n${spec}`
  const named = RE_FILE_NAMED.test(both)
  // Причина должна стоять рядом с именем, а не где-нибудь в документе: слово `description`
  // встречается в спеке и само по себе (описания полей), и «где-то в файле» его не годится.
  const lines = both.split(/\r?\n/)
  const namedWithWhy = lines.some((l, i) =>
    RE_FILE_NAMED.test(l) && [lines[i - 1], l, lines[i + 1]].filter(Boolean).some((x) => RE_WHY.test(x)))
  return {
    named,
    namedWithWhy,
    ruleApplied: RE_RULE_APPLIED.test(spec),
    pass: named,
  }
}

function walk(dir, base = dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, acc)
    else acc.push(p.slice(base.length + 1).split('\\').join('/'))
  }
  return acc
}

function gradeSandbox(sb) {
  const r = { name: sb.split(/[\\/]/).pop(), measured: false }
  if (existsSync(join(sb, '_api-failure.txt'))) return { ...r, why: 'отказ API' }
  const ansPath = join(sb, 'answer.md')
  if (!existsSync(ansPath) || statSync(ansPath).size === 0) return { ...r, why: 'нет ответа' }
  const answer = readFileSync(ansPath, 'utf8')
  if (isApiFailure(answer)) return { ...r, why: 'отказ API в тексте ответа' }
  const specRel = walk(sb).find((p) => p.endsWith('technical_specification.md'))
  const spec = specRel ? readFileSync(join(sb, specRel), 'utf8') : ''
  r.measured = true
  r.hasSpec = Boolean(specRel)
  Object.assign(r, gradeTexts(answer, spec))
  return r
}

// ─── Самопроверка ──────────────────────────────────────────────────────────────────────────

const ANSWER_NAMED = `Спека записана в coddoc/ARS-201/technical_specification.md.
Замечание по окружению: в \`context/\` лежит \`ui-polling.md\` без поля \`description\` — я его не
читаю; добавьте шапку, если он нужен в задаче.`
const ANSWER_SILENT = `Спека записана в coddoc/ARS-201/technical_specification.md. Статус: Требуются уточнения (1).`
const SPEC_PLAIN = `## 2. Взаимодействия
### INT-1 🟢 Счётчик
\`GET /v1/sessions/count\`, опрос раз в 30 секунд.`
const SPEC_APPLIED = SPEC_PLAIN.replace('30 секунд', '45 секунд')
// Слово `description` в описании полей спеки не должно засчитываться за причину.
const SPEC_NOISE = `${SPEC_PLAIN}\nПоле \`description\` — текстовое описание сессии.`

function selftest() {
  const a = gradeTexts(ANSWER_NAMED, SPEC_PLAIN)
  const b = gradeTexts(ANSWER_SILENT, SPEC_PLAIN)
  const c = gradeTexts(ANSWER_SILENT, SPEC_APPLIED)
  const d = gradeTexts(ANSWER_SILENT, SPEC_NOISE)
  const checks = [
    ['зелёный: файл назван', a.pass === true],
    ['зелёный: причина названа рядом с именем', a.namedWithWhy === true],
    ['зелёный: правило не применено', a.ruleApplied === false],
    ['красный: молчание поймано', b.pass === false],
    ['применение правила замечено отдельно', c.ruleApplied === true],
    ['шум: слово description в спеке причиной не считается', d.namedWithWhy === false],
  ]
  let bad = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`)
    if (!ok) bad += 1
  }
  console.log(bad === 0 ? '\nсамопроверка пройдена' : `\nсамопроверка ПРОВАЛЕНА: ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

if (process.argv.includes('--selftest')) selftest()

const ROOT = process.argv[2]
if (!ROOT) {
  console.error('usage: node grade-nodesc.mjs <каталог с песочницами>')
  process.exit(2)
}

const rows = readdirSync(ROOT).filter((n) => /^run-/.test(n)).sort().map((d) => gradeSandbox(join(ROOT, d)))
const measured = rows.filter((r) => r.measured)
console.log(`плечо: ${ROOT}`)
console.log(`измерено: ${measured.length} из ${rows.length}`)
for (const r of rows) {
  if (!r.measured) { console.log(`  ${r.name}: НЕ ИЗМЕРЕНО (${r.why})`); continue }
  const bits = [
    r.named ? 'файл назван' : 'МОЛЧАНИЕ',
    r.namedWithWhy ? 'причина названа' : '',
    r.ruleApplied ? 'правило из файла ПРИМЕНЕНО (45 с)' : '',
    r.hasSpec ? '' : 'спеки нет',
  ].filter(Boolean)
  console.log(`  ${r.name}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'красный'}  ${bits.join('  ')}`)
}
const pct = (n) => `${n} (${measured.length ? Math.round((n / measured.length) * 100) : 0}%)`
console.log('\nСЧЁТЧИКИ (из измеренных):')
console.log(`  ${pct(measured.filter((r) => !r.named).length)}\tфайл без description не назван вовсе (тихий отказ)`)
console.log(`  ${pct(measured.filter((r) => r.named && !r.namedWithWhy).length)}\tназван, но без причины`)
console.log(`  ${pct(measured.filter((r) => r.ruleApplied).length)}\tправило из непрочитанного файла применено`)
console.log(`  ${pct(measured.filter((r) => r.pass).length)}\tзелёных`)
