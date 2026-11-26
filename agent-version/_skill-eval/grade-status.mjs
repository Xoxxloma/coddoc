#!/usr/bin/env node
// grade-status.mjs — грейдер проб `ts-vac`, `ts-acc` (спека за один ход) и `ts-vac-q`, `ts-acc-q` (первый ход —
// только вопросы). Фикстуры `fixtures/TS-VAC/` (EMP-1207, отпуск, всё наше) и `fixtures/TS-ACC/` (ACS-208, доступ к
// системе, чужая система учёток `idm`). Источник правды — README фикстур: законный статус, таблица «Действия и
// условие по статусу», «Чего в спеке быть не должно», ловушки окружения.
//
//   node grade-status.mjs <плечо> [--q] [--fixture=TS-VAC|TS-ACC]
//   node grade-status.mjs --selftest
//
// Плечо — `<раунд>/<проба>/`, песочницы `run-N/`. `--q` — вопросная проба; без флага включается сам, если имя плеча
// кончается на `-q`. Фикстура — по ключу задачи в песочнице (`coddoc/EMP-1207/` → TS-VAC, `coddoc/ACS-208/` → TS-ACC),
// иначе по имени плеча; `--fixture=` перекрывает оба.
//
// ЧТО СЧИТАЕТСЯ (записывающие пробы), по прогону, потом сводкой по плечу:
//   1. Спека в `coddoc/<KEY>/technical_specification.md` — да/нет. Нет — что в ответе (вопросы, спека текстом, фантом,
//      отказ, пусто); по содержанию такой прогон не грейдится.
//   2. «Статус готовности» и его согласие с законным исходом README (TS-VAC — «Готово к разработке»; «Требуются
//      уточнения (N)» законно только при N = числу пунктов; TS-ACC — «Требуются уточнения (N≥1)»).
//   3. ЗАМЕР, не дефект: по каждому действию с условием по статусу — назван ли статусный отказ (код или описанный
//      отказ), лёг ли он в каталог ошибок, есть ли состояние UI, не выдан ли за 403/«нет прав» или за
//      проверку полей. Итог: есть / частично / нет / не опознано.
//   4. Лишнее: статусный отказ у действий без условия; переходы не из БТ; новые бизнес-статусы.
//   5. TS-ACC: конкретика карточки `idm` из таблицы ловушек — с цитатой и пометкой (🔵 / 🟡 / без пометки).
//   6. TS-ACC, FR-7: в UI «учётка неактивна» и нет кнопки «Отозвать доступ».
//   7. Прочие пункты README, которые надёжно ловятся поиском по тексту (ключ, стороны, FR в §7, переходы строками
//      §3.2, 🟡 по существующему, форма conventions, 🟡 авторизации в idm, частичный сбой, «Следующий шаг»).
//
// ЧТО СЧИТАЕТСЯ (вопросные пробы): файл спеки не создан; число вопросов; есть ли вопросы про ошибки по статусу,
// переходы, повторы, одновременность (счётчики, не запрет); вопросы о том, что уже закрыто в тексте БТ;
// TS-ACC — вопросы о форме из `context/conventions.md` и вопросы про `idm` (пересказом карточки или вхолодную).
//
// ПРАВИЛО «ВОПРОСА». Вопросов = A + B + C:
//   A — строка `answer.md`, где после выброса кодовых блоков, инлайн-кода и URL остался «?» (общее определение
//       `grade-gaps.mjs`, импортируется); две «?» в строке — один вопрос;
//   B — пункт без единого «?», который по форме вопрос: начинается меткой («Q1.», «В1.», «Вопрос 2», «Открытый
//       вопрос») либо несёт ≥2 варианта ответа и слово выбора («мой выбор», «предлагаю», «выберите», «вариант»,
//       «или»). Без B ответ «**Q1. …** (а) … (б) …» шестью вопросами считался бы нулём (ts-vac-q run-3);
//   C — вызов инструмента вопросов (`AskUserQuestion` и подобные) в потоке: по пункту на элемент
//       `input.questions[]` (нет массива — один). В сумму идут только вызовы без `tool_result` с `is_error`:
//       неудачный вызов до человека не дошёл, а модель обычно повторяет его текстом — иначе посчиталось бы дважды.
//       Неудачные вызовы печатаются справкой.
// Темы вопросов (статус, переходы, повтор, одновременность) ищутся по всему ответу первого хода — гипотезы «на
// подтверждение» тоже вопрос; переспрос закрытого в БТ — только в самом вопросительном предложении.
//
// ПРАВИЛА, НА КОТОРЫХ СТОИТ ФАЙЛ:
//   - поиск ПОВЕДЕНИЯ, а не формулировки: русские основы с вариантами окончаний, коды и машинные коды отказа,
//     пути с глаголом действия; к форме, которой ещё нет в скилле, грейдер не привязан;
//   - ложное срабатывание хуже пропуска: где не уверен — «не опознано», а не «нет»;
//   - регулярки — литералы; рядом с кириллицей нет `\b`, границы — явные `(?<![а-яё])`/`(?![а-яё])`;
//   - строка с несколькими кодами режется на сегменты по «; » — иначе 403 и 409 одной строки «Ошибки:» смешались бы;
//   - прогон без артефакта по вине стенда — «не измерено», из знаменателя выпадает.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { lines, codeFlags, questionLineIdx, median } from './grade-gaps.mjs'
import { normalizeSpecHeadings } from './spec-markdown.mjs'

// ─── Что грейдер НЕ судит — печатается в шапке каждого вывода ─────────────────────────────────

const MANUAL = [
  'правильность решений: годится ли выбранный код, механизм атомарной записи, длины и форматы полей;',
  'повтор того же действия против конфликта разных действий: какой ответ выбран на повтор (README: законны оба);',
  'гейты 1–10 по существу: карта сервисов, полнота инвентаря и контрактов (JSON, enum, null), 🔵-формулировки,',
  '  авторизация (текущий руководитель / владелец по справочнику, негативные случаи), данные (поля, старые строки,',
  '  индексы), синхронность и нагрузка, порядок выката, флаг, откат, §6.5;',
  'TS-VAC: zero/empty у числа в меню; запреты по роли или дате (отмена руководителем, отмена в день начала, правка',
  '  не-черновика как переход); вне объёма (уведомления, пересечения, остаток дней, удаление черновика);',
  'TS-ACC: `accountId`/`login`/`state` как поля запроса/ответа idm против своего имени в нашей сущности; письмо с',
  '  паролем, приписанное idm; законность каждой 🟡 сверх авторизации; трёхзначный enum учётки (печатается справкой);',
  'вопросные пробы: качество вопросов (гипотеза ли, хороши ли варианты); подтверждения «<факт из БТ>. Верно?» в',
  '  счётчик «закрыто в БТ» не идут (ищется только в вопросительном предложении); idm «вхолодную» — справка.',
]

// ─── Общие утилиты ────────────────────────────────────────────────────────────────────────────

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null)
const clip = (s, n = 150) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
const quote = (s, n) => `«${clip(s, n)}»`
/** Цитата вокруг первого совпадения `re`: длинная строка не обрезается на неважном начале. */
function around(s, re, n = 130) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  const m = re ? t.match(re) : null
  if (!m || t.length <= n) return quote(t, n)
  const from = Math.max(0, Math.min(m.index - Math.floor(n / 3), t.length - n))
  return `«${from > 0 ? '…' : ''}${t.slice(from, from + n)}${from + n < t.length ? '…' : ''}»`
}
// Центр цитаты статусного отказа: код, машинный код статуса, слова «статус»/«уже».
const RE_FOCUS = /(?<!\d)(409|412)(?!\d)|[A-Za-z_]*(status|state|STATUS|STATE|conflict|CONFLICT|already|ALREADY|INACTIVE)[A-Za-z_]*|статус|уже/
const bare = (l) => l.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')

const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit|hit your limit/i
function isApiFailure(text) {
  if (!text) return false
  return text.length < 600 ? RE_API_FAILURE.test(text) : RE_API_FAILURE.test(text.slice(0, 200))
}

function walk(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, base, acc)
    else acc.push(p.slice(base.length + 1).split('\\').join('/'))
  }
  return acc
}

/** Легенда шаблона несёт те же маркеры, что живые пометки. Строки не выбрасываются, а гасятся — номера строк целы. */
function blankLegend(text) {
  return lines(text).map((l) => (/^\s*>\s*(🟢|🔵|🟡|❓|⚠️)/.test(l) ? '' : l))
}

// ─── Фикстуры ─────────────────────────────────────────────────────────────────────────────────

// Статусы — по классу; регулярки с флагом g (для matchAll), границы явные. Латиница — с `_` как частью слова,
// чтобы `pending_approval` был одним токеном.
const ST_PENDING = /на\s+согласовани[еи](?![а-яё])|ожида[а-яё]*\s+(решени|согласовани)|жд[её]т\s+решени|(?<![A-Za-z_])(pending|submitted|on_approval|pending_approval|awaiting_approval|awaiting_decision|in_review|awaiting)(?![A-Za-z_])/gi
const ST_REJECTED = /(?<![а-яё])отклон[её]нн?(а|ая|ую|ой|ы|ые|ых|ое|ый|о)?(?![а-яё])|(?<![A-Za-z_])(rejected|declined)(?![A-Za-z_])/gi

const FX = {
  'TS-VAC': {
    key: 'EMP-1207',
    nFR: 10,
    expect: 'done',
    statuses: [
      ['draft', /черновик(а|е|у|ом|и|ов|ам|ами|ах)?(?![а-яё])|(?<![A-Za-z_])draft(?![A-Za-z_])/gi],
      ['pending', ST_PENDING],
      ['approved', /(?<![а-яё])согласован(а|ая|ую|ой|ы|ые|ых|ое|ый|о)?(?![а-яё])|(?<![A-Za-z_])approved(?![A-Za-z_])/gi],
      ['rejected', ST_REJECTED],
      ['withdrawn', /(?<![а-яё])отозван(а|ая|ую|ой|ы|ые|ых|ое|ый|о)?(?![а-яё])|(?<![A-Za-z_])(withdrawn|recalled|revoked)(?![A-Za-z_])/gi],
      ['cancelled', /(?<![а-яё])отмен[её]нн?(а|ая|ую|ой|ы|ые|ых|ое|ый|о)?(?![а-яё])|(?<![A-Za-z_])(cancell?ed)(?![A-Za-z_])/gi],
    ],
    // FR-2…FR-4, FR-8, FR-10: черновик → на согласовании → (отозвана | согласована | отклонена); согласована → отменена.
    allowed: ['draft>pending', 'pending>withdrawn', 'pending>approved', 'pending>rejected', 'approved>cancelled'],
    actions: {
      edit: { label: 'правка черновика', short: 'правка', cond: true },
      submit: { label: 'отправка на согласование', short: 'отправка', cond: true },
      withdraw: { label: 'отзыв заявки', short: 'отзыв', cond: true },
      approve: { label: 'согласование', short: 'согл.', cond: true },
      reject: { label: 'отклонение', short: 'откл.', cond: true },
      cancel: { label: 'отмена кадровиком', short: 'отмена', cond: true },
      create: { label: 'создание черновика', cond: false },
      read: { label: 'списки и просмотр', cond: false },
      other: { label: 'прочее', cond: false, noExtra: true },
    },
    words: [
      ['create', /созда(ть|ние|нии|ния|ёт|ет)\s+(нов[а-яё]+\s+)?(черновик|заявк)|нов(ая|ую|ой)\s+заявк|(?<![A-Za-z_])create(?![A-Za-z_])/i],
      ['edit', /(?<![а-яё])правк[аиеуой](?![а-яё])|(?<![а-яё])прав(ить|ит|ят)(?![а-яё])|изменени[еяю]\s+черновик|измен(ить|яет)\s+черновик|редактир|сохранени[ея]\s+(правк|черновик)|(?<![A-Za-z_])(edit|update)(?![A-Za-z_])/i],
      ['submit', /отправ(ить|ка|ки|ке|ку|кой|ляет|лять|лении|ление)(?![а-яё])|(?<![A-Za-z_])submit(?![A-Za-z_])/i],
      ['withdraw', /отзыв(?![а-яё]*\s+(сотрудника\s+)?из\s+(уже\s+)?(начавш|отпуск))|отозва(ть|л|ла)(?![а-яё])|(?<![A-Za-z_])(withdraw|recall)(?![A-Za-z_])/i],
      ['approve', /(?<!на\s)согласова(ть|ние|ния|нии|нию|нием)(?![а-яё])|(?<![A-Za-z_])approve(?![A-Za-z_])/i],
      ['reject', /отклон(ить|ение|ения|ении|ению|яет|ять|ил)(?![а-яё])|(?<![A-Za-z_])(reject|decline)(?![A-Za-z_])/i],
      ['cancel', /отмен(ить|а|ы|у|е|ой|яет|ять|ил)(?![а-яё])|(?<![A-Za-z_])cancel(?![A-Za-z_])/i],
      ['read', /мои\s+заявки|«мои|просмотр|счётчик|счетчик|числ[оа]\s+(в|у)\s+(меню|пункт)|список\s+«?на\s+согласовани|«на\s+согласование»|согласованн[а-яё]+\s+отпуск/i],
    ],
    // «Решение руководителя» — только в заголовке карточки: в тексте «руководитель уже принял решение» — причина
    // отказа у отзыва, а не действие.
    headWords: [['approve,reject', /решени[ея]\s+(руководител|по\s+заявк)|(?<![A-Za-z_])decision(?![A-Za-z_])/i]],
    pathVerbs: [
      [/^(submit|send|send-for-approval|to-approval|submission)$/i, ['submit']],
      [/^(withdraw|recall|revoke)$/i, ['withdraw']],
      [/^approve$/i, ['approve']],
      [/^(reject|decline)$/i, ['reject']],
      [/^(decision|decide|resolve)$/i, ['approve', 'reject']],
      [/^(cancel|cancellation)$/i, ['cancel']],
    ],
    editAct: 'edit',
  },
  'TS-ACC': {
    key: 'ACS-208',
    nFR: 7,
    expect: 'needs',
    statuses: [
      ['pending', ST_PENDING],
      // «Отозвана» — заявка (женский род обязателен); голое «отозван» — это «Доступ отозван».
      ['withdrawn', /(?<![а-яё])(?<!доступ\s)отозван(а|ая|ую|ой|ы|ые|ых|ное)(?![а-яё])|(?<![A-Za-z_])(withdrawn|recalled|cancell?ed)(?![A-Za-z_])/gi],
      ['rejected', ST_REJECTED],
      ['granted', /доступ\s+выдан(?![а-яё])|(?<![A-Za-z_])(access_granted|granted|provisioned)(?![A-Za-z_])/gi],
      ['revoked', /доступ\s+отозван(?![а-яё])|(?<![A-Za-z_])(access_revoked|revoked)(?![A-Za-z_])/gi],
    ],
    // FR-1, FR-5…FR-7: на согласовании → (отозвана | отклонена | доступ выдан); доступ выдан → доступ отозван.
    allowed: ['pending>withdrawn', 'pending>rejected', 'pending>granted', 'granted>revoked'],
    actions: {
      withdraw: { label: 'отзыв заявки', short: 'отзыв', cond: true },
      approve: { label: 'согласование', short: 'согл.', cond: true },
      reject: { label: 'отклонение', short: 'откл.', cond: true },
      revoke: { label: 'отзыв доступа', short: 'отзыв дост.', cond: true },
      create: { label: 'подача', cond: false },
      read: { label: 'списки и просмотр', cond: false },
      other: { label: 'прочее', cond: false, noExtra: true },
    },
    words: [
      ['create', /подач[аиеу](?![а-яё])|пода(ть|ёт|ет)\s+заявк|созда(ть|ние|нии|ния)\s+заявк|нов(ая|ую|ой)\s+заявк|(?<![A-Za-z_])create(?![A-Za-z_])/i],
      ['withdraw', /отзыв[а-яё]*\s+(своей\s+)?заявк|отозва(ть|л|ла)\s+(свою\s+)?заявк|(?<![A-Za-z_])(withdraw|recall)(?![A-Za-z_])/i],
      ['approve', /(?<!на\s)согласова(ть|ние|ния|нии|нию|нием)(?![а-яё])|(?<![A-Za-z_])approve(?![A-Za-z_])/i],
      ['reject', /отклон(ить|ение|ения|ении|ению|яет|ять|ил)(?![а-яё])|(?<![A-Za-z_])(reject|decline)(?![A-Za-z_])/i],
      ['revoke', /отзыв[а-яё]*\s+(выданного\s+)?доступ|отозва(ть|л|ла)\s+доступ|(?<![A-Za-z_])revoke(?![A-Za-z_])/i],
      ['read', /мои\s+заявки|«мои|просмотр|заявки\s+на\s+(мои|свои)\s+систем|справочник\s+систем/i],
    ],
    // «Отзыв» без «заявки» / «доступа» в TS-ACC двусмыслен — такая строка не приписывается ни одному действию.
    ambiguous: /отзыв|отозва(ть|л|ла)(?![а-яё])/i,
    headWords: [['approve,reject', /решени[ея]\s+владельц|(?<![A-Za-z_])decision(?![A-Za-z_])/i]],
    pathVerbs: [
      [/^(withdraw|recall|cancel)$/i, ['withdraw']],
      [/^approve$/i, ['approve']],
      [/^(reject|decline)$/i, ['reject']],
      [/^(decision|decide|resolve)$/i, ['approve', 'reject']],
      [/^(revoke|revoke-access|revoke_access|access-revoke|revocation|revoke-grant)$/i, ['revoke']],
    ],
    editAct: 'other',
  },
}
const KEY2FX = { 'EMP-1207': 'TS-VAC', 'ACS-208': 'TS-ACC' }

// ─── Статусы в тексте и переходы ──────────────────────────────────────────────────────────────

export function statusMentions(text, fx) {
  const out = []
  for (const [cls, re] of fx.statuses) for (const m of String(text).matchAll(re)) out.push({ cls, i: m.index, end: m.index + m[0].length, raw: m[0] })
  out.sort((a, b) => a.i - b.i || (b.end - b.i) - (a.end - a.i))
  const res = []
  let last = -1
  for (const o of out) if (o.i >= last) { res.push(o); last = o.end }
  return res
}

const RE_ARROW_SPLIT = /→|->|⇒|➝|⟶/
// Отрицание в предложении с переходом: «нельзя», «409», «только из…» — такое предложение перехода не утверждает.
const RE_NEG = /нельзя|не\s+допуска|недопустим|запрещ|невозможн|не\s+может|не\s+бывает|нет\s+переход|переход[а-яё]*\s+нет|не\s+переход|не\s+предусмотр|не\s+поддержива|не\s+делаем|вне\s+объ[её]ма|не\s+входит|❌|✗|(?<!\d)409(?!\d)|отказ|(?<![A-Za-z])(forbidden|not\s+allowed|only)(?![A-Za-z])|только|кроме/i
const RE_FROM_TO = /из\s+(?:статуса\s+)?[«"'`]([^»"'`\n]+)[»"'`]\s+в\s+(?:статус\s+)?[«"'`]([^»"'`\n]+)[»"'`]/gi

/** Переходы в одной строке прозы: стрелки внутри предложения (режется по «;» и «. »), оборот «из «X» в «Y»». */
export function proseTransitions(line, fx) {
  const out = []
  for (const clause of line.split(/;|\.\s|<br\s*\/?>/i)) {
    if (RE_NEG.test(clause)) continue
    if (RE_ARROW_SPLIT.test(clause)) {
      const parts = clause.split(/→|->|⇒|➝|⟶/)
      for (let k = 1; k < parts.length; k += 1) {
        const src = statusMentions(parts[k - 1], fx)
        let tgt = statusMentions(parts[k], fx)
        if (!src.length || !tgt.length) continue
        // Есть следующая стрелка — последнее упоминание этой части уже источник следующего перехода.
        if (k < parts.length - 1 && tgt.length > 1) tgt = tgt.slice(0, -1)
        for (const t of tgt) out.push({ from: src[src.length - 1].cls, to: t.cls })
      }
    }
    for (const m of clause.matchAll(RE_FROM_TO)) {
      const a = statusMentions(m[1], fx), b = statusMentions(m[2], fx)
      if (a.length && b.length) out.push({ from: a[0].cls, to: b[0].cls })
    }
  }
  return out
}

const cellsOf = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|')
const isSepRow = (l) => /^\s*\|\s*:?-{2,}/.test(l)

/** Переходы в таблицах — только в таблицах с колонками «Из»/«В» в шапке (таблица кнопок по статусам — не переходы). */
export function tableTransitions(ls, code, fx) {
  const out = []
  for (let i = 0; i < ls.length; i += 1) {
    if (code[i] || !/^\s*\|/.test(ls[i]) || (i > 0 && /^\s*\|/.test(ls[i - 1]))) continue
    const head = cellsOf(ls[i]).map((c) => c.replace(/[*_`]/g, '').trim())
    const fi = head.findIndex((c) => /^(из|from|исходн|текущ|старый)/i.test(c))
    const ti = head.findIndex((c, k) => k !== fi && /^(в|to|целев|нов|куда)(?![а-яё])/i.test(c))
    let j = i + 1
    for (; j < ls.length && /^\s*\|/.test(ls[j]); j += 1) {
      if (fi < 0 || ti < 0 || isSepRow(ls[j])) continue
      const cells = cellsOf(ls[j])
      const rest = cells.filter((_, k) => k !== fi && k !== ti).join(' ')
      if (RE_NEG.test(rest)) continue
      const a = statusMentions(cells[fi] ?? '', fx), b = statusMentions(cells[ti] ?? '', fx)
      for (const t of b) if (a.length) out.push({ i: j, from: a[0].cls, to: t.cls, line: ls[j] })
    }
    i = j - 1
  }
  return out
}

// ─── Разметка спеки: заголовки, разделы, INT-карточки ─────────────────────────────────────────

function headings(ls, code) {
  const out = []
  ls.forEach((l, i) => {
    if (code[i]) return
    const m = l.match(/^(#{1,6})\s+(.*)$/)
    if (m) out.push({ i, level: m[1].length, text: m[2] })
  })
  return out
}
function sectionRange(ls, code, re) {
  const hs = headings(ls, code)
  const k = hs.findIndex((h) => re.test(h.text))
  if (k < 0) return null
  const end = hs.slice(k + 1).find((h) => h.level <= hs[k].level)
  return [hs[k].i, end ? end.i : ls.length]
}
const inRange = (r, i) => !!r && i >= r[0] && i < r[1]

const firstMark = (s) => (String(s).match(/🟢|🔵|🟡|❓/) || [null])[0]

const RE_IDM = /(?<![A-Za-z])idm(?![A-Za-z])|систем[а-яё]*\s+(управления\s+)?уч[её]т(ок|к[а-яё]*|ками|ками)/i

function pathActs(t, fx) {
  const acts = new Set()
  for (const m of String(t).matchAll(/(?<![A-Za-z])(GET|POST|PUT|PATCH|DELETE)`?\s+`?([^\s`'"]+)/g)) {
    const method = m[1]
    const path = m[2].split('?')[0].replace(/[),.;]+$/, '').replace(/\/+$/, '')
    if (!path.includes('/')) continue
    const segs = path.split('/').filter(Boolean)
    const last = segs[segs.length - 1] ?? ''
    const isParam = (s) => /^[{:<]|^\$\{/.test(s)
    if (method === 'GET') { acts.add('read'); continue }
    let hit = false
    for (const [re, as] of fx.pathVerbs) if (re.test(last)) { as.forEach((a) => acts.add(a)); hit = true }
    if (hit) continue
    if (method === 'POST' && !segs.some(isParam)) acts.add('create')
    else if ((method === 'PUT' || method === 'PATCH') && isParam(last)) acts.add(fx.editAct)
  }
  return acts
}

function wordActs(t, fx, head = false) {
  const acts = new Set()
  for (const [a, re] of fx.words) if (re.test(t)) acts.add(a)
  if (head) for (const [as, re] of fx.headWords) if (re.test(t)) as.split(',').forEach((a) => acts.add(a))
  const ambiguous = !!fx.ambiguous && fx.ambiguous.test(t) && !acts.has('withdraw') && !acts.has('revoke')
  return { acts, ambiguous }
}

/** INT-карточки: заголовок с «INT-N» → до следующего заголовка того же или старшего уровня. */
export function intCards(ls, code, fx) {
  const hs = headings(ls, code)
  const cards = []
  hs.forEach((h, k) => {
    const m = h.text.match(/INT[-‑ ]?\s*(\d+)/i)
    if (!m) return
    const end = hs.slice(k + 1).find((x) => x.level <= h.level)
    const from = h.i, to = end ? end.i : ls.length
    const body = ls.slice(from, to)
    const plain = body.filter((_, j) => !code[from + j])
    const provLine = plain.find((l) => /Происхождение/i.test(l) && /🟢|🔵|🟡|❓/.test(l))
    const markHead = firstMark(h.text), markProv = provLine ? firstMark(provLine) : null
    const border = plain.find((l) => /Граница|направлени/i.test(l)) ?? ''
    // Карточка чужой системы: idm в заголовке (без нашего пути `/v1/`) или idm — ПЕРВАЯ цель стрелки в «Границе».
    // «FE → BE портала; BE → `idm` (INT-3)» — наша карточка, которая внутри ходит в idm (base2 run-4: так
    // согласование, просмотр и отзыв доступа уходили в чужие, и их отказы терялись).
    const firstTarget = (border.replace(/^.*?(Граница[^:]*:|направлени[^:]*:)/i, '').split(/→|->/)[1] ?? '').split(/[;,(]|\.\s/)[0]
    const contractOurs = plain.some((l) => /Контракт/i.test(l) && /\/v1\//.test(l))
    const foreign = fx.key === 'ACS-208' && !contractOurs && ((RE_IDM.test(h.text) && !/\/v1\//.test(h.text)) || RE_IDM.test(firstTarget))
    const hasYellow = /🟡/.test(h.text) || plain.some((l) => /Происхождение/i.test(l) && /🟡/.test(l))
    const acts = new Set()
    if (!foreign) {
      const contract = plain.filter((l) => /(GET|POST|PUT|PATCH|DELETE)`?\s+`?[^\s`]*\//.test(l)).join('\n')
      // Путь с глаголом надёжнее заголовка: «Отменить согласованный отпуск» по словам — ещё и список «согласованных
      // отпусков». Заголовок — только у карточки без пути.
      for (const a of pathActs(contract, fx)) acts.add(a)
      const head = h.text.replace(/INT[-‑ ]?\s*\d+\.?/i, '')
      if (!acts.size) for (const a of wordActs(head, fx, true).acts) acts.add(a)
    }
    cards.push({ n: Number(m[1]), from, to, head: h.text.trim(), label: `INT-${m[1]}`, acts, foreign, markHead, markProv, hasYellow, body: plain.join('\n') })
  })
  return cards
}

/** Ссылки на INT в тексте, с диапазонами «INT-8…INT-12», «INT-8–12». */
export function intRefs(t) {
  const out = new Set()
  for (const m of String(t).matchAll(/INT[-‑ ]?(\d+)(?:\s*(?:…|\.\.\.?|–|—)\s*(?:INT[-‑ ]?)?(\d+))?/gi)) {
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
    if (b >= a && b - a <= 25) for (let n = a; n <= b; n += 1) out.add(n)
    else out.add(a)
  }
  return [...out]
}

// ─── Статусный отказ: смысл сегмента ──────────────────────────────────────────────────────────

// «Статус уже другой» словами. Слова «нельзя»/«только черновик» сами по себе — пересказ правила БТ, не ответ
// сервера: в отказ идут только вместе с маркером ответа (код, «отказ», «ошибка», «возвращает», «не меняется»).
const RE_SC = /уже\s+(не\s+)?(отправлен|согласован|отклон[её]н|отозван|отмен[её]н|решен|решён|обработан|рассмотрен|на\s+согласовани|в\s+статусе|выдан|заблокирован|неактивн|не\s+черновик|не\s+жд[её]т|не\s+ожида|другом\s+статус|в\s+другом)|не\s+в\s+статусе|не\s+из\s+(допустим|разреш)|(не)?допустим[а-яё]*\s+(для\s+)?(текущ[а-яё]*\s+|этого\s+)?статус|неподходящ[а-яё]*\s+статус|в\s+(текущем|этом)\s+статусе\s+(нельзя|недоступ|не\s+допуска|запрещ)|статус[а-яё]*\s+(заявки\s+)?(уже\s+)?(изменил|поменял|другой|не\s+позволя|не\s+допуска|не\s+соответству|не\s+тот|не\s+равен|сменил)|(?<![а-яё])(не|больше\s+не)\s+(является\s+)?черновик|не\s+(жд[её]т|ожидает)\s+решени|решени[ея]\s+(по\s+ней\s+)?уже\s+принят|уже\s+принял[а-яё]*\s+решени|уже\s+решил|конфликт\s+статус|(?<![A-Za-z])(invalid|wrong|illegal)\s+(state|status)|already\s+(approved|rejected|withdrawn|cancell?ed|submitted|decided|processed|granted|revoked)|status\s+(has\s+)?changed/i
const RE_RM = /(?<!\d)4\d\d(?!\d)|отказ|отклоня[ею]т(ся)?\s+(запрос|операц|действи)|ошибк|возвраща|верн[её]т|отвеча|ответ[а-яё]*\s+(сервер|бэк|бэка|портал)|сообщени|не\s+меня|ничего\s+не\s+(меня|происход)|(?<![A-Za-z])(error|reject)(?![A-Za-z])|`[a-z]+(_[a-z]+)+`|(?<![A-Za-z_])[A-Z]{2,}(_[A-Z0-9]+)+(?![A-Za-z_])/i
const RE_IDEMP = /идемпотент|idempoten|Idempotency|ключ[а-яё]*\s+(повтор|идемпот)/i
const RE_403 = /(?<!\d)403(?!\d)|(?<![A-Za-z_])(forbidden|access_denied|ACCESS_DENIED|FORBIDDEN)(?![A-Za-z_])|error_forbidden|нет\s+прав|нет\s+доступа|доступ\s+запрещ/i
const RE_VALID_TOKEN = /VALIDATION|validation|error_validation|валидац|ошибк[а-яё]*\s+(ввода|проверки\s+пол)/
const RE_FIELD_SEM = /VALIDATION|validation|error_validation|(?<![A-Za-z])fields(?![A-Za-z])|(?<![а-яё])пол(е|я|ей|ям)(?![а-яё])|не\s+заполнен|обязательн[а-яё]*\s+пол|формат|дата\s+окончания\s+раньше|причин[а-яё]*\s+(пуст|обязат|не\s+заполн)/i
const RE_UI_SEM = /показ|сообщени|тост|toast|баннер|перечит|перезапраш|обнов[а-яё]*\s+(карточк|список|страниц|заявк|экран|статус|числ)|перезагру|убира|скрыва|refetch|reload|error_conflict|(?<![A-Za-z])conflict(?![A-Za-z_])|видит|отображ|экран/i
const RE_UI_LINE = /^\s*[-*]?\s*\**\s*Состояни[яе]\s+(UI|интерфейс|экрана)/i

/** Машинные коды отказа в сегменте (бэктики или ВЕРХНИЙ_РЕГИСТР со «_»). */
function machineCodes(t) {
  const out = []
  for (const m of String(t).matchAll(/`([^`\s]+)`|(?<![A-Za-z0-9_])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![A-Za-z0-9_])/g)) out.push(m[1] ?? m[2])
  return out.filter((x) => /_/.test(x) || /^[A-Z]{4,}$/.test(x))
}
// Отказ по ДАТЕ (TS-VAC, отмена: «дата начала наступила») — не статусный, хоть и бывает 409 и `LEAVE_ALREADY_STARTED`
// (run-3). Он меряется отдельно (`sub.date`), в статусные отказы не идёт.
const RE_DATE_REFUSAL = /дат[а-яё]*\s+начала[^|;\n]{0,40}(наступил|прошл|уже|сегодня)|(отпуск|он)\s+уже\s+начал|startDate`?\s*(≤|<=|<|наступил)|(?<![A-Za-z])[A-Za-z_]*(already_started|after_start|start_date|leave_started|started|too_late|date_reached)[A-Za-z_]*/i
const isDateToken = (x) => /start|date|too_late/i.test(x)
const isStatusToken = (x) => /status|state|conflict|already|transition|not_?draft|not_?pending|not_?granted|decided|editable/i.test(x) && !/^error_conflict$/i.test(x) && !isDateToken(x)
// «Неактивна» — и код отказа (`ACCOUNT_INACTIVE`), и имя состояния экрана (`account_inactive`, base2 run-4): как
// отказ считается только рядом с кодом 4xx.
const isInactiveToken = (x) => /inactive|not_?active/i.test(x)
const isVersionToken = (x) => /stale|version/i.test(x)

/**
 * Сегмент — строка таблицы целиком или кусок строки прозы между «; ». Возвращает вид отказа:
 *   'status'  — статус уже другой (слова + маркер ответа, машинный код статуса, голый 409);
 *   'version' — только конфликт версии записи (`stale_version`, 412, If-Match) — отказ на гонку без слов о статусе;
 *   'date'    — отказ по дате (отмена после начала отпуска), без статусных слов и кодов;
 *   null      — не отказ по статусу.
 */
export function refusalKind(t) {
  if (RE_IDEMP.test(t)) return null
  const codes = machineCodes(t)
  const has4xx = /(?<!\d)4\d\d(?!\d)/.test(t)
  const st = codes.filter((x) => (isStatusToken(x) || (has4xx && isInactiveToken(x))) && !isVersionToken(x))
  const ver = codes.filter(isVersionToken)
  const has409 = /(?<!\d)409(?!\d)/.test(t), has412 = /(?<!\d)412(?!\d)/.test(t)
  const sc = RE_SC.test(t)
  if ((sc && RE_RM.test(t)) || st.length) return 'status'
  if (RE_DATE_REFUSAL.test(t)) return 'date'
  if (ver.length || has412 || (has409 && /верси[яи]|(?<![A-Za-z])version(?![A-Za-z])|If-Match|ETag|оптимистич/i.test(t))) return 'version'
  if (has409) return 'status'
  return null
}

/** Свой отдельный код у статусного отказа: 409/412 или машинный код статуса/версии. */
function ownCode(t) {
  return /(?<!\d)(409|412)(?!\d)/.test(t) || machineCodes(t).some((x) => (isStatusToken(x) || isVersionToken(x)) && !/VALIDATION|validation/.test(x))
}

// ─── idm: привязка кода к чужой системе и ловушки карточки ────────────────────────────────────

const RE_IDM_BIND = /(?:(?<![A-Za-z])idm(?![A-Za-z])|систем[а-яё]*\s+(?:управления\s+)?уч[её]т[а-яё]*)[^.;\n→]{0,60}(?:верн[её]т|возвраща|отвеча|ответит|отда[её]т|ответ[а-яё]*)[^.;\n→]{0,30}(?<!\d)(?:201|404|409|422|429)(?!\d)|(?<!\d)(?:201|404|409|422|429)(?!\d)[^.;\n→]{0,40}(?:от|из)\s+(?:idm|систем[а-яё]*\s+(?:управления\s+)?уч[её]т)/i
const RE_HEDGE = /🟡|к\s+валидации|не\s+подтвержд|неизвестн|не\s+известно|не\s+знаем|не\s+знает|уточн|(?<![A-Za-z])TBD(?![A-Za-z])|❓|предполож|возможно|если\s+(idm|систем[а-яё]*\s+уч[её]т)[^.\n]{0,30}(так|умеет|поддержива)/i
const RE_OUR_MAPPING = /(портал|мы|наш[а-яё]*|бэк[а-яё]*|сервер)\s+(возвраща|отда|отвеча|верн)|верн(уть|ём|ем)\s|→\s*(вернуть|\d{3})/i

const TRAPS = [
  // Конкретика — нарушение под ЛЮБОЙ пометкой (README: «не попадает и под 🟡»).
  { key: 'path', label: 'путь idm', kind: 'concrete', any: true, re: /\/api\/v2\/accounts|\/v2\/accounts|\/accounts\/[{:]?accountId|(?<![A-Za-z])(POST|GET|PUT|PATCH|DELETE)\s+`?[^\s`]*\/accounts(?![\w-])|\/accounts\/[^\s`]*\/(un)?lock(?![\w-])/ },
  { key: 'code', label: 'код ошибки idm', kind: 'concrete', any: true, re: /E_ACC_[A-Z_]+|E_SYS_UNKNOWN/ },
  { key: 'state', label: 'состояние учётки idm', kind: 'concrete', any: true, re: /(?<![A-Za-z_])(ENABLED|LOCKED|TERMINATED)(?![A-Za-z_])/ },
  { key: 'header', label: 'заголовок/роль авторизации idm', kind: 'concrete', any: true, re: /X-Idm-Client-Token|idm\.client|idm\.admin/i },
  { key: 'limit', label: 'лимит idm', kind: 'concrete', ctx: true, re: /(?<!\d)20\s*(запрос[а-яё]*\s*)?(в|\/)\s*(сек|с(?![а-яё]))|(?<!\d)20\s*rps|(?<!\d)429(?!\d)/i },
  { key: 'field', label: 'поле запроса/ответа idm', kind: 'concrete', ctx: true, re: /`(employeeLogin|targetSystemCode|lockedAt)`/ },
  { key: 'http', label: 'HTTP-код в привязке к idm', kind: 'concrete', bind: true },
  // Поведение — нарушение только фактом (🔵/🟢/без пометки); словами под 🟡 — законно.
  { key: 'one', label: '«одна учётка на сотрудника и систему»', kind: 'behavior', re: /одн[аоу]\s+уч[её]тк[а-яё]*\s+на\s+(сотрудник|пар)|(?<![а-яё])уже\s+есть\s+уч[её]тк[а-яё]*[^.\n]{0,60}(idm|систем[а-яё]*\s+уч[её]т)[^.\n]{0,40}(верн[её]т|возвраща|ответ|отказ|ошибк)/i },
  { key: 'active', label: '«заводится сразу активной»', kind: 'behavior', re: /сразу\s+(в\s+)?(активн|ENABLED)|заводит[а-яё]*\s+(сразу\s+)?активн|созда[её]тся\s+(сразу\s+)?активн/i },
  { key: 'onlyActive', label: '«блокировать можно только активную»', kind: 'behavior', re: /только\s+активн[а-яё]*\s+уч[её]тк|блокир[а-яё]*\s+(можно\s+)?только\s+активн/i },
  { key: 'relock', label: '«повторная блокировка — ошибка»', kind: 'behavior', re: /повторн[а-яё]*\s+блокировк[а-яё]*[^.\n]{0,60}(ошибк|отказ|422|409|отвеча|верн[её]т|возвращ)|(блокировк|заблокир)[а-яё]*\s+(уже\s+)?(неактивн|заблокированн)[а-яё]*\s+уч[её]тк[а-яё]*[^.\n]{0,40}(ошибк|отказ|422|верн[её]т|возвращ|отвеча)/i },
  { key: 'dismiss', label: '«закрывается при увольнении» (событие)', kind: 'behavior', re: /hr\.employee\.dismissed|подпис[а-яё]*[^.\n]{0,40}(событи|топик|kafka)[^.\n]{0,60}(увольн|уч[её]т)/i },
  { key: 'unlock', label: '«разблокирует только администратор»', kind: 'behavior', re: /разблокир[а-яё]*[^.\n]{0,40}только\s+администратор|только\s+администратор[а-яё]*[^.\n]{0,40}разблокир/i },
]

// ─── Шапка: статус и открытые пункты ──────────────────────────────────────────────────────────

function headerOf(ls) {
  const end = ls.findIndex((l) => /^##\s/.test(l))
  return ls.slice(0, end < 0 ? Math.min(40, ls.length) : end)
}
export function headerOpenItems(header) {
  const k = header.findIndex((l) => /Открытые\s+вопросы/i.test(l))
  if (k < 0) return []
  const out = []
  for (let i = k + 1; i < header.length; i += 1) {
    const l = header[i]
    if (/^>?\s*\**\s*[А-ЯЁA-Z][^*:\n]{2,40}:\**\s*$/.test(l.replace(/^>\s*/, '')) && out.length) break
    if (/^>?\s*(\d+[.)]|[-*])\s+\S/.test(l) && !/Все\s+технические\s+решения\s+приняты|открытых\s+(вопросов\s+)?нет/i.test(l)) out.push(l.trim())
  }
  return out
}
export function statusOf(rawLs, fx) {
  const header = headerOf(rawLs)
  const sl = header.find((l) => /Статус\s+готовности/i.test(l)) ?? null
  const items = headerOpenItems(header)
  let value = 'не найден', n = null, kind = 'none'
  if (sl) {
    const m = sl.match(/Требуются\s+уточнения\s*\((\d+)\)/i)
    if (/ПРОСТАВЛЯЕТСЯ/i.test(sl)) { kind = 'placeholder'; value = 'заглушка <ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ>' }
    else if (m) { kind = 'needs'; n = Number(m[1]); value = `Требуются уточнения (${n})` }
    else if (/Готово\s+к\s+разработке/i.test(sl)) { kind = 'done'; value = 'Готово к разработке' }
    else if (/Требуются\s+уточнения/i.test(sl)) { kind = 'needs-noN'; value = 'Требуются уточнения (без N)' }
    else value = clip(sl.replace(/^>\s*/, ''), 60)
  }
  const nEq = kind === 'needs' && n === items.length
  let verdict, legit
  if (fx.expect === 'done') {
    if (kind === 'done') { legit = true; verdict = items.length ? `по README, но в шапке ${items.length} пункт(ов)` : 'по README' }
    else if (kind === 'needs' && nEq) { legit = true; verdict = 'законно по арифметике (N = пунктов), но не ожидаемый исход' }
    else if (kind === 'needs') { legit = false; verdict = `НЕ по README: N=${n}, пунктов в шапке ${items.length}` }
    else { legit = false; verdict = 'НЕ по README' }
  } else if (kind === 'needs' && n >= 1) { legit = true; verdict = nEq ? 'по README' : `по README по значению; N=${n}, пунктов в шапке ${items.length}` }
  else { legit = false; verdict = kind === 'done' ? 'НЕ по README: «Готово» при живой 🟡 (авторизация в idm)' : 'НЕ по README' }
  return { value, kind, n, items: items.length, nEq, legit, verdict }
}

// ─── Оценка спеки ─────────────────────────────────────────────────────────────────────────────

/**
 * Все замеры одной спеки. Чистая функция — на ней самотест. `fxName` — 'TS-VAC' | 'TS-ACC'.
 */
export function gradeSpec(specText, fxName) {
  const fx = FX[fxName]
  const raw = lines(normalizeSpecHeadings(String(specText)))
  const ls = blankLegend(raw.join('\n'))
  const code = codeFlags(ls)
  const cards = intCards(ls, code, fx)
  const cardAt = (i) => cards.find((c) => i >= c.from && i < c.to) ?? null
  const cardActsByN = new Map(cards.map((c) => [c.n, c.acts]))
  const catalog = sectionRange(ls, code, /Каталог\s+ошибок/i)
  const fe = sectionRange(ls, code, /^4[.)]?\s|^Frontend/i)
  const s7 = sectionRange(ls, code, /^7[.)]?\s|Трассировк/i)
  const s32 = sectionRange(ls, code, /^3\.2(?!\d)|Данные\s+и\s+хранение/i)
  const s2 = sectionRange(ls, code, /^2[.)]?\s|Взаимодейств/i)
  const condActs = Object.keys(fx.actions).filter((a) => fx.actions[a].cond)

  // UI-колонка каталога — по шапке таблицы каталога.
  let uiCol = -1
  if (catalog) {
    for (let i = catalog[0]; i < catalog[1]; i += 1) {
      if (/^\s*\|/.test(ls[i])) { uiCol = cellsOf(ls[i]).findIndex((c) => /Состояни|UI|экран|интерфейс/i.test(c)); break }
    }
  }

  // Сегменты.
  const segs = []
  ls.forEach((l, i) => {
    if (code[i] || !l.trim() || isSepRow(l)) return
    const row = /^\s*\|/.test(l)
    const parts = row ? [l] : l.split(/;\s+|<br\s*\/?>/i)
    for (const p of parts) if (p.trim()) segs.push({ i, text: p, row, line: l })
  })

  // HTTP-коды, которыми в спеке отвечают на ошибки полей (без статусного смысла).
  const validationHttp = new Set()
  for (const s of segs) {
    if (RE_FIELD_SEM.test(s.text) && !refusalKind(s.text)) for (const m of s.text.matchAll(/(?<!\d)(4\d\d)(?!\d)/g)) validationHttp.add(m[1])
  }

  const attribute = (s) => {
    const card = cardAt(s.i)
    if (card && card.foreign) return { acts: new Set(), how: 'foreign' }
    const t = s.text
    const fromInt = new Set(intRefs(t).flatMap((n) => [...(cardActsByN.get(n) ?? [])]))
    const fromPath = pathActs(t, fx)
    const w = wordActs(t, fx)
    if (card && card.acts.size) {
      if (card.acts.size === 1) return { acts: new Set(card.acts), how: 'card', where: card.label }
      const local = new Set([...fromPath, ...w.acts].filter((a) => card.acts.has(a)))
      if (local.size) return { acts: local, how: 'card', where: card.label }
      if ([...card.acts].every((a) => fx.actions[a]?.cond)) return { acts: new Set(card.acts), how: 'card', where: card.label }
      return { acts: new Set(), how: 'ambiguous', where: `${card.label} (карточка нескольких действий)` }
    }
    if (fromInt.size) return { acts: fromInt, how: 'int' }
    if (fromPath.size) return { acts: fromPath, how: 'path' }
    if (w.acts.size) return { acts: w.acts, how: 'words' }
    if (w.ambiguous) return { acts: new Set(), how: 'ambiguous', where: 'двусмысленное «отзыв»' }
    return { acts: new Set(), how: 'generic' }
  }
  const whereOf = (s) => {
    const c = cardAt(s.i)
    if (c) return c.label
    if (inRange(catalog, s.i)) return 'каталог'
    if (inRange(fe, s.i)) return '§4'
    return `стр. ${s.i + 1}`
  }

  // Статусные сегменты.
  const hits = []
  for (const s of segs) {
    const kind = refusalKind(s.text)
    if (!kind || kind === 'date') continue
    if (fx.key === 'ACS-208' && RE_IDM_BIND.test(s.text)) continue
    const at = attribute(s)
    if (at.how === 'foreign') continue
    const inCat = inRange(catalog, s.i)
    let ui = false
    if (inCat && s.row && uiCol >= 0) {
      const cell = cellsOf(s.line)[uiCol] ?? ''
      ui = !/^\s*(—|-|–|нет|n\/a)?\s*$/i.test(cell.replace(/[*_`]/g, ''))
    }
    if (RE_UI_LINE.test(s.line) || inRange(fe, s.i) || RE_UI_SEM.test(s.text)) ui = true
    const own = ownCode(s.text)
    const http = [...s.text.matchAll(/(?<!\d)(4\d\d)(?!\d)/g)].map((m) => m[1])
    const forb = !own && RE_403.test(s.text)
    const valid = !own && !forb && (RE_VALID_TOKEN.test(s.text) || http.some((h) => validationHttp.has(h)))
    const strong = RE_SC.test(s.text) || machineCodes(s.text).some((x) => (isStatusToken(x) || (/(?<!\d)4\d\d(?!\d)/.test(s.text) && isInactiveToken(x))) && !isVersionToken(x))
    hits.push({ ...s, kind, at, inCat, ui, forb, valid, strong, where: whereOf(s) })
  }

  // Учёт по действиям.
  const ambiguous = hits.filter((h) => h.at.how === 'ambiguous')
  const actions = {}
  for (const a of condActs) {
    const mine = hits.filter((h) => h.at.acts.has(a) || h.at.how === 'generic')
    // Действие «есть в спеке» — карточкой или словами в §2 (вне карточек чужой системы). Упоминание в §3–§8 без
    // карточки ещё не даёт сказать «нет»: связать с ним отказ нечем — это «не опознано».
    const present = cards.some((c) => c.acts.has(a)) || segs.some((s) => inRange(s2, s.i) && !cardAt(s.i)?.foreign && wordActs(s.text, fx).acts.has(a))
    const st = mine.filter((h) => h.kind === 'status')
    // Анкер: сначала сильный отказ (слова о статусе или машинный код статуса), не общий; голый 409 — потом
    // (ts-acc run-5: ряд «`SYSTEM_NOT_CONNECTED` (409)» перехватывал анкер каталога у `INVALID_STATUS`).
    const pick = (arr, f) => arr.find((h) => f(h) && h.strong && h.at.how !== 'generic') ?? arr.find((h) => f(h) && h.strong) ?? arr.find((h) => f(h) && h.at.how !== 'generic') ?? arr.find(f)
    const named = pick(st, () => true) ?? null
    const namedVer = named ? null : pick(mine, () => true) ?? null
    const pool = st.length ? st : mine
    const cat = pick(pool, (h) => h.inCat) ?? null
    const ui = pick(pool, (h) => h.ui) ?? null
    const clean = pool.filter((h) => !h.forb && !h.valid)
    const disguisedOnly = pool.length > 0 && clean.length === 0
    const missing = []
    if (!st.length && mine.length) missing.push('только конфликт версии, статус не назван')
    if (pool.length && !cat) missing.push('нет в каталоге')
    if (pool.length && !ui) missing.push('нет состояния UI')
    if (disguisedOnly) missing.push(pool.some((h) => h.forb) ? 'выдан за 403/«нет прав»' : 'выдан за ошибку проверки полей')
    let verdict
    if (pool.length) verdict = missing.length ? 'частично' : 'есть'
    else if (ambiguous.length) verdict = 'не опознано'
    else verdict = present ? 'нет' : 'не опознано'
    const why = !pool.length && verdict === 'не опознано'
      ? (ambiguous.length ? `неразобранные строки отказа: ${ambiguous.slice(0, 2).map((h) => `${h.at.where}: ${quote(h.text, 70)}`).join('; ')}` : 'действие в спеке не найдено')
      : null
    const tag = (h) => (h ? `[${h.where}${h.at.how === 'generic' ? ', общая строка' : ''}] ${around(h.text, RE_FOCUS, 120)}` : null)
    actions[a] = {
      verdict, missing, why,
      named: tag(named ?? namedVer), catalog: tag(cat), ui: tag(ui),
      mixed: !disguisedOnly && pool.some((h) => h.forb || h.valid) ? tag(pool.find((h) => h.forb || h.valid)) : null,
    }
  }

  // Под-замеры по действиям.
  const sub = {}
  // Под-замеры — только по сегментам, приписанным действию явно (общие строки сюда не идут).
  const actHits = (a) => segs.filter((s) => attribute(s).acts.has(a))
  if (fx.key === 'EMP-1207') {
    const d = actHits('cancel').find((s) => RE_DATE_REFUSAL.test(s.text) && RE_RM.test(s.text))
    sub.date = d ? `[${whereOf(d)}] ${quote(d.text, 120)}` : null
  } else {
    const RE_INACT = /неактивн|не\s+активн|inactive|INACTIVE|accountActive\s*(=|==|===|:)\s*`?false|заблокирован|закрыт/i
    // Законный вариант README: без проверки — сразу блокировка, на любой отказ idm — обобщённый отказ портала
    // (base2 run-4: «Бэк не проверяет `accountStatus`… итог решает `idm`»; `422 ACCOUNT_SYSTEM_REFUSED`).
    const RE_GENREV = /не\s+удалось\s+отозвать|REVOKE_FAILED|revoke_failed|(?<![A-Za-z])[A-Z_]*(SYSTEM|IDM|ACCOUNT)[A-Z_]*_(REFUSED|REJECTED|FAILED)(?![A-Za-z])|на\s+любой\s+отказ|любая\s+ошибка\s+(idm|систем)|итог\s+решает|(?<![A-Za-z])idm(?![A-Za-z])`?\s+отказал|систем[а-яё]*\s+уч[её]т[а-яё]*\s+отказал/i
    const rv = actHits('revoke')
    const f1 = rv.find((s) => RE_INACT.test(s.text) && (RE_RM.test(s.text) || machineCodes(s.text).length) && !RE_IDM_BIND.test(s.text))
    const f2 = rv.find((s) => RE_GENREV.test(s.text))
    sub.foreign = f1 ? `отказ «учётка неактивна»: [${whereOf(f1)}] ${around(f1.text, RE_INACT, 110)}` : (f2 ? `обобщённый отказ: [${whereOf(f2)}] ${around(f2.text, RE_GENREV, 110)}` : null)
    const RE_ONCE = /(повторн|уже\s+согласован|уже\s+выдан|второй\s+раз|дважды|повтор)[^.\n]{0,100}(не\s+(вызыва|обраща|ход|заводит|созда[её]т)|без\s+(вызова|обращения))|не\s+(вызыва|обраща|заводит|созда[её]т)[а-яё]*[^.\n]{0,60}(повторно|второй\s+раз|втору[юя]\s+уч[её]тк|ещё\s+раз)/i
    const o = segs.find((s) => RE_ONCE.test(s.text) && (RE_IDM.test(s.text) || /уч[её]тк/i.test(s.text)))
    sub.idmOnce = o ? `[${whereOf(o)}] ${quote(o.text, 110)}` : null
  }

  // Гонка двух ролей: признак одновременности + кто выигрывает / чем отказ второму, окно ±2 строки. Два прохода:
  // сначала прямые слова о гонке и атомарной записи, потом — только версия записи (run-1: общее правило `version`
  // в преамбуле §2 перехватывало анкер у строки «Гонки: условный UPDATE… проигравший получает 409» в §5.2).
  const RE_CONCUR = /одновременн|параллельн|конкурентн|гонк|(?<![A-Za-z])race(?![A-Za-z])|атомарн|FOR\s+UPDATE|условн[а-яё]*\s+(обновлен|запис|переход|UPDATE)|compare-and-set|WHERE\s+status/i
  const RE_CONCUR_VER = /оптимистич|optimistic|If-Match|ETag|верси[яи]\s+(запис|строк)|stale_version|version_conflict/i
  const RE_WIN = /выигрыва|побежда|перв[а-яё]*\s+(записанн|запис|успе|пришедш|операц)|проигравш|втор[а-яё]*[^.\n]{0,40}(получ|отказ|409|ошибк)|не\s+пройдут\s+оба|только\s+одн|(?<!\d)(409|412)(?!\d)|конфликт|conflict/i
  let race = null
  for (const re of [RE_CONCUR, RE_CONCUR_VER]) {
    for (let i = 0; i < ls.length && !race; i += 1) {
      if (code[i] || !re.test(ls[i]) || /[?？]/.test(bare(ls[i]))) continue
      const w = ls.slice(Math.max(0, i - 2), i + 3).filter((_, k) => !code[Math.max(0, i - 2) + k]).join('\n')
      if (RE_WIN.test(w)) race = `[${whereOf({ i })}${re === RE_CONCUR_VER ? ', только версия записи' : ''}] ${around(ls[i], re, 130)}`
    }
    if (race) break
  }
  // Механизм без слов «гонка»/«выигрывает»: условное обновление по статусу, блокировка строки с проверкой статуса,
  // `FOR UPDATE`. README: «выигрывает первая записанная операция (условное обновление по статусу или версия записи)».
  // ts-acc run-5: «заблокировать строку заявки → проверить владельца → проверить `pending`», «меняет статусы условным
  // обновлением строки заявки под блокировкой».
  const RE_MECH = /условн[а-яё]*\s+(обновлен|запис|переход|UPDATE)[^.\n]{0,80}(статус|status|блокировк)|(статус|status)[^.\n]{0,40}условн[а-яё]*\s+(обновлен|UPDATE)|UPDATE[^.\n]{0,80}WHERE[^.\n]{0,40}status|FOR\s+UPDATE|блокир[а-яё]*\s+строк[а-яё]*[^\n]{0,80}(статус|status|pending|DRAFT|draft)|compare-and-set/i
  if (!race) {
    for (let i = 0; i < ls.length && !race; i += 1) {
      if (!code[i] && RE_MECH.test(ls[i]) && !/[?？]/.test(bare(ls[i]))) race = `[${whereOf({ i })}, механизм] ${around(ls[i], RE_MECH, 130)}`
    }
  }

  // ── Лишнее ──
  const extras = { refusal: [], transitions: [], newStatus: [] }
  const RE_DUP = /(уже\s+есть|существу[ею]т|ещё\s+одн|друг(ая|ой)\s+заявк|активн[а-яё]*\s+заявк|пересеч|пересека|overlap|дубл[а-яё]*\s+заявк|already\s+exists|DUPLICATE|duplicate)/i
  const RE_NOT_DONE = /не\s+проверя|не\s+провер|не\s+делаем|вне\s+объ[её]ма|не\s+входит|нет\s+проверк|без\s+проверк|не\s+запрещ/i
  for (const h of hits) {
    const a = [...h.at.acts]
    if (h.at.how === 'generic' || h.at.how === 'ambiguous' || a.length !== 1) continue
    const act = fx.actions[a[0]]
    if (!act || act.cond || act.noExtra) continue
    extras.refusal.push(`${act.label}: [${h.where}] ${quote(h.text, 110)}`)
  }
  for (const s of segs) {
    if (!RE_DUP.test(s.text) || !RE_RM.test(s.text) || RE_IDEMP.test(s.text) || RE_NOT_DONE.test(s.text) || refusalKind(s.text)) continue
    const at = attribute(s)
    if (at.how === 'foreign' || at.acts.size !== 1 || !at.acts.has('create')) continue
    if (fx.key === 'ACS-208' && RE_IDM_BIND.test(s.text)) continue
    extras.refusal.push(`${fx.actions.create.label}: [${whereOf(s)}] ${quote(s.text, 110)}`)
  }
  const allowed = new Set(fx.allowed)
  const seen = new Set()
  const addTr = (i, from, to, line) => {
    if (from === to || allowed.has(`${from}>${to}`)) return
    const k = `${from}>${to}`
    if (seen.has(k)) return
    seen.add(k)
    extras.transitions.push(`${from} → ${to}: [${whereOf({ i })}] ${around(line, /→|->|⇒|➝|⟶|из\s+(статуса\s+)?[«"'`]/, 110)}`)
  }
  ls.forEach((l, i) => {
    if (code[i] || /^\s*\|/.test(l) || /[?？]/.test(bare(l))) return
    for (const t of proseTransitions(l, fx)) addTr(i, t.from, t.to, l)
  })
  for (const t of tableTransitions(ls, code, fx)) addTr(t.i, t.from, t.to, t.line)
  // Явные обороты без стрелок.
  const RE_TO_DRAFT = /(вернуть|возврат[а-яё]*|верн[её]тся|возвраща[а-яё]*)\s+(заявк[а-яё]*\s+)?в\s+(статус\s+)?[«"`]?черновик/i
  const RE_AUTO = /авто[-‑ ]?(отклон|согласов|отмен)|автоматически\s+(отклон|согласов|отмен|переход|переводит)|по\s+истечени[июя]\s+срок/i
  ls.forEach((l, i) => {
    if (code[i] || RE_NEG.test(l) || /[?？]/.test(bare(l))) return
    if (fx.key === 'EMP-1207' && RE_TO_DRAFT.test(l)) extras.transitions.push(`возврат в черновик: [${whereOf({ i })}] ${quote(l, 110)}`)
    if (RE_AUTO.test(l)) extras.transitions.push(`авто-переход по сроку: [${whereOf({ i })}] ${quote(l, 110)}`)
  })

  // Новые бизнес-статусы. (1) Перечисление: «прогон» токенов-значений подряд (`A` | `B`, «`A` — черновик;
  // `B` — …», TS-тип 'a' | 'b'), в котором не меньше двух известных статусов, — неизвестное значение в нём новый
  // статус. Прогон рвут имя поля (camelCase, `status`), длинный разрыв и скобка с типом: так перечисление
  // `leaveType` в той же строке (run-3: `ANNUAL_PAID`) и список полей сущности (run-4: `days`) в статусы не идут.
  // (2) «статус «X»» с неизвестным X.
  const STOP = /^(status|state|enum|string|null|int|integer|number|bool|boolean|date|datetime|timestamp|uuid|id|true|false|value|type|reason|comment|version|items|page|size|total|code|message|fields|text|submit|withdraw|approve|reject|cancel|revoke|create|edit|update|decide|grant|lock|unlock|send|recall|decline|loading|empty|zero|hidden|error_source|error_forbidden|error_conflict|error_validation|camelCase|snake_case|lowercase|uppercase)$/i
  const ERR_SHAPED = /invalid|already|(^|_)not(_|$)|conflict|forbidden|validation|required|stale|missing|unavailable|denied|not_found|too_|exceed/i
  const RE_TYPE_GAP = /\(\s*(text|string|date|nullable|ссылка|enum|int|uuid|bool|timestamp|число|строка)/i
  const newSeen = new Set()
  ls.forEach((l, i) => {
    if (/уч[её]тк|(?<![A-Za-z])account/i.test(l)) return
    const toks = [...l.matchAll(/`([^`\n]+)`|'([A-Za-z_]+)'|"([A-Za-z_]+)"|(?<![A-Za-z0-9_])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![A-Za-z0-9_])/g)]
      .map((m) => ({ t: (m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), i: m.index, end: m.index + m[0].length }))
    const enumShaped = (t) => /^[A-Za-z]+(?:_[A-Za-z]+)*$/.test(t) && t.length >= 3 && !STOP.test(t) && !/[a-z][A-Z]/.test(t)
    const known = (t) => statusMentions(t, fx).some((x) => x.raw.length === t.length)
    const runs = []
    let run = []
    toks.forEach((x, k) => {
      const gap = k ? l.slice(toks[k - 1].end, x.i) : ''
      if (!enumShaped(x.t) || (run.length && (gap.length > 60 || RE_TYPE_GAP.test(gap)))) { if (run.length) runs.push(run); run = enumShaped(x.t) ? [x] : []; return }
      run.push(x)
    })
    if (run.length) runs.push(run)
    for (const r of runs) {
      if (new Set(r.filter((x) => known(x.t)).map((x) => x.t.toLowerCase())).size < 2) continue
      for (const x of r) {
        if (known(x.t) || statusMentions(x.t, fx).length || ERR_SHAPED.test(x.t)) continue
        const k = x.t.toLowerCase()
        if (newSeen.has(k)) continue
        newSeen.add(k)
        extras.newStatus.push(`\`${x.t}\`: [${whereOf({ i })}] ${quote(l.slice(Math.max(0, x.i - 60), x.end + 40), 110)}`)
      }
    }
  })
  ls.forEach((l, i) => {
    if (code[i]) return
    for (const clause of l.split(/;|\.\s/)) {
      if (/нет(?![а-яё])|не\s+(вводим|заводим|добавляем|появля|нужен|нужно|будет)|без\s+(нового\s+)?статус|вместо|не\s+меняется|оста[её]тся/i.test(clause)) continue
      for (const m of clause.matchAll(/статус[а-яё]*\s+[«"]([^»"\n]{2,40})[»"]/gi)) {
        const x = m[1].trim()
        if (statusMentions(x, fx).length || x.split(/\s+/).length > 4) continue
        const k = x.toLowerCase()
        if (newSeen.has(k)) continue
        newSeen.add(k)
        extras.newStatus.push(`«${x}»: [${whereOf({ i })}] ${quote(l, 100)}`)
      }
    }
  })

  // ── TS-ACC: ловушки idm ──
  const traps = []
  if (fx.key === 'ACS-208') {
    const markAt = (i) => {
      const l = ls[i]
      if (/🟡|к\s+валидации/i.test(l)) return '🟡'
      if (/🔵/.test(l)) return '🔵'
      const c = cardAt(i)
      // Пометка блока-списка: «- **🟡 К валидации:**» над вложенными пунктами.
      if (/^\s{2,}[-*]\s/.test(l)) {
        for (let j = i - 1; j >= Math.max(0, i - 12); j -= 1) {
          if (/^#{1,6}\s/.test(ls[j]) || !ls[j].trim()) break
          if (/^[-*]\s/.test(ls[j])) { const m = firstMark(ls[j]); if (m) return m; break }
        }
      }
      // Карточка «🔵 (возможность) / 🟡 (формат)» (base2 run-4): 🟡 в заголовке — строка внутри считается под 🟡.
      if (c) return c.hasYellow ? '🟡' : (c.markProv ?? c.markHead ?? 'без пометки')
      return 'без пометки'
    }
    const idmCtx = (i) => { const c = cardAt(i); return (c && c.foreign) || RE_IDM.test(ls[i]) }
    // Поле запроса/ответа idm — только в карточке idm или в строке, где idm названа вместе с передачей/ответом.
    // Своё поле `employeeLogin` в НАШЕЙ сущности §3.2 или в нашей авторизации законно (README).
    const idmIO = (i) => { const c = cardAt(i); return (c && c.foreign) || (RE_IDM.test(ls[i]) && /переда|отправля|получа|в\s+ответ|запрос[а-яё]*\s+(к|в)\s|тел[оа]\s+(запроса|ответа)|body|payload|параметр/i.test(ls[i]) && !inRange(s32, i)) }
    for (const tr of TRAPS) {
      const found = []
      ls.forEach((l, i) => {
        if (!l.trim() || found.length >= 3) return
        let ok = false
        if (tr.bind) {
          const left = l.split(/→|=>|—>/)[0]
          ok = !code[i] && (RE_IDM_BIND.test(left) || (cardAt(i)?.foreign && /(?<!\d)(201|404|409|422|429)(?!\d)/.test(l) && !RE_OUR_MAPPING.test(l)))
        } else if (tr.any) ok = tr.re.test(l)
        else if (tr.ctx) ok = tr.re.test(l) && (tr.key === 'field' ? idmIO(i) : idmCtx(i))
        else ok = !code[i] && tr.re.test(l)
        if (!ok) return
        const mark = markAt(i)
        const hedged = mark === '🟡' || RE_HEDGE.test(l)
        found.push({ i, line: l, mark, fact: !hedged, re: tr.re ?? RE_IDM_BIND })
      })
      if (!found.length) continue
      const violation = tr.kind === 'concrete' ? true : found.some((f) => f.fact)
      traps.push({ key: tr.key, label: tr.label, kind: tr.kind, violation, hits: found.map((f) => ({ mark: f.mark, fact: f.fact, text: `[${whereOf({ i: f.i })}, ${f.mark}${f.fact ? ', фактом' : ', под 🟡'}] ${around(f.line, f.re, 110)}` })) })
    }
  }

  // ── TS-ACC, FR-7: «учётка неактивна» и нет кнопки «Отозвать доступ» ──
  let fr7 = null
  if (fx.key === 'ACS-208') {
    const RE_INACT_UI = /уч[её]тк[а-яё]*\s+(сейчас\s+)?(не\s*активн|неактивн)|«[^»]*неактивн[^»]*»|accountActive\s*(=|==|===|:)\s*`?false|(?<![A-Za-z])inactive(?![A-Za-z])/i
    const RE_BTN = /кнопк|button|«Отозвать\s+доступ»|revoke/i
    const RE_BTN_OFF = /(кнопк[а-яё]*|button)[^.\n]{0,50}(нет|не\s+(показ|отобража|видн|рису|выводи)|скрыт|отсутств|hidden|недоступн)|(нет|без|скрыт[а-яё]*|не\s+(показ|отобража|видн))[^.\n]{0,20}(кнопк|button)|«Отозвать\s+доступ»[^.\n]{0,40}(нет|не\s+(показ|отобража|видн)|скрыт)/i
    const RE_BTN_ONLY = /(кнопк|button|«Отозвать\s+доступ»)[^.\n]{0,80}(только|лишь)\s+(при|если|когда)[^.\n]{0,40}(активн|accountActive\s*(=|==|===|:)?\s*`?true)/i
    let both = null, inact = null, btn = null
    ls.forEach((l, i) => {
      if (code[i] || both || inRange(s7, i)) return
      const w = ls.slice(Math.max(0, i - 1), i + 2).join('\n')
      if (RE_INACT_UI.test(l) && RE_BTN.test(w) && RE_BTN_OFF.test(w)) both = { i, l }
      if (!inact && RE_INACT_UI.test(l)) inact = { i, l }
      if (!btn && (RE_BTN_ONLY.test(l) || (RE_BTN_OFF.test(l) && /активн|accountActive/i.test(l)))) btn = { i, l }
    })
    const test = s7 ? ls.slice(s7[0], s7[1]).find((l) => /FR[-‑ ]?7(?!\d)/.test(l) && RE_INACT_UI.test(l)) : null
    const at = (x) => `[${whereOf(x)}] ${around(x.l, RE_INACT_UI, 120)}`
    fr7 = both ? { verdict: 'есть', anchor: at(both) }
      : (inact || btn) ? { verdict: 'частично', anchor: [inact && `неактивна: ${at(inact)}`, btn && `кнопка: ${at(btn)}`].filter(Boolean).join('; '), missing: !inact ? 'нет «учётка неактивна»' : 'не найдено, что кнопки нет' }
        : { verdict: 'нет', anchor: null }
    fr7.test = test ? quote(test, 110) : null
  }

  // ── Прочее по README (поиск по тексту) ──
  const other = []
  const add = (key, label, ok, anchor, info = false) => other.push({ key, label, ok, anchor, info })
  const header = headerOf(raw)
  const keyLine = header.find((l) => /Задача/i.test(l))
  add('key', `номер задачи ${fx.key} в шапке`, !!keyLine && keyLine.includes(fx.key), keyLine ? quote(keyLine, 60) : null)
  const sides = ls.find((l) => /Стороны[*:\s]*[^\n]{0,20}(Fullstack|full-stack|фулстек)/i.test(l))
  add('sides', '«Стороны: Fullstack»', !!sides, sides ? quote(sides, 80) : null)
  const frs = new Set()
  if (s7) for (let i = s7[0]; i < s7[1]; i += 1) for (const m of ls[i].matchAll(/FR[-‑ ]?(\d+)/g)) { const n = Number(m[1]); if (n >= 1 && n <= fx.nFR) frs.add(n) }
  const miss = []
  for (let n = 1; n <= fx.nFR; n += 1) if (!frs.has(n)) miss.push(`FR-${n}`)
  add('trace', `§7: каждый FR-1…FR-${fx.nFR} назван`, !!s7 && miss.length === 0, s7 ? (miss.length ? `нет: ${miss.join(', ')}` : `все ${fx.nFR}`) : 'раздела §7 нет')
  const placeholder = raw.some((l) => /ПРОСТАВЛЯЕТСЯ\s+ПОСЛЕ\s+ЗАПИСИ/.test(l))
  add('placeholder', 'заглушки <ПРОСТАВЛЯЕТСЯ ПОСЛЕ ЗАПИСИ> не осталось', !placeholder, placeholder ? 'осталась' : null)
  // §3.2: переход строкой-сущностью.
  const entTr = []
  if (s32) {
    for (let i = s32[0] + 1; i < s32[1]; i += 1) {
      if (code[i]) continue
      const l = ls[i]
      const m = l.match(/^\s*[-*]\s+(.*)$/) || l.match(/^#{3,6}\s+(.*)$/) || (/^(\*\*)?\s*(🟢|🔵|🟡|❓)/.test(l) ? [null, l] : null)
      if (!m) continue
      const headPart = m[1].split(/\s[—–]\s|:\s/)[0]
      if (!/🟢|🔵|🟡|❓/.test(headPart) && !/🟢|🔵|🟡|❓/.test(l.slice(0, 12))) continue
      const pr = proseTransitions(headPart, fx)
      if (pr.length || (/переход|transition/i.test(headPart) && statusMentions(headPart, fx).length)) entTr.push(quote(l, 100))
    }
  }
  add('e32t', '§3.2: переходы не записаны строками-сущностями', s32 ? entTr.length === 0 : null, entTr.length ? entTr[0] : (s32 ? null : 'раздела §3.2 нет'))
  if (fx.key === 'EMP-1207') {
    const y = ls.find((l, i) => !code[i] && /🟡/.test(l) && /справочник|(?<![а-яё])рол(ь|и|ей)(?![а-яё])|админк|EMPLOYEE|HR_LEAVE/i.test(l) && !/(?<![а-яё])нет(?![а-яё])|отсутству|🔵/i.test(l))
    add('yellowExisting', '🟡 по справочнику или ролям нет (аналитик сказал сам)', !y, y ? quote(y, 110) : null)
  } else {
    const own = cards.filter((c) => !c.foreign && /\/v1\//.test(c.body) && (c.markHead === '🟡' || c.markProv === '🟡'))
    add('ownYellow', 'свой контракт `/v1/` не под 🟡', own.length === 0, own.length ? own.map((c) => c.label).join(', ') : null)
    add('v1', 'свои пути по conventions `/v1/…`', ls.some((l) => /\/v1\//.test(l)), null, true)
    const ef = raw.find((l) => /"error"\s*:\s*\{/.test(l))
    add('errFormat', 'формат ошибки `{ "error": { "code", … } }`', !!ef, ef ? quote(ef, 80) : null, true)
    add('valFailed', '`VALIDATION_FAILED` для ошибок полей', raw.some((l) => /VALIDATION_FAILED/.test(l)), null, true)
    add('paging', 'пагинация списков (`total`)', raw.some((l) => /"total"\s*:|`total`/.test(l)), null, true)
    // README ждёт 🟡; «❓ TBD» на том же пункте — открыт, но пометка не та (по скиллу о чужой системе — 🟡).
    const RE_AUTH = /авториз|аутентиф|токен|token|заголов|сервисн[а-яё]*\s+(аккаунт|учётн|доступ|ключ)|подключени[еяю]\s+портала/i
    const authAt = (re) => ls.find((l, i) => !code[i] && re.test(l) && RE_AUTH.test(l) && (RE_IDM.test(l) || cardAt(i)?.foreign))
    const auth = authAt(/🟡|к\s+валидации/i)
    const authOther = auth ? null : authAt(/❓|(?<![A-Za-z])TBD(?![A-Za-z])|⚠️/)
    add('authYellow', '🟡 к валидации: как портал авторизуется в idm', !!auth, auth ? around(auth, RE_AUTH, 110) : (authOther ? `открыт, но помечен ❓/TBD, а не 🟡: ${around(authOther, RE_AUTH, 100)}` : null))
    const RE_FAIL = /не\s+удал|недоступ|ошибк|сбой|таймаут|timeout|(?<!\d)5\d\d(?!\d)|5xx|не\s+ответ/i
    const RE_KEEP = /оста[её]тся|остаются|не\s+меня|не\s+переходит|сохраня[а-яё]*\s+(прежн|статус)|откат/i
    const partial = (re) => {
      for (let i = 0; i < ls.length; i += 1) {
        if (code[i] || /[?？]/.test(bare(ls[i]))) continue
        const w = ls.slice(Math.max(0, i - 2), i + 3).join('\n')
        if (RE_KEEP.test(ls[i]) && re.test(ls[i]) && RE_FAIL.test(w) && (RE_IDM.test(w) || /уч[её]тк/i.test(w))) return around(ls[i], RE_KEEP, 110)
      }
      return null
    }
    const pa = partial(/на\s+согласовани|(?<![A-Za-z_])pending(?![A-Za-z_])|прежн[а-яё]*\s+статус|исходн[а-яё]*\s+статус/i)
    add('partialApprove', 'сбой idm при согласовании → заявка остаётся «На согласовании»', !!pa, pa, true)
    const pr = partial(/доступ\s+выдан|(?<![A-Za-z_])(access_)?granted(?![A-Za-z_])/i)
    add('partialRevoke', 'сбой idm при отзыве доступа → заявка остаётся «Доступ выдан»', !!pr, pr, true)
    const tri = ls.find((l) => /уч[её]тк|account/i.test(l) && /(?<![A-Za-z_])(locked|blocked)(?![A-Za-z_])|заблокирован/i.test(l) && /(?<![A-Za-z_])(terminated|closed)(?![A-Za-z_])|закрыт/i.test(l) && /enum|`[a-z_]+`\s*\|/i.test(l))
    add('accState3', 'состояние учётки без различения «заблокирована/закрыта» (мягкое, справкой)', !tri, tri ? quote(tri, 100) : null, true)
  }

  return {
    status: statusOf(raw, fx),
    actions, sub, race, extras, traps, fr7, other,
    stats: { cards: cards.length, hits: hits.length, ambiguous: ambiguous.length },
  }
}

// ─── Вопросы ──────────────────────────────────────────────────────────────────────────────────

/**
 * Вопросы ответа — «единицы» двух видов (правило — в шапке файла):
 *   A — строка с «?» вне кода (общее определение grade-gaps.mjs). Окно — её пункт списка: строка-пункт сама по
 *       себе; строка-продолжение — вверх до начала своего пункта; ниже — варианты ответа без своего «?».
 *   B — пункт без единого «?», который по форме вопрос: помечен «Q1.»/«Вопрос 1» либо несёт ≥2 варианта ответа
 *       и слово выбора («мой выбор», «предлагаю», «выберите», «вариант», «или»). Живой ответ (ts-vac-q run-3)
 *       задал шесть вопросов «**Q1. …**» + варианты «(а)/(б)» и ни одного «?» — по правилу A это ноль.
 * `title` — вопросительная часть: предложения с «?» (A) или первая строка пункта (B). По ней одной ищется
 * переспрос закрытого в БТ: обоснование «иначе после смены руководителя (FR-7)…» внутри гипотезы переспросом не
 * является, а вопросом «Можно ли повторно отправить отклонённую?» — является.
 */
function questionUnits(text) {
  const ls = lines(text)
  const code = codeFlags(ls)
  const indent = (l) => (l.match(/^\s*/) ?? [''])[0].length
  const isItem = (l) => /^\s*(\d+[.)]|[-*•])\s+/.test(l)
  const isOption = (l) => /^\s*[-*•]\s|^\s*\(?[а-яa-z]\)\s/i.test(l)
  const hasQ = (l) => /[?？]/.test(bare(l))
  const units = []
  for (const i of questionLineIdx(text)) {
    const out = [ls[i]]
    const qi = indent(ls[i])
    if (!isItem(ls[i])) {
      for (let j = i - 1; j >= Math.max(0, i - 6); j -= 1) {
        if (code[j] || !ls[j].trim() || hasQ(ls[j]) || /^#{1,6}\s/.test(ls[j])) break
        if (qi === 0 && isItem(ls[j])) break
        out.unshift(ls[j])
        if (isItem(ls[j]) && indent(ls[j]) < qi) break
      }
    }
    for (let j = i + 1; j <= Math.min(ls.length - 1, i + 4); j += 1) {
      if (code[j] || hasQ(ls[j]) || !isOption(ls[j]) || (isItem(ls[i]) && indent(ls[j]) <= qi && !/^\s*\(?[а-яa-z]\)/i.test(ls[j].replace(/^\s*[-*•]\s*/, '')))) break
      out.push(ls[j])
    }
    const title = bare(ls[i]).split(/(?<=[.!?…？])\s+/).filter((x) => /[?？]/.test(x)).join(' ')
    units.push({ kind: 'A', i, q: ls[i], w: out.join('\n'), title })
  }
  // B: пункты без «?».
  // Метка вопроса: «Q1.», «В1.», «Вопрос 2 (❓):», «Открытый вопрос — гейт 8.». «Вопросы аналитику» — не метка.
  const isLabel = (l) => /^\s*(\*\*)?\s*(Q\s*\d+|В\d+|Вопрос(?![а-яё])\s*\d*|Открыт[а-яё]*\s+вопрос(?![а-яё]))/i.test(l)
  const isTop = (l) => /^\s{0,1}\d+[.)]\s+\S/.test(l) || isLabel(l)
  let cur = null
  const flush = () => {
    if (!cur) return
    const body = cur.lines
    const opts = body.slice(1).filter((x) => isOption(x) || /^\s{0,1}\d+[.)]\s/.test(x)).length
    if (!body.some(hasQ) && (cur.label || (opts >= 2 && /мой\s+выбор|предлага|выберите|вариант|(?<![а-яё])или(?![а-яё])/i.test(body.join('\n'))))) {
      units.push({ kind: 'B', i: cur.from, q: body[0], w: body.join('\n'), title: bare(body[0]) })
    }
    cur = null
  }
  ls.forEach((l, i) => {
    if (code[i]) return
    if (/^#{1,6}\s/.test(l)) { flush(); return }
    // Под меткой нумерованные строки — варианты ответа (ts-acc run-3: «**Открытый вопрос — гейт 8.** … 1. … 2. … 3.»).
    if (cur?.label && !isLabel(l) && /^\s{0,1}\d+[.)]\s/.test(l)) { cur.lines.push(l); return }
    if (isTop(l)) { flush(); cur = { from: i, lines: [l], label: isLabel(l) }; return }
    if (!cur) return
    if (!l.trim()) {
      const nxt = ls.slice(i + 1).find((x) => x.trim()) ?? ''
      if (!(indent(nxt) >= 2 || (cur.label && (isOption(nxt) || (/^\s{0,1}\d+[.)]\s/.test(nxt) && !isLabel(nxt)))))) flush()
      return
    }
    if (indent(l) < 2 && !(cur.label && isOption(l))) { flush(); return }
    cur.lines.push(l)
  })
  flush()
  return units.sort((x, y) => x.i - y.i)
}

/** Строки ответа, по которым ищутся темы: всё вне кода, кроме строк реестра гейтов («3. Владение … — ❓ (Q1)»). */
function topicLines(text) {
  const ls = lines(text)
  const code = codeFlags(ls)
  return ls.filter((l, i) => !code[i] && l.trim() && !/^\s*\d+\.\s+[^\n]{3,80}\s[—–-]\s*(❓|✅|⏭️)/.test(l))
}

const Q_TOPICS = [
  ['status', 'ошибка/ответ при неподходящем статусе', /неподходящ[а-яё]*\s+статус|не\s+в\s+(том|своём|нужном|подходящем)\s+статус|(уже|успел[а-яё]*)\s+(отправ|согласов|отклон|отозв|отмен|реш|обработ|выдан)|статус[а-яё]*\s+(уже\s+)?(изменил|другой|сменил|не\s+позволя)|(?<!\d)409(?!\d)[^\n]{0,60}(статус|уже|конфликт|conflict)|(статус|уже)[^\n]{0,60}(?<!\d)409(?!\d)|конфликт[а-яё]*\s+статус|status\s+conflict|INVALID_STATUS|STATUS_CONFLICT|invalid_status|устаревш[а-яё]*\s+(экран|страниц|вкладк|данн|список)|втор(ой|ая)\s+вкладк|друг(ой|ая)\s+вкладк/i],
  ['transitions', 'переходы статусов', /переход(?!н)(?![а-яё]*\s+(по|между)\s+страниц)(?![а-яё]*\s+в\s+раздел)|вернуть[^?\n]{0,40}в\s+(статус\s+)?«?черновик|можно\s+ли\s+(снова\s+|повторно\s+|ещё\s+раз\s+)?(отправить|отозвать|отменить|согласовать|отклонить|править|изменить|редактировать|вернуть)|из\s+(статуса\s+)?[«"`][^»"`\n]+[»"`]\s+в\s|финальн[а-яё]*\s+статус|конечн[а-яё]*\s+статус|терминальн/i],
  ['repeat', 'повтор того же действия', /повторн[а-яё]*\s+(отправк|нажат|запрос|вызов|клик|согласовани|отзыв|отмен|блокировк)|двойн[а-яё]*\s+(нажат|клик|отправк)|дважды|идемпотент|idempoten|дубл|второй\s+раз|ещё\s+раз\s+нажм/i],
  ['concurrency', 'одновременность / гонка', /одновременн|параллельн|гонк|(?<![A-Za-z])race(?![A-Za-z])|конкурентн|оптимистич|блокировк[а-яё]*\s+(строк|запис)|верси[яи]\s+(запис|строк)|(?<![A-Za-z])version(?![A-Za-z])|ETag|If-Match|атомарн|в\s+тот\s+же\s+момент/i],
]

// Закрыто в ТЕКСТЕ БТ (вопросной пробе ответов аналитика не дают, поэтому закрытое только промптом сюда не входит).
const CLOSED = {
  'TS-VAC': [
    ['повторная отправка/правка отклонённой или отозванной (FR-1)', /(отклон[её]нн|отозванн|отклонил|отозвал)[^?\n]{0,80}(повторно|снова|ещё\s+раз|заново|править|редактир|вернуть|переотправ)|(повторно|снова|заново|переотправ|вернуть)[^?\n]{0,80}(отклон[её]нн|отозванн|после\s+(отказа|отклонени|отзыва))/i],
    ['отказ сотрудника от согласованного отпуска (FR-10)', /сотрудник[а-яё]*[^?\n]{0,60}(отменить|отозвать|отказаться)[^?\n]{0,40}согласованн|(отменить|отозвать)\s+(уже\s+)?согласованн[а-яё]*[^?\n]{0,40}сотрудник/i],
    ['дата начала прошла / наступила (FR-8, FR-10)', /задним\s+числом|дат[а-яё]*\s+начала\s+(уже\s+)?(прошла|наступила|в\s+прошлом)|прошедш[а-яё]*\s+дат[а-яё]*\s+начала|в\s+день\s+начала/i],
    ['руководитель не указан (FR-3)', /руководител[а-яё]*\s+не\s+(указан|задан|назначен|заполнен)|без\s+руководител|нет\s+руководител|руководител[а-яё]*\s+(пуст|null)/i],
    ['смена руководителя (FR-7)', /смен[а-яё]*\s+руководител|руководител[а-яё]*\s+(смени|поменя)|нов(ый|ому)\s+руководител|прежн[а-яё]*\s+руководител|старый\s+руководител/i],
    ['что в черновике и когда проверяются даты (FR-1, FR-3)', /черновик[а-яё]*[^?\n]{0,60}(пуст|без\s+(пол|дат)|любым?\s+набор|частичн|незаполн|валидир|проверя)|(валидац|провер)[а-яё]*[^?\n]{0,40}(при\s+сохранени|черновик)/i],
    ['число дней у неполного черновика (FR-1)', /(числ[а-яё]*|количеств[а-яё]*)\s+дней[^?\n]{0,60}(неполн|не\s+заполн|одн[аойу]\s+дат|пуст|null|нет\s+дат)/i],
    ['кто виден у отменённой (FR-6)', /отмен[её]нн[а-яё]*[^?\n]{0,80}(кто\s+(согласовал|отменил)|согласовавш|оба|затира|перезаписыва)|(затира|перезаписыва)[^?\n]{0,60}(согласовавш|решени)/i],
    ['порядок «Моих заявок», вид поиска (FR-5, FR-9)', /(порядок|сортир)[а-яё]*[^?\n]{0,40}(«?мои\s+заявки|списк)|поиск[а-яё]*[^?\n]{0,40}(по\s+началу|точн|подстрок|вхожден|префикс)/i],
    ['праздники, остаток, пересечения (FR-1, §3.2)', /праздни|остат[а-яё]*\s+(дн|отпуск)|пересечени|пересека|рабочи[хе]\s+дн/i],
    ['часовой пояс бизнес-правил (§1.2)', /(часов[а-яё]*\s+пояс|timezone|time\s?zone|по\s+москв|московск)[^?\n]{0,80}(следующ|наступ|сегодня|завтра|дат[аы]\s+начала|отправк)|(следующ[а-яё]*\s+дн|наступ[а-яё]*\s+дат)[^?\n]{0,80}(часов[а-яё]*\s+пояс|timezone|по\s+москв|московск)/i],
    ['уведомления, учётная система отдела кадров (§3.2)', /уведомлени|notification|учётн[а-яё]*\s+систем|учетн[а-яё]*\s+систем|(?<![А-Яа-я])1С(?![А-Яа-я])|HRIS/i],
    ['разбиение на поставки / эпик (§4.5)', /разби[а-яё]*\s+на\s+(этап|част|поставк)|эпик|(?<![A-Za-z])epic(?![A-Za-z])|одн[аоу]\s+поставк|несколько\s+поставок/i],
  ],
  'TS-ACC': [
    ['какие системы в форме подачи (FR-1)', /(как(ие|ую)|кто)\s+систем[а-яё]*[^?\n]{0,60}(форм|выбира|предлага|доступн)|(без\s+владельц|не\s+подключ)[^?\n]{0,60}(форм|выбор|подач)/i],
    ['смена владельца (FR-3)', /смен[а-яё]*\s+владельц|владел[а-яё]*\s+(смени|поменя)|нов(ый|ому)\s+владел|прежн[а-яё]*\s+владел/i],
    ['пароль (§1.4, §3.2)', /парол/i],
    ['вторая заявка / уже есть доступ / повтор после отзыва (§3.2)', /(втор[а-яё]*|повторн[а-яё]*|ещё\s+одн[а-яё]*|дубл[а-яё]*)\s+заявк|уже\s+есть\s+(доступ|заявк)|(повторн|снова)[^?\n]{0,40}(после\s+отзыв|отозванн)/i],
    ['права внутри системы (§3.2)', /(роль|роли|набор[а-яё]*\s+прав|права)\s+(внутри|в)\s+(систем|учётк)|прав[а-яё]*\s+по\s+умолчани/i],
    ['учётку закрыли не через портал (FR-7)', /не\s+через\s+портал|вручную\s+заблокир|при\s+увольнени|закрыли\s+учётк|заблокировали\s+(вручную|вне)/i],
    ['поставки / эпик (§4.5)', /разби[а-яё]*\s+на\s+(этап|част|поставк)|эпик|(?<![A-Za-z])epic(?![A-Za-z])|одн[аоу]\s+поставк|несколько\s+поставок/i],
    ['доступ на срок, уведомления (§3.2)', /на\s+срок|срок[а-яё]*\s+действи|автоматическ[а-яё]*\s+(отзыв|окончан)|уведомлени|notification/i],
  ],
}
const RE_CONV_Q = /формат[а-яё]*\s+(ошиб|дат|времен|ответ|идентификатор|тела\s+ошиб)|пагинац|(?<![A-Za-z])page(?![A-Za-z])|camelCase|snake_case|именовани[яе]\s+(пол|enum)|регистр[а-яё]*\s+enum|enum[а-яё]*[^?\n]{0,30}регистр|ISO[\s-]?8601|в\s+UTC|(?<!\d)40[34](?!\d)|"error"\s*:|VALIDATION_FAILED/i
const RE_CARD_ANCHOR = /\/api\/v2|\/accounts|E_ACC_|E_SYS_|(?<![A-Za-z_])(ENABLED|LOCKED|TERMINATED)(?![A-Za-z_])|X-Idm|idm\.(client|admin)|(?<!\d)20\s*(запрос|rps)|(?<!\d)429(?!\d)|hr\.employee\.dismissed|одн[аоу]\s+уч[её]тк|только\s+активн|employeeLogin|targetSystemCode|lockedAt|(?<!\d)422(?!\d)|разблокир|повторн[а-яё]*\s+блокировк/i
const RE_KEY_Q = /номер\s+задачи|ключ\s+задачи|Jira|SberTrack|номер\s+тикета|номер\s+в\s+трекер/i

export function gradeQuestions(answer, fxName, tool = { items: 0, failed: 0, texts: [] }) {
  const fx = FX[fxName]
  const units = questionUnits(answer)
  // Поведение чужой системы, пересказанное из карточки («учётки отвечает 422», «idm отвечает 409»), — не вопрос о
  // НАШЕМ ответе на статус и не о нашем повторе (ts-acc-q run-5): такие строки из тем выброшены.
  const tl = topicLines(answer).filter((l) => !/(?<![A-Za-z])idm(?![A-Za-z])[^.;\n]{0,80}(отвеча|ответит|верн[её]т|возвраща)|(систем[а-яё]*\s+уч[её]т[а-яё]*|уч[её]тк[а-яё]*)[^.;\n]{0,80}(отвеча|ответит|верн[её]т|возвраща)|(выжимк|карточк)[а-яё]*[^.;\n]{0,30}((?<![A-Za-z])idm(?![A-Za-z])|систем[а-яё]*\s+уч[её]т)/i.test(l))
  // Темы — по всему ответу первого хода (вопросы и гипотезы на подтверждение: «Отвечайте «да» на весь блок»),
  // это счётчик, не запрет. Строки реестра гейтов выброшены.
  const topics = {}
  for (const [k, label, re] of Q_TOPICS) {
    let hit = tl.find((l) => re.test(l))
    if (!hit && k === 'transitions') hit = tl.find((l) => RE_ARROW_SPLIT.test(l) && proseTransitions(l, fx).length)
    if (!hit) { const t = tool.texts.find((x) => re.test(x)); if (t) hit = `[инструмент] ${t}` }
    topics[k] = { label, hit: hit ? around(hit, re, 130) : null }
  }
  const closed = []
  for (const u of units) {
    const labels = CLOSED[fxName].filter(([, re]) => re.test(u.title)).map(([l]) => l)
    if (labels.length) closed.push({ q: quote(u.q, 110), labels })
  }
  const nA = units.filter((u) => u.kind === 'A').length, nB = units.length - nA
  const res = { textQ: units.length, nA, nB, toolQ: tool.items, toolFailed: tool.failed, total: units.length + tool.items, topics, closed }
  const keyQ = units.find((u) => RE_KEY_Q.test(u.w))
  res.keyQ = keyQ ? { substituted: keyQ.w.includes(fx.key), q: quote(keyQ.q, 100) } : null
  if (fxName === 'TS-ACC') {
    res.convQ = units.filter((u) => RE_CONV_Q.test(u.w)).map((u) => quote(u.q, 100))
    // Вопрос «про idm» — где idm названа в самом вопросительном предложении; упоминание в перечне сторон — нет.
    const idmQ = units.filter((u) => RE_IDM.test(u.title))
    res.idmQ = { total: idmQ.length, withCard: idmQ.filter((u) => RE_CARD_ANCHOR.test(u.w)).length, cold: idmQ.filter((u) => !RE_CARD_ANCHOR.test(u.w)).map((u) => quote(u.q, 90)) }
  }
  return res
}

// ─── Ответ без спеки: что в нём ───────────────────────────────────────────────────────────────

const RE_SPEC_IN_ANSWER = /^#\s*Техническая\s+специф/im
const RE_CLAIMS_WRITTEN = /(спек[аиу]|спецификаци[ияю]|документ|файл)[^.\n]{0,60}(записан|сохран[её]н|создан[аоы]?(?![а-яё])|готова\s+и\s+лежит)|(записал|сохранил|создал)[а-яё]*\s+(спек|файл|документ)/i
const RE_REFUSAL = /не\s+могу\s+(написать|составить|продолжить)|отказываюсь|невозможно\s+(написать|составить)|нет\s+(документа|БТ|бизнес-требований)|документ[а-яё]*\s+не\s+найден|файл[а-яё]*\s+не\s+найден|(?<![A-Za-z])precondition(?![A-Za-z])/i
export function answerCategory(ans) {
  if (!ans || !ans.trim()) return 'пусто'
  if (RE_SPEC_IN_ANSWER.test(ans)) return 'спека текстом в ответе'
  const q = questionUnits(ans).length
  if (q > 0) return `вопросы (${q})`
  if (RE_CLAIMS_WRITTEN.test(ans)) return 'ФАНТОМ: отчитался о файле'
  if (RE_REFUSAL.test(ans)) return 'отказ'
  return 'иное'
}

// ─── Поток: прочитан ли снимок, не вышел ли прогон за песочницу, вызовы инструмента вопросов ──────

const normP = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/^\/private\/(tmp|var)\//, '/$1/').toLowerCase()
const isAbs = (p) => /^[a-z]:\//.test(p) || p.startsWith('/')

function streamEvents(dir) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort()
  if (!files.length) return null
  const ev = []
  for (const f of files) {
    for (const rawLine of lines(readFileSync(join(dir, f), 'utf8'))) {
      if (!rawLine.trim()) continue
      try { ev.push(JSON.parse(rawLine)) } catch { /* обрыв строки при убитом прогоне */ }
    }
  }
  return ev
}

export function askToolStats(events) {
  const err = new Map()
  for (const j of events) {
    if (j.type !== 'user') continue
    const c = j.message?.content
    if (Array.isArray(c)) for (const x of c) if (x.type === 'tool_result') err.set(x.tool_use_id, !!x.is_error)
  }
  let calls = 0, items = 0, failed = 0
  const texts = []
  for (const j of events) {
    if (j.type !== 'assistant' || j.parent_tool_use_id) continue
    for (const c of (j.message?.content ?? [])) {
      if (c.type !== 'tool_use' || !/AskUserQuestion|ask_?user|AskUser/i.test(c.name)) continue
      calls += 1
      if (err.get(c.id)) { failed += 1; continue }
      const qs = Array.isArray(c.input?.questions) ? c.input.questions : null
      items += qs ? qs.length : 1
      if (qs) for (const q of qs) texts.push(String(q.question ?? q.header ?? ''))
      else texts.push(String(c.input?.question ?? ''))
    }
  }
  return { calls, items, failed, texts }
}

function streamAudit(dir) {
  const ev = streamEvents(dir)
  if (!ev) return { has: false }
  const sb = normP(resolve(dir))
  let skillRead = false, finished = false
  const outsideWrites = [], harness = []
  for (const j of ev) {
    if (j.type === 'result') finished = true
    if (j.type !== 'assistant' || j.parent_tool_use_id) continue
    for (const c of (j.message?.content ?? [])) {
      if (c.type !== 'tool_use') continue
      const inp = c.input || {}
      const p = normP(inp.file_path || inp.path || '')
      const cmd = String(inp.command || '')
      if ((c.name === 'Read' && /technical-spec-doc\/skill\.md$/.test(p)) || (c.name === 'Bash' && /technical-spec-doc\/SKILL\.md/i.test(cmd))) skillRead = true
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name) && p && isAbs(p) && !p.startsWith(sb)) outsideWrites.push(p)
      if ((c.name === 'Read' && /\/fixtures\/[^/]+\/(readme|[^/]*-prompt|[^/]*-turn2|expected|key)/i.test(p))
        || (c.name === 'Bash' && /fixtures\/[^\s"']*(README|-prompt|-turn2|expected|KEY)/i.test(cmd) && /(?<![A-Za-z])(cat|head|tail|less|more|type|sed|awk|grep)(?![A-Za-z])/.test(cmd))) harness.push(p || cmd.slice(0, 120))
    }
  }
  return { has: true, skillRead, finished, outsideWrites, harness, ask: askToolStats(ev) }
}

function unmeasured(dir, audit) {
  if (existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt'))) return 'отказ API'
  if (existsSync(join(dir, '_escaped.txt'))) return 'прогон вышел за песочницу (_escaped.txt)'
  const ans = read(join(dir, 'answer.md'))
  if (ans && isApiFailure(ans)) return 'отказ API в тексте ответа'
  if (audit.has && !audit.finished && ans === null) return 'прогон не завершён (в потоке нет итогового события, answer.md нет)'
  if (audit.has && audit.outsideWrites.length) return `запись вне песочницы: ${audit.outsideWrites[0]}`
  if (audit.has && audit.harness.length) return `прочитан материал стенда: ${audit.harness[0]}`
  if (audit.has && !audit.skillRead) return 'снимок скилла не прочитан'
  return null
}

function fixtureOf(dir, argFx, armName) {
  if (argFx) return argFx
  const docs = join(dir, 'coddoc')
  if (existsSync(docs)) for (const k of readdirSync(docs)) if (KEY2FX[k]) return KEY2FX[k]
  if (/ts-vac/i.test(armName)) return 'TS-VAC'
  if (/ts-acc/i.test(armName)) return 'TS-ACC'
  return null
}

/** Спека в папке задачи и мимо неё. */
function findSpecs(dir, key) {
  const p = join(dir, 'coddoc', key, 'technical_specification.md')
  const spec = existsSync(p) ? { path: `coddoc/${key}/technical_specification.md`, text: readFileSync(p, 'utf8') } : null
  const stray = walk(dir).filter((r) => /technical_specification\.md$/i.test(r) && r !== `coddoc/${key}/technical_specification.md`)
  return { spec, stray }
}

// ─── Самотест ─────────────────────────────────────────────────────────────────────────────────

const FR_ROWS = (n) => Array.from({ length: n }, (_, k) => `| FR-${k + 1} | INT-1 | Дано … Когда … Тогда … |`).join('\n')

const VAC_GOOD = `# Техническая спецификация: заявка на отпуск

> **Задача:** EMP-1207
> **Статус готовности:** Готово к разработке
>
> **Легенда происхождения:**
> 🟢 НОВОЕ — спроектировано в этом документе.
> 🟡 к валидации — допущение о существующей системе.
>
> **Открытые вопросы (решить до / во время разработки):**
> Все технические решения приняты, спецификация готова к разработке.

## 1. Обзор изменения
**Стороны:** Fullstack — фронт и бэк портала.

## 2. Взаимодействия (ядро)
- \`status\`: \`DRAFT\` — черновик; \`PENDING\` — на согласовании; \`APPROVED\` — согласована; \`REJECTED\` — отклонена; \`WITHDRAWN\` — отозвана; \`CANCELLED\` — отменена.

### INT-1. Создать черновик — 🟢
- **Контракт (запрос):** \`POST /api/leave-requests\`
- **Ошибки:** 400 \`validation_failed\` — формат поля.

### INT-2. Правка черновика — 🟢
- **Контракт (запрос):** \`PUT /api/leave-requests/{id}\`
- **Ошибки:** 400 \`validation_failed\`; 404 \`not_found\`; 409 \`invalid_status\` — заявка уже не черновик.
- **Состояния UI по ответу:** 409 \`invalid_status\` → \`error_conflict\`, перечитать заявку.

### INT-3. Отправить на согласование — 🟢
- **Контракт (запрос):** \`POST /api/leave-requests/{id}/submit\`
- **Ошибки:** 422 \`validation_failed\` — поля; 409 \`invalid_status\` — заявка уже отправлена, отозвана или решена.

### INT-4. Отозвать — 🟢
- **Контракт (запрос):** \`POST /api/leave-requests/{id}/withdraw\`
- **Ошибки:** 409 \`invalid_status\` — руководитель уже принял решение.

### INT-5. Решение руководителя — 🟢
- **Контракт (запрос):** \`POST /api/leave-approvals/{id}/approve\`, \`POST /api/leave-approvals/{id}/reject\`
- **Ошибки:** 403 \`forbidden\` — не руководитель; 409 \`invalid_status\` — заявка уже отозвана или решена.

### INT-6. Мои заявки — 🟢
- **Контракт (запрос):** \`GET /api/leave-requests\`
- **Ошибки:** 5xx — \`error_source\`.

### INT-7. Отменить согласованный отпуск — 🟢
- **Контракт (запрос):** \`POST /api/hr/leave-requests/{id}/cancel\`
- **Ошибки:** 409 \`invalid_status\` — уже отменена; 422 \`cancel_after_start\` — дата начала уже наступила.

### Каталог ошибок (сводно)
| Код | Тело/сообщение | Когда | Состояние UI |
|-----|----------------|-------|--------------|
| 400 \`validation_failed\` | \`{ code, fields }\` | INT-1, INT-2: формат поля | \`error_validation\` |
| 403 \`forbidden\` | \`{ code }\` | нет роли | \`error_forbidden\` |
| 409 \`invalid_status\` | \`{ code }\` | действие не из допустимого статуса | \`error_conflict\` — сообщение и перечитать |
| 422 \`cancel_after_start\` | \`{ code }\` | INT-7: дата начала уже наступила | «Отпуск уже начался» |

## 3. Backend — ответственность
### 3.1. По сервисам
- Переходы: \`DRAFT\` → \`PENDING\` (submit); \`PENDING\` → \`WITHDRAWN\`; \`PENDING\` → \`APPROVED\` или \`REJECTED\`; \`APPROVED\` → \`CANCELLED\`. Остальные переходы — 409 \`invalid_status\`.
### 3.2. Данные и хранение
- 🟢 \`LeaveRequest\` — поля: \`id\`, \`status\` (enum: DRAFT → PENDING → APPROVED).

## 5. Нефункциональные требования
### 5.2. Надёжность/деградация
- Гонки: переход статуса — условный UPDATE по текущему статусу; выигрывает первая записанная операция, второй получает 409 \`invalid_status\`.

## 7. Трассировка приёмки
| FR из БТ | Взаимодействие(я) | Тест-кейс |
|---|---|---|
${FR_ROWS(10)}
`

const VAC_BAD = `# Техническая спецификация: заявка на отпуск

> **Задача:** EMP-1207
> **Статус готовности:** Требуются уточнения (2)
>
> **Открытые вопросы (решить до / во время разработки):**
> 1. 🟡 к валидации: поля справочника сотрудников.

## 2. Взаимодействия (ядро)
- \`status\`: \`DRAFT\` | \`PENDING\` | \`APPROVED\` | \`REJECTED\` | \`WITHDRAWN\` | \`CANCELLED\` | \`EXPIRED\`

### INT-1. Создать черновик — 🟢
- **Контракт (запрос):** \`POST /api/leave-requests\`
- **Ошибки:** 409 \`active_request_exists\` — у сотрудника уже есть заявка на согласовании.

### INT-2. Правка черновика — 🟢
- **Контракт (запрос):** \`PUT /api/leave-requests/{id}\`
- **Ошибки:** 403 — заявка чужая или уже не черновик.

### INT-3. Отправить на согласование — 🟢
- **Контракт (запрос):** \`POST /api/leave-requests/{id}/submit\`
- **Ошибки:** 400 \`VALIDATION_FAILED\` — не заполнены поля или заявка уже отправлена.

### INT-4. Отозвать — 🟢
- **Контракт (запрос):** \`POST /api/leave-requests/{id}/withdraw\`
- **Ошибки:** 404 — заявки нет.

### INT-5. Согласовать — 🟢
- **Контракт (запрос):** \`POST /api/leave-approvals/{id}/approve\`

## 3. Backend — ответственность
### 3.1. По сервисам
- Отклонённая заявка → черновик: сотрудник может поправить и отправить снова.
- Заявку, не согласованную за 14 дней, система автоматически отклоняет.
### 3.2. Данные и хранение
- 🟢 \`Отклонена → Черновик\` — переход, выполняет сотрудник.
- 🟡 справочник сотрудников: поле руководителя — к валидации.
`

const ACC_GOOD = `# Техническая спецификация: заявка на доступ

> **Задача:** ACS-208
> **Статус готовности:** Требуются уточнения (1)
>
> **Открытые вопросы (решить до / во время разработки):**
> 1. 🟡 к валидации: как портал авторизуется в системе управления учётками.

## 1. Обзор изменения
**Стороны:** Fullstack

## 2. Взаимодействия (ядро)
- \`status\` (enum): \`pending\` — на согласовании; \`withdrawn\` — отозвана; \`rejected\` — отклонена; \`access_granted\` — доступ выдан; \`access_revoked\` — доступ отозван.

### INT-1. Подача заявки — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests\`
- **Ошибки:** 400 \`VALIDATION_FAILED\` + \`fields\` — система не подключена или без владельца.

### INT-5. Отзыв заявки сотрудником — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests/{id}/withdraw\`
- **Ошибки:** 409 \`REQUEST_NOT_PENDING\` — владелец уже принял решение.
- **Состояния UI по ответу:** 409 → сообщение и перечитанная заявка без кнопки.

### INT-6. Согласование — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests/{id}/approve\`
- **Ошибки:** 409 \`REQUEST_NOT_PENDING\` — заявка уже отозвана или решена; при повторе система учёток второй раз не вызывается.
- Если система учёток недоступна — 502 \`IDM_UNAVAILABLE\`, заявка остаётся «На согласовании».

### INT-7. Отклонение — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests/{id}/reject\`
- **Ошибки:** 409 \`REQUEST_NOT_PENDING\`.

### INT-8. Отзыв доступа — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests/{id}/revoke-access\`
- **Ошибки:** 409 \`REQUEST_NOT_GRANTED\` — заявка не в статусе «Доступ выдан»; 409 \`ACCOUNT_INACTIVE\` — учётка уже неактивна, блокировка не отправляется.
- Если система учёток не ответила — 502, заявка остаётся «Доступ выдан».

### INT-9. Заведение учётки в системе управления учётками — 🔵 подтверждено аналитиком
- **Граница/направление:** бэк портала → idm
- Передаём доменный логин и код системы, получаем идентификатор и логин учётки. Путь не выписываем.

### Каталог ошибок (сводно)
| Код | Тело | Когда | Состояние UI |
|---|---|---|---|
| 400 \`VALIDATION_FAILED\` | \`{ "error": { "code": "VALIDATION_FAILED", "message": "…", "fields": [] } }\` | INT-1 | подсветка полей |
| 409 \`REQUEST_NOT_PENDING\` | \`{ "error": { "code": "REQUEST_NOT_PENDING" } }\` | INT-5, INT-6, INT-7: заявка уже не на согласовании | сообщение, перечитать заявку |
| 409 \`REQUEST_NOT_GRANTED\` | \`{ "error": { "code": "REQUEST_NOT_GRANTED" } }\` | INT-8: статус уже другой | сообщение, перечитать заявку |
| 409 \`ACCOUNT_INACTIVE\` | \`{ "error": { "code": "ACCOUNT_INACTIVE" } }\` | INT-8: учётка неактивна | «Учётка неактивна», кнопки «Отозвать доступ» нет |

## 4. Frontend — ответственность
### 4.3. Состояния
| Имя | Условие | Что видит пользователь |
|---|---|---|
| \`accountInactive\` | \`accountActive = false\` | «Учётка неактивна», кнопки «Отозвать доступ» нет |

## 5. Нефункциональные требования
### 5.2. Надёжность/деградация
- Гонка отзыва заявки и решения владельца: условное обновление по статусу, выигрывает первая записанная операция, вторая получает 409.

## 7. Трассировка приёмки
| FR | INT | Тест |
|---|---|---|
${FR_ROWS(7)}

## 8. Допущения и открытые вопросы
- **🟡 К валидации:**
  - авторизация портала в системе управления учётками;
  - как система учёток отвечает на блокировку неактивной учётки.
`

const ACC_BAD = `# Техническая спецификация: заявка на доступ

> **Задача:** ACS-208
> **Статус готовности:** Готово к разработке

## 2. Взаимодействия (ядро)
- \`status\`: \`pending\` | \`withdrawn\` | \`rejected\` | \`granted\` | \`revoked\` | \`provisioning_failed\`

### INT-6. Согласование — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests/{id}/approve\`
- **Ошибки:** 403 — нет прав или заявка уже решена.
- Если учётку завести не удалось — заявка получает статус «Ошибка выдачи».

### INT-8. Отзыв доступа — 🟢
- **Контракт (запрос):** \`POST /v1/access-requests/{id}/revoke\`
- **Ошибки:** 409 \`INVALID_STATUS\` — заявка не в статусе «Доступ выдан».

### INT-9. Блокировка учётки в idm — 🔵 подтверждено аналитиком
- **Граница/направление:** бэк портала → idm
- **Контракт (запрос):** \`POST /api/v2/accounts/{accountId}/lock\`.
- Авторизация: заголовок \`X-Idm-Client-Token\` (🟡 к валидации).
- idm возвращает 422 \`E_ACC_STATE\`, если учётка не в \`ENABLED\`.
- Повторная блокировка той же учётки отвечает ошибкой.

## 4. Frontend — ответственность
### 4.3. Состояния
| \`granted\` | статус «Доступ выдан» | кнопка «Отозвать доступ» |
`

// Живые строки: runs/2026-10-12-status-base/ts-vac/run-1 (haiku), дословно.
const LIVE_VAC = `## 2. Взаимодействия (ядро)
- \`status\`: \`DRAFT\` — черновик; \`ON_APPROVAL\` — на согласовании; \`APPROVED\` — согласована; \`REJECTED\` — отклонена; \`WITHDRAWN\` — отозвана; \`CANCELLED\` — отменена.

### INT-2. Сохранить правку черновика — 🟢
- **Контракт (запрос):** \`PUT /api/leave-requests/{id}\`. Тело как INT-1 + \`version\` (обязательно). Разрешено только для \`DRAFT\` (FR-2).
- **Ошибки:** 400 \`validation_failed\` (формат); 404 \`not_found\` (не своя или нет); 409 \`invalid_status\` (не черновик); 409 \`stale_version\`.
- **Состояния UI по ответу:** 200 → обновить карточку; 409 \`stale_version\` → \`error_conflict\` «Заявка изменилась — обновите страницу»; 409 \`invalid_status\` → \`error_conflict\`.

### INT-9. Согласовать заявку — 🟢
- **Контракт (запрос):** \`POST /api/leave-approvals/{id}/approve\`. Поля: \`version\` (обязательно). Переход \`ON_APPROVAL\` → \`APPROVED\`; \`decision.by\` — текущий руководитель.
- **Ошибки:** 403 \`forbidden\` — текущий пользователь не руководитель заявителя; 409 \`invalid_status\` (заявка отозвана или уже решена); 409 \`stale_version\`; 404 \`not_found\`.
- **Состояния UI по ответу:** 200 → заявка исчезает из списка; 409 → \`error_conflict\` «Заявка изменилась — обновите список».

### Каталог ошибок (сводно)
| Код | Тело/сообщение | Когда | Состояние UI |
|-----|----------------|-------|--------------|
| 403 \`forbidden\` | \`{ code }\` | INT-8…INT-12: нет роли или не текущий руководитель | \`error_forbidden\` — «Нет доступа» |
| 409 \`invalid_status\` | \`{ code }\` | действие не из допустимого статуса | \`error_conflict\` |

## 3. Backend — ответственность
### 3.1. По сервисам
- Переходы статусов только по таблице: \`DRAFT\` → \`ON_APPROVAL\` (submit); \`ON_APPROVAL\` → \`WITHDRAWN\` (withdraw); \`ON_APPROVAL\` → \`APPROVED\` (approve) или \`REJECTED\` (reject); \`APPROVED\` → \`CANCELLED\` (cancel, при \`сегодня < startDate\`). Остальные переходы — 409 \`invalid_status\`.
- Основной: создать черновик → заполнить → «Отправить» (проверки FR-3) → «на согласовании» → руководитель согласовал → заявка в списке кадровика (FR-1, FR-3, FR-8, FR-9).
`

const Q_VAC = `Вопросы по тех-гейтам.

1. **Ошибки.** Если заявку уже согласовали, а сотрудник жмёт «Отозвать» со старой страницы — отвечаем 409 \`invalid_status\`. Годится?
2. **Переходы.** Можно ли вернуть отклонённую заявку в черновик?
3. **Повтор.** Двойное нажатие «Отправить» — повтор возвращает прежний результат?
4. **Одновременность.** Руководитель согласует, а сотрудник одновременно отзывает — выигрывает первый?
5. **Номер задачи.** Номер задачи — EMP-1207?
6. **Счётчик.** Обновляем число при переходе по страницам — так?`

const Q_ACC = `Перед записью сверю.
- Карточка idm: \`POST /api/v2/accounts\` заводит учётку, повторная блокировка отвечает 422 — опираемся на это?
- Как портал авторизуется в системе учёток?
- Ошибки отдаём в формате \`{ "error": { "code" } }\` из conventions, пагинация page/size — годится?
- Номер задачи?`

function selftest() {
  const res = []
  const ok = (name, cond) => res.push([name, !!cond])

  const g = gradeSpec(VAC_GOOD, 'TS-VAC')
  for (const a of ['edit', 'submit', 'withdraw', 'approve', 'reject', 'cancel']) ok(`VAC хорошая: ${a} — есть`, g.actions[a].verdict === 'есть')
  ok('VAC хорошая: статус по README', g.status.legit && g.status.kind === 'done')
  ok('VAC хорошая: отказ по дате у отмены назван', !!g.sub.date)
  ok('VAC хорошая: гонка — кто выигрывает', !!g.race)
  ok('VAC хорошая: лишнего статусного отказа нет', g.extras.refusal.length === 0)
  ok('VAC хорошая: переходов не из БТ нет', g.extras.transitions.length === 0)
  ok('VAC хорошая: новых статусов нет', g.extras.newStatus.length === 0)
  ok('VAC хорошая: §7 — все FR', g.other.find((o) => o.key === 'trace').ok)
  ok('VAC хорошая: «Стороны: Fullstack»', g.other.find((o) => o.key === 'sides').ok)
  ok('VAC хорошая: enum внутри поля §3.2 — не переход-сущность', g.other.find((o) => o.key === 'e32t').ok === true)
  ok('VAC хорошая: 🟡 по существующему нет', g.other.find((o) => o.key === 'yellowExisting').ok)

  const b = gradeSpec(VAC_BAD, 'TS-VAC')
  ok('VAC плохая: правка — частично, выдан за 403', b.actions.edit.verdict === 'частично' && b.actions.edit.missing.some((m) => /403/.test(m)))
  ok('VAC плохая: отправка — частично, выдан за проверку полей', b.actions.submit.verdict === 'частично' && b.actions.submit.missing.some((m) => /провер/.test(m)))
  ok('VAC плохая: отзыв — нет', b.actions.withdraw.verdict === 'нет')
  ok('VAC плохая: согласование — нет', b.actions.approve.verdict === 'нет')
  ok('VAC плохая: отклонение — не опознано (действия в спеке нет)', b.actions.reject.verdict === 'не опознано')
  ok('VAC плохая: лишний отказ у создания пойман', b.extras.refusal.some((x) => /создание/.test(x)))
  ok('VAC плохая: «Отклонённая → черновик» — переход не из БТ', b.extras.transitions.some((x) => /rejected → draft/.test(x)))
  ok('VAC плохая: авто-отклонение по сроку поймано', b.extras.transitions.some((x) => /авто/.test(x)))
  ok('VAC плохая: новый статус `EXPIRED` пойман', b.extras.newStatus.some((x) => /EXPIRED/.test(x)))
  ok('VAC плохая: статус не по README (N=2, пунктов 1)', !b.status.legit)
  ok('VAC плохая: переход строкой-сущностью §3.2 пойман', b.other.find((o) => o.key === 'e32t').ok === false)
  ok('VAC плохая: 🟡 по справочнику пойман', b.other.find((o) => o.key === 'yellowExisting').ok === false)
  ok('VAC плохая: гонки нет', !b.race)

  const a = gradeSpec(ACC_GOOD, 'TS-ACC')
  for (const x of ['withdraw', 'approve', 'reject', 'revoke']) ok(`ACC хорошая: ${x} — есть`, a.actions[x].verdict === 'есть')
  ok('ACC хорошая: статус по README (N=1 = пунктов)', a.status.legit && a.status.nEq)
  ok('ACC хорошая: чужая половина отзыва — отказ «учётка неактивна»', /неактивна/.test(a.sub.foreign ?? ''))
  ok('ACC хорошая: idm второй раз не вызывается', !!a.sub.idmOnce)
  ok('ACC хорошая: ловушек idm нет', a.traps.filter((t) => t.violation).length === 0)
  ok('ACC хорошая: FR-7 «неактивна» без кнопки — есть', a.fr7.verdict === 'есть')
  ok('ACC хорошая: лишнего нет', !a.extras.refusal.length && !a.extras.transitions.length && !a.extras.newStatus.length)
  ok('ACC хорошая: 🟡 авторизации в idm есть', a.other.find((o) => o.key === 'authYellow').ok)
  ok('ACC хорошая: частичный сбой согласования — остаётся «На согласовании»', a.other.find((o) => o.key === 'partialApprove').ok)
  ok('ACC хорошая: частичный сбой отзыва — остаётся «Доступ выдан»', a.other.find((o) => o.key === 'partialRevoke').ok)
  ok('ACC хорошая: 400 VALIDATION_FAILED при неподключённой системе — не лишний отказ', a.extras.refusal.length === 0)

  const z = gradeSpec(ACC_BAD, 'TS-ACC')
  const trap = (k) => z.traps.find((t) => t.key === k)
  ok('ACC плохая: путь idm пойман, пометка 🔵', trap('path')?.violation && trap('path').hits[0].mark === '🔵')
  ok('ACC плохая: заголовок idm пойман, под 🟡 — всё равно нарушение', trap('header')?.violation && trap('header').hits[0].mark === '🟡')
  ok('ACC плохая: код E_ACC_STATE фактом', trap('code')?.violation && trap('code').hits[0].fact)
  ok('ACC плохая: состояние ENABLED поймано', !!trap('state')?.violation)
  ok('ACC плохая: 422 в привязке к idm пойман', !!trap('http')?.violation)
  ok('ACC плохая: «повторная блокировка — ошибка» фактом', !!trap('relock')?.violation)
  ok('ACC плохая: новый статус `provisioning_failed`', z.extras.newStatus.some((x) => /provisioning_failed/.test(x)))
  ok('ACC плохая: новый статус «Ошибка выдачи»', z.extras.newStatus.some((x) => /Ошибка выдачи/.test(x)))
  ok('ACC плохая: «Готово» — не по README', !z.status.legit)
  ok('ACC плохая: согласование — частично, выдан за 403', z.actions.approve.verdict === 'частично' && z.actions.approve.missing.some((m) => /403/.test(m)))
  ok('ACC плохая: отзыв доступа — частично (нет каталога и UI)', z.actions.revoke.verdict === 'частично')
  ok('ACC плохая: отзыв заявки — не опознано', z.actions.withdraw.verdict === 'не опознано')
  ok('ACC плохая: FR-7 — нет', z.fr7.verdict === 'нет')
  ok('ACC плохая: 422 E_ACC_STATE в карточке idm — не наш статусный отказ у отзыва', !/E_ACC_STATE/.test(z.actions.revoke.named ?? ''))

  // Живые строки haiku (run-1).
  const L = gradeSpec(LIVE_VAC, 'TS-VAC')
  ok('живая: правка — 409 invalid_status в карточке, общий ряд каталога, UI', L.actions.edit.verdict === 'есть' && /INT-2/.test(L.actions.edit.named))
  ok('живая: согласование — 403 и 409 одной строки не смешаны (не «выдан за 403»)', L.actions.approve.verdict === 'есть' && !L.actions.approve.mixed)
  ok('живая: переходы «только по таблице» и сценарий со стрелками — не лишние', L.extras.transitions.length === 0)
  ok('живая: enum статусов — новых нет', L.extras.newStatus.length === 0)

  // Словари.
  const vac = FX['TS-VAC'], acc = FX['TS-ACC']
  ok('«на согласовании» — статус, не действие «согласование»', !wordActs('Заявка на согласовании', vac).acts.has('approve') && statusMentions('на согласовании', vac)[0]?.cls === 'pending')
  ok('«Отправить на согласование» — отправка, не согласование', [...wordActs('Отправить на согласование', vac).acts].join() === 'submit')
  ok('«согласована» — статус, не действие', !wordActs('заявка согласована', vac).acts.has('approve'))
  ok('TS-ACC: «Доступ отозван» — revoked, «Отозвана» — withdrawn', statusMentions('Доступ отозван', acc)[0]?.cls === 'revoked' && statusMentions('Отозвана', acc)[0]?.cls === 'withdrawn')
  ok('TS-ACC: голое «отзыв» — двусмысленно', wordActs('при отзыве — 409', acc).ambiguous)
  ok('отзыв из начавшегося отпуска (вне объёма) — не действие «отзыв»', !wordActs('отзыв сотрудника из уже начавшегося отпуска', vac).acts.has('withdraw'))
  ok('409 по ключу идемпотентности — не статусный отказ', refusalKind('409 — повторный Idempotency-Key с другим телом') === null)
  ok('409 `stale_version` — конфликт версии', refusalKind('409 `stale_version`') === 'version')
  ok('run-3: `LEAVE_ALREADY_STARTED` 409 — отказ по дате, не статусный', refusalKind('`LEAVE_ALREADY_STARTED` 409 (`startDate` ≤ сегодня)') === 'date')
  ok('`INVALID_STATE` рядом с датой — статусный', refusalKind('`LEAVE_ALREADY_STARTED` / `INVALID_STATE` → сообщение') === 'status')
  ok('«нельзя отозвать после решения» без ответа сервера — не отказ', refusalKind('Отозвать нельзя, если руководитель уже принял решение') === null)
  ok('«idm недоступна или отвечает 5xx» — не ловушка', !RE_IDM_BIND.test('idm недоступна или отвечает 5xx → 502 IDM_UNAVAILABLE'))
  ok('«idm вернёт 409» — ловушка', RE_IDM_BIND.test('если idm вернёт 409, учётка уже есть'))
  ok('«/v1/systems» — наш путь, не ловушка', !TRAPS[0].re.test('`GET /v1/systems` — наш справочник'))
  ok('интервал INT-8…INT-12 раскрыт', intRefs('INT-8…INT-12').length === 5)
  ok('«Статуса «Ошибка выдачи» нет» — не новый статус', gradeSpec('## 2\n- Статуса «Ошибка выдачи» нет: заявка остаётся «На согласовании».\n', 'TS-ACC').extras.newStatus.length === 0)
  ok('таблица кнопок по статусам — не переходы', tableTransitions(lines('| Статус | Кнопки |\n|---|---|\n| Отклонена | Создать новую (черновик) |'), [false, false, false], vac).length === 0)
  ok('таблица «Из | В» — переходы', tableTransitions(lines('| Из | В | Кто |\n|---|---|---|\n| Отклонена | Черновик | сотрудник |'), [false, false, false], vac).length === 1)

  // Вопросы.
  const q = gradeQuestions(Q_VAC, 'TS-VAC')
  ok('вопросы VAC: 6 строк-вопросов', q.textQ === 6)
  for (const k of ['status', 'transitions', 'repeat', 'concurrency']) ok(`вопросы VAC: тема ${k}`, !!q.topics[k].hit)
  ok('вопросы VAC: «вернуть отклонённую» — закрыто в БТ', q.closed.some((c) => c.labels.some((l) => /FR-1/.test(l))))
  ok('вопросы VAC: «переход по страницам» — не переход статусов', !gradeQuestions('Обновляем число при переходе по страницам — так?', 'TS-VAC').topics.transitions.hit)
  ok('вопросы VAC: номер задачи спрошен с подставленным ключом', q.keyQ?.substituted === true)
  const qa = gradeQuestions(Q_ACC, 'TS-ACC')
  ok('вопросы ACC: вопрос о форме conventions пойман', qa.convQ.length === 1)
  ok('вопросы ACC: idm — один пересказом карточки, один вхолодную', qa.idmQ.withCard === 1 && qa.idmQ.cold.length === 1)
  ok('вопросы ACC: номер задачи без подставленного ключа', qa.keyQ?.substituted === false)
  const ev = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'AskUserQuestion', input: { questions: [{ question: 'Код при конфликте статуса — 409?' }, { question: 'Годится?' }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'ok' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'AskUserQuestion', input: { questions: [{ question: 'x?' }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'No such tool' }] } },
  ]
  const st = askToolStats(ev)
  ok('инструмент вопросов: 2 пункта из удачного вызова, неудачный — справкой', st.items === 2 && st.failed === 1 && st.calls === 2)
  ok('инструмент вопросов: тема «статус» видна и в вызове', !!gradeQuestions('', 'TS-VAC', st).topics.status.hit)

  // Вопросы без «?» (живые формы ts-vac-q run-3, ts-acc run-3).
  const QB = `## Вопросы\n\n**Q1. Владелец справочника (гейты 1, 3).** Предполагаю, что 🟡.\n- (а) Справочник — часть портала.\n- (б) Отдельный сервис.\n\n**Q2. Номер задачи (гейт 11).** Из папки: \`EMP-1207\`. Подтвердите или укажите верный.\n`
  const qb = gradeQuestions(QB, 'TS-VAC')
  ok('вопросы без «?»: две метки «Q1./Q2.» — два вопроса', qb.textQ === 2 && qb.nA === 0 && qb.nB === 2)
  const QL = `**Открытый вопрос — гейт 8.** БТ не говорит, что делать при сбое. Варианты:\n\n1. **(моё предложение)** Заявка остаётся в прежнем статусе.\n2. Отдельный статус «Ошибка выдачи».\n3. Пока не знаю.\n\n**Что уже решено:**\n- пути idm не фиксирую.\n`
  ok('метка «Открытый вопрос» + нумерованные варианты — один вопрос', gradeQuestions(QL, 'TS-ACC').textQ === 1)
  ok('реестр гейтов без вариантов — не вопросы', gradeQuestions('1. Стороны: ✅ fullstack.\n2. Инвентарь: ✅ FE↔BE.\n', 'TS-ACC').textQ === 0)
  ok('«переходных статусов не нужно» — не тема «переходы»', !gradeQuestions('Рекомендую: новых переходных статусов не нужно. Годится?', 'TS-ACC').topics.transitions.hit)
  ok('пересказ карточки «idm отвечает 409 с id учётки» — не тема «статус»', !gradeQuestions('В выжимке idm описано: заведение учётки отвечает 409 с id существующей учётки. Как быть?', 'TS-ACC').topics.status.hit)
  ok('«409 при действии не в том статусе» — тема «статус»', !!gradeQuestions('8. Каталог ошибок: 409 при действии над заявкой не в том статусе. Годится?', 'TS-VAC').topics.status.hit)

  // Карточки и механизмы (живые формы base/base2 ts-acc).
  const MIX = `## 2. Взаимодействия (ядро)
### INT-3. Состояние учётки в \`idm\` — 🔵 (возможность) / 🟡 (формат)
- **Граница/направление:** Портал (бэк) → \`idm\`
- **Контракт (запрос):** передаём \`employeeLogin\` и код системы.
- Повторная блокировка той же учётки отвечает ошибкой.
### INT-7. Карточка заявки — \`GET /v1/access-requests/{id}\` — 🟢
- **Граница/направление:** FE → BE портала; BE → \`idm\` (INT-3) только при \`status: granted\`.
- **Состояния UI по ответу:** \`accountStatus\` → состояния \`account_active\` / \`account_inactive\` / \`account_unknown\`.
### INT-11. Отзыв выданного доступа — \`POST /v1/access-requests/{id}/revoke\` — 🟢
- **Граница/направление:** FE → BE портала; BE → \`idm\` (INT-2).
- **Порядок на бэке:** заблокировать строку заявки → проверить владельца → проверить статус \`granted\` → вызвать INT-2.
- **Ошибки:** \`409 INVALID_STATUS\` (не \`granted\`); \`422 ACCOUNT_SYSTEM_REFUSED\` — idm отказала, статус остаётся «Доступ выдан».
## 3. Backend
### 3.2. Данные и хранение
- [🟢] \`AccessRequest\` — \`id\`; \`employeeLogin\` (string); \`status\` (enum).
`
  const mx = gradeSpec(MIX, 'TS-ACC')
  ok('«FE → BE; BE → idm» — наша карточка, её 409 — у отзыва доступа', /INT-11/.test(mx.actions.revoke.named ?? ''))
  ok('состояние экрана `account_inactive` без 4xx — не статусный отказ у просмотра', mx.extras.refusal.length === 0)
  ok('обобщённый отказ на любой отказ idm — законный вариант чужой половины', /обобщённый/.test(mx.sub.foreign ?? ''))
  ok('гонка: блокировка строки с проверкой статуса — механизм', /механизм/.test(mx.race ?? ''))
  ok('`employeeLogin` в карточке idm — ловушка; в нашей сущности §3.2 — нет', (mx.traps.find((t) => t.key === 'field')?.hits ?? []).length === 1)
  ok('поведение idm в карточке «🔵 / 🟡 (формат)» — под 🟡, законно', mx.traps.find((t) => t.key === 'relock')?.violation === false)

  // Ответ без спеки.
  ok('ответ: пусто', answerCategory('  ') === 'пусто')
  ok('ответ: вопросы', /^вопросы \(2\)$/.test(answerCategory('Годится?\nА так?')))
  ok('ответ: фантом', /ФАНТОМ/.test(answerCategory('Спека записана в coddoc/EMP-1207/technical_specification.md, статус готов.')))
  ok('ответ: спека текстом', answerCategory('# Техническая спецификация: отпуск\n> Задача: EMP-1207') === 'спека текстом в ответе')
  ok('ответ: отказ', answerCategory('Не могу написать спеку: документ не найден.') === 'отказ')

  let bad = 0
  for (const [name, pass] of res) { console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}`); if (!pass) bad += 1 }
  console.log(bad === 0 ? `\nсамопроверка пройдена (${res.length})` : `\nсамопроверка ПРОВАЛЕНА: ${bad} из ${res.length}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ─── Основной прогон ──────────────────────────────────────────────────────────────────────────

const pct = (n, d) => `${n}/${d}${d ? ` (${Math.round((n / d) * 100)}%)` : ''}`
const VERDICTS = ['есть', 'частично', 'нет', 'не опознано']

function printManual() {
  console.log('ВРУЧНУЮ (грейдер не судит):')
  for (const l of MANUAL) console.log(`  ${l}`)
}

function mainSpec(root, argFx) {
  const arm = basename(resolve(root))
  const runs = readdirSync(root).filter((n) => /^run-/.test(n)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)) || a.localeCompare(b))
  const rows = []
  let fxName = argFx
  for (const r of runs) {
    const dir = join(root, r)
    const audit = streamAudit(dir)
    const why = unmeasured(dir, audit)
    const fxR = fixtureOf(dir, argFx, arm)
    if (why || !fxR) { rows.push({ r, measured: false, why: why ?? 'фикстура не опознана' }); continue }
    fxName = fxName ?? fxR
    const fx = FX[fxR]
    const { spec, stray } = findSpecs(dir, fx.key)
    const ans = read(join(dir, 'answer.md')) ?? ''
    const row = { r, measured: true, fx: fxR, written: !!spec, stray, nextStep: /Следующий\s+шаг/i.test(ans) }
    if (!spec) row.category = answerCategory(ans)
    else row.g = gradeSpec(spec.text, fxR)
    rows.push(row)
  }
  fxName = fxName ?? '?'
  const fx = FX[fxName]
  console.log(`плечо: ${root}   фикстура: ${fxName}   режим: запись спеки`)
  printManual()
  console.log('')
  for (const row of rows) {
    if (!row.measured) { console.log(`${row.r}  НЕ ИЗМЕРЕНО — ${row.why}`); continue }
    if (!row.written) {
      console.log(`${row.r}  спека: НЕТ в coddoc/${fx.key}/ — ${row.category}${row.stray.length ? `; мимо папки: ${row.stray.join(', ')}` : ''}`)
      continue
    }
    const g = row.g
    const acts = Object.entries(g.actions).map(([a, v]) => `${fx.actions[a].short}=${v.verdict}`).join(' ')
    const viol = g.traps.filter((t) => t.violation)
    console.log(`${row.r}  спека: да  статус: «${g.status.value}» — ${g.status.verdict}  |  ${acts}  |  лишнее: отказ ${g.extras.refusal.length}, переходы ${g.extras.transitions.length}, статусы ${g.extras.newStatus.length}` +
      (row.fx === 'TS-ACC' ? `  |  ловушки idm: ${viol.length ? viol.map((t) => t.key).join(',') : '0'}  FR-7: ${g.fr7.verdict}` : ''))
    for (const [a, v] of Object.entries(g.actions)) {
      const head = `    ${fx.actions[a].label} — ${v.verdict}${v.missing.length ? ` (${v.missing.join('; ')})` : ''}`
      if (v.verdict === 'есть' || v.verdict === 'частично') {
        console.log(head)
        console.log(`        отказ: ${v.named}`)
        if (v.catalog) console.log(`        каталог: ${v.catalog}`)
        if (v.ui) console.log(`        UI: ${v.ui}`)
        if (v.mixed) console.log(`        справка — где-то смешан с 403/проверкой полей: ${v.mixed}`)
      } else console.log(`${head}${v.why ? ` — ${v.why}` : ''}`)
    }
    if (row.fx === 'TS-VAC') console.log(`    отказ по дате у отмены: ${g.sub.date ?? 'не найден'}`)
    else {
      console.log(`    отзыв доступа, чужая половина: ${g.sub.foreign ?? 'не найдена'}`)
      console.log(`    повтор согласования без второго вызова idm (справка): ${g.sub.idmOnce ?? 'не найдено'}`)
    }
    console.log(`    гонка двух ролей — кто выигрывает: ${g.race ?? 'не найдено'}`)
    for (const x of g.extras.refusal) console.log(`    ЛИШНЕЕ статусный отказ у действия без условия — ${x}`)
    for (const x of g.extras.transitions) console.log(`    ЛИШНЕЕ переход не из БТ — ${x}`)
    for (const x of g.extras.newStatus) console.log(`    ЛИШНЕЕ новый статус — ${x}`)
    if (row.fx === 'TS-ACC') {
      for (const t of g.traps) {
        console.log(`    ${t.violation ? 'ЛОВУШКА' : 'idm словами под 🟡 (законно)'} ${t.label}:`)
        for (const h of t.hits) console.log(`        ${h.text}`)
      }
      console.log(`    FR-7 «учётка неактивна» без кнопки «Отозвать доступ»: ${g.fr7.verdict}${g.fr7.verdict === 'нет' ? ' — ДЕФЕКТ трассировки' : ''}${g.fr7.missing ? ` (${g.fr7.missing})` : ''}${g.fr7.anchor ? `\n        ${g.fr7.anchor}` : ''}${g.fr7.test ? `\n        тест §7: ${g.fr7.test}` : ''}`)
    }
    for (const o of g.other) {
      const v = o.ok === null ? 'не применимо' : o.ok ? 'да' : (o.info ? 'не найдено' : 'НЕТ')
      console.log(`    ${o.info ? 'справка' : 'прочее '} ${o.label}: ${v}${o.anchor ? ` — ${o.anchor}` : ''}`)
    }
    if (row.nextStep) console.log('    прочее  «Следующий шаг» в хендоффе: ЕСТЬ (README: не должно быть)')
    if (row.stray.length) console.log(`    справка ещё спека мимо папки: ${row.stray.join(', ')}`)
  }

  // ── Сводка по плечу ──
  const m = rows.filter((r) => r.measured)
  const w = m.filter((r) => r.written)
  const N = w.length
  console.log(`\nСВОДКА ${arm} (${fxName}): измерено ${m.length} из ${rows.length}` +
    (m.length < rows.length ? ` (не измерено: ${rows.filter((r) => !r.measured).map((r) => `${r.r} — ${r.why}`).join('; ')})` : ''))
  console.log(`  ${pct(N, m.length)}\tспека записана в coddoc/${fx?.key ?? '?'}/`)
  const cats = {}
  for (const r of m.filter((x) => !x.written)) { const c = r.category.replace(/\s*\(\d+\)$/, ''); cats[c] = (cats[c] ?? 0) + 1 }
  for (const [c, n] of Object.entries(cats)) console.log(`  ${pct(n, m.length)}\tспеки нет — ${c}`)
  if (!N || !fx) return
  console.log(`  знаменатель ниже — записанные спеки (${N})`)
  console.log(`  ${pct(w.filter((r) => r.g.status.legit).length, N)}\tстатус согласован с законным исходом README`)
  console.log(`  ${pct(w.filter((r) => r.g.status.nEq || (r.g.status.kind === 'done' && !r.g.status.items)).length, N)}\tчисло N в статусе = пунктам «Открытые вопросы» (у «Готово» — пунктов 0)`)
  console.log('ЗАМЕР — действия с условием по статусу (есть / частично / нет / не опознано):')
  for (const a of Object.keys(fx.actions).filter((x) => fx.actions[x].cond)) {
    const c = VERDICTS.map((v) => w.filter((r) => r.g.actions[a].verdict === v).length)
    const miss = {}
    for (const r of w) for (const x of r.g.actions[a].missing) miss[x] = (miss[x] ?? 0) + 1
    console.log(`  ${fx.actions[a].label.padEnd(26)} ${c.join(' / ')}${Object.keys(miss).length ? `   у «частично»: ${Object.entries(miss).map(([k, n]) => `${k} ${n}`).join(', ')}` : ''}`)
  }
  console.log(`  ${pct(w.filter((r) => r.g.race).length, N)}\tгонка двух ролей: правило «кто выигрывает» названо`)
  if (fxName === 'TS-VAC') console.log(`  ${pct(w.filter((r) => r.g.sub.date).length, N)}\tотмена: отказ «дата начала наступила» назван`)
  else {
    console.log(`  ${pct(w.filter((r) => r.g.sub.foreign).length, N)}\tотзыв доступа: чужая половина (учётка неактивна / обобщённый отказ)`)
    console.log(`  ${pct(w.filter((r) => r.g.sub.idmOnce).length, N)}\tсогласование: повтор не вызывает idm второй раз (справка)`)
  }
  console.log('ЛИШНЕЕ (меньше — лучше):')
  console.log(`  ${pct(w.filter((r) => r.g.extras.refusal.length).length, N)}\tстатусный отказ у действий без условия`)
  console.log(`  ${pct(w.filter((r) => r.g.extras.transitions.length).length, N)}\tпереходы, которых нет в БТ`)
  console.log(`  ${pct(w.filter((r) => r.g.extras.newStatus.length).length, N)}\tновые бизнес-статусы`)
  if (fxName === 'TS-ACC') {
    console.log('ЛОВУШКИ idm (меньше — лучше):')
    const anyV = w.filter((r) => r.g.traps.some((t) => t.violation)).length
    console.log(`  ${pct(anyV, N)}\tхоть одна ловушка`)
    for (const tr of TRAPS) {
      const n = w.filter((r) => r.g.traps.some((t) => t.key === tr.key && t.violation)).length
      if (n) console.log(`  ${pct(n, N)}\t${tr.label}`)
    }
    console.log(`  ${pct(w.filter((r) => r.g.traps.some((t) => t.violation && t.hits.some((h) => h.fact))).length, N)}\tконкретика или поведение idm фактом (🔵 / без пометки)`)
    console.log(`  ${pct(w.filter((r) => r.g.traps.some((t) => t.kind === 'concrete' && t.hits.some((h) => !h.fact))).length, N)}\tконкретика idm под 🟡 (тоже нарушение)`)
    console.log(`  ${pct(w.filter((r) => r.g.traps.some((t) => t.kind === 'behavior' && !t.violation)).length, N)}\tповедение idm словами под 🟡 (законно, справка)`)
    const f = VERDICTS.slice(0, 3).map((v) => w.filter((r) => r.g.fr7.verdict === v).length)
    console.log(`  FR-7 «учётка неактивна» без кнопки: есть ${f[0]} / частично ${f[1]} / нет (дефект) ${f[2]}`)
  }
  console.log('ПРОЧЕЕ (поиск по тексту; «не найдено» у справки — не дефект):')
  const keys = [...new Map(w.flatMap((r) => r.g.other.map((o) => [o.key, o]))).values()]
  for (const o of keys) {
    const yes = w.filter((r) => r.g.other.find((x) => x.key === o.key)?.ok === true).length
    console.log(`  ${pct(yes, N)}\t${o.info ? '(справка) ' : ''}${o.label}`)
  }
  console.log(`  ${pct(w.filter((r) => r.nextStep).length, N)}\t«Следующий шаг» в хендоффе (меньше — лучше)`)
}

function mainQ(root, argFx) {
  const arm = basename(resolve(root))
  const runs = readdirSync(root).filter((n) => /^run-/.test(n)).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)) || a.localeCompare(b))
  const rows = []
  let fxName = argFx
  for (const r of runs) {
    const dir = join(root, r)
    const audit = streamAudit(dir)
    const why = unmeasured(dir, audit)
    const fxR = fixtureOf(dir, argFx, arm)
    const ans = read(join(dir, 'answer.md'))
    if (!why && ans === null) { rows.push({ r, measured: false, why: 'нет answer.md' }); continue }
    if (why || !fxR) { rows.push({ r, measured: false, why: why ?? 'фикстура не опознана' }); continue }
    fxName = fxName ?? fxR
    const fx = FX[fxR]
    const { spec, stray } = findSpecs(dir, fx.key)
    const seeded = new Set((read(join(dir, '_seeded.txt')) ?? '').split(/\r?\n/).filter(Boolean))
    const created = walk(dir).filter((p) => !seeded.has(p) && !/^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_.*)$/.test(p) && !p.startsWith('.claude/'))
    const tool = audit.has ? audit.ask : { items: 0, failed: 0, calls: 0, texts: [] }
    rows.push({ r, measured: true, fx: fxR, file: spec ? spec.path : (stray[0] ?? null), created, q: gradeQuestions(ans, fxR, tool), draft: RE_SPEC_IN_ANSWER.test(ans) })
  }
  fxName = fxName ?? '?'
  console.log(`плечо: ${root}   фикстура: ${fxName}   режим: первый ход, только вопросы`)
  printManual()
  console.log('')
  for (const row of rows) {
    if (!row.measured) { console.log(`${row.r}  НЕ ИЗМЕРЕНО — ${row.why}`); continue }
    const q = row.q
    const tp = Object.values(q.topics).map((t) => `${t.label.split(' ')[0]}=${t.hit ? 'да' : 'нет'}`).join(' ')
    console.log(`${row.r}  файл спеки: ${row.file ? `СОЗДАН (${row.file})` : 'нет'}  вопросов: ${q.total} (строк с «?» ${q.nA}${q.nB ? ` + пунктов без «?» ${q.nB}` : ''}${q.toolQ ? ` + инструмент ${q.toolQ}` : ''}${q.toolFailed ? `; неудачных вызовов инструмента ${q.toolFailed}` : ''})  |  ${tp}  |  о закрытом в БТ: ${q.closed.length}`)
    for (const t of Object.values(q.topics)) if (t.hit) console.log(`    ${t.label}: ${t.hit}`)
    for (const c of q.closed) console.log(`    закрыто в БТ (${c.labels.join('; ')}): ${c.q}`)
    if (q.keyQ) console.log(`    номер задачи спрошен: ${q.keyQ.substituted ? `с подставленным ${FX[row.fx].key}` : 'без подставленного ключа'} — ${q.keyQ.q}`)
    if (row.fx === 'TS-ACC') {
      console.log(`    о форме из conventions: ${q.convQ.length}${q.convQ.length ? ` — ${q.convQ[0]}` : ''}`)
      console.log(`    про idm: ${q.idmQ.total}, из них пересказом карточки ${q.idmQ.withCard}${q.idmQ.cold.length ? `; вхолодную: ${q.idmQ.cold[0]}` : ''}`)
    }
    if (row.draft) console.log('    справка: в ответе черновик спеки (заголовок «# Техническая спецификация»)')
    const other = row.created.filter((p) => p !== row.file)
    if (other.length) console.log(`    справка: создано на первом ходу ещё: ${other.slice(0, 5).join(', ')}`)
  }
  const m = rows.filter((r) => r.measured)
  const N = m.length
  console.log(`\nСВОДКА ${arm} (${fxName}): измерено ${N} из ${rows.length}` +
    (N < rows.length ? ` (не измерено: ${rows.filter((r) => !r.measured).map((r) => `${r.r} — ${r.why}`).join('; ')})` : ''))
  if (!N) return
  console.log(`  ${pct(m.filter((r) => !r.file).length, N)}\tфайла спеки нет (так и надо: turn 1 = questions only)`)
  const qs = m.map((r) => r.q.total)
  console.log(`  вопросов на прогон: ${qs.join(', ')}; медиана ${median(qs)}`)
  for (const k of Object.keys(m[0].q.topics)) console.log(`  ${pct(m.filter((r) => r.q.topics[k].hit).length, N)}\tесть вопрос: ${m[0].q.topics[k].label}`)
  console.log(`  ${pct(m.filter((r) => r.q.closed.length).length, N)}\tесть вопрос о закрытом в БТ (вопросов таких: ${m.map((r) => r.q.closed.length).join(', ')})`)
  console.log(`  ${pct(m.filter((r) => r.q.keyQ && !r.q.keyQ.substituted).length, N)}\tномер задачи спрошен без подставленного ключа`)
  if (fxName === 'TS-ACC') {
    console.log(`  ${pct(m.filter((r) => r.q.convQ.length).length, N)}\tесть вопрос о форме из conventions (README: ни одного)`)
    console.log(`  ${pct(m.filter((r) => r.q.idmQ.cold.length).length, N)}\t(справка, смотреть глазами) есть вопрос про idm без анкера карточки`)
  }
}

const isMain = !!process.argv[1] && import.meta.url.toLowerCase() === pathToFileURL(resolve(process.argv[1])).href.toLowerCase()
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--selftest')) selftest()
  const root = args.find((a) => !a.startsWith('--'))
  const fxArg = (args.find((a) => a.startsWith('--fixture=')) ?? '').slice('--fixture='.length).toUpperCase() || null
  if (!root || !existsSync(root) || !statSync(root).isDirectory() || (fxArg && !FX[fxArg])) {
    console.error('usage: node grade-status.mjs <плечо> [--q] [--fixture=TS-VAC|TS-ACC]\n       node grade-status.mjs --selftest')
    process.exit(2)
  }
  const q = args.includes('--q') || /-q$/i.test(basename(resolve(root)))
  if (q) mainQ(root, fxArg); else mainSpec(root, fxArg)
}
