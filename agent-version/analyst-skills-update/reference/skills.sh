#!/usr/bin/env bash
# skills.sh — установить или обновить скиллы в репозитории со спеками одной командой.
#
#   bash .gigacode/skills/analyst-skills-update/reference/skills.sh                 # → ./.gigacode/skills
#   bash .gigacode/skills/analyst-skills-update/reference/skills.sh .claude/skills  # → другая папка
#
# Клонирует репозиторий со скиллами во временную папку и копирует из его skills/ каждую папку,
# в которой есть SKILL.md, вместе с её reference/, в .gigacode/skills/ репозитория со спеками. Папки на «_» (стенд) и файлы верхнего уровня
# не копирует. Повторный запуск обновляет установленные скиллы на месте, чужие папки не трогает.
# Имена поставленных скиллов записывает в .analyst-skills в папке назначения. Скилл из этого списка, которого
# в наборе больше нет, при следующем запуске удаляет.
#
# Скрипт живёт внутри скилла analyst-skills-update и обновляется вместе с ним. Поскольку при этом
# перезаписывается его собственная папка, он сначала копирует себя во временный файл и работает из него.
# Ставит скиллы не он, а skills.sh из клона: тот получает папку клона в SDD_SKILLS_FROM. Так правка установки
# работает с первого обновления, а не со второго.
#
# Нужны только git и bash. Для Windows рядом skills.ps1 — та же логика; правятся оба файла вместе. Запускать через `bash …`, а не `./…`: в
# корпоративных образах запуск файлов из домашней папки бывает запрещён, а bash читает скрипт как текст.
#
# Адреса репозитория со скиллами заданы ниже один раз: сначала https, при отказе — ssh, для тех, у кого
# нет логина для https, но есть ssh-ключ. SDD_SKILLS_REPO заменяет оба: один или несколько адресов через пробел.
set -euo pipefail

# Папка клона, если нас запустила установленная версия (см. ниже). Клон убирает она.
FROM="${SDD_SKILLS_FROM:-}"
unset SDD_SKILLS_FROM

# Работаем из временной копии: оригинал лежит в папке, которую ниже удалим и перепишем.
# Из клона копия не нужна: клон не перезаписывается.
if [ -z "$FROM" ] && [ -z "${SDD_SKILLS_SELF:-}" ]; then
  SELF="$(mktemp "${TMPDIR:-/tmp}/sdd-skills-self.XXXXXX")"
  cp "$0" "$SELF"
  SDD_SKILLS_SELF="$SELF" exec bash "$SELF" "$@"
fi
SELF="${SDD_SKILLS_SELF:-}"
unset SDD_SKILLS_SELF
trap 'rm -f ${SELF:+"$SELF"}' EXIT

REPOS="${SDD_SKILLS_REPO:-https://api.sc-ci.sber.ru/ai-security-deparment/AI-SDD-SKILLS.git
ssh://sc@api.sc-ci.sber.ru:7998/ai-security-deparment/AI-SDD-SKILLS.git}"
REF="${SDD_SKILLS_REF:-}"            # ветка или тег; пусто — ветка по умолчанию
DEST="${1:-.gigacode/skills}"

command -v git >/dev/null || { echo "нужен git"; exit 1; }

# Агент не ответит ни на запрос пароля https, ни на вопрос ssh «yes/no» про новый хост: клон ждал бы
# ответа вместо перехода к следующему адресу. Свою настройку ssh у пользователя (ключ, plink) не трогаем.
export GIT_TERMINAL_PROMPT=0
if [ -z "${GIT_SSH_COMMAND:-}${GIT_SSH:-}" ] && ! git config --get core.sshCommand >/dev/null; then
  export GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
fi

if [ -n "$FROM" ]; then
  SRC="$FROM"
else
  SRC="$(mktemp -d "${TMPDIR:-/tmp}/sdd-skills.XXXXXX")"
  trap 'rm -rf "$SRC"; rm -f ${SELF:+"$SELF"}' EXIT
  cloned=""
  for repo in $REPOS; do
    echo "скиллы: $repo${REF:+ #$REF}"
    if git clone -q --depth 1 ${REF:+--branch "$REF"} "$repo" "$SRC"; then cloned=1; break; fi
  done
  [ -n "$cloned" ] || { echo "не удалось получить скиллы ни по одному адресу"; exit 1; }
fi
SKILLS="$SRC/skills"
[ -d "$SKILLS" ] || SKILLS="$SRC/.gigacode"
[ -d "$SKILLS" ] || { echo "в репозитории со скиллами нет папки skills/"; exit 1; }

# Ставит skills.sh из клона, а не этот: так правка установки работает с первого обновления.
NEXT="$SKILLS/analyst-skills-update/reference/skills.sh"
if [ -z "$FROM" ] && [ -f "$NEXT" ]; then
  SDD_SKILLS_FROM="$SRC" bash "$NEXT" "$@"
  exit 0
fi

mkdir -p "$DEST"
LIST="$DEST/.analyst-skills"
installed=""
count=0
for dir in "$SKILLS"/*/; do
  name="$(basename "$dir")"
  case "$name" in _*) continue ;; esac
  [ -f "$dir/SKILL.md" ] || continue
  rm -rf "$DEST/$name"
  cp -R "$dir" "$DEST/$name"
  version="$(grep -m1 '^version:' "$dir/SKILL.md" | sed 's/^version:[[:space:]]*//' || true)"
  printf '  %-28s %s\n' "$name" "${version:-—}"
  installed="$installed$name"$'\n'
  count=$((count + 1))
done
[ "$count" -gt 0 ] || { echo "в $(basename "$SKILLS")/ не нашлось ни одной папки со SKILL.md"; exit 1; }
# Скилл из прошлого списка, которого в наборе больше нет, снят: его папка осталась бы и перехватывала вызовы того,
# кто его заменил. Чужих папок в списке нет. Не удалилась — имя остаётся в списке до следующего запуска.
if [ -f "$LIST" ]; then
  while IFS= read -r name || [ -n "$name" ]; do
    name="${name%$'\r'}"
    case "$name" in ''|.*|_*|*/*|*\\*) continue ;; esac
    [ -f "$SKILLS/$name/SKILL.md" ] && continue
    [ -d "$DEST/$name" ] || continue
    if rm -rf "$DEST/$name"; then
      printf '  %-28s %s\n' "$name" "снят из набора, удалён"
    else
      printf '  %-28s %s\n' "$name" "снят из набора, удалить не вышло — удалите папку $DEST/$name"
      installed="$installed$name"$'\n'
    fi
  done < "$LIST"
fi
printf '%s' "$installed" > "$LIST"
echo "установлено в $DEST: $count скиллов; точка входа — analyst-workspace"
