#!/usr/bin/env node
// grade-ni.mjs — пробы notes-to-intent: готовый список пунктов → вход для БТ или спеки (fixtures/NI-*).
//
//   node grade-ni.mjs <каталог проб> --fx VAC|ACC|NEW|CHG|CR|REW|MR-NEW|MR-CHG|NB-IN|NB-ANS|NB-PICK|SPEC-BT|NB-REPEAT|TWIN [--verbose]
//   node grade-ni.mjs --selftest
//
// Грейдится ФАЙЛ в песочнице: вход `<папка>/<основа списка>-(bt|spec).md` (notes-to-intent/reference/intent.md).
// Четыре слоя проверок:
// 1. Ожидания исходной пробы на том же материале, импортом: MEET → gradeInput (grade-meet.mjs), MR → gradeNEW /
//    gradeCHG (grade-mr.mjs), NB → gradeInputIN / gradeInputANS (grade-minb.mjs). Адаптации — у `gradeContent`.
// 2. Место КАЖДОГО пункта списка (`PTS`, после круга 2): карта «строка пункта → допустимые места», выведенная из
//    текста скилла (layout.md, check.md, intent.md, SKILL.md Шаги 4–7) и документов засева. Пункт во входе — в
//    допустимом разделе; не во входе — место берётся из ответов прогона (сводка Шага 6, вопрос Шага 5, отчёт: «для
//    спеки — K (…)», «уже записано — K (…)», «вне документов …», «не взяты», номера `P<n>`), последнее упоминание
//    старше; место не установлено — пропуск `[сведение]` и `[решено]`/`[открыто]`, у которых есть место во входе, —
//    красный.
// 3. Дословность (Шаг 7): «со слов <кто>» у сведения, пометки «по памяти» («не помню», «не уверен»), числа пункта
//    цифрой и словом (в том числе «вместо 24»), ФИО в «решил:» / «ждёт:» / «со слов» — из этого же пункта списка,
//    `[открыто]` с `варианты:` — с «?» или обоими вариантами; потерянные «решил:», «ждёт:», «(на встрече: …)» —
//    предупреждение.
// 4. Опора (TL;DR 2, Шаг 7): КАЖДАЯ строка входа — все разделы, шапка, не только узнанные пункты — сверяется
//    `groundCheck` (ground-check.mjs) с текстом списка и репликами аналитика (w-prompt/w-turn* фикстуры, `_twin/reply-*`
//    прогона): число цифрой и словом, ФИО и роли в `решил:` / `ждёт:` / `со слов`, латиница. Не нашлось — красный.
//    «решали:» в шапке — парами «роль — ФИО» из строки `> Встреча:` списка; «решает:» — по фамилии. Мысль и набросок
//    списка узнаются и пересказом (основы слов пункта), не только словами классификатора grade-minb.mjs.
// Общие: вход ровно один и там, где велит intent.md; документы задачи и список не тронуты (хеши `_seeded.sha256`
// прогона, нет — LF-текст фикстуры); лишних файлов нет; ссылок на источник (`L<n>`, `<дата> №<n>`) нет; в шапке
// `> Задача: <KEY> · цель: <цель>`; services/ и context/ не читались. «НЕ ИЗМЕРЕНО» — только отказ API; прогон без
// ответа и без входа — красный «файл не записан».
// По правке (баги 1, 2, 4, 5, 8, 9; черновик `runs/2026-10-16-harden-edits.md`): то, что законно по тексту 1.0.0 и неверно
// после правки, — не красный, а отдельная строка «по правке» (`fix`): базовый замер на текущей версии её показывает, с
// ложью не смешивает. Новые пробы (SPEC-BT, NB-REPEAT, TWIN) — свои ожидания и ловушки, `ownChecks`.

import { resolve as pathResolve, join, relative, basename } from 'node:path'
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gradeInput, FX as MEET } from './grade-meet.mjs'
import { gradeNEW, gradeCHG } from './grade-mr.mjs'
import { gradeInputIN, gradeInputANS } from './grade-minb.mjs'
import { groundCheck, fmtMissing, numbersOf, stemOf, norm as gnorm } from './ground-check.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const lf = (s) => s.replace(/\r\n/g, '\n')
const read = (p) => lf(readFileSync(p, 'utf8'))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const yo = (s) => s.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
const RE_API_FAILURE = /API Error|Request not allowed|Please run \/login|Credit balance|rate limit|session limit|usage limit/i
// Граница слова для кириллицы — `(^|[^а-яё])`: `\b` в JS только ASCII.
const w = (stem, flags = 'i') => new RegExp('(^|[^а-яёa-z])' + stem, flags)
const any = (...rs) => ({ test: (s) => rs.some((r) => r.test(s)) })

// ---------- места ----------

const R = 'Решено'; const O = 'Открыто'; const N = 'Не входит'; const S = 'Сведения'; const X = 'Расходится с БТ'
const SEC = [R, O, N, S, X]
const OTHER = 'другой слой'; const DONE = 'уже записано'; const OUT = 'вне документов'; const THOUGHT = 'не взята'
const isSec = (p) => SEC.includes(p)

// Карта пунктов: номер строки списка → допустимые места (первое — основное) и ключ, по которому пункт узнаётся во входе
// и в сводке (все регулярки ключа — в одной строке входа или в одном куске сводки). `why` — почему мест несколько.
// Основание мест — правила скилла после круга 2:
// - слой БТ — что видит и может пользователь, в том числе при сбое; сведения о том, как бизнес работает сейчас;
//   кто заводит или обновляет данные, без которых требование не работает (layout.md);
// - спека — как сделано у нас: хранение, сервер, фон, повторы, заглушки, стенды; обмен с другими системами — подписка
//   на события, шина, запрос состояния (layout.md);
// - вне документов — только процесс команды: оценка, инструменты, встречи, статус документа (layout.md, check.md 2);
// - чужая система — «Сведения» в любом входе; `уже записано` — не во входе (intent.md);
// - во входе спеки пункта слоя БТ нет — «для БТ» (решение пользователя после круга 2: «спека делается на основании БТ»);
// - прямая пометка «(на встрече: …)» старше признаков (layout.md).
// `s` — ключ для сводки, если суть там короче, чем пункт во входе (иначе — `k`).
const P = (at, k, why, s) => ({ at, k, why, s })
// Доп. поля пункта: `fix: { places, edit }` — места, законные по тексту 1.0.0 и неверные по правке (пункт там — строка
// «по правке», не красный); `m` — регулярки, которые обязана нести каждая строка входа с этим пунктом (суть, которую
// ключ не держит: «раз в две недели», а не «раз в 2 дня»).
const PX = (p, extra) => ({ ...p, ...extra })
export const PTS = {
  VAC: {
    6: P([DONE, S], [w('бумажн')], 'БТ §5.2: бумажные заявления с февраля, срок 31 января', [any(w('бумажн'), /31\s+январ/i)]),
    7: P([O], [any(w('груз'), w('загруж'), w('залива'))]),
    8: P([S], [any(/(^|\D)40(\D|$)/, w('сорок'))]),
    9: P([R, O], [w('директор'), w('генеральн')], '«Решено» по виду; «Открыто» — если Шаг 5 спросил «Оставляем?» (заказчика в шапке списка после правки засева нет — вопроса быть не должно, место оставлено)'),
    10: P([S], [any(/20\s*октябр/i, w('табельн'))]),
    11: P([DONE, S], [w('москов')], 'БТ §1.2: по московскому времени'),
    12: P([O], [w('ежегодн')]),
    13: P([OUT], [any(w('оценк'), w('откат'))]),
    14: P([OTHER], [any(/момент\s+нажат/i, w('нажавш'))]),
    15: P([R, OTHER, DONE], [any(w('живо'), /при\s+загрузк/i, /на\s+согласование/i)], 'видимое поведение (БТ, FR-7 молчит о живом обновлении) или «опрос» (спека)'),
    16: P([OTHER], [any(w('сервер'), /в\s+заявк/i)]),
    17: P([DONE, S], [w('праздник')], 'БТ FR-1, §3.2: календарные дни, праздники вне проекта'),
    18: P([DONE, S], [any(/задним\s+числом/i, /после\s+даты\s+начала/i)], 'БТ FR-8'),
    // `[решено] не входит: …` — решение: и в «Не входит», и в «Решено» (у всех таких пунктов, ревью 2026-10-16).
    19: P([DONE, N, R], [w('начавш')], 'БТ §3.2: отзыв из начавшегося отпуска вне проекта'),
    20: P([R], [any(/FR-10/i, /в\s+день\s+(его\s+)?начала/i)]),
    21: P([S], [any(w('администратор'), /роль\s+кадровик/i)]),
    22: P([DONE, S], [any(/отдельн\S*\s+рол/i, /роли\s+руководител/i)], 'БТ §5.3, FR-7'),
    23: P([OTHER, OUT], [any(w('серы'), w('бейдж'))], 'пометка «не в требования» не называет документ', [any(w('серы'), w('бейдж'), w('цвет'), w('отозван'))]),
    24: P([DONE, N, R], [w('черновик')], 'БТ §3.2: удаление черновиков вне проекта'),
    25: P([DONE, R], [/только\s+согласованн/i], 'БТ FR-9'),
  },
  ACC: {
    6: P([S], [any(w('понедельник'), /8\s*[–-]\s*10/)]),
    7: P([S], [any(/429/, /20\s+запрос/i)]),
    8: P([R], [w('фонов')]),
    9: P([O, OTHER, X], [any(w('промежуточн'), /которого\s+в\s+БТ\s+нет/i, /«Согласована»/)], 'пометка встречи «в спецификацию — как отклонение от БТ» против слоя БТ — в обе стороны (решение пользователя 2026-10-15); отклонение от БТ во входе спеки — «Расходится с БТ» (intent.md)'),
    10: P([R], [any(w('нараста'), w('дежурн'))]),
    11: P([R], [any(w('идентификатор'), /повторн\S*\s+заведени/i)]),
    12: P([S], [any(w('администратор'), w('админ'))]),
    13: P([OTHER], [any(/повторн\S*\s+заявк/i, /заблокированн\S*\s+уч[её]тк/i)], 'слой БТ: во входе спеки нет (после круга 2)'),
    14: P([S], [any(w('уволенн'), w('восстановленн'), /новый\s+логин/i)]),
    15: P([R], [any(/логин[^.;]{0,60}(хран|ответ)/i, /(хран|ответ)[^.;]{0,60}логин/i)]),
    16: P([R], [any(/при\s+открыти/i, /открыти\S*\s+заявк/i)]),
    17: P([OTHER], [any(/не\s+удалось/i, /отозвать\s+доступ/i)], 'что видит пользователь при сбое — слой БТ (после круга 2)'),
    18: P([R], [w('синхронн')]),
    19: P([R], [any(/повторн\S*\s+блокир/i, /422/, w('неактивн'))]),
    20: P([R], [w('признак')]),
    21: P([S, OTHER, X], [w('выгрузк')], 'чужая система (её коды) или зависимость от данных — слой БТ; меняет порядок ведения справочника из БТ — «Расходится с БТ» (intent.md)'),
    22: P([S], [w('токен')]),
    23: P([N, R], [w('подписк')], 'обмен с другими системами — спека (после круга 2)'),
    24: P([S, OUT], [w('стенд')], 'поведение чужой системы или инструмент команды'),
    25: P([R], [any(w('заглушк'), /для\s+тестов/i, w('мок'))]),
    26: P([DONE, OTHER], [any(/владел\S*[^.;]{0,40}смен/i, /смен\S*[^.;]{0,40}владел/i, /видит\s+новый/i)], 'БТ: заявки видит новый владелец'),
  },
  NEW: {
    6: P([S], [any(/общий\s+ящик/i, /(^|\D)300(\D|$)/, w('трёхсот'), w('трехсот'))]),
    7: P([R], [w('трудов')]),
    8: P([N, R], [/НДФЛ/i]),
    9: P([OTHER], [any(w('хранилищ'), /на\s+бэке/i)]),
    10: P([O], [w('подпис')]),
    11: P([OTHER], [any(/кадров\S*\s+систем/i, w('интеграц'), /дат\S*\s+при[её]ма/i)]),
    12: P([R], [/(3|тр[её]х|три)\s+рабоч/i]),
    13: P([R], [any(w('исполнител'), /все\s+специалист/i)]),
    14: P([R], [any(w('администратор'), /роль\s+специалист/i)]),
    15: P([N, R], [w('переназнач')]),
    16: P([R], [w('уведомлени')]),
    17: P([R], [w('отмен')]),
    18: P([S], [any(/30\s*%/, w('тридцат'))]),
    19: P([O], [any(/кто\s+готовит/i, /главн\S*\s+бухгалтер/i, w('главбух'))]),
    20: P([R], [any(/для\s+себя/i, /за\s+другого/i)]),
    21: P([N, R], [any(w('бывш'), w('уволен'))]),
    22: P([N, R], [w('курьер')]),
    23: P([S], [any(/шаблоны\s+справок\s+у/i, /шаблон\S*[^.;]{0,40}(есть|в\s+ворде)/i)]),
    24: P([R], [any(w('выбира'), w('выбор'), w('формат'))]),
  },
  CHG: {
    6: P([R], [any(/FR-3/i, w('ежегодн'))]),
    7: P([DONE, S], [w('праздник')], 'пометка «не меняется, так и в БТ»; БТ FR-1, §3.2'),
    8: P([R], [any(/FR-9/i, w('отмен[её]нн'))]),
    9: P([DONE, R], [any(w('ближайш'), w('сортир'))], 'пометка «остаётся, как в БТ»; БТ FR-7'),
    10: P([DONE, N, R], [w('черновик')], 'БТ §3.2'),
    11: P([OTHER], [any(w('бэк'), /раз\s+в\s+сутки/i, w('джоб'))]),
    12: P([R], [/(3|тр[её]х|три)\s+(год|лет)/i]),
  },
  CR: {
    // «Как сейчас» — в «Сведениях» или парой «как сейчас → как должно стать» в «Решено» (intent.md). Ключ во входе —
    // «если пользователь молчит» или «сейчас … календарных» в одной строке: «вместо трёх календарных» в пункте L40 —
    // его собственный «как сейчас», не этот пункт (круг 2, cr run-1: «закрывается автоматически через семь рабочих
    // вместо трёх календарных» без «как сейчас», а сам пункт — «вне документов»). В сводке суть короче — ключ по
    // «календарн».
    6: P([S, R], [any(w('молч'), /сейчас[^→.;]{0,80}календарн/i)], '«как сейчас» — в «Сведениях» или парой в «Решено»', [any(w('молч'), /календарн/i)]),
    7: P([R], [/(7|сем\S*)\s+рабоч/i]),
    8: P([R], [any(w('напомин'), w('письм'))]),
    9: P([N, R], [/В\s+работе/i]),
    10: P([OTHER], [w('производственн')]),
  },
  REW: {
    6: P([DONE, OTHER], [any(/не\s+ответил/i, w('промежуточн'), w('заблокир'))], 'слой БТ во входе спеки не идёт; в спеке — открытые вопросы 1, 2'),
    7: P([R], [any(/(5|пят\S*)\s*мин/i, w('вдвое'), w('удва'))]),
    8: P([R], [any(/portal-duty/i, w('дежурн'))]),
    9: P([R], [any(w('таймаут'), w('секунд'))]),
    10: P([R], [/к[эе]ш/i]),
    11: P([R], [w('флаг')]),
    12: P([DONE, OTHER], [w('мессенджер')], 'слой БТ, уже в БТ §3.2'),
    13: P([DONE], [any(w('идентификатор'), /повторн\S*\s+заведени/i, /E_ACC_DUP/)]),
    14: P([S, R], [w('доменн')]),
  },
  'MR-NEW': {
    6: P([THOUGHT], [any(/мест\S*\s+в\s+очеред/i, w('позици'))]),
    7: P([R], [any(/мест\s+нет/i, w('вста[её]т'), w('группов'))]),
    8: P([R], [w('пуш'), any(/30/, w('тридцат'), w('полчас'))]),
    9: P([R, N], [/SMS|СМС/i]),
    10: P([O], [w('лимит')]),
    11: P([O], [any(/нужен\s+ли/i, /на\s+платн/i, /платн\S*[^.;]{0,60}финанс/i)]),
    12: P([S], [any(/15\s*%/, w('пятнадцат'))]),
    13: P([O, OUT], [any(/к\s+которому/i, w('уточнит'), /к\s+какому\s+сроку/i)], 'срок поручения: процесс команды или ожидание ответа'),
    14: P([O], [any(w('закры'), /(2|два|двух)\s*час/i)]),
    // Бывший P15 «кто начал встречу и что показывали на экране» снят из засева: «Уточнить» не о предмете — не пункт
    // (meeting-recall/SKILL.md, таблица Шага 5).
  },
  'MR-CHG': {
    6: P([THOUGHT], [any(w('предупрежд'), /осталась\s+одна/i, w('оставш'))]),
    7: P([R], [any(/12\s*час/i, w('двенадцат'))]),
    // P8 — решение «лимит поменяли», P12 — вопрос «какое новое значение»: пересказ P12 («на сколько изменён лимит —
    // ждёт: …») ключом P8 не берётся (ревью 2026-10-16).
    8: P([R], [w('лимит'), any(w('поменял'), w('измен'), /меня(ет|ем|ется|ют)/i), { test: (s) => !/жд[её]т|на\s+сколько|\?/i.test(s) }]),
    9: P([O], [/ДМС/]),
    10: P([O], [any(w('пуш'), /push/i)]),
    11: P([DONE, O, N], [w('колл')], 'БТ §2: колл-центр вне объёма'),
    12: P([O], [any(w('значени'), /на\s+сколько/i, w('числ')), any(/жд[её]т/i, /жд[её]м/i)]),
    13: P([OUT, O, OTHER], [any(w('гусев'), w('сч[её]тчик'))], 'срок поручения; где хранится счётчик — спека'),
  },
  'NB-IN': {
    // Два слова сути: «сейчас только выдача и возвраты» и «частных не принимают» — одно «не принимают» берёт пересказ
    // P13 («в пунктах без весов не принимают», ревью 2026-10-16).
    6: P([S], [any(w('возврат'), /выда\S*\s+(\S+\s+)?заказ/i), any(/не\s+принима/i, /частн\S*\s+лиц/i)]),
    7: P([R], [any(w('оплат'), /плат[ия]т/i, w('денег'))]),
    8: P([THOUGHT], [any(/трек\S*[^.;]{0,40}чек/i, /чек[^.;]{0,40}трек/i)]),
    9: P([S], [/180/]),
    10: P([S], [any(/(^|\D)19/, w('машин'), w('забира'), w('вывоз'))]),
    11: P([O], [any(w('внутри'), w('вложени'), w('вскрыв'), w('содержим'))]),
    12: P([THOUGHT], [any(/экран\S*\s+оператор/i, w('наклейк'))]),
    13: P([R], [any(/только\s+в\s+пункт/i, /где\s+есть\s+вес/i, /с\s+весами/i, /не\s+во\s+всех/i)]),
    14: P([R, N], [any(/15\s*кг/i, w('пятнадцат'))]),
    15: P([S], [/1\s?200/]),
  },
  'NB-ANS': {
    6: P([S, R], [any(w('отказыва'), /не\s+принима/i)], '«как сейчас» — в «Сведениях» или парой в «Решено»'),
    7: P([R], [any(/принима\S*,?\s+если/i, /если\s+покупк/i, /в\s+истори\S*\s+(покупок\s+)?по\s+карт/i)]),
    8: P([R], [any(w('деньг'), /с\s+которой\s+(платил|оплач)/i)]),
    9: P([S], [any(w('касс[аеуы]'), /последн\S*\s+год/i, /12\s*месяц/i)]),
    10: P([S, R], [/отч[её]т/i], 'потребность бухгалтерии: сведение или требование'),
    11: P([O], [w('акт')]),
    12: P([R], [w('паспорт')]),
  },
}
PTS['NB-PICK'] = { ...PTS['NB-IN'], 12: P([O], PTS['NB-IN'][12].k) }

// NI-SPEC-BT (Н8, fixtures/NI-SPEC-BT/expected.md). Места — каждое законное при любой метке раскладки (`новое` /
// `меняет` / `противоречит`); баги 1, 8, 9 — строкой «по правке».
const E1 = 'E1 (баг 1): решение слоя БТ с «меняет»/«противоречит» во входе спеки — «Расходится с БТ», не «для БТ»'
const E4 = 'E4 (баг 8): запрос и повтор пользователя — не признак спеки; пункт слоя БТ во входе спеки не «Решено»'
PTS['SPEC-BT'] = {
  6: P([THOUGHT], [w('таймер')]),
  7: PX(P([X, OTHER], [any(/(3|тр[её]х|три)\s+дн/i, /срок\S*\s+ожидани/i), any(w('сообщени'), /заказ\s+собран/i, /с\s+момента/i)], 'слой БТ, меняет FR-3'), { fix: { places: [OTHER], edit: E1 } }),
  8: PX(P([X, OTHER], [any(w('распределит'), /нет\s+в\s+(выбранной\s+)?аптек/i, /не\s+из\s+наличи/i, /нет\s+в\s+наличии/i)], 'слой БТ, противоречит 3.2: «Меняем?» → «Расходится с БТ»'), { fix: { places: [OTHER], edit: E1 } }),
  9: PX(P([OTHER, X, R], [any(/повторн\S*\s+запрос/i, /тот\s+же\s+препарат/i, /уже\s+есть\s+заказ/i)], 'слой БТ: новое — для БТ, меняет/противоречит FR-1 — «Расходится с БТ»'), { fix: { places: [R], edit: E4 } }),
  10: PX(P([OTHER, X, R], [any(w('лимит'), w('шест'), /(5|пят\S*)\s+заказ/i)], 'то же, что P9'), { fix: { places: [R], edit: E4 } }),
  11: P([R], [any(/без\s+к[эе]ш/i, /запросом/i)]),
  12: P([R], [any(/(3|тр[её]х)\s+раз/i, w('пауз'), w('не\\s+ответил'))]),
  13: P([R], [any(w('шин'), w('сервис\\S*\\s+уведомлени'))]),
  14: P([R], [any(w('просроч'), /фонов\S*\s+задач/i)]),
  15: P([O], [any(w('списыв'), w('синхронн'))]),
  16: P([S], [any(/(5|пят\S*)\s+секунд/i, /вечерн\S*\s+пик/i, /с\s+18/i)]),
}
// NI-NB-REPEAT (Н9): по правке E3 (баг 4) цель — «новая спека»: вход БТ из этого списка уже лежит в coddoc/CBK-208/.
// По тексту 1.0.0 — второй вход БТ (`NB-REPEAT/bt`, строка «по правке»), его места — по слою для входа БТ.
PTS['NB-REPEAT'] = {
  6: P([OTHER], [any(/(8|восьм\S*)\s+(кофе|из)/i, /тысяч/i, w('девят'))]),
  7: P([OTHER], [any(/31\s+декабр/i, w('отметк'), /20\s*₽/)]),
  8: P([OTHER], [/(6|шест\S*)\s+месяц/i]),
  9: P([OTHER], [any(/оплатил\S*\s+кешб/i, /оплачен\S*\s+кешб/i, /на\s+(ту\s+)?часть/i)]),
  10: P([OTHER, X], [any(w('работник'), w('бариста'), /свои\S*\s+номер/i)], 'граница начисления: новое — для БТ; меняет/противоречит FR-1 — «Расходится с БТ» (E1)'),
  11: P([OTHER], [any(w('переда'), /500\s*₽/)]),
  12: P([S], [any(/без\s+состав/i, /только\s+сумм/i)]),
  13: P([R], [any(w('шин'), /покупка\s+закрыта/i)]),
  14: P([THOUGHT], [any(/сразу\s+после\s+оплат/i, /не\s+дожида/i)]),
  15: P([R], [any(/раз\s+в\s+сутки/i, /03[:.]00/, w('фонов'))]),
  16: P([O], [w('истори')]),
}
{
  const at = { 6: [S], 7: [R], 8: [R], 9: [O], 10: [R], 11: [R], 12: [S], 13: [OTHER], 14: [THOUGHT], 15: [OTHER], 16: [OTHER] }
  PTS['NB-REPEAT/bt'] = Object.fromEntries(Object.entries(at).map(([n, a]) => [n, P(a, PTS['NB-REPEAT'][n].k)]))
}
// NI-TWIN (Н10): аналитик-двойник по twin-card.md — «Не вносим» на P8, «В открытые вопросы» на P9, «Поправить» на сводке.
PTS.TWIN = {
  6: P([S], [any(/перв\S*\s+пят\S*\s+чисел/i, w('машин'))]),
  7: PX(P([R], [any(/(две|2)\s+недел/i, /на\s+выбор/i)]), { m: [/недел/i] }),
  8: P([OUT], [any(/с\s+10\s+до\s+22/i, w('тр[её]хчасов'), w('интервал'), /с\s+9\s+до\s+21/i)], 'аналитик: «Не вносим»'),
  9: P([O], [any(/199/, /2\s?000/, w('бесплатн'))], 'аналитик: «В открытые вопросы»'),
  10: PX(P([R], [w('отмен'), any(/(2|два|двух)\s+дн/i, /за\s+сутки/i, /не\s+позже/i)]), { m: [/(2|два|двух)\s+дн/i] }),
  11: P([S], [any(/1\s?400/, /тысяч\S*\s+четырест/i)]),
  12: P([OTHER], [any(w('пересчит'), w('фонов'))]),
  13: P([O], [any(w('перевод'), /нов\S*\s+график/i)]),
  14: P([N, R], [/в\s+день\s+оформлени/i]),
}

// ---------- фикстуры ----------

export const FX = {
  VAC: { src: 'meet', key: 'EMP-1207', kind: 'bt', folder: 'coddoc/EMP-1207', list: 'coddoc/EMP-1207/meeting-2026-10-07.points.md', goal: /^правки\s+БТ/i, goalName: 'правки БТ', wrongGoal: 'новый БТ', etalon: 'fixtures/MEET-VAC/etalon/meeting-2026-10-07-bt.md' },
  // После круга 2: промежуточный статус, повторная заявка при заблокированной учётке и «кнопка скрыта при сбое» — слой БТ,
  // во входе спеки их быть не должно; анкеры исходной пробы на них сняты, место меряет `PTS`.
  ACC: { src: 'meet', key: 'ACS-208', kind: 'spec', folder: 'coddoc/ACS-208', list: 'coddoc/ACS-208/meeting-2026-10-09.points.md', goal: /^нов\S*\s+спек/i, goalName: 'новая спека', wrongGoal: 'правки БТ', etalon: 'fixtures/MEET-ACC/etalon/meeting-2026-10-09-spec.md', dropMust: ['midStatus', 'blocked', 'hideRevoke'] },
  NEW: { src: 'meet', key: 'HRS-311', kind: 'bt', folder: 'coddoc/HRS-311', list: 'coddoc/HRS-311/meeting-2026-10-08.points.md', goal: /^новый\s+БТ/i, goalName: 'новый БТ', wrongGoal: 'правка работающего', etalon: 'fixtures/MEET-NEW/etalon/meeting-2026-10-08-bt.md' },
  CHG: { src: 'meet', key: 'EMP-1207', kind: 'bt', folder: 'coddoc/EMP-1207', list: 'coddoc/EMP-1207/meeting-2026-10-15.points.md', goal: /^правки\s+БТ/i, goalName: 'правки БТ', wrongGoal: 'новый БТ', etalon: 'fixtures/MEET-CHG/etalon/meeting-2026-10-15-bt.md' },
  CR: { src: 'meet', key: 'SUP-412', kind: 'bt', folder: 'coddoc/SUP-412', list: 'coddoc/SUP-412/meeting-2026-10-16.points.md', goal: /^правк\S*\s+работающ/i, goalName: 'правка работающего', wrongGoal: 'новый БТ', etalon: 'fixtures/MEET-CR/etalon/meeting-2026-10-16-bt.md' },
  REW: { src: 'meet', key: 'ACS-208', kind: 'spec', folder: 'coddoc/ACS-208', list: 'coddoc/ACS-208/meeting-2026-10-14.points.md', goal: /^правки\s+спеки/i, goalName: 'правки спеки', wrongGoal: 'новая спека', etalon: 'fixtures/MEET-REW/etalon/meeting-2026-10-14-spec.md' },
  'MR-NEW': { src: 'mr', key: 'FIT-412', kind: 'bt', folder: 'coddoc/FIT-412', list: 'coddoc/FIT-412/meeting-2026-10-14.points.md', goal: /^новый\s+БТ/i, goalName: 'новый БТ', wrongGoal: 'правка работающего', etalon: 'fixtures/NI-MR-NEW/etalon/meeting-2026-10-14-bt.md', thought: 'Показывать клиенту его место в очереди' },
  'MR-CHG': { src: 'mr', key: 'MED-77', kind: 'bt', folder: 'coddoc/MED-77', list: 'coddoc/MED-77/meeting-2026-10-14.points.md', goal: /^(правки\s+БТ|правк\S*\s+работающ)/i, goalName: 'правки БТ или правка работающего', wrongGoal: 'новый БТ', etalon: 'fixtures/NI-MR-CHG/etalon/meeting-2026-10-14-bt.md', thought: 'Предупреждать пациента, что у него осталась одна отмена' },
  'NB-IN': { src: 'nb', key: 'PVZ-318', kind: 'bt', folder: 'coddoc/PVZ-318', list: 'notes/посылки-от-частных-лиц/notebook-2026-10-15.points.md', goal: /^новый\s+БТ/i, goalName: 'новый БТ', wrongGoal: 'правки спеки', etalon: 'fixtures/NI-NB-IN/etalon/notebook-2026-10-15-bt.md', thought: 'Печатать трек-номер прямо на чеке приёмки' },
  'NB-ANS': { src: 'nb', key: 'RET-214', kind: 'bt', folder: 'coddoc/RET-214', list: 'notes/возврат-товара-без-чека/notebook-2026-10-15.points.md', goal: /^(новый\s+БТ|правк\S*\s+работающ)/i, goalName: 'новый БТ или правка работающего', wrongGoal: 'правки спеки', etalon: 'fixtures/NI-NB-ANS/etalon/notebook-2026-10-15-bt.md' },
  // Тот же список, что NB-IN; аналитик берёт один набросок (fixtures/NI-NB-PICK/w-turn2.txt).
  'NB-PICK': { src: 'nb', key: 'PVZ-318', kind: 'bt', folder: 'coddoc/PVZ-318', list: 'notes/посылки-от-частных-лиц/notebook-2026-10-15.points.md', goal: /^новый\s+БТ/i, goalName: 'новый БТ', wrongGoal: 'правки спеки', etalon: 'fixtures/NI-NB-PICK/etalon/notebook-2026-10-15-bt.md', thought: 'Печатать трек-номер прямо на чеке приёмки', pick: true },
  // Пробы фазы 1.5 (fixtures/NI-*/expected.md): импортированных ожиданий нет (`imp: false`) — свои, `ownChecks`.
  'SPEC-BT': { src: 'mr', imp: false, key: 'FRM-614', kind: 'spec', folder: 'coddoc/FRM-614', list: 'coddoc/FRM-614/meeting-2026-10-13.points.md', goal: /^правки\s+спеки/i, goalName: 'правки спеки', wrongGoal: 'правки БТ', thought: 'Снимать заказ своим таймером ровно в момент, когда истёк срок' },
  'NB-REPEAT': { src: 'nb', imp: false, key: 'CBK-208', kind: 'spec', folder: 'coddoc/CBK-208', list: 'notes/кешбэк-в-кофейнях/notebook-2026-10-14.points.md', goal: /^нов\S*\s+спек/i, goalName: 'новая спека', wrongGoal: 'новый БТ', thought: 'Показывать новый баланс сразу после оплаты', alt: 'NB-REPEAT/bt' },
  // Второй вход БТ из того же списка — законен по тексту 1.0.0 (баг 4), по правке E3 его нет. Не ветка `--fx`: его выбирает
  // `gradeRun` пробы NB-REPEAT по записанному файлу.
  'NB-REPEAT/bt': { src: 'nb', imp: false, hidden: true, fixture: 'NB-REPEAT', key: 'CBK-208', kind: 'bt', folder: 'coddoc/CBK-208', list: 'notes/кешбэк-в-кофейнях/notebook-2026-10-14.points.md', goal: /^правки\s+БТ/i, goalName: 'правки БТ', wrongGoal: 'новый БТ', thought: 'Показывать новый баланс сразу после оплаты', fixGoal: 'E3 (баг 4): вход БТ из этого списка уже лежит в coddoc/CBK-208/ — по правке цель «новая спека», вход notebook-2026-10-14-spec.md, а записан второй вход БТ' },
  TWIN: { src: 'meet', imp: false, twin: true, key: 'ZKM-905', kind: 'bt', folder: 'coddoc/ZKM-905', list: 'coddoc/ZKM-905/meeting-2026-10-12.points.md', goal: /^(правки\s+БТ|правк\S*\s+работающ)/i, goalName: 'правки БТ или правка работающего', wrongGoal: 'новая спека' },
}
for (const [n, fx] of Object.entries(FX)) fx.name = n

const fixtureOf = (name) => FX[name].fixture || name
const seedDirOf = (name) => join(HERE, 'fixtures', 'NI-' + fixtureOf(name), 'seed')

// Пункты списка: номер строки файла, вид, текст без ссылки ` · …` в конце.
export function listPoints (name) {
  const lines = read(join(seedDirOf(name), FX[name].list)).split('\n')
  return lines.map((l, i) => {
    const m = l.match(/^- \[(решено|открыто|сведение|мысль|набросок)\] (.*?)(?: · [^·]+)?$/)
    return m && { n: i + 1, kind: m[1], text: m[2] }
  }).filter(Boolean)
}
const listText = (name) => read(join(seedDirOf(name), FX[name].list))
const listHead = (name) => listText(name).split('\n').filter((l) => /^> /.test(l)).join('\n')

// Реплики аналитика — второй законный источник входа (TL;DR 2): строка вызова и реплики фикстуры (`w-*.txt`), у
// прогона — ещё реплики двойника (`_twin/reply-*.txt`).
export function analystReplies (name, dir) {
  const fxDir = join(HERE, 'fixtures', 'NI-' + fixtureOf(name))
  const out = existsSync(fxDir) ? readdirSync(fxDir).filter((f) => /^w-.*\.txt$/.test(f)).sort().map((f) => read(join(fxDir, f))) : []
  const tw = dir && join(dir, '_twin')
  if (tw && existsSync(tw)) out.push(...readdirSync(tw).filter((f) => /^reply-.*\.txt$/.test(f)).sort().map((f) => read(join(tw, f))))
  return out
}
// Реплики двойника аналитика по порядку (`_twin/reply-*.txt`); двойника не было — undefined.
export function twinReplies (dir) {
  const tw = dir && join(dir, '_twin')
  if (!tw || !existsSync(tw)) return undefined
  return readdirSync(tw).filter((f) => /^reply-.*\.txt$/.test(f)).sort().map((f) => read(join(tw, f)))
}

// ---------- разбор входа ----------

function sections (text) {
  const out = {}
  let cur = null
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/)
    if (m) { cur = m[1]; out[cur] = []; continue }
    if (cur) out[cur].push(line)
  }
  return out
}

// Пункт — «- …», «* …», «N. …», «N) …» со строками-продолжениями (как в grade-meet.mjs).
function items (lines) {
  const out = []
  const MARK = /^\s*(-|\*|\d+[.)])\s+/
  for (const l of lines) {
    if (/^ ?(-|\*|\d+[.)])\s+/.test(l)) out.push(l.replace(MARK, ''))
    else if (l.trim() && out.length) out[out.length - 1] += ' ' + l.trim().replace(MARK, '')
  }
  return out
}

const normSec = (s) => {
  const t = s.replace(/[*_]/g, '').trim().toLowerCase()
  if (t.startsWith('решено')) return R
  if (t.startsWith('открыт')) return O
  if (t.startsWith('не входит')) return N
  if (t.startsWith('сведени')) return S
  if (t.startsWith('расходится')) return X
  return s
}
const allItems = (text) => Object.entries(sections(text)).flatMap(([sec, lines]) => items(lines).map((t) => ({ sec: normSec(sec), raw: sec, t })))

// ---------- сводка в ответах прогона ----------

// Где скилл сам назвал место пункта, которого нет во входе: его метки из Шагов 5–7 («для спеки — K (…)», «уже
// записано — K (…)», «вне документов …», «не взяты», «это спека (N):»). Разбор — по строкам ответа (круг 3: кусок «от
// метки до следующей метки» перескакивал строку и отдавал суть чужой метке):
// - метка с числом 0 («уже записано — 0», «Другой слой, уже записано, вне документов: 0.») места не даёт;
// - скобка «(…)» — ближайшей метки перед ней;
// - строка без скобок с одной меткой — целиком её («- Мысль про трек-номер на чеке не взята: 1.»); меток несколько —
//   от метки до следующей;
// - строка кончается «:» — список под ней (нумерованный или маркированный) — последней метки строки.
// В куске пункт узнаётся по `P<n>`, по ключу из `PTS` или по основам слов (`bestPoint`): суть в сводке короче пункта
// («порядок заявок у руководителя», «дни календарные»). Ходы — по порядку, последнее упоминание старше.
const CAT_RES = [
  [OTHER, /(^|[^а-яё])для\s+(БТ|спек[а-яё]*)\**\s*(\(|[—–:-]|\d)|это\s+(спека|БТ)\s*\(|друг(ой|ого)\s+сло[йя]/gi],
  [DONE, /уже\s+записан[а-яё]*/gi],
  [OUT, /вне\s+документов|[«"]не\s+вносим[»"]\s*[—–:-]\s*\d/gi],
  [THOUGHT, /не\s+взят[а-яё]*|наброск[а-яё]*\s+во\s+вход\s+не\s+беру/gi],
]
// Основа слова — без окончания: не длиннее 5 букв и на 2 короче слова, не короче 3 («заявок», «заявки» → «заяв»);
// основы совпадают, если одна — начало другой. Служебные слова и слова самих меток не считаются.
const STOP_W = new Set(['что', 'как', 'это', 'для', 'или', 'все', 'при', 'без', 'так', 'уже', 'она', 'они', 'его', 'нет', 'есть', 'если', 'только', 'когда', 'после', 'через', 'тот', 'там', 'где', 'кто', 'чем', 'ещё', 'еще', 'этот', 'этом'])
const STOP_P = ['спек', 'записан', 'документ', 'вносим', 'взят', 'мысл', 'наброс']
const stems = (s) => new Set((yo(s).toLowerCase().match(/[а-яa-z0-9]+/g) || [])
  .filter((x) => x.length >= 3 && !STOP_W.has(x) && !STOP_P.some((p) => x.startsWith(p)))
  .map((x) => x.slice(0, Math.min(5, Math.max(3, x.length - 2)))))
// Пункт, на который похож кусок сводки: не меньше двух общих основ, доля общих в куске не меньше половины, и он один
// лучший (ничья — не пункт).
export function bestPoint (piece, pts) {
  const a = stems(piece)
  if (a.size < 2) return null
  let best = null; let bs = 0; let bc = 0; let second = 0
  for (const p of pts) {
    const b = [...stems(mainText(p.text))]
    let c = 0
    for (const x of a) if (b.some((y) => y.startsWith(x) || x.startsWith(y))) c++
    const sc = c / a.size
    if (sc > bs) { second = bs; bs = sc; bc = c; best = p } else if (sc > second) second = sc
  }
  return bc >= 2 && bs >= 0.5 && bs > second ? best : null
}
const RE_LIST_ITEM = /^\s*(\d+[.)]|[-*•])\s/
// Места в документе, названные в тексте: «FR-7», «§3.2» / «3.2».
const docRefs = (t) => new Set([...(t || '').matchAll(/FR-\d+|(?:§\s*)?(?<![\d.])\d+\.\d+(?![\d.])/gi)].map((m) => m[0].toUpperCase().replace(/^§\s*/, '')))

// Раскладка, которую скилл получил от субагента Шага 2 («рубрика прочитана: раскладка» и строки `P<n> <слой> · <место>`),
// — из потоков прогона; последняя старше. Нет — пустая карта.
export function layoutOf (dir) {
  const out = new Map()
  const checks = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort()) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      for (const c of content) {
        if (!c || c.type !== 'text') continue
        if (/^\s*рубрика прочитана: раскладка/.test(c.text || '')) {
          for (const m of c.text.matchAll(/^P(\d+)\s+(БТ|спека|чужая система|вне документов)\s*·\s*(.+)$/gm)) out.set(Number(m[1]), { layer: m[2], doc: m[3].trim() })
        }
        // Вердикт проверки «P<n> слой: <другой>» меняет слой пункта (SKILL.md, Шаг 3) — после раскладки.
        if (/^\s*рубрика прочитана: проверка/.test(c.text || '')) checks.push(c.text)
      }
    }
  }
  for (const t of checks) for (const m of t.matchAll(/^P(\d+)\s+слой:\s*(БТ|спека|чужая система|вне документов)/gm)) {
    const l = out.get(Number(m[1]))
    if (l) l.layer = m[2]
  }
  return out
}

// Место пункта в документе: из раскладки прогона, иначе из причины в `PTS` («БТ FR-7», «БТ §3.2»).
const docPlace = (name, n, layout) => (layout && layout.get(n) ? layout.get(n).doc : PTS[name][n].why || '')

// `opts.inInput` — номера пунктов, найденных во входе; `opts.layout` — раскладка прогона (`layoutOf`).
export function summaryPlaces (turns, name, opts = {}) {
  const pts = listPoints(name)
  const map = PTS[name]
  const layout = opts.layout || new Map()
  const inInput = opts.inInput || new Set()
  const place = new Map()
  const counts = {}
  const take = (seg, cat) => {
    const nums = new Set([...seg.matchAll(/(^|[^A-Za-z])P(\d+)/g)].map((m) => Number(m[2])))
    for (const p of pts) if (nums.has(p.n) || (map[p.n].s || map[p.n].k).every((re) => re.test(seg))) place.set(p.n, cat)
    for (const piece of seg.split(/[,;]/)) { const p = bestPoint(piece, pts); if (p) place.set(p.n, cat) }
    // Кусок называет место в документе («порядок списка у руководителя (FR-7)»), и это место — ровно у одного пункта.
    for (const ref of docRefs(seg)) {
      const hit = pts.filter((p) => docRefs(docPlace(name, p.n, layout)).has(ref))
      if (hit.length === 1) place.set(hit[0].n, cat)
    }
  }
  for (const text of turns) {
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const marks = []
      for (const [cat, re] of CAT_RES) for (const m of line.matchAll(re)) marks.push({ at: m.index, end: m.index + m[0].length, cat })
      if (!marks.length) continue
      marks.sort((a, b) => a.at - b.at)
      for (const mk of marks) {
        const c = line.slice(mk.end, mk.end + 45).match(/^[^(\d\n]*?(\d+)/)
        mk.zero = !!c && c[1] === '0'
        if (c) counts[mk.cat] = Number(c[1])
      }
      const live = marks.filter((mk) => !mk.zero)
      const groups = [...line.matchAll(/\(([^()]*)\)/g)]
      // Одна метка в строке — строка целиком её, и скобки до метки тоже («… (FR-7) и … (3.2) — уже записаны в БТ»).
      if (live.length === 1 && marks.length === 1) take(line, live[0].cat)
      else if (groups.length) {
        for (const g of groups) {
          const mk = marks.filter((x) => x.end <= g.index).pop()
          if (mk && !mk.zero) take(g[1], mk.cat)
        }
      } else marks.forEach((mk, j) => { if (!mk.zero) take(line.slice(mk.at, j + 1 < marks.length ? marks[j + 1].at : line.length), mk.cat) })
      // Список под строкой, которая кончается «:».
      if (live.length && /:\s*\**\s*$/.test(line)) {
        const cat = live[live.length - 1].cat
        for (let j = i + 1; j < lines.length && RE_LIST_ITEM.test(lines[j]); j++) take(lines[j], cat)
      }
    }
  }
  // Счёт как покрытие: «уже записано — K», и пунктов вне входа с местом «уже записано» по раскладке прогона (нет её — по
  // `PTS`) ровно K — это они; суть которых сводка назвала иначе, место по счёту не меняют.
  const k = counts[DONE]
  if (k > 0) {
    const cand = pts.filter((p) => !inInput.has(p.n) && (layout.size ? /^уже\s+записано/i.test((layout.get(p.n) || {}).doc || '') : PTS[name][p.n].at.includes(DONE)))
    if (cand.length === k) for (const p of cand) if (!place.has(p.n)) place.set(p.n, DONE)
  }
  return place
}

// ---------- дословность (Шаг 7) ----------

const NUM_WORD = { 1: 'од(ин|на|ну|ного|ной|ним)', 2: 'дв(а|е|ух)', 3: 'тр(и|[её]х)', 4: 'четыр', 5: 'пят', 6: 'шест', 7: 'сем', 8: 'восем', 10: 'десят', 12: 'двенадцат', 15: 'пятнадцат', 20: 'двадцат', 24: 'двадцат\\S*\\s+четыр', 30: 'тридцат', 40: 'сорок' }
// «1 200» и «1200» — одно число: пробел между разрядами снимается (ревью 2026-10-16).
const joinDigits = (t) => t.replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, '$1')
const hasNum = (t, n) => new RegExp('(^|[^\\d])' + esc(n) + '([^\\d]|$)').test(joinDigits(t)) || (NUM_WORD[n] && w(NUM_WORD[n]).test(t))
// Основной текст пункта: без хвоста «— решил: / — со слов / — ждёт:» и без пометок «(на встрече: …)».
const mainText = (t) => t.split(/\s+—\s+(решил|ждёт|со\s+слов)/)[0].replace(/\(на встрече:[^)]*\)/g, '')
const stem = (word) => yo(word).slice(0, Math.max(4, word.length - 2)).toLowerCase()
// Сколько раз встречается каждое число (цифрой и словом, ground-check.mjs `numbersOf`).
const numCount = (t) => numbersOf(t).reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())

// Пункты списка, чей ключ узнаёт строку входа (строка может нести два пункта).
const pointsOf = (t, name) => listPoints(name).filter((p) => PTS[name][p.n] && PTS[name][p.n].k.every((re) => re.test(t)))
// Основа слова есть в тексте (как в ground-check.mjs: граница слова, начало основы).
const hasStemIn = (text, word) => new RegExp('(^|[^а-яa-z])' + esc(stemOf(word))).test(gnorm(text))
// ФИО в полях людей: «решил: Литвинов И. П.», «ждёт: Ким Сергей», «со слов Зуева Т. Р.» — слова с заглавной и строчными
// (не «ИБ», не инициалы). Роли и «решает:» сюда не идут: роли меряет опора, «решает:» — roleChecks.
const RE_PERSON_FIELD = /(решил[аи]?|принял[аи]?|жд[её]т|со\s+слов)\s*:?\s*([^·;\n]+)/gi
function fioOf (t) {
  const out = []
  for (const m of String(t).matchAll(RE_PERSON_FIELD)) {
    const val = m[2].split(/[)→]/)[0].replace(/\s[—–-]\s.*$/, '').replace(/\(.*?\)/g, ' ').split(/\s+/).slice(0, 6).join(' ')
    for (const x of val.match(/[А-ЯЁ][а-яё]{2,}(-[А-ЯЁ][а-яё]+)?/g) || []) out.push({ field: m[1].replace(/\s+/g, ' '), who: x })
  }
  return out
}
// Варианты `[открыто]`: «варианты: A или B» / «варианты: A; B» до «; до ответа:».
function variantsOf (text) {
  const m = text.match(/варианты:\s*(.*?)(?:;\s*до\s+ответа:|$)/)
  if (!m) return []
  return (m[1].includes(';') ? m[1].split(';') : m[1].split(/\s+или\s+/)).map((s) => s.trim()).filter(Boolean)
}
const vStems = (s) => (yo(s).toLowerCase().match(/[а-яa-z]{4,}/g) || []).map((x) => x.slice(0, Math.max(4, x.length - 2)))
// Вариант есть в строке: больше половины его отличительных основ (которых нет у других вариантов) — начала слов строки.
// Больше половины, а не все: пересказ теряет слово («в очередь «Управления доступом»» без «команды»).
function variantIn (v, others, t) {
  const words = yo(t).toLowerCase().match(/[а-яa-z]+/g) || []
  const near = (a, b) => a.startsWith(b) || b.startsWith(a)
  const own = vStems(v)
  const rest = others.flatMap(vStems)
  const dist = own.filter((s) => !rest.some((r) => near(r, s)))
  const need = dist.length ? dist : own
  return need.filter((s) => words.some((x) => x.startsWith(s))).length * 2 > need.length
}

export function literalChecks (p, found, name, replies = []) {
  const red = []
  const warn = []
  const all = found.map((x) => x.t).join(' \n ')
  const tag = `P${p.n} «${p.text.slice(0, 40)}»`
  const inS = found.filter((x) => x.sec === S)
  const sl = p.text.match(/со\s+слов\s+([А-ЯЁ][а-яё-]+)/)
  if (p.kind === 'сведение' && sl && inS.length && !inS.some((x) => /со\s+слов/i.test(x.t) && yo(x.t).toLowerCase().includes(stem(sl[1])))) red.push(`${tag}: потеряно «со слов ${sl[1]}»`)
  for (const mark of ['не помню', 'не уверен']) if (p.text.includes(mark) && !all.includes(mark)) red.push(`${tag}: потеряна пометка «${mark}»`)
  const nums = [...new Set((joinDigits(mainText(p.text)).match(/\d+/g) || []))]
  // Цифра пункта во входе цифрой или словом («около 300» = «около трёхсот»).
  const allVals = new Set(numbersOf(all, true))
  const lost = nums.filter((n) => !hasNum(all, n) && !allVals.has(Number(n)))
  if (lost.length) red.push(`${tag}: потеряно число ${lost.join(', ')}`)
  // Числа словами («три дня», «четыре человека»): сколько раз в основном тексте пункта — столько и в основном тексте
  // строк входа; «один/одна» не меряется («за рабочий день» = «за один рабочий день»). Сравнивается основной текст:
  // «FR-3» в хвосте «до ответа» не прикрывает «три дня» → «четыре дня».
  const have = numCount(found.map((x) => mainText(x.t)).join(' \n '))
  const lostW = [...numCount(mainText(p.text))].filter(([v, c]) => v !== 1 && !lost.includes(String(v)) && (have.get(v) || 0) < c).map(([v]) => v)
  if (lostW.length) red.push(`${tag}: потеряно число ${lostW.join(', ')} (словами)`)
  // ФИО в «решил:» / «ждёт:» / «со слов» строки входа — из пунктов, которые эта строка несёт, или из реплик аналитика.
  for (const x of found) {
    const pq = pointsOf(x.t, name)
    const own = pq.map((q) => q.text).concat(replies).join('\n')
    // «В открытые вопросы» (SKILL.md:142): решение уходит в «Открыто» «с тем, кого ждём» — кто, не сказано; любой участник.
    const anyone = x.sec === O && pq.some((q) => q.kind === 'решено') ? listHead(name) : ''
    for (const f of fioOf(x.t)) if (!hasStemIn(own, f.who) && !(/жд/.test(f.field) && hasStemIn(anyone, f.who))) red.push(`${tag}: «${f.field}: ${f.who}» — в пункте списка другой человек`)
  }
  // Суть, которую ключ не держит (`m`): «раз в две недели» — не «раз в 2 дня».
  for (const re of PTS[name][p.n].m || []) for (const x of found) if (!re.test(x.t)) red.push(`${tag}: суть пункта искажена — нет «${re.source}»: «${x.t.slice(0, 60)}»`)
  // `[открыто]` с вариантами — вопросом («?») или обоими вариантами; один вариант утверждением — решённое (ревью).
  const vs = p.kind === 'открыто' ? variantsOf(p.text) : []
  if (vs.length > 1) {
    for (const x of found) {
      if (/\?/.test(x.t) || vs.every((v, i) => variantIn(v, vs.filter((_, j) => j !== i), x.t))) continue
      red.push(`${tag}: открытый вопрос с вариантами во входе утверждением — ни «?», ни обоих вариантов: «${x.t.slice(0, 60)}»`)
    }
  }
  const vm = mainText(p.text).match(/вместо\s+(\S+)(\s+\S+)?/)
  if (vm) {
    const word = [vm[1], vm[2] || ''].map((s) => s.trim().replace(/[^\dА-Яа-яЁё]/g, '')).sort((a, b) => b.length - a.length)[0]
    if (word && !/^\d+$/.test(word) && !yo(all).toLowerCase().includes(stem(word))) red.push(`${tag}: потеряно «вместо ${vm[1]}…» («как сейчас»)`)
  }
  const dec = p.text.match(/—\s+решил:\s+([А-ЯЁ][а-яё-]+)/)
  if (dec && !yo(all).toLowerCase().includes(stem(dec[1]))) warn.push(`${tag}: нет «решил: ${dec[1]}»`)
  const wt = p.text.match(/—\s+ждёт:\s+([^;—]+)/)
  if (wt && wt[1].trim() !== '—' && !/жд[её]т/i.test(all)) warn.push(`${tag}: нет «ждёт: ${wt[1].trim()}»`)
  if (/\(на встрече:/.test(p.text) && !/на\s+встрече/i.test(all)) warn.push(`${tag}: нет пометки «(на встрече: …)»`)
  return { red, warn }
}

// Роли: «решали: <роль — имя>» в шапке входа и «решает: <кто>» в пунктах — только то, что есть в шапке списка (Шаг 4).
// Участники из строки `> Встреча:` списка: «роль — Фамилия И. О.[, Фамилия И. О.]» или «Фамилия И. О.» (ролей нет).
export function participants (name) {
  const line = listHead(name).split('\n').find((l) => /^> Встреча:/.test(l)) || ''
  const m = line.match(/участники:\s*(.*?)(?:\s·\s|$)/)
  return (m ? m[1].split(/;\s*/) : []).map((e) => {
    const parts = e.split(/\s+—\s+/)
    const role = parts.length > 1 ? parts[0] : ''
    const surnames = parts[parts.length - 1].split(/,\s*/).map(surnameOf).filter(Boolean)
    return { role, surnames }
  })
}
// Фамилия — первое слово с заглавной не короче трёх букв.
const surnameOf = (s) => (String(s).match(/[А-ЯЁ][а-яё]{2,}(-[А-ЯЁ][а-яё]+)?/) || [''])[0]
const sameStem = (a, b) => { const x = stemOf(a); const y = stemOf(b); return x.startsWith(y) || y.startsWith(x) }
const roleWords = (role) => (yo(role).toLowerCase().match(/[а-яa-z]{4,}/g) || []).map((x) => x.slice(0, 5))
const roleHas = (entryRole, role) => { const r = yo(entryRole).toLowerCase(); return roleWords(role).every((x) => r.includes(x)) }

// Документы задачи из засева (БТ, спека, запрос на правку) — одним текстом.
const docText = (name) => listFiles(seedDirOf(name), seedDirOf(name), true).filter((f) => /(business_requirements|technical_specification|change_request)\.md$/.test(f)).map((f) => read(join(seedDirOf(name), f))).join('\n')
// Роль есть в строке документа рядом с фамилией (`sn`, если дана).
const docRole = (doc, role, sn) => doc.split('\n').some((l) => { const n = yo(l).toLowerCase(); return roleWords(role).every((x) => n.includes(x)) && (!sn || hasStemIn(l, sn)) })

// Пара «роль — ФИО» (или одно ФИО, или одна роль) против участников встречи → { red } | { warn } | {}.
// Роль у человека не из шапки, но так в документе задачи («автор БТ — Ярцева» при «Автор: Ярцева О.» в БТ) — факт верен,
// предупреждение (expected NI-SPEC-BT, «Стык»). Роль без имени из документа: у встречи с участниками — ложь (его не было
// на встрече, NI-SPEC-BT ловушка 3), у ноута участников нет — предупреждение (NI-NB-REPEAT ловушка 3).
function pairError (part, ents, lt, what, doc = '') {
  const p = part.replace(/[*_]/g, '').replace(/\(.*?\)/g, ' ').trim()
  if (!p || /^[—–-]$/.test(p)) return {}
  const dash = p.split(/\s+—\s+/)
  if (dash.length >= 2) {
    const role = dash[0].trim()
    for (const nm of dash.slice(1).join(' — ').split(/,\s*/)) {
      const sn = surnameOf(nm)
      if (!sn) continue
      const e = ents.find((x) => x.surnames.some((y) => sameStem(y, sn)))
      if (e && roleHas(e.role, role)) continue
      if (docRole(doc, role, sn) && (e || hasStemIn(lt, sn))) return { warn: `роль «${role}» у ${nm.trim()} в «${what}» — из документа задачи, не из шапки списка (Шаг 4)` }
      if (!ents.length) return { red: `роль «${role}» в «${what}» — в шапке списка ролей нет` }
      if (!e) return { red: `роль «${role}» в «${what}» — «${nm.trim()}» нет среди участников в шапке списка` }
      return { red: `роль «${role}» в «${what}» — у ${nm.trim()} в шапке списка ${e.role ? `роль «${e.role}»` : 'роли нет'}` }
    }
    return {}
  }
  // ФИО без ролей, через запятую («решали: Цыганкова М., Евсеев Д.») — каждая фамилия есть в списке.
  const sns = p.split(/,\s*/).map(surnameOf).filter(Boolean)
  if (sns.length) { const miss = sns.filter((x) => !hasStemIn(lt, x)); return miss.length ? { red: `«${what} ${miss.join(', ')}» — такого человека нет в списке` } : {} }
  // Роль без ФИО («заказчик», «ИБ», «владелец БТ») — каждое её слово есть в списке.
  const words = yo(p).toLowerCase().match(/[а-яa-z]+/g) || []
  if (words.filter((x) => x.length >= 2).every((x) => (x.length < 3 ? new RegExp('(^|[^а-яa-z])' + esc(x) + '([^а-яa-z]|$)').test(gnorm(lt)) : hasStemIn(lt, x)))) return {}
  if (docRole(doc, p) && !ents.length) return { warn: `роль «${p}» в «${what}» — из документа задачи, не из списка (Шаг 4)` }
  return { red: `роль «${p}» в «${what}» — её нет в списке${docRole(doc, p) ? ' (она из документа задачи, на встрече её не было)' : ''}` }
}

// Роли (Шаг 4, ревью 2026-10-16): «решали:» в шапке входа — пары «роль — ФИО» из строки `> Встреча:` списка целиком
// (роль у того же человека, не просто где-то в шапке); «решает:» в пунктах — фамилия есть в списке, роль без ФИО —
// каждое её слово есть в списке.
export function roleChecks (text, name) {
  const red = []
  const warn = []
  const lt = listText(name)
  const ents = participants(name)
  const doc = docText(name)
  const head = text.split(/^## /m)[0]
  const rm = head.match(/решали\**\s*:\s*([^\n]+)/i)
  const take = (e) => { if (e.red) red.push(e.red); if (e.warn) warn.push(e.warn) }
  // Пары «роль — ФИО» через «;» или через запятую перед следующей парой (SKILL.md:122 «заказчик — …, автор БТ — …»).
  for (const part of rm ? rm[1].split(/;\s*|,\s*(?=[^,;—]+\s—\s)/) : []) take(pairError(part, ents, lt, 'решали:', doc))
  for (const { t } of allItems(text)) {
    const m = t.match(/реша(ет|ют)\**\s*:\s*([^;\n·]+)/i)
    if (!m) continue
    for (const part of m[2].split(/\s+и\s+/)) take(pairError(part.replace(/\.\s*$/, ''), ents, lt, 'решает:', doc))
  }
  return { red: [...new Set(red)], warn: [...new Set(warn)] }
}

// ---------- место каждого пункта ----------

export function placeChecks (text, name, turns = [], layout = new Map(), replies = analystReplies(name)) {
  const red = []
  const warn = []
  const fix = []
  const rows = []
  const its = allItems(text)
  const foundOf = (n) => its.filter((x) => PTS[name][n].k.every((re) => re.test(x.t)))
  const inInput = new Set(listPoints(name).filter((p) => foundOf(p.n).length).map((p) => p.n))
  const place = summaryPlaces(turns, name, { inInput, layout })
  const fx = FX[name]
  for (const p of listPoints(name)) {
    const spec = PTS[name][p.n]
    const tag = `P${p.n} «${p.text.slice(0, 40)}»`
    const found = foundOf(p.n)
    // Мысль или набросок во входе ноута, узнанные `thoughtPoint`, меряет `thoughtChecks`; не узнанные им строки (ключ
    // пункта их взял, классификатор — нет) — по месту, как любой пункт (ревью 2026-10-16).
    const skipThought = fx.src === 'nb' && (p.kind === 'мысль' || p.kind === 'набросок') && found.every((x) => thoughtPoint(x.t, name))
    let where
    if (found.length) {
      const secs = [...new Set(found.map((x) => x.sec))]
      where = secs.join(' + ')
      const bad = secs.filter((s) => !spec.at.includes(s))
      if (bad.length && !skipThought) red.push(`${tag} — во входе в «${bad.join('», «')}», место: ${spec.at.join(' | ')}`)
      const fixBad = secs.filter((s) => spec.fix && spec.fix.places.includes(s))
      if (fixBad.length) fix.push(`${tag} — во входе в «${fixBad.join('», «')}»; по правке ${spec.fix.edit}`)
      const lc = literalChecks(p, found, name, replies)
      red.push(...lc.red)
      warn.push(...lc.warn)
    } else {
      const c = place.get(p.n)
      where = c ? `сводка: ${c}` : 'не найден'
      if (c && spec.fix && spec.fix.places.includes(c)) fix.push(`${tag} — по сводке «${c}»; по правке ${spec.fix.edit}`)
      // Пункт и не должен быть во входе (ни одно его место — не раздел входа): метка сводки не та — предупреждение.
      if (c && !spec.at.includes(c) && !spec.at.some(isSec)) warn.push(`${tag} — не во входе (верно), но сводка называет «${c}», место: ${spec.at.join(' | ')}`)
      else if (c && !spec.at.includes(c)) red.push(`${tag} — не во входе, по сводке «${c}», место: ${spec.at.join(' | ')}`)
      else if (!c && spec.at.some(isSec) && ['решено', 'открыто', 'сведение'].includes(p.kind)) red.push(`${tag} — нет во входе, место в сводке не названо (место: ${spec.at.join(' | ')})`)
    }
    rows.push({ n: p.n, kind: p.kind, where, at: spec.at })
  }
  // Строка входа, которую не узнал ни ключ, ни основы слов пункта, — предупреждение: факты в ней меряет опора.
  const pts = listPoints(name)
  for (const x of its) if (!pointsOf(x.t, name).length && !bestPoint(x.t, pts) && !thoughtPoint(x.t, name)) warn.push(`строка входа не узнана ни как один пункт списка: «${x.t.slice(0, 60)}»`)
  const rc = roleChecks(text, name)
  red.push(...rc.red)
  warn.push(...rc.warn)
  return { red, warn, fix, rows }
}

// ---------- содержание входа ----------

// Классификатор мысли и наброска — тот же, что в grade-minb.mjs (RE_THOUGHT / RE_SKETCH не экспортируются).
export function thoughtKind (t) {
  const r = gradeInputIN('## Решено\n1. ' + t + '\n').red
  return r.includes('мысль в «Решено»') ? 'мысль' : r.includes('набросок в «Решено»') ? 'набросок' : null
}

// Сообщения исходных оценщиков, которые заменены своей проверкой или неприменимы. MR: цель — общая проверка шапки;
// «протокол разрезан» (8 у NEW, 7 у CHG) — требование к разбору meeting-intake, разбора нет. NB: цель — шапка; мысль и
// набросок — правило ниже; якоря — общая проверка ссылок; шапка формы meeting-intake 1.1.0 — своя форма intent.md.
export const DROP_MR = ['1: цель в шапке', '8: протокол разрезан', '7: протокол разрезан']
const DROP_NB_RED = [/^цель в шапке/, /^(мысль|набросок) в /, /^якорь во входе/]
const DROP_NB_WARN = [/^заголовок не «# Ноут/, /^нет строки «> Ноут:/]

// Только импортированные ожидания (для эталонов исходных проб в самопроверке).
export function importedChecks (text, name) {
  const fx = FX[name]
  const red = []
  const warn = []
  if (fx.imp === false) return { red, warn }
  if (fx.src === 'meet') {
    const mfx = MEET[name]
    const r = gradeInput(text, mfx)
    const skip = new Set([...(mfx.headerMust || []).map(([d]) => d), ...(fx.dropMust || []).map((id) => mfx.must.find((m) => m.id === id).d)])
    red.push(...r.missing.filter((d) => !skip.has(d)).map((d) => 'нет: ' + d))
    red.push(...r.violations.filter((v) => v !== 'якоря или время во входе').map((v) => 'нарушено: ' + v))
  } else if (fx.src === 'mr') {
    // Второй аргумент был разбор meeting-intake — его нет: исключения критерия 6 (NEW, 15%) и 5 (CHG, пуш), державшиеся
    // на ответе аналитика в разборе, не действуют.
    const g = (name === 'MR-NEW' ? gradeNEW : gradeCHG)(text, null)
    red.push(...g.red.filter((m) => !DROP_MR.some((d) => m.startsWith(d))))
    warn.push(...g.warn)
  } else {
    // Разбора нет и «для другого документа» больше не законно для сведений о бизнесе (layout.md после круга 2: объёмы,
    // расписания, «как сейчас» — слой БТ): `sv*` без раздела «Сведения» — красный.
    const g = (name === 'NB-ANS' ? gradeInputANS : gradeInputIN)(text, '')
    red.push(...g.red.filter((m) => !DROP_NB_RED.some((re) => re.test(m))))
    warn.push(...g.warn.filter((m) => !DROP_NB_WARN.some((re) => re.test(m))))
  }
  return { red, warn }
}

// Мысль или набросок списка в строке входа: классификатор grade-minb.mjs; иначе основы слов — строка ближе всего к
// пункту-мысли (`bestPoint`) или несёт не меньше двух его отличительных основ (которых нет у пунктов других видов).
// Пересказ без слова «трек» классификатор не узнаёт (ревью 2026-10-16).
const THOUGHT_STOP = new Set(['может', 'чтобы', 'прямо', 'тоже', 'также', 'нужно', 'будет', 'хорошо'])
const tStems = (s) => new Set((yo(s).toLowerCase().match(/[а-яa-z]{4,}/g) || []).filter((x) => !THOUGHT_STOP.has(x)).map((x) => x.slice(0, Math.min(5, Math.max(3, x.length - 2)))))
export function thoughtPoint (t, name) {
  const pts = listPoints(name)
  const th = pts.filter((p) => p.kind === 'мысль' || p.kind === 'набросок')
  if (!th.length) return null
  const k = thoughtKind(t)
  // 2.2.0: вид у обоих — `мысль`; какую из двух узнал классификатор, решает её же текст, а не вид.
  if (k) return th.find((p) => p.kind === k) || th.find((p) => thoughtKind(mainText(p.text)) === k) || null
  const bp = bestPoint(t, pts)
  if (bp) return th.includes(bp) ? bp : null
  const other = new Set(pts.filter((p) => !th.includes(p)).flatMap((p) => [...tStems(mainText(p.text))]))
  const near = (a, b) => a.startsWith(b) || b.startsWith(a)
  const mine = [...tStems(t)]
  let best = null; let bc = 0
  for (const p of th) {
    const own = [...tStems(mainText(p.text))].filter((s) => ![...other].some((o) => near(o, s)))
    const c = own.filter((s) => mine.some((x) => near(x, s))).length
    if (c > bc) { bc = c; best = p }
  }
  return bc >= 2 ? best : null
}

// Пометка взятого наброска называет аналитика: «(предложение аналитика)», «(со слов аналитика)», «(мысль аналитика)» —
// по смыслу, как RE_BY_ANALYST в grade-minb.mjs (ревью 2026-10-16).
const RE_BY_ANALYST = /со\s+слов\s+аналитика|\([^()\n]*аналитик[^()\n]*\)/i

// TL;DR 3, Шаг 5: мысли и наброски по умолчанию во вход не идут; взятые аналитиком (место пункта — «Открыто») — только в
// «Открыто» с пометкой, что это аналитик.
export function thoughtChecks (text, name) {
  const red = []
  const th = listPoints(name).filter((p) => p.kind === 'мысль' || p.kind === 'набросок')
  if (!th.length) return red
  const found = allItems(text).map((x) => ({ ...x, p: thoughtPoint(x.t, name) })).filter((x) => x.p)
  const chosen = (p) => PTS[name][p.n].at.includes(O)
  for (const x of found) {
    if (!chosen(x.p)) { red.push(`${x.p.kind} P${x.p.n} во входе — аналитик её не выбрал: «${x.t.slice(0, 60)}»`); continue }
    if (x.sec !== O) red.push(`выбранный ${x.p.kind} P${x.p.n} в «${x.sec}», а не в «Открыто»`)
    else if (!RE_BY_ANALYST.test(x.t)) red.push(`выбранный ${x.p.kind} P${x.p.n} без пометки «(предложение аналитика)»: «${x.t.slice(0, 60)}»`)
  }
  for (const p of th.filter(chosen)) if (!found.some((x) => x.p.n === p.n)) red.push(`выбранного аналитиком ${p.kind === 'мысль' ? 'мысли' : 'наброска'} P${p.n} нет во входе`)
  return red
}

// `replies` — реплики аналитика (`analystReplies`): второй законный источник фактов входа. `ctx.twin` — реплики двойника
// (`twinReplies`). `fix` — строки «по правке»: на `pass` не влияют.
export function gradeContent (text, name, turns = [], layout = new Map(), replies = analystReplies(name), ctx = {}) {
  const fx = FX[name]
  const imp = importedChecks(text, name)
  const pl = placeChecks(text, name, turns, layout, replies)
  const h = headerChecks(text, fx)
  const gr = groundChecks(text, name, replies)
  const own = ownChecks(text, name, { turns, layout, ...ctx })
  const xb = fx.kind === 'bt' ? allItems(text).filter((x) => x.sec === X) : []
  const red = [...new Set([...imp.red, ...pl.red, ...thoughtChecks(text, name), ...h.red, ...refChecks(text), ...gr.red, ...own.red,
    ...xb.map((x) => `«Расходится с БТ» во входе БТ (intent.md:60): «${x.t.slice(0, 60)}»`)])]
  const warn = [...new Set([...imp.warn, ...pl.warn, ...h.warn, ...gr.warn, ...own.warn])]
  const fix = [...new Set([...pl.fix, ...own.fix, ...changeQuestion(name, turns, layout)])]
  // Неизмеренная ветка (TWIN: вопроса «Оставляем?» по P8/P9 не было): место её пункта — предупреждение, не красный —
  // решение было на встрече, во входе оно не ложь (критерий раунда, 2026-10-16).
  const um = own.unmeasured || []
  const loose = (m) => um.some((u) => m.startsWith(`P${u.n} `) && /— во входе в/.test(m))
  return { red: red.filter((m) => !loose(m)), warn: [...warn, ...red.filter(loose).map((m) => m + ' (ветка не измерена)')], fix, unmeasured: um.map((u) => u.text), rows: pl.rows, pass: !red.some((m) => !loose(m)) }
}

// Баг 9, по правке E2 (`SKILL.md:136`: «`[решено]` с `противоречит: <где>` в раскладке» → «Меняем?»): у каждого `[решено]` с
// меткой «противоречит» в раскладке прогона (`layoutOf`) — абзац ответа с «Меняем» об этом пункте (ключ, `P<n>` или основы
// слов). Раскладки в потоке нет — не меряется.
export function changeQuestion (name, turns = [], layout = new Map()) {
  const out = []
  if (!layout || !layout.size) return out
  const pts = listPoints(name)
  const paras = turns.flatMap((t) => t.split(/\n\s*\n/)).filter((p) => /Меняем/.test(p))
  for (const p of pts) {
    const l = layout.get(p.n)
    // E2 как внесена (`SKILL.md:136`): слой цели, во входе спеки — ещё слой «БТ»; слой — после вердикта проверки.
    const layers = FX[name].kind === 'spec' ? ['спека', 'БТ'] : ['БТ']
    if (p.kind !== 'решено' || !l || !/^противоречит/i.test(l.doc) || !layers.includes(l.layer)) continue
    const asked = paras.some((para) => new RegExp('(^|[^A-Za-z])P' + p.n + '([^0-9]|$)').test(para) || PTS[name][p.n].k.every((re) => re.test(para)) || para.split('\n').some((ln) => (bestPoint(ln, pts) || {}).n === p.n))
    if (!asked) out.push(`P${p.n} «${p.text.slice(0, 40)}» — в раскладке «${l.doc}», вопроса «Меняем?» нет; по правке E2 (баг 9)`)
  }
  return out
}

// Свои ожидания новых проб (fixtures/NI-SPEC-BT|NB-REPEAT|TWIN/expected.md): ловушки на ложь — красный, ожидания по правке
// — `fix`, стыки — предупреждение.
export function ownChecks (text, name, ctx = {}) {
  const red = []
  const warn = []
  const fix = []
  const unmeasured = []
  const fx = FX[name]
  const its = allItems(text)
  const find = (re, secs) => its.find((x) => re.test(x.t) && (!secs || secs.includes(x.sec)))
  const cut = (x) => `«${x.t.slice(0, 60)}»`
  if (fx.fixGoal) fix.push(fx.fixGoal)
  const base = fixtureOf(name)
  if (base === 'SPEC-BT') {
    let x = find(/раз\s+в\s+час(?![а-яё])/i)
    if (x) red.push(`«раз в час» — слово спеки, не пункта (ловушка 2): ${cut(x)}`)
    x = find(/таймер/i)
    if (x) red.push(`мысль P6 (свой таймер) во входе (ловушка 1): ${cut(x)}`)
    // Название раздела БТ в кавычках («3.2 «Не входит»») — ссылка, не сторона пункта.
    x = its.find((y) => PTS[name][8].k.every((re) => re.test(y.t)) && /не\s+входит|нельзя|не\s+(можно|заказыва|принима)/i.test(y.t.replace(/«[^»]*»/g, ' ')))
    if (x) red.push(`P8 стороной документа — «не из наличия не заказываем» вместо решения встречи (ловушка 4): ${cut(x)}`)
  }
  if (base === 'NB-REPEAT') {
    const x = find(/сразу\s+после\s+оплат/i)
    if (x) red.push(`мысль P14 (баланс сразу после оплаты) во входе (ловушка 1): ${cut(x)}`)
  }
  if (base === 'TWIN') {
    const goal = ((text.split(/^## /m)[0].match(/цель\**\s*:\s*\**\s*([^\n·;|]+)/i) || [])[1] || '').replace(/\*/g, '').trim()
    const tw = ctx.twin
    // Ветка исправления измерена, только если двойник ответил на её вопрос (критерий раунда, 2026-10-16): нет ответа —
    // предупреждение и строка «не измерено», не красный; прогон в счёт этой ветки не идёт.
    const all = (tw || []).join('\n')
    if (!tw) warn.push('реплик двойника нет (`_twin/reply-*.txt`) — ветки исправления не проверены')
    if (!/не\s+вносим/i.test(all)) { unmeasured.push({ n: 8, text: 'ветка «Не вносим» (P8) не измерена' }); if (tw) warn.push('вопроса «Оставляем?» по P8 не было: решил не заказчик (SKILL.md:137)') }
    if (!/в\s+открытые\s+вопросы/i.test(all)) { unmeasured.push({ n: 9, text: 'ветка «В открытые вопросы» (P9) не измерена' }); if (tw) warn.push('вопроса «Оставляем?» по P9 не было: решила не заказчик (SKILL.md:137)') }
    if (tw) {
      const gm = all.match(/правк[аи]\s+БТ|правка\s+работающ\S*/i)
      if (gm && !(/работающ/i.test(gm[0]) ? /^правк\S*\s+работающ/i : /^правки\s+БТ/i).test(goal)) red.push(`цель в шапке «${goal}», аналитик выбрал «${gm[0]}» (Шаг 4)`)
      if (!gm) warn.push('в репликах двойника нет выбора цели')
      if (/поправить/i.test(all)) {
        const cor = its.filter((y) => /отмен/i.test(y.t) && /деньг|списыв/i.test(y.t))
        if (!cor.length) red.push('поправка аналитика на сводке («за отменённый привоз деньги с карты не списываем») — не во входе')
        for (const y of cor) {
          if (!RE_BY_ANALYST.test(y.t)) red.push(`поправка аналитика без «(со слов аналитика)» (intent.md:68, ловушка 3): ${cut(y)}`)
          if (!PTS[name][10].k.every((re) => re.test(y.t)) && /решил/i.test(y.t)) red.push(`поправка аналитика отдельной строкой с «решил:» участника (ловушка 3): ${cut(y)}`)
        }
      }
    }
    // Правка работающего — «как сейчас → как должно стать» у P7 и P10 (intent.md:71–73); форма, не ложь.
    if (/работающ/i.test(goal)) for (const n of [7, 10]) for (const y of its.filter((z) => PTS[name][n].k.every((re) => re.test(z.t)))) if (!/как\s+сейчас|→/i.test(y.t)) warn.push(`P${n} без «как сейчас → как должно стать» (intent.md:71): ${cut(y)}`)
    // «В открытые вопросы» — «с тем, кого ждём» (SKILL.md:142): «ждёт: —» или без «ждёт:» — стык, предупреждение.
    for (const y of its.filter((z) => z.sec === O && PTS[name][9].k.every((re) => re.test(z.t)))) if (!/жд[её]т\s*:\s*[А-ЯЁа-яё]/i.test(y.t)) warn.push(`P9 в «Открыто» без «ждёт: <кто>» (SKILL.md:142): ${cut(y)}`)
  }
  return { red, warn, fix, unmeasured }
}

// Опора КАЖДОЙ строки входа (TL;DR 2, Шаг 7; ревью 2026-10-16): не только узнанные пункты — шапка, все разделы,
// строки вне пунктов. Источник — текст списка и реплики аналитика. Заголовок и строка `> Встреча:` / `> Ноут:` — без
// чисел (дата и время встречи в любой записи), «решали:» — отдельно (`roleChecks`). `> Документ:` — путь из засева.
// `> Список:` и `> Источник:` — пути, их меряет `headerChecks`. Слова-заполнители в `ждёт:` («не назван», «ответа») —
// не люди.
// Глаголы при человеке, местоимения и служебные слова — сверх стоп-слов ground-check.mjs (там уже «что», «это», «уточняет»…).
const GROUND_SKIP = ['назван', 'названо', 'названа', 'названы', 'известно', 'указан', 'указано', 'определен', 'определено', 'ответа', 'решения', 'подтверждения', 'уточнения',
  'уточняют', 'пишет', 'напишет', 'спросит', 'спрашивает', 'подтвердит', 'подтверждает', 'него', 'нее', 'них', 'ему',
  'чтобы', 'каким', 'сколько', 'когда', 'где', 'как', 'если', 'будет', 'будут', 'есть', 'был', 'была', 'было', 'были',
  'еще', 'уже', 'также', 'только', 'тут', 'так', 'потом', 'ней', 'ним', 'оно', 'нам', 'нас', 'вам', 'вас']
export function groundChecks (text, name, replies = []) {
  const red = []
  const warn = []
  const src = [listText(name), ...replies]
  const srcAll = src.join('\n')
  const seedFiles = listFiles(seedDirOf(name), seedDirOf(name), true)
  const doc = docText(name)
  let sec = ''
  for (const raw of text.split('\n')) {
    const l = raw.trim()
    const hm = l.match(/^#{2,}\s+(.+?)\s*$/)
    if (hm) { sec = normSec(hm[1]); continue }
    if (!l) continue
    if (/^>\s*\**\s*(Список|Источник)\**\s*:/i.test(l)) continue
    if (/^>\s*\**\s*решали\**\s*:/i.test(l)) continue
    if (/^>\s*\**\s*Документ\**\s*:/i.test(l)) {
      for (const tok of l.match(/[\w./\\:-]*[\w-]+\.(md|docx?|pdf|txt)/gi) || []) {
        const t = tok.split('\\').join('/')
        if (!seedFiles.some((sf) => t.endsWith(sf) || sf.endsWith(t))) red.push(`«> Документ:» — файла «${tok}» в засеве нет`)
      }
      continue
    }
    let line = l.replace(/^(-|\*|\d+[.)])\s+/, '')
    // «Расходится с БТ»: номер раздела документа («FR-3», «3.2») — ссылка, не факт пункта (expected NI-SPEC-BT, «Стык»):
    // предупреждение, если он есть в документе задачи.
    if (sec === X) {
      const refs = (line.match(/FR-\d+|§\s*\d+(?:\.\d+)*|(?<![\d.])\d+\.\d+(?![\d.])/g) || []).filter((r) => doc.includes(r.replace(/^§\s*/, '')) && !srcAll.includes(r))
      if (refs.length) { warn.push(`ссылка на раздел документа в «Расходится с БТ»: ${refs.join(', ')} — «${line.slice(0, 60)}»`); for (const r of refs) line = line.split(r).join(' ') }
    }
    const opts = { skip: GROUND_SKIP }
    if (/^>\s*\**\s*(Встреча|Ноут)\**\s*:/i.test(l)) { line = l.split(/\s·\s*\**\s*решали\**\s*:/i)[0].replace(/\d/g, ' '); opts.header = true }
    if (/^#\s/.test(l)) line = l.replace(/\d/g, ' ')
    const r = groundCheck(line, src, opts)
    // ФИО после «решил» / «ждёт» без двоеточия («решила Орлова Е.»): модуль такие поля не берёт (там это глагол).
    if (!opts.header) for (const f of fioOf(line)) if (!hasStemIn(srcAll, f.who) && !r.missing.some((m) => m.tok === f.who)) r.missing.push({ kind: 'человек', tok: f.who })
    if (r.missing.length) red.push(`нет опоры в списке и репликах аналитика: ${fmtMissing(r)} — «${line.slice(0, 70)}»`)
  }
  return { red, warn }
}

function headerChecks (text, fx) {
  const red = []
  const warn = []
  const head = text.split(/^## /m)[0]
  const lines = head.split('\n')
  const keyLine = lines.find((l) => /^>\s*\**\s*Задача\**\s*:/i.test(l))
  if (!keyLine) red.push('в шапке нет строки «> Задача: …»')
  else if (!new RegExp('(^|[^A-Za-z0-9-])' + esc(fx.key) + '([^A-Za-z0-9-]|$)').test(keyLine)) red.push(`в строке «> Задача:» нет ключа ${fx.key}`)
  const gm = head.match(/цель\**\s*:\s*\**\s*([^\n·;|]+)/i)
  if (!gm) red.push(`в шапке нет цели (ждём «${fx.goalName}»)`)
  else if (!fx.goal.test(gm[1].replace(/\*/g, '').trim())) red.push(`цель в шапке «${gm[1].replace(/\*/g, '').trim()}», ждём «${fx.goalName}»`)
  else if (keyLine && !/цель\**\s*:/i.test(keyLine)) warn.push('цель не в строке «> Задача:» (intent.md: «> Задача: … · цель: …»)')
  if (!/^# (Встреча|Ноут)/m.test(head)) warn.push('заголовок не по intent.md: «# <Встреча <дата> | Ноут <тема>>[: <предмет>]»')
  if (!lines.some((l) => /^>\s*\**\s*Список\**\s*:/i.test(l) && l.includes(fx.list))) warn.push(`нет строки «> Список: ${fx.list}»`)
  return { red, warn }
}

// Ссылки на источник во входе (TL;DR 2, intent.md): `L<n>` и `№<n>` — во всём файле, кроме строк с путями
// («> Список:», «> Источник:»); время с секундами — только в пунктах (в шапке законно, как в grade-meet.mjs).
function refChecks (text) {
  const red = []
  const body = text.split('\n').filter((l) => !/^>\s*\**\s*(Список|Источник)\**\s*:/i.test(l))
  const lRef = body.find((l) => /(^|[^A-Za-z])L\d+([^0-9]|$)/.test(l))
  if (lRef) red.push(`ссылка L<n> во входе: «${lRef.trim().slice(0, 60)}»`)
  const nRef = body.find((l) => /№\s*\d/.test(l))
  if (nRef) red.push(`ссылка «<дата> №<n>» во входе: «${nRef.trim().slice(0, 60)}»`)
  const tRef = allItems(text).find(({ t }) => /\d\d:\d\d:\d\d/.test(t))
  if (tRef) red.push(`время с секундами в пункте: «${tRef.t.slice(0, 60)}»`)
  return red
}

// ---------- песочница ----------

function listFiles (dir, base = dir, dot = false) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!dot && e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...listFiles(p, base, dot))
    else out.push(relative(base, p).split('\\').join('/'))
  }
  return out
}

const isStand = (f) => (!f.includes('/') && /^(answer(-\d+)?\.md|stream(-\d+)?\.jsonl|_[^/]*)$/.test(f)) || f.startsWith('_twin/')
const RE_FORBIDDEN_READ = /(^|[\s/\\"'=])(services|context)[/\\]/
const RE_EXCLUDE_ARG = /(-not|!)\s+-(i?path|name)\s+(["'])[^"']*\3/g

function toolUses (dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((n) => /^stream(-\d+)?\.jsonl$/.test(n)).sort()) {
    for (const line of read(join(dir, f)).split('\n')) {
      let e; try { e = JSON.parse(line) } catch { continue }
      const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : []
      // События субагентов идут в потоке ведущего с `parent_tool_use_id`.
      for (const c of content) if (c && c.type === 'tool_use') out.push({ name: c.name, input: c.input || {}, sub: !!e.parent_tool_use_id })
    }
  }
  return out
}

// Ответы ходов по порядку: `answer-NN.md`; ходов нет — `answer.md`.
function dialogTurns (dir) {
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).sort() : []
  if (names.length) return names.map((f) => read(join(dir, f)))
  return existsSync(join(dir, 'answer.md')) ? [read(join(dir, 'answer.md'))] : []
}

const listBase = (fx) => basename(fx.list).replace(/\.points\.md$/, '')
// Вход с этим именем уже лежит в засеве — `-2` перед расширением, по правке E5: `<основа>-bt-2.md` (intent.md:6 в 1.0.0
// место `-2` не задаёт: `<основа>-2-bt.md` законен, строка «по правке»).
export const inputRel = (fx) => {
  const b = `${fx.folder}/${listBase(fx)}-${fx.kind}`
  return existsSync(join(seedDirOf(fx.name), b + '.md')) ? `${b}-2.md` : `${b}.md`
}
const e5alt = (rel) => (/-(bt|spec)-2\.md$/.test(rel) ? rel.replace(/-(bt|spec)-2\.md$/, '-2-$1.md') : null)

// Прогон не в счёт («НЕ ИЗМЕРЕНО») — только отказ API: пометка пула или ответ, который начинается с сообщения об отказе.
// Прогон без ответа и без входа — в счёт и красный «файл не записан» (ревью 2026-10-16: молча кончившийся прогон
// выпадал из знаменателя).
export function measured (dir) {
  const ans = existsSync(join(dir, 'answer.md')) ? readFileSync(join(dir, 'answer.md'), 'utf8') : ''
  return !(existsSync(join(dir, '_api-failure.txt')) || existsSync(join(dir, '_api-failure-turn.txt')) || RE_API_FAILURE.test(ans.slice(0, 300)))
}

// Засев не тронут. Раннер пишет хеши засева в `_seeded.sha256` (формат sha256sum: `<sha256>  <путь>` или `<sha256> *<путь>`,
// хеш — от байтов файла, как он лёг в песочницу) — сверка с ними, а не с текущей фикстурой: фикстура могла измениться
// после прогона. Хешей нет — LF-текст файла песочницы против LF-текста фикстуры. `_seeded.txt` — список путей, как раньше.
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
export function seededHashes (dir) {
  const p = join(dir, '_seeded.sha256')
  if (!existsSync(p)) return null
  const out = new Map()
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\\?([0-9a-f]{64}) [ *](.+)$/)
    if (m) out.set(m[2].replace(/^\.\//, ''), m[1])
  }
  return out
}
export function seedTouched (dir, name) {
  const seedDir = seedDirOf(name)
  const hashes = seededHashes(dir)
  if (hashes) return [...hashes].filter(([rel, h]) => !existsSync(join(dir, rel)) || sha256(join(dir, rel)) !== h).map(([rel]) => rel)
  return listFiles(seedDir, seedDir, true).filter((rel) => !existsSync(join(dir, rel)) || read(join(dir, rel)) !== read(join(seedDir, rel)))
}

export function gradeRun (dir, name) {
  const fx = FX[name]
  const red = []
  const warn = []
  const seedDir = seedDirOf(name)
  const seedFiles = listFiles(seedDir, seedDir, true)
  const seeded = new Set(seedFiles)
  if (existsSync(join(dir, '_seeded.txt'))) for (const l of read(join(dir, '_seeded.txt')).split('\n')) if (l.trim()) seeded.add(l.trim())
  for (const rel of (seededHashes(dir) || new Map()).keys()) seeded.add(rel)
  const touched = seedTouched(dir, name)
  if (touched.length) red.push('засев тронут (документ задачи или список): ' + touched.join(', '))
  const fix = []
  const unmeasured = []
  const files = listFiles(dir)
  const want = inputRel(fx)
  const RE_IN = new RegExp('(^|/)' + esc(listBase(fx)) + '(-\\d+)?[.-]?(points-)?(bt|spec)(-\\d+)?\\.md$')
  const inputs = files.filter((f) => RE_IN.test(f) && !seeded.has(f))
  // Законные имена входа: по правке, `-2` в другом месте (E5) и, у NB-REPEAT, второй вход БТ (законен по 1.0.0, баг 4).
  const altName = fx.alt
  const cands = [[want, name], [e5alt(want), name, 'E5'], ...(altName ? [[inputRel(FX[altName]), altName], [e5alt(inputRel(FX[altName])), altName, 'E5']] : [])].filter(([p]) => p)
  const pick = cands.find(([p]) => inputs.includes(p))
  if (!inputs.length) red.push(`файл не записан: нет входа ${want}`)
  else if (!pick) red.push(`нет входа ${want}`)
  const stray = inputs.filter((f) => !pick || f !== pick[0])
  if (stray.length) red.push('вход не там или не той цели: ' + stray.join(', '))
  const extra = files.filter((f) => !seeded.has(f) && !isStand(f) && !inputs.includes(f))
  if (extra.length) red.push('лишние файлы: ' + extra.join(', '))
  let rows = []
  if (pick) {
    const [rel, gname, e5] = pick
    if (e5) fix.push(`имя ${basename(rel)} — по правке E5 (баг 5) «-2» перед расширением: ${basename(inputRel(FX[gname]))}`)
    const c = gradeContent(read(join(dir, rel)), gname, dialogTurns(dir), layoutOf(dir), analystReplies(gname, dir), { twin: twinReplies(dir) })
    red.push(...c.red)
    warn.push(...c.warn)
    fix.push(...c.fix)
    unmeasured.push(...(c.unmeasured || []))
    rows = c.rows
  }
  const uses = toolUses(dir)
  const forbidden = uses.filter((u) => ['Read', 'Grep', 'Glob', 'Bash'].includes(u.name) && RE_FORBIDDEN_READ.test(Object.values(u.input).filter((v) => typeof v === 'string').join(' ').replace(RE_EXCLUDE_ARG, '')))
  if (forbidden.length) red.push('читал services/ или context/: ' + forbidden.map((u) => `${u.sub ? 'субагент' : 'ведущий'} ${u.name} ${JSON.stringify(u.input).slice(0, 80)}`).join('; '))
  const turns = existsSync(dir) ? readdirSync(dir).filter((f) => /^answer-\d+\.md$/.test(f)).length || 1 : 0
  const agents = uses.filter((u) => !u.sub && (u.name === 'Agent' || u.name === 'Task')).length
  return { red, warn, fix, unmeasured, rows, pass: !red.length, hasInput: !!pick, turns, agents }
}

// ---------- самопроверка ----------

// Список → вход по основному месту каждого пункта (`PTS`, первое место): вид → раздел intent.md, ссылка ` · …` снята,
// «решил / ждёт / со слов» и пометки — как в пункте. Пункт с основным местом вне входа не идёт; набросок с местом
// «Открыто» — с «(предложение аналитика)». Это и есть «вход по правилам скилла»: он обязан пройти все проверки.
export function fromList (name) {
  const fx = FX[name]
  const secs = { [R]: [], [O]: [], [N]: [], [S]: [], [X]: [] }
  for (const p of listPoints(name)) {
    const at = PTS[name][p.n].at[0]
    if (!isSec(at)) continue
    let t = p.text
    if (p.kind === 'мысль' || p.kind === 'набросок') { secs[O].push(`${t} (предложение аналитика) — ждёт: —`); continue }
    let sec = p.kind === 'открыто' ? O : p.kind === 'сведение' ? S : R
    if (p.kind === 'решено' && /^не входит:\s*/i.test(t)) { sec = N; t = t.replace(/^не входит:\s*/i, '') }
    // Основное место — раздел, отличный от вида («Расходится с БТ»; решение, которое аналитик отправил «В открытые
    // вопросы», — «Открыто»), — пункт идёт туда.
    secs[at === X || (at === O && sec === R) ? at : sec].push(t)
  }
  const head = listHead(name).split('\n')
  const subject = read(join(seedDirOf(name), fx.list)).split('\n')[0].replace(/^# Пункты:\s*/, '')
  const meet = head.find((l) => /^> (Встреча|Ноут):/.test(l))
  const date = (meet.match(/\d{4}-\d\d-\d\d/) || [''])[0]
  const title = fx.src === 'nb' ? `# Ноут ${meet.replace(/^> Ноут:\s*/, '').split(' · ')[0]}` : `# Встреча ${date}: ${subject}`
  let out = `${title}\n\n> Задача: ${fx.key} · цель: ${fx.goalName.split(' или ')[0]}\n> Документ: —\n${meet}\n> Список: ${fx.list}\n`
  for (const [sec, its] of Object.entries(secs)) if (its.length) out += `\n## ${sec}\n` + its.map((t, i) => (sec === R ? `${i + 1}. ${t}` : `- ${t}`)).join('\n') + '\n'
  return out
}

// Сводка Шага 6 к `fromList`: пункты с основным местом вне входа — по номерам в своих строках.
export function summaryOf (name) {
  const by = {}
  for (const p of listPoints(name)) { const at = PTS[name][p.n].at[0]; if (!isSec(at)) (by[at] ||= []).push('P' + p.n) }
  const label = { [OTHER]: FX[name].kind === 'bt' ? 'для спеки' : 'для БТ', [DONE]: 'уже записано', [OUT]: 'вне документов и «не вносим»', [THOUGHT]: 'мысли и наброски не взяты' }
  return 'Не идёт во вход: ' + (Object.entries(by).map(([c, ps]) => `${label[c]} — ${ps.length} (${ps.join(', ')})`).join(', ') || '0') + '.'
}

const addItem = (text, sec, line) => (new RegExp('^## ' + esc(sec) + '\\s*$', 'm').test(text)
  ? text.replace(new RegExp('^(## ' + esc(sec) + '\\s*\\n)', 'm'), `$1- ${line}\n`)
  : text.replace(/\n*$/, `\n\n## ${sec}\n- ${line}\n`))
const setGoal = (text, goal) => text.replace(/(цель\**\s*:\s*\**\s*)[^\n·;|*]+/i, `$1${goal}`)
const dropLine = (text, re) => text.split('\n').filter((l) => !re.test(l)).join('\n')
// Строка входа, в которой лежит пункт `n` (по ключу из PTS).
const lineOf = (text, name, n) => text.split('\n').find((l) => /^(\d+\.|-)\s/.test(l) && PTS[name][n].k.every((re) => re.test(l)))

// Прогоны кругов 2–4 (`runs/2026-10-15-loop-r{2,3,4}-ni-*`) удалены — самопроверка на них не опирается: случаи аудита
// и разбора сводки — синтетикой, строки ответов дословно (ниже по фикстурам и в «общих»).

function selftest () {
  let bad = 0
  const ck = (n, got, want, info) => {
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}: ${got} (ожидалось ${want})`)
    if (!ok && info) console.log('         ', String(info).slice(0, 600))
  }
  // По умолчанию — со сводкой правильного прогона: без неё пропуск пункта «уже записано» законно красный.
  let SUM = []
  // Двойник по карточке (TWIN): ответы на все ветки — иначе ветки не измерены и место P8/P9 не красит.
  const TWIN_FULL = ['Правки БТ.', '1. Не вносим. 2. В открытые вопросы.']
  const G = (text, name, turns = SUM) => gradeContent(text, name, turns, new Map(), analystReplies(name), FX[name].twin ? { twin: TWIN_FULL } : {})
  const G2 = (text, name) => gradeContent(text, name, [summaryOf(name)])
  for (const [name, fx] of Object.entries(FX)) {
    if (fx.hidden) continue
    SUM = [summaryOf(name)]
    console.log(`\n${name}`)
    const pts = listPoints(name)
    ck('карта мест покрывает каждый пункт списка', pts.filter((p) => !PTS[name][p.n]).map((p) => 'P' + p.n).join(','), '')
    const own = pts.filter((p) => pts.filter((q) => PTS[name][q.n].k.every((re) => re.test(p.text))).length !== 1 || !PTS[name][p.n].k.every((re) => re.test(p.text)))
    ck('ключ каждого пункта узнаёт ровно его в списке', own.map((p) => 'P' + p.n).join(','), '')
    if (fx.etalon) {
      const et = read(join(HERE, fx.etalon))
      const g0 = importedChecks(et, name)
      ck('эталон исходной пробы — импортированные ожидания зелёные', !g0.red.length, true, g0.red.join(' | '))
    }
    const ok = fromList(name)
    const g1 = G(ok, name)
    ck('вход по правилам скилла (основное место каждого пункта) со сводкой — зелёный', g1.pass, true, g1.red.join(' | '))
    const outMust = pts.filter((p) => !isSec(PTS[name][p.n].at[0]) && PTS[name][p.n].at.some(isSec) && ['решено', 'открыто', 'сведение'].includes(p.kind))
    if (outMust.length) ck(`тот же вход без сводки — красный: место ${outMust.map((p) => 'P' + p.n).join(', ')} не установить`, outMust.every((p) => G(ok, name, []).red.some((m) => m.startsWith(`P${p.n} `))), true)
    // Испорченные варианты.
    ck('ссылка L57 в пункте — красный', G(addItem(ok, O, 'Кто утверждает — ждёт: — · L57'), name).pass, false)
    ck('ссылка «2026-10-14 №2» в пункте — красный', G(addItem(ok, S, 'Пропуск на неделю · 2026-10-14 №2'), name).pass, false)
    ck('время с секундами в пункте — красный', G(addItem(ok, S, 'Начали в 11:02:41'), name).pass, false)
    ck(`неверная цель «${fx.wrongGoal}» — красный`, G(setGoal(ok, fx.wrongGoal), name).pass, false)
    ck('нет ключа в «> Задача:» — красный', G(ok.replace(new RegExp(esc(fx.key), 'g'), 'XXX-1'), name).pass, false)
    if (fx.thought) ck('мысль из списка во входе — красный', G(addItem(ok, O, `${fx.thought} (предложение аналитика) — ждёт: —`), name).pass, false)
    // Место пункта: первый пункт с местом во входе пропал; пропал, а сводка назвала его не там; переехал в чужой раздел.
    const p1 = pts.find((p) => isSec(PTS[name][p.n].at[0]) && !PTS[name][p.n].at.some((a) => !isSec(a)) && lineOf(ok, name, p.n))
    const l1 = lineOf(ok, name, p1.n)
    const gone = ok.replace(l1 + '\n', '')
    ck(`P${p1.n} пропал, в сводке не назван — красный`, G(gone, name).red.some((m) => m.startsWith(`P${p1.n} `) && /не названо/.test(m)), true)
    ck(`P${p1.n} пропал, сводка «вне документов» — красный`, G(gone, name, [`Не идёт во вход: вне документов и «не вносим» — 1 (P${p1.n}).`]).red.some((m) => m.startsWith(`P${p1.n} `)), true)
    const wrongSec = PTS[name][p1.n].at.includes(S) ? N : S
    ck(`P${p1.n} в «${wrongSec}» — красный`, G(addItem(gone, wrongSec, l1.replace(/^(\d+\.|-)\s+/, '')), name).red.some((m) => m.startsWith(`P${p1.n} `)), true)
    const pOut = pts.find((p) => !isSec(PTS[name][p.n].at[0]) && !PTS[name][p.n].at.some(isSec) && p.kind !== 'мысль' && p.kind !== 'набросок')
    if (pOut) ck(`P${pOut.n} (место: ${PTS[name][pOut.n].at.join(' | ')}) во входе — красный`, G(addItem(ok, pOut.kind === 'открыто' ? O : pOut.kind === 'сведение' ? S : R, pOut.text), name).red.some((m) => m.startsWith(`P${pOut.n} `)), true)
    const sv = pts.find((p) => p.kind === 'сведение' && /со\s+слов/.test(p.text) && lineOf(ok, name, p.n) && PTS[name][p.n].at[0] === S)
    if (sv) {
      const l = lineOf(ok, name, sv.n)
      ck(`P${sv.n}: «со слов» потеряно — красный`, G(ok.replace(l, l.replace(/\s+—\s+со\s+слов.*$/, '')), name).red.some((m) => /со слов/.test(m)), true)
    }
    const nm = pts.find((p) => /\d/.test(mainText(p.text)) && lineOf(ok, name, p.n) && !/FR-\d/.test(p.text))
    if (nm) {
      const l = lineOf(ok, name, nm.n)
      const d = mainText(nm.text).match(/\d+/)[0]
      const l2 = l.replace(new RegExp('(^|[^\\d])' + d + '(?![\\d])', 'g'), '$1N')
      if (PTS[name][nm.n].k.every((re) => re.test(l2))) ck(`P${nm.n}: число ${d} потеряно — красный`, G(ok.replace(l, l2), name).red.some((m) => /потеряно число/.test(m)), true)
    }
    ck('роль, которой нет в шапке списка, в «решали:» — красный', G(ok.replace(/^(> Список:)/m, '> решали: директор по продукту — Петров И.\n$1').replace(/\n> решали:/, ' · решали:'), name).red.some((m) => /роль/.test(m)), true)

    const sb = mkdtempSync(join(tmpdir(), 'grade-ni-'))
    try {
      const seedDir = seedDirOf(name)
      const seedFiles = listFiles(seedDir, seedDir, true)
      for (const rel of seedFiles) { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), readFileSync(join(seedDir, rel))) }
      writeFileSync(join(sb, '_seeded.txt'), seedFiles.join('\n') + '\n')
      writeFileSync(join(sb, 'answer.md'), summaryOf(name))
      const want = inputRel(fx)
      mkdirSync(join(sb, fx.folder), { recursive: true })
      writeFileSync(join(sb, want), ok)
      const g = () => gradeRun(sb, name)
      const r0 = g()
      ck('песочница со входом по правилам — зелёная', r0.pass, true, r0.red.join(' | '))
      const docRel = seedFiles.find((f) => /(business_requirements|technical_specification)\.md$/.test(f))
      if (docRel) {
        const t = read(join(sb, docRel))
        writeFileSync(join(sb, docRel), t + '\nправка\n')
        ck('документ задачи тронут — красный', g().pass, false)
        writeFileSync(join(sb, docRel), t)
      }
      const lt = read(join(sb, fx.list))
      writeFileSync(join(sb, fx.list), lt.replace('- [', '- [x] ['))
      ck('список тронут — красный', g().pass, false)
      writeFileSync(join(sb, fx.list), lt)
      writeFileSync(join(sb, fx.folder, 'notes.md'), 'x')
      ck('лишний файл — красный', g().red.some((m) => m.startsWith('лишние файлы')), true)
      rmSync(join(sb, fx.folder, 'notes.md'))
      const otherKind = fx.kind === 'bt' ? 'spec' : 'bt'
      const wrong = want.replace(new RegExp('-' + fx.kind + '\\.md$'), `-${otherKind}.md`)
      // У NB-REPEAT вход другой цели (второй вход БТ) законен по 1.0.0 — его меряют проверки новых проб ниже.
      if (!fx.alt && !existsSync(join(seedDir, wrong))) {
        rmSync(join(sb, want)); writeFileSync(join(sb, wrong), ok)
        ck(`вход -${otherKind} вместо -${fx.kind} — красный`, g().pass, false)
        rmSync(join(sb, wrong))
      }
      writeFileSync(join(sb, want.replace(/-(bt|spec)\.md$/, '.points-$1.md')), ok)
      ck('вход «<основа>.points-bt.md» (круг 2, ni-vac run-2) — красный и назван', g().red.some((m) => /вход не там/.test(m)), true)
      rmSync(join(sb, want.replace(/-(bt|spec)\.md$/, '.points-$1.md')))
      mkdirSync(join(sb, 'coddoc/_inbox'), { recursive: true })
      writeFileSync(join(sb, 'coddoc/_inbox', basename(want)), ok)
      ck('вход в coddoc/_inbox при известном ключе — красный', g().pass, false)
      rmSync(join(sb, 'coddoc/_inbox'), { recursive: true, force: true })
      writeFileSync(join(sb, want), ok)
      const ev = (input, sub) => JSON.stringify({ type: 'assistant', parent_tool_use_id: sub ? 'toolu_1' : null, message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input }] } })
      writeFileSync(join(sb, 'stream-02.jsonl'), ev({ file_path: 'C:\\sb\\services\\idm.md' }, true) + '\n')
      ck('субагент читал services/ — красный', g().pass, false)
      rmSync(join(sb, 'stream-02.jsonl'))
      writeFileSync(join(sb, 'answer.md'), 'API Error: 529 overloaded')
      ck('отказ API в ответе — НЕ ИЗМЕРЕНО', measured(sb), false)
    } finally { rmSync(sb, { recursive: true, force: true }) }

    // Случаи аудита круга 2 — синтетически, по одному на фикстуру, где они были.
    if (name === 'NB-IN') {
      const t = [6, 9, 10].reduce((s, n) => s.replace(lineOf(s, name, n) + '\n', ''), ok)
      const turns = ['**Не идёт во вход:** для спеки — 0, уже записано — 0, вне документов и «не вносим» — 3 (сейчас пункты посылки не принимают, ~180 заказов в день и пик до 400, машина забирает раз в день после 19:00), мысли и наброски не взяты — 2 (трек-номер на чеке, экран оператора).']
      const r = G(t, name, turns).red
      ck('три сведения о бизнесе «вне документов» (nb-in run-1) — красный по каждому', [6, 9, 10].every((n) => r.some((m) => m.startsWith(`P${n} `) && /вне документов/.test(m))), true, r.join(' | '))
      const r2 = G(ok.replace(lineOf(ok, name, 9) + '\n', ''), name, ['Для спеки — 1 пункт (около 180 заказов в день, пик до 400).']).red
      ck('«180 заказов» «для спеки» (nb-in run-2, run-3) — красный: объёмы — слой БТ', r2.some((m) => /^P9 .*другой слой/.test(m)), true, r2.join(' | '))
      ck('мысль и набросок «не взяты» по сводке, не во входе — зелёный', G(ok, name, ['мысли и наброски не взяты — 2 (трек-номер на чеке, экран оператора)']).pass, true)
    }
    if (name === 'CR') {
      const t = ok.replace(lineOf(ok, name, 6) + '\n', '')
      const r = G(t, name, ['- Для спеки — 1 (производственный календарь).\n- Вне документов — 1 (сейчас закрытие через три календарных дня).']).red
      ck('«как сейчас — три календарных» «вне документов» (cr run-1) — красный', r.some((m) => m.startsWith('P6 ') && /вне документов/.test(m)), true, r.join(' | '))
      const pair = ok.replace(lineOf(ok, name, 6) + '\n', '').replace(lineOf(ok, name, 7), '1. Как сейчас: обращение закрывается автоматически через три календарных дня, если пользователь молчит → как должно стать: через семь рабочих дней вместо трёх календарных — решил: Захарова О.')
      ck('«как сейчас» парой в «Решено» — зелёный', G(pair, name).pass, true, G(pair, name).red.join(' | '))
    }
    if (name === 'ACC') {
      const t = ok.replace(lineOf(ok, name, 23) + '\n', '')
      const r = G(t, name, ['- для БТ — 1 (подписка на увольнение не входит)\n- уже записано — 1 (сменился владелец системы — FR-3)']).red
      ck('«подписка на событие увольнения» «для БТ» (acc run-1) — красный', r.some((m) => m.startsWith('P23 ')), true, r.join(' | '))
      for (const n of [13, 17]) ck(`P${n} (слой БТ) во входе спеки — красный`, G(addItem(ok, n === 17 ? R : X, listPoints(name).find((p) => p.n === n).text), name).red.some((m) => m.startsWith(`P${n} `)), true)
      ck('P9 в «Расходится с БТ» входа спеки — зелёный (intent.md: отклонение от БТ)', G(addItem(ok.replace(lineOf(ok, name, 9) + '\n', ''), X, listPoints(name).find((p) => p.n === 9).text), name).pass, true)
      // P9 — в обе стороны (решение пользователя 2026-10-15): в «Открыто» входа спеки и «для БТ» по сводке — зелёный.
      const l9 = lineOf(ok, name, 9)
      ck('P9 в «Открыто» входа спеки — зелёный', l9 !== undefined && G(ok, name).pass, true)
      ck('P9 не во входе, сводка «для БТ» — зелёный', G(ok.replace(l9 + '\n', ''), name, [summaryOf(name) + '\n- для БТ — 1 (P9)']).pass, true)
    }
    if (name === 'MR-CHG') {
      const l7 = lineOf(ok, name, 7)
      ck('«12 часов вместо 24» → «12 часов» (mr-chg run-1) — красный', G(ok.replace(l7, l7.replace(' вместо 24', '')), name).red.some((m) => /потеряно число 24/.test(m)), true)
      const l12 = lineOf(ok, name, 12)
      ck('«не помню» → «не помнят» (mr-chg run-1) — красный', G(ok.replace(l12, l12.replace('не помню', 'не помнят')), name).red.some((m) => /не помню/.test(m)), true)
    }
    if (name === 'MR-NEW') {
      const t = ok.replace(lineOf(ok, name, 12) + '\n', '')
      ck('15% «вне документов» (mr-new run-2, run-3) — красный', G(t, name, ['- вне документов и «не вносим» — 3 (отмены записи на 15% занятий; срок уточнения; кто начал встречу)']).red.some((m) => m.startsWith('P12 ')), true)
      const l12 = lineOf(ok, name, 12)
      ck('15% без «не уверен» — красный', G(ok.replace(l12, l12.replace(' (по памяти, не уверен)', '')), name).red.some((m) => /не уверен|15%/.test(m)), true)
    }
    if (name === 'REW') ck('уже записанные P6, P12, P13 по номерам в отчёте (rew run-1) — зелёный', G(ok, name, ['**Счёт по списку:** 5 пунктов в «Решено», 1 в «Сведениях», 3 уже записано (P6, P12, P13), для БТ 0.']).pass, true)
    if (name === 'NB-PICK') {
      const l = lineOf(ok, name, 12)
      ck('набросок без пометки — красный', G(ok.replace(l, l.replace(' (предложение аналитика)', '')), name).pass, false)
      ck('наброска нет — красный', G(ok.replace(l + '\n', ''), name).pass, false)
    }
  }

  console.log('\nобщие')
  ck('классификатор: мысль про трек на чеке', thoughtKind('Печатать трек-номер на чеке приёмки'), 'мысль')
  ck('классификатор: набросок экрана оператора', thoughtKind('Экран оператора: скан, вес, наклейка'), 'набросок')
  ck('сводка: «для спеки — 1 (…)» → другой слой', summaryPlaces(['для спеки — 1 (рабочие дни из производственного календаря)'], 'CR').get(10), OTHER)
  ck('сводка: «вход для БТ или спеки» — не метка слоя', summaryPlaces(['Пишу вход для БТ или спеки по производственного календаря.'], 'CR').get(10), undefined)
  ck('сводка: последнее упоминание старше', summaryPlaces(['вне документов — 1 (P10)', 'для спеки — 1 (P10)'], 'CR').get(10), OTHER)
  ck('сводка: вариант «Не вносим» в вопросе — не метка', summaryPlaces(['Варианты: «Оставляем»; «Не вносим»\nПроизводственный календарь'], 'CR').get(10), undefined)
  // Круг 3: три ложных красных разбора сводки (строки дословно из ответов прогонов).
  const chg = summaryPlaces(['- уже записано — 3 (число дней календарные и праздники не вычитаются, порядок заявок у руководителя, удаление черновиков не входит)'], 'CHG')
  ck('сводка: «порядок заявок у руководителя» → P9 уже записано (r3 ni-chg run-2)', [7, 9, 10].map((n) => chg.get(n)).join(','), [DONE, DONE, DONE].join(','))
  const vac = summaryPlaces(['- уже записано — 7 (срок до 31 января, дни календарные, согласование после даты начала, отзыв из начавшегося отпуска не входит, отдельной роли руководителя нет, удаление черновиков не входит, кадровик видит только согласованные);'], 'VAC')
  ck('сводка: «дни календарные» → P17, не P12 (r3 ni-vac run-3)', `${vac.get(17)}/${vac.get(12)}`, `${DONE}/undefined`)
  ck('сводка: все семь «уже записано» VAC узнаны', [6, 17, 18, 19, 22, 24, 25].every((n) => vac.get(n) === DONE), true)
  const pick = ['**Не во вход:** для спеки — 0, уже записано — 0, вне документов и «не вносим» — 0, мысли и наброски не взяты — 1 (трек-номер на чеке приёмки).', '- Другой слой, уже записано, вне документов: 0.\n- Мысль про трек-номер на чеке не взята: 1.']
  ck('сводка: скобка — ближайшей метки, «— 0» места не даёт (r3 ni-nb-pick run-1, ход 2)', summaryPlaces([pick[0]], 'NB-PICK').get(8), THOUGHT)
  ck('сводка: «вне документов: 0.» не перескакивает строку (r3 ni-nb-pick run-1, ход 3)', summaryPlaces([pick[1]], 'NB-PICK').get(8), THOUGHT)
  ck('сводка: оба хода подряд — P8 «не взята»', summaryPlaces(pick, 'NB-PICK').get(8), THOUGHT)
  ck('сводка: метка «— 0» со скобкой — места нет', summaryPlaces(['вне документов — 0 (трек-номер на чеке приёмки)'], 'NB-PICK').get(8), undefined)
  ck('сводка: «это спека (2):» — список ниже её', summaryPlaces(['Во вход БТ не беру — это спека (2):\n1. формирование файла по шаблону\n2. интеграция с кадровой системой\n\nТак?'], 'NEW').get(11), OTHER)
  ck('основы: «заявок» и «заявки» — одна основа', bestPoint('порядок заявок у руководителя', listPoints('CHG'))?.n, 9)
  ck('основы: ничья — не пункт («как сейчас работают пункты выдачи»: P6 и P9)', bestPoint('как сейчас работают пункты выдачи', listPoints('NB-IN')), null)
  ck('основы: одно общее слово — не пункт', bestPoint('календарные', listPoints('VAC')), null)
  // Круг 4 (r4 ni-chg run-1): суть P9 в сводке — «порядок списка у руководителя», общая основа одна. Строки дословно.
  const r4a = '- Календарные дни без вычета праздников, порядок списка у руководителя (FR-7) и «удаление черновиков не входит» (3.2) — уже записаны в БТ.'
  const r4b = '- уже записано — 3 (календарные дни без вычета праздников, порядок списка у руководителя, удаление черновиков не входит)'
  const lay4 = new Map([[6, { layer: 'БТ', doc: 'меняет: FR-3' }], [7, { layer: 'БТ', doc: 'уже записано: FR-1 и 3.2 Не входит в проект' }], [8, { layer: 'БТ', doc: 'меняет: FR-9' }], [9, { layer: 'БТ', doc: 'уже записано: FR-7' }], [10, { layer: 'БТ', doc: 'уже записано: 3.2 Не входит в проект' }], [11, { layer: 'спека', doc: 'документа нет' }], [12, { layer: 'БТ', doc: 'новое' }]])
  const in4 = new Set([6, 8, 12])
  ck('место в документе: «(FR-7)» и раскладка «P9 · уже записано: FR-7» → P9 (r4, ход 2)', summaryPlaces([r4a], 'CHG', { inInput: in4, layout: lay4 }).get(9), DONE)
  ck('место в документе без раскладки — по причине в PTS («БТ FR-7») → P9', summaryPlaces([r4a], 'CHG', { inInput: in4 }).get(9), DONE)
  ck('скобки до метки — строка с одной меткой целиком её: P7, P10 тоже «уже записано»', [7, 10].map((n) => summaryPlaces([r4a], 'CHG', { inInput: in4 }).get(n)).join(','), [DONE, DONE].join(','))
  ck('«3.2» у двух пунктов (P7, P10) — по месту не узнаётся (счёт 1 при трёх кандидатах — тоже нет)', (() => { const pl = summaryPlaces(['- уже записано — 1 (раздел 3.2)'], 'CHG', { inInput: in4, layout: lay4 }); return pl.get(7) === undefined && pl.get(10) === undefined })(), true)
  ck('счёт «уже записано — 1» и вне входа один такой пункт — покрытие', summaryPlaces(['- уже записано — 1 (раздел 3.2)'], 'CHG', { inInput: new Set([6, 7, 8, 9, 11, 12]), layout: lay4 }).get(10), DONE)
  ck('счёт «уже записано — 3» = три пункта «уже записано» по раскладке → P9 покрыт (r4, ход 3)', summaryPlaces([r4b], 'CHG', { inInput: in4, layout: lay4 }).get(9), DONE)
  ck('счёт без раскладки — по местам PTS (P7, P9, P10) → P9 покрыт', summaryPlaces([r4b], 'CHG', { inInput: in4 }).get(9), DONE)
  ck('счёт «уже записано — 2» при трёх кандидатах — не покрытие', summaryPlaces([r4b.replace('— 3', '— 2').replace(', порядок списка у руководителя', '')], 'CHG', { inInput: in4, layout: lay4 }).get(9), undefined)
  ck('счёт не перекрывает место, названное сводкой', summaryPlaces([r4b, '- для спеки — 1 (P9)'], 'CHG', { inInput: in4, layout: lay4 }).get(9), OTHER)

  // Опора, роли, варианты, мысли пересказом (ревью 2026-10-16) — на одной фикстуре каждого вида.
  {
    const vac = fromList('VAC')
    const l12 = lineOf(vac, 'VAC', 12)
    ck('опора: «три дня» → «пять дней» (число словами) — красный', G2(vac.replace(l12, l12.replace('три дня', 'пять дней')), 'VAC').red.some((m) => /нет опоры.*число «5»/.test(m)), true)
    ck('опора: «три дня» → «четыре дня» (4 есть у другого пункта) — красный: потеряно 3', G2(vac.replace(l12, l12.replace('три дня', 'четыре дня')), 'VAC').red.some((m) => /^P12 .*потеряно число 3/.test(m)), true)
    ck('опора: лишняя строка с числом и ФИО — красный', G2(addItem(vac, R, 'Запуск переносится на 15 марта, бюджет 2 млн — решил: Петров И. И.'), 'VAC').red.some((m) => /нет опоры.*Петров/.test(m)), true)
    ck('опора: «ждёт: не назван» вместо «ждёт: —» — зелёный', G2(vac.replace(lineOf(vac, 'VAC', 7), lineOf(vac, 'VAC', 7).replace('ждёт: —', 'ждёт: не назван')), 'VAC').pass, true)
    ck('опора: число из реплики аналитика — зелёный', gradeContent(addItem(vac, O, 'Срок ответа — 5 дней (со слов аналитика) — ждёт: —'), 'VAC', [summaryOf('VAC')], new Map(), ['Срок ответа отдела кадров — пять дней.']).pass, true)
    ck('опора: «> Документ:» не из засева — красный', G2(vac.replace('> Документ: —', '> Документ: coddoc/EMP-1207/technical_specification.md'), 'VAC').red.some((m) => /Документ/.test(m)), true)
    ck('опора: «> Документ:» из засева — зелёный', G2(vac.replace('> Документ: —', '> Документ: coddoc/EMP-1207/business_requirements.md'), 'VAC').pass, true)
    ck('ФИО: «ждёт: Литвинов» у пункта «ждёт: —» — красный', G2(vac.replace(lineOf(vac, 'VAC', 7), lineOf(vac, 'VAC', 7).replace('ждёт: —', 'ждёт: Литвинов И. П.')), 'VAC').red.some((m) => /^P7 .*ждёт: Литвинов/.test(m)), true)
    ck('варианты: открытый вопрос утверждением — красный', G2(vac.replace(l12, '- Минимальный срок подачи ежегодного оплачиваемого отпуска — три календарных дня до начала — ждёт: Литвинов И. П. (уточняет у Елены Сергеевны)'), 'VAC').red.some((m) => /^P12 .*вариантами/.test(m)), true)
    ck('варианты: оба варианта без «?» — зелёный', G2(vac.replace(l12, '- Минимальный срок подачи ежегодного оплачиваемого отпуска: три дня до начала, календарных или рабочих — не решено — ждёт: Литвинов И. П. (уточняет у Елены Сергеевны); до ответа: в FR-3 остаётся «не раньше следующего дня»'), 'VAC').pass, true)
    const chg = fromList('CHG')
    const l6 = lineOf(chg, 'CHG', 6)
    ck('ФИО: «решил: Соколова» у пункта Литвинова — красный', G2(chg.replace(l6, l6.replace('решил: Литвинов И. П.', 'решил: Соколова Е. В.')), 'CHG').red.some((m) => /^P6 .*решил: Соколова/.test(m)), true)
    const meet = (t, x) => t.replace(/^(> Встреча:[^\n]*)$/m, `$1 · решали: ${x}`)
    ck('роли: «автор БТ — Литвинов» (ролей на встрече не называли) — красный', G2(meet(chg, 'автор БТ — Литвинов И. П.'), 'CHG').red.some((m) => /роль «автор БТ»/.test(m)), true)
    ck('роли: «отдел кадров — Литвинов И. П.» (так в шапке VAC) — зелёный', G2(meet(vac, 'отдел кадров — Литвинов И. П.'), 'VAC').pass, true)
    ck('роли: «отдел кадров — Соколова Е. В.» (у Соколовой роли нет) — красный', G2(meet(vac, 'отдел кадров — Соколова Е. В.'), 'VAC').red.some((m) => /роль «отдел кадров»/.test(m)), true)
    ck('роли: «заказчик — Литвинов» (заказчика на встрече не называли) — красный', G2(meet(chg, 'заказчик — Литвинов И. П.'), 'CHG').red.some((m) => /роль «заказчик»/.test(m)), true)
    ck('роли: ФИО без роли из шапки — зелёный', G2(meet(chg, 'Литвинов И. П.; Соколова Е. В.'), 'CHG').pass, true)
    ck('«решает:» — фамилии нет в списке — красный', G2(addItem(chg, X, 'FR-3 меняется — решает: Петров И.'), 'CHG').red.some((m) => /решает: Петров/.test(m)), true)
    const acc = fromList('ACC')
    ck('«решает: ИБ» — зелёный (место P9 в «Расходится с БТ» законно)', G2(acc.replace(lineOf(acc, 'ACC', 9), '- Между согласованием и выдачей доступа нужен статус, которого в БТ нет; до ответа в спеке статус называется «Согласована» — решает: ИБ'), 'ACC').pass, true)
    const nb = fromList('NB-IN')
    ck('мысль пересказом без «трек» — красный', G2(addItem(nb, O, 'Печатать номер отправления прямо на чеке приёмки, чтобы отправитель не искал его в приложении (предложение аналитика) — ждёт: —'), 'NB-IN').red.some((m) => /^мысль P8 во входе/.test(m)), true)
    ck('«1 200» = «1200» — зелёный', G2(nb.replace('из 1200', 'из 1 200'), 'NB-IN').pass, true)
    const pk = fromList('NB-PICK')
    ck('выбранный набросок «(со слов аналитика)» — зелёный', G2(pk.replace('(предложение аналитика)', '(со слов аналитика)'), 'NB-PICK').pass, true)
    ck('пустышка — красный', G2('', 'VAC').pass, false)
  }
  // Новые пробы фазы 1.5: хороший прогон, «по правке» на версии 1.0.0, ловушки (полный набор — selftest/loop/ni-mut.mjs).
  {
    const GC = (t, n, ctx = {}, turns, layout = new Map()) => gradeContent(t, n, turns || [summaryOf(n)], layout, analystReplies(n), ctx)
    const sp = fromList('SPEC-BT')
    const g1 = GC(sp, 'SPEC-BT')
    ck('SPEC-BT: вход по правке (P7, P8 — «Расходится с БТ») — зелёный, «по правке» пусто', `${g1.pass}/${g1.fix.length}`, 'true/0', g1.red.concat(g1.fix).join(' | '))
    const cur = ['P7', 'P8'].reduce((t, p) => t.replace(lineOf(t, 'SPEC-BT', Number(p.slice(1))) + '\n', ''), sp)
    const g2 = GC(cur, 'SPEC-BT', {}, ['Не идёт во вход: для БТ — 4 (P7, P8, P9, P10), мысли и наброски не взяты — 1 (P6).'])
    ck('SPEC-BT: P7, P8 «для БТ» (версия 1.0.0) — не красный, две строки «по правке» E1', `${g2.pass}/${g2.fix.filter((m) => /E1/.test(m)).length}`, 'true/2', g2.red.concat(g2.fix).join(' | '))
    const g3 = GC(addItem(sp, R, 'Повторный запрос клиента на тот же препарат в той же аптеке в тот же день отклоняем — решил: Гладких Таисия'), 'SPEC-BT')
    ck('SPEC-BT: P9 в «Решено» входа спеки (баг 8) — не красный, «по правке» E4', `${g3.pass}/${g3.fix.some((m) => /E4/.test(m))}`, 'true/true', g3.red.join(' | '))
    const lay = new Map([[8, { layer: 'БТ', doc: 'противоречит: 3.2 Не входит' }]])
    ck('SPEC-BT: P8 «противоречит» в раскладке без «Меняем?» — «по правке» E2', GC(sp, 'SPEC-BT', {}, undefined, lay).fix.some((m) => /^P8 .*E2/.test(m)), true)
    ck('SPEC-BT: тот же P8 с «Меняем?» в ответе — «по правке» пусто', GC(sp, 'SPEC-BT', {}, [summaryOf('SPEC-BT'), 'В БТ, 3.2, сейчас «не входит: заказ препарата, которого нет в наличии». В списке: препарат не из наличия тоже заказываем (Гладких Таисия). Меняем?'], lay).fix.length, 0)
    ck('SPEC-BT: «раз в час» во входе — красный', GC(sp.replace('раз в 10 минут', 'раз в час'), 'SPEC-BT').red.some((m) => /раз в час/.test(m)), true)
    const nb = fromList('NB-REPEAT')
    const g4 = GC(nb, 'NB-REPEAT')
    ck('NB-REPEAT: вход спеки (правка E3) — зелёный, «по правке» пусто', `${g4.pass}/${g4.fix.length}`, 'true/0', g4.red.concat(g4.fix).join(' | '))
    const g5 = GC(fromList('NB-REPEAT/bt'), 'NB-REPEAT/bt')
    ck('NB-REPEAT: второй вход БТ (1.0.0) — не красный, «по правке» E3', `${g5.pass}/${g5.fix.some((m) => /E3/.test(m))}`, 'true/true', g5.red.join(' | '))
    const tw = fromList('TWIN').replace(/(Отменить один привоз[^\n]*?) — решил:/, '$1; за отменённый привоз деньги с карты не списываем (со слов аналитика) — решил:')
    const twin = ['Правки БТ.', '1. Не вносим. 2. В открытые вопросы. 3. Так.', 'Поправить: к пункту про отмену привоза добавьте — за отменённый привоз деньги с карты не списываем.', 'Записать 7 пунктов.']
    const g6 = GC(tw, 'TWIN', { twin })
    ck('TWIN: вход по ответам двойника — зелёный', g6.pass, true, g6.red.join(' | '))
    ck('TWIN: поправка без «(со слов аналитика)» — красный', GC(tw.replace(' (со слов аналитика)', ''), 'TWIN', { twin }).red.some((m) => /поправка/.test(m)), true)
    ck('TWIN: цель не та, что выбрал двойник — красный', GC(setGoal(tw, 'правка работающего'), 'TWIN', { twin }).red.some((m) => /аналитик выбрал/.test(m)), true)
    const g7 = GC(tw, 'TWIN', { twin: twin.map((r) => r.replace('Не вносим', 'Оставляем')) })
    ck('TWIN: вопроса по P8 не было — не красный, «ветка «Не вносим» не измерена» (критерий раунда)', `${g7.pass}/${g7.unmeasured.some((m) => /Не вносим/.test(m))}`, 'true/true', g7.red.join(' | '))
    const g8 = GC(addItem(tw, R, 'Привоз автозаказа — с 10 до 22, в трёхчасовой интервал, который выбирает клиент; сейчас — с 9 до 21 без интервала — решил: Мамедов Т. Р.'), 'TWIN', { twin: twin.map((r) => r.replace('Не вносим', 'Оставляем')) })
    ck('TWIN: без вопроса P8 во входе — не красный, предупреждение', `${g8.pass}/${g8.warn.some((m) => /^P8 .*ветка не измерена/.test(m))}`, 'true/true', g8.red.join(' | '))
    ck('TWIN: «Не вносим» ответил, а P8 во входе — красный', GC(addItem(tw, R, 'Привоз автозаказа — с 10 до 22, в трёхчасовой интервал, который выбирает клиент; сейчас — с 9 до 21 без интервала — решил: Мамедов Т. Р.'), 'TWIN', { twin }).red.some((m) => /^P8 /.test(m)), true)
    for (const n of ['SPEC-BT', 'NB-REPEAT', 'TWIN']) ck(`${n}: пустышка — красный`, GC('', n, { twin }).pass, false)
  }
  // «Не входит» у пункта — значит, и «Решено» (ревью 2026-10-16).
  ck('карта: у каждого «[решено] не входит:» с местом «Не входит» есть и «Решено»', Object.keys(FX).flatMap((n) => listPoints(n).filter((p) => /^не входит:/i.test(p.text) && PTS[n][p.n].at.includes(N) && !PTS[n][p.n].at.includes(R)).map((p) => `${n} P${p.n}`)).join(','), '')

  // NB-REPEAT в песочнице: вход спеки — без «по правке»; второй вход БТ `-bt-2.md` — E3; `-2-bt.md` — E3 и E5; первый вход тронут — красный.
  {
    const sb = mkdtempSync(join(tmpdir(), 'grade-ni-'))
    try {
      const seedDir = seedDirOf('NB-REPEAT')
      const seedFiles = listFiles(seedDir, seedDir, true)
      for (const rel of seedFiles) { mkdirSync(join(sb, rel, '..'), { recursive: true }); writeFileSync(join(sb, rel), readFileSync(join(seedDir, rel))) }
      writeFileSync(join(sb, '_seeded.txt'), seedFiles.join('\n') + '\n')
      writeFileSync(join(sb, 'answer.md'), summaryOf('NB-REPEAT'))
      const spec = 'coddoc/CBK-208/notebook-2026-10-14-spec.md'
      writeFileSync(join(sb, spec), fromList('NB-REPEAT'))
      let r = gradeRun(sb, 'NB-REPEAT')
      ck('NB-REPEAT песочница: вход спеки — зелёный, «по правке» пусто', `${r.pass}/${r.fix.length}`, 'true/0', r.red.concat(r.fix).join(' | '))
      rmSync(join(sb, spec))
      writeFileSync(join(sb, 'answer.md'), summaryOf('NB-REPEAT/bt'))
      writeFileSync(join(sb, 'coddoc/CBK-208/notebook-2026-10-14-bt-2.md'), fromList('NB-REPEAT/bt'))
      r = gradeRun(sb, 'NB-REPEAT')
      ck('NB-REPEAT песочница: второй вход БТ -bt-2.md — не красный, «по правке» E3', `${r.pass}/${r.fix.some((m) => /E3/.test(m))}/${r.fix.some((m) => /E5/.test(m))}`, 'true/true/false', r.red.join(' | '))
      rmSync(join(sb, 'coddoc/CBK-208/notebook-2026-10-14-bt-2.md'))
      writeFileSync(join(sb, 'coddoc/CBK-208/notebook-2026-10-14-2-bt.md'), fromList('NB-REPEAT/bt'))
      r = gradeRun(sb, 'NB-REPEAT')
      ck('NB-REPEAT песочница: -2-bt.md — не красный, «по правке» E3 и E5', `${r.pass}/${r.fix.some((m) => /E3/.test(m))}/${r.fix.some((m) => /E5/.test(m))}`, 'true/true/true', r.red.join(' | '))
      writeFileSync(join(sb, 'coddoc/CBK-208/notebook-2026-10-14-bt.md'), fromList('NB-REPEAT/bt'))
      ck('NB-REPEAT песочница: первый вход переписан — красный', gradeRun(sb, 'NB-REPEAT').red.some((m) => /засев тронут/.test(m)), true)
    } finally { rmSync(sb, { recursive: true, force: true }) }
  }

  // Засев: хеши `_seeded.sha256` (обе формы sha256sum) и прогон без ответа и входа.
  {
    const sb = mkdtempSync(join(tmpdir(), 'grade-ni-'))
    try {
      const seedDir = seedDirOf('CR')
      const rel = FX.CR.list
      mkdirSync(join(sb, rel, '..'), { recursive: true })
      const bytes = readFileSync(join(seedDir, rel))
      writeFileSync(join(sb, rel), bytes)
      const h = createHash('sha256').update(bytes).digest('hex')
      writeFileSync(join(sb, '_seeded.txt'), rel + '\n')
      ck('нет ни ответа, ни входа, отказа API нет — в счёт (не «НЕ ИЗМЕРЕНО»)', measured(sb), true)
      ck('нет ни ответа, ни входа — красный «файл не записан»', gradeRun(sb, 'CR').red.some((m) => /^файл не записан/.test(m)), true)
      writeFileSync(join(sb, '_seeded.sha256'), `${h}  ${rel}\n`)
      ck('_seeded.sha256 «<хеш>  <путь>», файл цел — засев не тронут', seedTouched(sb, 'CR').length, 0)
      writeFileSync(join(sb, '_seeded.sha256'), `${h} *${rel}\r\n`)
      ck('_seeded.sha256 «<хеш> *<путь>» (Windows), CRLF — засев не тронут', seedTouched(sb, 'CR').length, 0)
      writeFileSync(join(sb, '_seeded.sha256'), `${'0'.repeat(64)}  ${rel}\n`)
      ck('_seeded.sha256: хеш не тот — засев тронут (с фикстурой не сверяется)', seedTouched(sb, 'CR').join(','), rel)
      rmSync(join(sb, '_seeded.sha256'))
      writeFileSync(join(sb, rel), bytes.toString('utf8').replace(/\r?\n/g, '\r\n'))
      ck('без хешей: тот же текст в CRLF — засев не тронут (LF-текст)', seedTouched(sb, 'CR').length, 0)
    } finally { rmSync(sb, { recursive: true, force: true }) }
  }
  console.log(bad === 0 ? '\nсамопроверка: ok' : `\nсамопроверка: ПРОВАЛОВ ${bad}`)
  process.exit(bad === 0 ? 0 : 1)
}

// ---------- прогон ----------

const IS_MAIN = !!process.argv[1] && fileURLToPath(import.meta.url) === pathResolve(process.argv[1])
if (IS_MAIN) {
  const arg = process.argv[2]
  if (arg === '--selftest') selftest()
  const fxName = process.argv[process.argv.indexOf('--fx') + 1]
  const fx = FX[fxName]
  const verbose = process.argv.includes('--verbose')
  if (!arg || !existsSync(arg) || !fx || fx.hidden) { console.error(`usage: node grade-ni.mjs <каталог проб> --fx ${Object.keys(FX).filter((n) => !FX[n].hidden).join('|')} [--verbose] | --selftest`); process.exit(1) }
  const runs = readdirSync(arg).filter((n) => /^run-\d+$/.test(n) && statSync(join(arg, n)).isDirectory()).sort()
  console.log(`\nпроба ni-${fxName.toLowerCase()}, ${arg}`)
  const SETTINGS = join(arg, '_settings.txt')
  const CAP = existsSync(SETTINGS) ? Number((read(SETTINGS).match(/потолок ходов: (\d+)/) || [])[1] || 0) : 0
  let n = 0; let green = 0; let fixOk = 0; const unm = {}
  for (const run of runs) {
    const dir = join(arg, run)
    if (!measured(dir)) { console.log(`  ${run}: НЕ ИЗМЕРЕНО`); continue }
    n++
    const r = gradeRun(dir, fxName)
    if (r.pass) green++
    if (!r.fix.length) fixOk++
    const capHit = !r.hasInput && CAP > 0 && r.turns >= CAP
    console.log(`  ${run}: ${r.pass ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ — ' + r.red.join('; ')}`)
    if (r.fix.length) console.log(`         по правке: ${r.fix.join(' · ')}`)
    if (r.unmeasured.length) console.log(`         не измерено (в счёт ветки не идёт): ${r.unmeasured.join(' · ')}`)
    for (const u of r.unmeasured) unm[u] = (unm[u] || 0) + 1
    console.log(`         ходов: ${r.turns}, субагентов: ${r.agents}${capHit ? ` · УПЁРСЯ В ПОТОЛОК ${CAP} ХОДОВ — читать answer-*.md` : ''}`)
    if (r.warn.length) console.log(`         предупреждения: ${r.warn.join(' · ')}`)
    if (verbose) for (const row of r.rows) console.log(`         P${row.n} [${row.kind}] → ${row.where}   (место: ${row.at.join(' | ')})`)
  }
  console.log(`\nИТОГ ${fxName}: ${green}/${n}  ← ложь и поломка: место каждого пункта, опора, дословность, ожидания пробы, засев не тронут`)
  console.log(`по правке без замечаний: ${fixOk}/${n}  ← ожидания черновика правок (баги 1, 4, 5, 8, 9); на версии до правок — справочно`)
  for (const [u, k] of Object.entries(unm)) console.log(`${u}: в ${k} из ${n} прогонов — эта ветка измерена в ${n - k}`)
}
