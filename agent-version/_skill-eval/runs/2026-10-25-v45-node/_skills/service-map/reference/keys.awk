# keys.awk — ключ по шаблону (card.template.md, «Ключи строк»), один для assemble.sh и check.sh.
# Только функции: скрипт ставит текст файла впереди своей awk-программы.
#
# Ключ блока по классу: «контракт» — метод и путь (одно слово: пометка после пробела в ключ не входит) без
# строки запроса (хвост после «?», в котором нет «/») либо тип операции и имя без аргументов; «топики» — направление и топик: топик — текст в бэктиках,
# без них — единственное слово после направления; общая обвязка брокера — «транспорт» и имя тем же
# правилом; «сущности», «задачи» — имя одним словом. Заголовок,
# который к ключу не сводится, — "" (вызывающий берёт его как есть и называет «ключ не опознан»).

function k_norm(s,   v) {
  gsub(/`/, "", s); gsub(/«|»/, "", s); gsub(/\r/, "", s)
  sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); gsub(/[ \t]+/, " ", s)
  v = s; sub(/ .*/, "", v)
  if (toupper(v) ~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/) s = toupper(v) substr(s, length(v) + 1)
  return s
}
function k_canon(cls, h,   k, d, rest) {
  k = k_norm(h)
  if (cls == "контракт") {
    if (k ~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /) {   # путь — одно слово: пометка после пробела не ключ
      d = k; sub(/ .*/, "", d); rest = substr(k, length(d) + 2); sub(/ .*/, "", rest); k = d " " rest
      if (match(k, /\?[^\/]*$/)) k = substr(k, 1, RSTART - 1); return k
    }
    if (k ~ /^(query|mutation|subscription|rpc) /) { sub(/[ ]*\(.*\)$/, "", k); return k }
    if (k ~ /^[A-Za-z_][A-Za-z0-9_.]*[.\/][A-Za-z_][A-Za-z0-9_]*(\(.*\))?$/) return k
    return ""
  }
  if (cls == "топики") {
    d = k; sub(/ .*/, "", d)
    if (d !~ /^(публикует|потребляет|транспорт)$/) return ""
    if (match(h, /`[^`]+`/)) return d " " substr(h, RSTART + 1, RLENGTH - 2)
    rest = substr(k, length(d) + 2)
    return (rest != "" && rest !~ / /) ? d " " rest : ""
  }
  if (cls == "сущности" || cls == "задачи") return (k != "" && k !~ / /) ? k : ""
  return k
}
# Ключ строки описи: класс — по виду строки (у описи секций нет); не сводится — как есть. Вызов соседа
# («Потребляемые API»: `<сервис> <вызов>` или `<сервис> :: <вызов>`) — тот же ключ, что у строки карточки:
# `<сервис> :: <вызов>`.
function k_opis(h,   k, c, s) {
  k = k_norm(h)
  if (k ~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|query|mutation|subscription|rpc) /) { c = k_canon("контракт", h); return c == "" ? k : c }
  if (k ~ /^(публикует|потребляет|транспорт) /) { c = k_canon("топики", h); return c == "" ? k : c }
  if (k ~ /^[^ :]+( ::)? (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|query|mutation|subscription|rpc) /) {
    s = k; sub(/[ :].*$/, "", s); c = substr(k, length(s) + 1); sub(/^( ::)? /, "", c)
    return s " :: " k_opis(c)
  }
  return k
}
# Регистр — только у латиницы. toupper/tolower gawk под Windows (локаль C) меняют и байты кириллицы, и строка
# с ними после склейки обрывается: у текста карточки регистр меняют только эти две.
function k_up(s,   r, i, c) { r = ""; for (i = 1; i <= length(s); i++) { c = substr(s, i, 1); r = r ((c >= "a" && c <= "z") ? toupper(c) : c) } return r }
function k_low(s,   r, i, c) { r = ""; for (i = 1; i <= length(s); i++) { c = substr(s, i, 1); r = r ((c >= "A" && c <= "Z") ? tolower(c) : c) } return r }
# Строка описи без отступа, которая не ключ, а факт: соседи, строки «Бизнес-правил», роли.
function k_fact(h) { return h ~ /^(зависит|состояние|справочник|сообщение|ограничение|роль|Роль):/ }
# Ключ контракта вызовом («query night(id)», «Dome.Close(Req)») без скобок; у HTTP — как есть.
function k_bare(k) { if (k ~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /) return k; if (k ~ /[^ (]\(.*\)$/) sub(/\(.*\)$/, "", k); return k }
# Форма по типу — как таблица порядка секций шаблона (card.template.md; сверяет проба SM-PLAN-TYPES).
# Секция → класс пометок разведчика; у типа — его секции классов; секции частей — те, что пишут части
# нарезки (brief-part.md) и склеивает assemble.sh. Тип режется, только если все его секции классов —
# секции частей. Тип неизвестен — всё как у любого: классы все, нарезка по весу.
function k_cls(sec) {
  sub(/^## +/, "", sec)
  if (sec ~ /^Публичный (контракт|API)/) return "контракт"
  if (sec ~ /^Владеет данными/) return "сущности"
  if (sec ~ /^Фоновые задачи/) return "задачи"
  if (sec ~ /^События/) return "топики"
  if (sec ~ /^Экраны/) return "экраны"
  if (sec ~ /^Бизнес-правила/) return "бизнес"
  if (sec ~ /^Роли и доступ/) return "роли"
  if (sec ~ /^Зависит от/) return "зависит"
  if (sec ~ /^Потребляемые API/) return "потребляет"
  if (sec ~ /^Состояние и данные/) return "состояние"
  return ""
}
function k_partsec(sec) { sub(/^## +/, "", sec); return sec ~ /^(Публичный контракт|Владеет данными|События|Фоновые задачи|Потребляемые API)/ }
function k_typesecs(t) {
  if (t == "backend") return "Публичный контракт|События|Фоновые задачи|Владеет данными"
  if (t == "frontend") return "Экраны|Потребляемые API|Состояние и данные"
  if (t == "fullstack") return "Публичный контракт|События|Фоновые задачи|Владеет данными|Экраны|Потребляемые API|Состояние и данные"
  if (t == "lib") return "Публичный API"
  return ""
}
function k_typehas(t, c,   s, n, i) {
  if (c == "клиенты" || k_typesecs(t) == "") return 1
  n = split(k_typesecs(t), s, "|"); for (i = 1; i <= n; i++) if (k_cls(s[i]) == c) return 1
  return 0
}
function k_typesplit(t,   s, n, i) {
  n = split(k_typesecs(t), s, "|"); for (i = 1; i <= n; i++) if (!k_partsec(s[i])) return 0
  return 1
}
# Сведённый ключ гарда — для второго прохода сверки, только среди ключей без точной пары: то же, записанное
# в двух сканах по-разному, сводится к одному. Роль — имя без области в скобках.
function k_role(k) { sub(/[ \t]*\(.*$/, "", k); return k }
# Сосед — без пояснения в скобках и без обвязки клиента, как в правиле имени шаблона («Как в коде»):
# `client.skycam-legacy.host`, `SKYCAM_LEGACY_URL`, `SkycamLegacyClient` → `skycam-legacy`.
function k_dep(k,   r, i, c, p) {
  sub(/[ \t]*\(.*$/, "", k); r = ""; p = ""
  for (i = 1; i <= length(k); i++) { c = substr(k, i, 1); if (c >= "A" && c <= "Z" && ((p >= "a" && p <= "z") || (p >= "0" && p <= "9"))) r = r "-"; r = r c; p = c }
  r = k_low(r); gsub(/_/, "-", r)
  sub(/^clients?\./, "", r); sub(/^web-?client-?/, "", r)   # `client-portal` — имя соседа, его не трогаем
  while (sub(/[.-](host|url|uri|endpoint|base-url)$/, "", r)) ;
  sub(/-client$/, "", r)
  return r
}
# Путь контракта — без общего префикса приложения: «GET /api/nights» при префиксе `api` → «GET /nights».
function k_nopre(k, pre,   v, p) {
  if (k !~ /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//) return k
  p = pre; gsub(/\/+/, "/", p); sub(/\/$/, "", p); if (p !~ /^\//) p = "/" p; if (p == "/") return k
  v = k; sub(/ .*/, "", v); k = substr(k, length(v) + 2)
  if (k == p) return v " /"
  if (substr(k, 1, length(p) + 1) == p "/") return v " " substr(k, length(p) + 1)
  return v " " k
}
