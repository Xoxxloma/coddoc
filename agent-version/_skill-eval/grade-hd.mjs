#!/usr/bin/env node
// grade-hd.mjs — чужой стык одним вопросом всеми ещё не отвеченными сторонами (technical-spec-doc 2.5.2). Пробы
// `ts-open-hd`, `ts-acc-hd`, и стадия спеки цепочек (`--sub=stage-2/run-1`).
//
//   node grade-hd.mjs <папка-плеча> --sys=<регэксп имени чужой системы> [--need=сторона,сторона]
//        [--said=<регэксп отложенного аналитиком в промпте>] [--reask=<регэксп того, что переспрашивать нельзя>]
//        [--sub=stage-2/run-1]
//
// ГЛАВНОЕ (--need): открытые стороны пробы прозвучали вопросом в ходе 1 — каждая из перечисленных.
// КРАСНОЕ: нужная сторона не спрошена в ходе 1; переспрос отложенного (--reask в абзаце-вопросе хода 1).
// ВТОРОЕ: открытые пункты итоговой спеки о чужом стыке, сторона которых в ходе 1 не прозвучала.
// Справочно: «?» в ходе 1; спека записана уже в ходе 1 (тогда вопросов до записи не было); абзацы-вопросы целиком —
// для ручной сверки выдуманных предложений.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIDES = {
  адрес: /адрес|топик|имя событ|имени событ|endpoint|url|`\/|\bPOST\b|\bGET\b|\bPUT\b/i,
  поля: /(^|[^а-яё])пол[яей]([^а-яё]|$)|схем[аеуы]|формат (событ|сообщ)|payload/i,
  ошибки: /код[ау]? (ответ|ошибк)|\b[45]\d\d\b|каталог ошибок/i,
  доступ: /доступ к (топик|kafka|кафк|систем|сервис|их)|права на (чтение|запись)|сервисн\S* (аккаунт|учётн)|(^|[^а-яё])ключ[а-яё]* доступ|токен|сертификат|учётн\S* данн|учетн\S* данн|подключени\S* [^.,;]{0,40}к (kafka|кафк|топик|кластер|систем)|credential|ACL|подключени[яе] к/i,
  таймаут: /таймаут|timeout/i,
  повтор: /повтор[а-яё]* (вызов|запрос|отправк|событ|с тем же)|идемпотент|дубл[ьи] событ|retry/i,
}
const ASK = /\?|годится|к валидации|назовёте/i

function findSpec (dir) {
  const root = join(dir, 'coddoc')
  if (!existsSync(root)) return null
  for (const k of readdirSync(root)) { const p = join(root, k, 'technical_specification.md'); if (existsSync(p)) return p }
  return null
}

export function openItems (spec) {
  const lines = spec.replace(/\r/g, '').split('\n')
  const i = lines.findIndex((l) => /^>\s*\*\*Открытые вопросы/.test(l))
  if (i < 0) return []
  const out = []
  for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) {
    const t = lines[j].replace(/^>\s?/, '').trim()
    if (/^\d+[.)]\s/.test(t)) out.push(t)
    else if (out.length && t && !/^\*?\(/.test(t)) out[out.length - 1] += ' ' + t
  }
  return out
}

export function gradeRun (dir, o) {
  const r = { run: dir }
  if (!existsSync(join(dir, 'stream.jsonl')) || readdirSync(dir).some((f) => /^_api-failure/.test(f))) { r.measured = false; return r }
  r.measured = true
  let a1 = readFileSync(existsSync(join(dir, 'answer-01.md')) ? join(dir, 'answer-01.md') : join(dir, 'answer.md'), 'utf8')
  r.writtenT1 = /"name":"Write"[^\n]*technical_specification\.md/.test(readFileSync(join(dir, 'stream.jsonl'), 'utf8'))
  if (r.writtenT1) a1 = ''
  r.questions = (a1.match(/\?/g) || []).length
  const paras = a1.split(/\n\s*\n/)
  // Вопрос = абзац с «?»/«годится»/«к валидации» и два абзаца перед ним (предложение и пояснение часто стоят отдельно).
  const keep = new Set()
  paras.forEach((p, i) => { if (ASK.test(p)) for (let k = Math.max(0, i - 2); k <= i; k++) keep.add(k) })
  const askParas = paras.filter((_, i) => keep.has(i))
  const askText = askParas.join('\n')
  r.sidesAsked = Object.entries(SIDES).filter(([, re]) => re.test(askText)).map(([k]) => k)
  r.missingNeed = o.need.filter((s) => !r.sidesAsked.includes(s))
  r.reasked = !!(o.reask && askParas.some((p) => o.reask.test(p)))
  r.askText = askParas.filter((p) => o.sys.test(p) || Object.values(SIDES).some((re) => re.test(p))).join(' ¶ ').replace(/\s+/g, ' ')
  const f = findSpec(dir)
  r.file = !!f
  r.unasked = []
  if (f) {
    const items = openItems(readFileSync(f, 'utf8')).filter((t) => o.sys.test(t))
    r.foreignOpen = items.length
    for (const t of items) {
      if (o.said && o.said.test(t)) continue
      const sides = Object.entries(SIDES).filter(([, re]) => re.test(t)).map(([k]) => k)
      if (!sides.length || !sides.every((s) => r.sidesAsked.includes(s))) r.unasked.push(t.slice(0, 160))
    }
  }
  r.red = r.missingNeed.length > 0 || r.reasked
  return r
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3)
  const arm = process.argv[2]
  if (!arm || !arg('sys')) { console.error('usage: node grade-hd.mjs <папка-плеча> --sys=<регэксп> [--need=..] [--said=..] [--reask=..] [--sub=..]'); process.exit(1) }
  const o = {
    sys: new RegExp(arg('sys'), 'i'),
    need: arg('need') ? arg('need').split(',') : [],
    said: arg('said') ? new RegExp(arg('said'), 'i') : null,
    reask: arg('reask') ? new RegExp(arg('reask'), 'i') : null,
  }
  const sub = arg('sub')
  console.log(`нужные стороны: ${o.need.join(', ') || '—'}`)
  console.log('прогон | спека в ходе 1 | «?» в ходе 1 | стороны в вопросах хода 1 | не спрошено из нужных | переспрос отложенного | открытых о стыке | второе: неспрошенных | итог')
  for (const d of readdirSync(arm).filter((x) => /^run-\d+$/.test(x)).sort()) {
    const r = gradeRun(join(arm, d, sub), o)
    if (!r.measured) { console.log(`${d} | не измерен`); continue }
    console.log([d, r.writtenT1 ? 'да' : '—', r.questions, r.sidesAsked.join(', ') || '—', r.missingNeed.join(', ') || '—', r.reasked ? 'ДА' : '—',
      r.file ? r.foreignOpen : '·', r.file ? r.unasked.length : '·', r.red ? 'КРАСНЫЙ' : 'зелёный'].join(' | '))
    for (const u of r.unasked) console.log(`   неспрошен: ${u}`)
    if (r.askText) console.log(`   вопросы о стыке: ${r.askText.slice(0, 1200)}`)
  }
}
