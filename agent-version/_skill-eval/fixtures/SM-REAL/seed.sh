#!/usr/bin/env bash
# seed.sh — собирает песочницу пробы `sm-real` из РЕАЛЬНЫХ реп пользователя.
#
#   ./seed.sh <куда> <first|scan>
#
# Фикстура своего дерева не держит намеренно: она про то, как скилл ведёт себя на настоящем
# коде, а копия 424 файлов в репозитории стенда была бы вторым источником правды и разъехалась
# бы с оригиналом на первом же коммите в repairy. Дерево собирается из источников на каждый
# прогон; источники при этом ТОЛЬКО ЧИТАЮТСЯ.
#
# Раскладка (соседи лежат РЯДОМ со спек-репой, а не внутри неё):
#
#   <куда>/
#   ├── AI-SDD/                     ← рабочая директория прогона
#   │   └── services/manifest.yaml  ← только в плече `scan`
#   ├── repairy-api/    backend   ← цель скана
#   ├── repairy-web/    frontend  ← цель скана
#   ├── resonance-api/  backend
#   └── resonance-web/  frontend  ← `.git` ФАЙЛОМ: worktree-форма
#
# `resonance-web` в worktree-форме — сторож одного дефекта: Шаг 1.1 требует ДВА глоба
# (`**/.git/HEAD` для обычного клона и `**/.git` для worktree), Шаг 2.1 называет только первый.
# Обычный клон находится файлом внутри папки `.git`, worktree — самим файлом `.git`, поэтому
# прогон с одним глобом теряет ровно этот сервис. Целью скана он не является: его потеря видна
# числом и ничего другого в замере не портит.
set -u

DEST="${1:?куда: путь к песочнице}"
ARM="${2:?плечо: first | scan | rescan | keyed | front}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="${SM_REAL_SRC:-/c/Users/Konstantin/projects}"

REPAIRY="$SRC_ROOT/repairy"
RESONANCE="$SRC_ROOT/resonance"
WEBAPPSHOP="$SRC_ROOT/webAppShop"
# Источники — только те, что плечо копирует.
if [ "$ARM" = front ]; then NEED=("$RESONANCE/backend" "$RESONANCE/frontend" "$WEBAPPSHOP")
else NEED=("$REPAIRY/apps/api" "$REPAIRY/apps/web" "$RESONANCE/backend" "$RESONANCE/frontend"); fi
for d in "${NEED[@]}"; do
  [ -d "$d" ] || { echo "нет источника: $d"; exit 1; }
done

# Мусор сборки и зависимости не едут: они не код сервиса, а на слабой модели съедают окно.
# `.env` ЕДЕТ НАМЕРЕННО — правило «секреты не копируются» проверяется только там, где секреты есть.
EXCL="--exclude=node_modules --exclude=dist --exclude=dist.zip --exclude=dev-dist
--exclude=.next --exclude=.turbo --exclude=.git --exclude=coverage
--exclude=playwright-report --exclude=test-results --exclude=.playwright-mcp
--exclude=report.html --exclude=*.log --exclude=@repairy"

copy() {  # copy <откуда> <куда>
  local from="$1" to="$2"
  mkdir -p "$to"
  # shellcheck disable=SC2086
  ( cd "$from" && tar cf - $EXCL . ) | ( cd "$to" && tar xf - )
}

rm -rf "$DEST"
mkdir -p "$DEST/AI-SDD"

# Плечо `front` (KEY-FRONT.md): типы, которых другие плечи не дают, — два фронта, fullstack, бэкенд с
# клиентской спекой соседа (синтетика в front/) и мелкий бэкенд. Свой манифест, все пять — целями скана.
if [ "$ARM" = front ]; then
  copy "$RESONANCE/backend"       "$DEST/resonance-api"
  copy "$RESONANCE/frontend"      "$DEST/resonance-web"
  copy "$WEBAPPSHOP"              "$DEST/webapp-shop"
  rm -rf "$DEST/webapp-shop/build"   # собранный бандл — не код сервиса
  copy "$HERE/front/skydesk"      "$DEST/skydesk"
  copy "$HERE/front/dome-control" "$DEST/dome-control"
  for s in resonance-api resonance-web webapp-shop skydesk dome-control; do
    mkdir -p "$DEST/$s/.git"
    echo "ref: refs/heads/main" > "$DEST/$s/.git/HEAD"
  done
  mkdir -p "$DEST/AI-SDD/services"
  cp "$HERE/manifest-front.yaml" "$DEST/AI-SDD/services/manifest.yaml"
  echo "песочница собрана: $DEST   плечо: $ARM"
  for s in resonance-api resonance-web webapp-shop skydesk dome-control; do
    printf '  %-14s %4s файлов\n' "$s" "$(find "$DEST/$s" -type f -not -path '*/.git/*' | wc -l)"
  done
  exit 0
fi

copy "$REPAIRY/apps/api"    "$DEST/repairy-api"
copy "$REPAIRY/apps/web"    "$DEST/repairy-web"
copy "$RESONANCE/backend"   "$DEST/resonance-api"
copy "$RESONANCE/frontend"  "$DEST/resonance-web"

# Патч кода поверх засева — «маленькая фича» для плеча keyed (SM_REAL_PATCH, пути вида a/repairy-api/…).
# Источники не трогаются: патч ложится только на копию в песочнице.
if [ -n "${SM_REAL_PATCH:-}" ]; then
  ( cd "$DEST" && patch -p1 -s < "$SM_REAL_PATCH" ) || { echo "патч не лёг: $SM_REAL_PATCH"; exit 1; }
  find "$DEST" -name "*.orig" -delete
  echo "патч наложен: $(basename "$SM_REAL_PATCH")"
fi

# Маркер репозитория. Без него `Glob **/.git/HEAD` не найдёт кандидатов и мерить будет нечего.
# Заводится файлами, а не `git init`: скилл сам git не запускает и в `.git` не заглядывает —
# для него это просто признак «отдельный репозиторий, а не случайная папка рядом».
for s in repairy-api repairy-web resonance-api; do
  mkdir -p "$DEST/$s/.git"
  echo "ref: refs/heads/main" > "$DEST/$s/.git/HEAD"
done
# Worktree-форма: `.git` — ФАЙЛ, и `HEAD` внутри него нет.
printf 'gitdir: ../.gitworktrees/resonance-web\n' > "$DEST/resonance-web/.git"

# SM_REAL_HELLO=1 — ещё один сосед вне манифеста: крошечный сервис, обычный клон. Прогон по
# переданным именам не должен его ни искать, ни называть; прогон без имён — обязан назвать.
if [ -n "${SM_REAL_HELLO:-}" ]; then
  mkdir -p "$DEST/hello-api/src" "$DEST/hello-api/.git"
  echo "ref: refs/heads/main" > "$DEST/hello-api/.git/HEAD"
  cat > "$DEST/hello-api/package.json" <<'EOF'
{
  "name": "hello-api",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.js",
  "scripts": { "start": "node src/index.js" },
  "dependencies": { "express": "^4.19.2" }
}
EOF
  cat > "$DEST/hello-api/src/index.js" <<'EOF'
const express = require('express')

const app = express()
app.get('/hello', (req, res) => res.json({ message: 'Hello, world' }))
app.listen(process.env.PORT || 3000)
EOF
fi

if [ "$ARM" = scan ] || [ "$ARM" = rescan ] || [ "$ARM" = keyed ]; then
  mkdir -p "$DEST/AI-SDD/services"
  cp "$HERE/manifest.yaml" "$DEST/AI-SDD/services/manifest.yaml"
fi

# Плечо `rescan`: поверх манифеста — прежние карточки из SM_RESCAN_CARDS (по умолчанию карточки
# фикстуры BR-REAL). Копия ложится и в `_prev/` рядом с песочницей — с ней сравнивается результат.
# Дата `scanned` сдвигается в прошлое (SM_RESCAN_DATE): с сегодняшней ведущий решает, что карточку
# собрал этот же прогон, и пропускает гард (2026-09-15-rescan, rescan-2).
if [ "$ARM" = rescan ] || [ "$ARM" = keyed ]; then
  PREV="${SM_RESCAN_CARDS:-$HERE/../BR-REAL/services}"
  mkdir -p "$DEST/../_prev"
  for c in repairy-api repairy-web; do
    [ -f "$PREV/$c.md" ] || { echo "нет прежней карточки: $PREV/$c.md"; exit 1; }
    cp "$PREV/$c.md" "$DEST/AI-SDD/services/$c.md"
    cp "$PREV/$c.md" "$DEST/../_prev/$c.md"
    perl -pi -e "s/^scanned: .*/scanned: ${SM_RESCAN_DATE:-2026-06-01}/" "$DEST/AI-SDD/services/$c.md" "$DEST/../_prev/$c.md"
  done
fi

# Лишние карточки слепка (SM_EXTRA_CARDS — папка с *.md): сторож Шага 5 — карточки, с прогоном не
# связанные; их файлы обязаны остаться байт в байт.
if [ -n "${SM_EXTRA_CARDS:-}" ] && [ "$ARM" != first ]; then
  cp "$SM_EXTRA_CARDS"/*.md "$DEST/AI-SDD/services/" || { echo "нет лишних карточек: $SM_EXTRA_CARDS"; exit 1; }
fi

echo "песочница собрана: $DEST   плечо: $ARM"
for s in repairy-api repairy-web resonance-api resonance-web ${SM_REAL_HELLO:+hello-api}; do
  printf '  %-14s %4s файлов  .git: %s\n' "$s" \
    "$(find "$DEST/$s" -type f -not -path '*/.git/*' -not -name .git | wc -l)" \
    "$( [ -d "$DEST/$s/.git" ] && echo папка || echo ФАЙЛ )"
done
