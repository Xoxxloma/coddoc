#!/usr/bin/env bash
# SM-PLAN-TYPES — plan.py по типу сервиса и клиентская спека; таблица формы keys.py против шаблона.
# Моделей не запускает: дерево с содержимым файлов собирается во временной папке, plan.py — по нему.
#   bash run.sh [папка reference скилла] — печатает ОК или что разошлось. KEEP=1 — не удалять папку.
# Случаи: (а) frontend — «контракт» отброшен, «экраны» в итоге, нарезки нет; (б) backend вес 40 — части,
# fullstack вес 40 — нарезки нет; (в) клиентская спека объявлена — по ней ни «СПЕКА НЕ РАЗМЕЧЕНА», ни строк
# «операция», а неназванная серверная в том же дереве — в сверке; (г) спека не названа никак — «СПЕКА НЕ РАЗМЕЧЕНА» и строки «операция» (страховка серверной);
# (д) серверная `ключ` + клиентская объявлена — «операция» только серверной; (е) тип пустой и без
# аргумента — вывод одинаков; (ж) k_typesecs — как таблица порядка секций card.template.md; (з) условие файла
# `в файлах с` — в итоге только файлы с совпадением, остальное — «вне условия файла», (з2) регэксп не разобран —
# строка вся, (з3) поле условия — не спека; (и) нарезку решает вес ключей, ориентир — нет; (к) условие файла у
# экранов фронта; (л) топики конфига — только из файлов, названных разведчиком (YAML, JSON, `ключ=значение`).
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../sm-run.sh"   # скрипты скилла — через python (sm-run.sh)
REF="${1:-$HERE/../../../service-map-2.0/reference}"
PLAN="$REF/plan.py"
OUT="$(mktemp -d)"; if [ -n "${KEEP:-}" ]; then echo "временная папка: $OUT"; else trap 'rm -rf "$OUT"' EXIT; fi
bad=0
# Временная папка в форме /c/… (TMPDIR порта на Python): при путях Windows в счёте plan печатает их как C:/… —
# строка ищется в обеих формах.
alt() { printf '%s' "$1" | sed -E 's#(^|[^A-Za-z0-9_.])/([a-z])/#\1\U\2:/#g'; }
has() { grep -q -F -- "$1" "$2" || grep -q -F -- "$(alt "$1")" "$2" || { echo "нет строки ($3): $1"; bad=1; }; }
hasnt() { ! grep -q -F -- "$1" "$2" && ! grep -q -F -- "$(alt "$1")" "$2" || { echo "лишняя строка ($3): $1"; bad=1; }; }
count() { local n; n=$(grep -c -- "$1" "$2"); [ "$n" -eq "$3" ] || n=$(grep -c -- "$(alt "$1")" "$2"); [ "$n" -eq "$3" ] || { echo "строк «$1» ($4): $n, ждали $3"; bad=1; }; }

S="$OUT/svc"
mkdir -p "$S/web/src" "$S/api/a" "$S/api/b" "$S/spec" "$S/clients"
printf 'export const routes = [];\n' > "$S/web/src/App.jsx"
printf 'class A {}\n' > "$S/api/a/A.java"; printf 'class B {}\n' > "$S/api/b/B.java"
cat > "$S/spec/server.yaml" <<'EOF'
openapi: 3.0.1
paths:
  /nights:
    get:
      operationId: listNights
  /nights/{id}:
    get:
      operationId: getNight
EOF
cat > "$S/clients/weather-feed.yaml" <<'EOF'
openapi: 3.0.1
paths:
  /forecast:
    get:
      operationId: getForecast
  /cloud-alerts:
    get:
      operationId: getCloudAlerts
  /stations:
    get:
      operationId: getStations
EOF

run() {  # run <имя> <counts> [тип] — вывод в <имя>.out, план в <имя>.tsv
  local name="$1" counts="$2"; shift 2
  sm_run "$PLAN" "$counts" 30 1 "$S" "$OUT/$name.tsv" "$@" > "$OUT/$name.out" 2>&1
}

# (а) frontend: роуты, названные «контрактом», отброшены; «экраны» — в итоге; нарезки нет
cat > "$OUT/front.txt" <<EOF
## контракт :: \.get\( :: *.jsx :: ключ
$S/web/src/App.jsx:24
## экраны :: <Route\b :: *.jsx :: ключ
$S/web/src/App.jsx:9
## контроль :: контракт :: $S/web/src/App.jsx :: 24
EOF
run front "$OUT/front.txt" frontend
has "итог по классам: экраны 9" "$OUT/front.out" "а"
has "класс контракт: у типа frontend секции нет — пометок 24, не считаются" "$OUT/front.out" "а"
has "нарезка не нужна: тип frontend не режется" "$OUT/front.out" "а"
hasnt "УЗКИЙ МАРКЕР" "$OUT/front.out" "а"
count '^итог	контракт' "$OUT/front.tsv" 0 "а"
count '^итог	экраны	9' "$OUT/front.tsv" 1 "а"

# (а2) frontend и спеки в дереве: операции спеки — ключи контракта, у фронта их не ищут вовсе — ни
# «СПЕКА НЕ РАЗМЕЧЕНА», ни строк «операция», даже если разведчик назвал спеку «контрактом»
cat > "$OUT/front-spec.txt" <<EOF
## контракт :: ^\s+operationId: :: *.yaml :: $S/spec/server.yaml :: ключ
$S/spec/server.yaml:2
## экраны :: <Route\b :: *.jsx :: ключ
$S/web/src/App.jsx:9
EOF
run front-spec "$OUT/front-spec.txt" frontend
hasnt "СПЕКА НЕ РАЗМЕЧЕНА" "$OUT/front-spec.out" "а2"
count '^операция' "$OUT/front-spec.tsv" 0 "а2"
has "класс контракт: у типа frontend секции нет — пометок 2, не считаются" "$OUT/front-spec.out" "а2"

# (б) backend вес 40 — части; fullstack вес 40 — нарезки нет
cat > "$OUT/heavy.txt" <<EOF
## контракт :: @GetMapping\b :: *.java :: ключ
$S/api/a/A.java:20
$S/api/b/B.java:20
EOF
run heavy-back "$OUT/heavy.txt" backend
has "вес сервиса 40 при K=30" "$OUT/heavy-back.out" "б backend"
run heavy-full "$OUT/heavy.txt" fullstack
has "нарезка не нужна: тип fullstack не режется (вес 40)" "$OUT/heavy-full.out" "б fullstack"
count '^часть' "$OUT/heavy-full.tsv" 0 "б fullstack"

# (в) клиентская спека объявлена — не сверяется; серверная в том же дереве не названа — страховка остаётся
cat > "$OUT/client.txt" <<EOF
## контракт :: @GetMapping\b :: *.java :: ключ
$S/api/a/A.java:2
## клиентская спека :: $S/clients/weather-feed.yaml
EOF
run client "$OUT/client.txt" backend
hasnt "weather-feed.yaml" "$OUT/client.out" "в"
has "СПЕКА НЕ РАЗМЕЧЕНА: $S/spec/server.yaml" "$OUT/client.out" "в"
count '^операция' "$OUT/client.tsv" 2 "в"
count 'getForecast' "$OUT/client.tsv" 0 "в"
has "итог по классам: контракт 2" "$OUT/client.out" "в"

# (г) спека не названа никак — страховка: предупреждение и все операции дерева в сверку
cat > "$OUT/silent.txt" <<EOF
## контракт :: @GetMapping\b :: *.java :: ключ
$S/api/a/A.java:2
EOF
run silent "$OUT/silent.txt" backend
has "СПЕКА НЕ РАЗМЕЧЕНА" "$OUT/silent.out" "г"
count '^операция' "$OUT/silent.tsv" 5 "г"

# (д) серверная `ключ` + клиентская объявлена — операции только серверной
cat > "$OUT/both.txt" <<EOF
## контракт :: ^\s+operationId: :: *.yaml :: $S/spec/server.yaml :: ключ
$S/spec/server.yaml:2
## клиентская спека :: $S/clients/weather-feed.yaml
EOF
run both "$OUT/both.txt" backend
count '^операция' "$OUT/both.tsv" 2 "д"
count 'getForecast' "$OUT/both.tsv" 0 "д"

# (е) без типа и с пустым типом — один и тот же вывод (поведение до правки: классы все, нарезка по весу)
run notype "$OUT/heavy.txt"; run emptytype "$OUT/heavy.txt" ""
cmp -s "$OUT/notype.out" "$OUT/emptytype.out" || { echo "е: вывод без типа и с пустым типом различается"; bad=1; }
has "вес сервиса 40 при K=30" "$OUT/notype.out" "е"

# (з) условие файла: метод реализации сгенерированного интерфейса своей пометки не имеет — строка разведчика
# ловит любое переопределение, а `в файлах с` оставляет файлы, где класс реализует интерфейс на `Api`
S2="$OUT/gen"; mkdir -p "$S2/src/web" "$S2/src/domain"
cat > "$S2/src/web/PetController.kt" <<'EOF'
class PetController(private val pets: PetService) : PetApi {
    override fun listPets(): ResponseEntity<List<Pet>> = ok(pets.all())
    override fun getPet(id: Long): ResponseEntity<Pet> = ok(pets.one(id))
    override fun deletePet(id: Long): ResponseEntity<Unit> { pets.drop(id); return noContent() }
}
EOF
cat > "$S2/src/domain/Money.kt" <<'EOF'
data class Money(val v: Long) : Comparable<Money> {
    override fun compareTo(other: Money) = v.compareTo(other.v)
    override fun toString() = "$v"
}
EOF
printf '@Entity\nclass Pet\n' > "$S2/src/domain/Pet.kt"
cat > "$OUT/gen.txt" <<EOF
## сущности :: ^@Entity :: *.kt :: ключ
$S2/src/domain/Pet.kt:1
## контракт :: ^\s+override fun\b :: *.kt :: в файлах с :\s*\w+Api\b :: ключ
$S2/src/web/PetController.kt:3
$S2/src/domain/Money.kt:2
EOF
sm_run "$PLAN" "$OUT/gen.txt" 30 1 "$S2" "$OUT/gen.tsv" backend > "$OUT/gen.out" 2>&1
has "итог по классам: сущности 1, контракт 3" "$OUT/gen.out" "з"
has "вне условия файла: контракт 2 в файлах 1" "$OUT/gen.out" "з"
count "^файл	$S2/src/web/PetController.kt	контракт	3	" "$OUT/gen.tsv" 1 "з"
count 'Money\.kt' "$OUT/gen.tsv" 0 "з"
# (з2) регэксп условия grep не разобрал — строка считается вся, строкой в вывод
sed 's/в файлах с .* :: ключ$/в файлах с (PetApi :: ключ/' "$OUT/gen.txt" > "$OUT/gen2.txt"
sm_run "$PLAN" "$OUT/gen2.txt" 30 1 "$S2" "$OUT/gen2.tsv" backend > "$OUT/gen2.out" 2>&1
has "итог по классам: сущности 1, контракт 5" "$OUT/gen2.out" "з2"
has "условие файла не разобрано: (PetApi — строка счёта целиком" "$OUT/gen2.out" "з2"
hasnt "вне условия файла" "$OUT/gen2.out" "з2"
# (з3) поле условия — не файл спецификации: спека в дереве по-прежнему не названа
mkdir -p "$S2/src/main/resources"; cp "$S/spec/server.yaml" "$S2/src/main/resources/pets.yaml"
sm_run "$PLAN" "$OUT/gen.txt" 30 1 "$S2" "$OUT/gen3.tsv" backend > "$OUT/gen3.out" 2>&1
has "СПЕКА НЕ РАЗМЕЧЕНА: $S2/src/main/resources/pets.yaml" "$OUT/gen3.out" "з3"
has "вне условия файла: контракт 2 в файлах 1" "$OUT/gen3.out" "з3"
# (з4) строка `ориентир` с условием файла: файлы без совпадения отбрасываются молча — в итог счётчика ориентир не
# идёт, и в строку «вне условия файла» (её ведущий прибавляет к итогу `ключ`) он не попадает
sed 's/ :: ключ$/ :: ориентир/' "$OUT/gen.txt" | sed 's/^## сущности :: \(.*\) :: ориентир$/## сущности :: \1 :: ключ/' > "$OUT/gen4.txt"
sm_run "$PLAN" "$OUT/gen4.txt" 30 1 "$S2" "$OUT/gen4.tsv" backend > "$OUT/gen4.out" 2>&1
has "итог по классам: сущности 1 | ориентир: контракт 3" "$OUT/gen4.out" "з4"
hasnt "вне условия файла" "$OUT/gen4.out" "з4"

# (м) путь операции — с базовым путём спецификации: OpenAPI 3 — путь из `servers: - url:` (хост отбрасывается),
# Swagger 2 — `basePath`; без базового пути — как в `paths`
S5="$OUT/base"; mkdir -p "$S5/docs" "$S5/v2" "$S5/plain"
cat > "$S5/docs/api.yaml" <<'EOF'
openapi: 3.0.0
servers:
  - description: dev
    url: http://localhost:9000/api
paths:
  /campaigns/{id}/archive:
    put:
      operationId: updateCampaignArchive
EOF
cat > "$S5/v2/api.yaml" <<'EOF'
swagger: "2.0"
basePath: /rest/v2
paths:
  /lists:
    get:
      operationId: getLists
EOF
printf 'class A {}\n' > "$S5/plain/A.java"
cat > "$OUT/base.txt" <<EOF
## контракт :: @GetMapping\b :: *.java :: ключ
$S5/plain/A.java:1
EOF
sm_run "$PLAN" "$OUT/base.txt" 30 1 "$S5" "$OUT/base.tsv" backend > "$OUT/base.out" 2>&1
count "^операция	PUT	/api/campaigns/{id}/archive	updateCampaignArchive	" "$OUT/base.tsv" 1 "м servers"
count "^операция	GET	/rest/v2/lists	getLists	" "$OUT/base.tsv" 1 "м basePath"
count "^операция	PUT	/campaigns/" "$OUT/base.tsv" 0 "м без базового пути не остаётся"

# (и) решение о нарезке — по весу ключей: ключей 20 ≤ K, с ориентиром 50 > K — нарезки нет, частей нет
cat > "$OUT/ori.txt" <<EOF
## контракт :: @GetMapping\b :: *.java :: ключ
$S/api/a/A.java:20
## топики :: KafkaListener :: *.java :: ориентир
$S/api/b/B.java:30
EOF
run ori "$OUT/ori.txt" backend
has "нарезка не нужна: вес по ключам 20 ≤ K=30 (ориентир 30 в решение не идёт)" "$OUT/ori.out" "и"
count '^часть' "$OUT/ori.tsv" 0 "и"

# (к) фронт отдаёт хосту точки встраивания: строка разведчика «экраны» с условием файла `exposes` — ключи
# конфига сборки в итоге экранов, такой же ключ в файле без `exposes` — вне условия
S3="$OUT/mfe"; mkdir -p "$S3/src"
printf 'export const routes = [];\n' > "$S3/src/App.jsx"
printf "export const locales = {\n  './en': () => import('./en.json'),\n};\n" > "$S3/src/i18n.js"
cat > "$S3/webpack.config.js" <<'EOF'
module.exports = { plugins: [ new ModuleFederationPlugin({
  name: 'catalog',
  exposes: {
    './Catalog': './src/mf/CatalogRemote.tsx',
    "./Cart": "./src/mf/CartRemote.tsx",
  },
  shared: { react: { singleton: true } },
}) ] };
EOF
cat > "$OUT/mfe.txt" <<EOF
## экраны :: path: :: *.jsx :: ключ
$S3/src/App.jsx:3
## экраны :: ^\s*['"]\./\w+['"]\s*: :: *.js :: в файлах с exposes\s*: :: ключ
$S3/webpack.config.js:2
$S3/src/i18n.js:1
EOF
sm_run "$PLAN" "$OUT/mfe.txt" 30 1 "$S3" "$OUT/mfe.tsv" frontend > "$OUT/mfe.out" 2>&1
has "итог по классам: экраны 5" "$OUT/mfe.out" "к"
has "вне условия файла: экраны 1 в файлах 1" "$OUT/mfe.out" "к"
count "^файл	$S3/webpack.config.js	экраны	2	" "$OUT/mfe.tsv" 1 "к"
count 'i18n\.js' "$OUT/mfe.tsv" 0 "к"

# (л) топики конфига — только из файлов, которые назвал разведчик (`## конфиг топиков :: <файл>`): YAML (карта под
# `topics`), JSON (верблюжий ключ, массив на строках), `.env`; `application.yml` без строки разведчика не читается
S4="$OUT/tcfg"; mkdir -p "$S4/config" "$S4/src/main/resources" "$S4/src"
printf 'export const sub = bus.subscribe("x");\n' > "$S4/src/bus.ts"
cat > "$S4/config/default.yaml" <<'EOF'
kafka:
  brokers: kafka:9092
  topics:
    orders: orders.created
    refunds: refunds.issued
EOF
printf 'kafka:\n  topics:\n    orders: test.orders\n' > "$S4/config/test.yaml"
printf 'AUDIT_TOPIC=audit.events\nKAFKA_BROKERS=kafka:9092\n' > "$S4/.env"
cat > "$S4/config/extra.json" <<'EOF'
{
  "ordersTopic": "orders.v2",
  "replay": {
    "topics": [
      "replay.a",
      "replay.b"
    ]
  },
  "retries": 3
}
EOF
printf 'app:\n  billing-topic: billing.closed\n' > "$S4/src/main/resources/application.yml"
cat > "$OUT/tcfg1.txt" <<EOF
## топики :: \.subscribe\( :: *.ts :: ориентир
$S4/src/bus.ts:1
## конфиг топиков :: $S4/config/default.yaml
EOF
sm_run "$PLAN" "$OUT/tcfg1.txt" 30 1 "$S4" "$OUT/tcfg1.tsv" backend > "$OUT/tcfg1.out" 2>&1
count "^топик	orders\.created	" "$OUT/tcfg1.tsv" 1 "л yaml"
count "^топик	refunds\.issued	" "$OUT/tcfg1.tsv" 1 "л yaml"
count "^топик" "$OUT/tcfg1.tsv" 2 "л yaml: только названный файл"
cat > "$OUT/tcfg2.txt" <<EOF
## топики :: \.subscribe\( :: *.ts :: ориентир
$S4/src/bus.ts:1
## конфиг топиков :: $S4/.env
## конфиг топиков :: $S4/config/extra.json
EOF
sm_run "$PLAN" "$OUT/tcfg2.txt" 30 1 "$S4" "$OUT/tcfg2.tsv" backend > "$OUT/tcfg2.out" 2>&1
for t in audit.events orders.v2 replay.a replay.b; do count "^топик	${t//./\\.}	" "$OUT/tcfg2.tsv" 1 "л env/json"; done
count "^топик" "$OUT/tcfg2.tsv" 4 "л env/json"
cat > "$OUT/tcfg3.txt" <<EOF
## топики :: \.subscribe\( :: *.ts :: ориентир
$S4/src/bus.ts:1
EOF
sm_run "$PLAN" "$OUT/tcfg3.txt" 30 1 "$S4" "$OUT/tcfg3.tsv" backend > "$OUT/tcfg3.out" 2>&1
count "^топик" "$OUT/tcfg3.tsv" 0 "л без строки разведчика"

# (ж) таблица формы keys.py — как таблица порядка секций шаблона (секции классов пометок)
python "$HERE/form-table.py" "$(cygpath -m "$REF" 2>/dev/null || echo "$REF")" || bad=1

[ "$bad" -eq 0 ] && echo "ОК" || { echo "разошлось — см. выше"; exit 1; }
