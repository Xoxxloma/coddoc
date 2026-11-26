#!/usr/bin/env bash
# Корпус входов Windows для сверки порта bash ↔ Python (срез П): CRLF, BOM, файл cp1251, путь с пробелом и
# кириллицей. Каждый скрипт — на вариантах входов своих самотестов; вызовы идут через sm_run (SM_RUNNER, SM_REC
# задаёт run.sh). Ожидания тут нет — только записи для compare.py.
#   bash corpus.sh <папка reference>
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$(cd "$HERE/.." && pwd)"
. "$F/sm-run.sh"
REF="${1:?папка reference}"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/sm-corpus.XXXXXX")"; trap 'rm -rf "$OUT"' EXIT
W="$OUT/путь с пробелом"; mkdir -p "$W"
n=0
# вариант <вид> <файл-источник> <файл-цель>: lf — как есть, crlf, bom, cp1251
variant() {
  case "$1" in
    lf) cp "$2" "$3" ;;
    crlf) sed 's/\r$//; s/$/\r/' "$2" > "$3" ;;
    bom) { printf '\357\273\277'; cat "$2"; } > "$3" ;;
    cp1251) iconv -f UTF-8 -t CP1251//TRANSLIT "$2" > "$3" 2>/dev/null || cp "$2" "$3" ;;
  esac
}
call() { n=$((n+1)); sm_run "$@" >/dev/null 2>&1; }

# check: случаи SM-CHECK — с прежней карточкой и без
for c in base-backend cand-tables guard-3of9 guard-prefix messages-quotes frontend-state broker-layer; do
  d="$F/SM-CHECK/cases/$c"; [ -d "$d" ] || continue
  for v in crlf bom cp1251; do
    t="$W/check-$c-$v"; mkdir -p "$t"
    draft="$d/draft.md"; [ -f "$d/.work/draft.md" ] && draft="$d/.work/draft.md"
    variant "$v" "$d/opis.md" "$t/опись.md"; variant "$v" "$draft" "$t/черновик.md"
    if [ -f "$d/prev.md" ]; then variant "$v" "$d/prev.md" "$t/прежняя.md"
      call "$REF/check.py" CHECK_LISTS="$t/перечень.md" "$t/опись.md" "$t/черновик.md" "$t/прежняя.md"
    else call "$REF/check.py" CHECK_LISTS="$t/перечень.md" "$t/опись.md" "$t/черновик.md"; fi
  done
done

# assemble + check по частям: SM-ASSEMBLE-SLOTS
for v in lf crlf bom cp1251; do
  t="$W/asm-$v"; mkdir -p "$t/части"
  for f in "$F/SM-ASSEMBLE-SLOTS/asm/"*; do variant "$v" "$f" "$t/части/$(basename "$f")"; done
  call "$REF/assemble.py" "$t/части" 2 2026-10-21 "$t/карточка.md" "$t/опись.md"
  [ -f "$t/карточка.md" ] && call "$REF/check.py" CHECK_PARTS="$t/части" CHECK_PLAN="$t/части/plan.tsv" CHECK_LISTS="$t/перечень.md" "$t/опись.md" "$t/карточка.md"
done

# plan: дерево по пути с пробелом и кириллицей, счёт в разных кодировках и концах строк
for v in lf crlf bom; do
  t="$W/plan-$v"; R="$t/код сервиса"; mkdir -p "$R/src/a" "$R/src/b" "$R/src/тест"
  printf 'class A {}\n' > "$R/src/a/A.java"; printf 'class B {}\n' > "$R/src/b/B.java"; printf 'class E {}\n' > "$R/src/a/E.java"
  printf 'class T {}\n' > "$R/src/тест/T.java"
  printf '## контракт :: ключ\n%s/src/a/A.java:3\n%s/src/b/B.java:40\n## сущности :: ключ\n%s/src/a/E.java:4\n## контракт :: ориентир\n%s/src/тест/T.java:2\n' "$R" "$R" "$R" "$R" > "$t/счёт.lf"
  variant "$v" "$t/счёт.lf" "$t/счёт.txt"
  call "$REF/plan.py" "$t/счёт.txt" 30 1 "$R" "$t/план.tsv" backend
done

# edges: слепок SM-EDGES-SCRIPT basic в разных концах строк и кодировках
for v in lf crlf bom cp1251; do
  t="$W/edges-$v/services"; mkdir -p "$t"
  for f in "$F/SM-EDGES-SCRIPT/cases/basic/services/"*; do variant "$v" "$f" "$t/$(basename "$f")"; done
  call "$REF/edges.py" "$t" "$t/manifest.yaml"
  call "$REF/edges.py" "$t" "$t/manifest.yaml" --only 'auth, `web`'
done

# promote: черновик в разных концах строк и кодировках, цель — в новой папке с кириллицей
for v in lf crlf bom cp1251; do
  t="$W/promote-$v"; mkdir -p "$t"
  variant "$v" "$F/SM-CHECK/cases/base-backend/draft.md" "$t/черновик.md"
  call "$REF/promote.py" "$t/черновик.md" "$t/новая папка/карточка.md"
done
# коды выхода не 0: нет файла, нет папки, негодный вход
E="$W/ошибки"; mkdir -p "$E/части"; printf 'не счёт\n' > "$E/счёт.txt"; printf '# не часть\n' > "$E/части/head.md"
call "$REF/check.py" "$E/нет описи.md" "$E/нет черновика.md"
call "$REF/check.py" CHECK_PARTS="$E/нет папки" "$F/SM-CHECK/cases/base-backend/opis.md" "$F/SM-CHECK/cases/base-backend/draft.md"
call "$REF/plan.py" "$E/нет счёта.txt" 30 1 "$E"
call "$REF/plan.py" "$E/счёт.txt" 30 1 "$E" "$E/план.tsv"
call "$REF/assemble.py" "$E/части" 1 2026-10-21 "$E/карточка.md" "$E/опись.md"
call "$REF/assemble.py" "$E/нет папки" 1 2026-10-21 "$E/карточка2.md" "$E/опись2.md"
call "$REF/edges.py" "$E/нет папки" "$E/нет манифеста.yaml"
call "$REF/promote.py" "$E/нет черновика.md" "$E/куда.md"
# файлы с NUL (картинки, jar в настоящем репо) под условием файла; K=0
B="$W/бинарные"; mkdir -p "$B/src/web" "$B/src/img" "$B/src/dom"
printf 'class PetController : PetApi {\n    override fun a() = 1\n\000\001\002 bin\n    override fun b() = 2\n}\n' > "$B/src/web/PetController.kt"
printf '\211PNG\r\n\032\n\000\000\000 override fun x : PetApi\n\000' > "$B/src/img/logo.kt"
printf 'class Money {\n    override fun toString() = "m"\n}\n\000' > "$B/src/dom/Money.kt"
printf '## контракт :: ^\\s+override fun\\b :: *.kt :: в файлах с :\\s*\\w+Api\\b :: ключ\n%s/src/web/PetController.kt:2\n%s/src/img/logo.kt:1\n%s/src/dom/Money.kt:1\n' "$B" "$B" "$B" > "$B/счёт.txt"
call "$REF/plan.py" "$B/счёт.txt" 30 1 "$B" "$B/план.tsv" backend
call "$REF/plan.py" "$B/счёт.txt" 0 1 "$B" "$B/план0.tsv" backend
# обратный слэш в значении, которое bash отдавал через `awk -v` (заголовок секции головы у склейки)
X="$W/слэш"; mkdir -p "$X/части"; cp "$F/SM-ASSEMBLE-SLOTS/asm/"* "$X/части/"
sed -i 's/^## Публичный контракт$/## Публичный контракт \\t и \\\\ слэш/' "$X/части/head.md"
call "$REF/assemble.py" "$X/части" 2 2026-10-21 "$X/карточка.md" "$X/опись.md"
# нечитаемая папка дерева (листинг запрещён ACL): у Python новая строка «не прочитано N», код и остальное — прежние;
# нечитаемый файл из счёта оба скрипта называют «путей нет на диске» (ОТКАЗ, код 3) — не молча
if command -v icacls >/dev/null 2>&1; then
  U="$W/нечитаемый"; mkdir -p "$U/src/web" "$U/src/закрыта/внутри"
  printf 'class PetController : PetApi {\n    override fun a() = 1\n}\n' > "$U/src/web/PetController.kt"
  printf 'x\n' > "$U/src/закрыта/внутри/A.kt"; printf 'x\n' > "$U/src/web/Other.kt"
  for i in 1 2 3 4 5 6 7 8 9; do mkdir -p "$U/src/p$i"; printf 'class P%s {}\n' "$i" > "$U/src/p$i/P.kt"; done
  printf '## контракт :: ^\s+override fun\b :: *.kt :: в файлах с :\s*\w+Api\b :: ключ\n%s/src/web/PetController.kt:31\n' "$U" > "$U/счёт.txt"
  L="$(cygpath -w "$U/src/закрыта")"
  MSYS2_ARG_CONV_EXCL='*' icacls "$L" /deny "$USERNAME:(RD)" >/dev/null 2>&1
  call "$REF/plan.py" "$U/счёт.txt" 30 1 "$U" "$U/план.tsv" backend
  MSYS2_ARG_CONV_EXCL='*' icacls "$L" /remove:d "$USERNAME" >/dev/null 2>&1
fi
echo "корпус: вызовов $n"
