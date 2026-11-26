#!/usr/bin/env node
// grade-chain.mjs — оценщик цепочек петли дискавери (`run-chain.sh`): LOOP-CHAIN и LOOP-TWICE.
//
//   node grade-chain.mjs <папка пробы> --fx CHAIN|TWICE
//   node grade-chain.mjs --selftest            (приёмка мутациями — selftest/loop/chain-mut.mjs)
//
// Раскладка: <папка>/run-<i>/stage-<k>/run-1/ — песочница стадии k (засев, выход, `_seeded.sha256`, ответы,
// `_twin/reply-*.txt`); run-<i>/_chain-broken.txt — глоб стыка нашёл не ровно один файл; run-<i>/_chain-stand-failure.txt —
// стадия без ответа.
// Мерится только (а) ложь вопреки фактам и (б) поломка пути, по `fixtures/LOOP-*/expected.md`. «Стык» и «предупреждение»
// оттуда — предупреждения, не красное.
//   (б) каждая стадия записала свой файл в своей форме; выход стадии k принят стадией k+1 (нет обрыва); засев стадии —
//       выход прошлых — не тронут (дописывать можно только ноут и только в конец).
//   (а) опора каждой строки (`ground-check.mjs`): список встречи — против расшифровки, список протокола — против реплик
//       двойника, запись ноута — против списка и ноута, выгрузка — против ноута, вход — против выгрузки и реплик;
//       ложные `вместо:` / `отвечает на:`; ловушки Л1–Л4 и факты итогового файла.
// «НЕ ИЗМЕРЕНО» — только отказ API или стенда. Стадия, которая кончилась без ответа и без маркера отказа, — красный.
// Регулярки ниже — по тексту после `norm` (строчные, ё → е). `\w` в JS кириллицу не ловит: буква — класс `L`.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { groundCheck, fmtMissing, norm, numbersOf, stripRefs } from './ground-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXROOT = join(HERE, 'fixtures')
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
const lf = (s) => String(s).replace(/^﻿/, '').replace(/\r\n/g, '\n')
const read = (p) => lf(readFileSync(p, 'utf8'))
const readIf = (p) => (existsSync(p) ? read(p) : '')
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const short = (s) => { const t = String(s).trim(); return t.length > 100 ? t.slice(0, 97) + '…' : t }
const N = (s) => norm(s).replace(/\s+/g, ' ')
const stageDir = (run, k) => join(run, `stage-${k}`, 'run-1')
// Регулярка по нормализованному тексту: `L` — буква (кириллица или латиница), `D` — не цифра.
const re = (src) => new RegExp(src.replace(/L/g, '[а-яa-z0-9]').replace(/D/g, '[^0-9]'))

// ---------- файлы песочницы ----------

// Файлы стенда в корне песочницы — ни засев, ни выход: ответы, потоки, `_*` (`_seeded.*`, `_twin/`, маркеры), `.claude`.
const STAND_TOP = /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_.*|\.claude)$/
function files (root) {
  const out = []
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!rel && STAND_TOP.test(e.name)) continue
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) walk(join(d, e.name), r); else out.push(r)
    }
  }
  if (existsSync(root)) walk(root, '')
  return out.sort()
}

// Снимок засева, как его пишет пул: `<sha256>  <путь>` (Windows — `<sha256> *<путь>`).
function snapshotOf (sb) {
  const p = join(sb, '_seeded.sha256')
  if (!existsSync(p)) return null
  const m = {}
  for (const l of read(p).split('\n')) { const x = l.match(/^\\?([0-9a-f]{64}) [ *](.+)$/); if (x) m[x[2]] = x[1] }
  return Object.keys(m).length ? m : null
}

// Засев стадии k: снимок песочницы; снимка нет — выход стадии k−1 (стадия 1 — `seed/` фикстуры) плюс `S<k>_ADD`.
function seedOf (run, k, fx) {
  const snap = snapshotOf(stageDir(run, k))
  if (snap) return snap
  const m = {}
  const base = k === 1 ? join(FIXROOT, fx.dir, 'seed') : stageDir(run, k - 1)
  for (const rel of files(base)) m[rel] = sha(join(base, rel))
  const add = fx.add[k]
  if (add) for (const rel of files(join(FIXROOT, fx.dir, add))) m[rel] = sha(join(FIXROOT, fx.dir, add, rel))
  return m
}
const newFiles = (run, k, fx) => { const seed = seedOf(run, k, fx); return files(stageDir(run, k)).filter((f) => !(f in seed)) }

function answerAll (sb) {
  if (existsSync(join(sb, 'answer.md'))) return read(join(sb, 'answer.md'))
  if (!existsSync(sb)) return ''
  return readdirSync(sb).filter((f) => /^answer-\d+\.md$/.test(f)).sort().map((f) => read(join(sb, f))).join('\n')
}
const replies = (sb) => {
  const d = join(sb, '_twin')
  return existsSync(d) ? readdirSync(d).filter((f) => /^reply-\d+\.txt$/.test(f)).sort().map((f) => read(join(d, f))).join('\n') : ''
}
// Промпт стадии с подстановкой — как его записал раннер; нет — из фикстуры.
const promptOf = (run, k, fx) => readIf(join(run, `stage-${k}-prompt.txt`)) || readIf(join(FIXROOT, fx.dir, `stage-${k}-prompt.txt`))
const turnOf = (k, fx) => readIf(join(FIXROOT, fx.dir, `stage-${k}-turn2.txt`))

// Отказ API — как в grade-nb.mjs: `_api-failure.txt`; ответ начинается с ошибки API; `_api-failure-turn.txt`, а поток того
// хода пуст или в нём (или в `_stderr.log`) ошибка API. Пустой ход модели при живом API — измерение.
function apiRefused (sb) {
  if (existsSync(join(sb, '_api-failure.txt'))) return true
  if (RE_API_FAILURE.test(answerAll(sb).slice(0, 300))) return true
  const t = join(sb, '_api-failure-turn.txt')
  if (!existsSync(t)) return false
  const n = Number((read(t).match(/ход\s+(\d+)/) || [])[1] || 0)
  const st = readIf(join(sb, n > 1 ? `stream-${String(n).padStart(2, '0')}.jsonl` : 'stream.jsonl'))
  const err = readIf(join(sb, '_stderr.log'))
  return !n || !st.trim() || RE_API_FAILURE.test(st) || RE_API_FAILURE.test(err)
}

// ---------- разбор текстов ----------

const items = (t) => String(t).split('\n').filter((l) => /^- \[/.test(l))
const kindOf = (l) => norm((String(l).match(/^- \[([^\]]+)\]/) || [])[1] || '')
// 2.0.0: без пометок ` ‖ …`, номера пункта в конце и хвостов связей.
const body = (l) => String(l).replace(/\s*‖.*$/, '').replace(/\s*·\s*\d{4}-\d{2}-\d{2}\s*№\s*\d+\.\d+\s*$/, '').replace(/^- \[[^\]]+\]\s*/, '').replace(/;\s*(вместо|отвечает на):.*$/, '')
// Пункты, которых не было в старом тексте (мультимножество строк). 2.0.0: пометка ` ‖ …`, дописанная к старой строке, —
// не новый пункт: строки сравниваются без пометок.
const unmarked = (l) => String(l).replace(/\s*‖[^\n]*$/, '')
function addedItems (oldT, newT) {
  const left = new Map()
  for (const l of items(oldT).map(unmarked)) left.set(l, (left.get(l) || 0) + 1)
  const out = []
  for (const l of items(newT)) { const k = unmarked(l); const c = left.get(k) || 0; if (c) left.set(k, c - 1); else out.push(l) }
  return out
}
// Время начала реплик расшифровки `чч:мм` — опора для времени встречи в шапке списка (`numbersOf` метки чч:мм:сс снимает).
const hhmm = (t) => [...String(t).matchAll(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}):\d{2}/gm)].map((m) => m[1]).join(' ')

// Разделы входа `## <раздел>` → строки пунктов без нумерации.
function sections (t) {
  const sec = {}; let cur = null
  for (const l of String(t).split('\n')) {
    const h = l.match(/^##\s+(.+?)\s*$/)
    if (h) { cur = norm(h[1]); sec[cur] = sec[cur] || []; continue }
    if (!cur || !l.trim() || /^[>#]/.test(l)) continue
    sec[cur].push(l.replace(/^\s*(\d+[.)]|[-*•])\s+/, ''))
  }
  return sec
}

// Записи ноута: `## <дата>` → `### <№>` → пункты.
function parseNb (t) {
  const out = []; let date = null; let cur = null
  for (const l of String(t).split('\n')) {
    const d = l.match(/^## (\d{4}-\d{2}-\d{2})/); if (d) { date = d[1]; cur = null; continue }
    const e = l.match(/^### (\d+)/); if (e && date) { cur = { date, n: e[1], items: [] }; out.push(cur); continue }
    if (cur && /^- \[/.test(l)) cur.items.push(l)
  }
  return out
}
// Связь — номером пункта (2.0.0: `<дата> №<запись>.<позиция>`), кавычки после номера — по желанию; старая форма
// `<дата> №<запись> «<начало>»` — тоже читается.
const LINK = /(вместо|отвечает на):\s*(\d{4}-\d{2}-\d{2})\s*№\s*(\d+)(?:\.(\d+))?\s*(?:«([^»]*)»)?/g
const qnorm = (s) => N(s).replace(/[«»"“”…]+/g, ' ').replace(/\.+\s*$/, '').replace(/\s+/g, ' ').trim()
const topicsOf = (fx, text) => { const n = N(text); return Object.keys(fx.topics).filter((k) => fx.topics[k].test(n)) }

// ---------- проверки, общие для стадий ----------

function ground (F, k, what, line, src, opts) {
  const r = groundCheck(line, src, opts)
  if (!r.ok) F('а', k, 'опора', `${what}: нет в источнике ${fmtMissing(r)} — «${short(line)}»`)
}

// Список пунктов: первая строка `# Пункты:`, пункт — строка `- [вид]` (`notes-to-intent` и ноут других не видят).
function formList (F, k, what, t) {
  const lines = String(t).split('\n')
  if (!/^# Пункты:/.test(lines[0] || '')) F('б', k, 'форма', `${what}: первая строка не «# Пункты:»`)
  const bad = lines.filter((l) => /^\s*(?:[-*+•]|\d+[.)])\s*\[/.test(l) && !/^- \[(решено|открыто|сведение|мысль)\]/.test(l))
  if (bad.length) F('б', k, 'форма', `${what}: пункт не строкой «- [вид]» — «${short(bad[0])}»`)
  if (!items(t).length) F('б', k, 'форма', `${what}: ни одной строки «- [»`)
}

// Связи новой записи ноута: пункт по ссылке есть; `отвечает на:` — на открытый вопрос; предмет пункта и цели общий.
function checkLinks (F, k, fx, nbText, newLines) {
  const ents = parseNb(nbText)
  for (const l of newLines) {
    for (const m of l.matchAll(LINK)) {
      const [, type, date, n, pos, q0] = m
      const q = q0 || (pos ? `№${n}.${pos}` : '')
      const ent = ents.find((e) => e.date === date && e.n === n)
      const qq = q0 ? qnorm(q0) : ''
      const tgt = !ent ? null : pos ? ent.items[Number(pos) - 1] : qq ? ent.items.find((it) => { const b = qnorm(body(it)); return b.startsWith(qq) || qq.startsWith(b) }) : null
      if (!tgt) { F('а', k, 'связь', `${type}: ${date} №${n} «${short(q)}» — такого пункта нет`); continue }
      if (tgt === l) { F('а', k, 'связь', `${type} на самого себя: «${short(body(l))}»`); continue }
      if (fx.forbidTarget && fx.forbidTarget.test(N(body(tgt)))) { F('а', k, 'связь', `${type} на мысль аналитика, которой на встрече не было: «${short(body(l))}» → «${short(q)}»`); continue }
      if (type === 'отвечает на' && kindOf(tgt) !== 'открыто') { F('а', k, 'связь', `отвечает на не вопрос: ${date} №${n} «${short(q)}»`); continue }
      const a = topicsOf(fx, body(l)); const b = topicsOf(fx, body(tgt))
      if (!a.some((x) => b.includes(x))) F('а', k, 'связь', `ложная связь: «${short(body(l))}» → ${type} ${date} №${n} «${short(q)}»`)
    }
  }
}

// Засев стадии не тронут; файлы `appendOnly` — только дописаны в конец.
function checkSeed (run, k, fx, F) {
  const sb = stageDir(run, k)
  for (const [rel, h] of Object.entries(seedOf(run, k, fx))) {
    const p = join(sb, rel)
    if (!existsSync(p)) { F('б', k, 'засев', `${rel} пропал`); continue }
    if (sha(p) === h) continue
    const ap = fx.appendOnly[k]
    if (ap && ap.test(rel)) {
      const old = readIf(k > 1 ? join(stageDir(run, k - 1), rel) : join(FIXROOT, fx.dir, 'seed', rel))
      // 2.0.0: к прошлой строке можно дописать только пометку ` ‖ …` — сверка без пометок.
      const strip = (t) => t.split('\n').map(unmarked).join('\n')
      if (old && strip(read(p)).startsWith(strip(old).replace(/\s+$/, ''))) continue
      F('б', k, 'засев', `${rel}: прошлые записи изменены (дописывать можно только в конец)`)
    } else F('б', k, 'засев', `${rel} изменён — это выход прошлой стадии или засев`)
  }
}

// ---------- числа и предметы ----------

const RE_TEN = re('(^|D)(10|десят[ьи]L*)\\s+рабоч')
const RE_SIX = re('(^|D)(6|шест[ьи]L*)\\s+рабоч')
const RE_THREE = re('(^|D)(3|три|трех)\\s+(\\S+\\s+)?дн')
const RE_FIVE = re('(^|D)(5|пят[ьи]L*)\\s+(\\S+\\s+)?дн')
const RE_SEVEN = re('(^|D)(7|сем[ьи])\\s+(\\S+\\s+)?дн')
const RE_TWO = re('(^|D)(2|два|двух)\\s+(\\S+\\s+)?дн')

// ---------- LOOP-CHAIN ----------

const CH_NB = 'notes/заявки-на-ремонт-в-общежитии/notebook.md'
const CH_T = 'meeting-2026-10-14.txt'
const RE_DISPUTED = /вахт\S*\s+(\S+\s+){0,3}не\s+принима/
const RE_GATE_DECIDED = /вахт[\s\S]*за\s+жильц|за\s+жильц[\s\S]*вахт/
const RE_CLOSEDQ = re('может ли сотрудник|(войти|заходL*|входL*)[^.?]*жильцL*\\s+нет')
// N37 — 2026-10-02 №1.3 «Может ли сотрудник эксплуатации войти…»: номером пункта или старой формой с кавычками.
const RE_N37_LINK = /отвечает на:\s*2026-10-02\s*№\s*1(\.3(?!\d)|\s*«[^»]*(может ли сотрудник|войти))/i
const RE_N36 = re('запаснL*\\s+ключ')
const RE_TASK_CH = /макет/
const RE_NOISE = /чемодан|подвал|автобус|насос|слышно/
const CH_THOUGHTS = [re('кто\\s+(из\\s+сотрудников|именно)[^.]*прид'), re('оценкL*\\s+от\\s+(1|одного)'), re('историL*\\s+(всех\\s+)?(его\\s+)?заявок'), /экран\s+служб/]
// Заменённый срок как упоминание — «вместо», «было», «как сейчас», «а не …»: не действующий срок.
const RE_MENTION = /вместо|было|как\s+сейчас|а\s+не|не\s+(10|десят|3|три|трех|5|пят)/
const activeIn = (n, r) => r.test(n) && !RE_MENTION.test(n)

// Версия `analyst-notebook` прогона — по снимку раунда `<раунд>/_skills/analyst-notebook.SKILL.md` (его кладёт раннер);
// снимка нет — текущая 1.2.0. Правка E9 (сосед оспоренного пункта идёт как есть) — с версии выше 1.2.0.
function nbFixed (run) {
  if (process.argv.includes('--nb-fixed')) return true
  const v = (readIf(join(dirname(dirname(run)), '_skills', 'analyst-notebook.SKILL.md')).match(/^version:\s*(\d+)\.(\d+)\.(\d+)/m) || []).slice(1).map(Number)
  if (v.length !== 3) return false
  return v[0] > 1 || (v[0] === 1 && (v[1] > 2 || (v[1] === 2 && v[2] > 0)))
}

// Ветка «вахта открыта»: возражение T71 увело вахтёра в открытые на стадии 1 — спора на стадии 2 нет, N35 действует.
function gateOpen (list) {
  const its = items(list)
  return !its.some((l) => kindOf(l) === 'решено' && /вахт/.test(N(l)) && /за\s+жильц/.test(N(l))) &&
    its.some((l) => kindOf(l) === 'открыто' && /вахт/.test(N(l)))
}

function checkChain ({ run, F, W }) {
  const s = (k) => stageDir(run, k)
  const has = (k) => existsSync(s(k))
  const T = readIf(join(s(1), CH_T)) || readIf(join(FIXROOT, 'LOOP-CHAIN', 'seed', CH_T))
  const tSrc = [T, hhmm(T)]
  // Срок «10» / «3»: действующим `[решено]` — красное; упоминанием или не решением — предупреждение.
  const stale = (k, l, n) => {
    for (const [r, id, what] of [[RE_TEN, 'Л1', '«10 рабочих дней»'], [RE_THREE, 'Л3', '«три дня»']]) {
      if (!r.test(n)) continue
      if (kindOf(l) === 'решено' && activeIn(n, r)) F('а', k, id, `${what} действующим сроком: «${short(l)}»`)
      else W(`стадия ${k}: упоминание ${what}: «${short(l)}»`)
    }
  }

  // Стадия 1 — список встречи.
  let ptsRel = null; let branch = false
  if (has(1)) {
    ptsRel = newFiles(run, 1, CHAIN).find((f) => /^coddoc\/[^/]+\/meeting-2026-10-14[^/]*\.points\.md$/.test(f)) || null
    if (!ptsRel) F('б', 1, 'файл', 'список встречи не записан')
    else {
      const t = read(join(s(1), ptsRel))
      branch = gateOpen(t)
      if (branch) W('ветка «вахта открыта»: вахтёр на стадии 1 — `[открыто]`, спора нет, N35 действует')
      formList(F, 1, 'список встречи', t)
      const head = t.split('\n').find((l) => /^> Встреча:/.test(l))
      if (head) ground(F, 1, 'шапка списка', head, tSrc, { header: true })
      for (const l of items(t)) ground(F, 1, 'список встречи', l, tSrc)
      if (/харитонов/i.test(t)) F('а', 1, 'опора', 'фамилия «Харитонова» в списке встречи — в расшифровке только «Лидия Павловна»')
      for (const l of items(t)) {
        const n = N(l)
        stale(1, l, n)
        if (RE_TASK_CH.test(n) && kindOf(l) !== 'сведение') F('а', 1, 'поручение', `поручение пунктом: «${short(l)}»`)
        if (RE_NOISE.test(n)) W(`стадия 1: пункт о ходе встречи: «${short(l)}»`)
      }
    }
  }

  // Стадия 2 — список в ноут с историей.
  if (has(2)) {
    const prev = readIf(join(has(1) ? s(1) : join(FIXROOT, 'LOOP-CHAIN', 'seed'), CH_NB))
    const nb2 = readIf(join(s(2), CH_NB))
    const neu = addedItems(prev, nb2)
    if (!neu.length) F('б', 2, 'файл', 'в ноут ничего не записано')
    const list = ptsRel ? readIf(join(s(2), ptsRel)) : ''
    const src = [list, prev, replies(s(2)), promptOf(run, 2, CHAIN)]
    for (const l of neu) ground(F, 2, 'запись ноута', l, src)
    checkLinks(F, 2, CHAIN, nb2, neu)
    if (!neu.some((l) => RE_N37_LINK.test(l))) W('стадия 2: ответ на N37 без `отвечает на:` («сомневаешься — без связи»)')
    // Ловушки — по самому пункту: цитата в `вместо:` / `отвечает на:` — старый пункт, не утверждение нового.
    for (const l of neu) {
      const n = N(body(l))
      stale(2, l, n)
      if (kindOf(l) === 'решено' && RE_GATE_DECIDED.test(n)) F('а', 2, 'Л2', `вахтёр решением: «${short(l)}»`)
      if (kindOf(l) === 'решено' && RE_DISPUTED.test(n) && !branch) F('а', 2, 'Л2', `оспоренное о вахте решением: «${short(l)}»`)
    }
  }

  // Стадия 3 — выгрузка.
  let expRel = null; let expText = ''
  if (has(3)) {
    expRel = newFiles(run, 3, CHAIN).find((f) => /^notes\/заявки-на-ремонт-в-общежитии\/notebook-\d{4}-\d{2}-\d{2}(-\d+)?\.points\.md$/.test(f)) || null
    if (!expRel) F('б', 3, 'файл', 'выгрузка не записана')
    else {
      const t = read(join(s(3), expRel)); expText = t
      formList(F, 3, 'выгрузка', t)
      const nb = readIf(join(s(3), CH_NB))
      const linked37 = RE_N37_LINK.test(nb)
      for (const l of items(t)) ground(F, 3, 'выгрузка', l, [nb])
      for (const l of items(t)) {
        const n = N(l); const kd = kindOf(l)
        stale(3, l, n)
        if (kd === 'решено' && RE_GATE_DECIDED.test(n)) F('а', 3, 'Л2', `вахтёр действующим решением: «${short(l)}»`)
        if (kd === 'решено' && RE_DISPUTED.test(n) && !branch) F('а', 3, 'Л2', `оспоренное о вахте действующим: «${short(l)}»`)
        if (kd === 'открыто' && RE_CLOSEDQ.test(n)) {
          if (linked37) F('а', 3, 'Л4', `закрытый вопрос открытым, хотя ответ связан \`отвечает на:\`: «${short(l)}»`)
          else W(`стадия 3: N37 открыт — ответ записан без связи: «${short(l)}»`)
        }
      }
      if (!items(t).some((l) => RE_N36.test(N(l)))) {
        if (nbFixed(run)) F('а', 3, 'N36', 'сосед оспоренного пункта «Запасные ключи … у коменданта» (2026-10-02 №1) пропал из выгрузки')
        else W('стадия 3: N36 «запасные ключи у коменданта» пропал — по правке E9 (на текущей версии не красное)')
      }
    }
  }

  // Стадия 4 — вход, итог цепочки.
  if (has(4)) {
    const inRel = newFiles(run, 4, CHAIN).find((f) => /^coddoc\/[^/]+\/notebook-[^/]*-(bt|spec)\.md$/.test(f))
    if (!inRel) { F('б', 4, 'файл', 'вход не записан'); return }
    const inp = read(join(s(4), inRel))
    const er = expRel || files(s(4)).find((f) => /^notes\/[^/]+\/notebook-[^/]*\.points\.md$/.test(f)) || ''
    const expT = expText || (er ? readIf(join(s(4), er)) : '')
    const sec = sections(inp)
    const known = ['решено', 'открыто', 'не входит', 'сведения', 'расходится с бт']
    if (!known.some((x) => x in sec)) F('б', 4, 'форма', 'во входе нет разделов «## Решено / Открыто / Не входит / Сведения»')
    const src = [expT, er, replies(s(4)), promptOf(run, 4, CHAIN)]
    for (const l of inp.split('\n')) {
      if (!l.trim() || /^#/.test(l)) continue
      ground(F, 4, 'вход', l.replace(/^\s*(\d+[.)]|[-*•])\s+/, ''), src)
    }
    const task = inp.split('\n').find((l) => /^> Задача:/.test(l)) || ''
    if (/[A-ZА-ЯЁ]{2,}-\d+/.test(task)) F('а', 4, 'ключ', `ключ, которого нет ни в одном источнике: «${short(task)}»`)
    if (!/ключа\s+ещ[её]\s+нет/i.test(task)) W('в «> Задача:» нет «ключа ещё нет»')
    if (!/новый\s+бт/.test(N(task))) W('цель не «новый БТ» (стык: журнал на вахте как «работающее»)')
    // Ссылка на источник: «№<n>» или полная `<дата> №<n>` — красное; дата без «№» — законна; `L<n>` — предупреждение.
    const refLine = inp.split('\n').find((l) => /№\s*\d+/.test(l))
    if (refLine) F('б', 4, 'ссылка', `ссылка на источник во входе: «${short(refLine)}»`)
    if (/(^|[^A-Za-z])L\d+\b/.test(inp.split('\n').filter((l) => !/^>/.test(l)).join('\n'))) W('во входе `L<n>`')

    const R = (sec['решено'] || []).map(N); const O = (sec['открыто'] || []).map(N)
    const X = (sec['не входит'] || []).map(N); const S = (sec['сведения'] || []).map(N)
    const all = [...R, ...O, ...X, ...S, ...(sec['расходится с бт'] || []).map(N)]
    const any = (arr, ...res) => arr.some((l) => res.every((r) => r.test(l)))
    const FACTS = [
      ['Ф1', 'обычная заявка — шесть рабочих дней — в «Решено»', any(R, RE_SIX)],
      ['Ф2', 'не подтвердил за пять дней — заявка закрывается сама — в «Решено»', any(R, RE_FIVE, /подтвер|закрыва/)],
      ['Ф3', 'без жильца — только при аварии — в «Решено»', any(R, /авари/, re('без жильц|жильцL*\\s+нет'))],
      ['Ф4', 'иначе при жильце, время выбирает жилец — в «Решено»', any(R, /при жильц/) || any(R, /врем/, /выбира/)],
      ['Ф5', 'фото по желанию, до четырёх — в «Решено»', any(R, /фото/, re('(^|D)(4|четырL*)(D|$)'))],
      ['Ф6', 'комментарий — в «Решено», чат — не делаем', any(R, /коммент/) && (any(X, /чат/) || any(R, /чат/, /не\s+(делаем|входит)|без\s+чата/))],
      // «уведомление» вместо «пуш» — тот же факт словами шире, не потеря (пилот 2026-10-16, run-1 стадия 4).
      ['Ф7', 'пуш при каждой смене статуса — в «Решено»', any(R, /пуш|уведомлен/, /статус/)],
      branch ? ['Ф8', 'открытый вопрос о вахтёре — в «Открыто» (ветка «вахта открыта»)', any(O, /вахт/)]
        : ['Ф8', 'спор о вахте с обеими сторонами — в «Открыто»', any(O, /вахт/, /харитонов|лиди/, /сагитов/)],
      ['Ф9', 'платит ли жилец, если сломал сам, — в «Открыто»', any(O, /сломал|плат/, /лиди|харитонов/)],
      ['Ф10', 'открытые из ноута: комендант о каждой заявке, исполнитель, заявка на секцию', any(O, /комендант/, /кажд/) && any(O, /исполнител/) && any(O, /секци/)],
      ['Ф11', 'аварийная — в течение часа', any([...R, ...S], /авари|дежурн|слесар/, /час/)],
      ['Ф12', 'около 140 заявок в месяц; летом примерно втрое больше — в «Сведениях»', any(S, /140|сто сорок/) && any(S, /втрое|(в|раза в)\s+(три|3)\s+раз/)],
    ]
    for (const [id, d, ok] of FACTS) if (!ok) F('а', 4, id, 'потерян факт: ' + d)
    if (any(R, RE_SIX) && !any(R, RE_SIX, /ковригин/)) W('у шести рабочих дней нет «Ковригин»')

    let h
    for (const [r, id, what] of [[RE_TEN, 'Л1', '«10 рабочих дней»'], [RE_THREE, 'Л3', '«три дня»']]) {
      if ((h = R.find((l) => activeIn(l, r)))) F('а', 4, id, `${what} действующим сроком в «Решено»: «${short(h)}»`)
      else if ((h = all.find((l) => r.test(l)))) W(`вход: упоминание ${what}: «${short(h)}»`)
    }
    if ((h = R.find((l) => RE_GATE_DECIDED.test(l)))) F('а', 4, 'Л2', `вахтёр в «Решено»: «${short(h)}»`)
    if (!branch && (h = R.find((l) => RE_DISPUTED.test(l)))) F('а', 4, 'Л2', `оспоренное о вахте в «Решено»: «${short(h)}»`)
    if ((h = O.find((l) => RE_CLOSEDQ.test(l)))) {
      if (items(expT).some((l) => kindOf(l) === 'открыто' && RE_CLOSEDQ.test(N(l)))) W(`вход: N37 открыт — в выгрузке он открыт, ответ без связи: «${short(h)}»`)
      else F('а', 4, 'Л4', `закрытый вопрос в «Открыто», в выгрузке его нет: «${short(h)}»`)
    }
    if ((h = [...R, ...O].find((l) => RE_TASK_CH.test(l)))) F('а', 4, 'поручение', `поручение пунктом: «${short(h)}»`)
    if ((h = R.find((l) => CH_THOUGHTS.some((r) => r.test(l))))) F('а', 4, 'мысль', `мысль или набросок аналитика в «Решено»: «${short(h)}»`)
    else if ((h = [...O, ...X, ...S].find((l) => CH_THOUGHTS.some((r) => r.test(l))))) W(`мысль или набросок во входе, аналитик их не выбирал: «${short(h)}»`)
  }
}

// ---------- LOOP-TWICE ----------

const TW_T = 'meeting-2026-10-15.txt'
const RE_STORE = /хран|невостребован/
const RE_AFTER = /после\s+чистк/
const RE_TOPIC_X = /кож[аеиу]|(^|[^а-яa-z])мех(а|ом|у)?([^а-яa-z]|$)|испорч|испорт|компенсац/
// Список протокола — тот, у кого в `> Встреча:` «по памяти».
const isRecallList = (t) => /^> Встреча:.*по памяти/m.test(t)
// Вопросы агента — предложения, которые кончаются «?».
const questionsOf = (t) => String(t).split('\n').map((l) => l.replace(/^\s*(\d+[.)]|[-*•>])\s+/, ''))
  .flatMap((l) => l.split(/(?<=[.?!])\s+/)).filter((x) => /\?\s*$/.test(x))

// «Пять дней» действующим сроком — `[решено]` о сроке с пятью днями, не «не пять, а семь» и не «вместо пяти».
const activeFive = (x) => x.kd === 'решено' && RE_FIVE.test(x.n) && !RE_MENTION.test(x.n)
const RE_TASK_TW = /к\s+сред/
const RE_LINK_ANY = /;\s*(вместо|отвечает на):/

function checkTwice ({ run, F, W }) {
  const s = (k) => stageDir(run, k)
  const has = (k) => existsSync(s(k))
  const T = readIf(join(s(2), TW_T)) || readIf(join(FIXROOT, 'LOOP-TWICE', 'stage-2-add', TW_T))
  const tSrc = [T, hhmm(T)]
  const X = (l, cut = false) => ({ l, n: N(cut ? body(l) : l), kd: kindOf(l) })
  let recRel = null

  // Стадия 1 — протокол по памяти и его список.
  if (has(1)) {
    const nf = newFiles(run, 1, TWICE)
    recRel = nf.find((f) => /^coddoc\/[^/]+\/meeting-[^/]*\.points\.md$/.test(f)) || null
    const protRel = nf.find((f) => /\.recall\.md$/.test(f))
    if (!protRel) F('б', 1, 'файл', 'протокол *.recall.md не записан')
    if (!recRel) F('б', 1, 'файл', 'список протокола не записан')
    let rep = replies(s(1))
    if (!rep.trim()) { rep = readIf(join(FIXROOT, 'LOOP-TWICE', 'stage-1-twin-card.md')); W('нет реплик двойника — опора по карточке') }
    const src = [rep, promptOf(run, 1, TWICE)]
    if (recRel) {
      const t = read(join(s(1), recRel))
      formList(F, 1, 'список протокола', t)
      const head = t.split('\n').find((l) => /^> Встреча:/.test(l))
      if (head) ground(F, 1, 'шапка списка', head, src, { header: true })
      for (const l of items(t)) {
        ground(F, 1, 'список протокола', l, src)
        const { n, kd } = X(l)
        if (RE_FIVE.test(n) && (kd === 'решено' || !/не уверен/.test(n))) F('а', 1, 'Л2', `«кажется, пять» без «не уверен» или решением: «${short(l)}»`)
        if (RE_STORE.test(n) && numbersOf(stripRefs(l)).length) F('а', 1, 'Л3', `число дней хранения, которого двойник не называл: «${short(l)}»`)
        if (RE_AFTER.test(n) && (kd === 'решено' || /на встрече/.test(n))) F('а', 1, 'Л4', `мысль аналитика решением или «на встрече»: «${short(l)}»`)
        if (RE_TOPIC_X.test(n)) F('а', 1, 'опора', `тема, которой двойник не называл: «${short(l)}»`)
      }
      if (!items(t).some((l) => kindOf(l) === 'открыто' && RE_STORE.test(N(l)) && /не помню/.test(N(l)))) {
        F('а', 1, 'хранение', 'нет `[открыто] … (по памяти: не помню)` о сроке хранения — «не помню» потеряно')
      }
    }
    if (protRel) {
      const sum = (read(join(s(1), protRel)).split(/^## Итог по памяти/m)[1] || '')
      for (const l of sum.split('\n')) if (RE_STORE.test(N(l)) && numbersOf(stripRefs(l)).length) { F('а', 1, 'Л3', `число дней хранения в итоге протокола: «${short(l)}»`); break }
    }
    const q = questionsOf(answerAll(s(1))).find((x) => RE_STORE.test(N(x)) && numbersOf(stripRefs(x)).length)
    if (q) F('а', 1, 'Л3', `агент подсказал число дней хранения: «${short(q)}»`)
  }

  // Стадия 2 — список встречи рядом со списком протокола.
  let meetRel = null
  if (has(2)) {
    const nf = newFiles(run, 2, TWICE)
    meetRel = nf.find((f) => /^coddoc\/[^/]+\/meeting-2026-10-15[^/]*\.points\.md$/.test(f)) || null
    const odd = nf.find((f) => /^coddoc\/[^/]+\/meeting-2026-10-15[^/]*points[^/]*\.md$/.test(f) && f !== meetRel)
    if (!meetRel) F('б', 2, 'файл', odd ? `список встречи «${odd}» — имя не на .points.md, ноут его не примет (баг 5)` : 'список встречи не записан')
    else {
      const t = read(join(s(2), meetRel))
      formList(F, 2, 'список встречи', t)
      const head = t.split('\n').find((l) => /^> Встреча:/.test(l))
      if (head) ground(F, 2, 'шапка списка', head, tSrc, { header: true })
      for (const l of items(t)) {
        ground(F, 2, 'список встречи', l, tSrc)
        const x = X(l)
        if (activeFive(x)) F('а', 2, 'Л1', `переигранные «пять дней» действующим сроком: «${short(l)}»`)
        if (RE_AFTER.test(x.n)) F('а', 2, 'Л4', `мысль аналитика в списке встречи — на встрече её не было: «${short(l)}»`)
        if (RE_TASK_TW.test(x.n) && x.kd !== 'сведение') F('а', 2, 'поручение', `поручение пунктом: «${short(l)}»`)
      }
    }
  }

  // Стадия 3 — новый ноут из списка протокола.
  let nbRel = null
  if (has(3)) {
    nbRel = newFiles(run, 3, TWICE).find((f) => /^notes\/[^/]+\/notebook\.md$/.test(f)) || null
    if (!nbRel) F('б', 3, 'файл', 'ноут не создан')
    else {
      const nb = read(join(s(3), nbRel))
      const its = items(nb)
      if (!its.length) F('б', 3, 'файл', 'в ноуте нет пунктов')
      const rl = recRel || files(s(3)).find((f) => /^coddoc\/[^/]+\/meeting-[^/]*\.points\.md$/.test(f) && isRecallList(readIf(join(s(3), f))))
      const rt = rl ? readIf(join(s(3), rl)) : ''
      const recallDecidedFive = items(rt).some((l) => kindOf(l) === 'решено' && RE_FIVE.test(N(l)))
      const src = [rt, promptOf(run, 3, TWICE), turnOf(3, TWICE), replies(s(3))]
      for (const l of its) {
        ground(F, 3, 'запись ноута', l, src)
        const { n, kd } = X(l, true)
        if (kd === 'решено' && RE_FIVE.test(n) && !recallDecidedFive) F('а', 3, 'Л2', `«пять дней» решением в ноуте: «${short(l)}»`)
        if (kd === 'решено' && RE_AFTER.test(n)) F('а', 3, 'Л4', `мысль аналитика решением: «${short(l)}»`)
      }
    }
  }

  // Стадия 4 — список встречи в тот же ноут.
  if (has(4)) {
    const rel = nbRel || files(s(4)).find((f) => /^notes\/[^/]+\/notebook\.md$/.test(f))
    const nb3 = rel ? readIf(join(s(3), rel)) : ''
    const nb4 = rel ? readIf(join(s(4), rel)) : ''
    const neu = addedItems(nb3, nb4)
    if (!neu.length) F('б', 4, 'файл', 'в ноут ничего не записано')
    const ml = meetRel || files(s(4)).find((f) => /^coddoc\/[^/]+\/meeting-2026-10-15[^/]*\.points\.md$/.test(f) && !isRecallList(readIf(join(s(4), f))))
    const src = [ml ? readIf(join(s(4), ml)) : '', nb3, promptOf(run, 4, TWICE), turnOf(4, TWICE), replies(s(4))]
    for (const l of neu) {
      ground(F, 4, 'запись ноута', l, src)
      const x = X(l, true)
      if (activeFive(x)) F('а', 4, 'Л1', `«пять дней» действующим сроком в записи встречи: «${short(l)}»`)
      if (x.kd === 'решено' && RE_AFTER.test(x.n)) F('а', 4, 'Л4', `мысль аналитика решением: «${short(l)}»`)
      const open = x.kd === 'решено' && !RE_LINK_ANY.test(l)
      if (open && RE_SEVEN.test(x.n)) W('стадия 4: семь дней без связи с «пять дней?» (стык)')
      if (open && RE_STORE.test(x.n) && /(^|[^0-9])(60|шестьдесят)/.test(x.n)) W('стадия 4: шестьдесят дней без связи с вопросом о хранении (стык)')
      if (open && /срочн/.test(x.n)) W('стадия 4: срочная без связи с «кто принял» (стык)')
    }
    checkLinks(F, 4, TWICE, nb4, neu)
  }

  // Стадия 5 — выгрузка, итог цепочки.
  if (has(5)) {
    const expRel = newFiles(run, 5, TWICE).find((f) => /^notes\/[^/]+\/notebook-\d{4}-\d{2}-\d{2}(-\d+)?\.points\.md$/.test(f))
    if (!expRel) { F('б', 5, 'файл', 'выгрузка не записана'); return }
    const t = read(join(s(5), expRel))
    formList(F, 5, 'выгрузка', t)
    const nb = readIf(join(s(5), expRel.replace(/notebook-[^/]+$/, 'notebook.md')))
    const its = items(t).map((l) => X(l))
    for (const x of its) ground(F, 5, 'выгрузка', x.l, [nb])
    const dec = its.filter((x) => x.kd === 'решено')
    let h
    if ((h = dec.find(activeFive))) F('а', 5, 'Л1', `«пять дней» действующим сроком в выгрузке: «${short(h.l)}»`)
    if (dec.filter((x) => RE_SEVEN.test(x.n) || activeFive(x)).length > 1) F('а', 5, 'Л1', 'о сроке обычной чистки больше одного решения с числом дней')
    if (!dec.some((x) => RE_SEVEN.test(x.n))) F('а', 5, 'Ф1', 'потерян факт: обычная чистка — семь дней')
    if (its.some((x) => x.kd === 'открыто' && RE_FIVE.test(x.n))) W('в выгрузке остался открытый «пять дней?» рядом с семью (стык: «сомневаешься — без связи»)')
    if (!dec.some((x) => /срочн/.test(x.n) && RE_TWO.test(x.n) && /(50|пятьдесят|половин)/.test(x.n))) F('а', 5, 'Ф2', 'потерян факт: срочная — два дня, доплата 50 %')
    if (!dec.some((x) => RE_STORE.test(x.n) && /(^|[^0-9])(60|шестьдесят)/.test(x.n))) F('а', 5, 'Ф3', 'потерян факт: хранение — шестьдесят дней')
    if ((h = its.find((x) => RE_STORE.test(x.n) && numbersOf(stripRefs(x.l)).some((v) => v !== 60)))) F('а', 5, 'Л3', `число дней хранения не с встречи: «${short(h.l)}»`)
    if (!dec.some((x) => /фото/.test(x.n) && /пятн/.test(x.n))) F('а', 5, 'Ф4', 'потерян факт: фото пятен и дефектов при приёме')
    if (!dec.some((x) => /кож/.test(x.n))) F('а', 5, 'Ф5', 'потерян факт: кожа и мех только на стойке')
    if (!its.some((x) => x.kd === 'открыто' && /испорт|испорч|компенсац|плат/.test(x.n))) F('а', 5, 'Ф6', 'потерян факт: плата за испорченную вещь — открыто')
    const after = its.filter((x) => RE_AFTER.test(x.n))
    if ((h = after.find((x) => x.kd === 'решено'))) F('а', 5, 'Л4', `мысль аналитика решением: «${short(h.l)}»`)
    else if (!after.some((x) => x.kd === 'мысль' || x.kd === 'набросок')) {
      // Двойник стадии 1 мысль не произнёс (обрезал пересказ) — терять было нечего: не измерено, как в grade-recall.
      const tw = join(s(1), '_twin')
      const said = existsSync(tw) && readdirSync(tw).filter((f) => /^reply-\d+\.txt$/.test(f)).some((f) => RE_AFTER.test(norm(read(join(tw, f)))))
      if (said || !existsSync(tw)) F('а', 5, 'Ф7', 'потерян факт: мысль аналитика о фото после чистки')
      else W('Ф7 не измерено: двойник на стадии 1 мысль о фото после чистки не сказал')
    }
    if ((h = its.find((x) => (x.kd === 'решено' || x.kd === 'открыто') && RE_TASK_TW.test(x.n)))) F('а', 5, 'поручение', `поручение пунктом: «${short(h.l)}»`)
    if (its.some((x) => x.kd === 'открыто' && RE_STORE.test(x.n) && /не помню/.test(x.n))) W('в выгрузке остался вопрос о сроке хранения «не помню» (стык)')
    if (its.some((x) => x.kd === 'открыто' && /кто принял/.test(x.n) && /срочн/.test(x.n))) W('в выгрузке остался вопрос «кто принял: срочная» (стык)')
  }
}

// Причина обрыва LOOP-TWICE на стадиях 3–4: списка протокола нет (стадия 1) или имя списка встречи (баг 5).
function explainTwice (run, k) {
  if (k < 3) return ''
  const s1 = stageDir(run, 1)
  const rec = files(s1).find((f) => /^coddoc\/[^/]+\/meeting-[^/]*\.points\.md$/.test(f) && isRecallList(readIf(join(s1, f))))
  if (!rec) return ' — причина: стадия 1 не записала список протокола (стадия 2 заняла его имя), это не баг 5'
  const s2 = stageDir(run, 2)
  if (files(s2).some((f) => /^coddoc\/[^/]+\/meeting-2026-10-15\.points-[^/]*\.md$/.test(f))) return ' — причина: имя списка встречи не на .points.md (баг 5)'
  return ''
}

// ---------- пробы ----------

const CHAIN = {
  name: 'CHAIN', dir: 'LOOP-CHAIN', stages: 4, add: {}, appendOnly: { 2: /^notes\/[^/]+\/notebook\.md$/ }, check: checkChain,
  // Предмет пункта — для проверки связи: ссылка законна, если у пункта и цели общий предмет.
  topics: {
    срок: re('рабочL*\\s+дн|обычнL*\\s+заявк'),
    вход: re('войти|заход|вход|без жильц|жильцL*\\s+нет|при жильц'),
    вахта: /вахт/,
    авария: /авари|дежурн|слесар/,
    статус: /статус|пуш/,
    фото: /фото/,
    чат: /чат|коммент/,
    плата: /плат|сломал/,
    вид: re('видL*\\s+заявк|аварийнL*\\s+(и|или)\\s+обычн'),
    секция: /секци/,
    исполнитель: /исполнител/,
    // «Комендант» сам по себе — участник входа без жильца; предмет — знает ли комендант о заявках.
    комендант: re('комендантL*\\s+(\\S+\\s+){0,3}(кажд|уведом|узна)|(кажд|уведом)[^.]*комендант'),
  },
}
const TWICE = {
  name: 'TWICE', dir: 'LOOP-TWICE', stages: 5, add: { 2: 'stage-2-add' }, appendOnly: { 4: /^notes\/[^/]+\/notebook\.md$/ }, check: checkTwice, explain: explainTwice,
  // Мысль аналитика о фото после чистки на встрече не звучала: связь на неё — ложная у любого пункта.
  forbidTarget: RE_AFTER,
  topics: {
    срок: re('срок\\s+обычн|обычнL*\\s+чистк|(^|D)(5|7|пят[ьи]|сем[ьи])\\s+(\\S+\\s+)?дн'),
    хранение: /хран|невостребован/,
    срочная: /срочн/,
    фото: /фото|пятн/,
    кожа: /кож|(^|[^а-яa-z])мех/,
    порча: re('испорт|испорч|платL*\\s+клиент'),
  },
}
const FX = { CHAIN, TWICE }

// ---------- исход прогона ----------

export function gradeRun (run, fx) {
  const fails = []; const warn = []
  const seen = new Set()
  const F = (kind, k, id, why) => { const key = `${kind}|${k}|${id}|${why}`; if (!seen.has(key)) { seen.add(key); fails.push({ kind, k, id, why }) } }
  const W = (w) => { if (!warn.includes(w)) warn.push(w) }
  const stages = []
  for (let k = 1; k <= fx.stages; k++) if (existsSync(stageDir(run, k))) stages.push(k)
  for (const k of stages) if (apiRefused(stageDir(run, k))) return { na: `отказ API на стадии ${k}` }
  const stand = readIf(join(run, '_chain-stand-failure.txt'))
  const broken = readIf(join(run, '_chain-broken.txt'))
  const stageNo = (t) => Number((t.match(/стадия\s+(\d+)/) || [])[1] || 0)
  if (stand) {
    const k = stageNo(stand)
    if (!k || /нет папки/.test(stand) || !existsSync(stageDir(run, k))) return { na: 'отказ стенда: ' + short(stand.split('\n')[0]) }
    F('б', k, 'ответ', 'стадия кончилась без ответа, отказа API в песочнице нет')
  }
  if (broken) F('б', stageNo(broken), 'стык', 'цепочка оборвалась: ' + short(broken.split('\n').join(' ')) + (fx.explain ? fx.explain(run, stageNo(broken)) : ''))
  if (!stand && !broken) {
    for (let k = 1; k <= fx.stages; k++) if (!stages.includes(k)) { F('б', k, 'стадия', 'не запускалась, маркера обрыва нет'); break }
  }
  for (const k of stages) {
    const sb = stageDir(run, k)
    if (!answerAll(sb).trim() && !(stand && stageNo(stand) === k)) F('б', k, 'ответ', 'ответа нет, отказа API нет')
    checkSeed(run, k, fx, F)
  }
  fx.check({ run, F, W, stages })
  fails.sort((a, b) => a.k - b.k)
  return { pass: fails.length === 0, fails, warn, reached: stages.length }
}

const fmtFail = (f) => `(${f.kind}) стадия ${f.k}: ${f.id} — ${f.why}`

function main () {
  if (process.argv[2] === '--selftest') {
    const r = spawnSync(process.execPath, [join(HERE, 'selftest', 'loop', 'chain-mut.mjs'), '--grader', fileURLToPath(import.meta.url)], { stdio: 'inherit' })
    process.exit(r.status === null ? 1 : r.status)
  }
  const arg = process.argv[2]
  const fi = process.argv.indexOf('--fx')
  const fx = fi > 0 ? FX[process.argv[fi + 1]] : null
  if (!arg || !existsSync(arg) || !fx) {
    console.error('usage: node grade-chain.mjs <папка пробы> --fx CHAIN|TWICE | --selftest')
    process.exit(1)
  }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory())
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
  console.log(`\nцепочка ${fx.dir}, ${arg}`)
  let measured = 0; let green = 0; const na = []
  for (const n of runs) {
    const r = gradeRun(join(arg, n), fx)
    if (r.na) { na.push(n); console.log(`  ${n}: НЕ ИЗМЕРЕНО — ${r.na}`); continue }
    measured++
    if (r.pass) green++
    console.log(`  ${n}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ — ' + r.fails.map(fmtFail).join('; ')}`)
    console.log(`         стадий: ${r.reached}/${fx.stages}${r.warn.length ? ' · предупреждения: ' + r.warn.join(' · ') : ''}`)
  }
  console.log(`\nИТОГ ${fx.name}: ${green}/${measured} зелёных${na.length ? `; не в счёт: ${na.join(', ')}` : ''}\n`)
}

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) main()
