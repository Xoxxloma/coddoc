// br-lib.mjs — общие куски грейдеров `grade-br-var.mjs` и `grade-br-half.mjs` (PLAN-BR-COMB §1).
//
// Раскладка песочницы многоходовой пробы (`run-pool-ctx-v2.sh`): `stream.jsonl` + `answer-01.md` —
// ход 1, `stream-NN.jsonl` + `answer-NN.md` — ход NN, `answer.md` — склейка всех ходов. Диск
// показывает состояние ПОСЛЕ последнего хода, поэтому «на ходе K файла не было» читается из потока
// вызовов этого хода, а не с диска.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit|overloaded_error|Request timed out/i

export const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null)

/** Ход прогона: ответ и поток. Ход 1 — `answer-01.md` (или `answer.md` у одноходового) и `stream.jsonl`. */
export function turn (dir, k) {
  const nn = String(k).padStart(2, '0')
  const answer = read(join(dir, `answer-${nn}.md`)) ?? (k === 1 ? read(join(dir, 'answer.md')) : null)
  const stream = read(join(dir, k === 1 ? 'stream.jsonl' : `stream-${nn}.jsonl`))
  return { answer, stream }
}

export function apiFailed (dir, answers) {
  if (existsSync(join(dir, '_api-failure.txt'))) return true
  return answers.some((a) => a === null || !a.trim() || RE_API_FAILURE.test(a.slice(0, 300)))
}

/** Вызовы, писавшие БТ на этом ходу: Write/Edit/MultiEdit по `business_requirements.md` или Bash с записью в него. */
export function writesBt (stream) {
  if (!stream) return 0
  let n = 0
  for (const line of stream.split('\n')) {
    if (!line.includes('tool_use')) continue
    let o; try { o = JSON.parse(line) } catch { continue }
    const content = o?.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (c?.type !== 'tool_use') continue
      const inp = c.input || {}
      if (['Write', 'Edit', 'MultiEdit'].includes(c.name) && /business_requirements\.md$/.test(String(inp.file_path || ''))) n++
      if (c.name === 'Bash' && /business_requirements\.md/.test(String(inp.command || '')) && /(>|\btee\b|\bcp\b|\bmv\b|sed\s+-i)/.test(String(inp.command || ''))) n++
    }
  }
  return n
}

const MARKS = [['✅', 'ok'], ['⏭', 'skip'], ['❓', 'open'], ['⚠', 'warn']]
/** Реестр гейтов из ответа: { номер гейта → 'ok'|'skip'|'open'|'warn' }. Берётся ПОСЛЕДНИЙ значок строки. */
export function ledger (answer) {
  if (!answer) return null
  const lines = answer.split('\n')
  let from = lines.findIndex((l) => /Реестр/i.test(l))
  if (from < 0) from = 0
  const out = {}
  for (const l of lines.slice(from, from + 40)) {
    const m = l.match(/^\s*(?:[-*]\s*)?\|?\s*(\d{1,2})\s*[.)|]/)
    if (!m) continue
    let last = null; let at = -1
    for (const [ch, v] of MARKS) { const i = l.lastIndexOf(ch); if (i > at) { at = i; last = v } }
    if (last && Number(m[1]) <= 17 && !(m[1] in out)) out[m[1]] = last  // гейты 0–17 (15–17 — с business-requirements-doc 1.2.0)
  }
  return Object.keys(out).length ? out : null
}

/** Секции `### X.Y` файла, где есть TBD или ⚠️. */
export function openSections (text) {
  const res = []
  let cur = null
  for (const l of text.split('\n')) {
    const h = l.match(/^###\s+(\d+\.\d+)/)
    if (h) { cur = h[1]; continue }
    if (/^##\s/.test(l)) cur = null
    if (cur && /TBD|⚠/.test(l) && !res.includes(cur)) res.push(cur)
  }
  return res
}

/** Блоки ответа (через пустую строку) без строк реестра — для поиска вопросов. */
export function questionBlocks (answer) {
  return (answer || '').split(/\n\s*\n/).map((b) => b.split('\n').filter((l) => !/[✅⏭❓]/.test(l)).join('\n')).filter((b) => b.trim())
}

/** Заранее объявленный отказ: «если не укажете — будет TBD» (прод 2). Вариант «Пока не знаю, отложить» — законен. */
export const RE_TBD_PROMISE = /если\s+(?:вы\s+)?не\s+(?:укаж|ответ|назов|уточн|приш)[^\n]{0,120}TBD|TBD[^\n]{0,60}если\s+(?:вы\s+)?не\s+(?:укаж|ответ|назов|уточн)/i

/** Тело раздела «N.M» (заголовок `##`/`###`, с «§» или без) до следующего заголовка уровня ≤ 3. */
export function section (text, num) {
  if (!text) return null
  const lines = text.split('\n')
  const esc = num.replace('.', '\\.')
  const re = new RegExp(`^#{2,4}\\s*§?\\s*${esc}\\.?(\\s|$)`)
  const from = lines.findIndex((l) => re.test(l))
  if (from < 0) return null
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((l) => /^#{1,3}\s/.test(l))
  return (to < 0 ? rest : rest.slice(0, to)).join('\n').trim()
}

/** Раздел по заголовку, номер любой: { num, body } или null. Номер — не опора: пилот 2026-10-07 —
 *  Haiku написал свою нумерацию, и «§4.3 Пользовательские сценарии» засчитался бы как «Бизнес-данные». */
export function sectionByTitle (text, titleRe) {
  if (!text) return null
  const lines = text.split('\n')
  const from = lines.findIndex((l) => /^#{2,4}\s/.test(l) && titleRe.test(l))
  if (from < 0) return null
  const num = (lines[from].match(/^#{2,4}\s*§?\s*(\d+(?:\.\d+)*)/) || [])[1] || null
  const rest = lines.slice(from + 1)
  const to = rest.findIndex((l) => /^#{1,3}\s/.test(l))
  return { num, body: (to < 0 ? rest : rest.slice(0, to)).join('\n').trim() }
}

/** Абзацы ответа с вопросом и список вариантов сразу за таким абзацем — там гипотезы и варианты
 *  ответа (L189–191: токен не идёт «в варианты ответа и в БТ»); пересказ окружения сюда не входит. */
export function askedBlocks (answer) {
  const bs = (answer || '').split(/\n\s*\n/)
  return bs.filter((b, i) => b.includes('?') || (i > 0 && bs[i - 1].includes('?') && /^\s*([-*•]|\d+[.)]|[а-яa-z]\))\s/i.test(b))).join('\n\n')
}

/** Строки без отрицания наличия: «окружение (services/, context/) не найдено» — не ссылка на источник. */
export const dropNegated = (s) => (s || '').split('\n').filter((l) => !/не\s+найден|не\s+нашл|отсутству|нет\s+(ни\s+)?(карточ|окружен|папк|services)|пуст/i.test(l)).join('\n')
