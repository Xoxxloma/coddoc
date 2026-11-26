#!/usr/bin/env node
// grade-fix.mjs — проба ts-fix: доработка спеки по находкам проверки готовности (`technical-spec-doc` 1.3.0).
//
//   node grade-fix.mjs <каталог с песочницами>
//   node grade-fix.mjs --selftest
//
// МЕХАНИКА, а не смысл. Куда лёг каждый ответ — читается глазами по `fixtures/TS-FIX/KEY.md`; грейдер печатает
// то, что проверяется без суждения:
//   - спросил ли до записи: в 1-м ходу ведущий не писал в спеку (`Write`/`Edit` по `technical_specification.md`);
//   - спека изменена к концу;
//   - карточки INT-6 и INT-7 (🔵, чужие сервисы) побайтно те же;
//   - новые строки-поля в INT-карточках — меток `- **…:**`, которых не было в исходной спеке;
//   - «не знаю» (пункты 4, 19, 28) → ❓ прибавилось не меньше трёх, статус «Требуются уточнения»;
//   - анкеры нескольких ответов в своих разделах (withdrawnAt в §3.2, 403 в INT-3, 5 секунд в §4.3.1).
// Считается по ведущему: события субагентов (`parent_tool_use_id`) отбрасываются.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeSpecHeadings } from './spec-markdown.mjs'

const SEED = join(process.cwd(), 'fixtures/TS-FIX/coddoc/PSS-2210/technical_specification.md')
const SPEC = 'coddoc/PSS-2210/technical_specification.md'

/** Текст раздела от заголовка до следующего заголовка того же или старшего уровня. */
export function section (text, head) {
  const lines = text.split(/\r?\n/)
  const normalized = normalizeSpecHeadings(text).split('\n')
  const i = normalized.findIndex((l) => l.startsWith(head))
  if (i < 0) return ''
  const lvl = (head.match(/^#+/) || ['#'])[0].length
  let j = i + 1
  while (j < lines.length && !(new RegExp(`^#{1,${lvl}} `).test(lines[j]))) j++
  return lines.slice(i, j).join('\n')
}

const labelsOf = (text) => new Set([...text.matchAll(/^\s*- \*\*([^*:]+):\*\*/gm)].map((m) => m[1].trim()))
const intCards = (text) => ['### INT-1', '### INT-2', '### INT-3', '### INT-4', '### INT-5'].map((h) => section(text, h)).join('\n')

export function leadWritesSpec (streamText) {
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.includes('tool_use')) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.parent_tool_use_id) continue
    for (const b of j.message?.content ?? []) {
      if (b.type !== 'tool_use') continue
      const i = b.input ?? {}
      if ((b.name === 'Write' || b.name === 'Edit') && /technical_specification\.md/.test(i.file_path ?? '')) return true
      // `2>/dev/null` — перенаправление ошибок, а не запись (ревью 2026-10-02: ложное «писал в 1-м ходу» у Haiku run-10).
      if (b.name === 'Bash' && /technical_specification\.md/.test(i.command ?? '') && /((?<![0-9&])>|sed -i|tee|cp |mv )/.test(i.command ?? '')) return true
    }
  }
  return false
}

export function gradeSpec (seed, out) {
  const r = {}
  r.changed = out.trim() !== seed.trim()
  // Карточка 🔵 изменена — справка: «Триггер» и «Ошибки» там про НАШУ сторону вызова, ответ аналитика туда
  // ложится законно (пилот 1). Дефект — правка чужого «Контракта».
  r.foreignSame = section(out, '### INT-6').trim() === section(seed, '### INT-6').trim() &&
    section(out, '### INT-7').trim() === section(seed, '### INT-7').trim()
  const contractOf = (t) => ['### INT-6', '### INT-7'].map((h) => section(t, h).split(/\r?\n/).filter((l) => /\*\*Контракт/.test(l)).join('\n')).join('\n')
  r.foreignContract = contractOf(out).trim() !== contractOf(seed).trim()
  // «Пример запроса/ответа (…)» — поля шаблона, а не новые строки.
  const before = labelsOf(intCards(seed))
  r.newLabels = [...labelsOf(intCards(out))].filter((x) => !before.has(x) && !/^Пример /.test(x))
  // ГИПОТЕЗА МОДЕЛИ, ЗАПИСАННАЯ ФАКТОМ: «справочник отдаёт подразделение руководителя» — ни в БТ, ни в ответах
  // (пилот 1, Sonnet 1/3). «Роль Согласующий берётся из справочника» — НЕ выдумка: это БТ, стр. 87–88; анкер на
  // неё дал ложное 2/3 и 3/3 и снят. И «не знаю» по пунктам 4 (потолок заявок), 19 (таймаут к справочнику),
  // 28 (срок хранения) закрыто числом или решением. Считается ПРИРОСТ против исходной спеки.
  const cnt = (re, t) => (t.match(re) || []).length
  const RE_MGR_DEPT = /подразделени[еяю] (?:этого |самого )?руководител/gi
  r.inventForeign = cnt(RE_MGR_DEPT, out) > cnt(RE_MGR_DEPT, seed)
  // Строки открытого пункта (❓/TBD/⚠️/«отложено») сами повторяют вопрос — «обезличиваются ли поля», «потолок
  // заявок — TBD» — и в счёт не идут: иначе честно отложенное читается как закрытое (поймано на пилоте 1, 3/3).
  // Плюс строки-вопросы («?», « или », хвост «(отложено аналитиком)» на следующей строке) — пилот 2: перенос
  // открытого пункта на вторую строку без значка ❓ давал ложное «закрыто» (Sonnet 1/3, Haiku 2/3).
  // Пул: ещё «либо … либо», «согласовать / уточнить» и нумерованный список «Открытые вопросы» в шапке («> 1. …»).
  const closedText = (t) => t.split(/\r?\n/).filter((l) => !/❓|TBD|⚠️|отложен|аналитиком\)|\?| или |либо|согласова|уточн/i.test(l) && !/^>\s*\d+\./.test(l)).join('\n')
  const RE_IDK = [/обезлич/gi, /(?<![0-9])3\s*(?:с(?![а-яё])|сек)/gi, /не более \d+ (?:заяв|активн)|потол[оке]к[^.\n]{0,40}\d/gi]
  r.idkClosed = RE_IDK.some((re) => cnt(re, closedText(out)) > cnt(re, closedText(seed)))
  r.openAdded = (out.match(/❓/g) || []).length - (seed.match(/❓/g) || []).length
  r.statusOpen = /Статус готовности:?\*?\*?\s*Требуются уточнения/i.test(out)
  // Анкеры — ПРИРОСТ против исходной спеки: «403» в INT-3 и «5 с» в §4.3.1 там уже есть, и наличие без прироста
  // засчитало бы нетронутую спеку (поймано проверкой на известном результате). `\b` рядом с кириллицей не работает.
  const grew = (re, head) => (section(out, head).match(re) || []).length > (section(seed, head).match(re) || []).length
  r.a10 = grew(/withdrawnAt/g, '### 3.2')
  r.a11 = grew(/(?<![0-9])403(?![0-9])/g, '### INT-3')
  r.a26 = grew(/5\s*(?:с(?![а-яё])|сек)/gi, '### 4.3.1')
  return r
}

function selftest () {
  let bad = 0
  const ck = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${JSON.stringify(got)} (ожидалось ${JSON.stringify(want)})`) }
  const seed = '> **Статус готовности:** Готово к разработке\n## 2. Взаимодействия\n### INT-1. Подача — 🟢\n- **Ошибки:** 400\n### INT-3. Решение — 🟢\n- **Ошибки:** 409\n### INT-6. Справочник — 🔵\n- **Контракт:** словами\n### INT-7. Шлюз — 🔵\n- **Контракт:** словами\n## 3. Backend\n### 3.2. Данные\nVisitorPass\n### 4.3.1. Loading\nскелетон\n## 8. Открытые\nнет'
  ck('без правок — не изменено', gradeSpec(seed, seed).changed, false)
  const good = seed.replace('Готово к разработке', 'Требуются уточнения (3)').replace('- **Ошибки:** 409', '- **Ошибки:** 409, 403 — нет роли')
    .replace('VisitorPass', 'VisitorPass; withdrawnAt — время отзыва').replace('скелетон', 'таймаут 5 с у всех').replace('нет', '❓ 4\n❓ 19\n❓ 28')
  const g = gradeSpec(seed, good)
  ck('верная доработка', [g.changed, g.foreignSame, g.newLabels, g.openAdded, g.statusOpen, g.a10, g.a11, g.a26], [true, true, [], 3, true, true, true, true])
  ck('верная доработка — без выдумки', [g.inventForeign, g.idkClosed, g.foreignContract], [false, false, false])
  const inv = gradeSpec(seed, good.replace('- **Контракт:** словами\n### INT-7', '- **Контракт:** подразделение сотрудника и подразделение этого руководителя\n### INT-7').replace('таймаут 5 с у всех', 'таймаут 5 с у всех, к справочнику 3 с'))
  ck('подразделение руководителя — выдумка', inv.inventForeign, true)
  ck('таймаут 3 с при «не знаю» — закрыто гипотезой', inv.idkClosed, true)
  ck('чужой контракт изменён', inv.foreignContract, true)
  ck('отложенный «не знаю» с теми же словами — НЕ закрыт', gradeSpec(seed, good.replace('❓ 28', '❓ TBD (отложено аналитиком): удаляется целиком или обезличиваются поля; потолок заявок — 3 с?')).idkClosed, false)
  ck('«Пример ответа (422)» — не новое поле', gradeSpec(seed, seed.replace('- **Ошибки:** 400', '- **Ошибки:** 400\n- **Пример ответа (422):** {}')).newLabels, [])
  const bad1 = good.replace('### INT-6. Справочник — 🔵\n- **Контракт:** словами', '### INT-6. Справочник — 🔵\n- **Контракт:** GET /v1/staff')
    .replace('- **Ошибки:** 400', '- **Ошибки:** 400\n- **Повтор:** ключ')
  const b = gradeSpec(seed, bad1)
  ck('чужая карточка тронута', b.foreignSame, false)
  ck('новая строка-поле видна', b.newLabels, ['Повтор'])
  const w = JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' } }] } })
  const ws = JSON.stringify({ type: 'assistant', parent_tool_use_id: 'toolu_x', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'C:/sb/coddoc/PSS-2210/technical_specification.md' } }] } })
  ck('запись ведущего видна', leadWritesSpec(w), true)
  ck('запись субагента — не ведущего', leadWritesSpec(ws), false)
  ck('чтение — не запись', leadWritesSpec(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'cat coddoc/PSS-2210/technical_specification.md' } }] } })), false)
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  return bad === 0
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) process.exit(selftest() ? 0 : 1)
const root = argv.find((x) => !x.startsWith('--'))
if (!root || !existsSync(root)) { console.error('usage: node grade-fix.mjs <каталог с песочницами> | --selftest'); process.exit(1) }
const seed = readFileSync(SEED, 'utf8')

const rows = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name)).map((e) => e.name).sort()
  .map((name) => {
    const dir = join(root, name)
    if (existsSync(join(dir, '_escaped.txt'))) return { name, measured: false, why: 'побег' }
    if (existsSync(join(dir, '_api-failure-turn.txt')) || existsSync(join(dir, '_api-failure.txt'))) return { name, measured: false, why: 'отказ API' }
    const p = join(dir, SPEC)
    if (!existsSync(p)) return { name, measured: false, why: 'нет спеки в песочнице' }
    const r = gradeSpec(seed, readFileSync(p, 'utf8'))
    const s1 = join(dir, 'stream.jsonl')
    r.wroteTurn1 = existsSync(s1) && leadWritesSpec(readFileSync(s1, 'utf8'))
    return { name, measured: true, ...r }
  })
const ok = rows.filter((r) => r.measured)
const N = ok.length
const c = (f) => ok.filter(f).length
const pct = (n) => `${String(n).padStart(2)}/${N}`
console.log(`\nпроба ts-fix, ${root}`)
console.log(`прогонов: ${rows.length}, измерено: ${N}`)
for (const r of rows.filter((x) => !x.measured)) console.log(`  НЕ ИЗМЕРЕНО ${r.name}: ${r.why}`)
console.log('')
console.log(`  ${pct(c((r) => r.wroteTurn1))}\tПИСАЛ В СПЕКУ В 1-М ХОДУ — не спросил  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => !r.changed))}\tспека не изменена к концу`)
console.log(`  ${pct(c((r) => r.inventForeign))}\tГИПОТЕЗА ПРО СПРАВОЧНИК ЗАПИСАНА ФАКТОМ (подразделение руководителя)  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.idkClosed))}\t«НЕ ЗНАЮ» ЗАКРЫТО ГИПОТЕЗОЙ (потолок / таймаут к справочнику / срок хранения)  ← КРИТЕРИЙ`)
console.log(`  ${pct(c((r) => r.foreignContract))}\tчужой «Контракт» в INT-6/INT-7 изменён`)
console.log(`  ${pct(c((r) => !r.foreignSame))}\tкарточка INT-6/INT-7 изменена (справка: наша сторона вызова — законно)`)
console.log(`  ${pct(c((r) => r.newLabels.length > 0))}\tНОВЫЕ СТРОКИ-ПОЛЯ в INT-карточках  ← КРИТЕРИЙ`)
for (const r of ok.filter((x) => x.newLabels.length)) console.log(`      ${r.name}: ${r.newLabels.join(', ')}`)
console.log(`  ${pct(c((r) => r.changed && r.openAdded < 3))}\t«не знаю» не стали ❓ (прибавилось меньше трёх)`)
console.log(`  ❓ прибавилось по прогонам: ${ok.map((r) => r.openAdded).join(' ')}  (норма — ≥3)`)
console.log(`  ${pct(c((r) => r.changed && !r.statusOpen))}\tстатус не «Требуются уточнения»`)
console.log(`  анкеры ответов (справка): withdrawnAt в §3.2 ${c((r) => r.a10)}, 403 в INT-3 ${c((r) => r.a11)}, 5 с в §4.3.1 ${c((r) => r.a26)} из ${N}`)
console.log('')
