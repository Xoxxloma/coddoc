#!/usr/bin/env node
// grade-reh.mjs <папка-плеча> [<папка-плеча> …] | --selftest
//
// Оценщик проб `rehearse` (фикстура REH-SHT, PLAN-REHEARSE.md). Плечо — `runs/<раунд>/reh-<роль>`, внутри `run-*`.
// Скилл файлов не пишет: оценивается диалог (answer-NN.md), ответы двойника (_twin/reply-NN.txt), поток вызовов
// (stream*.jsonl) и файлы песочницы, по которым сверяются опоры.
//
// Зелёный прогон (критерии записаны до первого прогона):
//   субагент запущен; ведущий документ целиком не читал; записей нет; вызовов за песочницу нет (иначе «не измерено»);
//   вопросы по одному на сообщение, всего от 5 до 7; каждая показанная опора есть в файле (строка ±2);
//   итог есть, и число пунктов в группах совпадает с ответами двойника; у reh-stop итог — сразу после «Хватит».
// Справочно: показан ли вопрос дословно из ответа субагента, сколько опор пропущено мимо сверки, опоры на
// services/ и context/, вопросы с признаками ловушки (читать глазами).
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, cpSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DOC = {
  spec: 'coddoc/SHT-410/technical_specification.md',
  bt: 'coddoc/SHT-410/business_requirements.md',
}
const probeDoc = probe => (probe === 'reh-cust' ? DOC.bt : DOC.spec)

const read = p => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const slash = s => String(s || '').split('\\').join('/')
const norm = s => String(s || '').split('`').join('').split('*').join('').replace(/\s+/g, ' ').trim()
const normQ = s => norm(s).split('«').join('').split('»').join('').split('"').join('').replace(/[?.!…]+$/, '').trim()

// ── поток вызовов ──────────────────────────────────────────────────────────────────────────────────────────────
function parseStreams(sb) {
  const files = readdirSync(sb).filter(f => f === 'stream.jsonl' || (f.startsWith('stream-') && f.endsWith('.jsonl'))).sort()
  const uses = []
  const subTexts = []
  const names = new Map()
  for (const f of files) {
    for (const line of read(join(sb, f)).split('\n')) {
      if (!line.trim()) continue
      let j; try { j = JSON.parse(line) } catch { continue }
      const content = j.message && Array.isArray(j.message.content) ? j.message.content : []
      const sub = !!j.parent_tool_use_id
      // субагент, запущенный фоном, отдаёт ответ не результатом вызова, а уведомлением (`summary`)
      if (j.type === 'system' && j.subtype === 'task_notification' && j.summary) subTexts.push(String(j.summary))
      if (j.type === 'assistant' && sub) {
        for (const c of content) if (c.type === 'text' && String(c.text).includes('## ВОПРОСЫ')) subTexts.push(String(c.text))
      }
      if (j.type === 'assistant') {
        for (const c of content) {
          if (c.type !== 'tool_use') continue
          names.set(c.id, c.name)
          uses.push({ name: c.name, sub, input: c.input || {} })
        }
      } else if (j.type === 'user' && !sub) {
        for (const c of content) {
          if (c.type !== 'tool_result') continue
          const n = names.get(c.tool_use_id)
          if (n !== 'Agent' && n !== 'Task') continue
          const text = Array.isArray(c.content) ? c.content.filter(x => x.type === 'text').map(x => x.text).join('\n') : String(c.content || '')
          subTexts.push(text)
        }
      }
    }
  }
  return { uses, subTexts }
}

// ── опоры ─────────────────────────────────────────────────────────────────────────────────────────────────────
// «<путь>.md:<строка> — «<цитата>»»; путь — от корня песочницы. Цитата может содержать вложенные «…» — берётся
// до первой », частичная цитата всё равно обязана стоять в строке.
function parseOporas(text) {
  const out = []
  for (const line of text.split('\n')) {
    let rest = line
    for (;;) {
      const m = rest.match(/([A-Za-z0-9_./-]+\.(?:md|yaml)):(\d+)[`*\s]*[—–-]+\s*«([^»]+)»/)
      if (!m) break
      out.push({ path: m[1].replace(/^\.\//, ''), line: Number(m[2]), quote: m[3] })
      rest = rest.slice(m.index + m[0].length)
    }
  }
  return out
}
function oporaOk(sb, o) {
  const lines = read(join(sb, o.path)).split('\n')
  if (!lines.length || (lines.length === 1 && !lines[0])) return false
  // SKILL.md Шаг 3 (1.1.0): слова цитаты подряд; кавычки и знаки препинания не в счёт
  const bare = s => norm(s).replace(/[.,;:!?…«»"'„“”()—–-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const q = bare(o.quote)
  if (!q) return false
  // «есть в показанных строках» (Шаг 3): цитата может перейти на соседнюю строку окна
  for (let i = Math.max(0, o.line - 3); i <= Math.min(lines.length - 1, o.line + 1); i++) {
    if (bare(lines[i]).includes(q) || (i + 1 < lines.length && bare(lines[i] + ' ' + lines[i + 1]).includes(q))) return true
  }
  return false
}

// ── вопросы в диалоге ─────────────────────────────────────────────────────────────────────────────────────────
// Заголовок вопроса: «3/6. текст» (допускаются ** вокруг номера).
function parseHeaders(text) {
  const out = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // точка после номера обязательна: «2/6 принят → следующий» — не вопрос
    // отклик ведущего перед номером в той же строке («Записал. 4/6. …») — тоже заголовок вопроса
    const m = lines[i].match(/^\s*(?:[А-ЯЁа-яё]+[.!]\s+)?[*_]*(\d+)\s*\/\s*(\d+)\s*[.)][*_]*\s+(.*)$/)
    if (!m) continue
    const body = [m[3]]
    for (let k = i + 1; k < lines.length; k++) {
      if (!lines[k].trim() || /^\s*[*_]*Опора/i.test(lines[k])) break
      body.push(lines[k])
    }
    out.push({ k: Number(m[1]), n: Number(m[2]), text: body.join(' ') })
  }
  return out
}

// Блок субагента: «## ВОПРОСЫ», пункты «N. текст» и строки «опора:».
function parseBlock(text) {
  const i = text.indexOf('## ВОПРОСЫ')
  if (i < 0) return null
  const qs = []
  for (const line of text.slice(i).split('\n').slice(1)) {
    const m = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (m) { qs.push({ text: m[2], oporas: [] }); continue }
    if (qs.length && /опора:/i.test(line)) qs[qs.length - 1].oporas.push(...parseOporas(line))
    else if (qs.length && line.trim() && !/опора:/i.test(line) && !line.trim().startsWith('```')) {
      // продолжение текста вопроса на следующей строке
      if (!qs[qs.length - 1].oporas.length) qs[qs.length - 1].text += ' ' + line.trim()
    }
  }
  return qs
}

// ── ответы двойника ───────────────────────────────────────────────────────────────────────────────────────────
function twinClass(reply) {
  const r = String(reply || '').trim()
  if (!r) return 'EMPTY'
  if (/^Хватит/i.test(r)) return 'STOP'
  if (/^Давайте\.?$/i.test(r)) return 'INTRO'
  if (/^Спасибо, всё/i.test(r)) return 'END'
  // общее правило двойника про «путь» срабатывает и на путь ручки — ответ не по карточке, группа не определена
  if (r.includes('в текущей папке')) return 'ODD'
  // «не знаю» вместе с ответом по существу или со ссылкой на документ (MIX) скилл вправе разложить по-разному
  const R_RE = /не знаю|уточню|надо спросить/i
  const hasS = r.includes('Это есть в')
  if (R_RE.test(r)) {
    const other = r.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 25 && !R_RE.test(s) && !/не обсуждали|не скажу/i.test(s))
    return other.length || hasS ? 'MIX' : 'R'
  }
  if (hasS) return 'S'
  // «Нет, …» — по таблице Шага 4 это неверная посылка (снято) или ответ по существу (вписать) смотря по вопросу, а
  // двойник раздел выбирает по словам и отвечает иногда не на тот вопрос: обе группы законны (как у MIX).
  if (/^Нет,/.test(r)) return 'MIX'
  if (r.includes('как-нибудь') || r.includes('разберёмся')) return 'E'
  return 'V'
}

// Группа ответа — по фразам карточки двойника: ответ = одна фраза карточки (± до 15 букв обвязки) → её группа.
// Иначе (две фразы разных групп, своя приписка, самопоправка «хотя нет — по карточке…») — MIX: любая группа.
// Группа самой фразы карточки — по `twinClass`: фразы карточек чистые.
const CARD = { 'reh-arch': 'twin-arch.md', 'reh-sec': 'twin-sec.md', 'reh-cust': 'twin-cust.md', 'reh-stop': 'twin-stop.md' }
const cmp = s => String(s || '').toLowerCase().split('ё').join('е').replace(/[*`«»"']/g, '').replace(/\s+/g, ' ').trim()
function loadCard(probe) {
  const text = read(join(HERE, 'fixtures', 'REH-SHT', CARD[probe] || ''))
  return text.split('\n').filter(l => l.startsWith('Отвечаешь:')).map(l => l.slice('Отвечаешь:'.length).trim())
    .map(t => ({ text: t, n: cmp(t), cls: twinClass(t) }))
}
function replyClass(reply, card) {
  const r = String(reply || '').trim()
  const base = twinClass(r)
  if (['EMPTY', 'STOP', 'INTRO', 'END', 'ODD'].includes(base) || !card.length) return base
  const n = cmp(r)
  const hits = card.filter(a => a.n && n.includes(a.n)).sort((a, b) => b.n.length - a.n.length)
  if (!hits.length || new Set(hits.map(h => h.cls)).size > 1) return 'MIX'
  const rest = n.replace(hits[0].n, '').replace(/[^a-zа-я]/g, '')
  return rest.length <= 15 ? hits[0].cls : 'MIX'
}

// Текст хода — все реплики ведущего из потока хода (так их видит пользователь), а не только финальный `result`:
// вопрос, напечатанный до вызова инструмента, в `result` не попадает.
function turnText(sb, t) {
  const f = join(sb, t === 1 ? 'stream.jsonl' : `stream-${String(t).padStart(2, '0')}.jsonl`)
  const texts = []
  for (const line of read(f).split('\n')) {
    if (!line.trim()) continue
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type !== 'assistant' || j.parent_tool_use_id || !j.message || !Array.isArray(j.message.content)) continue
    for (const c of j.message.content) if (c.type === 'text' && String(c.text).trim()) texts.push(String(c.text))
  }
  return texts.join('\n\n')
}

// ── итог ──────────────────────────────────────────────────────────────────────────────────────────────────────
function parseSummary(text) {
  const m = text.match(/Задано вопросов:\s*(\d+)\s*из\s*(\d+)/)
  if (!m) return null
  const lines = text.split('\n')
  const idx = s => lines.findIndex(l => l.includes(s))
  const count = (from, to) => {
    if (from < 0) return null
    const end = to > from ? to : lines.length
    let c = 0
    for (let i = from + 1; i < end; i++) if (/^\s*\d+\.\s/.test(lines[i])) c++
    return c
  }
  const iR = idx('Решить до встречи'), iV = idx('Вписать в документ'), iS = idx('Снято')
  const sm = text.match(/Снято:\s*(\d+)/)
  const rm = text.match(/убрал вопросов:\s*(\d+)/)
  return {
    k: Number(m[1]), n: Number(m[2]),
    r: count(iR, iV > iR ? iV : iS), v: count(iV, iS), s: sm ? Number(sm[1]) : null,
    removed: rm ? Number(rm[1]) : 0,
  }
}

// ── один прогон ───────────────────────────────────────────────────────────────────────────────────────────────
function gradeRun(sb, probe) {
  const res = { run: basename(sb), checks: [], notes: [], status: 'green' }
  const fail = (name, why) => { res.checks.push(`✘ ${name}${why ? ' — ' + why : ''}`); res.status = res.status === 'unmeasured' ? res.status : 'red' }
  const ok = name => res.checks.push(`✔ ${name}`)
  if (existsSync(join(sb, '_api-failure.txt')) || existsSync(join(sb, '_api-failure-turn.txt')) || existsSync(join(sb, '_escaped.txt'))) {
    res.status = 'unmeasured'; res.checks.push('… отказ API или побег — не измерено'); return res
  }
  const answers = readdirSync(sb).filter(f => /^answer-\d+\.md$/.test(f)).sort()
  if (!answers.length) {
    if (read(join(sb, 'answer.md')).trim()) answers.push('answer.md')
    else { res.status = 'unmeasured'; res.checks.push('… ответа нет — не измерено'); return res }
  }
  const turnNo = f => (f === 'answer.md' ? 1 : Number(f.match(/\d+/)[0]))
  const ans = answers.map(f => ({ t: turnNo(f), text: turnText(sb, turnNo(f)) || read(join(sb, f)) }))
  const card = loadCard(probe)
  const reply = t => read(join(sb, '_twin', `reply-${String(t).padStart(2, '0')}.txt`))

  const { uses, subTexts } = parseStreams(sb)
  const lead = uses.filter(u => !u.sub)
  const sbAbs = slash(resolve(sb)).toLowerCase()
  const sbVariants = [sbAbs, '/' + sbAbs.replace(/^([a-z]):/, '$1')]   // C:/x и /c/x (Git Bash)
  const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])

  // побег: путь в стенд вне песочницы
  const escaped = uses.find(u => strings(u.input).some(raw => {
    let s = slash(raw).toLowerCase()
    if (s.includes('fixtures/reh') || s.includes('twin-')) return true
    for (const v of sbVariants) s = s.split(v).join('')
    return s.includes('_skill-eval')
  }))
  if (escaped) { res.status = 'unmeasured'; res.checks.push(`… вызов за песочницу (${escaped.name}) — не измерено`); return res }

  // субагент и чтение документа ведущим
  lead.some(u => u.name === 'Agent' || u.name === 'Task') ? ok('субагент запущен') : fail('субагент запущен', 'вызова Agent у ведущего нет')
  const doc = probeDoc(probe)
  const readDoc = lead.find(u => u.name === 'Read' && slash(u.input.file_path).endsWith(doc) && !(Number(u.input.limit) > 0 && Number(u.input.limit) <= 10))
  readDoc ? fail('ведущий документ не читал', `Read ${doc} limit=${readDoc.input.limit ?? '—'}`) : ok('ведущий документ не читал')

  // записи
  const writes = uses.filter(u => ['Write', 'Edit', 'NotebookEdit', 'MultiEdit'].includes(u.name))
  const seeded = new Set(read(join(sb, '_seeded.txt')).split('\n').map(s => s.trim()).filter(Boolean))
  const extra = []
  const walk = (d, rel) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f), r = rel ? `${rel}/${f}` : f
      if (!rel && (f.startsWith('answer') || f.startsWith('stream') || f.startsWith('_') || f === '.claude')) continue
      if (statSync(p).isDirectory()) walk(p, r)
      else if (seeded.size && !seeded.has(r)) extra.push(r)
    }
  }
  walk(sb, '')
  writes.length || extra.length ? fail('файлов не записано', [...writes.map(w => w.name + ' ' + slash(w.input.file_path)), ...extra].join(', ')) : ok('файлов не записано')

  // вопросы
  const block = subTexts.map(parseBlock).filter(Boolean).pop() || null
  const asked = []
  let multi = 0, total = null
  const timeline = []
  let current = null, summaryTurn = null
  for (const a of ans) {
    const hs = parseHeaders(a.text)
    const isSummary = a.text.includes('Задано вопросов')
    if (hs.length > 1) multi++
    for (const h of hs) { asked.push({ ...h, turn: a.t, oporas: [] }); total = total ?? h.n }
    if (hs.length) {
      const opAll = parseOporas(a.text)
      asked[asked.length - 1].oporas = opAll
      current = asked[asked.length - 1]
      timeline.push({ t: a.t, kind: 'q', q: current })
    } else if (isSummary) { summaryTurn = a.t; timeline.push({ t: a.t, kind: 'summary' }) }
    else if (current) timeline.push({ t: a.t, kind: 'followup', q: current })
    else timeline.push({ t: a.t, kind: 'intro' })
  }
  multi ? fail('по одному вопросу на сообщение', `сообщений с несколькими вопросами: ${multi}`) : ok('по одному вопросу на сообщение')
  // `brief.md` 1.1.0: «не больше семи, можно ни одного» (было «от пяти до семи»)
  total != null && total >= 1 && total <= 7 ? ok(`вопросов ${total}`) : fail('вопросов от 1 до 7', `N=${total ?? 'нет заголовков'}`)

  // опоры показанных вопросов
  const shown = asked.flatMap(q => q.oporas)
  const bad = shown.filter(o => !oporaOk(sb, o))
  if (!shown.length) fail('опоры показаны и подтверждены', 'опор не показано')
  else bad.length ? fail('опоры показаны и подтверждены', bad.map(o => `${o.path}:${o.line}`).join(', ')) : ok(`опоры подтверждены (${shown.length})`)
  const noOpora = asked.filter(q => !q.oporas.length).length
  if (noOpora) fail('у каждого вопроса опора', `без опоры: ${noOpora}`)

  // ответы двойника → группы
  const perQ = new Map()
  let stopAfter = null
  for (const e of timeline) {
    const r = reply(e.t + 1)
    const c = replyClass(r, card)
    if (e.kind === 'q' || e.kind === 'followup') {
      if (!perQ.has(e.q)) perQ.set(e.q, [])
      perQ.get(e.q).push({ kind: e.kind, c })
      if (c === 'STOP') stopAfter = e.t
    }
  }
  const exp = { R: 0, V: 0, S: 0, ODD: 0, MIX: 0, STOP: 0 }
  let noFollow = 0, extraFollow = 0
  for (const [, list] of perQ) {
    const first = list[0]
    // вопрос, на который ответили «хватит», правило итога не раскладывает: в любой группе или ни в одной
    if (first.c === 'STOP') { exp.STOP++; continue }
    let cls = first.c
    if (cls === 'E') {
      const f = list.find(x => x.kind === 'followup')
      if (!f) { noFollow++; cls = 'R' } else cls = f.c === 'E' ? 'R' : f.c
    } else if (list.some(x => x.kind === 'followup')) extraFollow++
    if (cls in exp) exp[cls]++
  }
  if (noFollow) fail('уточнение на уклончивый ответ', `не задано: ${noFollow}`)
  if (extraFollow) res.notes.push(`лишних уточнений: ${extraFollow}`)

  // итог
  const sumText = summaryTurn != null ? ans.find(a => a.t === summaryTurn).text : ''
  const sum = sumText ? parseSummary(sumText) : null
  if (!sum) fail('итог есть', 'строки «Задано вопросов» нет')
  else {
    ok(`итог: задано ${sum.k} из ${sum.n}`)
    // ответы ODD и MIX скилл вправе положить в любую группу: сверяем сумму и нижние границы
    const any = exp.ODD + exp.MIX
    const base = exp.R + exp.V + exp.S + any, total = sum.r + sum.v + sum.s
    const same = any || exp.STOP
      ? sum.r >= exp.R && sum.v >= exp.V && sum.s >= exp.S && total >= base && total <= base + exp.STOP
      : sum.r === exp.R && sum.v === exp.V && sum.s === exp.S
    if (exp.ODD) res.notes.push(`ответов двойника не по карточке («в текущей папке»): ${exp.ODD}`)
    if (exp.MIX) res.notes.push(`ответов двойника не одной фразой карточки (шум, группа любая): ${exp.MIX}`)
    same ? ok(`группы сходятся (решить ${exp.R}, вписать ${exp.V}, снято ${exp.S}${any ? `, любая ${any}` : ''})`)
      : fail('группы сходятся с ответами двойника', `ждём решить ${exp.R}/вписать ${exp.V}/снято ${exp.S}${any ? ` +${any} любая` : ''}, в итоге ${sum.r}/${sum.v}/${sum.s}`)
    if (sum.k !== asked.length) res.notes.push(`«задано» ${sum.k}, заголовков ${asked.length}`)
  }
  if (probe === 'reh-stop') {
    if (stopAfter == null) fail('итог сразу после «Хватит»', 'двойник «Хватит» не сказал')
    else {
      const next = ans.find(a => a.t === stopAfter + 1)
      next && next.text.includes('Задано вопросов') && !parseHeaders(next.text).length
        ? ok('итог сразу после «Хватит»') : fail('итог сразу после «Хватит»', 'следующим ходом не итог')
      if (sum && sum.k !== asked.length) fail('«задано» = вопросов до остановки', `в итоге ${sum.k}, задано ${asked.length}`)
      const stopQ = timeline.find(e => e.t === stopAfter)
      if (stopQ && stopQ.q && stopQ.q.k !== 3) res.notes.push(`двойник остановил на вопросе ${stopQ.q.k}, а не на 3`)
    }
  }

  // справочно: дословность, сверка, контекст, ловушки
  if (block) {
    const bt = block.map(q => normQ(q.text))
    const verbatim = asked.filter(q => bt.includes(normQ(q.text))).length
    res.notes.push(`дословно из блока: ${verbatim} из ${asked.length}; в блоке ${block.length}`)
    const lostOp = asked.filter(a => { const b = block.find(q => normQ(q.text) === normQ(a.text)); return b && b.oporas.length > a.oporas.length }).length
    res.notes.push(`показано опор меньше, чем в блоке: у ${lostOp} вопросов; опор в блоке на context/: ${block.flatMap(q => q.oporas).filter(o => o.path.startsWith('context/')).length}, на services/: ${block.flatMap(q => q.oporas).filter(o => o.path.startsWith('services/')).length}`)
    const failing = block.filter(q => q.oporas.some(o => !oporaOk(sb, o)) || !q.oporas.length)
    const shownFailing = failing.filter(q => asked.some(a => normQ(a.text) === normQ(q.text))).length
    res.notes.push(`опор блока не в файле: ${failing.length} (показано из них: ${shownFailing})`)
    if (sum && sum.removed !== block.length - asked.length && probe !== 'reh-stop') res.notes.push(`«убрал» ${sum.removed}, по счёту ${block.length - asked.length}`)
  } else res.notes.push('блок субагента не найден')
  const ctx = shown.filter(o => o.path.startsWith('context/')).length, svc = shown.filter(o => o.path.startsWith('services/')).length
  res.notes.push(`опор на context/: ${ctx}, на services/: ${svc}`)
  const trap = asked.filter(q => /(служб[а-яё]* пропуск|badge-service|справочник|org-directory)/i.test(q.text) && /(событи|уведомл|подпис|вебхук|webhook|офис|ФИО|фото|кэш)/i.test(q.text))
  for (const q of trap) res.notes.push(`ловушка? ${q.k}/${q.n}: ${norm(q.text).slice(0, 160)}`)
  return res
}

function gradeArm(dir) {
  const probe = basename(resolve(dir)).split('-').slice(0, 2).join('-')
  const runs = readdirSync(dir).filter(f => f.startsWith('run-') && statSync(join(dir, f)).isDirectory()).sort()
  const out = runs.map(r => gradeRun(join(dir, r), probe))
  console.log(`\n== ${dir} (${probe})`)
  for (const r of out) {
    console.log(`-- ${r.run}: ${r.status === 'green' ? 'ЗЕЛЁНЫЙ' : r.status === 'red' ? 'КРАСНЫЙ' : 'НЕ ИЗМЕРЕНО'}`)
    for (const c of r.checks) console.log('   ' + c)
    for (const n of r.notes) console.log('   · ' + n)
  }
  const m = out.filter(r => r.status !== 'unmeasured')
  console.log(`ИТОГ ${probe}: зелёных ${m.filter(r => r.status === 'green').length} из ${m.length}; не измерено ${out.length - m.length}`)
  return out
}

// ── самопроверка ──────────────────────────────────────────────────────────────────────────────────────────────
function selftest() {
  const root = join(tmpdir(), `grade-reh-selftest-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  const seed = join(HERE, 'fixtures', 'REH-SHT', 'seed')
  const S = 'coddoc/SHT-410/technical_specification.md'
  const Q = [
    ['Почему без кэша — выдержит ли служба пропусков пик?', `${S}:68 — «Проверка идёт при каждой записи, сразу, без кэша»`],
    ['Как вы попадёте в службу пропусков, кто выдаст доступ?', `${S}:86 — «способ авторизации бэка шаттла не подтверждён»`],
    ['Пропуск заблокировали после записи — запись остаётся?', `${S}:50 — «запись создаётся только при пропуске в»`],
    ['Кто меняет отметку велосипеда, когда шаттл заменят?', `${S}:172 — «Значения true проставляет транспортная служба скриптом один раз при выкате»`],
    ['Почему офис не взять из службы пропусков?', `services/badge-service.md:23 — «GET /api/v3/badges?holderLogin={login}»`],
  ]
  const mk = (name, { answers, replies, uses, block }) => {
    const sb = join(root, name)
    mkdirSync(join(sb, '_twin'), { recursive: true })
    cpSync(seed, sb, { recursive: true })
    const files = []
    const walk = (d, rel) => { for (const f of readdirSync(d)) { const p = join(d, f); const r = rel ? `${rel}/${f}` : f; statSync(p).isDirectory() ? walk(p, r) : files.push(r) } }
    walk(sb, '')
    writeFileSync(join(sb, '_seeded.txt'), files.filter(f => !f.startsWith('_twin')).sort().join('\n') + '\n')
    answers.forEach((t, i) => writeFileSync(join(sb, `answer-${String(i + 1).padStart(2, '0')}.md`), t))
    replies.forEach((t, i) => writeFileSync(join(sb, '_twin', `reply-${String(i + 2).padStart(2, '0')}.txt`), t))
    const ev = []
    uses.forEach((u, i) => ev.push(JSON.stringify({ type: 'assistant', parent_tool_use_id: u.sub ? 'p' : null, message: { content: [{ type: 'tool_use', id: `t${i}`, name: u.name, input: u.input }] } })))
    const ai = uses.findIndex(u => u.name === 'Agent')
    if (ai >= 0) ev.push(JSON.stringify({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: `t${ai}`, content: [{ type: 'text', text: block }] }] } }))
    writeFileSync(join(sb, 'stream.jsonl'), ev.join('\n') + '\n')
    return sb
  }
  const blockOf = qs => '## ВОПРОСЫ\n' + qs.map(([q, o], i) => `${i + 1}. ${q}\n   опора: ${o}`).join('\n')
  const ask = (i, n = 5, pre = '') => `${pre}${i + 1}/${n}. ${Q[i][0]}\nОпора: ${Q[i][1]}`
  const goodUses = [
    { name: 'Glob', input: { pattern: 'brief.md', path: '/tmp/skill-eval-seed/x/rehearse/reference' } },
    { name: 'Agent', input: { prompt: 'Документ: ' + S } },
    { name: 'Read', sub: true, input: { file_path: 'C:/x/' + S } },
    { name: 'Read', input: { file_path: 'C:/x/' + S, offset: 66, limit: 5 } },
  ]
  const summary = (r, v, s, k = 5, n = 5) => `Репетиция: ${S}, роль — архитектор. Задано вопросов: ${k} из ${n}.\n\nРешить до встречи:\n` +
    (r ? Array.from({ length: r }, (_, i) => `${i + 1}. вопрос — ${S}:86`).join('\n') : '—') + '\n\nВписать в документ:\n' +
    (v ? Array.from({ length: v }, (_, i) => `${i + 1}. вопрос — ваш ответ: так — ${S}:172`).join('\n') : '—') + `\n\nСнято: ${s} — ответ в документе есть или посылка неверна.\n`
  const good = {
    answers: [ask(0, 5, 'Я — архитектор. Задам 5 вопросов по одному. Скажете «хватит» — сразу итог.\n\n'), ask(1), ask(2), 'Конкретнее: кто и когда снимает такую запись?', ask(3), ask(4), summary(2, 1, 2)],
    replies: ['Это есть в спеке, §5.1.', 'Не знаю, уточню у команд-владельцев.', 'Ну, это как-нибудь решим.', 'Не знаю, это не обсуждали.',
      'Транспортная служба присылает заявку, поддержка меняет поле тем же скриптом. Экран не нужен: шаттлы меняют раз в квартал.',
      'Нет, служба пропусков такого не умеет: у неё только чтение пропуска по номеру и по логину.', 'Спасибо, всё.'],
    uses: goodUses, block: blockOf(Q),
  }
  const cases = []
  const t = (name, probe, spec, expect) => cases.push({ name, probe, sb: mk(name, spec), expect })
  t('good', 'reh-arch', good, { status: 'green' })
  t('bad', 'reh-arch', {
    ...good,
    answers: [ask(0, 5, 'Я — архитектор.\n\n') + '\n\n' + ask(1).replace('способ авторизации', 'способ входа'), ask(2), 'Конкретнее?', ask(3), ask(4), summary(1, 1, 2)],
    replies: ['Не знаю, уточню.', 'Ну, это как-нибудь решим.', 'Не знаю, это не обсуждали.', 'Транспортная служба присылает заявку.', 'Нет, служба пропусков такого не умеет.', 'Спасибо, всё.'],
    uses: [...goodUses, { name: 'Read', input: { file_path: 'C:/x/' + S } }],
  }, { status: 'red', fails: ['ведущий документ не читал', 'по одному вопросу', 'опоры показаны', 'группы сходятся'] })
  t('nofollow', 'reh-arch', {
    ...good,
    answers: [ask(0, 5, 'Я — архитектор.\n\n'), ask(1), ask(2), ask(3), ask(4), summary(2, 1, 2)],
    replies: ['Это есть в спеке, §5.1.', 'Не знаю, уточню.', 'Ну, это как-нибудь решим.', 'Транспортная служба присылает заявку.', 'Нет, служба пропусков такого не умеет.', 'Спасибо, всё.'],
  }, { status: 'red', fails: ['уточнение на уклончивый'] })
  t('stop', 'reh-stop', {
    ...good,
    answers: [ask(0, 5, 'Я — архитектор.\n\n'), ask(1), ask(2), summary(1, 0, 1, 3, 5)],
    replies: ['Это есть в спеке, §5.1.', 'Не знаю, уточню.', 'Хватит, давай итог.', 'Спасибо, всё.'],
  }, { status: 'green' })
  t('odd', 'reh-arch', {
    ...good,
    answers: [ask(0, 5, 'Я — архитектор.\n\n'), ask(1), ask(2), 'Конкретнее?', ask(3), ask(4), summary(3, 1, 1)],
    replies: ['да, всё в текущей папке', 'Не знаю, уточню.', 'Ну, это как-нибудь решим.', 'Не знаю, это не обсуждали.', 'Транспортная служба присылает заявку.', 'Нет, служба пропусков такого не умеет.', 'Спасибо, всё.'],
  }, { status: 'green' })
  t('noise', 'reh-arch', {
    ...good,
    answers: [ask(0, 5, 'Я — архитектор.\n\n'), ask(1), ask(2), 'Конкретнее?', '2/5 принят → следующий.\n\n' + ask(3), ask(4), summary(2, 2, 1)],
    replies: ['Это есть в спеке, §5.1. Хотя нет — по карточке: Не знаю, уточню.', 'Не знаю, уточню у команд-владельцев.', 'Ну, это как-нибудь решим.', 'Не знаю, это не обсуждали.',
      'Транспортная служба присылает заявку, поддержка меняет поле тем же скриптом. Экран не нужен: шаттлы меняют раз в квартал.',
      'Нет, служба пропусков такого не умеет: у неё только чтение пропуска по номеру и по логину.', 'Спасибо, всё.'],
  }, { status: 'green' })
  t('escape', 'reh-arch', { ...good, uses: [...goodUses, { name: 'Read', input: { file_path: 'C:/repo/agent-version/_skill-eval/fixtures/REH-SHT/twin-arch.md' } }] }, { status: 'unmeasured' })
  t('write', 'reh-arch', { ...good, uses: [...goodUses, { name: 'Write', input: { file_path: 'C:/x/notes.md' } }] }, { status: 'red', fails: ['файлов не записано'] })

  let okAll = true
  for (const c of cases) {
    const r = gradeRun(c.sb, c.probe)
    const failsOk = (c.expect.fails || []).every(f => r.checks.some(x => x.startsWith('✘') && x.includes(f)))
    const pass = r.status === c.expect.status && failsOk
    if (!pass) okAll = false
    console.log(`${pass ? 'OK  ' : 'FAIL'} ${c.name}: ${r.status}${pass && c.name !== 'good' ? '' : '\n   ' + r.checks.join('\n   ') + '\n   · ' + r.notes.join('\n   · ')}`)
  }
  rmSync(root, { recursive: true, force: true })
  console.log(okAll ? `selftest: ${cases.length}/${cases.length}` : 'selftest: ЕСТЬ ПРОВАЛЫ')
  process.exit(okAll ? 0 : 1)
}

const args = process.argv.slice(2)
if (args[0] === '--selftest') selftest()
else if (!args.length) { console.error('usage: node grade-reh.mjs <папка-плеча> … | --selftest'); process.exit(1) }
else for (const d of args) gradeArm(d)
