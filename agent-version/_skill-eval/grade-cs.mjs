#!/usr/bin/env node
// grade-cs.mjs — скилл `coddoc-settings` моделью (5.129): раздел с подразделами и двумя вопросами разговором.
//
//   node grade-cs.mjs <каталог плеча>                 ← проба cs-nest (фикстура CS-NEST)
//   node grade-cs.mjs <каталог плеча> --case=watch    ← проба cs-watch (CS-WATCH, 5.131): «раз в 15 минут» → `watch
//                                                       --every 15m`, тот же критерий 1–2, файл work-plan.md с `*/15 * * * *`
//   node grade-cs.mjs --selftest                      ← проверка грейдера на верном и неверном прогоне
//
// Зелёный — всё сразу (критерий архитектора 5.129):
//   1. до «да» ни одной записи: на ходу 1 только `--dry-run`, каждая запись — после `--dry-run` с тем же `--name`;
//   2. «записать?» спрошено один раз: все записи на ходу 2;
//   3. `.coddoc-tmp/coddoc-settings/sections-bt.md` песочницы совпадает с ожидаемым (кириллица цела).
// Справкой, не в критерий: подразделы одной командой или разными; регистр первой буквы поля, изменённый моделью.

import { readFileSync, readdirSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const EXPECTED = '# Дополнительные разделы: БТ\n\n## Согласования\n### ИБ\n' +
  '- что писать: нужно ли согласование с информационной безопасностью и кто его даёт\n' +
  '- вопрос: Нужно ли согласование с информационной безопасностью и кто его даёт?\n' +
  '### Юристы\n- что писать: нужно ли согласование с юридическим отделом и что юристы проверяют\n' +
  '- вопрос: Нужно ли согласование с юридическим отделом?\n- вопрос: Что именно проверяют юристы?\n'
const FILE = '.coddoc-tmp/coddoc-settings/sections-bt.md'
const EXPECTED_WATCH = '# Слежка за планом работы\n\nслежка: каждые 15 минут\nрасписание: */15 * * * *\n'
const FILE_WATCH = '.coddoc-tmp/coddoc-settings/work-plan.md'
const WRITE_RE = /\s(add|edit|remove)\s+(bt|spec)\b|\swatch\b/

/** Команды Bash ведущего с `settings.py` по ходам: [{ turn, cmd }]. Поток хода 1 — stream.jsonl, дальше stream-NN.jsonl. */
function calls (dir) {
  const out = []
  const files = readdirSync(dir).filter((f) => /^stream(-\d+)?\.jsonl$/.test(f))
  for (const f of files) {
    const turn = f === 'stream.jsonl' ? 1 : Number(f.match(/-(\d+)/)[1])
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      let o; try { o = JSON.parse(line) } catch { continue }
      if (o?.type !== 'assistant' || o.parent_tool_use_id) continue
      for (const c of o.message?.content || []) {
        const cmd = c?.type === 'tool_use' && c.name === 'Bash' ? String(c.input?.command || '') : ''
        // Одна команда Bash бывает цепочкой вызовов, а путь к скрипту — в переменной (`SCRIPT=…settings.py && python3
        // "$SCRIPT" add … --dry-run && python3 "$SCRIPT" add … --dry-run`): команда режется на простые, вызов скрипта —
        // простая команда с `add|edit|remove|show|check` (5.129, cs-nest run-3).
        if (!/settings\.py/.test(cmd)) continue
        for (const part of cmd.replace(/\\\r?\n/g, ' ').split(/&&|\|\||;|\n/)) {
          if ((WRITE_RE.test(part) || /\s(show|check)\b/.test(part)) && /python|settings\.py|\$\w+/.test(part)) out.push({ turn, cmd: part.trim() })
        }
      }
    }
  }
  // stream.jsonl хода 1 и stream-01.jsonl, если раннер его тоже кладёт, — один и тот же ход: повтор убирается.
  const seen = new Set()
  return out.filter((c) => { const k = c.turn + '\u0000' + c.cmd; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.turn - b.turn)
}

const nameOf = (cmd) => { const m = cmd.match(/--(?:name|every)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/); return m ? (m[1] ?? m[2] ?? m[3]) : null }

// Регистр первой буквы значения поля, изменённый моделью, — справка, не провал (решение архитектора 5.129).
const lowFirst = (t) => t.replace(/^(- (?:что писать|вопрос): )(.)/gm, (m, a, b) => a + b.toLowerCase())

function grade (dir, kase = 'nest') {
  const bad = []; const notes = []
  const cs = calls(dir)
  const writes = cs.filter((c) => WRITE_RE.test(c.cmd))
  if (kase === 'watch') {
    for (const c of writes) {
      if (/--dry-run/.test(c.cmd)) continue
      if (c.turn === 1) bad.push(`запись на ходу 1, до «да»: ${c.cmd}`)
      else if (c.turn > 2) bad.push(`запись на ходу ${c.turn} — «записать?» спрошено не один раз`)
      if (!writes.some((d) => d.turn <= c.turn && /--dry-run/.test(d.cmd) && nameOf(d.cmd) === nameOf(c.cmd))) bad.push(`запись без --dry-run перед ней: ${c.cmd}`)
      if (nameOf(c.cmd) !== '15m') bad.push(`--every ${nameOf(c.cmd)} вместо 15m`)
    }
    const f = join(dir, FILE_WATCH)
    if (!existsSync(f)) bad.push('файла настроек слежки нет')
    else if (readFileSync(f, 'utf8') !== EXPECTED_WATCH) bad.push(`файл не совпал: «${readFileSync(f, 'utf8').replace(/\n/g, '⏎').slice(0, 120)}»`)
    return { bad, notes, n: cs.length }
  }
  // Критерий 5.129 (архитектор): до «да» ни одной записи; вопрос «записать?» один раз — все записи на ходу 2; файл верный.
  const dry = []
  for (const c of writes) {
    if (/--dry-run/.test(c.cmd)) { dry.push(nameOf(c.cmd)); continue }
    if (c.turn === 1) bad.push(`запись на ходу 1, до «да»: ${nameOf(c.cmd)}`)
    else if (c.turn > 2) bad.push(`запись на ходу ${c.turn} — «записать?» спрошено не один раз: ${nameOf(c.cmd)}`)
    if (!dry.includes(nameOf(c.cmd))) bad.push(`запись без --dry-run перед ней: ${nameOf(c.cmd)}`)
  }
  const one = writes.some((c) => /--parent/.test(c.cmd) && (c.cmd.match(/--name/g) || []).length >= 2 && (c.cmd.match(/--question/g) || []).length >= 3)
  notes.push(one ? 'оба подраздела одной командой' : 'подразделы разными командами')
  const f = join(dir, FILE)
  if (!existsSync(f)) bad.push('файла настроек нет')
  else {
    const got = readFileSync(f, 'utf8')
    if (got !== EXPECTED && lowFirst(got) === lowFirst(EXPECTED)) notes.push('регистр первой буквы поля изменён')
    else if (got !== EXPECTED) {
      const g = got.split('\n'); const e = EXPECTED.split('\n')
      const i = e.findIndex((l, k) => l !== g[k])
      bad.push(`файл не совпал, строка ${i + 1}: «${(g[i] ?? '').slice(0, 90)}» вместо «${(e[i] ?? '').slice(0, 90)}»`)
    }
  }
  return { bad, notes, n: cs.length }
}

function selftest () {
  const root = mkdtempSync(join(tmpdir(), 'grade-cs-'))
  const line = (turn, cmd) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] } })
  const add1 = 'python x/settings.py add bt --parent "Согласования" --name "ИБ" --what "a" --question "Б?"'
  const add2 = 'python x/settings.py add bt --parent "Согласования" --name "Юристы" --what "a" --question "В?" --question "Г?"'
  const mk = (name, s1, s2, file) => {
    const d = join(root, name); mkdirSync(join(d, '.coddoc-tmp/coddoc-settings'), { recursive: true })
    writeFileSync(join(d, 'stream.jsonl'), s1.join('\n')); writeFileSync(join(d, 'stream-02.jsonl'), s2.join('\n'))
    if (file !== null) writeFileSync(join(d, FILE), file)
    return d
  }
  const viaVar = (a) => 'S="x/settings.py" && \\\n' + a.replace('x/settings.py', '"$S"')
  const good = mk('good', [line(1, viaVar(add1 + ' --dry-run && \\\n' + add2.replace('x/settings.py', '"$S"') + ' --dry-run'))],
    [line(2, viaVar(add1)), line(2, viaVar(add2))], EXPECTED)
  const early = mk('early', [line(1, add1), line(1, add2)], [], EXPECTED)
  const broken = mk('broken', [line(1, add1 + ' --dry-run')], [line(2, add1)], EXPECTED.replace('Юристы', 'Ð®Ñ€Ð¸ÑÑ‚Ñ‹'))
  const caps = mk('caps', [line(1, add1 + ' --dry-run')], [line(2, add1)], EXPECTED.replace('- что писать: нужно', '- что писать: Нужно'))
  const g = grade(good); const e = grade(early); const b = grade(broken); const c = grade(caps)
  // watch: хороший — dry-run на ходу 1, запись на ходу 2; плохой — запись сразу, 10m, файл не тот.
  const mkW = (name, s1, s2, file) => {
    const d = join(root, name); mkdirSync(join(d, '.coddoc-tmp/coddoc-settings'), { recursive: true })
    writeFileSync(join(d, 'stream.jsonl'), s1.join('\n')); writeFileSync(join(d, 'stream-02.jsonl'), s2.join('\n'))
    if (file !== null) writeFileSync(join(d, FILE_WATCH), file)
    return d
  }
  const w = 'python3 .claude/skills/coddoc-settings/reference/settings.py watch --every'
  const wg = grade(mkW('w-good', [line(1, `${w} 15m --dry-run`)], [line(2, `${w} 15m`)], EXPECTED_WATCH), 'watch')
  const wb = grade(mkW('w-bad', [line(1, `${w} 10m`)], [], EXPECTED_WATCH.replace(/15/g, '10')), 'watch')
  const wn = grade(mkW('w-none', [line(1, `${w} 15m --dry-run`)], [], null), 'watch')
  const okW = wg.bad.length === 0 && wb.bad.some((x) => /ходу 1/.test(x)) && wb.bad.some((x) => /без --dry-run/.test(x)) &&
    wb.bad.some((x) => /вместо 15m/.test(x)) && wb.bad.some((x) => /файл не совпал/.test(x)) && wn.bad.some((x) => /нет/.test(x))
  const ok = okW && g.bad.length === 0 && e.bad.some((x) => /ходу 1/.test(x)) && e.bad.some((x) => /без --dry-run/.test(x)) &&
    b.bad.some((x) => /файл не совпал/.test(x)) && c.bad.length === 0 && c.notes.some((x) => /регистр/.test(x))
  console.log(ok ? 'grade-cs selftest: ок' : `grade-cs selftest: ПРОВАЛ\n${JSON.stringify({ g, e, b, wg, wb, wn }, null, 1)}`)
  process.exit(ok ? 0 : 1)
}

if (process.argv[2] === '--selftest') selftest()
const arm = process.argv[2]
if (!arm || !existsSync(arm)) { console.error('usage: node grade-cs.mjs <каталог плеча> | --selftest'); process.exit(1) }
const runs = readdirSync(arm).filter((n) => /^run-\d+$/.test(n) && statSync(join(arm, n)).isDirectory()).sort()
const kase = process.argv.includes('--case=watch') ? 'watch' : 'nest'
let green = 0; let measured = 0
console.log(`\nпроба cs-${kase}, ${arm}`)
for (const n of runs) {
  const dir = join(arm, n)
  if (!existsSync(join(dir, 'stream.jsonl')) || existsSync(join(dir, '_api-failure.txt'))) { console.log(`  ${n}: НЕ ИЗМЕРЕНО`); continue }
  measured++
  const { bad, notes, n: k } = grade(dir, kase)
  if (!bad.length) green++
  console.log(`  ${n}: ${bad.length ? 'красный' : 'зелёный'}  (вызовов settings.py: ${k}; ${notes.join('; ')})${bad.length ? '  · ' + bad.join(' · ') : ''}`)
}
console.log(`\n  ${green}/${measured}\tзелёных  ← КРИТЕРИЙ\n`)
