#!/usr/bin/env node
// grade-fnd-epic.mjs — пробы fnd-* : узел-фундамент #0 и ребёнок эпика после п.2б (ветка feat/blue-contract, 5.76–5.81).
//
//   node grade-fnd-epic.mjs <каталог плеча> --case=zero|kid|rv-kid|rv-dirty|rv-zero|sb-kid
//   node grade-fnd-epic.mjs --selftest
//
// Фикстура FND-EPIC (эпик PRT-600, остатки запчастей; #0 — `GET /v1/parts/stock`, ребёнок PRT-601). Засевы:
// seed-zero (БТ эпика и детей), seed-kid (+ спека #0), seed-done (+ спека PRT-601 и двойник PRT-609).
//
// КРИТЕРИИ — только из записанных правил (файл:строка по тексту ветки на 2026-10-26):
//   zero (technical-spec-doc, режим A):
//     спека в `_foundation/` эпика — foundation-node.md:58-79; своего БТ у #0 нет — foundation-node.md:13;
//     шапка `<EPIC-KEY> / узел-фундамент #0` — foundation-node.md:104-106;
//     у INT-0 «Вид: новое», заголовок 🟢, «Происхождение: 🟢 новое», JSON — скелет foundation-node.md:35-45;
//     «Вид» у каждой карточки — checklist-spec.md:248-253 (§13); чужие файлы не тронуты — SKILL.md:602 (самопроверка 7).
//   kid (technical-spec-doc, режим B):
//     метка `🔵 depends-on #0`, в форме карточки «Вид: потребление существующего» — foundation-node.md:93-95;
//     состав контракта прежний (поля, enum'ы, null, путь, ошибки, параметры запроса) — foundation-node.md:89-95;
//       риск — самопроверка 1 «путь и поля… только если оно есть в источнике метки», SKILL.md:580-583;
//     лишних полей нет: нехватка поля — `❓ #0 требует…`, не молча — foundation-node.md:99-101;
//     источник из списка договора у унаследованного не стоит: список SKILL.md:153-157 определяет каждый источник,
//       и ни один не «спека #0»; метка — `🔵 depends-on #0 — унаследовано, не переопределять`, foundation-node.md:93-94;
//     контракт #0 не объявлен открытым — SKILL.md:757, 565-566: красное — открытый пункт о самом контракте (его метка,
//       путь или поле под вопросом); поле #0 как образец сверки чужих данных («совпадают ли они с `partId` из INT-0»)
//       и `❓ #0 требует поля X` (foundation-node.md:99-102) — не красное; спека #0 и БТ не тронуты — SKILL.md:602.
//   rv-kid / rv-dirty / rv-zero (spec-review, checklist-spec.md):
//     §13 — строка «Вид» у каждой карточки (246-253); §14 — источник у 🔵, «кроме `🔵 depends-on #0`» (267-272);
//     rv-dirty: посаженное узнаётся по смыслу пункта — его карточка (первая названная в пункте) и суть нарушения
//       (у INT-1 нет строки «Вид»; у INT-4 нет источника), не по номеру пункта чек-листа;
//     §1/§7/§8/§9 касаются 🟡 и 🟢 карточек (23-27, 132-160) — у 🔵 depends-on #0 их нет;
//     счётная строка — только 🔵 «подтверждено аналитиком» со «со слов» (284-292): у PRT-601 таких нет → 0.
//   sb-kid (stage-breakdown-doc): `🔵 depends-on #0` — вход извне, не стык, своего этапа нет — SKILL.md:24-27, 140-145,
//     391-392; вход назван «контракт #0» — SKILL.md:144-145, 391-392; свои 🟢 INT-2, INT-3 — во владении этапа.
//
// Чего правила НЕ определяют — справкой, не в критерий: допустим ли у метки depends-on указатель на файл #0 вне
// списка источников; типы полей (int / integer) — не сверяются; статус спеки ребёнка; прочитан ли foundation-node.md.

import { readdirSync, statSync, existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { read, turn, apiFailed } from './br-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures', 'FND-EPIC')
const ZERO_REL = 'coddoc/PRT-600/_foundation/technical_specification.md'
const KID_REL = 'coddoc/PRT-600/PRT-601/technical_specification.md'
const STAGES_REL = 'coddoc/PRT-600/PRT-601/stages'
const FIELDS = ['partId', 'partName', 'shelfQty', 'minQty', 'stockLevel', 'recountedAt']
const JSON_OK = new Set([...FIELDS, 'items', 'error', 'message'])
const ENUM = [/`ok`|\bok\b/, /`low`|\blow\b/, /`out`|\bout\b/]
const PATH = /\/v1\/parts\/stock\b/
const ERRS = ['UNKNOWN_LEVEL', 'STOCK_UNAVAILABLE']
const SOURCES = /по\s+карточке|по\s+коду|по\s+документу\s+сверху|со\s+слов/i
const KEPT = ['coddoc/PRT-600/business_requirements.md', 'coddoc/PRT-600/decomposition.md',
  'coddoc/PRT-600/PRT-601/business_requirements.md', 'coddoc/PRT-600/PRT-602/business_requirements.md']

// ── разбор спеки ───────────────────────────────────────────────────────────────────────────

/** INT-карточки: { head, body, mark, prov } — метка из заголовка, иначе из строки «Происхождение» (как grade-ts-blue). */
export function cards (spec) {
  const parts = ('\n' + spec).split(/\n(?=#{2,4}\s*~*\s*INT-\d+)/).slice(1)
  return parts.map((p) => {
    const body = p.split(/\n(?=#{2,4}\s(?!.*INT-)|##\s)/)[0]
    const head = body.split('\n')[0]
    const prov = body.split('\n').find((l) => /Происхождение/i.test(l)) || ''
    const mark = (head.match(/🟢|🔵|🟡|❓/) || prov.match(/🟢|🔵|🟡|❓/) || [null])[0]
    return { head, body, mark, prov }
  })
}
const sectionFrom = (spec, startRe, endRe) => {
  const lines = spec.split('\n')
  const a = lines.findIndex((l) => startRe.test(l))
  if (a < 0) return ''
  const rest = lines.slice(a + 1)
  const b = rest.findIndex((l) => endRe.test(l))
  return (b < 0 ? rest : rest.slice(0, b)).join('\n')
}
const section2 = (spec) => sectionFrom(spec, /^##\s*~*\s*2\.\s/, /^##\s*~*\s*3\.\s/)
const catalog = (spec) => sectionFrom(spec, /^#{3,4}\s*~*\s*Каталог ошибок/, /^#{2,3}\s/)
/** Блок «Открытые вопросы» шапки: от строки-заголовка блока до первого `## `. Строка легенды depends-on тоже
 *  называет «Открытые вопросы» — блок ищется по строке, которая с этих слов НАЧИНАЕТСЯ. */
export function openBlock (spec) {
  const lines = spec.split(/\n##\s/)[0].split('\n')
  const i = lines.findIndex((l) => /^>?\s*\*{0,2}Открытые вопросы/.test(l))
  return i < 0 ? '' : lines.slice(i + 1).join('\n')
}
/** Пункты блока «Открытые вопросы»: строка «N.» / «-» начинает пункт, прочие строки дописываются к текущему. */
export function openItems (ob) {
  const out = []
  for (const l of ob.split('\n')) {
    if (!l.replace(/^>?\s*/, '').trim()) continue
    if (/^>?\s*(\*\*)?(\d+[.)]|[-*•])\s/.test(l) || !out.length) out.push(l); else out[out.length - 1] += '\n' + l
  }
  return out
}
// Открытый пункт о самом контракте #0 — его метка, путь или поле объявлены неподтверждёнными (SKILL.md:757, 565-566:
// depends-on #0 «НЕ открытый пункт… в «Открытые вопросы» не попадает»; foundation-node.md:95-96 «не задавай по нему
// вопросов»). Не он:
//   поле #0 как образец сверки чужой стороны — «идентификаторы … те же, что `partId` в INT-0», «совпадают ли они с
//     `partId` из INT-0»: под вопросом чужие данные, контракт взят как есть;
//   `❓ #0 требует поля X` — законная восходящая правка, место ей именно в «Открытых вопросах» (foundation-node.md:99-102).
const EL0 = `[Dd]epends-on|${PATH.source}|${FIELDS.join('|')}`
const REF0 = new RegExp(EL0)
const MATCH_REF = new RegExp(`(совпада[а-яё]*|совпадени[а-яё]*|те\\s+же|тот\\s+же|та\\s+же|то\\s+же|такие\\s+же|такой\\s+же|соответству[а-яё]*|сопостав[а-яё]*)[^.;\\n]{0,80}?\\s(с|со|что|чем)\\s+[\`«"]?(${EL0})`, 'gi')
const UPWARD = /#0\s+требует/i
export const contractOpened = (ob) => openItems(ob).filter((it) => !UPWARD.test(it) && REF0.test(it.replace(MATCH_REF, '')))
const jsonKeys = (text) => [...(text.match(/```json[\s\S]*?```/g) || []).join('\n').matchAll(/"([A-Za-z_][\w]*)"\s*:/g)].map((m) => m[1])
const headerTask = (spec) => (spec.split('\n').find((l) => /\*\*Задача:?\*\*/.test(l)) || '')

/** Унаследованный стык у ребёнка: карточка с depends-on в заголовке/происхождении, иначе с полями #0;
 *  нет карточки — §2 целиком (foundation-node.md:90-91: «переформатировать можно (карточка, таблица, буллеты)»). */
export function inherited (spec) {
  const cs = cards(spec)
  const score = (c) => FIELDS.filter((f) => c.body.includes(f)).length
  const byMark = cs.find((c) => /depends-on/i.test(c.head) || /depends-on/i.test(c.prov))
  const byFields = cs.filter((c) => score(c) >= 2).sort((a, b) => score(b) - score(a))[0]
  const c = byMark || byFields || cs.find((c) => /остат/i.test(c.head))
  if (c) return { card: true, ...c }
  // §2 без чужих карточек и без каталога: иначе JSON своих INT попадёт в «лишние поля» унаследованного.
  let s2 = section2(spec)
  for (const x of cs) s2 = s2.replace(x.body, '')
  s2 = s2.replace(catalog(spec), '')
  return { card: false, head: '', body: s2, mark: null, prov: '' }
}

// ── zero: режим A ──────────────────────────────────────────────────────────────────────────

export function gradeZeroSpec (spec) {
  const cs = cards(section2(spec) ? '\n' + section2(spec) : spec)
  const c = cs.find((x) => PATH.test(x.body)) || cs.find((x) => FIELDS.filter((f) => x.body.includes(f)).length >= 2) || cs[0]
  const m = {}
  m['шапка: ключ эпика и #0 (гейт 11)'] = /PRT-600/.test(headerTask(spec)) && /#0/.test(headerTask(spec))
  m['карточка стыка #0 найдена'] = !!c
  m['«Вид: новое»'] = !!c && /Вид[^\n]{0,12}новое/i.test(c.body)
  m['«Вид» у каждой карточки §2'] = cs.length > 0 && cs.every((x) => /Вид/.test(x.body))
  m['заголовок 🟢'] = c?.mark === '🟢'
  m['«Происхождение» — 🟢 новое'] = !!c && /🟢\s*новое/i.test(c.prov) && !/🔵|🟡/.test(c.prov)
  m['JSON-пример'] = !!c && /```json/.test(c.body)
  m['путь стыка'] = !!c && PATH.test(c.body)
  m._fields = c ? FIELDS.filter((f) => !c.body.includes(f)) : FIELDS
  m._dep = /depends-on/i.test(section2(spec))
  m._status = (spec.match(/Статус готовности:?\*{0,2}\s*([^\n]+)/) || [])[1] || '?'
  return m
}

// ── kid: режим B ───────────────────────────────────────────────────────────────────────────

export function gradeKidSpec (spec) {
  const inh = inherited(spec)
  const b = inh.body
  const m = {}
  m['унаследованный стык найден'] = !!b && (PATH.test(b) || FIELDS.some((f) => b.includes(f)) || /depends-on/i.test(b))
  m['метка `🔵 depends-on #0`'] = /🔵\s*depends-on\s*#0/i.test(inh.card ? inh.head + '\n' + inh.prov + '\n' + b : b)
  m['метка 🔵, не 🟢/🟡/❓'] = inh.card ? inh.mark === '🔵' && !/🟢|🟡|❓/.test(inh.head + inh.prov) : !b.split('\n').some((l) => /depends-on/i.test(l) && /🟢|🟡/.test(l))
  // Не карточкой — строки «Вид» правило не требует (foundation-node.md:95 «в форме карточки»): пункт засчитан, справкой.
  m['«Вид: потребление существующего»'] = inh.card ? /Вид[^\n]{0,12}потреблени[ея]\s+существующ/i.test(b) : true
  m['поля #0 на месте'] = FIELDS.every((f) => b.includes(f))
  m['enum и null #0 на месте'] = ENUM.every((re) => re.test(b)) && /\bnull\b/.test(b)
  m['путь #0 на месте'] = PATH.test(b)
  m['параметр запроса и ошибки #0 на месте'] = /\blevel\b/.test(b) && ERRS.every((e) => b.includes(e) || catalog(spec).includes(e))
  m['лишних полей в JSON нет'] = jsonKeys(b).every((k) => JSON_OK.has(k))
  m['источник из списка не приписан'] = !b.split('\n').some((l) => /🔵/.test(l) && SOURCES.test(l))
  const ob = openBlock(spec)
  m['не в «Открытых вопросах»'] = contractOpened(ob).length === 0
  m._refOpen = openItems(ob).filter((it) => REF0.test(it) && !contractOpened(ob).includes(it)).map((it) => it.replace(/^>?\s*/, '').trim().slice(0, 100))
  m._card = inh.card
  m._missing = FIELDS.filter((f) => !b.includes(f))
  m._extra = jsonKeys(b).filter((k) => !JSON_OK.has(k))
  m._ptr = b.split('\n').filter((l) => /🔵/.test(l) && /источник|_foundation|спек[аеи]\s+#0|из\s+#0/i.test(l) && !SOURCES.test(l)).map((l) => l.trim().slice(0, 100))
  m._legend = /^>\s*🔵\s*depends-on #0/m.test(spec)
  m._ownVid = cards(spec).filter((c) => c !== undefined && !/depends-on/i.test(c.head + c.prov) && !/Вид/.test(c.body)).map((c) => (c.head.match(/INT-\d+/) || ['?'])[0])
  m._status = (spec.match(/Статус готовности:?\*{0,2}\s*([^\n]+)/) || [])[1] || '?'
  return m
}

// ── rv: приёмка ────────────────────────────────────────────────────────────────────────────

/** Пункты отчёта: строка «N. …» и идущие за ней строки с отступом (цитата, рекомендация). Абзац без отступа после
 *  списка в пункт не берётся — у grade-rv-blue он попадал в последний пункт («Источник требований не передавался»). */
export function items (answer) {
  const out = []
  let cur = null
  // Пункты — после строки «нарушений:»: раньше неё ведущий называет пути, иногда нумерованным списком (Шаг 1).
  const at = answer.search(/нарушений:/i)
  for (const l of (at < 0 ? answer : answer.slice(at)).split('\n')) {
    if (/^\s{0,3}\d+\.\s/.test(l)) { if (cur) out.push(cur); cur = l; continue }
    if (cur === null) continue
    if (!l.trim() || /^\s+\S/.test(l) || /^[«→>"“]/.test(l)) { cur += '\n' + l; continue }
    out.push(cur); cur = null
  }
  if (cur) out.push(cur)
  return out.map((s) => s.trim())
}
// Нет строки «Вид» — по смыслу пункта (checklist-spec.md:250 «у карточки нет строки «Вид»»), как приёмка пишет его
// словами: «карточка без вида», «нет строки «Вид»», «строки «Вид» нет», «вид не указан», рекомендация «Назовите вид».
const VID = '(?<![а-яё])«?вида?»?(?![а-яё])'
const NOVID = new RegExp([
  `без\\s+(строки\\s+)?${VID}`,
  `нет\\s+(строки\\s+)?${VID}`,
  `строк[аи]\\s+${VID}\\s+(нет|отсутству|пропущ)`,
  `${VID}\\s+(карточки\\s+)?(не\\s+(указан|назван|проставлен|задан)|нет(?![а-яё])|отсутству)`,
  `(не\\s+(указан|назван|называ|проставлен|задан)[а-яё]*|отсутству[а-яё]*|пропущ[а-яё]*)\\s+(строк[аи]\\s+)?${VID}`,
  `(назовите|проставьте|укажите|добавьте|допишите)\\s+(строку\\s+)?${VID}`,
].join('|'), 'i')
// Любой пункт §13 (для проб, где §13 — ложный): прежние слова и номер пункта, плюс смысловые формы отсутствия вида.
const P13 = new RegExp(/без\s+вида|без\s+(строки\s+)?«?Вид|нет\s+строки\s+«?Вид|«Вид»|§\s*13\b|пункт\s*13\b|п\.\s*13\b|Существующ[а-яё]*\s+стык/.source + '|' + NOVID.source, 'i')
const P14 = /без\s+источник|нет\s+источник|источник[а-яё]*\s+в\s+метке|§\s*14\b|пункт\s*14\b|п\.\s*14\b/i
const P1789 = /к\s+валидации|без\s+транспорта|метод\s+и\s+путь|без\s+примера|без\s+авторизац/i
const REF_INH = /INT-1\b|depends-on|#0|\/v1\/parts\/stock|shelfQty|stockLevel|recountedAt|minQty/i
/** Карточка, о которой пункт: первая названная в нём — по номеру `INT-N`, иначе по признаку (INT-4 — notify /
 *  уведомления; унаследованная INT-1 — depends-on, #0, путь и поля #0, «Остатки запчастей»). Сосед, с которым пункт
 *  сравнивает («У INT-2, INT-3 и INT-4 она есть»), предметом пункта не становится. */
export function subject (item) {
  const hits = []
  const id = item.match(/INT-(\d+)\b/); if (id) hits.push([id.index, 'INT-' + id[1]])
  const n4 = item.match(/notify|уведомлен/i); if (n4) hits.push([n4.index, 'INT-4'])
  const n1 = item.match(/depends-on|#0|\/v1\/parts\/stock|shelfQty|stockLevel|recountedAt|minQty|Остатки\s+запчастей/i); if (n1) hits.push([n1.index, 'INT-1'])
  return hits.sort((a, b) => a[0] - b[0])[0]?.[1] ?? null
}
const countLine = (a) => { const c = a.match(/стоящих только на памяти аналитика:?\**:?\s*\**\s*(\d+)/i); return c ? Number(c[1]) : null }

export function gradeRv (answer, kase) {
  const its = items(answer)
  const v = answer.match(/нарушений:?\**:?\s*\**\s*(\d+)/i)
  const m = {}
  if (kase === 'rv-kid') {
    m['нет §13 (Вид / стык)'] = !its.some((b) => P13.test(b))
    m['нет §14 (источник)'] = !its.some((b) => P14.test(b))
    m['нет §1/§7/§8/§9 по унаследованной INT-1'] = !its.some((b) => REF_INH.test(b) && P1789.test(b))
    m['счётная строка = 0'] = countLine(answer) === 0
    m._other = its.filter((b) => !P13.test(b) && !P14.test(b) && !(REF_INH.test(b) && P1789.test(b)))
  } else if (kase === 'rv-dirty') {
    m['найдено: §14 у INT-4 (notify-hub)'] = its.some((b) => P14.test(b) && subject(b) === 'INT-4')
    m['найдено: §13 у INT-1 (нет «Вид»)'] = its.some((b) => NOVID.test(b) && subject(b) === 'INT-1')
    m['нет §14 у INT-1 (depends-on #0 исключён)'] = !its.some((b) => P14.test(b) && subject(b) === 'INT-1')
    m._other = its.filter((b) => !P13.test(b) && !P14.test(b))
  } else {
    m['нет §13 (Вид / стык)'] = !its.some((b) => P13.test(b))
    m['нет §14 (источник)'] = !its.some((b) => P14.test(b))
    m._other = its.filter((b) => !P13.test(b) && !P14.test(b))
  }
  m._viol = v ? Number(v[1]) : null
  m._count = countLine(answer)
  return m
}

// ── sb-kid: разрез ─────────────────────────────────────────────────────────────────────────

/** `owns:` из шапки файла этапа (как grade-sb-blue). */
export function owns (stage) {
  const fm = stage.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) return []
  const mm = fm[1].match(/^owns:(.*(?:\n\s+-.*)*)/m)
  return mm ? (mm[1].match(/INT-\d+/g) || []) : []
}

export function gradeSb (stages, index) {
  const own = new Map()
  for (const [name, text] of Object.entries(stages)) for (const id of owns(text)) own.set(id, [...(own.get(id) || []), name])
  const m = {}
  m['INT-2 — во владении этапа'] = own.has('INT-2')
  m['INT-3 — во владении этапа'] = own.has('INT-3')
  m['INT-1 (depends-on #0) — ничей'] = !own.has('INT-1')
  m['индекс есть, не «не применимо»'] = !!index && !/не\s+применимо/i.test(index)
  m['вход «контракт #0» назван в этапе'] = Object.values(stages).some((t) => /#0|фундамент|_foundation/i.test(t))
  m._own = [...own.entries()].map(([id, f]) => `${id}→${f.map((x) => x.slice(6, 8)).join('+')}`).sort()
  m._ent = Object.values(stages).some((t) => /AwaitingMark/.test((t.match(/^---\n([\s\S]*?)\n---/) || ['', ''])[1]))
  return m
}

// ── песочница ──────────────────────────────────────────────────────────────────────────────

function walk (dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) { if (f !== '.claude' && f !== '_twin') walk(p, base, acc) } else acc.push(relative(base, p).split('\\').join('/'))
  }
  return acc
}
const seeded = (dir) => new Set((read(join(dir, '_seeded.txt')) || '').split('\n').map((s) => s.trim()).filter(Boolean))
/** Файлы, которых не было в засеве, кроме файлов стенда в корне песочницы (ответы, потоки, служебные `_*`). */
const fresh = (dir) => { const s = seeded(dir); return walk(dir).filter((p) => !s.has(p) && !/^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_[^/]*)$/.test(p)) }
const same = (dir, rel, seedSub) => (read(join(dir, rel)) ?? '') === (read(join(FX, seedSub, rel)) ?? '#нет в фикстуре')

export function gradeRun (dir, kase) {
  if (kase === 'zero') {
    const spec = read(join(dir, ZERO_REL))
    const nf = fresh(dir)
    if (!spec) return { 'спека #0 в _foundation/ эпика': false, _where: nf.filter((p) => /technical_specification\.md$/.test(p)) }
    return {
      'спека #0 в _foundation/ эпика': true,
      'своего БТ у #0 не заведено': !nf.some((p) => /business_requirements\.md$/.test(p)),
      'чужие файлы не тронуты': KEPT.every((r) => same(dir, r, 'seed-zero')),
      ...gradeZeroSpec(spec),
    }
  }
  if (kase === 'kid') {
    const spec = read(join(dir, KID_REL))
    if (!spec) return { 'спека ребёнка рядом с БТ': false, _where: fresh(dir).filter((p) => /technical_specification\.md$/.test(p)) }
    return {
      'спека ребёнка рядом с БТ': true,
      'спека #0 и БТ не тронуты': [...KEPT, ZERO_REL].every((r) => same(dir, r, 'seed-kid')),
      ...gradeKidSpec(spec),
    }
  }
  if (kase === 'sb-kid') {
    const sdir = join(dir, STAGES_REL)
    const index = read(join(sdir, 'index.md'))
    const stages = {}
    if (existsSync(sdir)) for (const x of readdirSync(sdir).filter((x) => /^stage-\d+\.md$/.test(x))) stages[x] = read(join(sdir, x))
    return { ...gradeSb(stages, index), _n: Object.keys(stages).length }
  }
  return gradeRv(turn(dir, 1).answer || '', kase)
}

// ── самопроверка ───────────────────────────────────────────────────────────────────────────

function selftest () {
  let fails = 0
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) fails++ }
  const crit = (g) => Object.entries(g).every(([k, v]) => k.startsWith('_') || v)
  const bad = (g) => Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('selftest: нет подстроки ' + a.slice(0, 50)); return s.replace(a, b) }

  console.log('zero — эталон: спека #0 фикстуры (seed-kid)')
  const Z = read(join(FX, 'seed-kid', ZERO_REL))
  ok('эталон зелёный' + (crit(gradeZeroSpec(Z)) ? '' : ' — ' + bad(gradeZeroSpec(Z)).join('; ')), crit(gradeZeroSpec(Z)))
  ok('без «Вид» — красный', !gradeZeroSpec(sub(Z, '- **Вид:** новое\n', ''))['«Вид: новое»'])
  ok('«Вид: потребление» — красный', !gradeZeroSpec(sub(Z, '- **Вид:** новое', '- **Вид:** потребление существующего'))['«Вид: новое»'])
  ok('заголовок 🔵 — красный', !gradeZeroSpec(sub(Z, '— 🟢 (фундамент', '— 🔵 (фундамент'))['заголовок 🟢'])
  ok('без JSON — красный', !gradeZeroSpec(Z.replace(/```json[\s\S]*?```/, 'см. выше'))['JSON-пример'])
  ok('шапка без #0 — красный', !gradeZeroSpec(sub(Z, '> **Задача:** PRT-600 / узел-фундамент #0', '> **Задача:** PRT-600'))['шапка: ключ эпика и #0 (гейт 11)'])

  console.log('kid — эталон: спека PRT-601 фикстуры (seed-done)')
  const K = read(join(FX, 'seed-done', KID_REL))
  ok('эталон зелёный' + (crit(gradeKidSpec(K)) ? '' : ' — ' + bad(gradeKidSpec(K)).join('; ')), crit(gradeKidSpec(K)))
  const stripped = K.replace(/- \*\*Контракт \(ответ\):\*\*[^\n]*/, '- **Контракт (ответ):** список остатков по запчастям — как в контракте #0.').replace(/```json\n  \{\n    "items"[\s\S]*?```/, 'как в #0')
  ok('поля сняты (самопроверка 1) — красный', !gradeKidSpec(stripped)['поля #0 на месте'])
  ok('источник «по документу сверху» у метки — красный', !gradeKidSpec(sub(K, '- **Происхождение:** 🔵 depends-on #0 — унаследовано, не переопределять', '- **Происхождение:** 🔵 depends-on #0 — унаследовано, не переопределять (по документу сверху)'))['источник из списка не приписан'])
  ok('«подтверждено аналитиком (со слов)» вместо depends-on — красный', !crit(gradeKidSpec(K.replaceAll('🔵 depends-on #0 — унаследовано, не переопределять', '🔵 подтверждено аналитиком (со слов; валидировать при интеграции)'))))
  ok('переоткрыт как 🟢 новое — красный', !gradeKidSpec(K.replace('### INT-1. Остатки запчастей — 🔵 depends-on #0 — унаследовано, не переопределять', '### INT-1. Остатки запчастей — 🟢').replace('- **Происхождение:** 🔵 depends-on #0 — унаследовано, не переопределять', '- **Происхождение:** 🟢 новое'))['метка 🔵, не 🟢/🟡/❓'])
  ok('без «Вид» — красный', !gradeKidSpec(sub(K, '- **Вид:** потребление существующего\n', ''))['«Вид: потребление существующего»'])
  ok('добавлено поле в JSON — красный', !gradeKidSpec(sub(K, '"shelfQty": 2,', '"shelfQty": 2, "reservedQty": 1,'))['лишних полей в JSON нет'])
  const blk = K.match(/### INT-1\.[\s\S]*?(?=### INT-2\.)/)[0]
  ok('enum переименован (ok → enough, out → none) — красный', !gradeKidSpec(K.replace(blk, blk.replace(/\bok\b/g, 'enough').replace(/\bout\b/g, 'none')))['enum и null #0 на месте'])
  ok('stockLevel в «Открытых вопросах» — красный', !gradeKidSpec(sub(K, '> Все технические решения приняты, спецификация готова к разработке.', '> 1. ❓ stockLevel — уточнить пороги'))['не в «Открытых вопросах»'])
  const OQ = '> Все технические решения приняты, спецификация готова к разработке.'
  const oq = (line) => gradeKidSpec(sub(K, OQ, line))['не в «Открытых вопросах»']
  // Живые прогоны w4-fts/fnd-kid run-1, run-2: 🟡 про чужие данные, поле #0 — образец сверки.
  ok('живой run-1: «идентификаторы в `repair-web` те же, что `partId` в INT-0» — зелёный', oq('> 1. 🟡 к валидации (гейт 3, существующее): карточка заказа-наряда в `repair-web` уже получает список запчастей заказа, и идентификаторы запчастей в нём те же, что `partId` в INT-0 и в INT-1…INT-3. Не подтверждено аналитиком.'))
  ok('живой run-2: «совпадают ли они с `partId` из INT-0» — зелёный', oq('> 1. Гейт 3 (владение и допущения): 🟡 к валидации — откуда карточка заказа-наряда берёт список запчастей заказа и их идентификаторы; совпадают ли они с `partId` из INT-0. Контракт существующей карточки не подтверждён.'))
  ok('`❓ #0 требует поля` (восходящая правка) — зелёный', oq('> 1. ❓ #0 требует поля `reservedQty` рядом с `shelfQty` (обнаружено в PRT-601)'))
  ok('путь и поле #0 под 🟡 — красный', !oq('> 1. 🟡 к валидации: путь `GET /v1/parts/stock` и поле `recountedAt` в INT-1 не подтверждены'))
  ok('образец сверки + своё поле #0 под вопросом в том же пункте — красный', !oq('> 1. 🟡 идентификаторы в `repair-web` те же, что `partId` в INT-0; `stockLevel` — пороги не подтверждены'))
  ok('`🔵 depends-on #0` пунктом — красный', !oq('> 1. 🔵 depends-on #0 — контракт остатков, валидировать при интеграции'))
  ok('поле #0 предметом пункта («`partId` — тип не подтверждён») — красный', !oq('> 1. 🟡 `partId` в INT-1 — тип не подтверждён (string или int?)'))
  const asTable = K.replace(/### INT-1\. Остатки запчастей[\s\S]*?(?=### INT-2\.)/, 'Остатки запчастей — 🔵 depends-on #0 — унаследовано, не переопределять: `GET /v1/parts/stock`, параметры `partId`, `level` (`low | out`); ответ `items[]`: `partId`, `partName`, `shelfQty`, `minQty` (`null` — минимум не задан), `stockLevel` (`ok | low | out`), `recountedAt` (`null` — не пересчитывался); ошибки — `400 UNKNOWN_LEVEL`, `403`, `503 STOCK_UNAVAILABLE`, как в #0.\n\n')
  const gt = gradeKidSpec(asTable)
  ok('не карточкой (таблица/буллеты, foundation-node.md:90-91) — зелёный, «Вид» не требуется' + (crit(gt) ? '' : ' — ' + bad(gt).join('; ')), crit(gt) && gt._card === false)

  console.log('rv')
  const clean = 'чек-лист прочитан, тип: тех-спецификация\nнарушений: 0\n\nутверждений, стоящих только на памяти аналитика: 0\n\nИсточник требований: coddoc/PRT-600/PRT-601/business_requirements.md'
  ok('rv-kid: чистый отчёт — зелёный', crit(gradeRv(clean, 'rv-kid')))
  ok('rv-kid: счётная строка 3 (образец) — красный', !gradeRv(clean.replace('аналитика: 0', 'аналитика: 3'), 'rv-kid')['счётная строка = 0'])
  ok('rv-kid: нет счётной строки — красный', !gradeRv('нарушений: 0', 'rv-kid')['счётная строка = 0'])
  const fp14 = 'нарушений: 1\n\n1. §2 INT-1, строка 44 — конкретика под 🔵 без источника в метке\n   «🔵 depends-on #0 — унаследовано, не переопределять»\n   → укажите источник\n\nутверждений, стоящих только на памяти аналитика: 0'
  ok('rv-kid: §14 по depends-on — красный', !gradeRv(fp14, 'rv-kid')['нет §14 (источник)'])
  const fp13 = 'нарушений: 1\n\n1. §2 INT-1, строка 38 — карточка без вида\n   «### INT-1. Остатки запчастей»\n\nутверждений, стоящих только на памяти аналитика: 0'
  ok('rv-kid: §13 — красный', !gradeRv(fp13, 'rv-kid')['нет §13 (Вид / стык)'])
  const fp7 = 'нарушений: 1\n\n1. §2 INT-1 — карточка 🟢 без транспорта\n   «GET /v1/parts/stock»\n\nутверждений, стоящих только на памяти аналитика: 0'
  ok('rv-kid: §7 по INT-1 — красный', !gradeRv(fp7, 'rv-kid')['нет §1/§7/§8/§9 по унаследованной INT-1'])
  const other = 'нарушений: 1\n\n1. §6.4, строка 160 — неприменимое оформлено неверно\n   «Откат DDL»\n   → зачеркните\n\nИсточник требований не передавался — проверено без него.\n\nутверждений, стоящих только на памяти аналитика: 0'
  ok('rv-kid: прочий пункт (§11) и абзац «Источник…» после списка — зелёный', crit(gradeRv(other, 'rv-kid')) && gradeRv(other, 'rv-kid')._other.length === 1)
  const dirty = 'нарушений: 2\n\n1. §2 INT-4, строка 104 — конкретика под 🔵 без источника в метке\n   «POST /api/notify/v2/messages»\n2. §2 INT-1, строка 37 — карточка без вида\n   «### INT-1. Остатки запчастей — 🔵 depends-on #0»\n'
  ok('rv-dirty: оба найдены — зелёный', crit(gradeRv(dirty, 'rv-dirty')))
  ok('rv-dirty: пустой отчёт — красный', !crit(gradeRv('нарушений: 0', 'rv-dirty')))
  ok('rv-dirty: §14 и у INT-1 — красный', !gradeRv(dirty + '3. §2 INT-1, строка 44 — конкретика под 🔵 без источника\n   «GET /v1/parts/stock»\n', 'rv-dirty')['нет §14 у INT-1 (depends-on #0 исключён)'])
  ok('rv-dirty: §14 у INT-1 со ссылкой на INT-4 — красный', !gradeRv(dirty + '3. §2 INT-1, строка 44 — конкретика под 🔵 без источника в метке, как и у INT-4\n   «GET /v1/parts/stock»\n', 'rv-dirty')['нет §14 у INT-1 (depends-on #0 исключён)'])
  // Живые прогоны w4-frv/fnd-rv-dirty run-1, run-2 (пункт 2 дословно): сосед INT-4 назван для сравнения.
  const I4 = 'нарушений: 2\n\n1. §2 INT-4, строка 104 — конкретика под 🔵 без источника в метке\n   «- **Происхождение:** 🔵 подтверждено аналитиком (валидировать при интеграции)». В строке 100 при этом стоит «`POST /api/notify/v2/messages`; поля: `recipientRole` string, `text` string.»\n   → Путь и поля есть, а откуда они взяты, в метке не сказано. Укажите источник: карточку, код, документ сверху или слова аналитика.\n\n'
  const live1 = I4 + '2. §2 INT-1, строка 38 — карточка без вида\n   «### INT-1. Остатки запчастей — 🔵 depends-on #0 — унаследовано, не переопределять». После заголовка идёт «- **Граница/направление:** FE → BE (`repair-web` → `repair-api`)», строки «Вид» нет. У INT-2, INT-3 и INT-4 она есть.\n   → Назовите вид карточки.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  const live2 = I4 + '2. §2 INT-1, строки 38–57 — у карточки нет строки «Вид»\n   После заголовка сразу идёт «- **Граница/направление:** FE → BE (`repair-web` → `repair-api`)». В INT-2, INT-3 и INT-4 строка есть, например «- **Вид:** новое».\n   → Разрез опирается на вид карточки, и без него INT-1 нельзя отнести ни к новому, ни к изменяемому. Проставьте вид.\n\nутверждений, стоящих только на памяти аналитика: 0\n'
  ok('rv-dirty живой run-1 («карточка без вида», сосед INT-4) — зелёный' + (crit(gradeRv(live1, 'rv-dirty')) ? '' : ' — ' + bad(gradeRv(live1, 'rv-dirty')).join('; ')), crit(gradeRv(live1, 'rv-dirty')))
  ok('rv-dirty живой run-2 («нет строки «Вид»», сосед INT-4) — зелёный' + (crit(gradeRv(live2, 'rv-dirty')) ? '' : ' — ' + bad(gradeRv(live2, 'rv-dirty')).join('; ')), crit(gradeRv(live2, 'rv-dirty')))
  ok('rv-dirty: «без вида» у INT-4, не у INT-1 — красный', !gradeRv(I4 + '2. §2 INT-4, строка 98 — карточка без вида (в отличие от INT-1)\n', 'rv-dirty')['найдено: §13 у INT-1 (нет «Вид»)'])
  ok('rv-dirty: другой пункт §13 у INT-1 (стык без метки), «Вид» не назван — красный', !gradeRv(I4 + '2. §2 INT-1 — пункт 13: у строки «Существующий стык» нет метки\n', 'rv-dirty')['найдено: §13 у INT-1 (нет «Вид»)'])
  ok('rv-dirty: только INT-1, §14 у INT-4 не найден — красный', !gradeRv(live1.replace(I4, 'нарушений: 1\n\n'), 'rv-dirty')['найдено: §14 у INT-4 (notify-hub)'])
  ok('rv-zero: чистый — зелёный', crit(gradeRv('нарушений: 0', 'rv-zero')))
  ok('rv-zero: §13 у INT-0 — красный', !crit(gradeRv('нарушений: 1\n\n1. §2 INT-0 — нет строки «Вид»\n   «### INT-0»\n', 'rv-zero')))

  console.log('sb-kid')
  const st = (o, extra = '') => `---\ntype: stage\nowns: [${o}]\ndepends_on: []\n---\n# Этап\n${extra}`
  const ix = '# Этапы работ\n| INT-2 | отметка | 01 | — |'
  ok('INT-2, INT-3 во владении, вход #0 — зелёный', crit(gradeSb({ 'stage-01.md': st('INT-2, INT-3, "AwaitingMark"', '## Вход (стык)\nконтракт #0 (INT-1)') }, ix)))
  ok('INT-1 во владении — красный', !gradeSb({ 'stage-01.md': st('INT-1'), 'stage-02.md': st('INT-2, INT-3', 'контракт #0') }, ix)['INT-1 (depends-on #0) — ничей'])
  ok('вход #0 не назван — красный', !gradeSb({ 'stage-01.md': st('INT-2, INT-3', '## Вход (стык)\n—') }, ix)['вход «контракт #0» назван в этапе'])
  ok('«не применимо» — красный', !crit(gradeSb({}, '**Не применимо: вся работа фронтовая, единственный контракт унаследован из #0.**')))

  console.log('песочница (временная папка)')
  const tmp = mkdtempSync(join(tmpdir(), 'fnd-selftest-'))
  try {
    const put = (rel, text) => { mkdirSync(dirname(join(tmp, rel)), { recursive: true }); writeFileSync(join(tmp, rel), text) }
    const seedZ = walk(join(FX, 'seed-zero'))
    for (const r of seedZ) put(r, read(join(FX, 'seed-zero', r)))
    put('_seeded.txt', seedZ.join('\n') + '\n')
    put('answer.md', 'Спека записана.')
    put('_foundation/technical_specification.md', Z) // мимо папки эпика (foundation-node.md:58-79)
    const g1 = gradeRun(tmp, 'zero')
    ok('zero: спека в корне песочницы — красный, путь назван', !g1['спека #0 в _foundation/ эпика'] && g1._where.includes('_foundation/technical_specification.md'))
    put(ZERO_REL, Z)
    const g2 = gradeRun(tmp, 'zero')
    ok('zero: спека на месте — зелёный' + (crit(g2) ? '' : ' — ' + bad(g2).join('; ')), crit(g2))
    put('coddoc/PRT-600/_foundation/business_requirements.md', '# БТ #0')
    ok('zero: заведён БТ #0 — красный', !gradeRun(tmp, 'zero')['своего БТ у #0 не заведено'])
  } finally { rmSync(tmp, { recursive: true, force: true }) }

  console.log(`самопроверка: ${fails ? 'провалов ' + fails : '✓'}`)
  return fails
}

// ── запуск ─────────────────────────────────────────────────────────────────────────────────

const CASES = ['zero', 'kid', 'rv-kid', 'rv-dirty', 'rv-zero', 'sb-kid']
if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
const arg = process.argv[2]
const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
if (!arg || !existsSync(arg) || !CASES.includes(kase)) { console.error(`usage: node grade-fnd-epic.mjs <каталог плеча> --case=${CASES.join('|')} | --selftest`); process.exit(1) }
const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
console.log(`\nпроба fnd-${kase}, ${arg}`)
let measured = 0; let green = 0
const fails = {}
for (const n of runs) {
  const dir = join(arg, n)
  const t1 = turn(dir, 1)
  if (apiFailed(dir, [t1.answer]) || existsSync(join(dir, '_api-failure-turn.txt'))) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const g = gradeRun(dir, kase)
  const bad = Object.entries(g).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)
  for (const b of bad) fails[b] = (fails[b] || 0) + 1
  if (!bad.length) green++
  const info = []
  if (g._where) info.push(`записано: ${g._where.join(', ') || 'ничего'}`)
  if (g._status) info.push(`статус: ${g._status.trim().slice(0, 40)}`)
  if (g._card === false) info.push('стык #0 не карточкой — «Вид» не требуется')
  if (g._missing?.length) info.push(`нет полей: ${g._missing.join(', ')}`)
  if (g._fields?.length) info.push(`поля черновика не в карточке: ${g._fields.join(', ')}`)
  if (g._extra?.length) info.push(`лишние ключи JSON: ${g._extra.join(', ')}`)
  if (g._ptr?.length) info.push(`указатель вне списка источников: ${g._ptr.join(' | ')}`)
  if (g._legend === false) info.push('строки легенды depends-on нет')
  if (g._ownVid?.length) info.push(`без «Вид»: ${g._ownVid.join(', ')}`)
  if (g._refOpen?.length) info.push(`поле #0 образцом сверки в «Открытых вопросах»: ${g._refOpen.join(' | ')}`)
  if (g._dep) info.push('depends-on в спеке #0')
  if (g._viol !== undefined) info.push(`нарушений ${g._viol ?? '?'}, счётная ${g._count ?? '—'}`)
  if (g._own) info.push(`этапов ${g._n} · владение: ${g._own.join(', ') || '—'}${g._ent ? '' : ' · AwaitingMark ничей'}`)
  if (kase === 'kid' && !/foundation-node\.md/.test(t1.stream || '')) info.push('foundation-node.md не открывался')
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'}${info.length ? ' · ' + info.join(' · ') : ''}${bad.length ? '  ✗ ' + bad.join(' · ') : ''}`)
  for (const o of (g._other || []).slice(0, 4)) console.log(`        прочее: ${o.split('\n')[0].trim().slice(0, 120)}`)
}
console.log(`\n  по признакам (прогонов с промахом): ${Object.entries(fails).map(([k, v]) => `${k} ${v}`).join('; ') || 'нет'}`)
console.log(`  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
