#!/usr/bin/env bash
# Генератор фикстуры SM-MONO-SPEC — монолит SM-MONO-DGS (casedesk) плюс то, на чём service-map-2.0
# споткнулся в проме 2026-10-05 и чего в прежних деревьях нет вместе:
#
#   1. REST ИЗ ФАЙЛА СПЕЦИФИКАЦИИ. `src/main/resources/openapi.yaml` описывает 30 операций
#      `/api/desk/…`. Интерфейсы `*DeskApi` генерит openapi-generator-maven-plugin в target/ —
#      в исходниках их нет. Контроллеры пяти модулей написаны `implements <Модуль>DeskApi` с
#      `@Override` и БЕЗ аннотаций маршрутов: счёт по `@GetMapping` их не видит (остаются 16 REST базы).
#   2. ОБЪЯВЛЕНО, НО НЕ РЕАЛИЗОВАНО. Две операции из 30 (`/api/desk/archive/…`) в коде не реализованы
#      никем: в карточке их быть не должно.
#   3. КЛЮЧ В ДВУХ МЕСТАХ. Операция объявлена в `resources/`, а реализована в папке модуля: при
#      нарезке её берёт один хозяин по правилам скилла — в карточке один блок, без дублей.
#   4. ТЕСТОВЫЙ КОНФИГ. `src/test/resources/application.yaml` называет четыре топика
#      `kontrol.test.*.v1` той же формой, что боевой конфиг: в карточке их быть не должно.
#
# Правда: контракт 148 (120 базы + 28 реализованных операций спецификации), сущности 60, задачи 10,
# топики 12. База собирается генератором SM-MONO-DGS как есть.
#
# Вызов:  ./make.sh <куда> [--with-client | --big-spec | --owners | --crosscut] → <куда>/casedesk/
# --crosscut: сквозные факты — роли, переходы и отправки в местах использования (раздел 6). Правда: контракт 155,
#   сущности 64, задачи 12, топики 15; ключ сквозных фактов — в grade-sm-mono.mjs (SM-MONO-SPEC-CROSS).
# --owners: ручки JAX-RS в папках без пометок, общие сущности у ручек двух модулей, поля из базового
#   класса — раздел 5 ниже. Правда: контракт 156, сущности 66, задачи 10, топики 12.
# --with-client: рядом лежит спека соседа с тем же operationId и клиентским генератором java.
# --big-spec: в openapi.yaml 100 операций (98 реализованы в семи модулях, две архивные — без реализации),
#   у каждой реализованной один факт в методе контроллера: условие → 403/404/409/422/423. Строки спеки
#   и факты собираются по big-spec-key.tsv рядом с make.sh — это и ключ ответов, в дерево он не едет.
#   Правда: контракт 218 (120 базы + 98), остальное как в базе.
# По умолчанию <куда> = ./out (в .gitignore стенда).
set -eu
OUT="${1:-./out}"
VARIANT="${2:-}"
case "$VARIANT" in ''|--with-client|--big-spec|--owners|--crosscut) ;; *) echo "неизвестный вариант: $VARIANT" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="$HERE/../SM-MONO-DGS/make.sh"
[ -f "$BASE" ] || { echo "нет генератора базы: $BASE" >&2; exit 1; }
mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"

# --- база: дерево SM-MONO-DGS ---------------------------------------------------------------
# bash 3.2 (macOS) не знает ${x^}, а переменную перед не-ASCII символом читает с лишним байтом —
# генератор базы запускается копией с двумя подстановками; на bash 4+ — как есть.
if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
  bash "$BASE" "$OUT" > /dev/null
else
  T="$(mktemp)"
  perl -pe 's/\$\{(\w+)\^\}/\$(cap "\$$1")/g; s/\$([A-Za-z_]\w*)(?=[\x80-\xFF])/\${$1}/g' "$BASE" \
    | awk '!done && /^set -eu/ { print; print "cap() { printf \"%s%s\" \"$(printf \"%s\" \"${1:0:1}\" | tr \"[:lower:]\" \"[:upper:]\")\" \"${1:1}\"; }"; done = 1; next } { print }' > "$T"
  bash "$T" "$OUT" > /dev/null; rm -f "$T"
fi
R="$OUT/casedesk"
J="$R/src/main/java/ru/kontrol/casedesk"
RES="$R/src/main/resources"
[ -d "$J/v2" ] || { echo "база не собралась: нет $J/v2" >&2; exit 1; }

cap() { printf '%s%s' "$(printf '%s' "${1:0:1}" | tr '[:lower:]' '[:upper:]')" "${1:1}"; }

# модуль : число операций (первые N из шести шаблонов) : как модуль называет себя человеку
MODS="checks:6:проверка findings:6:нарушение sanctions:6:санкция templates:5:шаблон groups:5:группа"

# --- 1. openapi.yaml: 28 реализованных операций + 2 без реализации ---------------------------
{
  printf '%s\n' "openapi: 3.0.3" "info:" "  title: casedesk — рабочее место инспектора, REST для внешних рабочих мест" "  version: 1.4.0" \
                "servers:" "  - url: /" "paths:"
  for m in $MODS; do
    mod="${m%%:*}"; rest="${m#*:}"; n="${rest%%:*}"; ru="${rest#*:}"; M="$(cap "$mod")"
    printf '%s\n' "  /api/desk/${mod}:" \
                  "    get:" "      tags: [${mod}]" "      operationId: list${M}Desk" "      summary: Список — ${ru}, постранично" \
                  "      parameters:" "        - {name: page, in: query, schema: {type: integer}}" "        - {name: size, in: query, schema: {type: integer}}" \
                  "      responses:" "        '200': {description: страница списка}" \
                  "    post:" "      tags: [${mod}]" "      operationId: create${M}Desk" "      summary: Создать — ${ru}" \
                  "      responses:" "        '201': {description: создано}" "        '422': {description: нет обязательного поля title}"
    printf '%s\n' "  /api/desk/${mod}/{id}:" \
                  "    get:" "      tags: [${mod}]" "      operationId: get${M}Desk" "      summary: Карточка — ${ru}" \
                  "      responses:" "        '200': {description: найдено}" "        '404': {description: нет такой записи}" \
                  "    put:" "      tags: [${mod}]" "      operationId: update${M}Desk" "      summary: Изменить — ${ru}" \
                  "      responses:" "        '200': {description: изменено}" "        '409': {description: запись изменена другим инспектором}"
    if [ "$n" -ge 5 ]; then
      printf '%s\n' "    delete:" "      tags: [${mod}]" "      operationId: delete${M}Desk" "      summary: Удалить — ${ru}" \
                    "      responses:" "        '204': {description: удалено}" "        '423': {description: запись закрыта, удалять нельзя}"
    fi
    if [ "$n" -ge 6 ]; then
      printf '%s\n' "  /api/desk/${mod}/{id}/export:" \
                    "    post:" "      tags: [${mod}]" "      operationId: export${M}Desk" "      summary: Выгрузить в файл — ${ru}" \
                    "      responses:" "        '202': {description: выгрузка поставлена в очередь}"
    fi
  done
  # объявлены, но не реализованы никем: контроллера ArchiveDeskApi в коде нет
  printf '%s\n' "  /api/desk/archive/{id}:" \
                "    get:" "      tags: [archive]" "      operationId: getArchiveDesk" "      summary: Карточка дела из архива" \
                "      responses:" "        '200': {description: найдено}" \
                "  /api/desk/archive/{id}/restore:" \
                "    post:" "      tags: [archive]" "      operationId: restoreArchiveDesk" "      summary: Вернуть дело из архива" \
                "      responses:" "        '200': {description: возвращено}"
} > "$RES/openapi.yaml"

# --- 2. контроллеры: implements <Модуль>DeskApi, без аннотаций маршрутов ----------------------
for m in $MODS; do
  mod="${m%%:*}"; rest="${m#*:}"; n="${rest%%:*}"; M="$(cap "$mod")"
  W="$J/v2/$mod/web"; mkdir -p "$W"
  {
    printf '%s\n' "package ru.kontrol.casedesk.v2.${mod}.web;" "" \
                  "import java.util.List;" "import org.springframework.http.ResponseEntity;" \
                  "import org.springframework.web.bind.annotation.RestController;" \
                  "import ru.kontrol.casedesk.api.${M}DeskApi;" \
                  "import ru.kontrol.casedesk.api.model.${M}DeskDto;" "" \
                  "/**" " * Реализация интерфейса, который openapi-generator собирает из src/main/resources/openapi.yaml" \
                  " * (target/generated-sources). Пути и глаголы операций — там, здесь только поведение." " */" \
                  "@RestController" "public class ${M}DeskApiController implements ${M}DeskApi {" "" \
                  "  private static final int MAX_PAGE = 200;" \
                  "  private final ${M}DeskService service;" "" \
                  "  public ${M}DeskApiController(${M}DeskService service) {" "    this.service = service;" "  }" ""
    printf '%s\n' "  @Override" "  public ResponseEntity<List<${M}DeskDto>> list${M}Desk(Integer page, Integer size) {" \
                  "    int limit = size == null ? 50 : Math.min(size, MAX_PAGE);" \
                  "    return ResponseEntity.ok(service.page(page == null ? 0 : page, limit));" "  }" ""
    printf '%s\n' "  @Override" "  public ResponseEntity<${M}DeskDto> create${M}Desk(${M}DeskDto body) {" \
                  "    if (body.getTitle() == null || body.getTitle().isBlank()) {" \
                  "      throw new DeskValidationException(\"title обязателен\");" "    }" \
                  "    return ResponseEntity.status(201).body(service.create(body));" "  }" ""
    printf '%s\n' "  @Override" "  public ResponseEntity<${M}DeskDto> get${M}Desk(Long id) {" \
                  "    return service.find(id).map(ResponseEntity::ok).orElseThrow(() -> new DeskNotFoundException(id));" "  }" ""
    printf '%s\n' "  @Override" "  public ResponseEntity<${M}DeskDto> update${M}Desk(Long id, ${M}DeskDto body) {" \
                  "    ${M}DeskDto current = service.find(id).orElseThrow(() -> new DeskNotFoundException(id));" \
                  "    if (!current.getVersion().equals(body.getVersion())) {" \
                  "      throw new DeskConflictException(\"запись изменена другим инспектором\");" "    }" \
                  "    return ResponseEntity.ok(service.update(id, body));" "  }" ""
    if [ "$n" -ge 5 ]; then
      printf '%s\n' "  @Override" "  public ResponseEntity<Void> delete${M}Desk(Long id) {" \
                    "    if (service.isClosed(id)) {" "      throw new DeskLockedException(\"запись закрыта, удалять нельзя\");" "    }" \
                    "    service.delete(id);" "    return ResponseEntity.noContent().build();" "  }" ""
    fi
    if [ "$n" -ge 6 ]; then
      printf '%s\n' "  @Override" "  public ResponseEntity<Void> export${M}Desk(Long id) {" \
                    "    service.enqueueExport(id);" "    return ResponseEntity.accepted().build();" "  }" ""
    fi
    printf '%s\n' "}"
  } > "$W/${M}DeskApiController.java"
  {
    printf '%s\n' "package ru.kontrol.casedesk.v2.${mod}.web;" "" "import java.util.Collections;" "import java.util.List;" "import java.util.Optional;" \
                  "import org.springframework.stereotype.Service;" "import ru.kontrol.casedesk.api.model.${M}DeskDto;" "" \
                  "@Service" "public class ${M}DeskService {" "" \
                  "  public List<${M}DeskDto> page(int page, int size) {" "    return Collections.emptyList();" "  }" "" \
                  "  public Optional<${M}DeskDto> find(Long id) {" "    return Optional.empty();" "  }" "" \
                  "  public ${M}DeskDto create(${M}DeskDto body) {" "    return body;" "  }" "" \
                  "  public ${M}DeskDto update(Long id, ${M}DeskDto body) {" "    return body;" "  }" "" \
                  "  public boolean isClosed(Long id) {" "    return false;" "  }" "" \
                  "  public void delete(Long id) {" "  }" "" \
                  "  public void enqueueExport(Long id) {" "  }" "}"
  } > "$W/${M}DeskService.java"
done
# общие исключения рабочего места — без пометок-ключей
X="$J/v2/common/desk"; mkdir -p "$X"
for e in Validation:422 NotFound:404 Conflict:409 Locked:423; do
  name="${e%%:*}"; code="${e#*:}"
  printf '%s\n' "package ru.kontrol.casedesk.v2.common.desk;" "" "import org.springframework.http.HttpStatus;" \
                "import org.springframework.web.bind.annotation.ResponseStatus;" "" \
                "@ResponseStatus(code = HttpStatus.valueOf(${code}))" \
                "public class Desk${name}Exception extends RuntimeException {" \
                "  public Desk${name}Exception(Object detail) {" "    super(String.valueOf(detail));" "  }" "}" > "$X/Desk${name}Exception.java"
done

# --- 1б. большая спека: openapi.yaml и контроллеры пишутся заново по big-spec-key.tsv -------------
# Модули большой спеки покрывают все пять модулей базы: их контроллеры и сервисы перезаписываются.
if [ "$VARIANT" = --big-spec ]; then
  KEY="$HERE/big-spec-key.tsv"
  [ -f "$KEY" ] || { echo "нет ключа большой спеки: $KEY" >&2; exit 1; }
  ROWS="$(grep -v '^#' "$KEY" | tr -d '\r')"
  BIG_MODS="checks:проверка findings:нарушение sanctions:санкция templates:шаблон groups:группа reports:отчёт notifications:уведомление"
  big_ru() { local y; for y in $BIG_MODS; do [ "${y%%:*}" != "$1" ] || printf '%s' "${y#*:}"; done; }
  big_summary() {  # <операция> <как модуль называет себя человеку>
    case "$1" in
      list) printf '%s' "Список — ${2}, постранично" ;;        create) printf '%s' "Создать — ${2}" ;;
      get) printf '%s' "Карточка — ${2}" ;;                     update) printf '%s' "Изменить — ${2}" ;;
      delete) printf '%s' "Удалить — ${2}" ;;                   export) printf '%s' "Выгрузить в файл — ${2}" ;;
      assign) printf '%s' "Назначить ответственного — ${2}" ;;  close) printf '%s' "Закрыть — ${2}" ;;
      reopen) printf '%s' "Открыть заново — ${2}" ;;            history) printf '%s' "История изменений — ${2}" ;;
      comment) printf '%s' "Комментарий — ${2}" ;;              attachments) printf '%s' "Вложения — ${2}" ;;
      approve) printf '%s' "Утвердить — ${2}" ;;                priority) printf '%s' "Сменить приоритет — ${2}" ;;
    esac
  }
  big_ok() {
    case "$1" in
      list) printf '%s' "'200': {description: страница списка}" ;;   create) printf '%s' "'201': {description: создано}" ;;
      get) printf '%s' "'200': {description: найдено}" ;;            update) printf '%s' "'200': {description: изменено}" ;;
      delete) printf '%s' "'204': {description: удалено}" ;;         export) printf '%s' "'202': {description: выгрузка поставлена в очередь}" ;;
      assign) printf '%s' "'200': {description: ответственный назначен}" ;; close) printf '%s' "'200': {description: закрыто}" ;;
      reopen) printf '%s' "'200': {description: открыто заново}" ;;  history) printf '%s' "'200': {description: записи истории}" ;;
      comment) printf '%s' "'201': {description: комментарий добавлен}" ;; attachments) printf '%s' "'200': {description: список вложений}" ;;
      approve) printf '%s' "'200': {description: утверждено}" ;;     priority) printf '%s' "'200': {description: приоритет изменён}" ;;
    esac
  }
  {
    printf '%s\n' "openapi: 3.0.3" "info:" "  title: casedesk — рабочее место инспектора, REST для внешних рабочих мест" "  version: 1.4.0" \
                  "servers:" "  - url: /" "paths:"
    prev=""
    while IFS=$'\t' read -r mod op verb path opid code kind anchor limit; do
      [ -n "$mod" ] || continue
      [ "$path" = "$prev" ] || printf '%s\n' "  ${path}:"
      prev="$path"
      printf '%s\n' "    $(printf '%s' "$verb" | tr '[:upper:]' '[:lower:]'):" "      tags: [${mod}]" "      operationId: ${opid}" \
                    "      summary: $(big_summary "$op" "$(big_ru "$mod")")"
      [ "$op" != list ] || printf '%s\n' "      parameters:" "        - {name: page, in: query, schema: {type: integer}}" "        - {name: size, in: query, schema: {type: integer}}"
      printf '%s\n' "      responses:" "        $(big_ok "$op")"
    done <<< "$ROWS"
    # объявлены, но не реализованы никем — как в базе
    printf '%s\n' "  /api/desk/archive/{id}:" \
                  "    get:" "      tags: [archive]" "      operationId: getArchiveDesk" "      summary: Карточка дела из архива" \
                  "      responses:" "        '200': {description: найдено}" \
                  "  /api/desk/archive/{id}/restore:" \
                  "    post:" "      tags: [archive]" "      operationId: restoreArchiveDesk" "      summary: Вернуть дело из архива" \
                  "      responses:" "        '200': {description: возвращено}"
  } > "$RES/openapi.yaml"

  # один факт на метод: условие из ключа → исключение с кодом; остальное — заглушки сервиса
  for x in $BIG_MODS; do
    mod="${x%%:*}"; M="$(cap "$mod")"
    W="$J/v2/$mod/web"; mkdir -p "$W"
    {
      printf '%s\n' "package ru.kontrol.casedesk.v2.${mod}.web;" "" \
                    "import java.util.List;" "import org.springframework.http.ResponseEntity;" \
                    "import org.springframework.web.bind.annotation.RestController;" \
                    "import ru.kontrol.casedesk.api.${M}DeskApi;" \
                    "import ru.kontrol.casedesk.api.model.${M}DeskDto;" \
                    "import ru.kontrol.casedesk.v2.common.desk.DeskAccess;" \
                    "import ru.kontrol.casedesk.v2.common.desk.DeskConflictException;" \
                    "import ru.kontrol.casedesk.v2.common.desk.DeskForbiddenException;" \
                    "import ru.kontrol.casedesk.v2.common.desk.DeskLockedException;" \
                    "import ru.kontrol.casedesk.v2.common.desk.DeskNotFoundException;" \
                    "import ru.kontrol.casedesk.v2.common.desk.DeskValidationException;" "" \
                    "/**" " * Реализация интерфейса, который openapi-generator собирает из src/main/resources/openapi.yaml" \
                    " * (target/generated-sources). Пути и глаголы операций — там, здесь только поведение." " */" \
                    "@RestController" "public class ${M}DeskApiController implements ${M}DeskApi {" "" \
                    "  private final ${M}DeskService service;" "  private final DeskAccess access;" "" \
                    "  public ${M}DeskApiController(${M}DeskService service, DeskAccess access) {" \
                    "    this.service = service;" "    this.access = access;" "  }"
      while IFS=$'\t' read -r rmod op verb path opid code kind anchor limit; do
        [ "$rmod" = "$mod" ] || continue
        A="$anchor"; AC="$(cap "$anchor")"
        case "$op" in
          list) sig="ResponseEntity<List<${M}DeskDto>> ${opid}(Integer page, Integer size)"; ok="    return ResponseEntity.ok(service.page(page, size));" ;;
          create) sig="ResponseEntity<${M}DeskDto> ${opid}(${M}DeskDto body)"; ok="    return ResponseEntity.status(201).body(service.create(body));" ;;
          get) sig="ResponseEntity<${M}DeskDto> ${opid}(Long id)"; ok="    return ResponseEntity.ok(service.load(id));" ;;
          delete) sig="ResponseEntity<Void> ${opid}(Long id)"; ok="    service.delete(id);"$'\n'"    return ResponseEntity.noContent().build();" ;;
          export) sig="ResponseEntity<Void> ${opid}(Long id)"; ok="    service.enqueueExport(id);"$'\n'"    return ResponseEntity.accepted().build();" ;;
          history) sig="ResponseEntity<List<${M}DeskDto>> ${opid}(Long id)"; ok="    return ResponseEntity.ok(service.history(id));" ;;
          comment) sig="ResponseEntity<${M}DeskDto> ${opid}(Long id, ${M}DeskDto body)"; ok="    return ResponseEntity.status(201).body(service.update(id, body));" ;;
          attachments) sig="ResponseEntity<List<String>> ${opid}(Long id)"; ok="    return ResponseEntity.ok(service.attachments(id));" ;;
          *) sig="ResponseEntity<${M}DeskDto> ${opid}(Long id, ${M}DeskDto body)"; ok="    return ResponseEntity.ok(service.update(id, body));" ;;
        esac
        case "$kind" in
          P) cond="!access.allowed(\"${A}\")"; thr="DeskForbiddenException(\"нет права ${A}\")" ;;
          V) cond="body.get${AC}() == null"; thr="DeskValidationException(\"${A} обязателен\")" ;;
          N) cond="body.get${AC}() != null && body.get${AC}() > ${limit}"; thr="DeskValidationException(\"${A} больше ${limit}\")" ;;
          F) cond="service.load(id).get${AC}() == null"; thr="DeskNotFoundException(\"${A} не найден\")" ;;
          S) cond="service.load(id).get${AC}() != null"; thr="DeskConflictException(\"${A} уже заполнен\")" ;;
          L) cond="Boolean.TRUE.equals(service.load(id).get${AC}())"; thr="DeskLockedException(\"${A}: запись заблокирована\")" ;;
          NL) cond="service.load(id).get${AC}() >= ${limit}"; thr="DeskConflictException(\"${A} достиг ${limit}\")" ;;
          *) echo "неизвестный вид факта: $kind ($opid)" >&2; exit 1 ;;
        esac
        printf '%s\n' "" "  @Override" "  public ${sig} {" "    if (${cond}) {" "      throw new ${thr};" "    }" "$ok" "  }"
      done <<< "$ROWS"
      printf '%s\n' "}"
    } > "$W/${M}DeskApiController.java"
    {
      printf '%s\n' "package ru.kontrol.casedesk.v2.${mod}.web;" "" "import java.util.Collections;" "import java.util.List;" \
                    "import org.springframework.stereotype.Service;" "import ru.kontrol.casedesk.api.model.${M}DeskDto;" "" \
                    "@Service" "public class ${M}DeskService {" "" \
                    "  public List<${M}DeskDto> page(Integer page, Integer size) {" "    return Collections.emptyList();" "  }" "" \
                    "  public ${M}DeskDto load(Long id) {" "    return new ${M}DeskDto();" "  }" "" \
                    "  public ${M}DeskDto create(${M}DeskDto body) {" "    return body;" "  }" "" \
                    "  public ${M}DeskDto update(Long id, ${M}DeskDto body) {" "    return body;" "  }" "" \
                    "  public void delete(Long id) {" "  }" "" \
                    "  public void enqueueExport(Long id) {" "  }" "" \
                    "  public List<${M}DeskDto> history(Long id) {" "    return Collections.emptyList();" "  }" "" \
                    "  public List<String> attachments(Long id) {" "    return Collections.emptyList();" "  }" "}"
    } > "$W/${M}DeskService.java"
  done
  printf '%s\n' "package ru.kontrol.casedesk.v2.common.desk;" "" "import org.springframework.http.HttpStatus;" \
                "import org.springframework.web.bind.annotation.ResponseStatus;" "" \
                "@ResponseStatus(code = HttpStatus.valueOf(403))" \
                "public class DeskForbiddenException extends RuntimeException {" \
                "  public DeskForbiddenException(Object detail) {" "    super(String.valueOf(detail));" "  }" "}" > "$X/DeskForbiddenException.java"
  printf '%s\n' "package ru.kontrol.casedesk.v2.common.desk;" "" \
                "import org.springframework.security.core.Authentication;" \
                "import org.springframework.security.core.context.SecurityContextHolder;" \
                "import org.springframework.stereotype.Component;" "" \
                "/** Права рабочего места: строка права сверяется с полномочиями текущего пользователя. */" \
                "@Component" "public class DeskAccess {" "" \
                "  public boolean allowed(String authority) {" \
                "    Authentication auth = SecurityContextHolder.getContext().getAuthentication();" \
                "    return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));" \
                "  }" "}" > "$X/DeskAccess.java"
fi

# --- 3. pom.xml: генератор интерфейсов из спецификации ---------------------------------------
awk '{ print } /graphql-dgs-codegen-maven-plugin/ {
  print "    <plugin><groupId>org.openapitools</groupId><artifactId>openapi-generator-maven-plugin</artifactId>"
  print "      <configuration><inputSpec>${project.basedir}/src/main/resources/openapi.yaml</inputSpec><generatorName>spring</generatorName>"
  print "        <apiPackage>ru.kontrol.casedesk.api</apiPackage><modelPackage>ru.kontrol.casedesk.api.model</modelPackage>"
  print "        <configOptions><interfaceOnly>true</interfaceOnly></configOptions></configuration></plugin>"
}' "$R/pom.xml" > "$R/pom.xml.tmp" && mv "$R/pom.xml.tmp" "$R/pom.xml"

# Клиентская спека рядом с серверной: расширение, часть имён операций и путей совпадают.
if [ "$VARIANT" = --with-client ]; then
  cat > "$RES/neighbour.yaml" <<'EOF'
openapi: 3.0.3
info:
  title: neighbour — удалённый каталог
  version: 1.0.0
paths:
  /api/desk/groups:
    get:
      operationId: listGroupsDesk
      responses:
        '200': {description: группы соседа}
    post:
      operationId: createGroupsDesk
      responses:
        '201': {description: группа соседа создана}
  /api/desk/groups/{id}:
    get:
      operationId: getGroupsDesk
      responses:
        '200': {description: группа соседа}
    put:
      operationId: updateGroupsDesk
      responses:
        '200': {description: группа соседа обновлена}
  /api/neighbour/limits/{id}:
    get:
      operationId: getNeighbourLimit
      responses:
        '200': {description: лимит соседа}
    delete:
      operationId: deleteNeighbourLimit
      responses:
        '204': {description: лимит соседа удалён}
EOF
  awk '{ print } /graphql-dgs-codegen-maven-plugin/ {
    print "    <plugin><groupId>org.openapitools</groupId><artifactId>openapi-generator-maven-plugin</artifactId>"
    print "      <configuration><inputSpec>${project.basedir}/src/main/resources/neighbour.yaml</inputSpec><generatorName>java</generatorName>"
    print "        <apiPackage>ru.kontrol.neighbour.client.api</apiPackage><library>resttemplate</library></configuration></plugin>"
  }' "$R/pom.xml" > "$R/pom.xml.tmp" && mv "$R/pom.xml.tmp" "$R/pom.xml"
  mkdir -p "$J/integration"
  cat > "$J/integration/NeighbourGateway.java" <<'EOF'
package ru.kontrol.casedesk.integration;

import org.springframework.stereotype.Service;
import ru.kontrol.neighbour.client.api.DefaultApi;

@Service
public class NeighbourGateway {
  private final DefaultApi client;
  public NeighbourGateway(DefaultApi client) { this.client = client; }
  public Object groups() { return client.listGroupsDesk(); }
  public Object limit(Long id) { return client.getNeighbourLimit(id); }
}
EOF
fi

# --- 4. тесты: конфиг с четырьмя топиками той же формы, что боевой ----------------------------
TR="$R/src/test/resources"; TJ="$R/src/test/java/ru/kontrol/casedesk"; mkdir -p "$TR" "$TJ"
printf '%s\n' "spring:" "  datasource:" "    url: jdbc:h2:mem:casedesk" \
              "casedesk:" "  kafka:" "    bootstrap-servers: localhost:9092" "    consumers:" \
              "      intake:" "        group-id: casedesk-test" "        topics:" \
              "          - kontrol.test.intake.v1" "          - kontrol.test.reopen.v1" \
              "    producers:" "      case-status:" "        topic: kontrol.test.status.v1" \
              "      finding:" "        topic: kontrol.test.finding.v1" > "$TR/application.yaml"
printf '%s\n' "package ru.kontrol.casedesk;" "" "import org.junit.jupiter.api.Test;" \
              "import org.springframework.boot.test.context.SpringBootTest;" "" \
              "@SpringBootTest" "class CasedeskApplicationTests {" "" "  @Test" "  void contextLoads() {" "  }" "}" > "$TJ/CasedeskApplicationTests.java"

# --- 5. владение по файлу (--owners): то, на чём нарезка теряла ключи и двоила сущности -------------
#   а) ручки JAX-RS (`@Path` + `@GET`) в папках `v2/inspectors/web`, `v2/regions/web` — без других пометок;
#      регистрирует их конфиг Jersey в `v2/config`. Маркеры Spring и спецификации их не видят;
#   б) общие сущности `InspectorEntity`, `RegionEntity`, `OfficeEntity` лежат в этих же папках, а
#      возвращают их ещё и ручки модулей `checks` и `findings` (Spring, с пометками);
#   в) `AuditedEntity` (`@MappedSuperclass`, `v2/common/persistence`) даёт `id`, `createdAt`, `updatedAt`,
#      `createdBy` трём общим сущностям и трём сущностям модулей (`sanctions`, `templates`, `groups`).
#   Правда: контракт 156 (148 + 6 ручек JAX-RS + 2 ручки модулей), сущности 66 (60 + 6), задачи и топики — как в базе.
if [ "$VARIANT" = --owners ]; then
  P="ru.kontrol.casedesk.v2"
  jfile() { mkdir -p "$(dirname "$1")"; cat > "$1"; }
  jfile "$J/v2/common/persistence/AuditedEntity.java" <<EOF
package $P.common.persistence;

import java.time.OffsetDateTime;
import javax.persistence.Column;
import javax.persistence.GeneratedValue;
import javax.persistence.Id;
import javax.persistence.MappedSuperclass;

/** Общие поля журнала изменений: их наследуют сущности, которые ведут аудит. */
@MappedSuperclass
public abstract class AuditedEntity {

  @Id
  @GeneratedValue
  private Long id;

  @Column(name = "created_at", nullable = false, updatable = false)
  private OffsetDateTime createdAt;

  @Column(name = "updated_at")
  private OffsetDateTime updatedAt;

  @Column(name = "created_by", nullable = false, updatable = false)
  private String createdBy;

  public Long getId() {
    return id;
  }
}
EOF
  # entity <модуль> <Класс> <таблица> <поле:тип>…
  entity() {
    local m="$1" cls="$2" tbl="$3"; shift 3
    {
      printf '%s\n' "package $P.$m.model.entity;" "" "import javax.persistence.Column;" "import javax.persistence.Entity;" \
                    "import javax.persistence.Table;" "import lombok.Getter;" "import lombok.Setter;" \
                    "import $P.common.persistence.AuditedEntity;" "" \
                    "@Getter" "@Setter" "@Entity" "@Table(name = \"$tbl\", schema = \"casedesk\")" "public class $cls extends AuditedEntity {" ""
      for f in "$@"; do printf '%s\n' "  @Column(name = \"${f%%:*}\")" "  private ${f#*:} ${f%%:*};" ""; done
      printf '%s\n' "}"
    } | jfile "$J/v2/$m/model/entity/$cls.java"
  }
  entity inspectors InspectorEntity cd_inspector "login:String" "fullName:String" "active:Boolean"
  entity regions RegionEntity cd_region "code:String" "title:String"
  entity regions OfficeEntity cd_office "regionCode:String" "address:String"
  entity sanctions SanctionAppealEntity cd_sanction_appeal "reason:String" "decision:String"
  entity templates TemplateVersionEntity cd_template_version "number:Integer" "body:String"
  entity groups GroupMemberEntity cd_group_member "login:String" "memberRole:String"
  for r in "inspectors:Inspector" "regions:Region" "regions:Office"; do
    m="${r%%:*}"; e="${r#*:}"
    jfile "$J/v2/$m/repository/${e}Repository.java" <<EOF
package $P.$m.repository;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import $P.$m.model.entity.${e}Entity;

public interface ${e}Repository extends JpaRepository<${e}Entity, Long> {

  List<${e}Entity> findAllByIdIn(List<Long> ids);
}
EOF
  done
  jfile "$J/v2/inspectors/web/InspectorResource.java" <<EOF
package $P.inspectors.web;

import java.util.List;
import javax.ws.rs.GET;
import javax.ws.rs.NotFoundException;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import org.springframework.stereotype.Component;
import $P.inspectors.model.entity.InspectorEntity;
import $P.inspectors.repository.InspectorRepository;

@Component
@Path("/api/desk/inspectors")
@Produces("application/json")
public class InspectorResource {

  private final InspectorRepository inspectors;

  public InspectorResource(InspectorRepository inspectors) {
    this.inspectors = inspectors;
  }

  /** Список инспекторов; уволенные (active = false) не отдаются. */
  @GET
  public List<InspectorEntity> list(@QueryParam("login") String login) {
    return inspectors.findAll().stream().filter(i -> Boolean.TRUE.equals(i.getActive())).toList();
  }

  @GET
  @Path("/{id}")
  public InspectorEntity get(@PathParam("id") Long id) {
    return inspectors.findById(id).orElseThrow(() -> new NotFoundException("Инспектор не найден"));
  }

  /** Включить или выключить инспектора; выключенный пропадает из списков назначения. */
  @PUT
  @Path("/{id}/activity")
  public InspectorEntity changeActivity(@PathParam("id") Long id, @QueryParam("active") boolean active) {
    InspectorEntity i = get(id);
    i.setActive(active);
    return inspectors.save(i);
  }

  @GET
  @Path("/by-ids/{ids}")
  public List<InspectorEntity> byIds(@PathParam("ids") List<Long> ids) {
    return inspectors.findAllByIdIn(ids);
  }
}
EOF
  jfile "$J/v2/regions/web/RegionCatalogResource.java" <<EOF
package $P.regions.web;

import java.util.List;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import org.springframework.stereotype.Component;
import $P.regions.model.entity.OfficeEntity;
import $P.regions.model.entity.RegionEntity;
import $P.regions.repository.OfficeRepository;
import $P.regions.repository.RegionRepository;

@Component
@Path("/api/desk/regions")
@Produces("application/json")
public class RegionCatalogResource {

  private final RegionRepository regions;
  private final OfficeRepository offices;

  public RegionCatalogResource(RegionRepository regions, OfficeRepository offices) {
    this.regions = regions;
    this.offices = offices;
  }

  /** Справочник регионов, по коду. */
  @GET
  @Path("/catalog")
  public List<RegionEntity> catalog() {
    return regions.findAll();
  }

  @GET
  @Path("/{code}/offices")
  public List<OfficeEntity> offices(@PathParam("code") String code) {
    return offices.findAll().stream().filter(o -> code.equals(o.getRegionCode())).toList();
  }
}
EOF
  jfile "$J/v2/config/JerseyConfig.java" <<EOF
package $P.config;

import org.glassfish.jersey.server.ResourceConfig;
import org.springframework.context.annotation.Configuration;
import $P.inspectors.web.InspectorResource;
import $P.regions.web.RegionCatalogResource;

@Configuration
public class JerseyConfig extends ResourceConfig {

  public JerseyConfig() {
    register(InspectorResource.class);
    register(RegionCatalogResource.class);
  }
}
EOF
  jfile "$J/v2/checks/web/CheckAssigneeController.java" <<EOF
package $P.checks.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import $P.inspectors.model.entity.InspectorEntity;
import $P.inspectors.repository.InspectorRepository;

@RestController
@RequestMapping("/api/desk/checks")
public class CheckAssigneeController {

  private final InspectorRepository inspectors;

  public CheckAssigneeController(InspectorRepository inspectors) {
    this.inspectors = inspectors;
  }

  /** Инспектор, назначенный на проверку; не назначен — 204. */
  @GetMapping("/{id}/assignee")
  public InspectorEntity assignee(@PathVariable Long id) {
    return inspectors.findById(id).orElse(null);
  }
}
EOF
  jfile "$J/v2/findings/web/FindingRegionController.java" <<EOF
package $P.findings.web;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import $P.regions.model.entity.OfficeEntity;
import $P.regions.model.entity.RegionEntity;
import $P.regions.repository.OfficeRepository;
import $P.regions.repository.RegionRepository;

@RestController
@RequestMapping("/api/desk/findings")
public class FindingRegionController {

  private final RegionRepository regions;
  private final OfficeRepository offices;

  public FindingRegionController(RegionRepository regions, OfficeRepository offices) {
    this.regions = regions;
    this.offices = offices;
  }

  /** Регион нарушения и его отделения. */
  @GetMapping("/{id}/region")
  public List<OfficeEntity> region(@PathVariable Long id) {
    RegionEntity r = regions.findById(id).orElseThrow();
    return offices.findAll().stream().filter(o -> r.getCode().equals(o.getRegionCode())).toList();
  }
}
EOF
  awk '{ print } /<dependencies>/ && !done { print "    <dependency>"; print "      <groupId>org.springframework.boot</groupId>"; print "      <artifactId>spring-boot-starter-jersey</artifactId>"; print "    </dependency>"; done = 1 }' "$R/pom.xml" > "$R/pom.xml.tmp" && mv "$R/pom.xml.tmp" "$R/pom.xml"
fi

# --- 6. сквозные факты (--crosscut): роли, переходы и отправки лежат там, где их используют ----------
#   Модуль «проверки на месте» (`v2/inspections`) и его следы в чужих пакетах:
#   а) статус `InspectionStatus` (PLANNED, STARTED, PAUSED, FINISHED, CANCELLED) ставят сервис модуля,
#      задача `v2/scheduling` (PAUSED → CANCELLED) и потребитель `v2/integration` (STARTED → PAUSED);
#   б) роли: `@PreAuthorize` на ручках (PLANNER, INSPECTOR, SUPERVISOR), правило по шаблону пути
#      `/api/admin/**` → ADMIN в `v2/config/SecurityConfig`, проверка «руководитель проверки» (роль
#      участника `InspectorRole.LEAD`) в сервисном слое; одна ручка без проверки;
#   в) отправки: событие «проверка начата» — общим отправителем `v2/integration/producer`; «проверка
#      завершена» — строкой outbox, рассылает задача `v2/outbox`; письмо по шаблону `inspection-report`;
#   г) копия статуса в журнале `InspectionHistoryEntity` (без переходов), справочник `Urgency` (имя без
#      суффикса, без переходов), клиент к соседу `registry-service` (Feign), БД и брокер — не соседи.
#   Правда: контракт 155 (148 + 7), сущности 64 (60 + 4), задачи 12 (10 + 2), топики 15 (12 + 3).
if [ "$VARIANT" = --crosscut ]; then
  P="ru.kontrol.casedesk.v2"
  jfile() { mkdir -p "$(dirname "$1")"; cat > "$1"; }
  I="$J/v2/inspections"
  jfile "$I/model/InspectionStatus.java" <<EOF
package $P.inspections.model;

/** Ход проверки на месте. */
public enum InspectionStatus {
  PLANNED, STARTED, PAUSED, FINISHED, CANCELLED
}
EOF
  jfile "$I/model/Urgency.java" <<EOF
package $P.inspections.model;

/** Срочность проверки — для сортировки списка. */
public enum Urgency { LOW, HIGH }
EOF
  jfile "$I/model/InspectorRole.java" <<EOF
package $P.inspections.model;

/** Роль инспектора в составе конкретной проверки. */
public enum InspectorRole {
  LEAD,
  MEMBER,
  OBSERVER
}
EOF
  jfile "$I/model/entity/InspectionEntity.java" <<EOF
package $P.inspections.model.entity;

import java.time.OffsetDateTime;
import javax.persistence.*;
import lombok.Getter;
import lombok.Setter;
import $P.inspections.model.InspectionStatus;
import $P.inspections.model.Urgency;

@Getter
@Setter
@Entity
@Table(name = "cd_inspection", schema = "casedesk")
public class InspectionEntity {

  @Id
  @GeneratedValue
  private Long id;

  @Column(name = "title", nullable = false)
  private String title;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false)
  private InspectionStatus status;

  @Enumerated(EnumType.STRING)
  @Column(name = "urgency")
  private Urgency urgency;

  @Column(name = "started_at")
  private OffsetDateTime startedAt;
}
EOF
  jfile "$I/model/entity/InspectionMemberEntity.java" <<EOF
package $P.inspections.model.entity;

import javax.persistence.*;
import lombok.Getter;
import lombok.Setter;
import $P.inspections.model.InspectorRole;

@Getter
@Setter
@Entity
@Table(name = "cd_inspection_member", schema = "casedesk")
public class InspectionMemberEntity {

  @Id
  @GeneratedValue
  private Long id;

  @Column(name = "inspection_id", nullable = false)
  private Long inspectionId;

  @Column(name = "login", nullable = false)
  private String login;

  @Enumerated(EnumType.STRING)
  @Column(name = "role", nullable = false)
  private InspectorRole role;
}
EOF
  jfile "$I/model/entity/InspectionHistoryEntity.java" <<EOF
package $P.inspections.model.entity;

import java.time.OffsetDateTime;
import javax.persistence.*;
import lombok.Getter;
import lombok.Setter;
import $P.inspections.model.InspectionStatus;

/** Журнал смены статусов: статус переписывается из проверки как есть. */
@Getter
@Setter
@Entity
@Table(name = "cd_inspection_history", schema = "casedesk")
public class InspectionHistoryEntity {

  @Id
  @GeneratedValue
  private Long id;

  @Column(name = "inspection_id", nullable = false)
  private Long inspectionId;

  @Enumerated(EnumType.STRING)
  @Column(name = "status", nullable = false)
  private InspectionStatus status;

  @Column(name = "changed_at", nullable = false)
  private OffsetDateTime changedAt;
}
EOF
  for e in Inspection InspectionMember InspectionHistory; do
    jfile "$I/repository/${e}Repository.java" <<EOF
package $P.inspections.repository;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import $P.inspections.model.entity.${e}Entity;

public interface ${e}Repository extends JpaRepository<${e}Entity, Long> {

  List<${e}Entity> findAllByOrderByIdDesc();
}
EOF
  done
  jfile "$I/service/InspectionAccess.java" <<EOF
package $P.inspections.service;

import org.springframework.stereotype.Component;
import $P.inspections.model.InspectorRole;
import $P.inspections.repository.InspectionMemberRepository;

/** Кто в составе проверки может её завершить. */
@Component
public class InspectionAccess {

  private final InspectionMemberRepository members;

  public InspectionAccess(InspectionMemberRepository members) {
    this.members = members;
  }

  public boolean isLead(String login, Long inspectionId) {
    return members.findAll().stream()
        .anyMatch(m -> m.getInspectionId().equals(inspectionId) && m.getLogin().equals(login) && m.getRole() == InspectorRole.LEAD);
  }
}
EOF
  jfile "$I/service/InspectionService.java" <<EOF
package $P.inspections.service;

import java.time.OffsetDateTime;
import java.util.Map;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import $P.integration.producer.InspectionEventPublisher;
import $P.inspections.model.InspectionStatus;
import $P.inspections.model.Urgency;
import $P.inspections.model.entity.InspectionEntity;
import $P.inspections.model.entity.InspectionHistoryEntity;
import $P.inspections.repository.InspectionHistoryRepository;
import $P.inspections.repository.InspectionRepository;
import $P.notifications.MailSender;
import $P.outbox.model.OutboxRecordEntity;
import $P.outbox.repository.OutboxRecordRepository;

@Service
public class InspectionService {

  private final InspectionRepository inspections;
  private final InspectionHistoryRepository history;
  private final InspectionAccess access;
  private final InspectionEventPublisher events;
  private final OutboxRecordRepository outbox;
  private final MailSender mail;

  public InspectionService(InspectionRepository inspections, InspectionHistoryRepository history, InspectionAccess access,
      InspectionEventPublisher events, OutboxRecordRepository outbox, MailSender mail) {
    this.inspections = inspections;
    this.history = history;
    this.access = access;
    this.events = events;
    this.outbox = outbox;
    this.mail = mail;
  }

  @Transactional
  public InspectionEntity create(String title, Urgency urgency) {
    InspectionEntity e = new InspectionEntity();
    e.setTitle(title);
    e.setUrgency(urgency);
    e.setStatus(InspectionStatus.PLANNED);
    return record(inspections.save(e));
  }

  @Transactional
  public InspectionEntity start(Long id) {
    InspectionEntity e = inspections.findById(id).orElseThrow();
    if (e.getStatus() != InspectionStatus.PLANNED && e.getStatus() != InspectionStatus.PAUSED) {
      throw new IllegalStateException("начать можно только запланированную или приостановленную проверку");
    }
    e.setStatus(InspectionStatus.STARTED);
    e.setStartedAt(OffsetDateTime.now());
    events.publishStarted(e);
    return record(e);
  }

  @Transactional
  public InspectionEntity pause(Long id) {
    InspectionEntity e = inspections.findById(id).orElseThrow();
    e.setStatus(InspectionStatus.PAUSED);
    return record(e);
  }

  @Transactional
  public InspectionEntity finish(Long id, String login) {
    if (!access.isLead(login, id)) {
      throw new AccessDeniedException("завершить проверку может только её руководитель");
    }
    InspectionEntity e = inspections.findById(id).orElseThrow();
    e.setStatus(InspectionStatus.FINISHED);
    outbox.save(new OutboxRecordEntity("inspection-finished", String.valueOf(e.getId()), e.getTitle()));
    mail.sendTemplate("inspection-report", login, Map.of("title", e.getTitle()));
    return record(e);
  }

  @Transactional
  public InspectionEntity cancel(Long id) {
    InspectionEntity e = inspections.findById(id).orElseThrow();
    if (e.getStatus() == InspectionStatus.FINISHED) {
      throw new IllegalStateException("завершённую проверку отменить нельзя");
    }
    e.setStatus(InspectionStatus.CANCELLED);
    return record(e);
  }

  private InspectionEntity record(InspectionEntity e) {
    InspectionHistoryEntity h = new InspectionHistoryEntity();
    h.setInspectionId(e.getId());
    h.setStatus(e.getStatus());
    h.setChangedAt(OffsetDateTime.now());
    history.save(h);
    return e;
  }
}
EOF
  jfile "$I/web/InspectionController.java" <<EOF
package $P.inspections.web;

import java.security.Principal;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import $P.inspections.model.Urgency;
import $P.inspections.model.entity.InspectionEntity;
import $P.inspections.repository.InspectionRepository;
import $P.inspections.service.InspectionService;

@RestController
@RequestMapping("/api/inspections")
public class InspectionController {

  private final InspectionService service;
  private final InspectionRepository inspections;

  public InspectionController(InspectionService service, InspectionRepository inspections) {
    this.service = service;
    this.inspections = inspections;
  }

  /** Запланировать проверку. */
  @PostMapping
  @PreAuthorize("hasRole('PLANNER')")
  public InspectionEntity create(@RequestParam String title, @RequestParam Urgency urgency) {
    return service.create(title, urgency);
  }

  /** Карточка проверки — открыта всем. */
  @GetMapping("/{id}")
  public InspectionEntity get(@PathVariable Long id) {
    return inspections.findById(id).orElseThrow();
  }

  /** Начать проверку. */
  @PostMapping("/{id}/start")
  @PreAuthorize("hasRole('INSPECTOR')")
  public InspectionEntity start(@PathVariable Long id) {
    return service.start(id);
  }

  /** Приостановить проверку. */
  @PostMapping("/{id}/pause")
  @PreAuthorize("hasAnyRole('INSPECTOR', 'SUPERVISOR')")
  public InspectionEntity pause(@PathVariable Long id) {
    return service.pause(id);
  }

  /** Завершить проверку. */
  @PostMapping("/{id}/finish")
  public InspectionEntity finish(@PathVariable Long id, Principal user) {
    return service.finish(id, user.getName());
  }

  /** Отменить проверку. */
  @PostMapping("/{id}/cancel")
  @PreAuthorize("hasRole('SUPERVISOR')")
  public InspectionEntity cancel(@PathVariable Long id) {
    return service.cancel(id);
  }
}
EOF
  jfile "$I/web/InspectionAdminController.java" <<EOF
package $P.inspections.web;

import java.util.Map;
import org.springframework.web.bind.annotation.*;
import $P.inspections.repository.InspectionRepository;

@RestController
@RequestMapping("/api/admin/inspections")
public class InspectionAdminController {

  private final InspectionRepository inspections;

  public InspectionAdminController(InspectionRepository inspections) {
    this.inspections = inspections;
  }

  /** Сколько проверок всего. */
  @GetMapping("/stats")
  public Map<String, Long> stats() {
    return Map.of("total", inspections.count());
  }
}
EOF
  jfile "$I/client/RegistryClient.java" <<EOF
package $P.inspections.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

/** Реестр лиц: ФИО и организация инспектора по логину. */
@FeignClient(name = "registry-service", url = "\${clients.registry.url}")
public interface RegistryClient {

  @GetMapping("/persons/{login}")
  String person(@PathVariable("login") String login);
}
EOF
  jfile "$J/v2/config/SecurityConfig.java" <<EOF
package $P.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

  @Bean
  public SecurityFilterChain chain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(a -> a
        .requestMatchers("/api/admin/**").hasRole("ADMIN")
        .anyRequest().permitAll());
    return http.build();
  }
}
EOF
  jfile "$J/v2/integration/producer/InspectionEventPublisher.java" <<EOF
package $P.integration.producer;

import org.apache.kafka.clients.producer.ProducerRecord;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.kafka.sender.KafkaSender;
import reactor.kafka.sender.SenderRecord;
import $P.integration.config.KafkaTopicsProperties;
import $P.inspections.model.entity.InspectionEntity;

/** Отправитель событий о проверках. Ключ сообщения — номер проверки. */
@Component
public class InspectionEventPublisher {

  private final KafkaSender<String, String> sender;
  private final String startedTopic;

  public InspectionEventPublisher(KafkaSender<String, String> sender, KafkaTopicsProperties props) {
    this.sender = sender;
    this.startedTopic = props.producer("inspection-started").getTopic();
  }

  public void publishStarted(InspectionEntity e) {
    String body = "{\"inspectionId\":" + e.getId() + ",\"title\":\"" + e.getTitle() + "\",\"startedAt\":\"" + e.getStartedAt() + "\"}";
    sender.send(Mono.just(SenderRecord.create(new ProducerRecord<>(startedTopic, String.valueOf(e.getId()), body), e.getId()))).subscribe();
  }
}
EOF
  jfile "$J/v2/integration/consumer/InspectionHaltProcessor.java" <<EOF
package $P.integration.consumer;

import org.springframework.stereotype.Component;
import reactor.kafka.receiver.ReceiverOptions;
import $P.integration.config.KafkaTopicsProperties;
import $P.inspections.model.InspectionStatus;
import $P.inspections.repository.InspectionRepository;

/** Группа «inspection-halt»: внешний сигнал остановить идущую проверку. */
@Component
public class InspectionHaltProcessor extends BaseEventProcessor {

  private final InspectionRepository inspections;

  public InspectionHaltProcessor(KafkaTopicsProperties props, ReceiverOptions<String, String> base, InspectionRepository inspections) {
    super(props.consumer("inspection-halt"), base);
    this.inspections = inspections;
  }

  @Override
  protected void handle(String topic, String payload) {
    Long id = Long.valueOf(payload.trim());
    inspections.findById(id).ifPresent(e -> {
      if (e.getStatus() == InspectionStatus.STARTED) {
        e.setStatus(InspectionStatus.PAUSED);
        inspections.save(e);
      }
    });
  }
}
EOF
  jfile "$J/v2/scheduling/InspectionTimeoutJob.java" <<EOF
package $P.scheduling;

import java.time.OffsetDateTime;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import $P.inspections.model.InspectionStatus;
import $P.inspections.repository.InspectionRepository;

/** Приостановленная больше семи дней проверка отменяется. */
@Component
public class InspectionTimeoutJob {

  private final InspectionRepository inspections;

  public InspectionTimeoutJob(InspectionRepository inspections) {
    this.inspections = inspections;
  }

  @Scheduled(cron = "0 0 2 * * *")
  @Transactional
  public void run() {
    OffsetDateTime border = OffsetDateTime.now().minusDays(7);
    inspections.findAll().stream()
        .filter(e -> e.getStatus() == InspectionStatus.PAUSED && e.getStartedAt() != null && e.getStartedAt().isBefore(border))
        .forEach(e -> e.setStatus(InspectionStatus.CANCELLED));
  }
}
EOF
  jfile "$J/v2/outbox/model/OutboxRecordEntity.java" <<EOF
package $P.outbox.model;

import java.time.OffsetDateTime;
import javax.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** Отложенная отправка: пишется в той же транзакции, что изменение, рассылается задачей. */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "cd_outbox", schema = "casedesk")
public class OutboxRecordEntity {

  @Id
  @GeneratedValue
  private Long id;

  @Column(name = "producer", nullable = false)
  private String producer;

  @Column(name = "message_key", nullable = false)
  private String messageKey;

  @Column(name = "payload", nullable = false)
  private String payload;

  @Column(name = "sent_at")
  private OffsetDateTime sentAt;

  public OutboxRecordEntity(String producer, String messageKey, String payload) {
    this.producer = producer;
    this.messageKey = messageKey;
    this.payload = payload;
  }
}
EOF
  jfile "$J/v2/outbox/repository/OutboxRecordRepository.java" <<EOF
package $P.outbox.repository;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import $P.outbox.model.OutboxRecordEntity;

public interface OutboxRecordRepository extends JpaRepository<OutboxRecordEntity, Long> {

  List<OutboxRecordEntity> findTop100BySentAtIsNullOrderByIdAsc();
}
EOF
  jfile "$J/v2/outbox/OutboxRelayJob.java" <<EOF
package $P.outbox;

import java.time.OffsetDateTime;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.kafka.sender.KafkaSender;
import reactor.kafka.sender.SenderRecord;
import $P.integration.config.KafkaTopicsProperties;
import $P.outbox.model.OutboxRecordEntity;
import $P.outbox.repository.OutboxRecordRepository;

/** Рассылка outbox: по сто строк раз в полминуты; строка помечается отправленной после ответа брокера. */
@Component
public class OutboxRelayJob {

  private final OutboxRecordRepository outbox;
  private final KafkaSender<String, String> sender;
  private final KafkaTopicsProperties props;

  public OutboxRelayJob(OutboxRecordRepository outbox, KafkaSender<String, String> sender, KafkaTopicsProperties props) {
    this.outbox = outbox;
    this.sender = sender;
    this.props = props;
  }

  @Scheduled(fixedDelay = 30000)
  public void run() {
    for (OutboxRecordEntity r : outbox.findTop100BySentAtIsNullOrderByIdAsc()) {
      String topic = props.producer(r.getProducer()).getTopic();
      sender.send(Mono.just(SenderRecord.create(new ProducerRecord<>(topic, r.getMessageKey(), r.getPayload()), r.getId())))
          .doOnComplete(() -> { r.setSentAt(OffsetDateTime.now()); outbox.save(r); })
          .subscribe();
    }
  }
}
EOF
  jfile "$J/v2/notifications/MailSender.java" <<EOF
package $P.notifications;

import java.util.Map;
import org.springframework.stereotype.Component;

/** Письма по шаблонам почтового шлюза. */
@Component
public class MailSender {

  public void sendTemplate(String template, String login, Map<String, Object> params) {
    // шлюз берёт адрес по логину; шаблон — имя письма в шлюзе
  }
}
EOF
  awk '
    /^    producers:/ { print; inprod = 1; next }
    inprod && /^logging:/ { print "      inspection-started:"; print "        topic: kontrol.inspection.started.v1"; print "      inspection-finished:"; print "        topic: kontrol.inspection.finished.v1"; inprod = 0 }
    /^    consumers:/ { print; print "      inspection-halt:"; print "        group-id: casedesk-inspection"; print "        topics:"; print "          - kontrol.inspection.halt.v1"; next }
    { print }
    END { print "clients:"; print "  registry:"; print "    url: http://registry-service:8080" }' "$RES/application.yaml" > "$RES/application.yaml.tmp" && mv "$RES/application.yaml.tmp" "$RES/application.yaml"
fi

# --- числа по собранному дереву --------------------------------------------------------------
c() { grep -rhoE "$1" "$2" --include="${3:-*.java}" 2>/dev/null | wc -l | tr -d ' '; }
ops=$(grep -cE '^      operationId:' "$RES/openapi.yaml")
impl=$(grep -rhA1 '@Override' "$J"/v2/*/web/*DeskApiController.java | grep -cE 'Desk\(')
echo "SM-MONO-SPEC собрана: $R"
echo "  java-файлов:                 $(find "$R/src/main" -name '*.java' | wc -l | tr -d ' ') (+ $(find "$R/src/test" -name '*.java' | wc -l | tr -d ' ') в src/test)"
echo "  операций в openapi.yaml:     $ops, из них реализовано $impl, без реализации $((ops - impl))"
echo "  REST по аннотациям:          $(c '@(Get|Post|Put|Patch|Delete)Mapping\(' "$R/src/main")"
echo "  DGS корневых операций:       $(( $(c '@Dgs(Query|Mutation|Subscription)\b' "$R/src/main") + $(c '@DgsData\(parentType\s*=\s*"(Query|Mutation|Subscription)"' "$R/src/main") ))"
jx=$(grep -rhoE '^  @(GET|POST|PUT|PATCH|DELETE)$' "$R/src/main" --include='*.java' | wc -l | tr -d ' ')
echo "  контракт всего:              $(( impl + jx +$(c '@(Get|Post|Put|Patch|Delete)Mapping\(' "$R/src/main") + $(c '@Dgs(Query|Mutation|Subscription)\b' "$R/src/main") + $(c '@DgsData\(parentType\s*=\s*"(Query|Mutation|Subscription)"' "$R/src/main") ))"
[ "$VARIANT" != --owners ] || echo "  ручек JAX-RS:                $jx; сущностей с базовым классом: $(grep -rl 'extends AuditedEntity' "$J" | wc -l | tr -d ' ')"
[ "$VARIANT" != --with-client ] || echo "  операций клиентской спеки:  $(grep -cE '^      operationId:' "$RES/neighbour.yaml") (не контракт)"
[ "$VARIANT" != --big-spec ] || echo "  фактов-анкеров спеки:        $(printf '%s\n' "$ROWS" | awk -F'\t' 'NF { n++; k[$6]++ } END { printf "%d —", n; for (c = 400; c < 500; c++) if (c in k) printf " %d×%d", c, k[c] }') (ключ big-spec-key.tsv, в дерево не едет)"
echo "  сущности / задачи:           $(c '@Entity\b' "$R/src/main") / $(c '@Scheduled\(' "$R/src/main")"
echo "  топиков в боевом конфиге:    $(grep -coE 'kontrol\.[a-z]+\.[a-z]+\.v1' "$RES/application.yaml"); в тестовом: $(grep -coE 'kontrol\.[a-z]+\.[a-z]+\.v1' "$TR/application.yaml")"
