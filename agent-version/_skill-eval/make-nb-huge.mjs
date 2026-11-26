#!/usr/bin/env node
// make-nb-huge.mjs — засев NB-HUGE: ноут «горнолыжная база» на 2000+ строк в форме analyst-notebook 2.0.0 с цепочками
// через границы окон по 300 строк. Детерминирован (без случайности): повторный запуск даёт тот же файл.
//   node make-nb-huge.mjs [--write]
// Без --write печатает число строк, пунктов, действующих и строки цепочек. Пишет fixtures/NB-HUGE/seed/… и эталон выгрузки.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNotebook, activeItems, checkIds, checkPairs } from './nb-state.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NB = 'notes/горнолыжная-база/notebook.md'
const PEOPLE = [
  ['Рудакова Т.', 'Рудаковой Т.', 'управляющая базой'], ['Брагин С.', 'Брагина С.', 'прокат'], ['Фомичёв Р.', 'Фомичёва Р.', 'владелец базы'],
  ['Гусарова Л.', 'Гусаровой Л.', 'кафе'], ['Нестеров В.', 'Нестерова В.', 'подъёмники'], ['Кондратьева М.', 'Кондратьевой М.', 'бухгалтерия'],
  ['Лапин Д.', 'Лапина Д.', 'школа инструкторов'],
]
// Предметы: у каждого — сведение, решение и вопрос со своими числами. Числа — от номера дня, чтобы строки не совпадали.
const SUBJ = [
  (n) => ({ fact: `Подъёмник №${n % 4 + 1} везёт около ${200 + n * 3} человек в час`, dec: `Подъёмник №${n % 4 + 1} закрываем на обслуживание по вторникам до ${10 + n % 3}:00`, q: `Предупреждать ли гостей о закрытии подъёмника №${n % 4 + 1} сообщением`, ans: `О закрытии подъёмника №${n % 4 + 1} предупреждаем гостей сообщением за сутки` }),
  (n) => ({ fact: `В кафе у склона ${30 + n % 20} посадочных мест`, dec: `Кафе у склона открываем в ${8 + n % 2}:30`, q: `Принимать ли в кафе оплату браслетом проката (день ${n})`, ans: `В кафе принимаем оплату браслетом проката (день ${n})` }),
  (n) => ({ fact: `На парковке у базы ${120 + n} мест`, dec: `Парковка для гостей проката — первые ${2 + n % 3} часа бесплатно`, q: `Кто следит за парковкой в выходные (день ${n})`, ans: `За парковкой в выходные следит охрана базы (день ${n})` }),
  (n) => ({ fact: `В школе инструкторов ${8 + n % 6} инструкторов на смену`, dec: `Групповое занятие длится ${60 + (n % 3) * 15} минут`, q: `Сколько детей в группе у одного инструктора (день ${n})`, ans: `В группе у одного инструктора не больше ${n % 4 + 5} детей (день ${n})` }),
  (n) => ({ fact: `Бухгалтерия закрывает кассу проката в ${18 + n % 2}:00`, dec: `Возврат залога за прокат делаем в течение ${n % 5 + 1} дней`, q: `Нужен ли чек при возврате залога (день ${n})`, ans: `При возврате залога чек не нужен (день ${n})` }),
]
const date = (i) => { const d = new Date(Date.UTC(2026, 6, 1) + i * 86400000); return d.toISOString().slice(0, 10) }

const lines = ['---', 'тема: горнолыжная база', 'ключ: —', 'о чём: сервисы горнолыжной базы для гостей: прокат, подъёмники, кафе, парковка, школа инструкторов, касса', 'цель: —', '---', '# Ноут: горнолыжная база', '']
const items = [] // { id, line }
const add = (l) => { lines.push(l); return lines.length - 1 }
// Цепочки задаются по дню: что добавить в запись 2 этого дня.
const CHAIN = {}
const DAYS = 74
for (let i = 0; i < DAYS; i++) {
  const d = date(i)
  add(`## ${d}`); add('')
  for (const e of [1, 2]) {
    const p = PEOPLE[(i * 2 + e) % PEOPLE.length]
    const s = SUBJ[(i + e) % SUBJ.length](i * 2 + e)
    add(`### ${e} · письмо ${p[1]} (${p[2]})`)
    // Вопрос — в каждой третьей записи: у живого ноута пунктов меньше, чем строк текста под ними.
    const withQ = (i + e) % 3 === 0
    const its = [
      `- [сведение] ${s.fact} — со слов ${p[1]}`,
      `- [решено] ${s.dec} — решил: ${p[0]}`,
      ...(withQ ? [`- [открыто] ${s.q} — ждёт: ${p[0]}`] : []),
    ]
    if (e === 2 && CHAIN[i]) its.push(...CHAIN[i](d))
    its.forEach((t, k) => { const id = `${d} №${e}.${k + 1}`; const idx = add(`${t} · ${id}`); items.push({ id, idx }) })
    add('> Добрый день.'); add(`> ${s.fact}.`); add(`> Решаем так: ${s.dec.charAt(0).toLowerCase() + s.dec.slice(1)}.`)
    if (withQ) add(`> ${s.q} — пока не знаю.`)
    add('> Подробности пришлю отдельно, если понадобится.'); add('> Если что-то не так — поправьте меня.'); add('> По остальному — без изменений.')
    add('> Хорошего дня.'); add(`> ${p[0]}, ${p[2]}`); add('')
  }
}
const nbText = () => lines.join('\n') + '\n'
// Пометка у пункта по номеру.
const mark = (id, m) => { const it = items.find((x) => x.id === id); if (!it) throw new Error(`нет ${id}`); lines[it.idx] += ` ‖ ${m}` }
const byId = (id) => lines[items.find((x) => x.id === id).idx]
const textOf = (id) => byId(id).replace(/^- \[[^\]]*\]\s*/, '').replace(/\s*·.*$/, '').replace(/ — (решил|ждёт|со слов)[^]*$/, '')

// Цепочки — дописываются вторым проходом: строки уже на месте, новые пункты — в конец записи 2 дня цепочки.
function insertAfterEntry (d, e, newItemText) {
  // Конец пунктов записи `### e` дня d — перед её первой строкой `>`.
  const h = lines.findIndex((l, j) => l.startsWith(`### ${e} ·`) && lines.slice(0, j).reverse().find((x) => x.startsWith('## ')) === `## ${d}`)
  let j = h + 1; while (/^- \[/.test(lines[j])) j++
  const k = lines.slice(h + 1, j).length + 1
  const id = `${d} №${e}.${k}`
  lines.splice(j, 0, `${newItemText} · ${id}`)
  for (const it of items) if (it.idx >= j) it.idx++
  items.push({ id, idx: j })
  return id
}
// 1) Решение дня 2 заменено днём 64 (строка ~60 → ~1950): тот же решивший.
const A = `${date(2)} №1.2`; const pA = PEOPLE[(2 * 2 + 1) % PEOPLE.length]
const A2 = insertAfterEntry(date(67), 2, `- [решено] ${SUBJ[(2 + 1) % SUBJ.length](6).dec} — решил: ${pA[0]}; вместо: ${A}`)
mark(A, `заменён: ${A2}`)
// 2) Вопрос дня 10 закрыт днём 40.
const Q = `${date(10)} №2.3`; const pQ = PEOPLE[(10 * 2 + 2) % PEOPLE.length]
const QA = insertAfterEntry(date(40), 2, `- [решено] ${SUBJ[(10 + 2) % SUBJ.length](10 * 2 + 2).ans} — решил: ${pQ[0]}; отвечает на: ${Q}`)
mark(Q, `закрыт: ${QA}`)
// 3) Цепочка в три звена: решение дня 5 → день 25 → день 45 → день 61.
const C0 = `${date(5)} №1.2`; const pC = PEOPLE[(5 * 2 + 1) % PEOPLE.length]
let prev = C0
for (const [day, v] of [[25, 'первое'], [45, 'второе'], [65, 'третье']]) {
  const id = insertAfterEntry(date(day), 2, `- [решено] ${textOf(C0)}, ${v} уточнение срока: с ${day % 12 + 1}-го числа — решил: ${pC[0]}; вместо: ${prev}`)
  mark(prev, `заменён: ${id}`); prev = id
}
// 4) Спор о решении дня 15 (день 30) — без ответа: оспоренный не действует, спор действует.
const S0 = `${date(15)} №2.2`; const pS = PEOPLE[(15 * 2 + 2) % PEOPLE.length]; const other = PEOPLE[(pS === PEOPLE[0] ? 1 : 0)]
const SP = insertAfterEntry(date(35), 2, `- [открыто] что верно: ${textOf(S0)} (${pS[0]}, ${S0}) или вдвое дольше (${other[0]}) — ждёт: Фомичёв Р.`)
mark(S0, `оспорен: ${SP}`)

const text = nbText()
const nb = parseNotebook(text)
const bad = [...checkIds(nb), ...checkPairs(nb)]
if (bad.length) { console.error(bad.join('\n')); process.exit(1) }
const act = activeItems(nb)
console.log(`строк ${lines.length}, пунктов ${nb.items.length}, действует ${act.length}`)
for (const id of [A, A2, Q, QA, C0, prev, S0, SP]) console.log(`  ${id}: строка ${nb.byId.get(id).idx + 1}`)
if (process.argv.includes('--write')) {
  const dir = join(HERE, 'fixtures', 'NB-HUGE')
  for (const p of [join(dir, 'seed', NB), join(dir, 'etalon/stage-1', NB)]) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
  const ds = nb.entries.map((e) => e.date)
  const exp = ['# Пункты: горнолыжная база', `> Источник: ${NB}`, '> Задача: —', `> Ноут: горнолыжная база · записи ${ds[0]}–${ds[ds.length - 1]}`, '',
    ...act.map((it) => `- [${it.kind}] ${it.text} · ${it.ref}`)].join('\n') + '\n'
  writeFileSync(join(dir, 'etalon/stage-1/notes/горнолыжная-база/notebook-2026-10-20.points.md'), exp)
  console.log('записано')
}
