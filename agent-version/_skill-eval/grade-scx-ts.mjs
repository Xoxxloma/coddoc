#!/usr/bin/env node
// grade-scx-ts.mjs — пробы scx-ts-* (скилл: technical-spec-doc в режиме мелкой правки), фикстура SCX-TS.
//
//   node grade-scx-ts.mjs <каталог плеча> --case=doc|dep|fld
//   node grade-scx-ts.mjs --selftest        (эталоны doc и dep — рукописи SCX-DOWN, fld — встроенный)
//
// ПРАВИЛА (technical-spec-doc 1.7.0, ветка feat/blue-contract):
//   SKILL.md:152-158  источник у 🔵 — один из четырёх; «`по документу сверху` — в режиме по флагу: сказано в запросе
//                     на правку или баг-репорте»; «`со слов` — аналитик сказал сам…».
//   SKILL.md:179-182  «Конкретика о существующем — путь, метод, поля, имя события — идёт в файл только под 🔵 и только
//                     из источника метки… из кода, документа сверху и со слов — то, что там названо. Чего в источнике
//                     нет, того нет и в файле.»
//   SKILL.md:185-188  «У 🟡 конкретики нет вовсе… поле пути у 🟡 пустое или „к валидации“. JSON-пример — у 🟢; у 🔵 —
//                     только из подтверждённых полей, и если это не весь ответ — с подписью „фрагмент…“».
//   SKILL.md:190-200  изменение существующего: заголовок 🟢, «Происхождение» ровно `🟢 изменение существующего`;
//                     «Существующий стык» — 🔵 с источником (путь и прежние поля — как в источнике) или 🟡 словами;
//                     таблица «поле | где | было | стало»; «„Было“ пишется только у поля из 🔵-источника»; JSON —
//                     подтверждённые поля и изменение, не весь ответ — «фрагмент».
//   SKILL.md:501-502  «every ⏭️ becomes a TBD / 🟡-к-валидации and forces „Требуются уточнения (N)“».
//   small-change-mode.md:19-22  контракт происхождения в режиме не меняется.
//   small-change-mode.md:147    «Зависимость | §6.4 — план отката» — закрыть строкой нельзя.
//   small-change-mode.md:166-169 «„поднять версию соседнего сервиса“ — это И ЕСТЬ изменение контракта, и §2
//                     становится главным разделом спеки: своё — карточка вида „изменение существующего“, чужое —
//                     карточка потребления (SKILL.md, договор происхождения)».
//   ПРОТИВОРЕЧИЕ (находка, README SCX-TS): small-change-mode.md:144 «Контракт | §2 — карточка вида „изменение
//                     существующего“: таблица „было → стало“, пример JSON» — без деления своё/чужое. Плечо fld
//                     (в запросе «Контракт — да», а контракт чужой) меряет, какая из двух строк побеждает; ожидание
//                     взято из :166-168 и договора происхождения, который режим не меняет (:19-22).
//
// doc (ARS-321) — своё изменение, путь ручки назван ТОЛЬКО в change_request.md: стык 🔵 «по документу сверху» с этим
//   путём; других путей нет; «было» пусто; JSON — только новое поле, подписан «фрагмент».
// dep (ARS-341) — поднять версию API чужого geo, путь v2 никто не назвал: §2 не «не применимо»; карточка geo —
//   «потребление существующего», 🟡, без пути, без JSON и полей с типами, без «было → стало»; пути v2 нигде нет;
//   §6.4 по существу; статус «Требуются уточнения».
// fld (ARS-342) — начать читать бортовой телефон из ответа чужого «Пульта», путь назван в запросе, имя поля — никем:
//   карточка «Пульта» — «потребление существующего», не 🟢, без «было → стало» и JSON; имя поля телефона не
//   выдумано (имена собственных состояний экрана — первая колонка таблицы §4.3 — не поле, SKILL.md §4.3); путь, если перенесён, — под 🔵 «по документу сверху»; других путей нет; статус «Требуются уточнения».

import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { read, turn, apiFailed } from './br-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CASES = {
  doc: { key: 'ARS-321', path: '/api/v2/duty/incident-list' },
  dep: { key: 'ARS-341' },
  fld: { key: 'ARS-342', path: '/pult/v4/crew-cards/{crewId}' },
}

// ─── Разбор спеки ───────────────────────────────────────────────────────────────────────────

export const section = (spec, n) => (spec.split(new RegExp(`^## (~~)?${n}\\.`, 'm'))[2] ?? '').split(/^## /m)[0]
/** Тело подраздела `### N.M.` без строки заголовка, до следующего `##`/`###`. */
export const sub = (spec, n) => (spec.split(new RegExp(`^### (~~)?${n.replace('.', '\\.')}\\.`, 'm'))[2] ?? '').split(/^#{2,3} /m)[0].split('\n').slice(1).join('\n')
/** INT-карточки §2: { head, body } на каждую. */
export function cards (spec) {
  const s2 = section(spec, 2)
  const parts = s2.split(/^(?=###\s+(?:~~)?INT-\d)/m).filter((p) => /^###\s+(~~)?INT-\d/.test(p))
  return parts.map((p) => { const [head, ...rest] = p.split('\n'); return { head, body: rest.join('\n'), all: p } })
}
const lineOf = (text, re) => text.split('\n').find((l) => re.test(l)) || ''
const vid = (c) => lineOf(c.body, /Вид\**\s*:/)
const origin = (c) => lineOf(c.body, /Происхождение\**\s*:/)
const label = (c) => (c.head.match(/[🟢🔵🟡❓]/gu) || []).join('') || (origin(c).match(/[🟢🔵🟡❓]/gu) || []).join('')
const RE_METHOD_PATH = /(GET|POST|PUT|PATCH|DELETE)\s+`?(\/[^\s`|),;«»]*)/g
const paths = (text) => [...text.matchAll(RE_METHOD_PATH)].map((x) => x[2])
const jsonBlocks = (text) => [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((x) => x[1])
const jsonKeys = (text) => [...new Set(jsonBlocks(text).flatMap((b) => [...b.matchAll(/"([A-Za-z_]\w*)"\s*:/g)].map((x) => x[1])))]
/** Пустое «было» по смыслу: поля раньше не было (SKILL.md:195-197, «было: —» у добавленного поля). Живые формы:
 *  «—», «нет поля», «поля нет» (scx-ts-doc/run-3), «— (поля нет)» (p2b-s1/ts-cr-api/run-2). */
const EMPTY_WAS = '(?:—|-|–|нет|пусто|(?:поля\\s+)?нет(?:\\s+поля)?|(?:поле\\s+)?отсутств[а-яё]*|не было(?:\\s+поля)?|поля не было|не передава[а-яё]*)'
const RE_EMPTY_WAS = new RegExp(`^(?:${EMPTY_WAS})?\\.?(?:\\s*\\(${EMPTY_WAS}\\.?\\))?\\.?$`, 'i')

/** Таблица «поле | где | было | стало» карточки: строки и признаки. */
export function changeTable (body) {
  const lines = body.split('\n').filter((l) => /^\s*\|/.test(l))
  const hi = lines.findIndex((l) => /было/i.test(l) && /стало/i.test(l))
  if (hi < 0) return null
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
  const h = cells(lines[hi]).map((x) => x.toLowerCase())
  const iWas = h.findIndex((x) => /было/.test(x))
  const iWhere = h.findIndex((x) => /^где/.test(x))
  const rows = lines.slice(hi + 1).filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(cells)
  const filledWas = rows.filter((r) => !RE_EMPTY_WAS.test((r[iWas] || '').replace(/[`*]/g, '').trim()))
  const added = new Set()
  for (const r of rows) {
    if (!RE_EMPTY_WAS.test((r[iWas] || '').replace(/[`*]/g, '').trim())) continue
    r.forEach((cell, i) => {
      if (i === iWas || i === iWhere) return
      for (const t of cell.matchAll(/[A-Za-z_]\w*(?:(?:\[\])?\.[A-Za-z_]\w*|\[\])*/g)) added.add(t[0].replace(/\[\]/g, '').split('.').pop())
    })
  }
  return { rows, filledWas, added }
}

const RE_DOC = /по\s+документу\s+сверху/i
const RE_WORDS = /со\s+слов/i
const RE_SMALL = /мелкая правка/i
const RE_NEEDS = /Статус готовности:\*{0,2}\s*Требуются уточнения \(\d+\)/
const RE_STATUS = /Статус готовности:\*{0,2}\s*([^\n]+)/
const RE_TYPED_FIELD = /`?[a-z]\w*`?\s*:\s*`?(int|integer|number|string|bool|boolean|float|double|array|object)\b/i
/** Имя поля телефона на латинице: «Пульт» его не назвал, аналитик тоже — любое такое имя выдумано. `tel:` — схема ссылки. */
const RE_PHONE_ID = /[Pp]hone|(^|[^A-Za-z])(board|crew|onboard|Board|Crew)?_?[Tt]el(?!:)(_|[A-Z]|[^A-Za-z]|$)/

/** Имена именованных состояний экрана: первая колонка таблицы состояний (заголовок «Имя состояния» / «Состояние»,
 *  шаблон §4.3) и пункты списка §4.3, начатые с `имени`. Их проектирует сама спека (SKILL.md, §4.3 «именованные
 *  состояния… стабильные идентификаторы для switch/case») — это не поле ответа «Пульта». */
export function stateNames (spec) {
  const names = new Set()
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
  const lines = spec.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/состояни/i.test(cells(lines[i])[0] || '')) continue
    for (let j = i + 1; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      for (const t of (cells(lines[j])[0] || '').replace(/[`*~]/g, '').matchAll(/[A-Za-z_]\w*/g)) names.add(t[0])
    }
  }
  for (const l of sub(spec, '4.3').split('\n')) {
    const t = l.match(/^\s*[-*]\s+\**`([A-Za-z_]\w*)`/)
    if (t) names.add(t[1])
  }
  return names
}
/** Текст, где может стоять имя поля ответа: вся спека без имён состояний экрана. Карточка, таблица «было → стало»,
 *  JSON, стык, условия §4.3 и «К валидации» §8 проверяются; `phone_hidden` в «Состояниях UI» и в §4.3 — нет. */
export function fieldText (spec) {
  let t = spec
  for (const n of stateNames(spec)) t = t.replace(new RegExp(`(^|[^\\w])${n}(?!\\w)`, 'g'), '$1')
  return t
}

function substantive (body) {
  return body.split('\n').map((l) => l.trim()).filter((l) => l && !/^(-\s*)?(\[ \]\s*)?~~/.test(l) && !/^>/.test(l)).length > 0
}

export function grade (spec, kase) {
  const m = {}
  const c = CASES[kase]
  m['спека записана'] = !!spec
  spec = spec || ''
  m['тип «мелкая правка»'] = RE_SMALL.test(spec)
  const cs = cards(spec)
  if (kase === 'doc') {
    const ch = cs.find((x) => /изменени[ея]\s+существующ/i.test(vid(x)))
    m['карточка вида «изменение существующего»'] = !!ch
    const body = ch ? ch.body : ''
    m['«Происхождение» — 🟢 изменение существующего'] = !!ch && /🟢\s*изменение существующего/.test(origin(ch))
    const seam = lineOf(body, /Существующ[а-яё]*\s+стык/i)
    m['стык: путь из документа'] = seam.includes(c.path)
    m['стык: 🔵 «по документу сверху»'] = /🔵/.test(seam) && RE_DOC.test(seam) && !/🟡/.test(seam)
    const t = changeTable(body)
    m['таблица «было → стало»'] = !!t && t.rows.length > 0
    m['«было» пусто (прежних полей в источнике нет)'] = !!t && t.filledWas.length === 0
    const keys = jsonKeys(body)
    m['JSON есть'] = keys.length > 0
    const extra = t ? keys.filter((k) => !t.added.has(k)) : keys
    m['JSON — только новые поля'] = keys.length > 0 && extra.length === 0
    m['JSON подписан «фрагмент»'] = /фрагмент/i.test(body)
    const other = paths(spec).filter((p) => !p.startsWith(c.path))
    m['других путей нет'] = other.length === 0
    const s62 = sub(spec, '6.2')
    m['§6.2 по существу'] = substantive(s62)
    m._info = [`стык: ${seam.replace(/[*]/g, '').trim().slice(0, 150) || '—'}`, `JSON-ключи: ${keys.join(', ') || '—'}${extra.length ? ' · лишние: ' + extra.join(', ') : ''}`,
      `«со слов» в стыке: ${RE_WORDS.test(seam) ? 'да' : 'нет'}`, `другие пути: ${other.join(', ') || '—'}`]
  } else if (kase === 'dep') {
    // Карточка стыка с чужим сервисом: та, у которой он в строке «Граница»; нет такой — первая, где он упомянут.
    const g = cs.find((x) => /geo/i.test(lineOf(x.body, /Граница/))) || cs.find((x) => /geo|изохрон|isochron/i.test(x.all))
    m['§2 применим: есть карточка geo'] = !!g
    const body = g ? g.all : ''
    m['вид — потребление существующего'] = !!g && /потреблени/i.test(vid(g)) && !/изменени/i.test(vid(g))
    m['карточка geo — 🟡'] = !!g && /🟡/.test(label(g)) && !/[🟢🔵]/u.test(label(g))
    m['в карточке geo нет пути'] = !!g && paths(body).length === 0 && !/\/v\d+\/|isochron/i.test(body)
    m['в карточке geo нет JSON и полей с типами'] = !!g && jsonBlocks(body).length === 0 && !RE_TYPED_FIELD.test(body) && !/`minutes`|minutes\s*:/.test(body)
    m['у geo нет «было → стало»'] = !!g && !changeTable(body)
    const v2 = paths(spec).filter((p) => /v2/i.test(p)).concat([...spec.matchAll(/`[^`\n]*\/[^`\n]*v2[^`\n]*`|`[^`\n]*v2[^`\n]*\/[^`\n]*`|\/v2\//g)].map((x) => x[0]))
    m['пути v2 нигде нет'] = v2.length === 0
    m['§6.4 по существу'] = substantive(sub(spec, '6.4'))
    m['статус «Требуются уточнения»'] = RE_NEEDS.test(spec)
    const v1 = paths(spec).filter((p) => /v1/.test(p))
    m._info = [`карточка: ${g ? g.head.trim().slice(0, 100) : '—'} · ${g ? vid(g).replace(/[*-]/g, '').trim() : ''}`,
      `путь v1 в спеке (справка): ${v1.length ? v1.join(', ') + ' · метка строки: ' + (lineOf(spec, /\/v1\/isochrone/).match(/[🟢🔵🟡]/gu) || ['нет']).join('') : 'нет'}`,
      `GeoJSON в карточке (справка): ${/geojson/i.test(body) ? 'да' : 'нет'}`, `статус: ${((spec.match(RE_STATUS) || [])[1] || '—').trim()}`]
  } else {
    const p = cs.find((x) => /Пульт|pult/i.test(lineOf(x.body, /Граница/))) || cs.find((x) => /Пульт|pult|экипаж|crew/i.test(x.all))
    m['§2: есть карточка «Пульта»'] = !!p
    const body = p ? p.all : ''
    m['вид — потребление существующего'] = !!p && /потреблени/i.test(vid(p)) && !/изменени/i.test(vid(p))
    m['чужое не 🟢'] = !!p && !/🟢/.test(label(p)) && !/🟢/.test(origin(p))
    m['у «Пульта» нет «было → стало»'] = !!p && !changeTable(body)
    m['у «Пульта» нет JSON'] = !!p && jsonBlocks(body).length === 0
    m['имя поля телефона не выдумано'] = !!spec && !RE_PHONE_ID.test(fieldText(spec))
    const pathLine = lineOf(body, /crew-cards/)
    // Метка пути — ближайшая к нему: перед путём (последняя) или после него до конца фразы. В той же строке законно
    // стоит 🟡 у имени поля («имя и формат поля — 🟡 к валидации»), и путь от этого не краснеет.
    const at = pathLine.indexOf('crew-cards')
    const before = at < 0 ? '' : pathLine.slice(0, at)
    const after = at < 0 ? '' : pathLine.slice(at).split(/\.\s/)[0]
    const lastBefore = (before.match(/[🟢🔵🟡]/gu) || []).pop() || ''
    const own = (after.match(/[🟢🔵🟡]/gu) || [])[0] || lastBefore || (p ? (label(p).match(/[🟢🔵🟡]/gu) || []).pop() : '') || ''
    const pathOk = !pathLine || (own === '🔵' && RE_DOC.test(before + after + (p ? origin(p) : '')))
    m['путь — только под 🔵 «по документу сверху»'] = !!p && pathOk
    const other = paths(spec).filter((x) => !x.startsWith('/pult/v4/crew-cards'))
    m['других путей нет'] = other.length === 0
    m['статус «Требуются уточнения»'] = RE_NEEDS.test(spec)
    const states = [...stateNames(spec)].filter((n) => RE_PHONE_ID.test(n))
    m._info = [`карточка: ${p ? p.head.trim().slice(0, 100) : '—'} · ${p ? vid(p).replace(/[*-]/g, '').trim() : ''}`,
      `путь в карточке (справка): ${pathLine ? 'да — ' + pathLine.replace(/[*]/g, '').trim().slice(0, 120) : 'нет'}`,
      `состояния экрана с «phone» (не поле, справка): ${states.join(', ') || '—'}`,
      `«со слов» у пути: ${RE_WORDS.test(pathLine) ? 'да' : 'нет'}`, `другие пути: ${other.join(', ') || '—'}`, `статус: ${((spec.match(RE_STATUS) || [])[1] || '—').trim()}`]
  }
  return m
}

const bad = (m) => Object.entries(m).filter(([k, v]) => !k.startsWith('_') && !v).map(([k]) => k)

// ─── Самопроверка ───────────────────────────────────────────────────────────────────────────

const FLD_OK = `> **Статус готовности:** Требуются уточнения (1)
**Тип:** мелкая правка
## 2. Взаимодействия (ядро)
### INT-1. Карточка экипажа из «Пульта» — 🔵
- **Вид:** потребление существующего
- **Граница/направление:** FE → чужая система (incident-web → «Пульт»)
- **Контракт:** \`GET /pult/v4/crew-cards/{crewId}\` — 🔵 подтверждено аналитиком (по документу сверху; валидировать при интеграции). Бортовой телефон в ответе есть; имя и формат поля — 🟡 к валидации, в спеку не вносятся.
- **Происхождение:** 🔵 подтверждено аналитиком (по документу сверху)
- **Трассировка:** FR-1
## 3. Backend
## 6. Релиз
### 6.2. Обратная совместимость
«Пульт» не меняется.
## 7. Трассировка`
const FLD_CHANGE = FLD_OK.replace('### INT-1. Карточка экипажа из «Пульта» — 🔵', '### INT-1. Карточка экипажа: бортовой телефон — 🟢')
  .replace('- **Вид:** потребление существующего', '- **Вид:** изменение существующего\n- **Существующий стык:** `GET /pult/v4/crew-cards/{crewId}` — 🔵 подтверждено аналитиком (по документу сверху)\n- **Изменение:**\n\n| поле | где | было | стало |\n|---|---|---|---|\n| `boardPhone` | ответ | — | добавлено: string |\n\n- **Пример ответа:** фрагмент\n  ```json\n  { "boardPhone": "+7 900 000-00-00" }\n  ```')
  .replace('- **Происхождение:** 🔵 подтверждено аналитиком (по документу сверху)', '- **Происхождение:** 🟢 изменение существующего')
const FLD_YELLOW_PATH = FLD_OK.replace('### INT-1. Карточка экипажа из «Пульта» — 🔵', '### INT-1. Карточка экипажа из «Пульта» — 🟡')
  .replace('— 🔵 подтверждено аналитиком (по документу сверху; валидировать при интеграции)', '— 🟡 к валидации').replace('- **Происхождение:** 🔵 подтверждено аналитиком (по документу сверху)', '- **Происхождение:** 🟡 к валидации')
const FLD_YELLOW_WORDS = FLD_YELLOW_PATH.replace('`GET /pult/v4/crew-cards/{crewId}` — 🟡 к валидации.', 'вызов карточки экипажа «Пульта» — 🟡 к валидации, путь не вносится.')
// Живые строки scx-ts-fld (2026-10-26): имена СОБСТВЕННЫХ состояний экрана — в «Состояниях UI» карточки и в §4.3.
const FLD_STATES = FLD_OK.replace('- **Происхождение:**', '- **Состояния UI по ответу (если есть фронт):** телефон есть → строка с телефоном под позывным; телефона нет → строки нет (`phone_hidden`, §4.3); карточка экипажа не пришла → как сейчас\n- **Происхождение:**')
  .replace('## 6. Релиз', '## 4. Frontend\n### 4.3. Состояния (именованные — обязательно, если есть FE)\n| Имя состояния | Условие | Что видит пользователь |\n|---------------|---------|------------------------|\n| `phone_shown` | карточка экипажа пришла, бортовой телефон у экипажа есть | под позывным строка с телефоном |\n| `phone_hidden` | карточка экипажа пришла, телефона у экипажа нет | строки с телефоном нет |\n\n## 8. Допущения\n- **🟡 К валидации:** имя и формат поля бортового телефона в ответе «Пульта» — у команды «Пульта».\n## 6. Релиз')
const FLD_STATES2 = FLD_STATES.replace(/phone_shown/g, 'crewPhone_value').replace(/phone_hidden/g, 'crewPhone_absent')
  .replace('| строки с телефоном нет |\n', '| строки с телефоном нет |\n\n🟢 Как именно «Пульт» сообщает отсутствие телефона, не подтверждено: фронт трактует любой из трёх вариантов (нет поля, `null`, пустая строка) как `crewPhone_absent`.\n')
const FLD_STATES_LIST = FLD_STATES.replace('(`phone_hidden`, §4.3)', '(`crew_phone_absent`, §4.3)').replace(/\| Имя состояния[^\n]*\n\|-+[^\n]*\n\| `phone_shown` \|[^\n]*\n\| `phone_hidden` \|[^\n]*\n/, '- `crew_phone_shown` — телефон есть: строка под позывным\n- `crew_phone_absent` — телефона нет: строки нет\n')

function selftest () {
  let f = 0
  const ok = (name, cond) => { console.log(`  ${cond ? '✅' : '❌'} ${name}`); if (!cond) f++ }
  const fx = (k) => read(join(HERE, 'fixtures', 'SCX-DOWN', 'coddoc', k, 'technical_specification.md'))
  const d = fx('ARS-321')
  if (!d) { console.log('  ❌ нет рукописи SCX-DOWN/coddoc/ARS-321'); return 1 }
  const gd = grade(d, 'doc')
  ok('doc: рукопись SCX-DOWN ARS-321 — зелёная', bad(gd).length === 0)
  if (bad(gd).length) console.log('     ' + bad(gd).join(' · '))
  ok('doc: «со слов» вместо «по документу сверху» — красный', !grade(d.replace('(по документу сверху; валидировать', '(со слов; валидировать'), 'doc')['стык: 🔵 «по документу сверху»'])
  ok('doc: стык без пути — красный', !grade(d.replace('- **Существующий стык:** `GET /api/v2/duty/incident-list` (incident-api)', '- **Существующий стык:** ручка списка incident-api'), 'doc')['стык: путь из документа'])
  ok('doc: стык 🟡 — красный', !grade(d.replace('— 🔵 подтверждено аналитиком (по документу сверху; валидировать при интеграции). Прежние', '— 🟡 к валидации (по документу сверху). Прежние'), 'doc')['стык: 🔵 «по документу сверху»'])
  ok('doc: обёртка «items» в JSON — красный', !grade(d.replace('{ "closedAt": null }', '{ "items": [ { "closedAt": null } ] }'), 'doc')['JSON — только новые поля'])
  ok('doc: прежнее поле «id» в JSON — красный', !grade(d.replace('{ "closedAt": null }', '{ "id": "INC-1", "closedAt": null }'), 'doc')['JSON — только новые поля'])
  ok('doc: «items[].closedAt» в таблице не легализует items', !grade(d.replace('| `closedAt` | каждый', '| `items[].closedAt` | каждый').replace('{ "closedAt": null }', '{ "items": [ { "closedAt": null } ] }'), 'doc')['JSON — только новые поля'])
  for (const w of ['поля нет', '— (поля нет)', 'нет поля', 'поле отсутствует']) {
    const gw = grade(d.replace('| `closedAt` | каждый инцидент в ответе списка | — |', `| \`closedAt\` | каждый инцидент в ответе списка | ${w} |`), 'doc')
    ok(`doc: живое «было» = «${w}» — пустое, JSON с closedAt зелёный`, gw['«было» пусто (прежних полей в источнике нет)'] && gw['JSON — только новые поля'])
  }
  ok('doc: «поля нет» у closedAt не легализует прежнее «id» в JSON', !grade(d.replace('| `closedAt` | каждый инцидент в ответе списка | — |', '| `closedAt` | каждый инцидент в ответе списка | поля нет |').replace('{ "closedAt": null }', '{ "id": "INC-1", "closedAt": null }'), 'doc')['JSON — только новые поля'])
  ok('doc: «было» = «строка (поля нет в документе)» — не пустое, красный', !grade(d.replace('| `closedAt` | каждый инцидент в ответе списка | — |', '| `closedAt` | каждый инцидент в ответе списка | строка (поля нет в документе) |'), 'doc')['«было» пусто (прежних полей в источнике нет)'])
  ok('doc: строка «было» у прежнего поля — красный',!grade(d.replace('|------|-----|------|-------|\n', '|------|-----|------|-------|\n| `status` | каждый инцидент | строка | строка, без изменений |\n'), 'doc')['«было» пусто (прежних полей в источнике нет)'])
  ok('doc: путь карточки инцидента выдуман — красный', !grade(d.replace('- **incident-web** — потребляет INT-1', '- **incident-web** — потребляет INT-1 и `GET /api/v2/duty/incidents/{id}`'), 'doc')['других путей нет'])
  ok('doc: без «фрагмент» — красный', !grade(d.replace(/фрагмент/g, 'пример'), 'doc')['JSON подписан «фрагмент»'])
  ok('doc: вид «потребление» — красный', !grade(d.replace('- **Вид:** изменение существующего', '- **Вид:** потребление существующего'), 'doc')['карточка вида «изменение существующего»'])
  const p = fx('ARS-341')
  const gp = grade(p, 'dep')
  ok('dep: рукопись SCX-DOWN ARS-341 — зелёная', bad(gp).length === 0)
  if (bad(gp).length) console.log('     ' + bad(gp).join(' · '))
  const gq = grade(fx('ARS-343'), 'dep')
  ok('dep: двойник ARS-343 (путь v2 и JSON под 🟡) — красный по пути, JSON и v2', !gq['в карточке geo нет пути'] && !gq['в карточке geo нет JSON и полей с типами'] && !gq['пути v2 нигде нет'])
  ok('dep: «изменение существующего» у чужого — красный', !grade(p.replace('- **Вид:** потребление существующего', '- **Вид:** изменение существующего'), 'dep')['вид — потребление существующего'])
  ok('dep: 🔵 у неподтверждённого — красный', !grade(p.replace('### INT-1. Изохроны для карты покрытия по API geo v2 — 🟡', '### INT-1. Изохроны для карты покрытия по API geo v2 — 🔵'), 'dep')['карточка geo — 🟡'])
  ok('dep: §2 «не применимо» — красный', !grade(p.replace(/### INT-1[\s\S]*?(?=### ~~Каталог)/, '~~Не применимо: новых/изменённых взаимодействий нет~~\n'), 'dep')['§2 применим: есть карточка geo'])
  ok('dep: §6.4 зачёркнут — красный', !grade(p.replace(/(### 6\.4\.[^\n]*\n)- Если на v2[^\n]*\n/, '$1~~Не применимо: откат не нужен~~\n'), 'dep')['§6.4 по существу'])
  ok('dep: статус «Готово к разработке» — красный', !grade(p.replace('Требуются уточнения (1)', 'Готово к разработке'), 'dep')['статус «Требуются уточнения»'])
  ok('dep: «v1/v2» прозой путём не считается', grade(p.replace('Карта покрытия продолжает', 'Переход v1/v2: карта покрытия продолжает'), 'dep')['пути v2 нигде нет'])
  ok('fld: потребление 🔵 «по документу сверху» с путём — зелёный', bad(grade(FLD_OK, 'fld')).length === 0)
  if (bad(grade(FLD_OK, 'fld')).length) console.log('     ' + bad(grade(FLD_OK, 'fld')).join(' · '))
  const gc = grade(FLD_CHANGE, 'fld')
  ok('fld: чужое оформлено изменением с выдуманным полем — красный по виду, 🟢, таблице, JSON и имени поля', !gc['вид — потребление существующего'] && !gc['чужое не 🟢'] && !gc['у «Пульта» нет «было → стало»'] && !gc['у «Пульта» нет JSON'] && !gc['имя поля телефона не выдумано'])
  ok('fld: путь под 🟡 — красный', !grade(FLD_YELLOW_PATH, 'fld')['путь — только под 🔵 «по документу сверху»'])
  ok('fld: 🟡 словами, без пути — зелёный', bad(grade(FLD_YELLOW_WORDS, 'fld')).length === 0)
  ok('fld: «tel:» ссылкой — не имя поля', grade(FLD_OK + '\nТелефон — ссылка tel: для звонка.', 'fld')['имя поля телефона не выдумано'])
  const PH = 'имя поля телефона не выдумано'
  ok('fld: живое — состояния `phone_shown`/`phone_hidden` (карточка и §4.3) — не имя поля', bad(grade(FLD_STATES, 'fld')).length === 0)
  if (bad(grade(FLD_STATES, 'fld')).length) console.log('     ' + bad(grade(FLD_STATES, 'fld')).join(' · '))
  ok('fld: живое — `crewPhone_absent` в §4.3 и в строке «нет поля… как `crewPhone_absent`» — не имя поля', grade(FLD_STATES2, 'fld')[PH])
  ok('fld: состояния списком в §4.3 (`crew_phone_shown`) — не имя поля', grade(FLD_STATES_LIST, 'fld')[PH])
  ok('fld: при состояниях поле `boardPhone` в «Контракте» — красный', !grade(FLD_STATES.replace('имя и формат поля — 🟡 к валидации, в спеку не вносятся.', 'поле `boardPhone` — 🟡 к валидации.'), 'fld')[PH])
  ok('fld: при состояниях `crewCard.phone` в условии §4.3 — красный', !grade(FLD_STATES.replace('карточка экипажа пришла, бортовой телефон у экипажа есть', 'в ответе `crewCard.phone` не пуст'), 'fld')[PH])
  ok('fld: при состояниях «предположительно `boardPhone`» в «К валидации» §8 — красный', !grade(FLD_STATES.replace('имя и формат поля бортового телефона в ответе «Пульта»', 'имя поля бортового телефона (предположительно `boardPhone`)'), 'fld')[PH])
  ok('fld: при состоянии `phone_shown` JSON с `"phone"` — красный', !grade(FLD_STATES + '\n```json\n{ "phone": "+7 900 000-00-00" }\n```\n', 'fld')[PH])
  ok('fld: состояние с тем же именем вне таблицы состояний не легализует поле', !grade(FLD_OK.replace('имя и формат поля — 🟡 к валидации, в спеку не вносятся.', 'поле `phone_shown` — 🟡 к валидации.'), 'fld')[PH])
  ok('пустая спека — красная во всех плечах', ['doc', 'dep', 'fld'].every((k) => !grade(null, k)['спека записана']))
  console.log(`самопроверка: ${f ? 'провалов ' + f : '✓'}`)
  return f
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

function main () {
  if (process.argv.includes('--selftest')) process.exit(selftest() ? 1 : 0)
  const arg = process.argv[2]
  const kase = (process.argv.find((a) => a.startsWith('--case=')) || '').slice(7)
  if (!arg || !existsSync(arg) || !CASES[kase]) { console.error('usage: node grade-scx-ts.mjs <каталог плеча> --case=doc|dep|fld'); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба scx-ts-${kase}, ${arg}`)
  let measured = 0; let green = 0
  const tot = {}
  for (const n of runs) {
    const dir = join(arg, n)
    const t1 = turn(dir, 1)
    if (existsSync(join(dir, '_escaped.txt')) || apiFailed(dir, [t1.answer])) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
    measured++
    const m = grade(read(join(dir, 'coddoc', CASES[kase].key, 'technical_specification.md')), kase)
    const b = bad(m)
    if (!b.length) green++
    for (const k of b) tot[k] = (tot[k] || 0) + 1
    if (!m['спека записана']) {
      // Уход в вопросы законен по Step 3.5 и от фантома отличается только ответом — его показываем, а не считаем.
      console.log(`  ${n}: красный  ✗ спеки нет`)
      for (const q of (t1.answer || '').split('\n').filter((l) => l.includes('?')).slice(0, 3)) console.log(`        ? ${q.replace(/[*|#>]/g, '').trim().slice(0, 140)}`)
      continue
    }
    console.log(`  ${n}: ${b.length ? 'красный' : 'зелёный'}${b.length ? '  ✗ ' + b.join(' · ') : ''}`)
    for (const l of m._info || []) console.log(`        ${l}`)
  }
  for (const [k, v] of Object.entries(tot)) console.log(`  ${v}/${measured}\t${k}`)
  console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
}
