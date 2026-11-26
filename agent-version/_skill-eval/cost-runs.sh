#!/usr/bin/env bash
# cost-runs.sh — цена прогонов раунда: у каждой папки прогона — МАКСИМУМ total_cost_usd по строкам `result`
# её stream*.jsonl. При --resume total_cost_usd накопительный, первый поток несёт несколько одинаковых
# `result`: сумма строк завышала цену в 3.5–5 раз (найдено 2026-10-15).
#   ./cost-runs.sh <каталог раунда или пробы> [...]
# Двойник аналитика (`_twin/twin-*.json`) считается отдельно.
set -u
for d in "$@"; do
  node -e '
    const fs = require("fs"), path = require("path")
    const runs = new Map(); let twin = 0
    const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name)
      if (e.isDirectory()) walk(q)
      else if (/^stream(-\d+)?\.jsonl$/.test(e.name)) {
        for (const line of fs.readFileSync(q, "utf8").split("\n")) {
          if (!line.includes("\"total_cost_usd\"")) continue
          try { const j = JSON.parse(line); if (j.type === "result" && j.total_cost_usd) { const r = path.dirname(q); runs.set(r, Math.max(runs.get(r) || 0, j.total_cost_usd)) } } catch {}
        }
      } else if (/^twin-\d+\.json$/.test(e.name)) {
        try { twin += JSON.parse(fs.readFileSync(q, "utf8")).total_cost_usd || 0 } catch {}
      }
    } }
    walk(process.argv[1])
    const sum = [...runs.values()].reduce((a, b) => a + b, 0)
    console.log(`${process.argv[1]}: $${sum.toFixed(2)} за ${runs.size} прогонов` + (twin ? `, двойник $${twin.toFixed(2)}` : ""))
  ' "$d"
done
