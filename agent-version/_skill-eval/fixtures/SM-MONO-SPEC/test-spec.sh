#!/usr/bin/env bash
# Проверка дерева и области счётчика; моделей не запускает.
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/sm-spec.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT
bash "$HERE/make.sh" "$OUT/base" > "$OUT/base.out"
bash "$HERE/make.sh" "$OUT/client" --with-client > "$OUT/client.out"
R="$OUT/client/casedesk"
cmp "$OUT/base/casedesk/src/main/resources/openapi.yaml" "$R/src/main/resources/openapi.yaml"
grep -q '<inputSpec>.*openapi.yaml</inputSpec><generatorName>spring</generatorName>' "$R/pom.xml"
grep -q '<inputSpec>.*neighbour.yaml</inputSpec><generatorName>java</generatorName>' "$R/pom.xml"
# Как счётчик с дополнительным полем области: path = точный серверный файл, маска = *.yaml.
server=$(grep -cE '^\s+operationId:' "$R/src/main/resources/openapi.yaml")
client=$(grep -cE '^\s+operationId:' "$R/src/main/resources/neighbour.yaml")
broad=$(grep -hE '^\s+operationId:' "$R/src/main/resources/"*.yaml | wc -l | tr -d ' ')
impl=$(grep -rhA1 '@Override' "$R/src/main/java/ru/kontrol/casedesk/v2/"*/web/*DeskApiController.java | grep -cE 'Desk\(')
[ "$server" = 30 ] && [ "$client" = 6 ] && [ "$broad" = 36 ] && [ "$impl" = 28 ]
grep -q 'operationId: listGroupsDesk' "$R/src/main/resources/openapi.yaml"
grep -q 'operationId: listGroupsDesk' "$R/src/main/resources/neighbour.yaml"
! grep -rhE '@(Get|Post|Put|Patch|Delete)Mapping' "$R/src/main/java/ru/kontrol/casedesk/v2/"*/web/*DeskApiController.java | grep -q .
! grep -rhE '(getNeighbourLimit|deleteNeighbourLimit)\(' "$R/src/main/java/ru/kontrol/casedesk/v2/"*/web/*DeskApiController.java | grep -q .
grep -q 'контракт всего: *148' "$OUT/base.out"
grep -q 'контракт всего: *148' "$OUT/client.out"
echo "SM-MONO-SPEC: server=$server, implemented=$impl, client=$client, scoped=$server, broad=$broad — OK"

# --big-spec: 100 операций, 98 реализаций в семи контроллерах без аннотаций маршрутов, по факту-анкеру на метод.
# Здесь каждая проверка валит скрипт сама: под set -e строка `! …` и не последнее звено `&&` не роняют его.
fail() { echo "SM-MONO-SPEC --big-spec: $*" >&2; exit 1; }
bash "$HERE/make.sh" "$OUT/big" --big-spec > "$OUT/big.out"
B="$OUT/big/casedesk"; BC="$B/src/main/java/ru/kontrol/casedesk/v2"; BS="$B/src/main/resources/openapi.yaml"
grep -v '^#' "$HERE/big-spec-key.tsv" | tr -d '\r' > "$OUT/key.tsv"
cut -f8 "$OUT/key.tsv" > "$OUT/anchors.txt"
bops=$(grep -cE '^      operationId:' "$BS")
bimpl=$(grep -rhA1 '@Override' "$BC/"*/web/*DeskApiController.java | grep -cE 'Desk\(')
bctl=$(ls "$BC/"*/web/*DeskApiController.java | wc -l | tr -d ' ')
nkey=$(grep -c . "$OUT/key.tsv")
[ "$bops" = 100 ] || fail "операций в спеке $bops, ждали 100"
[ "$bimpl" = 98 ] || fail "реализаций $bimpl, ждали 98"
[ "$bctl" = 7 ] || fail "контроллеров спеки $bctl, ждали 7"
[ "$nkey" = 98 ] || fail "строк ключа $nkey, ждали 98"
if grep -rhE '@(Get|Post|Put|Patch|Delete|Request)Mapping' "$BC/"*/web/*DeskApiController.java | grep -q .; then fail "в контроллерах спеки аннотации маршрутов"; fi
grep -q 'контракт всего: *218' "$OUT/big.out" || fail "контракт всего не 218: $(grep 'контракт всего' "$OUT/big.out")"
# ключ ↔ спека: глагол, путь и operationId каждой строки ключа есть в спеке; сверх ключа — только две архивные
LC_ALL=C sort <(cut -f3,4,5 "$OUT/key.tsv") > "$OUT/key-ops.txt"
awk '/^  \//{ p = $1; sub(/:$/, "", p) } /^    [a-z]+:$/{ v = toupper($1); sub(/:$/, "", v) } /^      operationId:/{ print v "\t" p "\t" $2 }' "$BS" | LC_ALL=C sort > "$OUT/spec-ops.txt"
[ -z "$(LC_ALL=C comm -23 "$OUT/key-ops.txt" "$OUT/spec-ops.txt")" ] || fail "строки ключа не из спеки: $(LC_ALL=C comm -23 "$OUT/key-ops.txt" "$OUT/spec-ops.txt" | head -3)"
[ "$(LC_ALL=C comm -13 "$OUT/key-ops.txt" "$OUT/spec-ops.txt" | cut -f3 | tr '\n' ' ')" = "getArchiveDesk restoreArchiveDesk " ] || fail "в спеке сверх ключа не две архивные"
# реализованы ровно операции ключа; архивных реализаций нет
[ "$(grep -rhoE '[A-Za-z]+Desk\(' "$BC/"*/web/*DeskApiController.java | tr -d '(' | LC_ALL=C sort | tr '\n' ' ')" = "$(cut -f5 "$OUT/key.tsv" | LC_ALL=C sort | tr '\n' ' ')" ] || fail "методы контроллеров ≠ operationId ключа"
# анкеры: разные, в спеке их нет, в дереве — только в контроллерах спеки и только в методе своей операции
[ -z "$(LC_ALL=C sort -f "$OUT/anchors.txt" | uniq -di)" ] || fail "анкер повторяется"
if grep -qwiF -f "$OUT/anchors.txt" "$BS"; then fail "анкер в openapi.yaml"; fi
[ "$(grep -rliwF -f "$OUT/anchors.txt" "$B" | grep -vc 'DeskApiController\.java$')" = 0 ] || fail "анкер вне контроллеров спеки: $(grep -rliwF -f "$OUT/anchors.txt" "$B" | grep -v 'DeskApiController\.java$' | head -3)"
awk 'NR == FNR { a[$0] = 1; next }
     /public / && match($0, /[A-Za-z0-9_]+Desk\(/) { m = substr($0, RSTART, RLENGTH - 1) }
     { n = split($0, w, /[^A-Za-z0-9_]+/); for (i = 1; i <= n; i++) if (w[i] in a) print m "\t" w[i] }' \
  "$OUT/anchors.txt" "$BC/"*/web/*DeskApiController.java | LC_ALL=C sort -u > "$OUT/anchor-at.txt"
[ "$(cat "$OUT/anchor-at.txt")" = "$(cut -f5,8 "$OUT/key.tsv" | LC_ALL=C sort -u)" ] || fail "анкер не в методе своей операции: $(diff <(cut -f5,8 "$OUT/key.tsv" | LC_ALL=C sort -u) "$OUT/anchor-at.txt" | head -4)"
codes=$(cut -f6 "$OUT/key.tsv" | LC_ALL=C sort | uniq -c | awk '{ printf "%s×%s ", $2, $1 }')
echo "SM-MONO-SPEC --big-spec: operations=$bops, implemented=$bimpl, controllers=$bctl, anchors=$nkey (${codes% }) — OK"
