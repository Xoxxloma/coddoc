#!/usr/bin/env node
// peak-ctx.mjs — пик контекста ведущего и каждого субагента по `_stream.jsonl` прогона.
//
//   node peak-ctx.mjs <папка-раунда | _stream.jsonl> [ещё…]
//
// Контекст хода = input_tokens + cache_creation_input_tokens + cache_read_input_tokens из
// message.usage; пик — максимум по ходам. Ведущий — события без parent_tool_use_id, субагент —
// с ним (подпись — task_description). Ещё по ведущему: Read по services/.work/ и вызовы Bash.
// Числа — токены модели стенда, не прода.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const streams = []
for (const a of process.argv.slice(2)) {
  if (a.endsWith('.jsonl')) { streams.push(a); continue }
  const sb = join(a, 'sandbox')
  if (!existsSync(sb)) continue
  for (const d of readdirSync(sb).sort()) {
    const f = join(sb, d, '_stream.jsonl')
    if (statSync(join(sb, d)).isDirectory() && existsSync(f)) streams.push(f)
  }
}
for (const f of streams) {
  const subs = new Map(); let lead = 0, readWork = 0, bash = 0
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e; try { e = JSON.parse(line) } catch { continue }
    if (e.type !== 'assistant' || !e.message) continue
    const u = e.message.usage || {}
    const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0)
    if (e.parent_tool_use_id) {
      const s = subs.get(e.parent_tool_use_id) || { desc: e.task_description || '?', peak: 0 }
      s.peak = Math.max(s.peak, ctx); subs.set(e.parent_tool_use_id, s)
      continue
    }
    lead = Math.max(lead, ctx)
    for (const c of e.message.content || []) {
      if (c.type !== 'tool_use') continue
      if (c.name === 'Bash') bash++
      if (c.name === 'Read' && /[\\/]\.work[\\/]/.test(String(c.input?.file_path || ''))) readWork++
    }
  }
  console.log(`${f}\n  ведущий: пик ${lead}, Read .work ${readWork}, Bash ${bash}`)
  for (const s of subs.values()) console.log(`  субагент «${s.desc}»: пик ${s.peak}`)
}
