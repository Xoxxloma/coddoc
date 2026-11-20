#!/usr/bin/env node
// grade-sections.mjs — свои разделы БТ и спеки (5.127, `coddoc-settings`).
//
//   node grade-sections.mjs <каталог плеча> --case=bt-ask|ts-ask|bt-set|bt-na|ts-set|nofile-bt|nofile-ts
//
// Файл настроек лежит засевом в `.coddoc-tmp/coddoc-settings/` песочницы (фикстуры BR-SET, TS-SET).
//   *-ask   — базовые гейты закрыты, свои разделы нет: файла этим ходом нет, в ответе вопросы обоих разделов.
//   bt-set  — ответы на всё: `## 7. Дополнительные разделы` последним, 7.1/7.2 по файлу, ответы из реплики, «Готово».
//   bt-na   — то же, второй раздел «не применимо: причина».
//   ts-set  — `## 9. Дополнительные разделы` после §8, 9.1/9.2 по файлу, ответы из реплики.
//   nofile-* — регресс без файла настроек (br-yes, ts-ctx): раздела «Дополнительные разделы» и строк Д нет.
//   bf-set, bt-rw — спека багфикса с файлом; доработка БТ: записанный §7 цел. rv-* — отчёт приёмки (про §7: нет / есть).
//   td-set, sb-set — §7 эпика у каждого ребёнка; §9 спеки в каждом файле этапа.

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkStatus } from './check-br-status.mjs'
import { read, turn, apiFailed } from './br-lib.mjs'

const BT = 'coddoc/LIB-208/business_requirements.md'
const TS = 'coddoc/SMSEC-420/technical_specification.md'
const CASES = {
  'bt-ask': { doc: BT, ask: [['Метрики успеха', /метрик/i], ['Согласование с ИБ', /информационн\S* безопасност|\bИБ\b/i]] },
  'ts-ask': { doc: TS, ask: [['Аудит действий', /аудит/i], ['Мониторинг', /алерт|мониторинг/i]] },
  'bt-set': { doc: BT, num: 7, last: 6, subs: [['Метрики успеха', [/30/, /10/]], ['Согласование с ИБ', [/безопасност|ИБ/i, /согласов|согласу/i]]], ready: true },
  'bt-na': { doc: BT, num: 7, last: 6, subs: [['Метрики успеха', [/30/, /10/]], ['Согласование с ИБ', [/не применимо/i, /персональн|доступ/i]]], ready: true },
  'ts-set': { doc: TS, num: 9, last: 8, subs: [['Аудит действий', [/журнал/i, /год/i]], ['Мониторинг', [/пять|\b5\b/i, /алерт/i]]] },
  'nofile-bt': { doc: BT, nofile: true },
  'nofile-ts': { doc: TS, nofile: true },
  // Пул: спека багфикса с файлом; доработка БТ с записанным §7 (§7 цел, находки приёмки закрыты).
  'bf-set': { doc: 'coddoc/ARS-312/technical_specification.md', num: 9, last: 8, subs: [['Аудит действий', [/не применимо/i]], ['Мониторинг', [/автотест/i]]] },
  'bt-rw': { doc: 'coddoc/RMS-5102/business_requirements.md', num: 7, last: 6, after: /^Открытые вопросы/, gone: /PassportDto/, subs: [['Метрики успеха', [/15 %/, /5 %/]], ['Согласование с ИБ', [/не применимо/i, /персональн/i]]] },
  // Приёмка: отчёт в ответе. clean — ни одного нарушения про §7; dirty — пустой 7.2; kid — у ребёнка нет §7 эпика.
  'rv-clean': { rv: 'none' },
  'rv-dirty': { rv: /7\.2|Согласование с ИБ/ },
  'rv-kid': { rv: /§\s?7\b|Дополнительн/ },
  // Разрез эпика: §7 эпика у каждого ребёнка; этапы: §9 спеки в каждом файле этапа.
  'td-set': { multi: ['AI-SDD/coddoc/PSS-40/PSS-41/business_requirements.md', 'AI-SDD/coddoc/PSS-40/PSS-42/business_requirements.md'], marks: [/###\s+7\.1\.?\s+Метрики успеха/, /заявок, поданных с ошибкой/, /###\s+7\.2\.?\s+Согласование с ИБ/, /Не применимо: новых персональных данных/] },
  'sb-set': { stages: 'coddoc/SHT-410/stages', marks: [/^##\s+Дополнительные разделы/m, /Аудит действий/, /кто и когда записал машину/, /Мониторинг/, /пять записей подряд/] },
}

const arg = process.argv[2]
const name = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
const C = CASES[name]
if (!arg || !existsSync(arg) || !C) { console.error(`usage: node grade-sections.mjs <каталог плеча> --case=${Object.keys(CASES).join('|')}`); process.exit(1) }

const plain = (s) => s.replace(/~~/g, '').trim()
// Разделы «## N.» и подразделы «### N.M.» с их текстом до следующего заголовка того же или старшего уровня.
function sections (text) {
  const lines = text.split('\n'); const out = []
  let fence = false
  lines.forEach((line, i) => {
    if (/^```/.test(line)) fence = !fence
    if (fence) return
    const m = line.match(/^(#{2,3})\s+(.*)$/)
    if (m) out.push({ level: m[1].length, title: plain(m[2]), line: i })
  })
  out.forEach((s, k) => {
    const next = out.slice(k + 1).find((t) => t.level <= s.level)
    s.body = lines.slice(s.line + 1, next ? next.line : lines.length).join('\n')
  })
  return out
}

const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба ${name}, ${arg}`)
let measured = 0; let green = 0
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const answer = t1.answer || ''
  const text = C.doc ? read(join(dir, C.doc)) : null
  const bad = []
  if (C.rv) {
    // Пункты отчёта — от «N. » в начале строки до следующего; про §7 — пункт, где назван §7 / его подраздел.
    const items = answer.split(/\n(?=\s*\d+\.\s)/).filter((s) => /^\s*\d+\.\s/.test(s))
    const about7 = items.filter((s) => /§\s?7\b|7\.[12]\b|Дополнительн/.test(s))
    if (C.rv === 'none') { if (about7.length) bad.push(`нарушение про §7: «${about7[0].trim().split('\n')[0].slice(0, 100)}»`) }
    else if (!items.some((s) => C.rv.test(s))) bad.push(`нет нарушения ${C.rv}`)
    const total = (answer.match(/нарушений:\s*(\d+)/) || [])[1]
    if (total !== undefined) bad.length ? bad.push(`всего нарушений: ${total}`) : console.log(`  (всего нарушений: ${total})`)
  } else if (C.multi || C.stages) {
    const files = C.multi || (existsSync(join(dir, C.stages)) ? readdirSync(join(dir, C.stages)).filter((f) => /^stage-\d+\.md$/.test(f)).map((f) => `${C.stages}/${f}`) : [])
    if (!files.length) bad.push('файлов этапов нет')
    for (const f of files) {
      const t = read(join(dir, f))
      if (!t) { bad.push(`нет ${f}`); continue }
      const miss = C.marks.filter((rx) => !rx.test(t))
      if (miss.length) bad.push(`${f.split('/').slice(-2).join('/')}: нет ${miss.join(', ')}`)
    }
  } else if (C.ask) {
    if (text) bad.push('файл записан, хотя свои разделы не отвечены')
    const qs = answer.split('\n').filter((l) => l.includes('?'))
    for (const [label, rx] of C.ask) if (!qs.some((q) => rx.test(q))) bad.push(`нет вопроса «${label}»`)
  } else if (C.nofile) {
    if (/Дополнительные разделы/.test(text || '')) bad.push('в документе «Дополнительные разделы» без файла настроек')
    if (/^\s*Д\d+\./m.test(answer)) bad.push('в реестре строки Д без файла настроек')
    if (!text) bad.push('документ не записан (справка: регресс считает основной грейдер пробы)')
  } else {
    if (!text) bad.push('файл не записан')
    else {
      const all = sections(text)
      const tops = all.filter((s) => s.level === 2)
      const wrap = tops.filter((s) => new RegExp(`^${C.num}\\.\\s*Дополнительные разделы`).test(s.title))
      if (wrap.length !== 1) bad.push(`«## ${C.num}. Дополнительные разделы»: ${wrap.length} шт.`)
      else {
        const at = tops.indexOf(wrap[0])
        const later = tops.slice(at + 1).filter((s) => !(C.after && C.after.test(s.title)))
        if (later.length) bad.push(`§${C.num} не последний: после него «${later[0].title}»`)
        if (C.gone && C.gone.test(text)) bad.push(`осталось ${C.gone}`)
        if (!tops.slice(0, at).some((s) => new RegExp(`^${C.last}\\.`).test(s.title))) bad.push(`нет §${C.last} перед §${C.num}`)
        const end = tops[at + 1] ? tops[at + 1].line : Infinity
        const subs = all.filter((s) => s.level === 3 && s.line > wrap[0].line && s.line < end)
        C.subs.forEach(([title, marks], k) => {
          const want = new RegExp(`^${C.num}\\.${k + 1}\\.?\\s+${title}\\s*$`)
          const sub = subs[k]
          if (!sub || !want.test(sub.title)) { bad.push(`подраздел ${C.num}.${k + 1} «${title}»: ${sub ? `стоит «${sub.title}»` : 'нет'}`); return }
          for (const rx of marks) if (!rx.test(sub.body)) bad.push(`в «${title}» нет ${rx}`)
        })
        if (subs.length !== C.subs.length) bad.push(`подразделов §${C.num}: ${subs.length}, в файле настроек ${C.subs.length}`)
      }
      if (C.ready) {
        const st = checkStatus(text)
        if (!/^Готово к оценке/.test(st.status || '') || st.tbd + st.warn) bad.push(`статус «${st.status}», TBD/⚠️: ${st.tbd + st.warn}`)
      }
    }
  }
  const pass = bad.length === 0
  if (pass) green++
  console.log(`  ${n}: ${pass ? 'зелёный' : 'красный'}${bad.length ? '  · ' + bad.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
