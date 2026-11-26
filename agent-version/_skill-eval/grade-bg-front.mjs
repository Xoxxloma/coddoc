#!/usr/bin/env node
// grade-bg-front.mjs — плечо `bg-front-q` (фикстура BG-FRONT, аудит С13).
//
//   node grade-bg-front.mjs <папка-раунда>/bg-front-q
//
// Два независимых признака, оба по фактам, а не по формулировке:
//   (1) карточка бэкенда ОТКРЫТА — в stream.jsonl есть вызов инструмента с путём incident-api.md;
//   (2) ожидаемое поведение принесено ГИПОТЕЗОЙ ИЗ ПРАВИЛА — в ответе рядом стоят «закрыт…» и запрет
//       назначения. Зелёное — оба. Холодный вопрос «как должно быть» без (2) — красное.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root || !existsSync(root)) { console.error('usage: node grade-bg-front.mjs <раунд>/bg-front-q'); process.exit(1) }
const RE_RULE = /закрыт[а-яё]*[^\n]{0,160}(нельзя|запрещ|не должн|недоступн|неактивн|заблокир|скрыт)|(нельзя|запрещ)[^\n]{0,80}закрыт/i
const RE_COLD = /как (это )?должно (быть|работать)|ожидаем[а-яё]+ поведени/i
let green = 0, total = 0, cost = 0
console.log(`\nпроба bg-front-q, ${root}`)
for (const run of readdirSync(root).filter((n) => /^run-\d+$/.test(n)).sort()) {
  const dir = join(root, run)
  const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  const stream = existsSync(join(dir, 'stream.jsonl')) ? readFileSync(join(dir, 'stream.jsonl'), 'utf8') : ''
  if (!ans.trim()) { console.log(`  ${run}: пустой ответ — НЕ ИЗМЕРЕНО`); continue }
  total++
  const opened = /"name":"(Read|Grep|Bash)"[^\n]*incident-api\.md/.test(stream) || /incident-api\.md/.test(stream.split('\n').filter((l) => l.includes('"tool_use"')).join('\n'))
  const rule = RE_RULE.test(ans)
  const named = /incident-api/.test(ans)
  const cold = RE_COLD.test(ans) && !rule
  const wrote = existsSync(join(dir, 'coddoc', 'ARS-316'))
  const c = [...stream.matchAll(/"total_cost_usd":([0-9.]+)/g)].map((m) => Number(m[1])); if (c.length) cost += c[c.length - 1]
  const ok = opened && rule
  if (ok) green++
  console.log(`  ${run}: ${ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  карточка бэкенда открыта: ${opened ? 'да' : 'НЕТ'} · гипотеза из правила: ${rule ? 'да' : 'НЕТ'} · бэкенд назван: ${named ? 'да' : 'нет'}${cold ? ' · ожидаемое спрошено вхолодную' : ''}${wrote ? ' · файл записан на первом ходу' : ''}`)
}
console.log(`\n  ${green}/${total}\tзелёных  ← КРИТЕРИЙ: карточка бэкенда открыта И ожидаемое принесено гипотезой из её правила`)
console.log(`  цена: $${cost.toFixed(2)}\n`)
