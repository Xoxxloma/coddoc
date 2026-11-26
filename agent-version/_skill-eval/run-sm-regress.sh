#!/usr/bin/env bash
# run-sm-regress.sh <папка-раунда> — постоянный регресс `service-map` 2.0: дешёвый, без инструментов.
#
#   ./run-sm-regress.sh runs/<дата>-regress            # ≈ $4, ~10 минут
#
# Что входит и почему (решение 22.09.2026, после аудита 2.0):
#   sm-gate   SM-GATE, 21 двойник × 3, sonnet    — гейт «Бизнес-правила», включая «валидацию по внешней системе» (t) и «поля в одну строку» (u)
#   sm-guard  SM-GUARD, 10 случаев × 3, sonnet    — формула гарда-маршрутизатора
#   sm-guard  SM-GUARD, 10 случаев × 3, haiku     — та же формула на прокси прод-модели
#   sm-lead   SM-FIELD/LEAD, 3 случая × 3, sonnet — решения ведущего: обрыв субагента, второй обрыв, текст добора
#   sm-ent    SM-ENT, 4 случая × 3, sonnet и haiku — сущности: сверка сверху и «Сущности у ручек» (2.2.0)
# Не входит: SM-ADV (53 случая) и SM-FIELD gate/guard — разовый аудит 21.09, ожидания под гейт/хвост;
# плечи на живом коде (SM-REAL scan/rescan, SM-ADV R1/R2/R6) — гоняются при правке гарда, маркеров или брифа,
# см. runs/2026-09-21-r5-criteria.md за критериями.
set -u
ROUND="${1:?папка раунда}"; SKILL="${SKILL_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../service-map" && pwd)/SKILL.md}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$ROUND"
echo "=== sm-gate (sonnet) ==="; SM_MODEL=claude-sonnet-5 bash "$HERE/run-sm-gate.sh" "$SKILL" "$ROUND" 3 | tail -1
echo "=== sm-guard (sonnet) ==="; SM_MODEL=claude-sonnet-5 bash "$HERE/run-sm-guard.sh" "$SKILL" "$ROUND" 3 | tail -1
echo "=== sm-guard (haiku) ==="; SM_MODEL=claude-haiku-5-5 SM_OUT=sm-guard-haiku bash "$HERE/run-sm-guard.sh" "$SKILL" "$ROUND" 3 | tail -1
echo "=== sm-lead (sonnet) ==="; SM_MODEL=claude-sonnet-5 bash "$HERE/run-sm-lead.sh" "$SKILL" "$ROUND" 3 | tail -1
echo "=== sm-ent (sonnet) ==="; SM_MODEL=claude-sonnet-5 bash "$HERE/run-sm-ent.sh" "$SKILL" "$ROUND" 3 | tail -1
echo "=== sm-ent (haiku) ==="; SM_MODEL=claude-haiku-5-5 SM_OUT=sm-ent-haiku bash "$HERE/run-sm-ent.sh" "$SKILL" "$ROUND" 3 | tail -1
echo; echo "##### ГРЕЙД"
node "$HERE/grade-sm-gate.mjs" "$ROUND/sm-gate" | tail -3
node "$HERE/grade-sm-guard-iso.mjs" "$ROUND/sm-guard" | tail -1
node "$HERE/grade-sm-guard-iso.mjs" "$ROUND/sm-guard-haiku" | tail -1
node "$HERE/fixtures/SM-FIELD/grade-sm-field.mjs" lead "$ROUND/sm-lead" | tail -1
node "$HERE/grade-sm-ent.mjs" "$ROUND/sm-ent" | tail -1
node "$HERE/grade-sm-ent.mjs" "$ROUND/sm-ent-haiku" | tail -1
echo; echo "Зелёный: гейт ≥ 60/63, t и u 3/3 · гард sonnet 30/30 · гард haiku ≥ 28/30 · lead 9/9 · ent sonnet 12/12, haiku ≥ 10/12 (база 22.09: 59/60, 30/30, 29/30, 9/9; ent — с 2.2.0)."
