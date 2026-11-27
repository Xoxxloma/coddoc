// grade-sm-real.mjs — проба `sm-real`: service-map на настоящем коде (repairy + resonance).
// Ключ ответов — fixtures/SM-REAL/KEY.md, числа там считаны грепом по источникам.
//
//   node agent-version/_skill-eval/grade-sm-real.mjs <папка-раунда> [ещё-раунды…]
//
// Грейдится ФАЙЛ на диске (services/*.md), а не формулировка отчёта: первый же прогон показал,
// что отчёт Шага 6 расходится с собственной карточкой («20 экранов» при 23, «все с фактами»
// при 12 пустых блоках).
//
// ЧИСЛОВЫЕ АНКЕРЫ ПИШУТСЯ С ГРАНИЦЕЙ `(^|[^0-9])`. Без неё альтернатива `5 мин` совпала с хвостом
// строки `JWT на 15 мин` и дала анкеру «подпись живёт 300 с» ложный зелёный (2026-08-24).
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const KEY = {
  'repairy-api': { endpoints: 96, entities: 20, jobs: 1, topics: 0, roles: 5 },
  'repairy-web': { screens: 24 },
}

// 14 фактов, ни один не лежит в файле эндпоинта. Грейдится факт, а не формулировка.
const ANCHORS = [
  ['подпись S3 живёт 300 с',      /\b300\b|(^|[^0-9])5 мин|PRESIGN_TTL/i],
  ['белый список MIME',           /ALLOWED_MIME|бел[ыо][йм] списк|image\/jpeg/i],
  ['гонка номера акта → 409',     /P2002|409[^\n]*(акт|номер|повтор)|повтор[^\n]*409/i],
  ['unique (projectId, number)',  /projectId, ?number/i],
  ['removedAt вместо удаления',   /removedAt/],
  ['выборки фильтруют removedAt', /removedAt:\s*null/i],
  // 2026-10-22: та же мысль другими словами — «склейка» (сущ.), «без паузы» / «приёмка 0», «запись живёт 10 минут»
  // (600 с); анкеры перегнаны по всем сравниваемым раундам этим же грейдером.
  ['склейка уведомлений',         /debounce|склеива|склейк|окно ожидан/i],
  ['окна 45 / 120 / 180 с',       /(^|[^0-9])45 ?сек|(^|[^0-9])120 ?сек|(^|[^0-9])180 ?сек/i],
  ['приёмки без задержки',        /без задержк|без пауз|(^|[^0-9])0 ?(мс|сек)|немедленн|приёмк[а-яё]* 0(?![0-9])/i],
  ['лимит 10 в час',              /(^|[^0-9])10[^\n]*час|час[^\n]*(^|[^0-9])10/i],
  ['очередь в Redis, TTL 600',    /\b600\b|QUEUE_TTL|(запис|очеред)[^\n]*(^|[^0-9])10 ?мин/i],
  ['cron */30',                   /\*\/30/],
  ['@unique на ключевых полях',   /unique|уникальн/i],
  ['410 Gone на истёкшей сессии', /\b410\b|Gone/],
]

// Бизнес-слой: то, что читает business-requirements-doc (description, «Назначение», «Что умеет»).
// Жалоба с поля — «карточка слишком техническая, БТ-агенту мало о том, что делает сервис».
// Анкеры — KEY.md §7; каждый ищется ДВАЖДЫ: в бизнес-слое (то, что читает БТ-скилл) и в карточке
// целиком. Разница двух чисел — факт, который в карточке есть, но лежит там, куда БТ не смотрит.
// Кириллица — через [а-яё]: `\w` в JS её не ловит даже с флагом u.
const BIZ_ANCHORS = [
  ['A1 в акт только работы на 100 %', /((^|[^0-9])100\s*%|полност[а-яё]*\s+выполн|completedVolume\s*>=?\s*totalVolume)[\s\S]{0,200}(при[её]мк|acceptance|акт[аеуы]?\s)|(при[её]мк|acceptance)[\s\S]{0,200}((^|[^0-9])100\s*%|полност[а-яё]*\s+выполн|completedVolume\s*>=?\s*totalVolume)/i],
  ['A2 отклонённая работа сдаётся снова', /(отклон[а-яё]*|REJECTED)[\s\S]{0,150}(NONE|возвращ|снова|повторн|заново|можно[\s\S]{0,20}отправ)/i],
  ['A3 права: только прораб/руководитель', /(только|лишь)\s+(прораб|FOREMAN|руковод|владел|OWNER)[\s\S]{0,80}(редактир|измен|управл|приглаш|добавл|удал)|(WORKER|рабоч[а-яё]*)[\s\S]{0,120}(не\s+может|нельзя|без\s+прав)/i],
  ['A4 последний прораб → руководитель', /(прораб|FOREMAN)[\s\S]{0,200}(переназнач|переход|станов|назнача|подтягива|reassign)[\s\S]{0,120}(владел|руковод|OWNER)|reassignForemanToOwner/i],
  ['A5 исключённому — только новый инвайт', /(исключ[её]н|удал[её]н|сн[яи]т)[а-яё]*[\s\S]{0,200}(нов[а-яё]*\s+приглаш|повторн[а-яё]*\s+приглаш|мастер-?ссылк|inviteToken|общ[а-яё]*\s+ссылк)/i],
  ['A6 публичная ссылка скрывает телефоны/цены', /(публичн[а-яё]*|без\s+(входа|авторизац|регистрац|логин)|publicToken|\/p\/)[\s\S]{0,300}(телефон|phone|цен[аыу]?\s+за\s+единиц|pricePerUnit|скры|не\s+(показ|видн|отда))/i],
  ['A7 история сметы: дельта и итог', /(истори[а-яё]*\s+(изменени[а-яё]*\s+)?смет|estimate.?history|EstimateChangeLog|журнал[а-яё]*\s+(изменений\s+)?смет)[\s\S]{0,300}(delta|дельт|разниц|totalAfter|итог[а-яё]*\s+после|сумм[а-яё]*\s+после)/i],
  ['A8 автор не получает; один канал', /(автор[а-яё]*|инициатор[а-яё]*|excludeUserId)[\s\S]{0,100}(не\s+получа|исключа|кроме)|(кроме|за\s+исключением)\s+(самого\s+)?(автор|инициатор)|(один|выбранн?[а-яё]*|предпочт[а-яё]*)\s+канал/i],
]
// Секции, которые читает business-requirements-doc (плюс description и заметки команды).
const BIZ_SECTIONS = ['Заметки команды', 'Назначение', 'Что умеет для пользователя', 'Бизнес-правила', 'Экраны', 'Роли и доступ']
// «Бизнес-правила» (шаг 4 плана): блок на сущность с перечислением/датами и на вид сообщения.
// KEY.md §1: объектов 8 (10 перечислений минус два справочника RoomType/AttachmentType), сообщений 14.
// Считается по карточке: блоки, строки, токены не из «Владеет данными».
const KEY_RULES = { objects: 8, messages: 14 }
// Кодовый регистр в бизнес-секции: бэктики, пути, HTTP-глаголы, camelCase-идентификаторы.
const CODEISH = /`|(^|\s)\/[a-z]|\b(GET|POST|PUT|PATCH|DELETE)\b|\b[a-z]+[A-Z][A-Za-z]*\b/

// Появление любого = модель дописала пример из скилла вместо чтения кода.
const POISON = [/ЧОП/, /ГБР/, /ГОСБ/, /\/v1\/incidents/, /\bchi\b/, /Kafka/, /shipping/, /ТТН/]

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const section = (t, name) => {
  const out = []
  let on = false
  for (const l of t.split('\n')) {
    if (l.startsWith('## ')) { on = l.trim() === `## ${name}`; continue }
    if (on) out.push(l)
  }
  return out.join('\n')
}
const blocks = (t) => {
  const res = []
  let cur = null
  for (const l of t.split('\n')) {
    if (l.startsWith('### ')) { if (cur) res.push(cur); cur = { key: l.slice(4).replace(/`/g, '').trim(), facts: 0, ent: null, purpose: null } }
    else if (cur) {
      if (l.startsWith('- ')) cur.facts++
      else if (/^сущности:/.test(l)) cur.ent = l
      else if (cur.purpose === null && l.trim()) cur.purpose = l
    }
  }
  if (cur) res.push(cur)
  return res
}
const cmp = (got, want) => (got === want ? '✅' : '❌') + ` ${got}/${want}`

function grade(runDir, label) {
  const svc = join(runDir, 'w', 'AI-SDD', 'services')
  const api = read(join(svc, 'repairy-api.md'))
  const web = read(join(svc, 'repairy-web.md'))
  if (!api && !web) { console.log(`${label}: карточек нет — НЕ ИЗМЕРЕНО`); return null }

  const contract = blocks(section(api, 'Публичный контракт'))
  const ents = blocks(section(api, 'Владеет данными'))
  const jobs = blocks(section(api, 'Фоновые задачи'))
  const topics = blocks(section(api, 'События'))
  // Строка `без входа` — круг «кто угодно», её требует шаблон (card.template.md) при открытых ручках; ролью кода
  // она не считается, поэтому в число ролей KEY не входит.
  const roles = section(api, 'Роли и доступ').split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-|Роль/.test(l) && !/^\|\s*`?без входа`?\s*\|/.test(l))
  // Роль засчитывается ПО ИМЕНИ: строка «неавторизованный — просмотр по publicToken» законна и
  // сверх пяти имён не штрафуется (stab1/scan-3), а счёт строк красил её в «6/5».
  const ROLE_NAMES = ['OWNER', 'EMPLOYEE', 'CUSTOMER', 'FOREMAN', 'WORKER']
  const rolesNamed = ROLE_NAMES.filter((n) => new RegExp('\\b' + n + '\\b').test(section(api, 'Роли и доступ')))
  // Роут `*` (NotFound) входит в 24 по KEY.md §1; регэксп «строка начинается с `/`» его терял, и
  // полные 24 экрана красились в «23/24» (sonnet-base, все прогоны).
  const screens = section(web, 'Экраны').split('\n').filter((l) => /^\|\s*`?(\/|\*)/.test(l))
  // `GET /metrics` регистрирует модуль prometheus без декоратора в src — по KEY.md §1 назвать его не
  // дефект, не назвать тоже. Поэтому в сверку с 96 он не идёт ни в ту, ни в другую сторону.
  const metricsExtra = contract.filter((b) => /^GET\s+(\/api)?\/?(metrics|docs)$/i.test(b.key)).length
  const endpoints = contract.length - metricsExtra

  // ФОРМА. Нарушение формы прячется в полноте: сущности таблицей читаются как «0 сущностей», экраны
  // блоками — как «0 экранов». Поэтому форма считается отдельно и называется словами.
  const heads = (t) => (t.match(/^## .+$/gm) || []).map((h) => h.slice(3).trim())
  const FRONT_ONLY = ['Экраны', 'Потребляемые API', 'Состояние и данные']
  const BACK_ONLY = ['Публичный контракт', 'События', 'Фоновые задачи', 'Владеет данными']
  const form = []
  const entSec = section(api, 'Владеет данными')
  if (api && !ents.length && /^\|/m.test(entSec)) form.push('сущности таблицей')
  if (api && !heads(api).includes('Фоновые задачи')) form.push('api без «Фоновых задач»')
  if (web && /^### /m.test(section(web, 'Экраны'))) form.push('экраны блоками')
  const foreignApi = heads(api).filter((h) => FRONT_ONLY.includes(h))
  const foreignWeb = heads(web).filter((h) => BACK_ONLY.includes(h))
  if (foreignApi.length) form.push(`в api чужие секции: ${foreignApi.join(', ')}`)
  if (foreignWeb.length) form.push(`в web чужие секции: ${foreignWeb.join(', ')}`)
  const extra = existsSync(svc) ? readdirSync(svc).filter((f) => !['manifest.yaml', 'repairy-api.md', 'repairy-web.md'].includes(f)) : []
  if (extra.length) form.push(`лишние файлы в services/: ${extra.join(', ')}`)

  // Честный отказ: карточки api нет, а в ответе человеку сервис назван как несобранный. Не годный,
  // но и не провал — правило двух попыток сработало (golden/scan-8).
  const answer = read(join(runDir, 'answer.md'))
  const refusal = !api && /repairy-api[^\n]*(не записан|не удалось|исчерпан|не собран|слишком большой)/i.test(answer)

  // ВЫДУМАННЫЕ КЛЮЧИ. Порог «эндпоинтов ≥ 94» считает блоки и не видит блок, которого в коде нет:
  // 96 настоящих + 1 достроенный по аналогии CRUD прошли как годный прогон (r9-repeat/scan-3,
  // `GET /projects/:pid/rooms/:rid/works/:id`). Сверка — с роутами из копии кода в ЭТОЙ песочнице.
  const normRoute = (p) => ('/' + p).replace(/\/+/g, '/').replace(/\/$/, '').replace(/:[A-Za-z]+|\{[A-Za-z]+\}/g, ':p') || '/'
  const srcRoot = join(runDir, 'w', 'repairy-api', 'src')
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])
  const codeRoutes = new Set()
  if (existsSync(srcRoot)) for (const f of walk(srcRoot).filter((x) => x.endsWith('.controller.ts'))) {
    const t = readFileSync(f, 'utf8')
    const pre = (t.match(/@Controller\(\s*['"`]?([^'"`)]*)['"`]?\s*\)/) || [, ''])[1]
    for (const m of t.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)) codeRoutes.add(m[1].toUpperCase() + ' ' + normRoute(pre + '/' + (m[2] || '')))
  }
  // `GET /metrics` регистрирует модуль @willsoto/nestjs-prometheus без декоратора в src — по KEY.md §1
  // названный `/metrics` дефектом не считается, поэтому он в роуты кода добавляется явно.
  if (codeRoutes.size) codeRoutes.add('GET /metrics')
  // `GET /docs` — SwaggerModule.setup('docs') в main.ts, тоже без декоратора: настоящий маршрут (biz4d scan-3/7).
  if (codeRoutes.size) codeRoutes.add('GET /docs')
  const invented = codeRoutes.size ? contract.map((b) => b.key).filter((k) => {
    const m = k.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/)
    return m && !codeRoutes.has(m[1] + ' ' + normRoute(m[2].replace(/^\/?api(?=\/)/, '')))
  }) : []

  // Сущность засчитывается в ЛЮБОЙ из двух форм: отдельной строкой (редакции 2–3) или в назначении
  // (редакция 4). Иначе сравнение редакций мерило бы форму, а не наличие связи «ручка → сущность».
  const names = ents.map((e) => e.key).filter(Boolean)
  const nameRe = names.length ? new RegExp('\b(' + names.join('|') + ')\b') : /$^/
  const inPurpose = (b) => !!b.purpose && (nameRe.test(b.purpose) || /не сущность/i.test(b.purpose))
  const named = contract.filter((b) => b.ent || inPurpose(b))
  const withEnt = contract.filter((b) => b.ent)
  const kind = (re) => withEnt.filter((b) => re.test(b.ent)).length
  const empty = contract.filter((b) => b.facts === 0)
  const emptyNotWhole = empty.filter((b) => b.ent && !/целиком/i.test(b.ent))
  const facts = contract.reduce((s, b) => s + b.facts, 0)
  const hits = ANCHORS.filter(([, re]) => re.test(api))
  const poisoned = POISON.filter((re) => re.test(api) || re.test(web))
  const ticks = (api.match(/^### `/gm) || []).length

  console.log(`\n=== ${label} ===`)
  console.log(`  скилл: ${(() => { const p = join(runDir, '..', '..', '_skills', 'service-map.SKILL.md'); return existsSync(p) ? readFileSync(p, 'utf8').split('\n').length + ' строк' : 'снимка нет' })()}`)
  console.log('  ПОЛНОТА')
  console.log(`    эндпоинты   ${cmp(endpoints, KEY['repairy-api'].endpoints)}${metricsExtra ? '  (+ GET /metrics вне сверки)' : ''}`)
  console.log(`    сущности    ${cmp(ents.length, KEY['repairy-api'].entities)}`)
  console.log(`    задачи      ${cmp(jobs.length, KEY['repairy-api'].jobs)}`)
  console.log(`    топики      ${cmp(topics.length, KEY['repairy-api'].topics)}  (брокера в репе нет — любой блок это выдумка)`)
  console.log(`    роли        ${cmp(roles.length, KEY['repairy-api'].roles)}`)
  console.log(`    экраны      ${cmp(screens.length, KEY['repairy-web'].screens)}`)
  console.log('  СУЩНОСТИ У РУЧЕК')
  console.log(`    сущность названа       ${named.length}/${contract.length}   (отдельной строкой ${withEnt.length}, в назначении ${named.length - withEnt.length})`)
  console.log(`    целиком / проекция / не сущность: ${kind(/целиком/i)} / ${kind(/проекц/i)} / ${kind(/не сущность/i)}`)
  console.log('  ПЛОТНОСТЬ')
  console.log(`    строк-фактов в контракте  ${facts}`)
  // Форма 4.x: `доступ:`/`меняет:`/`шлёт:` у ручек — тоже содержание (кто вызывает, что меняет, что шлёт);
  // строками `- ` они не считаются, поэтому — отдельно, чтобы сравнение с раундами до 4.x не врало.
  const bind = section(api, 'Публичный контракт').split('\n').filter((l) => /^(доступ|меняет|шлёт):/.test(l) && !/^(меняет|шлёт): нет\s*$/.test(l)).length
  console.log(`    строк привязки (4.x)      ${bind}`)
  console.log(`    блоков с пустым телом     ${empty.length}`)
  console.log(`    из них НЕ помечены «целиком» (нарушение)  ${emptyNotWhole.length}`)
  console.log(`    анкеров                   ${hits.length}/${ANCHORS.length}`)
  const miss = ANCHORS.filter(([, re]) => !re.test(api)).map(([n]) => n)
  if (miss.length) console.log(`      нет: ${miss.join('; ')}`)
  console.log('  БИЗНЕС-СЛОЙ')
  const biz = {}
  for (const [name, t] of [['api', api], ['web', web]]) {
    const desc = (t.match(/^description:\s*(.*)$/m) || [, ''])[1]
    const purpose = section(t, 'Назначение').trim()
    const sentences = purpose ? purpose.split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 3).length : 0
    const caps = section(t, 'Что умеет для пользователя').split('\n')
      .filter((l) => /^\|/.test(l) && !/^\|\s*-|Возможность/.test(l))
    const codeish = caps.filter((l) => CODEISH.test(l.split('|')[1] || ''))
    const purposeCodeish = (purpose.match(/`[^`]+`/g) || []).length
    biz[name] = { purposeChars: purpose.length, caps: caps.length, purposeCodeish }
    console.log(`    ${name}: description ${desc.length} зн. · «Назначение» ${purpose.length} зн., предложений ${sentences}, имён в бэктиках ${purposeCodeish} · «Что умеет» строк ${caps.length}, с кодом ${codeish.length}`)
  }
  // Секция «Бизнес-правила»: блоки объектов (заголовок — имя сущности) и сообщений (`сообщение «…»`).
  const rulesSec = section(api, 'Бизнес-правила')
  const ruleBlocks = blocks(rulesSec)
  const msgBlocks = ruleBlocks.filter((b) => /^сообщение/i.test(b.key))
  // Третий вид блока (5.3): «ограничение «условие»» — внешнее условие, при котором сервис отказывает.
  const restrBlocks = ruleBlocks.filter((b) => /^ограничени/i.test(b.key))
  const objBlocks = ruleBlocks.filter((b) => !/^(сообщение|ограничени)/i.test(b.key))
  const entNames = new Set(ents.map((e) => e.key))
  // Ключ блока объекта — имя сущности до « — подпись».
  const objNotEntity = objBlocks.map((b) => b.key.split(/\s+—\s+/)[0].trim()).filter((k) => !entNames.has(k))
  // Токен в бэктиках внутри строк секции обязан встречаться в «Владеет данными» — иначе состояние выдумано.
  const entText = section(api, 'Владеет данными')
  // Токены сверяются только в блоках объектов: у сообщений токен — имя вида, его в сущностях нет законно.
  const objText = objBlocks.length ? rulesSec.split(/^### /m).filter((c) => !/^(сообщение|ограничени)/i.test(c)).join('\n### ') : ''
  const tokens = [...objText.matchAll(/^- [^`\n]*`([A-Za-z_][A-Za-z0-9_]*)`/gm)].map((m) => m[1])
  const badTokens = [...new Set(tokens.filter((t) => !entText.includes(t)))]
  // Строка на поле (5.3, гейт 3): первый токен строки — имя поля из «Владеет данными» (левая часть
  // «- поле: тип»), а не значение перечисления. Блок из таких строк — схема, а не правила.
  const fieldNames = new Set([...entText.matchAll(/^- `?([A-Za-z_][A-Za-z0-9_]*)`?\s*:/gm)].map((m) => m[1]))
  const fieldRows = tokens.filter((t) => fieldNames.has(t)).length
  const ruleRows = ruleBlocks.reduce((s, b) => s + b.facts, 0)
  // Хвост «— http/ShipmentController.kt» (формат строки описи, скопированный в карточку; тир A neutral-s4)
  // ловится отдельным шаблоном пути с расширением: ведущего слэша у него нет.
  const FILEPATH = /\b[\w.-]+\/[\w./-]+\.[a-z]{1,5}\b/
  const ruleCodeish = rulesSec.split('\n').filter((l) => /^- /.test(l) && (FILEPATH.test(l) || /(^|\s)\/[a-z]|\b(GET|POST|PUT|PATCH|DELETE)\b|\b[a-z]+[A-Z][A-Za-z]*\b/.test(l.replace(/`[^`]*`/g, '')))).length
  // Сообщения против «Событий»: каждый публикуемый топик — исходящее сообщение, блок обязан быть.
  const published = blocks(section(api, 'События')).filter((b) => /^публикует/i.test(b.key)).length
  const msgShort = Math.max(0, published - msgBlocks.length)
  if (api) console.log(`    бизнес-правила: объектов ${objBlocks.length}/${KEY_RULES.objects} · сообщений ${msgBlocks.length}/${KEY_RULES.messages} · строк ${ruleRows} · токенов не из «Владеет данными» ${badTokens.length}${badTokens.length ? ' (' + badTokens.slice(0, 4).join(', ') + ')' : ''} · объектов не-сущностей ${objNotEntity.length} · строк с кодом/файлом ${ruleCodeish} · публикуемых без блока сообщения ${msgShort} · ограничений ${restrBlocks.length} · строк на поле ${fieldRows}`)
  const layer = (t) => [(t.match(/^description:.*$/m) || [''])[0], ...BIZ_SECTIONS.map((s) => section(t, s))].join('\n')
  const bizLayer = layer(api) + '\n' + layer(web)
  const whole = api + '\n' + web
  const inLayer = BIZ_ANCHORS.filter(([, re]) => re.test(bizLayer)).map(([n]) => n)
  const inCard = BIZ_ANCHORS.filter(([, re]) => re.test(whole)).map(([n]) => n)
  console.log(`    бизнес-анкеров: в бизнес-слое ${inLayer.length}/${BIZ_ANCHORS.length} · в карточке где угодно ${inCard.length}/${BIZ_ANCHORS.length}`)
  const buried = inCard.filter((n) => !inLayer.includes(n))
  if (buried.length) console.log(`      есть, но вне бизнес-слоя: ${buried.join('; ')}`)
  const bizMiss = BIZ_ANCHORS.map(([n]) => n).filter((n) => !inCard.includes(n))
  if (bizMiss.length) console.log(`      нет вовсе: ${bizMiss.join('; ')}`)
  console.log('  ПРОЧЕЕ')
  console.log(`    отравление примерами   ${poisoned.length ? '⚠ ' + poisoned.map(String).join(' ') : 'чисто'}`)
  console.log(`    ключ в бэктиках        ${ticks}/${contract.length + ents.length + jobs.length + topics.length}`)
  const dirt = join(runDir, '_dirt.txt')
  console.log(`    караул чужих реп       ${existsSync(dirt) ? '⚠ ГРЯЗНО' : 'чисто'}`)
  console.log(`    форма                  ${form.length ? '⚠ ' + form.join('; ') : 'чисто'}`)
  // ГОДНЫЙ ПРОГОН — пороги PLAN-BUSINESS-LAYER.md, «Общие правила»: все условия сразу, по файлу.
  console.log(`    роли по именам         ${rolesNamed.length}/5${rolesNamed.length < 5 ? '  нет: ' + ROLE_NAMES.filter((n) => !rolesNamed.includes(n)).join(', ') : ''}`)
  // На деле ловит три дефекта ключа, а не только выдумку: неверный путь (`/api/rooms` вместо
  // `/projects/:pid/rooms`), склеенный заголовок (`GET /x, PUT /x`), достроенный по аналогии роут.
  // Все три ломают сверку по ключу между сканами — поэтому прогон не годный.
  console.log(`    ключи не из кода       ${invented.length ? '⚠ ' + invented.length + ': ' + invented.slice(0, 4).join('; ') + (invented.length > 4 ? '; …' : '') : 'нет'}`)
  const good = endpoints >= 94 && !invented.length && ents.length === 20 && rolesNamed.length === 5 && jobs.length === 1
    && empty.length * 2 < contract.length && !form.some((f) => !/^лишние файлы/.test(f))
  // СТРОКА ГЕЙТА (шаг 2 плана): ведущий перед Write пишет числа по карточке — в журнал и в отчёт.
  // Грейдится наличие строки и совпадение её чисел с файлом: отчёт, который врёт о своём артефакте,
  // уже был пойман на первом прогоне sm-real (N1). До шага 2 строки нет ни в одной редакции.
  const logs = answer + '\n' + read(join(runDir, 'w', 'AI-SDD', 'actions.log'))
  const gl = logs.split('\n').find((l) => /repairy-api/.test(l) && /блоков\s*\d+/.test(l) && /с\s*телом\s*\d+/.test(l))
  const gate = { line: !!gl, match: false }
  if (gl) {
    const n = (re) => { const m = gl.match(re); return m ? Number(m[1]) : NaN }
    gate.match = n(/блоков\s*(\d+)/) === contract.length && n(/с\s*телом\s*(\d+)/) === contract.length - empty.length
    console.log(`    строка гейта           есть, с файлом ${gate.match ? 'совпадает' : '⚠ РАСХОДИТСЯ'}: ${gl.trim().slice(0, 140)}`)
  } else console.log('    строка гейта           нет')
  console.log(`  ИТОГ: ${refusal ? 'ЧЕСТНЫЙ ОТКАЗ' : good ? 'ГОДНЫЙ' : 'не годный'}`)
  return {
    good, refusal, form, gate, invented,
    endpoints, entities: ents.length, roles: roles.length, screens: screens.length,
    facts, empty: empty.length, anchors: hits.length, named: named.length,
    techHits: hits.map(([n]) => n), inLayer, inCard, caps: biz.api.caps + biz.web.caps, purposeChars: biz.api.purposeChars,
    ruleObjects: objBlocks.length, ruleMessages: msgBlocks.length, ruleRows, ruleBadTokens: badTokens.length, ruleCodeish,
    apiLines: api ? api.split('\n').length : 0,
  }
}

// Сводка по раунду: разброс и стабильность каждого факта. Одна точка на редакцию не мерит ничего —
// на одном тексте плотность гуляла в 3.4 раза (2026-08-25-pool-base), поэтому правка сравнивается
// с КОРИДОРОМ эталона, а факт считается устойчивым, только если он доезжает почти во всех прогонах.
function summary(label, rs) {
  if (!rs.length) return
  const band = (k) => { const v = rs.map((r) => r[k]).sort((a, b) => a - b); return `${v[0]}…${v[v.length - 1]}, медиана ${v[Math.floor((v.length - 1) / 2)]}  [${rs.map((r) => r[k]).join(' ')}]` }
  const rate = (names, pick) => names.map((n) => `    ${String(rs.filter((r) => pick(r).includes(n)).length).padStart(2)}/${rs.length}  ${n}`).join('\n')
  console.log(`\n##### СВОДКА ${label} — измерено прогонов: ${rs.length}`)
  console.log(`  ГОДНЫХ ${rs.filter((r) => r.good).length} из ${rs.length} · честных отказов ${rs.filter((r) => r.refusal).length} · с нарушением формы ${rs.filter((r) => r.form.some((f) => !/^лишние файлы/.test(f))).length}`)
  console.log(`  с ключами не из кода ${rs.filter((r) => r.invented.length).length} из ${rs.length}`)
  console.log(`  строка гейта: есть ${rs.filter((r) => r.gate.line).length} из ${rs.length}, совпадает с файлом ${rs.filter((r) => r.gate.match).length} · записано с пустой половиной ${rs.filter((r) => r.endpoints && r.empty * 2 >= r.endpoints).length}`)
  for (const k of ['endpoints', 'entities', 'roles', 'screens', 'facts', 'empty', 'anchors', 'named', 'caps', 'purposeChars', 'ruleObjects', 'ruleMessages', 'ruleRows', 'ruleBadTokens', 'ruleCodeish', 'apiLines']) console.log(`  ${k.padEnd(13)} ${band(k)}`)
  console.log('  технические анкеры — в скольких прогонах доехал:')
  console.log(rate(ANCHORS.map(([n]) => n), (r) => r.techHits))
  console.log('  бизнес-анкеры в бизнес-слое:')
  console.log(rate(BIZ_ANCHORS.map(([n]) => n), (r) => r.inLayer))
  console.log('  бизнес-анкеры где угодно в карточке:')
  console.log(rate(BIZ_ANCHORS.map(([n]) => n), (r) => r.inCard))
}

const rounds = process.argv.slice(2)
if (!rounds.length) { console.error('нужен путь к папке раунда'); process.exit(1) }
for (const r of rounds) {
  const sb = join(r, 'sandbox')
  if (!existsSync(sb)) { console.log(`${r}: песочниц нет`); continue }
  const rs = []
  const dirs = readdirSync(sb).filter((f) => /^(re)?scan-/.test(f)).sort()
  // Брошенный в фоне прогон (см. ниже) в сводку метрик не идёт: его частичная карточка (scan-5
  // записал только web) тянет медианы вниз за дефект стенда, а не скилла.
  const BG_EARLY = /жд[уё]м?[^\n]*(уведомлен|субагент|заверш|результат)|ожида[юе][^\n]*(уведомлен|субагент|заверш|результат)|продолжу[^\n]*(как только|когда)[^\n]*(верн|заверш)/i
  const bgEarly = (d) => existsSync(join(sb, d, '_bg-abandoned.txt'))
    || (existsSync(join(sb, d, 'answer.md')) && BG_EARLY.test(readFileSync(join(sb, d, 'answer.md'), 'utf8').slice(-600)))
  for (const d of dirs) {
    if (bgEarly(d)) { console.log(`\n=== ${r.split(/[\/]/).pop()} / ${d} === брошено в фоне — НЕ ИЗМЕРЕНО`); continue }
    const res = grade(join(sb, d), `${r.split(/[\/]/).pop()} / ${d}`)
    if (res) rs.push({ ...res, dir: d })
  }
  summary(r.split(/[\/]/).pop(), rs)
  // Прогон без единой карточки в сводку метрик не идёт (мерить нечего), но из знаменателя «годных»
  // выпасть не имеет права: иначе раунд, где половина прогонов ничего не записала, выглядит лучше.
  // Знаменатель — только ЗАВЕРШЁННЫЕ прогоны: есть answer.md. Отказ API (`_api-failure.txt`) и ещё
  // идущий прогон — не измерены и в знаменатель не идут; иначе середина пула выглядит как провал.
  // Прогон, брошенный в фоне (sonnet-base scan-5/6): ведущий запустил субагентов и закончил ход словами
  // «жду уведомления», которого в `claude -p` не бывает. Это артефакт стенда, не скилла — как отказ
  // API, он не измерен и в знаменатель не идёт, но считается отдельно. Раннер с 2026-09-14 переносит
  // такой ответ в `_bg-abandoned.txt`; раунды, снятые раньше, узнаются по хвосту `answer.md` — тем же
  // регэкспом, что в run.sh, чтобы старые и новые раунды считались одинаково.
  const BG = /жд[уё]м?[^\n]*(уведомлен|субагент|заверш|результат)|ожида[юе][^\n]*(уведомлен|субагент|заверш|результат)|продолжу[^\n]*(как только|когда)[^\n]*(верн|заверш)/i
  const isAbandoned = (d) => existsSync(join(sb, d, '_bg-abandoned.txt'))
    || (existsSync(join(sb, d, 'answer.md')) && BG.test(readFileSync(join(sb, d, 'answer.md'), 'utf8').slice(-600)))
  const abandoned = dirs.filter(isAbandoned)
  const done = dirs.filter((d) => !isAbandoned(d) && existsSync(join(sb, d, 'answer.md')) && readFileSync(join(sb, d, 'answer.md'), 'utf8').trim())
  const measured = rs.filter((r) => !abandoned.includes(r.dir))
  const noCards = done.length - measured.length
  if (noCards > 0) console.log(`  ⚠ завершённых прогонов ${done.length}, из них без карточек ${noCards} — ГОДНЫХ ${measured.filter((x) => x.good).length} из ${done.length}`)
  if (abandoned.length) console.log(`  брошено в фоне (артефакт стенда, не измерено): ${abandoned.length} — ${abandoned.join(', ')}; частичные карточки таких прогонов в сводке выше НЕ учтены`)
  if (done.length < dirs.length) console.log(`  не измерено (отказ API, фон или ещё идёт): ${dirs.length - done.length}`)
}
