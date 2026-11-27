#!/usr/bin/env bash
# Генератор фикстуры SM-MONO-DGS — Spring-монолит, чей контракт объявлен Netflix DGS, а не
# REST-аннотациями. По форме — как адъютант с прода (`repo-split-log.md`): ~1000 java-файлов,
# GraphQL-операции большинством, REST меньшинством, Kafka через reactor-kafka без аннотаций,
# топики только в конфиге.
#
# Зачем. Разведчик Шага 3.0 (`PLAN-AUTOSPLIT.md` §2) должен назвать регэкспы ключей для стека,
# которого в старой таблице маркеров не было. Грепом по его регэкспам ведущий считает ключи. Здесь
# у каждого класса есть «соседняя» пометка, которая выглядит как ключ и ключом не является:
#
#   1. `@DgsData(parentType = "<не Query/Mutation>")` — 72 резолвера ПОЛЕЙ рядом с 24 корневыми
#      `@DgsData`. Регэксп `@DgsData` без ограничения parentType завышает контракт в 1,6 раза.
#   2. `@DgsComponent` на 55 классах — пометка класса, не операции.
#   3. Класс-уровневый `@RequestMapping` на 5 контроллерах из 8 — снова пометка класса; число мало
#      и в окно [0,8; 1,5] влезает, поэтому ловится только по месту совпадения.
#   4. `@Query` в 44 JPA-репозиториях — не контракт. `@Dgs(Query|Mutation)|@Query` даёт 164.
#   5. `@Entity` и `@Table` на одних и тех же 60 классах — `@Entity|@Table` даёт 120.
#   6. Kafka через reactor-kafka: ни `@KafkaListener`, ни имён топиков в коде. Пять классов
#      `*EventProcessor` (плюс абстрактный `BaseEventProcessor`) слушают 8 топиков, четыре
#      `*KafkaProducer` пишут в 4. Все 12 имён — только в `application.yaml`.
#   7. `@Scheduled` — 10 задач, 7 из них в `sla`; рядом `@EnableScheduling` на конфиге.
#   8. `printforms` — 120 файлов, НОЛЬ ключей любого класса (крупный пакет без пометок).
#   9. Схемы `*.graphqls` — 17 файлов: поля корневых типов совпадают с кодом, но сами по себе
#      ключами не считаются (ключ — объявление резолвера в коде).
#
# DGS_MIX=1 — смешанный вариант: первая операция `@DgsQuery`/`@DgsMutation` в каждом классе записана
# со скобками (`@DgsQuery(field = "…")`), остальные без. Число ключей то же; маркер со скобкой
# (`@DgsQuery\(`) ловит только их — так выглядит недосчёт GraphQL на проде.
# Вызов:  ./make.sh <куда>   →  <куда>/casedesk/   (по умолчанию ./out, он в .gitignore стенда)
# Детерминированно, без random. В конце — числа, посчитанные grep'ом по собранному дереву.
set -eu
OUT="${1:-./out}"
R="$OUT/casedesk"
J="$R/src/main/java/ru/kontrol/casedesk"
RES="$R/src/main/resources"
rm -rf "$OUT"
mkdir -p "$J/v2" "$RES/schema"
mkdir -p "$R/.git"; echo "ref: refs/heads/main" > "$R/.git/HEAD"

cat > "$R/pom.xml" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>ru.kontrol</groupId>
  <artifactId>casedesk</artifactId>
  <version>2.31.0</version>
  <packaging>jar</packaging>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
    <dependency><groupId>com.netflix.graphql.dgs</groupId><artifactId>graphql-dgs-spring-graphql-starter</artifactId></dependency>
    <dependency><groupId>io.projectreactor.kafka</groupId><artifactId>reactor-kafka</artifactId></dependency>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin>
    <plugin><groupId>com.netflix.graphql.dgs.codegen</groupId><artifactId>graphql-dgs-codegen-maven-plugin</artifactId></plugin>
  </plugins></build>
</project>
EOF

cat > "$R/.gitignore" <<'EOF'
target/
*.log
.idea/
EOF

cat > "$R/README.md" <<'EOF'
# casedesk — рабочее место инспектора

Сборка одна: `mvn spring-boot:run`. API — GraphQL (`/graphql`, схемы в `src/main/resources/schema/`),
несколько старых REST-ручек в пакете `controllers`. Интеграции — Kafka (настройки в `application.yaml`).
EOF

cat > "$J/CasedeskApplication.java" <<'EOF'
package ru.kontrol.casedesk;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CasedeskApplication {
  public static void main(String[] args) {
    SpringApplication.run(CasedeskApplication.class, args);
  }
}
EOF

# =====================================================================================
# КОНФИГ: 12 топиков — только здесь. Потребляемые — списком, публикуемые — ключом `topic:`.
# =====================================================================================
cat > "$RES/application.yaml" <<'EOF'
spring:
  application:
    name: casedesk
  datasource:
    url: jdbc:postgresql://db:5432/casedesk
  jpa:
    open-in-view: false
dgs:
  graphql:
    schema-locations: classpath*:schema/**/*.graphql*
casedesk:
  kafka:
    bootstrap-servers: kafka:9092
    consumers:
      intake:
        group-id: casedesk-intake
        topics:
          - kontrol.case.intake.v1
          - kontrol.case.reopen.v1
      registry:
        group-id: casedesk-registry
        topics:
          - kontrol.registry.person.v1
          - kontrol.registry.org.v1
      court:
        group-id: casedesk-court
        topics:
          - kontrol.court.decision.v1
          - kontrol.court.appeal.v1
      payment:
        group-id: casedesk-payment
        topics:
          - kontrol.payment.fine.v1
      geo:
        group-id: casedesk-geo
        topics:
          - kontrol.geo.region.v1
    producers:
      case-status:
        topic: kontrol.case.status.v1
      finding:
        topic: kontrol.finding.created.v1
      sanction:
        topic: kontrol.sanction.issued.v1
      notification:
        topic: kontrol.notification.outbound.v1
logging:
  level:
    ru.kontrol.casedesk: INFO
EOF

cat > "$RES/schema/scalars.graphqls" <<'EOF'
scalar DateTime
scalar Long
EOF

# =====================================================================================
# ПАКЕТЫ С КЛЮЧАМИ
# =====================================================================================
# <пакет> <всего java-файлов> <@DgsQuery> <@DgsMutation> <@DgsData Query> <@DgsData Mutation>
#   <@DgsSubscription> <@DgsData полей> <@Entity> <@Query JPA> <@Scheduled>
# Прочие файлы пакета (сервисы, dto, мапперы, валидаторы) добивают до «всего».
PKGS="
cases          170 10 9 4 3 0 21 13 9 0
checks          60  5 4 2 1 0  8  6 4 0
findings        45  3 3 1 1 0  6  5 3 0
sanctions       40  3 3 1 1 0  5  4 3 0
reports         35  3 0 1 0 0  3  3 3 1
users           30  3 3 1 1 0  6  5 3 0
groups          18  2 3 1 1 0  4  2 2 0
dictionaries    40  4 2 1 0 0  4  6 4 0
templates       22  2 2 0 1 0  3  3 2 0
attachments     18  1 2 0 1 0  2  2 2 0
comments        12  1 2 0 0 0  2  1 1 0
history         12  1 0 1 0 0  2  1 1 0
notifications   20  1 1 0 0 2  2  2 2 0
territory       14  1 0 1 0 0  2  2 1 0
settings        10  1 1 0 0 0  1  1 1 0
sla             24  1 1 0 0 0  1  1 1 7
outbox          16  0 0 0 0 0  0  1 1 2
"
FIELDS="assignee author status region attachments history comments owner inspector deadline parent children"

meth() {  # пустая строка-разделитель, затем строки метода
  printf '\n'; printf '%s\n' "$@"
}

fname() {  # имя поля резолвера по номеру: assignee, author, …, затем assignee12, …
  local k="$1" i=0 f
  for f in $FIELDS; do
    if [ "$i" = $(( k % 12 )) ]; then
      if [ "$k" -ge 12 ]; then echo "$f$k"; else echo "$f"; fi
      return
    fi
    i=$(( i + 1 ))
  done
}

# --- сервис-якорь пакета -------------------------------------------------------------
emit_anchor() {
  local d="$1" D="${1^}" b="$J/v2/$1/service"
  mkdir -p "$b"
  {
    printf '%s\n' "package ru.kontrol.casedesk.v2.$d.service;" ""
    printf '%s\n' "import java.util.Collections;" "import java.util.List;" ""
    printf '%s\n' "public class ${D}Service {" "" \
                  "  public List<Object> find(String filter) {" \
                  "    if (filter == null || filter.isBlank()) {" \
                  "      return Collections.emptyList();" \
                  "    }" \
                  "    return Collections.singletonList(filter.trim());" \
                  "  }" "" \
                  "  public Object save(Object input) {" \
                  "    return input;" \
                  "  }" \
                  "}"
  } > "$b/${D}Service.java"
}

# --- DGS: операции корневых типов, по 4 метода на класс @DgsComponent ------------------
# Вид операции: q — @DgsQuery, m — @DgsMutation, dq/dm — @DgsData(parentType = "Query"/"Mutation"),
# s — @DgsSubscription. Попутно копятся поля схемы.
emit_dgs() {
  local d="$1" q="$2" m="$3" dq="$4" dm="$5" s="$6" D="${1^}"
  local ops="" i
  SQ=""; SM=""; SS=""
  i=0; while [ "$i" -lt "$q" ];  do ops="$ops q";  i=$(( i + 1 )); done
  i=0; while [ "$i" -lt "$m" ];  do ops="$ops m";  i=$(( i + 1 )); done
  i=0; while [ "$i" -lt "$dq" ]; do ops="$ops dq"; i=$(( i + 1 )); done
  i=0; while [ "$i" -lt "$dm" ]; do ops="$ops dm"; i=$(( i + 1 )); done
  i=0; while [ "$i" -lt "$s" ];  do ops="$ops s";  i=$(( i + 1 )); done
  [ -n "$ops" ] || return 0
  local b="$J/v2/$d/datafetcher"; mkdir -p "$b"
  local k=0 c=0 inclass=0 f=""
  for op in $ops; do
    if [ "$inclass" = 0 ]; then
      f="$b/${D}DataFetcher$c.java"
      {
        printf '%s\n' "package ru.kontrol.casedesk.v2.$d.datafetcher;" ""
        printf '%s\n' "import com.netflix.graphql.dgs.DgsComponent;" \
                      "import com.netflix.graphql.dgs.DgsData;" \
                      "import com.netflix.graphql.dgs.DgsMutation;" \
                      "import com.netflix.graphql.dgs.DgsQuery;" \
                      "import com.netflix.graphql.dgs.DgsSubscription;" \
                      "import com.netflix.graphql.dgs.InputArgument;" \
                      "import java.util.List;" \
                      "import java.util.Map;" \
                      "import org.reactivestreams.Publisher;" \
                      "import reactor.core.publisher.Flux;" \
                      "import ru.kontrol.casedesk.v2.$d.service.${D}Service;" ""
        printf '%s\n' "@DgsComponent" \
                      "public class ${D}DataFetcher$c {" "" \
                      "  private final ${D}Service service;" "" \
                      "  public ${D}DataFetcher$c(${D}Service service) {" \
                      "    this.service = service;" \
                      "  }"
      } > "$f"
    fi
    case "$op" in
      q)  if [ "${DGS_MIX:-}" = 1 ] && [ "$inclass" = 0 ]; then ann="  @DgsQuery(field = \"find${D}$k\")"; else ann="  @DgsQuery"; fi
          meth "$ann" \
            "  public List<Object> find${D}$k(@InputArgument String filter) {" \
            "    return service.find(filter);" \
            "  }" >> "$f"
          SQ="$SQ  find${D}$k(filter: String): [${D}Item]"$'\n' ;;
      m)  if [ "${DGS_MIX:-}" = 1 ] && [ "$inclass" = 0 ]; then ann="  @DgsMutation(field = \"save${D}$k\")"; else ann="  @DgsMutation"; fi
          meth "$ann" \
            "  public Object save${D}$k(@InputArgument Map<String, Object> input) {" \
            "    return service.save(input);" \
            "  }" >> "$f"
          SM="$SM  save${D}$k(input: ${D}Input): ${D}Item"$'\n' ;;
      dq) meth "  @DgsData(parentType = \"Query\", field = \"${d}Page$k\")" \
            "  public List<Object> ${d}Page$k(@InputArgument Integer page) {" \
            "    return service.find(page == null ? \"0\" : page.toString());" \
            "  }" >> "$f"
          SQ="$SQ  ${d}Page$k(page: Int): [${D}Item]"$'\n' ;;
      dm) meth "  @DgsData(parentType = \"Mutation\", field = \"archive${D}$k\")" \
            "  public Boolean archive${D}$k(@InputArgument String id) {" \
            "    return id != null && service.save(id) != null;" \
            "  }" >> "$f"
          SM="$SM  archive${D}$k(id: ID!): Boolean"$'\n' ;;
      s)  meth "  @DgsSubscription" \
            "  public Publisher<Object> ${d}Changed$k(@InputArgument String userId) {" \
            "    return Flux.fromIterable(service.find(userId));" \
            "  }" >> "$f"
          SS="$SS  ${d}Changed$k(userId: String): ${D}Item"$'\n' ;;
    esac
    k=$(( k + 1 )); inclass=$(( inclass + 1 ))
    if [ "$inclass" = 4 ]; then printf '%s\n' "}" >> "$f"; inclass=0; c=$(( c + 1 )); fi
  done
  if [ "$inclass" != 0 ]; then printf '%s\n' "}" >> "$f"; fi
}

# --- DGS: резолверы полей не-корневых типов — @DgsData(parentType = "<Пакет>Item") ------
emit_fields() {
  local d="$1" n="$2" D="${1^}"
  SF=""
  [ "$n" -gt 0 ] || return 0
  local b="$J/v2/$d/datafetcher"; mkdir -p "$b"
  local k=0 c=0 inclass=0 f="" nm
  while [ "$k" -lt "$n" ]; do
    if [ "$inclass" = 0 ]; then
      f="$b/${D}FieldResolver$c.java"
      {
        printf '%s\n' "package ru.kontrol.casedesk.v2.$d.datafetcher;" ""
        printf '%s\n' "import com.netflix.graphql.dgs.DgsComponent;" \
                      "import com.netflix.graphql.dgs.DgsData;" \
                      "import com.netflix.graphql.dgs.DgsDataFetchingEnvironment;" \
                      "import java.util.Map;" ""
        printf '%s\n' "/**" \
                      " * Поля типа ${D}Item, которые не лежат в строке таблицы и достраиваются отдельно." \
                      " */" \
                      "@DgsComponent" \
                      "public class ${D}FieldResolver$c {"
      } > "$f"
    fi
    nm="$(fname "$k")"
    meth "  @DgsData(parentType = \"${D}Item\", field = \"$nm\")" \
      "  public Object $nm(DgsDataFetchingEnvironment dfe) {" \
      "    Map<String, Object> source = dfe.getSource();" \
      "    return source == null ? null : source.get(\"${nm}Id\");" \
      "  }" >> "$f"
    SF="$SF  $nm: String"$'\n'
    k=$(( k + 1 )); inclass=$(( inclass + 1 ))
    if [ "$inclass" = 4 ]; then printf '%s\n' "}" >> "$f"; inclass=0; c=$(( c + 1 )); fi
  done
  if [ "$inclass" != 0 ]; then printf '%s\n' "}" >> "$f"; fi
}

# --- схема пакета: поля корневых типов = операции в коде ---------------------------------
emit_schema() {
  local d="$1" D="${1^}" kw="extend type"
  [ -n "$SQ$SM$SS$SF" ] || return 0
  [ "$d" = cases ] && kw="type"
  {
    if [ -n "$SQ" ]; then printf '%s\n' "$kw Query {"; printf '%s' "$SQ"; printf '%s\n' "}" ""; fi
    if [ -n "$SM" ]; then printf '%s\n' "$kw Mutation {"; printf '%s' "$SM"; printf '%s\n' "}" ""; fi
    if [ -n "$SS" ]; then printf '%s\n' "type Subscription {"; printf '%s' "$SS"; printf '%s\n' "}" ""; fi
    printf '%s\n' "type ${D}Item {" "  id: ID!" "  title: String" "  createdAt: DateTime"
    printf '%s' "$SF"
    printf '%s\n' "}" "" "input ${D}Input {" "  title: String" "}"
  } > "$RES/schema/$d.graphqls"
}

# --- сущности: @Entity и @Table на ОДНОМ И ТОМ ЖЕ классе --------------------------------
emit_entities() {
  local d="$1" n="$2" D="${1^}" i=0
  [ "$n" -gt 0 ] || return 0
  local b="$J/v2/$d/model/entity"; mkdir -p "$b"
  while [ "$i" -lt "$n" ]; do
    {
      printf '%s\n' "package ru.kontrol.casedesk.v2.$d.model.entity;" ""
      printf '%s\n' "import java.time.OffsetDateTime;" \
                    "import javax.persistence.Column;" \
                    "import javax.persistence.Entity;" \
                    "import javax.persistence.GeneratedValue;" \
                    "import javax.persistence.Id;" \
                    "import javax.persistence.Table;" ""
      printf '%s\n' "@Entity" \
                    "@Table(name = \"cd_${d}_$i\", schema = \"casedesk\")" \
                    "public class ${D}${i}Entity {" "" \
                    "  @Id" \
                    "  @GeneratedValue" \
                    "  private Long id;" "" \
                    "  @Column(name = \"status\")" \
                    "  private String status;" "" \
                    "  @Column(name = \"created_at\")" \
                    "  private OffsetDateTime createdAt;" "" \
                    "  public Long getId() {" \
                    "    return id;" \
                    "  }" "" \
                    "  public String getStatus() {" \
                    "    return status;" \
                    "  }" \
                    "}"
    } > "$b/${D}${i}Entity.java"
    i=$(( i + 1 ))
  done
}

# --- JPA-репозитории с @Query: не контракт ----------------------------------------------
emit_queries() {
  local d="$1" n="$2" ne="$3" D="${1^}" i=0 e
  [ "$n" -gt 0 ] || return 0
  local b="$J/v2/$d/repository"; mkdir -p "$b"
  while [ "$i" -lt "$n" ]; do
    e=$(( i % ne ))
    {
      printf '%s\n' "package ru.kontrol.casedesk.v2.$d.repository;" ""
      printf '%s\n' "import java.util.List;" \
                    "import org.springframework.data.jpa.repository.JpaRepository;" \
                    "import org.springframework.data.jpa.repository.Query;" \
                    "import org.springframework.data.repository.query.Param;" \
                    "import ru.kontrol.casedesk.v2.$d.model.entity.${D}${e}Entity;" ""
      printf '%s\n' "public interface ${D}Repository$i extends JpaRepository<${D}${e}Entity, Long> {" "" \
                    "  @Query(\"select e from ${D}${e}Entity e where e.status = :status order by e.createdAt desc\")" \
                    "  List<${D}${e}Entity> findByStatus(@Param(\"status\") String status);" \
                    "}"
    } > "$b/${D}Repository$i.java"
    i=$(( i + 1 ))
  done
}

# --- фоновые задачи ---------------------------------------------------------------------
emit_jobs() {
  local d="$1" n="$2" D="${1^}" i=0 sch
  [ "$n" -gt 0 ] || return 0
  local b="$J/v2/$d/job"; mkdir -p "$b"
  while [ "$i" -lt "$n" ]; do
    if [ $(( i % 2 )) = 0 ]; then sch="@Scheduled(cron = \"0 $(( i * 5 % 60 )) * * * *\")"
    else sch="@Scheduled(fixedDelayString = \"PT$(( i + 1 ))M\")"; fi
    {
      printf '%s\n' "package ru.kontrol.casedesk.v2.$d.job;" ""
      printf '%s\n' "import org.springframework.scheduling.annotation.Scheduled;" \
                    "import org.springframework.stereotype.Component;" ""
      printf '%s\n' "@Component" \
                    "public class ${D}Job$i {" "" \
                    "  $sch" \
                    "  public void run() {" \
                    "    long started = System.currentTimeMillis();" \
                    "    sweep();" \
                    "    report(System.currentTimeMillis() - started);" \
                    "  }" "" \
                    "  private void sweep() {" \
                    "  }" "" \
                    "  private void report(long millis) {" \
                    "  }" \
                    "}"
    } > "$b/${D}Job$i.java"
    i=$(( i + 1 ))
  done
}

# --- прочие файлы пакета: без единой пометки-ключа ---------------------------------------
emit_filler() {  # emit_filler <пакет> <сколько> [<java-пакет-корень>]
  local d="$1" n="$2" root="${3:-$J/v2/$1}" pkg="${4:-ru.kontrol.casedesk.v2.$1}" D="${1^}" i=0
  [ "$n" -gt 0 ] || return 0
  mkdir -p "$root/dto" "$root/mapper" "$root/service/impl" "$root/validator"
  while [ "$i" -lt "$n" ]; do
    case $(( i % 4 )) in
      0) {
           printf '%s\n' "package $pkg.dto;" ""
           printf '%s\n' "public class ${D}Dto$i {" "" \
                         "  private Long id;" \
                         "  private String title;" "" \
                         "  public Long getId() {" \
                         "    return id;" \
                         "  }" "" \
                         "  public String getTitle() {" \
                         "    return title;" \
                         "  }" "" \
                         "  public void setTitle(String value) {" \
                         "    this.title = value == null ? null : value.trim();" \
                         "  }" \
                         "}"
         } > "$root/dto/${D}Dto$i.java" ;;
      1) {
           printf '%s\n' "package $pkg.mapper;" ""
           printf '%s\n' "import java.util.HashMap;" "import java.util.Map;" ""
           printf '%s\n' "public final class ${D}Mapper$i {" "" \
                         "  private ${D}Mapper$i() {" \
                         "  }" "" \
                         "  public static Map<String, Object> toMap(Long id, String title) {" \
                         "    Map<String, Object> out = new HashMap<>();" \
                         "    out.put(\"id\", id);" \
                         "    out.put(\"title\", title == null ? \"\" : title);" \
                         "    return out;" \
                         "  }" \
                         "}"
         } > "$root/mapper/${D}Mapper$i.java" ;;
      2) {
           printf '%s\n' "package $pkg.service.impl;" ""
           printf '%s\n' "import org.springframework.stereotype.Service;" ""
           printf '%s\n' "@Service" \
                         "public class ${D}StepServiceImpl$i {" "" \
                         "  public String describe(Long id) {" \
                         "    StringBuilder sb = new StringBuilder(\"$d:\");" \
                         "    sb.append(id == null ? \"-\" : id.toString());" \
                         "    return sb.toString();" \
                         "  }" \
                         "}"
         } > "$root/service/impl/${D}StepServiceImpl$i.java" ;;
      3) {
           printf '%s\n' "package $pkg.validator;" ""
           printf '%s\n' "public class ${D}Validator$i {" "" \
                         "  public boolean isValid(String value) {" \
                         "    if (value == null) {" \
                         "      return false;" \
                         "    }" \
                         "    return value.length() <= $(( 64 + i ));" \
                         "  }" \
                         "}"
         } > "$root/validator/${D}Validator$i.java" ;;
    esac
    i=$(( i + 1 ))
  done
}

count_java() { find "$1" -name '*.java' 2>/dev/null | wc -l | tr -d ' '; }

echo "$PKGS" | while read -r d total q m dq dm s fld ent jq sch; do
  [ -n "${d:-}" ] || continue
  emit_anchor "$d"
  emit_dgs "$d" "$q" "$m" "$dq" "$dm" "$s"
  emit_fields "$d" "$fld"
  emit_schema "$d"
  emit_entities "$d" "$ent"
  emit_queries "$d" "$jq" "$ent"
  emit_jobs "$d" "$sch"
  if [ "$d" = reports ]; then
    # REST-меньшинство: выгрузка отчётов, класс-уровневый @RequestMapping
    mkdir -p "$J/v2/reports/web"
    {
      printf '%s\n' "package ru.kontrol.casedesk.v2.reports.web;" ""
      printf '%s\n' "import org.springframework.http.ResponseEntity;" \
                    "import org.springframework.web.bind.annotation.GetMapping;" \
                    "import org.springframework.web.bind.annotation.PathVariable;" \
                    "import org.springframework.web.bind.annotation.RequestMapping;" \
                    "import org.springframework.web.bind.annotation.RestController;" ""
      printf '%s\n' "@RestController" \
                    "@RequestMapping(\"/api/v2/reports/export\")" \
                    "public class ReportExportController {" ""
      for fmt in xlsx pdf csv; do
        printf '%s\n' "  @GetMapping(\"/$fmt/{id}\")" \
                      "  public ResponseEntity<byte[]> $fmt(@PathVariable Long id) {" \
                      "    return ResponseEntity.ok(new byte[0]);" \
                      "  }" ""
      done
      printf '%s\n' "}"
    } > "$J/v2/reports/web/ReportExportController.java"
  fi
  have=$(count_java "$J/v2/$d")
  emit_filler "$d" $(( total - have ))
done

# =====================================================================================
# INTEGRATION: Kafka через reactor-kafka, без аннотаций; 180 файлов
# =====================================================================================
I="$J/v2/integration"
mkdir -p "$I/consumer" "$I/producer" "$I/config" "$I/web"
emit_anchor integration
emit_entities integration 2
emit_queries integration 1 2

cat > "$I/config/KafkaTopicsProperties.java" <<'EOF'
package ru.kontrol.casedesk.v2.integration.config;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Каналы обмена из application.yaml (casedesk.kafka.*): кто что слушает и куда пишет.
 */
@ConfigurationProperties(prefix = "casedesk.kafka")
public class KafkaTopicsProperties {

  private String bootstrapServers;
  private Map<String, Consumer> consumers = new HashMap<>();
  private Map<String, Producer> producers = new HashMap<>();

  public Consumer consumer(String name) {
    return consumers.get(name);
  }

  public Producer producer(String name) {
    return producers.get(name);
  }

  public static class Consumer {
    private String groupId;
    private List<String> topics;

    public String getGroupId() {
      return groupId;
    }

    public List<String> getTopics() {
      return topics;
    }
  }

  public static class Producer {
    private String topic;

    public String getTopic() {
      return topic;
    }
  }
}
EOF

cat > "$I/config/ReactorKafkaConfig.java" <<'EOF'
package ru.kontrol.casedesk.v2.integration.config;

import java.util.HashMap;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.kafka.receiver.ReceiverOptions;
import reactor.kafka.sender.KafkaSender;
import reactor.kafka.sender.SenderOptions;

@Configuration
public class ReactorKafkaConfig {

  @Bean
  public ReceiverOptions<String, String> receiverOptions(KafkaTopicsProperties props) {
    Map<String, Object> cfg = new HashMap<>();
    cfg.put("bootstrap.servers", "kafka:9092");
    return ReceiverOptions.create(cfg);
  }

  @Bean
  public KafkaSender<String, String> kafkaSender() {
    Map<String, Object> cfg = new HashMap<>();
    cfg.put("bootstrap.servers", "kafka:9092");
    return KafkaSender.create(SenderOptions.create(cfg));
  }
}
EOF

cat > "$I/consumer/BaseEventProcessor.java" <<'EOF'
package ru.kontrol.casedesk.v2.integration.consumer;

import javax.annotation.PostConstruct;
import reactor.kafka.receiver.KafkaReceiver;
import reactor.kafka.receiver.ReceiverOptions;
import ru.kontrol.casedesk.v2.integration.config.KafkaTopicsProperties;

/**
 * Общий цикл чтения: подписка на все топики своей группы, разбор, подтверждение смещения.
 */
public abstract class BaseEventProcessor {

  private final KafkaTopicsProperties.Consumer consumer;
  private final ReceiverOptions<String, String> base;

  protected BaseEventProcessor(KafkaTopicsProperties.Consumer consumer, ReceiverOptions<String, String> base) {
    this.consumer = consumer;
    this.base = base;
  }

  @PostConstruct
  public void start() {
    KafkaReceiver.create(base.subscription(consumer.getTopics()))
        .receive()
        .subscribe(rec -> {
          handle(rec.topic(), rec.value());
          rec.receiverOffset().acknowledge();
        });
  }

  protected abstract void handle(String topic, String payload);

  protected void route(String topic, String payload) {
  }
}
EOF

for p in intake registry court payment geo; do
  P="${p^}"
  {
    printf '%s\n' "package ru.kontrol.casedesk.v2.integration.consumer;" ""
    printf '%s\n' "import org.springframework.stereotype.Component;" \
                  "import reactor.kafka.receiver.ReceiverOptions;" \
                  "import ru.kontrol.casedesk.v2.integration.config.KafkaTopicsProperties;" ""
    printf '%s\n' "/**" \
                  " * Группа «$p»: какие именно топики — в casedesk.kafka.consumers.$p (application.yaml)." \
                  " */" \
                  "@Component" \
                  "public class ${P}EventProcessor extends BaseEventProcessor {" "" \
                  "  public ${P}EventProcessor(KafkaTopicsProperties props, ReceiverOptions<String, String> base) {" \
                  "    super(props.consumer(\"$p\"), base);" \
                  "  }" "" \
                  "  @Override" \
                  "  protected void handle(String topic, String payload) {" \
                  "    if (payload == null || payload.isBlank()) {" \
                  "      return;" \
                  "    }" \
                  "    route(topic, payload);" \
                  "  }" \
                  "}"
  } > "$I/consumer/${P}EventProcessor.java"
done

for p in case-status finding sanction notification; do
  case "$p" in case-status) P=CaseStatus ;; *) P="${p^}" ;; esac
  {
    printf '%s\n' "package ru.kontrol.casedesk.v2.integration.producer;" ""
    printf '%s\n' "import org.apache.kafka.clients.producer.ProducerRecord;" \
                  "import org.springframework.stereotype.Component;" \
                  "import reactor.core.publisher.Mono;" \
                  "import reactor.kafka.sender.KafkaSender;" \
                  "import reactor.kafka.sender.SenderRecord;" \
                  "import ru.kontrol.casedesk.v2.integration.config.KafkaTopicsProperties;" ""
    printf '%s\n' "@Component" \
                  "public class ${P}KafkaProducer {" "" \
                  "  private final KafkaSender<String, String> sender;" \
                  "  private final String topic;" "" \
                  "  public ${P}KafkaProducer(KafkaSender<String, String> sender, KafkaTopicsProperties props) {" \
                  "    this.sender = sender;" \
                  "    this.topic = props.producer(\"$p\").getTopic();" \
                  "  }" "" \
                  "  public Mono<Void> send(String key, String payload) {" \
                  "    return sender.send(Mono.just(SenderRecord.create(new ProducerRecord<>(topic, key, payload), key))).then();" \
                  "  }" \
                  "}"
  } > "$I/producer/${P}KafkaProducer.java"
done

{
  printf '%s\n' "package ru.kontrol.casedesk.v2.integration.web;" ""
  printf '%s\n' "import java.util.Map;" \
                "import org.springframework.web.bind.annotation.PathVariable;" \
                "import org.springframework.web.bind.annotation.PostMapping;" \
                "import org.springframework.web.bind.annotation.RequestBody;" \
                "import org.springframework.web.bind.annotation.RestController;" ""
  printf '%s\n' "@RestController" \
                "public class InboundWebhookController {" "" \
                "  @PostMapping(\"/api/v2/integration/webhook/{source}\")" \
                "  public Map<String, Object> accept(@PathVariable String source, @RequestBody Map<String, Object> body) {" \
                "    return Map.of(\"source\", source, \"accepted\", body != null);" \
                "  }" \
                "}"
} > "$I/web/InboundWebhookController.java"

have=$(count_java "$I")
emit_filler integration $(( 180 - have ))

# =====================================================================================
# ПАКЕТЫ БЕЗ КЛЮЧЕЙ: printforms (крупный), сквозные слои
# =====================================================================================
emit_filler printforms 120
for d in common permissions security exception; do
  case "$d" in common) n=25 ;; permissions) n=30 ;; security) n=15 ;; exception) n=15 ;; esac
  emit_filler "$d" "$n"
done
C="$J/v2/config"; mkdir -p "$C"
cat > "$C/SchedulingConfig.java" <<'EOF'
package ru.kontrol.casedesk.v2.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class SchedulingConfig {
}
EOF
cat > "$C/JpaConfig.java" <<'EOF'
package ru.kontrol.casedesk.v2.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

@Configuration
@EnableJpaRepositories(basePackages = "ru.kontrol.casedesk")
public class JpaConfig {
}
EOF
i=0
while [ "$i" -lt 10 ]; do
  {
    printf '%s\n' "package ru.kontrol.casedesk.v2.config;" ""
    printf '%s\n' "import org.springframework.context.annotation.Bean;" \
                  "import org.springframework.context.annotation.Configuration;" ""
    printf '%s\n' "@Configuration" \
                  "public class BeanConfig$i {" "" \
                  "  @Bean" \
                  "  public String beanName$i() {" \
                  "    return \"cd-bean-$i\";" \
                  "  }" \
                  "}"
  } > "$C/BeanConfig$i.java"
  i=$(( i + 1 ))
done

# =====================================================================================
# ВЕРХНИЙ УРОВЕНЬ: controllers/ (старый REST), utils/, v3/ (заготовки)
# =====================================================================================
L="$J/controllers"; mkdir -p "$L"
# <класс> <класс-уровневый @RequestMapping 0/1> <методы: глагол:путь …>
LEGACY="
CaseLegacyController       1 Get:/cases/{id} Post:/cases
FileLegacyController       1 Get:/files/{id} Post:/files Delete:/files/{id}
HealthLegacyController     0 Get:/health
ImportLegacyController     1 Post:/import Put:/import/{id}
DictionaryLegacyController 1 Get:/dictionaries Put:/dictionaries/{code}
UserLegacyController       0 Get:/users/{id} Post:/users/search
"
echo "$LEGACY" | while read -r cls rm methods; do
  [ -n "${cls:-}" ] || continue
  {
    printf '%s\n' "package ru.kontrol.casedesk.controllers;" ""
    printf '%s\n' "import java.util.Map;" \
                  "import org.springframework.web.bind.annotation.*;" ""
    printf '%s\n' "@RestController"
    [ "$rm" = 1 ] && printf '%s\n' "@RequestMapping(\"/api/v1\")"
    printf '%s\n' "public class $cls {" ""
    mi=0
    for mth in $methods; do
      verb="${mth%%:*}"; path="${mth#*:}"
      printf '%s\n' "  @${verb}Mapping(\"$path\")" \
                    "  public Map<String, Object> handle$mi() {" \
                    "    return Map.of(\"path\", \"$path\");" \
                    "  }" ""
      mi=$(( mi + 1 ))
    done
    printf '%s\n' "}"
  } > "$L/$cls.java"
done
emit_filler legacy 9 "$L" "ru.kontrol.casedesk.controllers"

U="$J/utils"; mkdir -p "$U"
i=0
while [ "$i" -lt 37 ]; do
  {
    printf '%s\n' "package ru.kontrol.casedesk.utils;" ""
    printf '%s\n' "public final class TextUtils$i {" "" \
                  "  private TextUtils$i() {" \
                  "  }" "" \
                  "  public static String pad(String value) {" \
                  "    if (value == null) {" \
                  "      return \"\";" \
                  "    }" \
                  "    return value.trim();" \
                  "  }" \
                  "}"
  } > "$U/TextUtils$i.java"
  i=$(( i + 1 ))
done

V="$J/v3/category"; mkdir -p "$V"
i=0
while [ "$i" -lt 16 ]; do
  {
    printf '%s\n' "package ru.kontrol.casedesk.v3.category;" ""
    printf '%s\n' "/** Заготовка третьей версии справочника категорий; не подключена. */" \
                  "public class CategoryDraft$i {" "" \
                  "  private String code;" "" \
                  "  public String getCode() {" \
                  "    return code;" \
                  "  }" \
                  "}"
  } > "$V/CategoryDraft$i.java"
  i=$(( i + 1 ))
done

# =====================================================================================
# правда, посчитанная по факту, а не по замыслу
# =====================================================================================
c() { grep -rhoE "$1" "$2" --include="${3:-*.java}" 2>/dev/null | wc -l | tr -d ' '; }
REST='@(Get|Post|Put|Patch|Delete)Mapping\('
DGSOP='@Dgs(Query|Mutation|Subscription)\b'
DGSROOT='@DgsData\(parentType = "(Query|Mutation|Subscription)"'
echo "SM-MONO-DGS собрана в $OUT"
printf '  java-файлов:            %s\n' "$(count_java "$J")"
printf '  схем *.graphqls:        %s\n' "$(find "$RES/schema" -name '*.graphqls' | wc -l | tr -d ' ')"
printf '  контракт:               %s  (REST %s + @DgsQuery/Mutation/Subscription %s + корневых @DgsData %s)\n' \
  $(( $(c "$REST" "$J") + $(c "$DGSOP" "$J") + $(c "$DGSROOT" "$J") )) "$(c "$REST" "$J")" "$(c "$DGSOP" "$J")" "$(c "$DGSROOT" "$J")"
printf '  сущности:               %s  (наивно @Entity|@Table: %s)\n' "$(c '@Entity\b' "$J")" "$(c '@Entity\b|@Table\(' "$J")"
printf '  задачи:                 %s  (@EnableScheduling: %s)\n' "$(c '@Scheduled\(' "$J")" "$(c '@EnableScheduling' "$J")"
printf '  топики:                 %s  (в коде имён топиков: %s)\n' "$(c 'kontrol\.[a-z]+\.[a-z]+\.v1' "$RES" 'application.yaml')" "$(c 'kontrol\.[a-z]+\.[a-z]+\.v1' "$J")"
printf '  ловушки: @DgsData полей %s · @DgsComponent %s · @RequestMapping %s · @Query %s · *EventProcessor-классов %s · *KafkaProducer %s\n' \
  "$(c '@DgsData\(parentType = "[A-Z][a-z]+Item"' "$J")" "$(c '@DgsComponent' "$J")" "$(c '@RequestMapping\(' "$J")" \
  "$(c '@Query\(' "$J")" "$(c 'class \w+EventProcessor\b' "$J")" "$(c 'class \w+KafkaProducer\b' "$J")"
echo
echo "  по папкам: файлов · контракт · сущности · задачи · топики | @DgsData полей · @Query · @DgsComponent · @RequestMapping"
for dir in $(cd "$J" && find v2 -mindepth 1 -maxdepth 1 -type d | sort) controllers utils v3; do
  p="$J/$dir"
  printf '  %-18s %4s · %3s · %2s · %2s · %2s | %2s · %2s · %2s · %s\n' "$dir" "$(count_java "$p")" \
    $(( $(c "$REST" "$p") + $(c "$DGSOP" "$p") + $(c "$DGSROOT" "$p") )) "$(c '@Entity\b' "$p")" "$(c '@Scheduled\(' "$p")" 0 \
    "$(c '@DgsData\(parentType = "[A-Z][a-z]+Item"' "$p")" "$(c '@Query\(' "$p")" "$(c '@DgsComponent' "$p")" "$(c '@RequestMapping\(' "$p")"
done
printf '  %-18s %4s · %3s · %2s · %2s · %2s\n' "resources" "-" 0 0 0 "$(c 'kontrol\.[a-z]+\.[a-z]+\.v1' "$RES" 'application.yaml')"
