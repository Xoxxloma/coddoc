#!/usr/bin/env node
// Грейдер `interaction-diagram` 3.2.0 и 4.0.0 (этап К): схема — проекция INT-карточек спеки, стрелка на звено границы.
//
//   node grade-id.mjs <папка-пробы> [--format=mmd|puml|ask]   — фикстура, тип и формат из имени папки:
//     id-* → ID-DIAG, ring-* → ID-RING, dir-* → ID-DIR, rep-* → ID-REP, chain-* → ID-CHAIN, det-* → ID-DET;
//     тип «подробная» — префикс det или вставка -det- (rep-det-mmd), иначе короткая; суффикс mmd/puml/ask;
//     пробы опросника — по таблице `QPROBES` (chain-q-mmd, chain-q-idk, ring-q-one, ring-q-two, rep-q-mmd,
//     det-q-mmd, det-q-puml, det-q-alt, id-q-mmd); контроль `det-short-mmd` — короткая по ID-DET (`NAMED`);
//     пробы этапа К (скилл 4.0.0) — по таблице `STAGE` (det-o-one, det-o-two, det-t-short, det-y-short, id-q-mmd, chain-q-mmd,
//     chain-q-idk, ring-q-one, ring-q-two, rep-q-mmd): имя из `STAGE` главнее `QPROBES`;
//     имя не распознано — ошибка
//     сценарная — по таблице `SCEN` (det-s-mmd, det-s-puml, det-s-alt, det-s-idk, det-y-scen, rep-s-mmd, chb-s-mmd, chb-s-idk);
//   node grade-id.mjs --round <папка-раунда>   — сводка раунда по папкам проб из `STAGE` и `SCEN`, итог по порогам
//   node grade-id.mjs --selftest
//
// Истина — карточки спеки ФИКСТУРЫ (не песочницы: прогон мог её поправить, это отдельный красный).
// Из карточки берутся только «Граница/направление» и «Контракт…» (запрос/событие).
// Стрелка по границе: `A → B` — A→B, `A ← B` — B→A, `A ↔ B` — двусторонняя, все сплошные;
// `событие:` — асинхронная. Имя участника — сторона до первой « (». Подпись — `INT-N` или
// `INT-N · <метод и путь | имя события>`; путь на стрелке = путь из контракта (нет там — нет и тут).
// Граница-цепочка `A → B → C` — стрелка на каждое звено, у всех номер карточки; методы контракта
// раздаются звеньям по порядку, звену без метода — только `INT-N`. `→` в скобках звеном не считается.
// Карточка без знака стрелки не рисуется и обязана быть названа в отчёте (И13).
//
// Подробная (файл `interaction_diagram_detailed.*`): на карточку — пометка триггера, запросы по звеньям,
// ответ, ошибки. Запросы — по правилам короткой (И2–И12); ответ — пунктир, ошибки — стрелка с крестом,
// обе против первого запроса карточки либо между сторонами из ответа аналитика (`back` в истине пробы),
// по одной на карточку (Д3, Д4); пометка `note over` — над стороной
// первого запроса, текст = полю «Триггер» (Д5, отдельный счёт). Где ответ и какие коды — таблица `DETAIL`.
//
// Опросник (два хода): первый ход — вопросы по поводам `REASONS` без файла схемы (В1), второй — файл по
// реплике аналитика. Истина схемы — карточки после ответа (`QPROBES[…].truth`: подмена границы, склейка имён,
// карточка без ответа — без стрелок, стороны ответа цепочки), якоря И2–И12 и Д3, Д4 по ней сводятся в В3;
// строка отчёта «со слов аналитика» — В4, отдельный счёт. Отчёт читается по последнему ходу (`answer-NN.md`),
// не по склейке `answer.md`. Прогон с `_api-failure*.txt` — не в счёт у любой пробы.
//
// Этап К (скилл 4.0.0, `PLAN-ID-SCENARIO.md` §8): короткая схема по времени, два хода. Первый ход — вопросы текстом
// без файла схемы: об участниках (названы ВСЕ стороны), о порядке (названы ВСЕ карточки) и по карточке — о каждой
// цепочке (в тексте границы два и больше знаков направления) и о каждой карточке без знака направления — В1.
// Второй — файл по реплике: истина после ответа (`STAGE[…].truth`), карточки в порядке из реплики, звенья цепочки
// подряд (И15); без ответа карточки на схеме нет у цепочки со знаком в скобках и у карточки без направления, а
// цепочка без знака в скобках рисуется, как прочитана. «Схема верна» — якоря И0–И13 и И15.
// Отдельным счётом: В1, В4, К1 (вопроса о карточке, о которой спрашивать не положено, нет), Ш1 (фраза о порядке в
// шапке файла), Р1 (ведущий открыл `reference/short.md`; по скиллу — на первом ходу, засчитывается в любом).
// С 5.0.0 Р1 — файл входа, типа и формата (`reference/inputs|kinds|notation/`), по одному из папки (`readReference`).
// Пороги раунда — в `GATES`, сводка — `--round`.
//
// Этап С (скилл 4.1.0, `reference/scenario.md`, `PLAN-ID-SCENARIO.md` §10): сценарная схема по PRK-9, пробы — таблица
// `SCEN` (det-s-mmd, det-s-puml, det-s-alt, det-s-idk). Файл `interaction_scenarios.*`, по блоку на сценарий. Истина —
// строки сценариев `SCEN_*`: пользователь, запросы, ответы, пометки тел, внутренние шаги по порядку. «Схема верна» —
// И0, С1 (файл), С2 (число сценариев), С3 (запросы по порядку), С4 (ответы и их место), С5 (пометки тел), С6 (шаги),
// С7 (пользователь) и И5–И10, И12 в пределах сценария. Отдельным счётом: В1 (участники, цепочка, сценарии, шаги),
// Ш1 (источник сценариев в шапке), Р1 (открыт `reference/scenario.md`). Строки отчёта не грейдятся.
//
// Скилл 4.3.0 — три хода у проб `STAGE`, `SCEN`, `QPROBES`: ход 1 — только вопрос о типе схемы, ход 2 — ответ о типе
// и вопросы Step 3, ход 3 — реплика и файл. Т1 — ход 1 (`answer-01.md`, `stream.jsonl`): есть `?`, корни «коротк» и
// «сценар», ни одного `INT-N`, файл схемы не записан; вопрос о формате не требуется — формат назван в промптах пула.
// Т1 входит в В1, у `STAGE` и `SCEN` печатается ещё отдельным якорем. В1 по вопросам, К1 и «файл не записан ходом
// вопросов» — по ходу 2 (`answer-02.md`, `stream-02.jsonl`); Р1 — любой ход; файл схемы и отчёт — по финалу.
// `det-t-short` — контроль типа: в запросе «сценарную», ответ «Короткую.», истина как у `det-o-one`.
//
// Ответ «Да, всё верно.» на ход 3 — схема по гипотезам самой модели. `det-y-short` (`STAGE`, `confirm`): истина — карточки,
// как их читает скилл, порядок по номерам. `det-y-scen` (`SCEN`, `dyn`): истина ДИНАМИЧЕСКАЯ — гипотеза сценариев из
// `answer-02.md` (`hypothesis`): число сценариев, состав, вложенность; где гипотеза читается двояко («внутри …, затем …»,
// «внутри него» дважды, вложенная в цепочку карточка без своего звена, порядок сценариев) — годится любое прочтение.
// Вне «схема верна» печатается диагностика «гипотеза по правилу триггеров» (`PERSON`, Step 3 скилла). `rep-s-mmd` (`SCEN`):
// REP-214 по полной реплике; тела списком — `bodies` по определению `reference/scenario.md`, места, где тело читается
// двояко, — `MAYBE_REP` (пометка есть или нет). Спека, засеянная до правки фикстуры, — не правка: `SPEC_PAST`.
// К1 не считает вопросом о карточке вопрос, один ли это сервис (`sameQuestion`).
//
// Тела по звеньям цепочки (`chb-s-mmd`, `chb-s-idk`, фикстура ID-CHB, ESS-31): эталон — по требованию владельца, не по
// тексту скилла. Метод и тело одного вызова — на одном звене: методы раздаются звеньям по порядку, тело, описанное при
// методе или рядом с названными сторонами звена, — у этого звена, тело ответа без метода и сторон — у звена своего запроса.
// Пометка тела запроса — сразу после стрелки запроса этого звена, над получателем запроса; тела ответа — сразу после
// пунктирного ответа этого звена, над его получателем. Строки истины `['q', n, j]` / `['p', n, j]` — пометка звена j (без j —
// звено 1, как раньше); тела звеньев — `at` пробы поверх `bodies`. С5 у этих проб сверяет ещё, над кем пометка (`over`).
// Карточка B (INT-2) — тела без метода и без сторон: звено не определить, В1 требует вопроса о её телах со знаком `?` и
// номером (`askBody`, `bodyAsk`); пометки — по ответу аналитика, на «не знаю» у B их нет. Вне «схема верна» печатается
// диагностика «лишний вопрос о звене тела INT-1» (`extraBody`): у A тела при методе среднего звена. В `--round` — секция
// сценарной; отсутствие этих проб в раунде итог не красит (`opt`).

import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = { id: 'ID-DIAG', ring: 'ID-RING', dir: 'ID-DIR', rep: 'ID-REP', chain: 'ID-CHAIN', det: 'ID-DET', chb: 'ID-CHB' };
const fixDir = (k) => join(HERE, 'fixtures', FIXTURES[k]);
const specRel = (k) => {
  const key = readdirSync(join(fixDir(k), 'coddoc')).find((d) => existsSync(join(fixDir(k), 'coddoc', d, 'technical_specification.md')));
  return `coddoc/${key}/technical_specification.md`;
};
const norm = (s) => s.replace(/\r/g, '');
const read = (p) => (existsSync(p) ? norm(readFileSync(p, 'utf8')) : null);

const PATH_RE = /\b(GET|POST|PUT|PATCH|DELETE)\b\s*(?:\([^)]*\)\s*)?(\/[^\s,;`]+)/;
const SIGNS = ['↔', '←', '→'];
// Граница, где скобка закрыта не там и текст читается двояко: истина задана здесь, а не выводится.
const TRUTH = { chain: { 3: 'clinic-web → clinic-core → lab-service → LabNet' } };
// Подробная схема: у каких карточек есть ответная стрелка и какие коды на стрелке ошибок. Задано руками
// по правилам скилла (поле «Контракт (ответ)», коды 4xx/5xx из поля «Ошибки» карточки), из текста не выводится.
const DETAIL = {
  det: { answers: [1, 3, 5, 6], errors: { 1: ['404', '409'], 5: ['402', '502'], 6: ['401'] } },
  rep: { answers: [1, 2, 4, 5, 7], errors: { 1: ['404', '409', '422', '502'], 2: ['4xx', '502'], 7: ['404'] } },
};

// Поводы для вопроса по фикстурам (опросник), руками по спекам. П1 — три и больше знаков направления, один
// в скобках; П2 — знака нет, в тексте границы названы две стороны; П3 — стороны вне ТАБЛИЦЫ §1.2, один
// вопрос на спеку; П4 (только подробная) — в границе три и больше сторон, у карточки есть ответ или ошибки.
// `n` — карточка повода (П1, П2, П4), `names` — имена сторон вне таблицы (П3): вопрос обязан назвать все.
const REASONS = {
  chain: [{ id: 'П1', n: 3 }, { id: 'П3', names: ['LabNet'] }],
  ring: [{ id: 'П2', n: 11 }, { id: 'П3', names: ['Покупатель', 'бэкенд возвратов'] }],
  rep: [{ id: 'П2', n: 9 }, { id: 'П3', names: ['Браузер заказчика', 'repairy-telegram', 'YooKassa'] }],
  det: [{ id: 'П4', n: 5 }],
  id: [{ id: 'П3', names: ['планшет группы'] }],
};
// Пробы опросника: ключ — имя папки пробы. `truth` — истина ПОСЛЕ реплики второго хода: `borders` — граница
// карточки из ответа (поверх `TRUTH`), `same` — «сторона — это сервис»: имя слева рисуется участником справа,
// `skip` — карточки без стрелок (на П1 или П2 ответ «не знаю»), `back` — стороны [от, к] ответа и ошибок
// карточки-цепочки из ответа на П4. На «не знаю» по П3 участники остаются отдельными, как в карточках.
// `said` — что обязана назвать строка «со слов аналитика» (В4): по одному имени/номеру из каждой группы.
// `detailed` — проба подробной схемы.
const QPROBES = {
  'chain-q-mmd': { fx: 'chain', format: 'mmd', turns: 3, truth: { borders: TRUTH.chain }, said: [['INT-3']] },
  'chain-q-idk': { fx: 'chain', format: 'mmd', turns: 3, truth: { skip: [3] }, said: [] },
  'ring-q-one': { fx: 'ring', format: 'puml', turns: 3, truth: { same: { 'бэкенд возвратов': 'returns-api' } }, said: [['бэкенд возвратов', 'INT-10']] },
  'ring-q-two': { fx: 'ring', format: 'puml', turns: 3, truth: {}, said: [['бэкенд возвратов', 'INT-10']] },
  'rep-q-mmd': { fx: 'rep', format: 'mmd', turns: 3, truth: { borders: { 9: '1С → repairy-api' }, same: { YooKassa: 'ЮKassa' } }, said: [['INT-9'], ['YooKassa', 'INT-8']] },
  'det-q-mmd': { fx: 'det', format: 'mmd', detailed: true, turns: 3, truth: { back: { 5: ['parking-api', 'parking-web'] } }, said: [['INT-5']] },
  'det-q-puml': { fx: 'det', format: 'puml', detailed: true, turns: 3, truth: { back: { 5: ['parking-api', 'parking-web'] } }, said: [['INT-5']] },
  'det-q-alt': { fx: 'det', format: 'mmd', detailed: true, turns: 3, truth: { back: { 5: ['billing', 'parking-api'] } }, said: [['INT-5']] },
  'id-q-mmd': { fx: 'id', format: 'mmd', turns: 3, truth: {}, said: [['планшет группы', 'INT-4', 'участник', 'Участник', 'разн']] },
};
// Одноходовые пробы, имя которых не ложится в общий шаблон: контроль «поводов нет — файл с первого хода».
const NAMED = { 'det-short-mmd': { fx: 'det', detailed: false, format: 'mmd' } };
// Пробы этапа К (скилл 4.0.0: короткая по времени, вопросы до файла), руками по спекам и репликам хода 3 (TURN3_FILE);
// ключ — имя папки пробы, все трёхходовые. `truth` — как в `QPROBES`: граница из ответа, склейка имён, карточки без
// стрелок (`skip`: направление или цепочку аналитик не назвал). `order` — ПОРЯДОК карточек на схеме: номера из
// реплики, без ответа о порядке — по номерам; ненарисованных карточек в нём нет. `known` — аналитик на вопрос о
// порядке ответил (фраза шапки, Ш1). `said` — что обязана назвать строка «со слов аналитика» (В4), по токену из
// каждой группы; null — В4 не ставится (на «Не знаю.» называть нечего). У `chain-q-idk` без ответа обе цепочки:
// INT-3 (знак внутри скобок) не рисуется, INT-2 (знака в скобках нет) рисуется, как прочитана по скиллу.
const STAGE = {
  'det-o-one': { fx: 'det', format: 'mmd', turns: 3, truth: {}, order: [1, 3, 4, 2, 6, 5], known: true, said: [['участник', 'Участник', 'разн']] },
  'det-o-two': { fx: 'det', format: 'mmd', turns: 3, truth: {}, order: [1, 2, 4, 6, 3, 5], known: true, said: [['участник', 'Участник', 'разн']] },
  // Контроль типа: в запросе «сценарную», ответ «Короткую.», реплика `det-o-one` — истина та же, файл короткий.
  'det-t-short': { fx: 'det', format: 'mmd', turns: 3, truth: {}, order: [1, 3, 4, 2, 6, 5], known: true, said: [['участник', 'Участник', 'разн']] },
  // Реплика «Да, всё верно.» (`confirm`): аналитик подтвердил гипотезы модели — участники разные, порядок как в списке
  // (по номерам), INT-5 — два звена с методами из карточки. Шапка — «по времени, со слов аналитика».
  'det-y-short': { fx: 'det', format: 'mmd', turns: 3, truth: {}, order: [1, 2, 3, 4, 5, 6], known: true, confirm: true, said: [['участник', 'Участник', 'разн']] },
  // В4: шаблон отчёта скилла даёт «участники — все разные» — годится наравне с именем «планшет группы» или INT-4.
  'id-q-mmd': { fx: 'id', format: 'mmd', turns: 3, truth: {}, order: [6, 1, 2, 3, 4, 5], known: true, said: [['планшет группы', 'INT-4', 'участник', 'Участник', 'разн']] },
  'chain-q-mmd': { fx: 'chain', format: 'mmd', turns: 3, truth: { borders: TRUTH.chain }, order: [1, 5, 2, 4, 3], known: true, said: [['INT-3']] },
  'chain-q-idk': { fx: 'chain', format: 'mmd', turns: 3, truth: { skip: [3] }, order: [1, 2, 4, 5], known: false, said: null },
  'ring-q-one': { fx: 'ring', format: 'puml', turns: 3, truth: { same: { 'бэкенд возвратов': 'returns-api' }, skip: [11] }, order: [1, 2, 3, 4, 5, 9, 6, 7, 8, 10], known: true, said: [['бэкенд возвратов', 'INT-10']] },
  'ring-q-two': { fx: 'ring', format: 'puml', turns: 3, truth: { skip: [11] }, order: [1, 2, 3, 4, 5, 9, 6, 7, 8, 10], known: true, said: [['бэкенд возвратов', 'INT-10']] },
  'rep-q-mmd': { fx: 'rep', format: 'mmd', turns: 3, truth: { borders: { 9: '1С → repairy-api' }, same: { YooKassa: 'ЮKassa' } }, order: [1, 2, 3, 7, 4, 5, 6, 8, 9], known: true, said: [['INT-9'], ['YooKassa', 'INT-8']] },
};
// Сценарная (этап С, скилл 4.1.0, `reference/scenario.md`): истина по пробам, руками по спеке PRK-9 и репликам
// `s-turn2.txt` (А), `s-alt-turn2.txt` (Б), `idk-turn2.txt`. Сценарии по порядку, в каждом — строки по порядку:
// ['u', n] — стрелка пользователя с текстом «Триггера» карточки n к первой стороне её первого звена;
// ['r', n, j] — запрос звена j карточки n (j с 1, по умолчанию 1); ['a', n, j] — пунктирный ответ на него;
// ['q', n, j] — пометка тела запроса или события (сразу после запроса звена j, над его получателем; j по умолчанию 1);
// ['p', n, j] — пометка тела ответа (сразу после ответа на звено j, над его получателем; j по умолчанию 1);
// ['s', кто, слово] — внутренний шаг: стрелка стороны на себя, в тексте — слово.
// Вложенная карточка — между запросом и ответом внешней; остальные — друг за другом, каждая после ответа
// предыдущей. Тела — `bodies(spec)` по определению `reference/scenario.md` (`fieldsOf`).
const SCEN_A = [
  [['u', 1], ['r', 1], ['q', 1], ['s', 'parking-api', 'сессии'], ['r', 3], ['a', 3], ['p', 3], ['r', 4], ['a', 4], ['a', 1], ['p', 1], ['r', 2], ['q', 2]],
  [['u', 5], ['r', 5, 1], ['r', 5, 2], ['a', 5, 2], ['a', 5, 1], ['p', 5]],
  [['r', 6], ['q', 6], ['a', 6]],
];
const SCEN_B = [
  [['u', 1], ['r', 1], ['q', 1], ['r', 3], ['a', 3], ['p', 3], ['a', 1], ['p', 1], ['r', 4], ['a', 4], ['r', 2], ['q', 2]],
  [['u', 5], ['r', 5, 1], ['r', 5, 2], ['a', 5, 2], ['a', 5, 1], ['p', 5], ['r', 6], ['q', 6], ['a', 6]],
];
// «Не знаю.»: по карточке на сценарий по номерам, без пользователя и шагов; цепочка INT-5 без знака в скобках — два звена.
const SCEN_IDK = [
  [['r', 1], ['q', 1], ['a', 1], ['p', 1]],
  [['r', 2], ['q', 2]],
  [['r', 3], ['a', 3], ['p', 3]],
  [['r', 4], ['a', 4]],
  [['r', 5, 1], ['r', 5, 2], ['a', 5, 2], ['a', 5, 1], ['p', 5]],
  [['r', 6], ['q', 6], ['a', 6]],
];
// REP-214 по реплике `ID-REP/s-turn2.txt`: YooKassa = ЮKassa, INT-9 — 1С → repairy-api, четыре сценария, шагов нет.
// ['u', n, текст] — стрелка пользователя с текстом из реплики: у INT-8 «Триггер» длиннее (эндпоинт в скобках), годится и
// он целиком — сверка «текст стрелки содержит текст реплики». INT-3 (`↔`) — одна двусторонняя без ответа; INT-4 (`←`) —
// от ЮKassa к repairy-api, ответ обратно, внутри — INT-5 и событие INT-6; INT-9 — `→`, ответ есть, тел нет.
const SCEN_REP = [
  [['u', 1, 'заказчик нажимает «Оплатить этап» на принятом акте приёмки'], ['r', 1], ['q', 1], ['r', 2], ['q', 2], ['a', 2], ['p', 2], ['a', 1], ['p', 1],
    ['r', 3], ['r', 7], ['a', 7], ['p', 7]],
  [['r', 4], ['q', 4], ['r', 5], ['a', 5], ['r', 6], ['q', 6], ['a', 4]],
  [['u', 8, 'владелец компании нажимает «Вернуть» у оплаченного онлайн-платежа'], ['r', 8], ['q', 8], ['a', 8], ['p', 8]],
  [['r', 9], ['a', 9]],
];
// Тело по определению `reference/scenario.md` читается двояко — пометка годится и есть, и нет. Ключ — пометка (`q` запроса,
// `p` ответа), значение — варианты текста пометки, если она есть: годится, если в ней все подстроки хотя бы одного варианта.
// INT-5 запрос «ключ `projects/…`, `Content-Type: …`»: заголовок — не тело, а «ключ» — параметр-поле или путь объекта;
// INT-5 ответ «ETag объекта»: имя поля без кавычек или заголовок ответа.
const MAYBE_REP = { q5: [['ключ'], ['key'], ['projects/']], p5: [['etag']] };
// ESS-31 (ID-CHB) по репликам `s-turn2.txt` и `idk-turn2.txt`: три сценария, шагов нет. INT-1 — четыре участника, тела
// описаны при среднем звене (`school-api` → `essay-checker`): пометка запроса после запроса звена 2 над essay-checker,
// пометка ответа после ответа звена 2 над school-api; у звеньев 1 и 3 пометок нет. INT-2 — тела в полях шаблона без
// метода и сторон: по реплике — звено 2 (`school-api` → `plagiarism-check`), на «не знаю» — без пометок. INT-3 — контроль `A → B`.
const SCEN_CHB = [
  [['u', 1], ['r', 1, 1], ['r', 1, 2], ['q', 1, 2], ['r', 1, 3], ['a', 1, 3], ['a', 1, 2], ['p', 1, 2], ['a', 1, 1]],
  [['u', 2], ['r', 2, 1], ['r', 2, 2], ['q', 2, 2], ['a', 2, 2], ['p', 2, 2], ['a', 2, 1]],
  [['r', 3], ['q', 3], ['a', 3], ['p', 3]],
];
const SCEN_CHB_IDK = [SCEN_CHB[0], SCEN_CHB[1].filter((x) => x[0] !== 'q' && x[0] !== 'p'), SCEN_CHB[2]];
// Тела звеньев, которых `bodies` не видит (поле «Контракт (по звеньям)» — не поле шаблона): номер карточки → звено → тела.
const CHB_AT = { 1: { 2: { req: ['essayText', 'gradeLevel'], ans: ['score'] } } };
// Вопрос о звене тела: карточка и имена её полей — строка с номером и словом «тело» или именем поля, `?` в ней или следующей.
const CHB_ASK = { n: 2, fields: ['language', 'threshold', 'similarity', 'matches'] };
const CHB_EXTRA = { n: 1, fields: ['essayText', 'gradeLevel', 'score'] };
// Пробы сценарной, ключ — имя папки. `known` — аналитик ответил о сценариях (фраза шапки, Ш1). `truth` — как в `STAGE`
// (граница из ответа, склейка имён); `maybe` — пометки, которые годятся и есть, и нет; `dyn` — истина из гипотезы хода 2.
// `at` — тела по звеньям поверх `bodies`; `over` — С5 сверяет, над кем пометка; `askBody` — В1 требует вопроса о звене тела
// этой карточки; `extraBody` — диагностика вопроса о звене тела, которого задавать не нужно; `opt` — отсутствие пробы в
// раунде итог не красит.
const SCEN = {
  'det-s-mmd': { fx: 'det', format: 'mmd', turns: 3, scen: SCEN_A, known: true },
  'det-s-puml': { fx: 'det', format: 'puml', turns: 3, scen: SCEN_A, known: true },
  'det-s-alt': { fx: 'det', format: 'mmd', turns: 3, scen: SCEN_B, known: true },
  'det-s-idk': { fx: 'det', format: 'mmd', turns: 3, scen: SCEN_IDK, known: false },
  'det-y-scen': { fx: 'det', format: 'mmd', turns: 3, scen: null, dyn: true, known: true },
  'rep-s-mmd': { fx: 'rep', format: 'mmd', turns: 3, scen: SCEN_REP, known: true, truth: { borders: { 9: '1С → repairy-api' }, same: { YooKassa: 'ЮKassa' } }, maybe: MAYBE_REP },
  'chb-s-mmd': { fx: 'chb', format: 'mmd', turns: 3, scen: SCEN_CHB, known: true, at: CHB_AT, over: true, askBody: CHB_ASK, extraBody: CHB_EXTRA, opt: true },
  'chb-s-idk': { fx: 'chb', format: 'mmd', turns: 3, scen: SCEN_CHB_IDK, known: true, at: CHB_AT, over: true, askBody: CHB_ASK, extraBody: CHB_EXTRA, opt: true },
};
// Правило гипотезы сценариев (Step 3 скилла) для диагностики `det-y-scen`: карточки, чей «Триггер» — действие человека,
// руками по спеке; номер другой карточки в «Триггере» — внутри неё; остальные — без пользователя, каждая своим сценарием.
const PERSON = { det: [1, 5] };
// Прежние редакции спек фикстур, новые правки — первыми: [строка сейчас, строка до правки]. Прогон, засеянный до правки,
// несёт прежний текст — И0 его правкой не считает (перегрейд старых раундов).
const SPEC_PAST = {
  det: [['- **Контракт (ответ):** `parking-web` получает от `parking-api` `{ amount, status: "paid" }`; тело ответа `billing` для `parking-api` в спеке не описано',
    '- **Контракт (ответ):** `{ amount, status: "paid" }`']],
};
/** И0: спека прогона — текст фикстуры сейчас или до одной из правок `SPEC_PAST`. */
export const specUntouched = (got, spec, fx) => {
  if (got == null) return false;
  let v = spec;
  if (got === v) return true;
  for (const [now, was] of SPEC_PAST[fx] ?? []) { v = v.replace(now, was); if (got === v) return true; }
  return false;
};
// Пороги раунда, в процентах от прогонов без сбоя API (при 20 прогонах в паре: 80% — 16/20, 75% — 15/20, 90% — 18/20,
// 70% — 14/20). Короткая — критерии приёмки этапа К (`PLAN-ID-SCENARIO.md` §9), сценарная — §10.
const GATES = { short: { asked: 85, core: 80, order: 80, names: 75, solo: 90 }, scen: { asked: 90, core: 70, pair: 70 } };
const PAIRS = { order: ['det-o-one', 'det-o-two'], names: ['ring-q-one', 'ring-q-two'], solo: ['det-o-one', 'det-o-two'], scen: ['det-s-mmd', 'det-s-alt'] };
/** Истина подробной для пробы: строка `DETAIL` фикстуры и стороны ответа цепочки из реплики аналитика. */
const detailOf = (fx, q = null) => ({ ...DETAIL[fx], back: q?.truth.back ?? {} });

/** Карточки `### INT-N. …`: граница, событие ли, путь из «Контракт (запрос|событие)» / «Контракт», триггер. */
export function parseCards(spec) {
  const lines = spec.split('\n');
  const cards = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^###\s+INT-(\d+)\./);
    if (!m) continue;
    let border = null;
    let contract = '';
    let trigger = null;
    let inContract = false; // подпункты с отступом под строкой «Контракт…» — тоже контракт
    for (let j = i + 1; j < lines.length && !/^###?\s/.test(lines[j]); j += 1) {
      const b = lines[j].match(/\*\*Граница\/направление:\*\*\s*(.*)$/);
      if (b) border = b[1];
      const t = lines[j].match(/^- \*\*Триггер:\*\*\s*(.*)$/);
      if (t) trigger = t[1];
      const c = lines[j].match(/^- \*\*Контракт(?: \((?!ответ)[^)]*\))?:\*\*\s*(.*)$/);
      if (c) { contract += ` ${c[1]}`; inContract = true; } else if (inContract && /^\s+\S/.test(lines[j])) contract += ` ${lines[j]}`;
      else inContract = false;
    }
    const paths = [...contract.replace(/`/g, '').matchAll(new RegExp(PATH_RE, 'g'))].map((pm) => [pm[1], pm[2]]);
    cards.push({ n: Number(m[1]), border, event: /^\s*событие:/i.test(border ?? ''), path: paths[0] ?? null, paths, hops: hops(border), trigger });
  }
  return cards;
}

/**
 * Звенья границы `[{ a, b, sign }]`: без «событие:» и обратных кавычек; пояснения в скобках убраны
 * целиком (стрелка внутри скобок — не звено); имя — до первой « (», без точки на конце.
 */
export function hops(border) {
  if (!border || !SIGNS.some((s) => border.includes(s))) return null;
  let s = border.replace(/^\s*событие:\s*/i, '').replace(/`/g, '');
  for (let prev = null; prev !== s;) { prev = s; s = s.replace(/\s*\([^()]*\)/g, ''); }
  const parts = s.split(/([↔←→])/);
  const name = (x) => x.split(' (')[0].trim().replace(/\.$/, '');
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    const [a, b] = [name(parts[i - 1]), name(parts[i + 1])];
    if (!a || !b) return null;
    out.push({ a, b, sign: parts[i] });
  }
  return out.length ? out : null;
}

const namesOf = (h) => (h ? [...new Set(h.flatMap((x) => [x.a, x.b]))] : null);

/** Стороны границы по порядку первого появления. */
export const sides = (border) => namesOf(hops(border));

/** Стороны всех карточек со знаком направления — участники схемы, по порядку первого появления в карточках. */
export const sidesOf = (cards) => [...new Set(cards.flatMap((c) => namesOf(c.hops) ?? []))];

/**
 * Карточки, о которых скилл 4.0.0 спрашивает отдельно, — по ТЕКСТУ границы фикстуры: «цепочка» — два и больше знаков
 * направления (в скобках тоже в счёт: так условие записано в скилле), «нет направления» — знака нет. Две стороны в
 * тексте границы без знака здесь не проверяются: у фикстур этапа они названы.
 */
export const cardAsks = (cards) => cards.flatMap((c) => {
  const k = (c.border ?? '').match(/[↔←→]/g)?.length ?? 0;
  return k >= 2 ? [{ id: 'цепочка', n: c.n }] : k === 0 ? [{ id: 'нет направления', n: c.n }] : [];
});

/** Истина для границ, заданных в `TRUTH` (скобки в тексте карточки кривые). */
export const withTruth = (cards, fx) => cards.map((c) => (TRUTH[fx]?.[c.n] ? { ...c, hops: hops(TRUTH[fx][c.n]) } : c));

/**
 * Истина после ответа аналитика: граница карточки из `borders`, затем имена по `same`. Склеенное имя из
 * сторон исчезает — отдельный участник с ним красит И6, стрелка от него — И11; алиасы идут подряд без дырки.
 * Карточка из `skip` — без звеньев: стрелка с её номером красит И3, её стороны, которых нет у других, — И6.
 */
export const withAnswer = (cards, truth) => cards.map((c) => {
  if (truth.skip?.includes(c.n)) return { ...c, hops: null };
  const h = truth.borders?.[c.n] ? hops(truth.borders[c.n]) : c.hops;
  const nm = (x) => truth.same?.[x] ?? x;
  return { ...c, hops: h && h.map((x) => ({ ...x, a: nm(x.a), b: nm(x.b) })) };
});

/**
 * Блок схемы: Mermaid — из ```mermaid в .md, PlantUML — файл целиком. Пометки `note over Sx` — в `notes`. `actor` —
 * участник, как и `participant`, его алиас ещё и в `actors`; в `seq` — стрелки и пометки в порядке файла.
 */
export function parseDiagram(text, format) {
  let body = text;
  if (format === 'mmd') {
    const m = text.match(/```mermaid\n([\s\S]*?)```/);
    if (!m) return null;
    body = m[1];
  } else if (!/@startuml[\s\S]*@enduml/.test(text)) return null;
  const parts = new Map(); // alias → имя
  const actors = new Set();
  const arrows = [];
  const notes = []; // { over: алиас, text }
  const seq = [];
  const other = [];
  const arrow = (x) => { arrows.push(x); seq.push(x); };
  for (const raw of body.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith("'") || l.startsWith('%%') || /^@(start|end)uml/.test(l) || l === 'sequenceDiagram') continue;
    const nt = l.match(/^note\s+over\s+(\w+)\s*:\s*(.*)$/i);
    if (nt) { const x = { over: nt[1], text: nt[2].trim(), note: true }; notes.push(x); seq.push(x); continue; }
    let p;
    if (format === 'mmd') {
      p = l.match(/^(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/);
      if (p) { parts.set(p[1], (p[2] ?? p[1]).trim()); if (l.startsWith('actor')) actors.add(p[1]); continue; }
      const a = l.match(/^(\w+)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?(\w+)\s*:\s*(.*)$/);
      if (a) {
        arrow({ from: a[1], to: a[3], dashed: a[2].includes('--'), both: a[2].startsWith('<<'), async: a[2].endsWith(')'), cross: a[2].endsWith('x'), label: a[4] });
        continue;
      }
    } else {
      p = l.match(/^(?:participant|actor)\s+"([^"]+)"\s+as\s+(\w+)$/) || l.match(/^(?:participant|actor)\s+(\S+)$/);
      if (p) { parts.set(p[2] ?? p[1], p[1]); if (l.startsWith('actor')) actors.add(p[2] ?? p[1]); continue; }
      const a = l.match(/^(\w+)\s*(<?-{1,2}>{0,2}(?:x(?=\s))?)\s*(\w+)\s*:\s*(.*)$/); // крест — `-->x`, `->x`
      if (a) {
        const cross = a[2].endsWith('x');
        const both = a[2].startsWith('<') && a[2].endsWith('>');
        const rev = a[2].startsWith('<') && !both; // `A <- B` — то же, что `B -> A`
        arrow({ from: rev ? a[3] : a[1], to: rev ? a[1] : a[3], dashed: a[2].includes('--'), both, async: a[2].endsWith('>>'), cross, label: a[4] });
        continue;
      }
    }
    other.push(l);
  }
  return { parts, actors, arrows, notes, seq, other };
}

const numOf = (s) => Number((s.match(/^INT-(\d+)\b/) ?? [])[1] ?? NaN);
const uniq = (a) => new Set(a).size === a.length;
const eqSet = (a, b) => new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
/** Текст для сверки пометки с полем: без экранирования и обратных кавычек, пробелы схлопнуты. */
const flat = (s) => s.replace(/#59;/g, ';').replace(/#35;/g, '#').replace(/`/g, '').replace(/\s+/g, ' ').trim();
/** Первый запрос карточки — имена сторон [от, к] по первому звену (`←` — наоборот). */
const firstReq = (c) => (c.hops[0].sign === '←' ? [c.hops[0].b, c.hops[0].a] : [c.hops[0].a, c.hops[0].b]);

/** Якоря подробной: ответы, ошибки, пометки триггера. `truth` — строка `DETAIL` фикстуры, в `back` — стороны из ответа. */
function gradeDetail(d, cards, truth) {
  const r = {};
  const drawn = cards.filter((c) => c.hops);
  // Ответ и ошибки идут против первого запроса карточки; у цепочки стороны [от, к] называет аналитик (`back`).
  const back = (a, n) => {
    const c = drawn.find((x) => x.n === n);
    if (!c) return false;
    const [f, t] = truth.back?.[n] ?? firstReq(c).reverse();
    return d.parts.get(a.from) === f && d.parts.get(a.to) === t;
  };
  const ans = d.arrows.filter((a) => a.dashed && !a.cross);
  const an = ans.map((a) => numOf(a.label));
  r['Д3 ответы'] = eqSet(an, truth.answers) && uniq(an)
    && ans.every((a, k) => !a.async && !a.both && back(a, an[k]) && /^INT-\d+\s+·\s+ответ$/.test(a.label.trim()));
  const err = d.arrows.filter((a) => a.cross);
  const en = err.map((a) => numOf(a.label));
  r['Д4 ошибки'] = eqSet(en, Object.keys(truth.errors).map(Number)) && uniq(en) && err.every((a, k) => {
    const m = a.label.trim().match(/^INT-\d+\s+·\s+(.+)$/);
    return !!m && back(a, en[k]) && eqSet(m[1].split(',').map((x) => x.trim()), truth.errors[en[k]]);
  });
  // Карточка без направления не рисуется — и пометки у неё нет. У `↔` «первой» стороны нет: годится любая.
  const trig = drawn.filter((c) => c.trigger != null);
  const nn = d.notes.map((x) => numOf(x.text));
  r['Д5 триггер'] = eqSet(nn, trig.map((c) => c.n)) && uniq(nn) && d.notes.every((x, k) => {
    const c = trig.find((y) => y.n === nn[k]);
    const over = c.hops[0].sign === '↔' ? [c.hops[0].a, c.hops[0].b] : [firstReq(c)[0]];
    const m = x.text.match(/^INT-\d+\s+·\s+(.+)$/);
    return !!m && over.includes(d.parts.get(x.over)) && flat(m[1]) === flat(c.trigger);
  });
  return r;
}

/**
 * Стрелки-запросы против звеньев карточек (И7, И8, И9, И11): j-я стрелка с номером карточки — её j-е звено; стрелка
 * сверх звеньев пропускается — её ловит счёт стрелок. `parts` — алиас → имя участника.
 */
function reqChecks(req, parts, cards) {
  const nums = req.map((a) => numOf(a.label));
  let label = true, kind = true, path = true, dir = true;
  const seen = new Map(); // номер карточки → сколько её стрелок уже встречено (номер звена)
  req.forEach((a, k) => {
    const c = cards.find((x) => x.n === nums[k]);
    const j = seen.get(nums[k]) ?? 0;
    seen.set(nums[k], j + 1);
    const hop = c?.hops?.[j];
    if (!hop) return; // лишняя стрелка — уже красный И3
    const want9 = c.paths[j] ?? null; // методы контракта — звеньям по порядку
    const text = a.label.replace(/#59;/g, ';').replace(/#35;/g, '#').trim();
    const lm = text.match(/^INT-\d+(?:\s+·\s+(.+))?$/);
    if (!lm) label = false;
    const tail = lm?.[1] ?? '';
    if (want9 ? !(tail.includes(want9[0]) && tail.includes(want9[1])) : PATH_RE.test(tail)) path = false;
    const { sign } = hop;
    if (a.dashed || a.cross || a.async !== c.event || a.both !== (sign === '↔')) kind = false;
    const s = [hop.a, hop.b];
    const [f, t] = [parts.get(a.from), parts.get(a.to)];
    if (sign === '→' && !(f === s[0] && t === s[1])) dir = false;
    if (sign === '←' && !(f === s[1] && t === s[0])) dir = false;
    if (sign === '↔' && !((f === s[0] && t === s[1]) || (f === s[1] && t === s[0]))) dir = false;
  });
  return { label, kind, path, dir };
}

/** И12: `<…>` из скелета не осталось (знаки стрелок `<-`, `->` и им подобные — не плейсхолдер). */
const noPlaceholders = (text) => !/<[^>\n]*[а-яa-z][^>\n]*>/i.test(text.replace(/<<-->>|<<->>|<-->|<->|-->>|->>|-->|->|<--|<-/g, ''));

/**
 * `truth` задан — схема подробная: И3–И11 считаются по стрелкам-запросам, сверху Д3–Д5.
 * `order` задан (этап К) — сверху И15: номера карточек на стрелках-запросах в порядке файла, соседние повторы
 * схлопнуты, равны `order`. Звенья цепочки не подряд, лишняя или пропущенная карточка — тоже красный И15.
 */
export function gradeDiagram(text, format, cards, truth = null, order = null) {
  const r = {};
  const d = text == null ? null : parseDiagram(text, format);
  r['И2 синтаксис'] = !!d && d.arrows.length > 0;
  if (!r['И2 синтаксис']) return r;
  // Подробная: ответ (пунктир) и ошибка (крест) отделяются ДО счёта «j-я стрелка карточки = j-е звено».
  const req = truth ? d.arrows.filter((a) => !a.dashed && !a.cross) : d.arrows;
  const want = new Map(cards.filter((c) => c.hops).map((c) => [c.n, c.hops.length]));
  const nums = req.map((a) => numOf(a.label));
  const drawn = new Map();
  nums.forEach((n) => drawn.set(n, (drawn.get(n) ?? 0) + 1));
  r['И3 стрелок с номером = звеньям'] = nums.every((n) => want.has(n)) && [...want].every(([n, k]) => drawn.get(n) === k);
  r['И4 только стрелки карточек'] = nums.every((n) => !Number.isNaN(n)) && !req.some((a) => a.from === a.to);
  r['И5 разметка без лишнего'] = d.other.length === 0 && (!!truth || d.notes.length === 0); // пометка — только в подробной
  const allSides = new Set(cards.flatMap((c) => namesOf(c.hops) ?? []));
  const names = [...d.parts.values()];
  r['И6 участники = стороны'] = names.length > 0 && names.every((nm) => allSides.has(nm)) && new Set(names).size === names.length;
  r['И10 алиасы S1, S2… по порядку'] = [...d.parts.keys()].every((k, j) => k === `S${j + 1}`);
  const { label, kind, path, dir } = reqChecks(req, d.parts, cards);
  r['И7 подпись INT-N [· токен]'] = label;
  r['И8 вид стрелки по границе'] = kind;
  r['И9 путь = карточке'] = path;
  r['И11 направление из границы'] = dir;
  r['И12 без плейсхолдеров'] = noPlaceholders(text);
  if (order) { // стрелка без номера карточки в порядок не идёт — она уже красный И4
    const seq = nums.filter((n) => !Number.isNaN(n)).filter((n, k, a) => n !== a[k - 1]);
    r['И15 порядок карточек по ответу'] = seq.length === order.length && seq.every((n, k) => n === order[k]);
  }
  if (truth) Object.assign(r, gradeDetail(d, cards, truth));
  return r;
}

const FILES = { mmd: 'interaction_diagram.md', puml: 'interaction_diagram.puml' };
const FILES_DET = { mmd: 'interaction_diagram_detailed.md', puml: 'interaction_diagram_detailed.puml' };
/** Путь файла схемы рядом со спекой — по типу и формату. */
export const wantFile = (rel, format, detailed) => rel.replace('technical_specification.md', (detailed ? FILES_DET : FILES)[format]);
/** И1: новый файл один, и это файл нужного типа и формата. */
export const onlyFile = (made, want) => made.length === 1 && made[0] === want;
// `_seeded.sha256` — снимок засева, раннер пишет его с 2026-10-15 (раунды ноута); файлом прогона он не считается.
const JUNK = new Set(['answer.md', 'stream.jsonl', '_seeded.txt', '_seeded.sha256', '_stderr.log', 'answer-02.md']);
/** Служебные файлы пула, в «новые файлы» (И1) не идут: плюс файлы ходов `answer-NN.md`, `stream-NN.jsonl` и метки сбоя API. */
const isJunk = (name) => JUNK.has(name) || /^(answer-\d+\.md|stream-\d+\.jsonl|_api-failure(-turn)?\.txt)$/.test(name);
/** Пул пометил прогон сбоем API (на первом ходу — `_api-failure.txt`, на следующих — `_api-failure-turn.txt`). */
export const apiFailed = (runDir) => ['_api-failure.txt', '_api-failure-turn.txt'].some((f) => existsSync(join(runDir, f)));
/** Ответ последнего хода: `answer-NN.md` с наибольшим номером; ходов не было — `answer.md`. */
export const lastAnswer = (runDir) => {
  const turns = (existsSync(runDir) ? readdirSync(runDir) : []).filter((e) => /^answer-\d+\.md$/.test(e)).sort();
  return read(join(runDir, turns.length ? turns[turns.length - 1] : 'answer.md')) ?? '';
};

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== '.claude') walk(p); } else out.push(relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out;
}

/** Каждый номер без стрелки назван в ответе (INT-1 не засчитывается за INT-11). */
export const namedSkips = (answer, skipped) => {
  const said = new Set(answer.match(/INT-\d+/g) ?? []);
  return skipped.every((k) => said.has(k));
};

/** Строка называет номер карточки (INT-1 не засчитывается за INT-11) или имя дословно (обратные кавычки не в счёт). */
const mentions = (line, tok) => (/^INT-\d+$/.test(tok) ? (line.match(/INT-\d+/g) ?? []).includes(tok) : line.replace(/`/g, '').includes(tok));

/** Вызовы инструментов ведущего в потоке хода: блоки `tool_use` событий `assistant` с пустым `parent_tool_use_id`; битая строка пропускается. */
function leadTools(stream) {
  const out = [];
  for (const line of (stream ?? '').split('\n')) {
    let ev = null;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type !== 'assistant' || ev.parent_tool_use_id != null || !Array.isArray(ev.message?.content)) continue;
    out.push(...ev.message.content.filter((c) => c?.type === 'tool_use'));
  }
  return out;
}

/**
 * Первый ход записал файл схемы: `Write`, `Edit` или `Bash` ведущего (`parent_tool_use_id` пуст), во входе —
 * `interaction_diagram` или `interaction_scenarios`.
 */
const WRITERS = new Set(['Write', 'Edit', 'Bash']);
export const wroteDiagram = (stream) => leadTools(stream).some((c) => WRITERS.has(c.name) && /interaction_(diagram|scenarios)/.test(JSON.stringify(c.input ?? '')));

/**
 * Р1 (скилл 5.0.0): в потоке любого хода (`stream.jsonl`, `stream-NN.jsonl`) ведущий открыл инструментом `Read` файл входа
 * `reference/inputs/spec.md`, файл типа `reference/kinds/<kind>` и файл формата `reference/notation/<mermaid|plantuml>.md` —
 * и ни одного другого файла из этих трёх папок (по одному из папки за прогон).
 */
const REF_DIRS = /reference\/(inputs|kinds|notation)\//;
export function readReference(runDir, kind = 'short.md', format = 'mmd') {
  const want = ['reference/inputs/spec.md', `reference/kinds/${kind}`, `reference/notation/${format === 'puml' ? 'plantuml' : 'mermaid'}.md`];
  const got = (existsSync(runDir) ? readdirSync(runDir) : []).filter((e) => /^stream(-\d+)?\.jsonl$/.test(e))
    .flatMap((f) => leadTools(read(join(runDir, f))).filter((c) => c.name === 'Read' && typeof c.input?.file_path === 'string')
      .map((c) => c.input.file_path.replace(/\\/g, '/')))
    .filter((p) => REF_DIRS.test(p));
  return want.every((w) => got.some((p) => p.endsWith(w))) && got.every((p) => want.some((w) => p.endsWith(w)));
}

/**
 * Часть ответа первого хода с вопросами: всё после последней строки-итога письменной проверки «поводы: …».
 * Сама проверка по построению называет номера карточек и все имена вне таблицы — вопросом она не считается.
 * Строки-итога нет — весь ответ.
 */
export function questions(answer1) {
  const lines = (answer1 ?? '').split('\n');
  // Итог бывает с номером пункта, словом перед ним или жирным: «3. поводы: …», «**Итог:** `поводы: …`», «**поводы**: …».
  const k = lines.findLastIndex((l) => /поводы[*_`]*\s*:/i.test(l) && !l.includes('?'));
  return lines.slice(k + 1).join('\n');
}

/**
 * Поводы фикстуры, которых вопросы первого хода не коснулись. Токен ищется по всей части с вопросами:
 * П1, П2, П4 — номер карточки; П3 — КАЖДОЕ имя стороны вне таблицы (регистр и обратные кавычки не в счёт);
 * П4 — ещё «ответ»/«ошибки» в строке с номером или в соседней непустой (иначе это вопрос про звенья, П1).
 */
export function unasked(answer1, fx) {
  const lines = questions(answer1).split('\n').filter((l) => l.trim());
  const low = lines.join('\n').replace(/`/g, '').toLowerCase();
  return REASONS[fx].filter((p) => {
    if (p.names) return !p.names.every((nm) => low.includes(nm.toLowerCase()));
    const at = lines.flatMap((l, i) => (mentions(l, `INT-${p.n}`) ? [i] : []));
    if (p.id !== 'П4') return at.length === 0;
    return !at.some((i) => [lines[i - 1], lines[i], lines[i + 1]].some((l) => l != null && /ответ|ошиб/i.test(l)));
  }).map((p) => p.id);
}

/** Ответ первого хода — вопросы: есть знак `?` и затронут каждый повод фикстуры. */
export const askedIn = (answer1, fx) => questions(answer1).includes('?') && unasked(answer1, fx).length === 0;

/**
 * Т1 по тексту первого хода (скилл 4.3.0): это вопрос о типе — есть знак `?`, корни «коротк» и «сценар»; и больше
 * ничего — ни строки списка карточек (номер и знак направления), ни вопроса о карточке (номер и `?`). Номер без
 * того и другого («карточки INT-1…INT-6 на месте») — не список и не вопрос (пилот `2026-10-01-t-pilot`). Пусто — в порядке.
 */
const cardLine = (l) => /INT-\d/.test(l) && /[→←↔?]/.test(l);
export const typeMiss = (a1) => [...(a1.includes('?') ? [] : ['знака «?» нет']), ...(/коротк/i.test(a1) ? [] : ['нет «коротк»']),
  ...(/сценар/i.test(a1) ? [] : ['нет «сценар»']), ...(a1.split('\n').some(cardLine) ? ['есть INT-N'] : [])];

/** Т1: поток и ответ хода 1 на месте, файл схемы ходом 1 не записан, текст — `typeMiss`. Пусто — в порядке. */
export function typeTurn(runDir) {
  const stream = read(join(runDir, 'stream.jsonl'));
  const a1 = read(join(runDir, 'answer-01.md'));
  if (stream == null || a1 == null) return ['первого хода нет'];
  return [...(wroteDiagram(stream) ? ['файл схемы записан'] : []), ...typeMiss(a1)];
}

/** Ход вопросов Step 3 — второй: ответ и поток хода 2. */
const qTurn = (runDir) => [read(join(runDir, 'answer-02.md')), read(join(runDir, 'stream-02.jsonl'))];

/** В1: Т1 в порядке; поток и ответ хода 2 на месте, файл схемы ходом 2 не записан, вопрос есть по каждому поводу. */
export function asked(runDir, fx) {
  const [a2, stream] = qTurn(runDir);
  return typeTurn(runDir).length === 0 && stream != null && a2 != null && !wroteDiagram(stream) && askedIn(a2, fx);
}

/**
 * Этап К: вопросы, которых первый ход не задал. «участники» — в части с вопросами названа КАЖДАЯ сторона карточек со
 * знаком направления, как её читает скилл (регистр и обратные кавычки не в счёт); «порядок» — есть слово с корнем
 * «поряд» и номера ВСЕХ карточек спеки (INT-1 не засчитывается за INT-11); вопрос по карточке — в вопросах назван
 * номер каждой карточки из `cardAsks` (цепочка, нет направления). Номер карточки уже требует «порядок», отдельной
 * строгости нет: строка списка называет, о какой карточке не спрошено.
 * `cards` — карточки спеки ДО ответа аналитика (`withTruth`). `[what, root]` — вопрос, который требует номера всех
 * карточек, и корень его слова: у короткой — «порядок», у сценарной — «сценарии».
 */
/** Граница читается двояко: знак направления стоит внутри скобок. Стороны такой карточки в вопросе об участниках не требуются. */
const parenSign = (c) => /\([^)]*[→←↔]/.test((c.border ?? '').replace(/`/g, ''));

export function unaskedStage(answer1, cards, [what, root] = ['порядок', /поряд/i]) {
  const text = questions(answer1);
  const low = text.replace(/`/g, '').toLowerCase();
  const said = new Set(text.match(/INT-\d+/g) ?? []);
  const out = [];
  if (!sidesOf(cards.filter((c) => !parenSign(c))).every((nm) => low.includes(nm.toLowerCase()))) out.push('участники');
  if (!root.test(text) || !cards.every((c) => said.has(`INT-${c.n}`))) out.push(what);
  return [...out, ...cardAsks(cards).filter((p) => !said.has(`INT-${p.n}`)).map((p) => `${p.id} INT-${p.n}`)];
}

/**
 * В1 сценарной: как у короткой, но вместо вопроса о порядке — о сценариях (корень «сценари» и номера всех карточек),
 * и ещё вопрос о внутренних шагах — корень «шаг» (заголовок «Шаг 3» вопросом не считается).
 */
export const unaskedScen = (answer1, cards) => [...unaskedStage(answer1, cards, ['сценарии', /сценари/i]),
  ...(/шаг(?!\s*\d)/i.test(questions(answer1)) ? [] : ['шаги'])];

/**
 * В1: чего не хватило ходам 1 и 2; пусто — спросил. Промахи Т1 — с префиксом «Т1»; ходом 2 файл схемы не пишется,
 * вопросы — со знаком `?`.
 */
export function notAsked(runDir, cards, unasked = unaskedStage) {
  const t1 = typeTurn(runDir).map((x) => `Т1 ${x}`);
  const [a2, stream] = qTurn(runDir);
  if (stream == null || a2 == null) return [...t1, 'второго хода нет'];
  return [...t1, ...(wroteDiagram(stream) ? ['файл схемы записан вторым ходом'] : []), ...(questions(a2).includes('?') ? [] : ['знака «?» нет']), ...unasked(a2, cards)];
}

/**
 * К1: в вопросах хода 2 нет лишнего вопроса о карточке — строки со знаком `?` и ровно одним различным номером
 * карточки, о которой спрашивать не положено. Положено — о карточках из `cardAsks` (цепочка, нет направления); вопрос,
 * один ли это сервис (`sameQuestion`, «„бэкенд возвратов“ в INT-10 — это returns-api?»), — вопрос об участниках, не о карточке.
 */
export function noCardQuestion(answer1, cards) {
  const fair = new Set(cardAsks(cards).map((p) => `INT-${p.n}`));
  return !questions(answer1).split('\n').some((l) => {
    const ns = new Set(l.match(/INT-\d+/g) ?? []);
    return l.includes('?') && ns.size === 1 && !fair.has([...ns][0]) && !sameQuestion(l, cards);
  });
}

/**
 * Вопрос о том, один ли это сервис (вопрос «участники» Step 3), а не о карточке: в строке названа сторона карточек, и
 * спрошено её тождество — «X — это Y?» (после «это» или «=» — сторона карточек или латинское имя), «одним сервисом»,
 * «один из этих сервисов», «другое имя», «под двумя именами», «отдельный участник», «склеить». Регистр и кавычки не в счёт.
 */
export function sameQuestion(line, cards) {
  const low = line.replace(/`/g, '').toLowerCase();
  const all = sidesOf(cards).map((nm) => nm.toLowerCase());
  if (!all.some((nm) => low.includes(nm))) return false;
  const after = low.match(/(?:(?:^|[^а-яё])это|=)\s*[«"„“']?([^\s«»"„“'?,.;:!)]+)/u);
  if (after && (all.some((nm) => nm.startsWith(after[1])) || /^[a-z]/.test(after[1]))) return true;
  return /(?:одн(?:им|ом|ого)?|один)\s+(?:из\s+)?(?:эт[а-яё]*\s+)?сервис|тот же сервис|друг(?:ое|им)\s+им|под двумя именами|отдельн[а-яё]*\s+(?:участник|сервис)|склеи/u.test(low);
}

/**
 * Ш1: фраза о порядке в файле схемы. Порядок известен — «по времени, со слов аналитика»; нет — «по номерам карточек»
 * и без «со слов аналитика». Перенос строки шапки (со знаком `>` или `'` в начале) фразу не рвёт, регистр не в счёт.
 */
export function headOrder(text, known) {
  const t = flatHead(text);
  return known ? t.includes('по времени, со слов аналитика') : t.includes('по номерам карточек') && !t.includes('со слов аналитика');
}
const flatHead = (text) => (text ?? '').replace(/\s*\n[ \t]*[>']?\s*/g, ' ').toLowerCase();

/** Ш1 сценарной: «по сценариям со слов аналитика», если аналитик ответил о сценариях; иначе «по карточке на сценарий» без «со слов аналитика». */
export function headScen(text, known) {
  const t = flatHead(text);
  return known ? t.includes('по сценариям со слов аналитика') : t.includes('по карточке на сценарий') && !t.includes('со слов аналитика');
}

/** В4: строка отчёта начинается с «со слов аналитика» и называет по имени/номеру из каждой группы `said`. */
export const bySaid = (answer, said) => answer.split('\n').some((l) => /^[\s>*_•-]*со слов аналитика/i.test(l)
  && said.every((g) => g.some((tok) => mentions(l, tok))));

/** Стороны карточек, которых нет в строках ТАБЛИЦЫ §1.2 (текст под таблицей не в счёт) — предмет вопроса П3. */
export function notInTable(spec, cards) {
  const m = spec.match(/### 1\.2\.[\s\S]*?(?=\n###? )/);
  const table = (m ? m[0] : '').split('\n').filter((l) => l.startsWith('|')).join('\n').replace(/`/g, '');
  return [...new Set(cards.flatMap((c) => namesOf(c.hops) ?? []))].filter((nm) => !table.includes(nm));
}

const NOT_SERVICES = new Set(['Покупатель', 'планшет группы', 'Браузер заказчика']);

/** Стороны карточек, которых нет в таблице §1.2 (отчёт обязан их назвать). */
export function notInOverview(spec, cards) {
  const m = spec.match(/### 1\.2\.[\s\S]*?(?=\n###? )/);
  const overview = (m ? m[0] : '').replace(/`/g, '');
  const names = [...new Set(cards.flatMap((c) => namesOf(c.hops) ?? []))];
  return names.filter((nm) => !overview.includes(nm));
}

/**
 * `q` — строка `QPROBES`: проба опросника, истина после ответа, отчёт по последнему ходу, сверху В1, В3, В4.
 * `st` — строка `STAGE` (главнее `q`): проба этапа К — истина после ответа, И15 по `order`, сверху Т1, В1, В4, К1, Ш1, Р1;
 * в `miss` — чего не хватило ходам 1 и 2.
 */
export function gradeRun(runDir, format, fx = 'id', detailed = false, q = null, st = null) {
  const FIX = fixDir(fx);
  const SPEC_REL = specRel(fx);
  const fixFiles = new Set(listFiles(FIX));
  const spec = read(join(FIX, SPEC_REL));
  const asIs = withTruth(parseCards(spec), fx); // карточки до ответа аналитика — их читает первый ход
  const cards = st || q ? withAnswer(asIs, (st ?? q).truth) : asIs;
  const answer = st || q ? lastAnswer(runDir) : read(join(runDir, 'answer.md')) ?? '';
  const made = listFiles(runDir).filter((f) => !fixFiles.has(f) && !isJunk(f.split('/').pop()));
  const r = {};
  r['И0 спека не тронута'] = specUntouched(read(join(runDir, SPEC_REL)), spec, fx);
  if (format === 'ask') {
    r['А1 файла схемы нет'] = made.length === 0;
    r['А2 спросил формат'] = /mermaid/i.test(answer) && /plant\s*uml/i.test(answer);
    // Скилл 4.3.0: первым ходом тип спрашивается всегда, и больше ничего в этом ходе нет — текст по Т1 (`typeMiss`).
    r['А3 спросил тип'] = typeMiss(answer).length === 0;
    return { r, made };
  }
  const want = wantFile(SPEC_REL, format, detailed);
  r['И1 файл рядом со спекой, других нет'] = onlyFile(made, want);
  Object.assign(r, gradeDiagram(read(join(runDir, want)), format, cards, detailed ? detailOf(fx, q) : null, st?.order ?? null));
  const skipped = cards.filter((c) => !c.hops).map((c) => `INT-${c.n}`);
  if (skipped.length) r['И13 пропуск назван в отчёте'] = namedSkips(answer, skipped);
  if (st) { // И14 не ставится: скилл 4.0.0 таблицу сервисов не читает. «Схема верна» — якоря И; остальное — отдельный счёт
    const miss = notAsked(runDir, asIs);
    const [a2] = qTurn(runDir);
    r['Т1 первый ход — вопрос о типе'] = typeTurn(runDir).length === 0;
    r['В1 спросил'] = miss.length === 0;
    if (st.said) r['В4 со слов аналитика'] = bySaid(answer, st.said);
    r['К1 лишнего вопроса о карточке нет'] = a2 != null && noCardQuestion(a2, asIs);
    r['Ш1 шапка: порядок'] = headOrder(read(join(runDir, want)), st.known);
    r['Р1 прочитан reference'] = readReference(runDir, 'short.md', format);
    return { r, made, miss };
  }
  if (q) { // И14 не ставится: строку «нет в §1.2» заменил вопрос П3
    r['В1 спросил'] = asked(runDir, fx);
    r['В3 схема по ответу'] = Object.entries(r).every(([k, v]) => v || !/^(И([2-9]|1[0-2])|Д[34]) /.test(k)); // Д3, Д4 — у подробной
    r['В4 со слов аналитика'] = bySaid(answer, q.said);
    return { r, made };
  }
  // Люди и устройства вне §1.2 — законно (скилл их не называет); сервис под другим именем — обязан.
  const foreign = notInOverview(spec, cards).filter((nm) => !NOT_SERVICES.has(nm));
  if (foreign.length) r['И14 сервис не из §1.2 в отчёте'] = foreign.every((nm) => answer.includes(nm));
  return { r, made };
}

// ─── Сценарная схема (этап С) ─────────────────────────────────────────────────────────────────

/**
 * Тела карточек `{ n: { req, ans } }` — имена полей по определению `reference/scenario.md`: из «Контракт (запрос)» /
 * «Контракт (событие)» — `req`, из «Контракт (ответ)» — `ans`; подпункты с отступом под строкой контракта — тоже контракт.
 * Разбор строки — `fieldsOf`; имена сторон карточек телом не бывают.
 */
export function bodies(spec) {
  const out = {};
  const skip = new Set(sidesOf(parseCards(spec)));
  let n = null;
  let cur = null; // { kind, main, subs } — контракт, к которому идут подпункты
  const flush = () => {
    if (!cur) return;
    out[n][cur.kind === 'ответ' ? 'ans' : 'req'] = fieldsOf(cur.main, { event: cur.kind === 'событие', subs: cur.subs, skip });
    cur = null;
  };
  for (const l of spec.split('\n')) {
    const h = l.match(/^###\s+INT-(\d+)\./);
    if (h) { flush(); n = Number(h[1]); out[n] = { req: [], ans: [] }; continue; }
    if (/^###?\s/.test(l)) { flush(); n = null; continue; }
    if (n == null) continue;
    const sub = cur && l.match(/^\s+[-*]\s+(.*)$/);
    if (sub) { cur.subs.push(sub[1]); continue; }
    flush();
    const c = l.match(/^- \*\*Контракт \((запрос|ответ|событие)\):\*\*\s*(.*)$/);
    if (c) cur = { kind: c[1], main: c[2], subs: [] };
  }
  flush();
  return out;
}

/** Скобки — тип, значение, пояснение — снять, со вложенными; скобки внутри обратных кавычек не трогаются. */
function dropParens(s) {
  let out = '';
  let depth = 0;
  let tick = false;
  for (const ch of s) {
    if (depth === 0 && ch === '`') tick = !tick;
    if (!tick && ch === '(') { depth += 1; continue; }
    if (!tick && ch === ')' && depth > 0) { depth -= 1; continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

/** Части строки контракта между `;` вне обратных кавычек. */
const semis = (s) => {
  const out = [''];
  let tick = false;
  for (const ch of s) {
    if (ch === '`') tick = !tick;
    if (ch === ';' && !tick) out.push(''); else out[out.length - 1] += ch;
  }
  return out;
};

// Элемент перечисления: имя в обратных кавычках (за ним могут идти слова-пояснения: «`id` возврата») или латинское имя
// без кавычек; разделитель — запятая, «и», «, и».
const ITEM = '(?:`[^`]+`(?:\\s+(?!и(?:\\s|$))[а-яё]+)*|[A-Za-z_][\\w.-]*)';
const LIST_RE = new RegExp(`^${ITEM}(?:\\s*(?:,\\s*(?:и\\s+)?|\\s+и\\s+)${ITEM})*`, 'u');
const METHOD_TOKEN = /^`?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[^\s`,;]*`?\s*/;

/**
 * Имена полей тела из текста контракта (`main` — строка, `subs` — подпункты) по определению `reference/scenario.md`:
 * 1) фигурные скобки не внутри пути (`/items/{id}` — не тело) — имена до «:»;
 * 2) иначе перечисление через запятую или «и» (или подпунктами) — в начале части строки между `;`, после «тело:», после
 *    метода с путём (и «с»), после имени события (у события — первое имя в кавычках) или после пометки «🟡 … —»; после
 *    перечисления — конец части, запятая, точка, двоеточие или « — пояснение». Скобки после имени — тип, значение,
 *    пояснение — не берутся.
 * Не тело: метод и путь, имя события, код ответа (`200`, `4xx`), заголовок со значением (часть с «заголовок …» перечисления
 * не начинает; `Content-Type: …` — с «:»), пути, имена сторон (`skip`), одно имя внутри фразы («переход по `x`»), TBD.
 */
export function fieldsOf(main, { event = false, subs = [], skip = new Set() } = {}) {
  const whole = [main, ...subs].join('\n').replace(/`/g, '');
  const brace = whole.match(/(?<!\/)\{([^}]*)\}/);
  if (brace) return brace[1].split(',').map((f) => f.split(':')[0].trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  const lead = (seg, first) => {
    let s = seg.trim().replace(/^[^\p{L}`{]*\p{Extended_Pictographic}️?[^—`]*—\s*/u, '');
    s = s.replace(/^(?:предположительно|вероятно)\s+/i, '');
    if (event && first) s = s.replace(/^`[^`]+`\s*/, '');
    s = s.replace(METHOD_TOKEN, '');
    return s.replace(/^[—–:,-]?\s*/, '').replace(/^(?:тело|поля|с полями|с)\s*:?\s+/i, '');
  };
  const listOf = (s) => {
    const m = s.match(LIST_RE);
    if (!m) return [];
    const rest = s.slice(m[0].length);
    if (rest.trim() && !/^\s*[,.:]/.test(rest) && !/^\s+[—–]\s/.test(rest)) return [];
    return [...m[0].matchAll(new RegExp(ITEM, 'gu'))].map((x) => (x[0].startsWith('`') ? x[0].slice(1, x[0].indexOf('`', 1)) : x[0].replace(/\.+$/, '')));
  };
  const parts = [...semis(dropParens(main)).map((s, i) => lead(s, i === 0)), ...subs.map((s) => lead(dropParens(s), false))];
  const names = parts.flatMap(listOf);
  return [...new Set(names)].filter((x) => !/[\s/:={}]/.test(x) && !/^\d/.test(x) && x !== 'TBD' && !skip.has(x));
}

/** Сценарии файла по порядку: Mermaid — блоки ```mermaid, PlantUML — блоки `@startuml` … `@enduml`; каждый — `parseDiagram`. */
export const scenBlocks = (text, format) => (text == null ? [] : format === 'mmd'
  ? [...text.matchAll(/```mermaid\n[\s\S]*?```/g)].map((m) => parseDiagram(m[0], 'mmd'))
  : [...text.matchAll(/@startuml[\s\S]*?@enduml/g)].map((m) => parseDiagram(m[0], 'puml')));

/** Стороны звена j (с 1) по ходу запроса: [от, к]; `A ← B` — от B к A. */
const hopEnds = (c, j) => { const h = c.hops[j - 1]; return h.sign === '←' ? [h.b, h.a] : [h.a, h.b]; };

/** Ключ пометки: `q5` / `p5` — звено 1 (как до тел по звеньям), `q1.2` / `p1.2` — звено 2 и дальше. */
const noteKey = (k, n, j) => (j === 1 ? `${k}${n}` : `${k}${n}.${j}`);

/** Тела карточки `{ n: { req, ans } }` с телами звеньев `at` (`{ n: { j: { req, ans } } }`) поверх. */
const withAt = (body, at = {}) => Object.fromEntries(Object.entries(body).map(([n, x]) => [n, at[n] ? { ...x, at: at[n] } : x]));

/** Поля пометки по её ключу: тела звена из `at`, иначе тела карточки (`req` у `q`, `ans` у `p`). */
const bodyOf = (body, key, n) => {
  const m = key.match(/^([qp])\d+(?:\.(\d+))?$/);
  if (!m) return [];
  const kind = m[1] === 'q' ? 'req' : 'ans';
  return body[n]?.at?.[Number(m[2] ?? 1)]?.[kind] ?? body[n]?.[kind] ?? [];
};

/**
 * Строки истины сценария (`SCEN_*`) → события: у запроса и ответа — ключ `r5.2` / `a5.2` и стороны [от, к]. У стрелки
 * пользователя `['u', n, текст, …]` — текст (по умолчанию «Триггер» карточки n) и `texts`: годится любой, содержащий хоть один.
 */
export function scenTruth(rows, cards) {
  return rows.map((row) => {
    const [k, n, j = 1] = row;
    if (k === 's') return { cls: 'step', who: row[1], word: row[2] };
    const c = cards.find((x) => x.n === n);
    if (k === 'u') return { cls: 'user', to: hopEnds(c, 1)[0], trigger: row[2] ?? c.trigger, texts: row.length > 2 ? row.slice(2) : [c.trigger] };
    if (k === 'r') return { cls: 'req', key: `r${n}.${j}`, n, ends: hopEnds(c, j), both: c.hops[j - 1].sign === '↔', event: c.event };
    if (k === 'a') return { cls: 'ans', key: `a${n}.${j}`, n, ends: hopEnds(c, j).reverse() };
    return { cls: 'note', key: noteKey(k, n, j), n, over: k === 'q' ? hopEnds(c, j)[1] : hopEnds(c, j)[0] };
  });
}

/**
 * События сценария из файла, по порядку. Стрелка от `actor` — действие пользователя; стрелка стороны на себя — шаг;
 * пунктир — ответ (звено — то, чьи стороны он повторяет в обратную сторону); остальное — запрос (j-я стрелка
 * карточки — её j-е звено). У пометки ключ — по стрелке прямо перед ней: `q5` после запроса звена 1 карточки 5,
 * `p5` после ответа на него, `q1.2` / `p1.2` — после запроса / ответа звена 2 карточки 1 (`noteKey`); иначе `x`.
 */
function scenEvents(d, cards) {
  const name = (al) => d.parts.get(al);
  const seen = new Map();
  const ev = [];
  for (const x of d.seq) {
    const prev = ev[ev.length - 1];
    if (x.note) {
      const hop = /^[ra]/.test(prev?.key ?? '') ? Number(prev.key.split('.')[1]) : NaN; // у ответа без звена — `a5.?`
      const key = prev?.cls === 'req' && hop > 0 ? noteKey('q', prev.n, hop) : prev?.cls === 'ans' && hop > 0 ? noteKey('p', prev.n, hop) : 'x';
      ev.push({ cls: 'note', key, n: prev?.n, over: name(x.over), text: flat(x.text) });
    } else if (d.actors.has(x.from)) ev.push({ cls: 'user', a: x, to: name(x.to), text: x.label });
    else if (x.from === x.to) ev.push({ cls: 'step', a: x, who: name(x.from), text: x.label });
    else {
      const n = numOf(x.label.trim());
      const c = cards.find((y) => y.n === n);
      const ends = [name(x.from), name(x.to)];
      if (x.dashed && !x.cross) {
        const j = (c?.hops ?? []).findIndex((h, i) => { const [f, t] = hopEnds(c, i + 1); return f === ends[1] && t === ends[0]; }) + 1;
        ev.push({ cls: 'ans', a: x, key: `a${n}.${j || '?'}`, n, ends });
      } else {
        const j = (seen.get(n) ?? 0) + 1;
        seen.set(n, j);
        ev.push({ cls: 'req', a: x, key: `r${n}.${j}`, n, ends });
      }
    }
  }
  return ev;
}

/** Текст для сверки с «Триггером»: без кавычек любого вида и многоточий, пробелы схлопнуты, без регистра. */
const bare = (s) => flat(s ?? '').replace(/[«»"'„“”]/g, '').replace(/\.{3}|…/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Место шага: ключи соседних стрелок, не шагов (пометки не в счёт); `^` / `$` — края сценария. */
const stepPlaces = (ev) => ev.flatMap((e, i) => {
  if (e.cls !== 'step') return [];
  const arrowKey = (x) => (x.cls === 'user' ? 'u' : x.key);
  const before = ev.slice(0, i).filter((x) => x.cls !== 'note' && x.cls !== 'step').pop();
  const after = ev.slice(i + 1).find((x) => x.cls !== 'note' && x.cls !== 'step');
  return [{ who: e.who, text: e.text ?? '', word: e.word, at: `${before ? arrowKey(before) : '^'}|${after ? arrowKey(after) : '$'}` }];
});

/**
 * Якоря сценарной по тексту файла. `scen` — истина пробы (`SCEN_*`), `body` — `bodies(spec)`. Сценарии файла
 * сверяются с истиной по порядку; С3–С7 и И5–И10 — по каждой паре, красный в одной паре — красный якорь.
 * С3 — запросы (номер, звено, стороны) по порядку; С4 — ответы: вид, подпись, стороны и место в общей
 * последовательности запросов и ответов (переставленные запросы красят и его); С5 — пометки тел: ровно где тело
 * есть, сразу после своей стрелки, текст — все поля; С6 — шаги: сторона, место между стрелками, слово;
 * С7 — пользователь: `actor` ровно там, где сценарий начинает человек, первая стрелка — от него к первой стороне
 * первого запроса, в тексте — «Триггер» (или текст из строки истины `['u', n, текст, …]`).
 * `maybe` — пометки, которые годятся и есть, и нет (`MAYBE_REP`): есть — непустая, с подстроками одного из вариантов.
 * `over` — С5 сверяет ещё, над кем пометка истины (получатель запроса или ответа своего звена).
 */
export function gradeScenarios(text, format, cards, scen, body, maybe = {}, { over = false } = {}) {
  const r = {};
  const blocks = scenBlocks(text, format);
  r['И2 синтаксис'] = blocks.length > 0 && blocks.every((d) => !!d && d.arrows.length > 0);
  if (!r['И2 синтаксис']) return r;
  r['С2 сценариев = истине'] = blocks.length === scen.length;
  const ok = { С3: true, С4: true, С5: true, С6: true, С7: true, И5: true, И6: true, И7: true, И8: true, И9: true, И10: true };
  blocks.slice(0, scen.length).forEach((d, i) => {
    const T = scenTruth(scen[i], cards);
    const F = scenEvents(d, cards);
    const pick = (ev, cls) => ev.filter((e) => e.cls === cls);
    const reqKey = (e) => `${e.key}:${e.both ? [...e.ends].sort().join('~') : e.ends.join('>')}`;
    const fileReq = pick(F, 'req').map((e) => reqKey({ ...e, both: e.a.both }));
    if (fileReq.join() !== pick(T, 'req').map(reqKey).join()) ok.С3 = false;
    const flow = (ev) => ev.filter((e) => e.cls === 'req' || e.cls === 'ans').map((e) => e.key).join();
    if (flow(F) !== flow(T) || !pick(F, 'ans').every((e) => !e.a.async && !e.a.both && /^INT-\d+\s+·\s+ответ$/.test(flat(e.a.label)))) ok.С4 = false;
    // Пометки файла = пометки истины плюс, может быть, по одной из `maybe`; у пометки истины — все поля тела.
    const extra = pick(F, 'note').map((e) => e.key);
    const lost = pick(T, 'note').filter((e) => { const i = extra.indexOf(e.key); if (i < 0) return true; extra.splice(i, 1); return false; });
    const must = new Set(pick(T, 'note').map((e) => e.key));
    const overOf = new Map(pick(T, 'note').map((e) => [e.key, e.over]));
    if (lost.length || !uniq(extra) || !extra.every((k) => maybe[k]) || !pick(F, 'note').every((e) => {
      const low = e.text.toLowerCase();
      if (!must.has(e.key)) return !!low.trim() && maybe[e.key].some((alt) => alt.every((s) => low.includes(s.toLowerCase())));
      if (over && e.over !== overOf.get(e.key)) return false;
      // Имя через точку (`amount.value`) годится как написано и свёрнутым до верхнего уровня (`amount`), в том числе вперемешку.
      const fields = bodyOf(body, e.key, e.n);
      return fields.every((f) => low.includes(f.toLowerCase()) || (f.includes('.') && low.includes(f.split('.')[0].toLowerCase())));
    })) ok.С5 = false;
    const [fs, ts] = [stepPlaces(F), stepPlaces(T)];
    if (fs.length !== ts.length || !fs.every((s, k) => s.who === ts[k].who && s.at === ts[k].at && bare(s.text).includes(ts[k].word))) ok.С6 = false;
    const user = T[0].cls === 'user';
    const firstArrow = F.find((e) => e.cls !== 'note');
    if (user ? !(d.actors.size === 1 && pick(F, 'user').length === 1 && firstArrow?.cls === 'user' && firstArrow.to === T[0].to
      && T[0].texts.some((t) => bare(firstArrow.text).includes(bare(t)))) : d.actors.size > 0 || pick(F, 'user').length > 0) ok.С7 = false;
    if (d.other.some((l) => !/^title\s/.test(l))) ok.И5 = false;
    const sides = new Set(T.flatMap((e) => (e.cls === 'req' ? e.ends : [])));
    const own = [...d.parts].filter(([al]) => !d.actors.has(al));
    const names = own.map(([, nm]) => nm);
    if (!(names.length > 0 && names.every((nm) => sides.has(nm)) && new Set(names).size === names.length)) ok.И6 = false;
    if (!own.every(([al], j) => al === `S${j + 1}`)) ok.И10 = false;
    const { label, kind, path } = reqChecks(pick(F, 'req').map((e) => e.a), d.parts, cards);
    if (!label) ok.И7 = false;
    if (!kind) ok.И8 = false;
    if (!path) ok.И9 = false;
  });
  r['С3 запросы по сценарию'] = ok.С3;
  r['С4 ответы и их место'] = ok.С4;
  r['С5 пометки тел'] = ok.С5;
  r['С6 внутренние шаги'] = ok.С6;
  r['С7 пользователь'] = ok.С7;
  r['И5 разметка без лишнего'] = ok.И5;
  r['И6 участники = стороны сценария'] = ok.И6;
  r['И7 подпись INT-N [· токен]'] = ok.И7;
  r['И8 вид стрелки по границе'] = ok.И8;
  r['И9 путь = карточке'] = ok.И9;
  r['И10 алиасы S1, S2… по порядку'] = ok.И10;
  r['И12 без плейсхолдеров'] = noPlaceholders(text);
  return r;
}

// ─── Гипотеза сценариев хода 2: динамическая истина `det-y-scen` ─────────────────────────────────────────────
//
// Структура сценария — `{ user, quote, top: [узел] }`, узел — `{ n, kids: [узел] }`: `top` — карточки ряда по порядку,
// `kids` — вложенные («внутри»). Подпись для отчёта: `u1[3,4]>2 | u5 | 6` — `u` — сценарий пользователя.

const CAP = 64; // предел числа прочтений: гипотеза, которая читается больше чем 64 способами, — уже не гипотеза
const sigNode = (x) => `${x.n}${x.kids.length ? `[${x.kids.map(sigNode).join(',')}]` : ''}`;
const sigScen = (s) => `${s.user ? 'u' : ''}${s.top.map(sigNode).join('>')}`;
export const sigAll = (ss) => ss.map(sigScen).join(' | ');
/** Подпись без порядка сценариев и вложенных — для сверки с правилом триггеров. */
const sigLoose = (ss) => {
  const node = (x) => `${x.n}${x.kids.length ? `[${x.kids.map(node).sort().join(',')}]` : ''}`;
  return ss.map((s) => `${s.user ? 'u' : ''}${s.top.map(node).join('>')}`).sort().join(' | ');
};
const product = (lists) => lists.reduce((acc, xs) => acc.flatMap((a) => xs.map((x) => [...a, x])).slice(0, CAP), [[]]);

/**
 * Блок гипотезы в ответе хода 2: со строки со «сценари», за которой (в ней или в двух следующих) идут пункты «N)» или
 * «Сценарий N», — до «Верно?», «Если нет», пустой строки после первого номера карточки или следующего вопроса «N.».
 */
export function hypoBlock(a2) {
  const lines = (a2 ?? '').split('\n');
  const item = /(?:^|[\s;.,(*])\d{1,2}\)\s|Сценарий\s+\d/;
  const start = lines.findIndex((l, i) => /сценари/i.test(l) && !/триггер:/.test(l) && lines.slice(i, i + 3).some((x) => item.test(x)));
  if (start < 0) return null;
  const out = [];
  for (let i = start; i < lines.length; i += 1) {
    const l = lines[i];
    if (i > start && /^\s*(?:\*\*)?\d+\.\s/.test(l)) break;
    if (i > start && !l.trim() && out.some((x) => /INT-\d/.test(x))) break;
    const cut = l.search(/Верно\?|Если нет/);
    if (cut >= 0) { out.push(l.slice(0, cut)); break; }
    out.push(l);
  }
  return out.join('\n');
}

/** Текст в первых кавычках «…» (вложенные «» учтены) или "…"; кавычек нет — null. */
function firstQuote(s) {
  const i = s.indexOf('«');
  if (i >= 0) {
    let depth = 0;
    for (let j = i; j < s.length; j += 1) {
      if (s[j] === '«') depth += 1;
      if (s[j] === '»') { depth -= 1; if (depth === 0) return s.slice(i + 1, j); }
    }
    return s.slice(i + 1);
  }
  return s.match(/["“]([^"”]+)["”]/)?.[1] ?? null;
}

/**
 * Карточки одного пункта гипотезы → прочтения `top`. Слова: «внутри него» — дальше вложенные в последнюю названную
 * карточку; «внутри INT-N» и за ним ещё номера (или «до ответа INT-N») — вложенные в INT-N; «внутри INT-N» без номеров
 * после — INT-N вложена в текущую карточку; «затем», «потом», «далее» после вложенных — двояко: ещё внутри или уже в
 * ряду; «внутри него» второй раз, когда последняя названная сама вложена, — двояко: в неё или в ту же внешнюю;
 * «после ответа» — в ряд.
 */
export function readItem(text) {
  const TOK = /INT-(\d+)|(?<![а-яё])(?:внутри(\s+(?:него|неё|нее|его))?|до\s+(?:(?:его|её|ее)\s+)?ответа(?:\s+INT-(\d+))?|после\s+(?:(?:его|её|ее)\s+)?ответа(?:\s+INT-\d+)?|(?:затем|потом|далее)(?![а-яё]))/giu;
  const raw = [...text.matchAll(TOK)].map((m) => {
    const w = m[0].toLowerCase();
    if (m[1]) return { t: 'int', n: Number(m[1]) };
    if (w.startsWith('внутри')) return { t: m[2] ? 'inPron' : 'inBare' };
    if (w.startsWith('до')) return { t: 'pre', n: m[3] ? Number(m[3]) : null };
    if (w.startsWith('после')) return { t: 'post' };
    return { t: 'then' };
  });
  const toks = []; // «внутри INT-N»: контейнер, если за INT-N ещё номер; иначе INT-N вложена
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i].t === 'inBare' && raw[i + 1]?.t === 'int') {
      toks.push({ t: raw[i + 2]?.t === 'int' ? 'inN' : 'nest', n: raw[i + 1].n });
      i += 1;
    } else if (raw[i].t !== 'inBare') toks.push(raw[i]);
  }
  const at = (top, p) => p.slice(1).reduce((x, k) => x.kids[k], top[p[0]]);
  const find = (top, n, p = []) => {
    const xs = p.length ? at(top, p).kids : top;
    for (let k = 0; k < xs.length; k += 1) {
      const q = [...p, k];
      if (xs[k].n === n) return q;
      const deep = find(top, n, q);
      if (deep) return deep;
    }
    return null;
  };
  const add = (s, parent, n) => {
    if (!parent) { s.top.push({ n, kids: [] }); return [s.top.length - 1]; }
    const x = at(s.top, parent);
    x.kids.push({ n, kids: [] });
    return [...parent, x.kids.length - 1];
  };
  const same = (a, b) => a && b && a.join() === b.join();
  const clone = (s) => JSON.parse(JSON.stringify(s));
  let states = [{ top: [], cont: null, last: null }];
  for (const tk of toks) {
    const next = [];
    for (const s of states) {
      if (tk.t === 'int') { s.last = add(s, s.cont, tk.n); next.push(s); continue; }
      if (tk.t === 'post') { s.cont = null; s.pre = false; next.push(s); continue; }
      if (tk.t === 'pre' || tk.t === 'inN') {
        const p = tk.n == null ? (s.top.length ? [s.top.length - 1] : null) : find(s.top, tk.n) ?? add(s, null, tk.n);
        s.cont = p;
        s.pre = tk.t === 'pre'; // «до ответа INT-N … потом …» — внутри, пока не сказано «после ответа»
        next.push(s);
        continue;
      }
      if (tk.t === 'then') {
        if (s.cont && !s.pre) { const y = clone(s); y.cont = null; next.push(s, y); } else next.push(s);
        continue;
      }
      s.pre = false;
      // «внутри него», «внутри INT-N» без номеров после: вложить в последнюю названную или в текущую внешнюю
      const into = [...new Set([JSON.stringify(s.last), ...(s.cont && !same(s.cont, s.last) ? [JSON.stringify(s.cont)] : [])])].map((x) => JSON.parse(x)).filter(Boolean);
      for (const p of into.length ? into : [null]) {
        const y = into.length > 1 ? clone(s) : s;
        if (tk.t === 'inPron') y.cont = p;
        else { y.last = add(y, p ?? (y.top.length ? [y.top.length - 1] : null), tk.n); y.cont = p ?? (y.top.length ? [y.top.length - 1] : null); }
        next.push(y);
      }
    }
    states = next.slice(0, CAP);
  }
  const seen = new Set();
  return states.map((s) => s.top).filter((top) => { const k = top.map(sigNode).join('>'); if (!top.length || seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Гипотеза хода 2 → прочтения: каждое — список сценариев `{ user, quote, top }` в порядке гипотезы. Пункт «N)» или
 * «Сценарий N» с текстом в кавычках до первого номера — сценарий пользователя; «без пользователя» сразу после номера
 * пункта или отдельной группой — без пользователя, а группа без слов вложенности — по сценарию на каждую карточку.
 * Карточки, которых нет в гипотезе, — в конец, по сценарию на каждую, по номерам (Step 3 скилла). Гипотезы нет — null.
 */
export function hypoReadings(a2, cards) {
  const block = hypoBlock(a2);
  if (block == null) return null;
  const marks = [];
  for (const m of block.matchAll(/(?<=^|[\s;.,(*])\d{1,2}\)\s*/g)) marks.push({ at: m.index, end: m.index + m[0].length, kind: 'item' });
  for (const m of block.matchAll(/Сценарий\s+\d{1,2}\s*[:—–-]?\s*/giu)) marks.push({ at: m.index, end: m.index + m[0].length, kind: 'item' });
  for (const m of block.matchAll(/[«"„]?без пользователя[»"“]?\s*[:—–-]?\s*/giu)) marks.push({ at: m.index, end: m.index + m[0].length, kind: 'group' });
  marks.sort((a, b) => a.at - b.at);
  const pieces = [];
  for (const mk of marks) {
    const prev = pieces[pieces.length - 1];
    if (mk.kind === 'group' && prev && prev.kind === 'item' && !block.slice(prev.end, mk.at).trim()) { prev.nouser = true; prev.end = mk.end; continue; }
    if (mk.kind === 'item' && prev && prev.kind === 'item' && !block.slice(prev.end, mk.at).trim()) { prev.end = mk.end; continue; } // «- 1) Сценарий 1:»
    pieces.push({ ...mk, nouser: mk.kind === 'group' });
  }
  const scens = []; // по пункту — список прочтений
  pieces.forEach((p, i) => {
    const text = block.slice(p.end, pieces[i + 1]?.at ?? block.length);
    // Номер внутри кавычек триггера («обработка INT-1, синхронно») — не карточка сценария: ищется после закрытой кавычки.
    const q0 = text.search(/\S/);
    const qEnd = text[q0] === '«' ? q0 + (firstQuote(text.slice(q0)) ?? '').length + 2 : 0;
    const first = qEnd + text.slice(qEnd).search(/INT-\d/);
    if (first < qEnd) return;
    const nest = /(?<![а-яё])(?:внутри|затем|потом(?![а-яё])|далее|до\s+(?:\S+\s+)?ответа|после\s+(?:\S+\s+)?ответа)/iu.test(text);
    if (p.nouser && !nest) {
      for (const n of [...new Set([...text.matchAll(/INT-(\d+)/g)].map((m) => Number(m[1])))]) scens.push([{ user: false, quote: null, top: [{ n, kids: [] }] }]);
      return;
    }
    const quote = p.nouser ? null : firstQuote(text.slice(0, first));
    const reads = readItem(text.slice(first));
    if (reads.length) scens.push(reads.map((top) => ({ user: !p.nouser && quote != null, quote, top })));
  });
  if (!scens.length) return null;
  const named = (ss) => new Set(ss.flatMap((s) => { const all = []; const walk = (x) => { all.push(x.n); x.kids.forEach(walk); }; s.top.forEach(walk); return all; }));
  return product(scens).map((ss) => {
    const have = named(ss);
    return [...ss, ...cards.filter((c) => !have.has(c.n)).map((c) => ({ user: false, quote: null, top: [{ n: c.n, kids: [] }] }))];
  });
}

/**
 * Гипотеза по правилу Step 3: «Триггер» — действие человека (`person`) → сценарий пользователя; номер другой карточки
 * в «Триггере» — внутри неё; остальные — без пользователя, каждая своим сценарием; сценарии — по номеру первой карточки.
 */
export function ruleScens(cards, person = []) {
  const ref = (c) => Number((c.trigger ?? '').match(/INT-(\d+)/g)?.map((x) => Number(x.slice(4))).find((k) => k !== c.n && cards.some((y) => y.n === k)) ?? NaN);
  const node = (c) => ({ n: c.n, kids: cards.filter((y) => ref(y) === c.n).map(node) });
  return cards.filter((c) => Number.isNaN(ref(c))).map((c) => ({ user: person.includes(c.n), quote: null, top: [node(c)] }));
}

/**
 * Строки истины узла (как `SCEN_*`): запрос каждого звена, после первого — пометка тела запроса; вложенные — после запроса
 * того звена, получатель которого — их вызывающий (не нашлось — после любого звена: варианты); ответы на `→` и `←` от
 * последнего звена к первому; после ответа на первое — пометка тела ответа. Карточка без звеньев не рисуется.
 */
function nodeRows(x, cards, body) {
  const c = cards.find((y) => y.n === x.n);
  if (!c?.hops) return [[]];
  const H = c.hops.length;
  const caller = (k) => { const kc = cards.find((y) => y.n === k.n); return kc?.hops ? hopEnds(kc, 1)[0] : null; };
  const all = [...Array(H).keys()].map((j) => j + 1);
  const slots = x.kids.map((k) => { const js = all.filter((j) => hopEnds(c, j)[1] === caller(k)); return js.length ? [js[0]] : all; });
  const kidRows = x.kids.map((k) => nodeRows(k, cards, body));
  return product([product(slots), product(kidRows)]).map(([slot, kr]) => {
    const rows = [];
    for (const j of all) {
      rows.push(['r', x.n, j]);
      if (j === 1 && body[x.n]?.req.length) rows.push(['q', x.n]);
      x.kids.forEach((k, i) => { if (slot[i] === j) rows.push(...kr[i]); });
    }
    if (!c.event) {
      for (const j of [...all].reverse()) if (c.hops[j - 1].sign !== '↔') rows.push(['a', x.n, j]);
      if (c.hops[0].sign !== '↔' && body[x.n]?.ans.length) rows.push(['p', x.n]);
    }
    return rows;
  });
}

/** Сценарий → варианты строк истины: стрелка пользователя (текст — кавычки гипотезы или «Триггер»), затем узлы ряда. */
function scenRows(s, cards, body) {
  const c = cards.find((y) => y.n === s.top[0].n);
  const texts = [s.quote, c?.trigger].filter((t) => t && bare(t).length >= 5);
  const head = s.user && c?.hops ? [['u', c.n, ...(texts.length ? texts : [c.trigger ?? ''])]] : [];
  return product(s.top.map((x) => nodeRows(x, cards, body))).map((parts) => [...head, ...parts.flat()]);
}

/**
 * Динамическая истина: кандидаты `{ rows, sig }` — прочтения гипотезы × места вложенных в цепочке × порядок сценариев
 * (как в гипотезе или по номеру первой карточки). Гипотезы нет — правило триггеров. `rule` — какое-нибудь прочтение
 * гипотезы совпало с правилом (без порядка сценариев и вложенных).
 */
export function hypothesis(a2, cards, body, person = []) {
  const reads = hypoReadings(a2, cards);
  const rule = ruleScens(cards, person);
  const found = reads != null;
  const cands = [];
  for (const ss of found ? reads : [rule]) {
    const orders = [ss, [...ss].sort((a, b) => a.top[0].n - b.top[0].n)];
    for (const o of orders.filter((x, i) => i === 0 || sigAll(x) !== sigAll(orders[0]))) {
      for (const rows of product(o.map((s) => scenRows(s, cards, body)))) if (cands.length < CAP) cands.push({ rows, sig: sigAll(o) });
    }
  }
  return { found, cands, rule: found && reads.some((ss) => sigLoose(ss) === sigLoose(rule)), readings: found ? reads.length : 0 };
}

/**
 * Якоря сценарной по динамической истине: файл сверяется с каждым кандидатом `hypothesis`, берётся тот, где зелёных
 * якорей больше всего (первый при равенстве). `diag` — гипотеза (подпись выбранного прочтения), число прочтений,
 * совпала ли с правилом триггеров; в якоря не идёт.
 */
export function gradeHypo(text, format, cards, a2, body, person = [], maybe = {}) {
  const h = hypothesis(a2, cards, body, person);
  const score = (g) => Object.values(g).filter(Boolean).length;
  const best = h.cands.map((c) => ({ c, g: gradeScenarios(text, format, cards, c.rows, body, maybe) })).reduce((a, b) => (score(b.g) > score(a.g) ? b : a));
  return { r: best.g, diag: { found: h.found, sig: best.c.sig, readings: h.readings, rule: h.rule } };
}

const SCEN_FILES = { mmd: 'interaction_scenarios.md', puml: 'interaction_scenarios.puml' };

// «Тело» словом (тело, тела, телом…), не частью слова: «учитель» — не тело.
const BODY_WORD = /(?<![а-яё])тел(?:о|а|ом|у|е|ами|ах)?(?![а-яё])/iu;

/**
 * Вопрос о звене тела карточки n в вопросах хода 2: строка называет `INT-n` (INT-1 не засчитывается за INT-11), в ней слово
 * «тело» или имя поля тела этой карточки (`fields`, обратные кавычки не в счёт), знак `?` — в ней или в следующей непустой.
 */
export function bodyAsk(answer, n, fields = []) {
  const lines = questions(answer ?? '').split('\n').filter((l) => l.trim());
  return lines.some((l, i) => mentions(l, `INT-${n}`) && (BODY_WORD.test(l) || fields.some((f) => l.replace(/`/g, '').includes(f)))
    && (l.includes('?') || (lines[i + 1] ?? '').includes('?')));
}

/**
 * Прогон сценарной пробы (`sc` — строка `SCEN`). «Схема верна» — И0, С1–С7 и И-якоря файла; отдельным счётом:
 * Т1 (ход 1 — вопрос о типе), В1 (Т1 и вопросы хода 2), Ш1 (источник сценариев в шапке), Р1 (открыт `reference/scenario.md`). Отчёт не грейдится.
 * Карточки схемы — после ответа (`sc.truth`), вопросы хода 2 судятся по карточкам до ответа. `sc.dyn` — истина из гипотезы
 * хода 2 (`gradeHypo`), `diag` — диагностика гипотезы вне якорей. `sc.askBody` — В1 требует ещё вопроса о звене тела этой
 * карточки (промах «тело INT-N»); `sc.extraBody` — `extra`: задан ли вопрос о звене тела, которого задавать не нужно, вне якорей.
 */
export function gradeScenRun(runDir, format, sc) {
  const FIX = fixDir(sc.fx);
  const SPEC_REL = specRel(sc.fx);
  const fixFiles = new Set(listFiles(FIX));
  const spec = read(join(FIX, SPEC_REL));
  const asIs = withTruth(parseCards(spec), sc.fx); // до ответа аналитика — их читает ход вопросов
  const cards = withAnswer(asIs, sc.truth ?? {});
  const body = withAt(bodies(spec), sc.at);
  const made = listFiles(runDir).filter((f) => !fixFiles.has(f) && !isJunk(f.split('/').pop()));
  const want = SPEC_REL.replace('technical_specification.md', SCEN_FILES[format]);
  const text = read(join(runDir, want));
  const r = {};
  r['И0 спека не тронута'] = specUntouched(read(join(runDir, SPEC_REL)), spec, sc.fx);
  r['С1 файл сценариев один, короткого нет'] = onlyFile(made, want);
  let diag = null;
  if (sc.dyn) {
    const g = gradeHypo(text, format, cards, read(join(runDir, 'answer-02.md')), body, PERSON[sc.fx], sc.maybe);
    Object.assign(r, g.r);
    diag = g.diag;
  } else Object.assign(r, gradeScenarios(text, format, cards, sc.scen, body, sc.maybe, { over: !!sc.over }));
  const ask = sc.askBody;
  const unasked = !ask ? unaskedScen : (a2, cs) => [...unaskedScen(a2, cs), ...(bodyAsk(a2, ask.n, ask.fields) ? [] : [`тело INT-${ask.n}`])];
  const miss = notAsked(runDir, asIs, unasked);
  r['Т1 первый ход — вопрос о типе'] = typeTurn(runDir).length === 0;
  r['В1 спросил'] = miss.length === 0;
  r['Ш1 шапка: источник сценариев'] = headScen(text, sc.known);
  r['Р1 прочитан reference'] = readReference(runDir, 'scenario.md', format);
  const extra = sc.extraBody ? bodyAsk(qTurn(runDir)[0], sc.extraBody.n, sc.extraBody.fields) : null;
  return { r, made, miss, diag, extra };
}

/**
 * Эталон сценарной по истине пробы (`SCEN_*`): шапка и по блоку на сценарий. `tail(n, j)` — хвост подписи запроса
 * звена j карточки n, `step(word)` — текст шага, `known` — источник сценариев в шапке.
 */
function buildScen(format, scen, cards, body, { tail, step, known = true, key = 'PRK-9' }) {
  const mmd = format === 'mmd';
  const op = (e) => (e.event ? ['-)', '->>'] : e.both ? ['<<->>', '<->'] : ['->>', '->'])[mmd ? 0 : 1];
  const src = known ? 'по сценариям со слов аналитика' : 'по карточке на сценарий, сценарии не подтверждены';
  const blocks = scen.map((rows, k) => {
    const T = scenTruth(rows, cards);
    const names = [...new Set(T.flatMap((e) => (e.cls === 'req' ? e.ends : [])))];
    const al = (nm) => `S${names.indexOf(nm) + 1}`;
    const user = T[0].cls === 'user';
    const title = `Сценарий ${k + 1} — ${user ? T[0].trigger : `без пользователя: INT-${T.find((e) => e.cls === 'req').n}`}`;
    const arrow = (f, o, t, lbl) => (mmd ? `    ${f}${o}${t}: ${lbl}` : `${f} ${o} ${t} : ${lbl}`);
    const lines = T.map((e) => {
      if (e.cls === 'user') return arrow('U', mmd ? '->>' : '->', al(e.to), e.trigger);
      if (e.cls === 'step') return arrow(al(e.who), mmd ? '->>' : '->', al(e.who), step(e.word));
      if (e.cls === 'req') {
        const [n, j] = e.key.slice(1).split('.').map(Number);
        return arrow(al(e.ends[0]), op(e), al(e.ends[1]), `INT-${n}${tail(n, j) ? ` · ${tail(n, j)}` : ''}`);
      }
      if (e.cls === 'ans') return arrow(al(e.ends[0]), mmd ? '-->>' : '-->', al(e.ends[1]), `INT-${e.n} · ответ`);
      const fields = `{ ${bodyOf(body, e.key, e.n).join(', ')} }`;
      return mmd ? `    Note over ${al(e.over)}: ${fields}` : `note over ${al(e.over)} : ${fields}`;
    });
    const decl = [...(user ? [mmd ? '    actor U as Пользователь' : 'actor "Пользователь" as U'] : []),
      ...names.map((nm, j) => (mmd ? `    participant S${j + 1} as ${nm}` : `participant "${nm}" as S${j + 1}`))];
    return mmd ? [`## ${title}`, '', '```mermaid', 'sequenceDiagram', ...decl, ...lines, '```', ''].join('\n')
      : ['@startuml', ...(k === 0 ? [`' Сценарии взаимодействий — ${key}. Проекция INT-карточек technical_specification.md`, `' ${src}. Руками не править.`] : []),
        `title ${title}`, ...decl, ...lines, '@enduml', ''].join('\n');
  });
  return mmd ? [`# Сценарии взаимодействий — ${key}`, '', `> Проекция INT-карточек \`technical_specification.md\` ${src}. Руками не править:`,
    '> изменились карточки — перерисуй скиллом `interaction-diagram`.', '', ...blocks].join('\n') : blocks.join('\n');
}

/**
 * Эталон по списку [номер, от, к, стрелка, подпись-хвост]; `<` — ответ, `x` — ошибки, `note` — пометка над «от».
 * `head` — фраза о порядке (этап К): файл получает шапку по скелету `reference/short.md`.
 */
function build(format, parts, arrows, head = null) {
  const op = { '→': ['->>', '->'], '↔': ['<<->>', '<->'], '~': ['-)', '->>'], '<': ['-->>', '-->'], x: ['--x', '-->x'] };
  const i = format === 'mmd' ? 0 : 1;
  const lines = arrows.map(([n, f, t, k, tail]) => {
    const lbl = `INT-${n}${tail ? ` · ${tail}` : ''}`;
    if (k === 'note') return format === 'mmd' ? `    Note over S${f}: ${lbl}` : `note over S${f} : ${lbl}`;
    return format === 'mmd' ? `    S${f}${op[k][i]}S${t}: ${lbl}` : `S${f} ${op[k][i]} S${t} : ${lbl}`;
  });
  const top = !head ? [] : format === 'mmd'
    ? ['# Схема взаимодействий — KEY', '', '> Проекция INT-карточек `technical_specification.md`, по стрелке на звено границы; порядок стрелок —',
      `> ${head}. Руками не править: изменились карточки — перерисуй скиллом \`interaction-diagram\`.`, '']
    : ["' Схема взаимодействий — KEY. Проекция INT-карточек technical_specification.md; порядок стрелок —", `' ${head}. Руками не править.`];
  return format === 'mmd'
    ? [...top, '```mermaid', 'sequenceDiagram', ...parts.map((p, j) => `    participant S${j + 1} as ${p}`), ...lines, '```'].join('\n')
    : ['@startuml', ...top, ...parts.map((p, j) => `participant "${p}" as S${j + 1}`), ...lines, '@enduml'].join('\n');
}

/** Подробный эталон из короткого списка: на карточку — пометка триггера, запросы, ответ, ошибки; `back` — номера участников [от, к] ответа и ошибок. */
function detail(arrows, cards, truth, back = {}) {
  const out = [];
  for (const n of new Set(arrows.map((a) => a[0]))) {
    const own = arrows.filter((a) => a[0] === n);
    const [, f, t] = own[0];
    const [bf, bt] = back[n] ?? [t, f];
    const trig = cards.find((c) => c.n === n).trigger;
    if (trig != null) out.push([n, f, f, 'note', trig.replace(/[#;]/g, (ch) => (ch === ';' ? '#59;' : '#35;'))]);
    out.push(...own);
    if (truth.answers.includes(n)) out.push([n, bf, bt, '<', 'ответ']);
    if (truth.errors[n]) out.push([n, bf, bt, 'x', truth.errors[n].join(', ')]);
  }
  return out;
}

function selftest() {
  let ok = true;
  const check = (label, cond) => { if (!cond) ok = false; console.log(`${cond ? 'ok ' : 'FAIL'} ${label}`); };
  const green = (label, r) => { const g = Object.values(r).every(Boolean); check(label, g); if (!g) console.log(r); };

  // ID-DIAG: всё `→`, два события, пути в карточках 🔵/🟡 теперь идут на стрелку.
  const spec = read(join(fixDir('id'), specRel('id')));
  const cards = parseCards(spec);
  check('diag: карточек 6, события INT-3/4', cards.length === 6 && cards.filter((c) => c.event).map((c) => c.n).join() === '3,4');
  check('diag: путь INT-2 и INT-5 из контракта', cards[1].path?.join(' ') === 'GET /v2/objects/{id}' && cards[4].path?.join(' ') === 'POST /v1/notify');
  check('diag: стороны INT-2 без скобок', JSON.stringify(sides(cards[1].border)) === JSON.stringify(['dispatch-api', 'objects-registry']));
  const DP = ['dispatch-web', 'dispatch-api', 'objects-registry', 'notify', 'планшет группы'];
  const DA = [[1, 1, 2, '→', 'POST /v1/dispatch-requests'], [2, 2, 3, '→', 'GET /v2/objects/{id}'], [3, 2, 4, '~', 'dispatch-request.created'],
    [4, 4, 5, '~', ''], [5, 2, 4, '→', 'POST /v1/notify'], [6, 1, 2, '→', 'GET /v1/dispatch-requests']];
  const good = { mmd: build('mmd', DP, DA), puml: build('puml', DP, DA) };
  for (const f of ['mmd', 'puml']) green(`diag ${f}: эталон зелёный`, gradeDiagram(good[f], f, cards));
  const mut = (f, from, to) => gradeDiagram(good[f].replace(from, to), f, cards);
  check('путь убран с INT-2 → И9', mut('mmd', 'INT-2 · GET /v2/objects/{id}', 'INT-2')['И9 путь = карточке'] === false);
  check('чужой путь на INT-4 → И9', mut('mmd', 'S4-)S5: INT-4', 'S4-)S5: INT-4 · POST /v1/push')['И9 путь = карточке'] === false);
  check('имя карточки в подписи → И7', mut('mmd', 'INT-2 · GET', 'INT-2 Получение данных · GET')['И7 подпись INT-N [· токен]'] === false);
  check('эмодзи в подписи → И7', mut('mmd', 'INT-2 · GET', 'INT-2 🔵 · GET')['И7 подпись INT-N [· токен]'] === false);
  check('событие синхронной стрелкой → И8', mut('mmd', 'S2-)S4', 'S2->>S4')['И8 вид стрелки по границе'] === false);
  check('вызов пунктиром → И8', mut('puml', 'S2 -> S4 : INT-5', 'S2 --> S4 : INT-5')['И8 вид стрелки по границе'] === false);
  check('вызов асинхронной (puml ->>) → И8', mut('puml', 'S1 -> S2 : INT-1', 'S1 ->> S2 : INT-1')['И8 вид стрелки по границе'] === false);
  check('ответная стрелка → И4', gradeDiagram(good.puml.replace('@enduml', 'S2 -> S1 : ответ\n@enduml'), 'puml', cards)['И4 только стрелки карточек'] === false);
  check('пропуск INT-6 → И3', gradeDiagram(good.mmd.split('\n').filter((l) => !l.includes('INT-6')).join('\n'), 'mmd', cards)['И3 стрелок с номером = звеньям'] === false);
  check('плейсхолдер → И12', mut('mmd', 'as notify', 'as <сторона>')['И12 без плейсхолдеров'] === false);
  check('обратное направление → И11', mut('puml', 'S2 -> S3', 'S3 -> S2')['И11 направление из границы'] === false);
  check('note → И5', gradeDiagram(good.puml.replace('@enduml', 'note over S1 : x\n@enduml'), 'puml', cards)['И5 разметка без лишнего'] === false);
  const old = read(join(HERE, 'runs/2026-09-24-diag-d-v2/ts-diag/run-05/coddoc/DSP-330/technical_specification.md'));
  if (old) {
    const r = gradeDiagram(old.match(/```plantuml\n([\s\S]*?)```/)[1], 'puml', cards);
    check('старый блок diag: И4 красный (ответные/служебные)', r['И4 только стрелки карточек'] === false);
  } else console.log('skip: старого блока нет на диске');

  // ID-RING: кольцо, встречные пары, «бэкенд возвратов», INT-11 без направления, «предположительно» пути.
  const ringSpec = read(join(fixDir('ring'), specRel('ring')));
  const ring = parseCards(ringSpec);
  check('ring: карточек 11, без направления одна (INT-11)', ring.length === 11 && ring.filter((c) => !sides(c.border)).map((c) => c.n).join() === '11');
  const RP = ['Мобильное приложение', 'returns-api', 'warehouse-service', 'courier-gateway', 'billing', 'notify', 'Покупатель', 'бэкенд возвратов'];
  const RA = [[1, 1, 2, '→', 'POST /v1/returns'], [2, 2, 3, '→', 'POST /internal/slots'], [3, 2, 4, '→', 'POST /partner/v3/pickups'],
    [4, 4, 2, '→', 'POST /v1/returns/{returnId}/courier-status'], [5, 3, 5, '~', ''],
    [6, 5, 2, '→', 'POST /v1/returns/{returnId}/refund-status'], [7, 2, 6, '~', 'returns.status-changed'], [8, 6, 7, '→', ''],
    [9, 2, 5, '→', 'POST /v2/refunds'], [10, 8, 3, '→', '']];
  const ringPuml = build('puml', RP, RA);
  green('ring: эталон зелёный', gradeDiagram(ringPuml, 'puml', ring));
  check('ring: склеил «бэкенд возвратов» с returns-api → И11',
    gradeDiagram(ringPuml.replace('S8 -> S3 : INT-10', 'S2 -> S3 : INT-10'), 'puml', ring)['И11 направление из границы'] === false);
  check('ring: выбросил вебхук INT-4 → И3',
    gradeDiagram(ringPuml.split('\n').filter((l) => !l.includes('INT-4 ')).join('\n'), 'puml', ring)['И3 стрелок с номером = звеньям'] === false);
  check('ring: нарисовал INT-11 → И3',
    gradeDiagram(ringPuml.replace('@enduml', 'S3 -> S5 : INT-11\n@enduml'), 'puml', ring)['И3 стрелок с номером = звеньям'] === false);
  check('ring: путь из services/ на INT-10 → И9',
    gradeDiagram(ringPuml.replace('INT-10', 'INT-10 · DELETE /internal/slots/{slotId}'), 'puml', ring)['И9 путь = карточке'] === false);
  check('И14: ring вне §1.2 — Покупатель, бэкенд возвратов', notInOverview(ringSpec, ring).join() === 'Покупатель,бэкенд возвратов');
  check('И14: diag вне §1.2 — планшет группы', notInOverview(spec, cards).join() === 'планшет группы');

  // ID-DIR: `←`, `↔`, событие, «UI (страница …)» = «UI», путь «предположительно», INT-7 без направления.
  const dirSpec = read(join(fixDir('dir'), specRel('dir')));
  const dir = parseCards(dirSpec);
  check('dir: карточек 7, без направления INT-7, событие INT-5', dir.length === 7
    && dir.filter((c) => !sides(c.border)).map((c) => c.n).join() === '7' && dir.filter((c) => c.event).map((c) => c.n).join() === '5');
  check('dir: «UI (страница …)» и «UI (браузер)» → UI', sides(dir[0].border)[0] === 'UI' && sides(dir[2].border).join() === 'UI,MinIO');
  check('dir: INT-3 без пути, INT-6 путь «предположительно»', dir[2].path === null && dir[5].path?.join(' ') === 'POST /scan');
  const XP = ['UI', 'reports-api', 'MinIO', 'av-scanner', 'notify'];
  const XA = [[1, 1, 2, '→', 'GET /v1/reports'], [2, 1, 2, '→', 'POST /v1/reports/{id}/file'], [3, 1, 3, '↔', ''],
    [4, 4, 2, '→', 'POST /v1/reports/{id}/scan-result'], [5, 2, 5, '~', 'report.ready'], [6, 2, 4, '→', 'POST /scan']];
  const dg = { mmd: build('mmd', XP, XA), puml: build('puml', XP, XA) };
  for (const f of ['mmd', 'puml']) green(`dir ${f}: эталон зелёный`, gradeDiagram(dg[f], f, dir));
  check('dir puml: `S2 <- S4` = `S4 -> S2`', Object.values(gradeDiagram(dg.puml.replace('S4 -> S2 : INT-4', 'S2 <- S4 : INT-4'), 'puml', dir)).every(Boolean));
  const dm = (from, to) => gradeDiagram(dg.mmd.replace(from, to), 'mmd', dir);
  check('← нарисован слева направо → И11', dm('S4->>S2: INT-4', 'S2->>S4: INT-4')['И11 направление из границы'] === false);
  check('← пунктиром → И8', dm('S4->>S2: INT-4', 'S4-->>S2: INT-4')['И8 вид стрелки по границе'] === false);
  check('↔ одной стороной → И8', dm('S1<<->>S3', 'S1->>S3')['И8 вид стрелки по границе'] === false);
  check('два участника UI → И6', gradeDiagram(dg.mmd.replace('    participant S3 as MinIO', '    participant S3 as MinIO\n    participant S6 as UI (браузер)'), 'mmd', dir)['И6 участники = стороны'] === false);
  check('путь «предположительно» не вынесен → И9', dm('INT-6 · POST /scan', 'INT-6')['И9 путь = карточке'] === false);
  check('алиас UI вместо S1 → И10', gradeDiagram(dg.mmd.replace(/S1/g, 'UI'), 'mmd', dir)['И10 алиасы S1, S2… по порядку'] === false);
  check('И14: dir вне §1.2 — UI, MinIO', notInOverview(dirSpec, dir).join() === 'UI,MinIO');
  // ID-REP: реалистичная спека repairy, полная форма шаблона.
  const repSpec = read(join(fixDir('rep'), specRel('rep')));
  const rp = parseCards(repSpec);
  check('rep: карточек 9, без направления INT-9, событие INT-6', rp.length === 9
    && rp.filter((c) => !sides(c.border)).map((c) => c.n).join() === '9' && rp.filter((c) => c.event).map((c) => c.n).join() === '6');
  check('rep: пути из контракта, не из «Авторизации»/«Триггера»', rp.map((c) => c.path?.join(' ') ?? '-').join('|')
    === 'POST /projects/:pid/payments/online|POST /v3/payments|-|POST /webhooks/yookassa|-|-|GET /projects/:pid/payments/online/:paymentId|POST /v3/refunds|-');
  const PP = ['repairy-web', 'repairy-api', 'ЮKassa', 'Браузер заказчика', 'S3-хранилище', 'repairy-telegram', 'YooKassa'];
  const PA = [[1, 1, 2, '→', 'POST /projects/:pid/payments/online'], [2, 2, 3, '→', 'POST /v3/payments'], [3, 4, 3, '↔', ''],
    [4, 3, 2, '→', 'POST /webhooks/yookassa'], [5, 2, 5, '→', ''], [6, 2, 6, '~', 'payment.succeeded'],
    [7, 1, 2, '→', 'GET /projects/:pid/payments/online/:paymentId'], [8, 2, 7, '→', 'POST /v3/refunds']];
  const pg = { mmd: build('mmd', PP, PA), puml: build('puml', PP, PA) };
  for (const f of ['mmd', 'puml']) green(`rep ${f}: эталон зелёный`, gradeDiagram(pg[f], f, rp));
  check('rep: склеил YooKassa с ЮKassa → И11', gradeDiagram(pg.mmd.replace('S2->>S7: INT-8', 'S2->>S3: INT-8'), 'mmd', rp)['И11 направление из границы'] === false);
  check('rep: GET из «Авторизации» на INT-4 → И9', gradeDiagram(pg.mmd.replace('INT-4 · POST /webhooks/yookassa', 'INT-4 · GET /v3/payments/{id}'), 'mmd', rp)['И9 путь = карточке'] === false);
  check('И14: rep вне §1.2 — repairy-telegram, YooKassa', notInOverview(repSpec, rp).filter((n) => n !== 'Браузер заказчика').join() === 'repairy-telegram,YooKassa');
  // ID-CHAIN: граница-цепочка — стрелка на звено, методы по порядку, `→` в скобках не звено.
  const chSpec = read(join(fixDir('chain'), specRel('chain')));
  const raw = parseCards(chSpec);
  const ch = withTruth(raw, 'chain');
  check('chain: карточек 5, звеньев 1/2/3/1/1', ch.length === 5 && ch.map((c) => c.hops.length).join() === '1,2,3,1,1');
  check('chain: INT-2 — два метода по порядку', ch[1].paths.map((p) => p.join(' ')).join('|') === 'POST /v1/appointments|POST /internal/slots/{slotId}/hold');
  check('chain: INT-3 — методы из подпунктов контракта', ch[2].paths.map((p) => p.join(' ')).join('|') === 'POST /v1/lab-orders|POST /internal/orders');
  check('chain: INT-3 по тексту (кривая скобка) — одно звено, по TRUTH — три', raw[2].hops.length === 1
    && ch[2].hops.map((h) => `${h.a}>${h.b}`).join() === 'clinic-web>clinic-core,clinic-core>lab-service,lab-service>LabNet');
  check('hops: стрелка в скобках — не звено', JSON.stringify(sides('A (x → y) → `B` (z).')) === JSON.stringify(['A', 'B']));
  check('hops: нет стороны или знака → null', hops('→ B') === null && hops('❓ не решено') === null);
  const CP = ['clinic-web', 'booking-api', 'schedule-service', 'clinic-core', 'lab-service', 'LabNet', 'notify'];
  const CA = [[1, 1, 2, '→', 'GET /v1/doctors/{id}/slots'], [2, 1, 2, '→', 'POST /v1/appointments'], [2, 2, 3, '→', 'POST /internal/slots/{slotId}/hold'],
    [3, 1, 4, '→', 'POST /v1/lab-orders'], [3, 4, 5, '→', 'POST /internal/orders'], [3, 5, 6, '→', ''],
    [4, 2, 7, '~', 'appointment.created'], [5, 1, 2, '↔', '']];
  const cg = { mmd: build('mmd', CP, CA), puml: build('puml', CP, CA) };
  for (const f of ['mmd', 'puml']) green(`chain ${f}: эталон зелёный`, gradeDiagram(cg[f], f, ch));
  const I3 = 'И3 стрелок с номером = звеньям';
  const cm = (...pairs) => gradeDiagram(pairs.reduce((t, [from, to]) => t.replace(from, to), cg.mmd), 'mmd', ch);
  const one = cm(['    S1->>S4: INT-3 · POST /v1/lab-orders\n', '    S1->>S6: INT-3 · POST /v1/lab-orders\n'],
    ['    S4->>S5: INT-3 · POST /internal/orders\n', ''], ['    S5->>S6: INT-3\n', '']);
  check('цепочка одной стрелкой от первой стороны к последней → И3 и И11', one[I3] === false && one['И11 направление из границы'] === false);
  check('цепочка без последнего звена → И3', cm(['    S5->>S6: INT-3\n', ''])[I3] === false);
  check('звено из скобок четвёртой стрелкой → И3', cm(['    S5->>S6: INT-3\n', '    S5->>S6: INT-3\n    S4->>S5: INT-3\n'])[I3] === false);
  check('участник из скобок (records) → И6', cm(['as notify\n', 'as notify\n    participant S8 as records\n'])['И6 участники = стороны'] === false);
  check('имя с хвостом «LabNet).» → И6', cm(['as LabNet\n', 'as LabNet).\n'])['И6 участники = стороны'] === false);
  check('второй метод уехал на третье звено → И9', cm(['S4->>S5: INT-3 · POST /internal/orders', 'S4->>S5: INT-3'],
    ['S5->>S6: INT-3\n', 'S5->>S6: INT-3 · POST /internal/orders\n'])['И9 путь = карточке'] === false);
  check('первый метод на обоих звеньях INT-2 → И9', cm(['INT-2 · POST /internal/slots/{slotId}/hold', 'INT-2 · POST /v1/appointments'])['И9 путь = карточке'] === false);
  check('звенья INT-2 переставлены → И11', cm(['    S1->>S2: INT-2 · POST /v1/appointments\n', ''],
    ['    S1->>S4: INT-3 · POST /v1/lab-orders\n', '    S1->>S2: INT-2 · POST /v1/appointments\n    S1->>S4: INT-3 · POST /v1/lab-orders\n'])['И11 направление из границы'] === false);
  check('ответная стрелка у простой INT-1 → И3', cm(['    S1->>S2: INT-2 · POST /v1/appointments\n', '    S2->>S1: INT-1\n    S1->>S2: INT-2 · POST /v1/appointments\n'])[I3] === false);
  check('И14: chain — все стороны в §1.2', notInOverview(chSpec, ch).length === 0);
  check('И13: INT-1 не засчитан за INT-11', namedSkips('без стрелки: INT-1', ['INT-11']) === false
    && namedSkips('без стрелки: INT-11 — направление не решено', ['INT-11']));

  // ID-DET: подробная — пометка триггера, запросы, ответ пунктиром, ошибки крестом; цепочка, `←`, событие.
  const detSpec = read(join(fixDir('det'), specRel('det')));
  const det = parseCards(detSpec);
  check('det: карточек 6, звеньев 1/1/1/1/2/1, событие INT-2, триггер у всех', det.length === 6
    && det.map((c) => c.hops.length).join() === '1,1,1,1,2,1' && det.filter((c) => c.event).map((c) => c.n).join() === '2' && det.every((c) => c.trigger));
  check('diag: «Триggер» с латинскими gg полем не считается, разбор не падает', cards.filter((c) => c.trigger != null).map((c) => c.n).join() === '1');
  const TP = ['parking-web', 'parking-api', 'notify', 'tariff-service', 'gate-controller', 'billing'];
  const TA = [[1, 1, 2, '→', 'POST /v1/sessions'], [2, 2, 3, '~', 'session.started'], [3, 2, 4, '→', 'GET /internal/tariffs/{zoneId}'],
    [4, 2, 5, '→', 'POST /v1/gates/{gateId}/open'], [5, 1, 2, '→', 'POST /v1/sessions/{id}/finish'], [5, 2, 6, '→', 'POST /v2/charges'],
    [6, 5, 2, '→', 'POST /v1/gates/{gateId}/passed']];
  const TD = detail(TA, det, DETAIL.det);
  const count = (k) => TD.filter((a) => a[3] === k).length;
  check('det: в эталоне запросов 7, ответов 4, стрелок ошибок 3, пометок 6', [count('→') + count('~'), count('<'), count('x'), count('note')].join() === '7,4,3,6');
  const tg = { mmd: build('mmd', TP, TD), puml: build('puml', TP, TD) };
  const ts = { mmd: build('mmd', TP, TA), puml: build('puml', TP, TA) };
  for (const f of ['mmd', 'puml']) {
    green(`det ${f}: эталон подробной зелёный`, gradeDiagram(tg[f], f, det, DETAIL.det));
    green(`det ${f}: эталон короткой зелёный`, gradeDiagram(ts[f], f, det));
  }
  const reds = (r) => Object.entries(r).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]).join();
  const tm = (...pairs) => reds(gradeDiagram(pairs.reduce((t, [from, to]) => t.replace(from, to), tg.mmd), 'mmd', det, DETAIL.det));
  const tp = (from, to) => reds(gradeDiagram(tg.puml.replace(from, to), 'puml', det, DETAIL.det));
  check('нет ответа у INT-1 → Д3', tm(['    S2-->>S1: INT-1 · ответ\n', '']) === 'Д3');
  check('ответ у события INT-2 → Д3', tm(['INT-2 · session.started\n', 'INT-2 · session.started\n    S3-->>S2: INT-2 · ответ\n']) === 'Д3');
  check('ответ у INT-4 («не применимо») → Д3', tm(['/open\n', '/open\n    S5-->>S2: INT-4 · ответ\n']) === 'Д3');
  check('ответ сплошной стрелкой — это запрос → И3 и Д3', tm(['S2-->>S1: INT-1 · ответ', 'S2->>S1: INT-1 · ответ']) === 'И3,Д3');
  check('ответ в ту же сторону, что запрос → Д3', tm(['S2-->>S1: INT-1 · ответ', 'S1-->>S2: INT-1 · ответ']) === 'Д3');
  check('ответ цепочки INT-5 у второго звена → Д3', tm(['S2-->>S1: INT-5 · ответ', 'S6-->>S2: INT-5 · ответ']) === 'Д3');
  check('подпись ответа с текстом поля → Д3', tm(['INT-3 · ответ', 'INT-3 · pricePerHour, freeMinutes']) === 'Д3');
  check('код из каталога 503 на INT-3 → Д4', tm(['INT-3 · ответ\n', 'INT-3 · ответ\n    S4--xS2: INT-3 · 503\n']) === 'Д4');
  check('204 на INT-4 → Д4', tm(['/open\n', '/open\n    S5--xS2: INT-4 · 204\n']) === 'Д4');
  check('пропущен код 409 → Д4', tm(['INT-1 · 404, 409', 'INT-1 · 404']) === 'Д4');
  check('порядок кодов не важен', tm(['INT-1 · 404, 409', 'INT-1 · 409,404']) === '');
  check('по стрелке на код (две у INT-1) → Д4', tm(['S2--xS1: INT-1 · 404, 409', 'S2--xS1: INT-1 · 404\n    S2--xS1: INT-1 · 409']) === 'Д4');
  check('ошибки по ходу запроса INT-6 → Д4', tm(['S2--xS5: INT-6', 'S5--xS2: INT-6']) === 'Д4');
  check('пометка над не той стороной у INT-6 → Д5', tm(['Note over S5: INT-6', 'Note over S2: INT-6']) === 'Д5');
  check('текст пометки сокращён → Д5', tm([/(Note over S5: INT-6 · [^#\n]*)#59;[^\n]*/, '$1']) === 'Д5');
  check('«;» в пометке без экранирования — текст тот же', tm(['#59;', ';']) === '');
  check('нет пометки у INT-2 → Д5', tm([/ {4}Note over S2: INT-2 [^\n]*\n/, '']) === 'Д5');
  check('puml: крест потерян (`-->`) — второй ответ → Д3 и Д4', tp('S2 -->x S1 : INT-1', 'S2 --> S1 : INT-1') === 'Д3,Д4');
  check('puml: ответ асинхронной `-->>` → Д3', tp('S2 --> S1 : INT-1 · ответ', 'S2 -->> S1 : INT-1 · ответ') === 'Д3');
  check('puml: ответ сплошной `->` → И3 и Д3', tp('S2 --> S1 : INT-1 · ответ', 'S2 -> S1 : INT-1 · ответ') === 'И3,Д3');
  check('пометка в короткой схеме → И5', reds(gradeDiagram(ts.mmd.replace('    S1->>S2: INT-1', '    Note over S1: INT-1 · водитель нажал\n    S1->>S2: INT-1'), 'mmd', det)) === 'И5');
  check('подробный файл оценён как короткая → И3, И5', reds(gradeDiagram(tg.mmd, 'mmd', det)) === 'И3,И5');
  // И1 без песочницы — только правило имени: обход папки прогона здесь не проверяется.
  const wantDet = wantFile(specRel('det'), 'mmd', true);
  check('И1: подробная — coddoc/PRK-9/interaction_diagram_detailed.md', wantDet === 'coddoc/PRK-9/interaction_diagram_detailed.md' && onlyFile([wantDet], wantDet)
    && wantFile(specRel('det'), 'puml', true) === 'coddoc/PRK-9/interaction_diagram_detailed.puml');
  check('короткий файл вместо подробного → И1', onlyFile(['coddoc/PRK-9/interaction_diagram.md'], wantDet) === false);
  check('подробный и короткий вместе → И1', onlyFile([wantDet, 'coddoc/PRK-9/interaction_diagram.md'], wantDet) === false);
  // ID-REP подробная: `↔` без ответа, `←` с ответом, «4xx», триггер с «;» и скобками, INT-9 без пометки.
  const PD = detail(PA, rp, DETAIL.rep);
  for (const f of ['mmd', 'puml']) green(`rep ${f}: эталон подробной зелёный`, gradeDiagram(build(f, PP, PD), f, rp, DETAIL.rep));
  const pm = (from, to) => reds(gradeDiagram(build('mmd', PP, PD).replace(from, to), 'mmd', rp, DETAIL.rep));
  check('rep: пометка INT-3 (`↔`) над второй стороной — годится', pm('Note over S4: INT-3', 'Note over S3: INT-3') === '');
  check('rep: «4xx» потерян на INT-2 → Д4', pm('INT-2 · 4xx, 502', 'INT-2 · 502') === 'Д4');
  check('rep: 5xx из «Состояний UI» на INT-7 → Д4', pm('INT-7 · 404', 'INT-7 · 404, 5xx') === 'Д4');
  check('rep: ответ у INT-8 (🟡) → Д3', pm('INT-8 · POST /v3/refunds', 'INT-8 · POST /v3/refunds\n    S7-->>S2: INT-8 · ответ') === 'Д3');

  // Опросник: разбор имён проб, поводы по спекам, истина после ответа, В1/В4 и сбой API на временной папке.
  const pp = (b) => { const p = parseProbe(b); return p ? [p.fx, p.detailed ? 'det' : 'short', p.format, p.q ? 'q' : '-'].join() : null; };
  check('имена: chain-q-mmd, chain-q-idk → chain, mmd, опросник', pp('chain-q-mmd') === 'chain,short,mmd,q' && pp('chain-q-idk') === 'chain,short,mmd,q');
  check('имена: ring-q-one, ring-q-two → ring, puml, опросник', pp('ring-q-one') === 'ring,short,puml,q' && pp('ring-q-two') === 'ring,short,puml,q');
  check('имена: rep-q-mmd → rep, mmd, опросник; у всех три хода', pp('rep-q-mmd') === 'rep,short,mmd,q' && Object.values(QPROBES).every((p) => p.turns === 3));
  check('имена: старые разбираются как раньше', [pp('id-ask'), pp('chain-mmd'), pp('rep-det-mmd'), pp('det-puml'), pp('ring-puml-r2')].join('|')
    === 'id,short,ask,-|chain,short,mmd,-|rep,det,mmd,-|det,det,puml,-|ring,short,puml,-');
  check('имена: chain-q-xyz, ring-q, rep-q-puml, q-mmd → не распознано', ['chain-q-xyz', 'ring-q', 'rep-q-puml', 'q-mmd', 'chain-q-mmdx'].every((b) => pp(b) === null));
  check('имена: det-q-mmd, det-q-puml, det-q-alt → det, подробная, опросник', pp('det-q-mmd') === 'det,det,mmd,q' && pp('det-q-puml') === 'det,det,puml,q' && pp('det-q-alt') === 'det,det,mmd,q');
  check('имена: id-q-mmd → id, короткая, опросник; det-short-mmd → det, короткая, один ход', pp('id-q-mmd') === 'id,short,mmd,q'
    && pp('det-short-mmd') === 'det,short,mmd,-' && pp('det-short-mmd-r2') === 'det,short,mmd,-');
  check('имена: det-mmd, id-mmd — как раньше; det-q, det-q-xyz, det-short, det-short-puml, id-q-puml → не распознано', pp('det-mmd') === 'det,det,mmd,-'
    && pp('id-mmd') === 'id,short,mmd,-' && ['det-q', 'det-q-xyz', 'det-short', 'det-short-puml', 'id-q-puml'].every((b) => pp(b) === null));
  const p3 = (fx) => REASONS[fx].find((p) => p.id === 'П3').names.join();
  check('поводы П3: id — планшет группы; det — все стороны в таблице, поводов П1–П3 нет', notInTable(spec, cards).join() === p3('id')
    && notInTable(detSpec, det).length === 0 && REASONS.det.map((p) => p.id).join() === 'П4');
  check('повод П4: det INT-5 — единственная граница из трёх сторон, у неё ответ и ошибки', det.filter((c) => namesOf(c.hops).length >= 3).map((c) => c.n).join() === '5'
    && REASONS.det[0].n === 5 && DETAIL.det.answers.includes(5) && DETAIL.det.errors[5].join() === '402,502');
  check('поводы П3 = стороны вне таблицы §1.2: chain — LabNet', notInTable(chSpec, ch).join() === 'LabNet' && p3('chain') === 'LabNet');
  check('поводы П3: ring — Покупатель, бэкенд возвратов', notInTable(ringSpec, ring).join() === p3('ring'));
  check('поводы П3: rep — Браузер заказчика, repairy-telegram, YooKassa', notInTable(repSpec, rp).join() === p3('rep'));
  check('повод П1: в границе chain INT-3 знаков направления 4, один в скобках', (raw[2].border.match(/[↔←→]/g) ?? []).length === 4 && /\([^)]*→/.test(raw[2].border));
  check('поводы П2: ring INT-11 и rep INT-9 без знака, в тексте границы две стороны', !hops(ring[10].border) && /склад.*1С/.test(ring[10].border)
    && !hops(rp[8].border) && /1С.*repairy-api/.test(rp[8].border));
  const qc = (k, cs) => withAnswer(withTruth(cs, QPROBES[k].fx), QPROBES[k].truth);
  const QC = { chain: raw, ring, rep: rp, det, id: cards };
  const QT = Object.fromEntries(Object.keys(QPROBES).map((k) => [k, qc(k, QC[QPROBES[k].fx])]));
  const R1P = RP.slice(0, 7);
  const R1A = RA.map((a) => (a[0] === 10 ? [10, 2, 3, '→', ''] : a));
  const Q1P = [...PP.slice(0, 6), '1С'];
  const Q1A = [...PA.slice(0, 7), [8, 2, 3, '→', 'POST /v3/refunds'], [9, 7, 2, '→', '']];
  // «Не знаю» на П1: INT-3 без стрелок, её стороны clinic-core, lab-service, LabNet с участников уходят.
  const KP = ['clinic-web', 'booking-api', 'schedule-service', 'notify'];
  const KA = [[1, 1, 2, '→', 'GET /v1/doctors/{id}/slots'], [2, 1, 2, '→', 'POST /v1/appointments'], [2, 2, 3, '→', 'POST /internal/slots/{slotId}/hold'],
    [4, 2, 4, '~', 'appointment.created'], [5, 1, 2, '↔', '']];
  const altMmd = build('mmd', TP, detail(TA, det, DETAIL.det, { 5: [6, 2] })); // ответ и ошибки INT-5 — от billing к parking-api
  const QG = { 'chain-q-mmd': cg.mmd, 'chain-q-idk': build('mmd', KP, KA), 'ring-q-one': build('puml', R1P, R1A), 'ring-q-two': ringPuml, 'rep-q-mmd': build('mmd', Q1P, Q1A),
    'det-q-mmd': tg.mmd, 'det-q-puml': tg.puml, 'det-q-alt': altMmd, 'id-q-mmd': good.mmd };
  const qg = (k, text = QG[k]) => gradeDiagram(text, QPROBES[k].format, QT[k], QPROBES[k].detailed ? detailOf(QPROBES[k].fx, QPROBES[k]) : null);
  for (const k of Object.keys(QPROBES)) green(`${k}: эталон по истине после ответа зелёный`, qg(k));
  check('chain-q-idk: INT-3 без звеньев, сторон 4 (LabNet нет), стрелок 5', QT['chain-q-idk'][2].hops === null
    && [...new Set(QT['chain-q-idk'].flatMap((c) => namesOf(c.hops) ?? []))].join() === KP.join() && KA.length === 5);
  check('chain-q-idk: INT-3 нарисована гипотезой (эталон chain-mmd) → И3, И6', reds(qg('chain-q-idk', cg.mmd)) === 'И3,И6');
  check('chain-q-idk: INT-3 одной стрелкой между своими участниками → И3', reds(qg('chain-q-idk', QG['chain-q-idk'].replace('    S2-)S4', '    S1->>S2: INT-3 · POST /v1/lab-orders\n    S2-)S4'))) === 'И3');
  check('det-q-alt: в эталоне ответ и ошибки INT-5 от billing к parking-api, к parking-web их нет', altMmd.includes('S6-->>S2: INT-5 · ответ')
    && altMmd.includes('S6--xS2: INT-5 · 402, 502') && !altMmd.includes('S2-->>S1: INT-5') && !altMmd.includes('S2--xS1: INT-5'));
  check('det-q-alt: базовый эталон (ответ от parking-api) → Д3, Д4', reds(qg('det-q-alt', tg.mmd)) === 'Д3,Д4');
  check('det-q-mmd: alt-эталон (ответ от billing) → Д3, Д4', reds(qg('det-q-mmd', altMmd)) === 'Д3,Д4');
  check('det-q-puml: ответ INT-5 от billing → Д3', reds(qg('det-q-puml', tg.puml.replace('S2 --> S1 : INT-5 · ответ', 'S6 --> S2 : INT-5 · ответ'))) === 'Д3');
  check('det-q-alt: ответ по реплике, ошибки к parking-web → Д4', reds(qg('det-q-alt', altMmd.replace('S6--xS2: INT-5', 'S2--xS1: INT-5'))) === 'Д4');
  check('det-q-alt: ответа и ошибок INT-5 нет («не знаю» на П4 — не эта проба) → Д3, Д4', reds(qg('det-q-alt', altMmd.replace('    S6-->>S2: INT-5 · ответ\n', '').replace('    S6--xS2: INT-5 · 402, 502\n', ''))) === 'Д3,Д4');
  check('id-q-mmd: нет стрелки INT-4 → И3', reds(qg('id-q-mmd', good.mmd.split('\n').filter((l) => !l.includes('INT-4')).join('\n'))) === 'И3');  check('ring-q-one: участников 7, INT-10 от returns-api, INT-11 без стрелки', [...new Set(QT['ring-q-one'].flatMap((c) => namesOf(c.hops) ?? []))].join() === R1P.join()
    && QT['ring-q-one'][9].hops[0].a === 'returns-api' && QT['ring-q-one'][10].hops === null);
  check('rep-q-mmd: INT-9 — 1С → repairy-api, INT-8 — к ЮKassa, YooKassa среди сторон нет', QT['rep-q-mmd'][8].hops.map((h) => `${h.a}>${h.b}`).join() === '1С>repairy-api'
    && QT['rep-q-mmd'][7].hops[0].b === 'ЮKassa' && !QT['rep-q-mmd'].some((c) => (namesOf(c.hops) ?? []).includes('YooKassa')));
  check('ring-q-one: раздельные участники → И6 и И11', reds(qg('ring-q-one', ringPuml)) === 'И6,И11');
  check('ring-q-one: стрелку склеил, участник «бэкенд возвратов» остался → И6', reds(qg('ring-q-one', ringPuml.replace('S8 -> S3 : INT-10', 'S2 -> S3 : INT-10'))) === 'И6');
  check('ring-q-two: склейка → И11', reds(qg('ring-q-two', QG['ring-q-one'])) === 'И11');
  check('rep-q-mmd: нет стрелки INT-9 → И3', reds(qg('rep-q-mmd', QG['rep-q-mmd'].replace('    S7->>S2: INT-9\n', ''))) === 'И3');
  check('rep-q-mmd: INT-9 в обратную сторону → И11', reds(qg('rep-q-mmd', QG['rep-q-mmd'].replace('S7->>S2: INT-9', 'S2->>S7: INT-9'))) === 'И11');
  check('rep-q-mmd: схема без учёта ответа (YooKassa отдельно, INT-9 нет) → И3, И6, И11', reds(qg('rep-q-mmd', pg.mmd)) === 'И3,И6,И11');
  check('chain-q-mmd: два звена вместо трёх → И3', reds(qg('chain-q-mmd', cg.mmd.replace('    S5->>S6: INT-3\n', ''))) === 'И3');

  // Этап К (4.0.0): имена проб, стороны для вопроса об участниках, истина после ответа, порядок карточек (И15), шапка (Ш1).
  const sp = (b) => { const p = parseProbe(b); return p?.st ? [p.name, p.fx, p.detailed ? 'det' : 'short', p.format, p.st.turns].join() : null; };
  check('этап: det-o-one, det-o-two, det-t-short → det, короткая, mmd, три хода; суффикс раунда не мешает', sp('det-o-one') === 'det-o-one,det,short,mmd,3'
    && sp('det-o-two') === 'det-o-two,det,short,mmd,3' && sp('det-o-two-r2') === 'det-o-two,det,short,mmd,3' && sp('det-t-short-r2') === 'det-t-short,det,short,mmd,3');
  check('этап: проб десять, имя из STAGE главнее QPROBES', Object.keys(STAGE).join() === 'det-o-one,det-o-two,det-t-short,det-y-short,id-q-mmd,chain-q-mmd,chain-q-idk,ring-q-one,ring-q-two,rep-q-mmd'
    && sp('det-y-short-r2') === 'det-y-short,det,short,mmd,3' && ['det-y', 'det-y-shortx'].every((b) => parseProbe(b) === null)
    && Object.keys(STAGE).every((k) => parseProbe(k).st === STAGE[k] && STAGE[k].turns === 3)
    && [sp('id-q-mmd'), sp('chain-q-mmd'), sp('chain-q-idk'), sp('ring-q-one'), sp('ring-q-two'), sp('rep-q-mmd')].join('|')
      === 'id-q-mmd,id,short,mmd,3|chain-q-mmd,chain,short,mmd,3|chain-q-idk,chain,short,mmd,3|ring-q-one,ring,short,puml,3|ring-q-two,ring,short,puml,3|rep-q-mmd,rep,short,mmd,3');
  check('этап: det-t-short — истина, порядок, шапка и В4 те же, что у det-o-one', JSON.stringify(STAGE['det-t-short']) === JSON.stringify(STAGE['det-o-one']));
  check('этап: det-o, det-o-three, det-one, det-o-onex, det-t, det-t-shortx → не распознано; старые пробы — не этапа', ['det-o', 'det-o-three', 'det-one', 'det-o-onex', 'det-t', 'det-t-shortx'].every((b) => parseProbe(b) === null)
    && ['det-q-mmd', 'det-q-puml', 'det-q-alt', 'det-short-mmd', 'det-mmd', 'ring-puml', 'chain-mmd', 'id-ask'].every((b) => parseProbe(b).st == null));
  const asIs = (fx) => withTruth(QC[fx], fx); // карточки до ответа аналитика
  check('этап, В1: стороны det — 6, id — 5 с «планшет группы»', sidesOf(asIs('det')).join() === TP.join() && sidesOf(asIs('id')).join() === DP.join());
  check('этап, В1: стороны chain — 7, INT-3 по TRUTH (gateway и records — не стороны)', sidesOf(asIs('chain')).join() === CP.join());
  check('этап, В1: стороны ring — 8 с «бэкенд возвратов»; «склад» и «1С» карточки без направления не требуются', sidesOf(asIs('ring')).join() === RP.join());
  check('этап, В1: стороны rep — 7, ЮKassa и YooKassa порознь; «1С» карточки без направления не требуется', sidesOf(asIs('rep')).join() === PP.join());
  const ST = Object.fromEntries(Object.keys(STAGE).map((k) => [k, withAnswer(asIs(STAGE[k].fx), STAGE[k].truth)]));
  check('этап: в порядке — каждая нарисованная карточка по разу; без стрелок — INT-11 у ring-*, INT-3 у chain-q-idk', Object.keys(STAGE).every((k) => uniq(STAGE[k].order)
    && eqSet(STAGE[k].order, ST[k].filter((c) => c.hops).map((c) => c.n)))
    && Object.keys(STAGE).map((k) => ST[k].filter((c) => !c.hops).map((c) => c.n).join()).join('|') === '||||||3|11|11|');
  check('этап: порядок не известен только у chain-q-idk — он по номерам (1, 2, 4, 5), В4 ей не ставится; участников четыре, цепочка INT-2 без знака в скобках рисуется', Object.keys(STAGE).filter((k) => !STAGE[k].known).join() === 'chain-q-idk'
    && STAGE['chain-q-idk'].order.join() === '1,2,4,5' && Object.keys(STAGE).filter((k) => STAGE[k].said === null).join() === 'chain-q-idk'
    && sidesOf(ST['chain-q-idk']).join() === KP.join() && ST['chain-q-idk'][1].hops.length === 2
    && !/\([^)]*[↔←→]/.test(raw[1].border) && /\([^)]*[↔←→]/.test(raw[2].border));
  const asks = (fx) => cardAsks(asIs(fx)).map((p) => `${p.id} INT-${p.n}`).join();
  check('этап: вопрос по карточке — цепочки det INT-5, chain INT-2 и INT-3 (по тексту границы), нет направления ring INT-11, rep INT-9; у id таких нет',
    [asks('det'), asks('id'), asks('chain'), asks('ring'), asks('rep')].join('|') === 'цепочка INT-5||цепочка INT-2,цепочка INT-3|нет направления INT-11|нет направления INT-9');
  // Таблица проб раннера `run-ctx-v2.sh`: проба → поля строки (FIXTURE, PROMPT_FILE, TURN2_FILE, TURN3_FILE, TURNS_CAP).
  const RUN = Object.fromEntries([...(read(join(HERE, 'run-ctx-v2.sh')) ?? '').matchAll(/^\s*([\w-]+)\)\s+(FIXTURE=.*?);;\s*$/gm)]
    .map((m) => [m[1], Object.fromEntries([...m[2].matchAll(/(\w+)=([^;\s]+)/g)].map((x) => [x[1], x[2]]))]));
  const runFile = (k, f) => (RUN[k]?.[f] ? read(join(HERE, 'fixtures', RUN[k].FIXTURE, RUN[k][f])) : null);
  check('раннер: у проб STAGE и SCEN три хода — ход 2 «Короткую.» / «Сценарную.», реплика хода 3 на месте; формат назван в запросе; «сценар» в запросе только у det-t-short',
    [...Object.keys(STAGE), ...Object.keys(SCEN)].every((k) => {
      const p = STAGE[k] ?? SCEN[k];
      const prompt = runFile(k, 'PROMPT_FILE') ?? '';
      return RUN[k]?.FIXTURE === FIXTURES[p.fx] && RUN[k].TURNS_CAP === '3' && runFile(k, 'TURN2_FILE')?.trim() === (STAGE[k] ? 'Короткую.' : 'Сценарную.')
        && runFile(k, 'TURN3_FILE') != null && { mmd: /Mermaid/, puml: /PlantUML/ }[p.format].test(prompt) && /сценар/i.test(prompt) === (k === 'det-t-short');
    }));
  // Истина порядка обязана совпадать с репликой хода 3: реплику правят руками, и расхождение красит весь пул.
  const told = (k) => { const m = (runFile(k, 'TURN3_FILE') ?? '').match(/Порядок по времени:(.*)/); return m ? (m[1].match(/INT-\d+/g) ?? []).map((x) => x.slice(4)).join() : null; };
  check('этап: порядок в истине = порядку в реплике хода 3; в реплике chain-q-idk порядка нет; у det-y-short реплика «Да, всё верно.» — порядок как в списке, по номерам',
    Object.keys(STAGE).every((k) => (STAGE[k].confirm
      ? told(k) === null && runFile(k, 'TURN3_FILE')?.trim() === 'Да, всё верно.' && STAGE[k].known && STAGE[k].order.join() === ST[k].map((c) => c.n).join()
      : told(k) === (STAGE[k].known ? STAGE[k].order.join() : null)))
    && Object.keys(STAGE).filter((k) => STAGE[k].confirm).join() === 'det-y-short');
  const head = (k) => (STAGE[k].known ? 'по времени, со слов аналитика' : 'по номерам карточек, не по времени');
  const inOrder = (arrows, order) => order.flatMap((n) => arrows.filter((a) => a[0] === n));
  const SE = { 'det-o-one': [TP, TA], 'det-o-two': [TP, TA], 'det-t-short': [TP, TA], 'det-y-short': [TP, TA], 'id-q-mmd': [DP, DA], 'chain-q-mmd': [CP, CA], 'chain-q-idk': [KP, KA],
    'ring-q-one': [R1P, R1A], 'ring-q-two': [RP, RA], 'rep-q-mmd': [Q1P, Q1A] }; // участники и стрелки по истине пробы; порядок наводит `inOrder`
  const se = (k, order = STAGE[k].order, hd = head(k)) => build(STAGE[k].format, SE[k][0], inOrder(SE[k][1], order), hd);
  const sg = (k, text = se(k)) => ({ ...gradeDiagram(text, STAGE[k].format, ST[k], null, STAGE[k].order), 'Ш1 шапка: порядок': headOrder(text, STAGE[k].known) });
  for (const k of Object.keys(STAGE)) green(`${k}: эталон этапа — схема верна и Ш1`, sg(k));
  check('этап: в эталонах стрелок 7/7/7/7/6/8/5/10/10/9, И15 стоит у каждой пробы', Object.keys(STAGE).map((k) => (se(k).match(/INT-\d+/g) ?? []).length).join() === '7,7,7,7,6,8,5,10,10,9'
    && Object.keys(STAGE).every((k) => sg(k)['И15 порядок карточек по ответу'] === true));
  const byNum = (k) => [...STAGE[k].order].sort((a, b) => a - b);
  check('этап: стрелки по номерам карточек при ответе с другим порядком → И15', ['det-o-one', 'det-o-two', 'id-q-mmd', 'chain-q-mmd', 'ring-q-one', 'ring-q-two', 'rep-q-mmd']
    .every((k) => reds(sg(k, se(k, byNum(k)))) === 'И15'));
  check('этап: det-o-one с порядком det-o-two и наоборот → И15', reds(sg('det-o-one', se('det-o-two'))) === 'И15' && reds(sg('det-o-two', se('det-o-one'))) === 'И15');
  check('этап: звенья цепочки не подряд (INT-6 между звеньями INT-5; INT-4 между звеньями INT-3) → И15',
    reds(sg('det-o-one', build('mmd', TP, [...inOrder(TA, [1, 3, 4, 2]), TA[4], TA[6], TA[5]], head('det-o-one')))) === 'И15'
    && reds(sg('chain-q-mmd', build('mmd', CP, [...inOrder(CA, [1, 5, 2]), CA[3], CA[6], CA[4], CA[5]], head('chain-q-mmd')))) === 'И15');
  check('этап: стрелка без номера карточки между звеньями INT-5 → И3, И4; порядок карточек не задет',
    reds(sg('det-o-one', se('det-o-one').replace('    S2->>S6: INT-5', '    S2->>S1: ответ\n    S2->>S6: INT-5'))) === 'И3,И4');
  check('этап: chain-q-idk в порядке реплики chain-q-mmd (ответа о порядке не было) → И15', reds(sg('chain-q-idk', se('chain-q-idk', [1, 5, 2, 4]))) === 'И15');
  check('этап: ring-q-one с отдельным участником «бэкенд возвратов» → И6, И11', reds(sg('ring-q-one', se('ring-q-two'))) === 'И6,И11');
  check('этап: ring-q-two со склейкой → И11', reds(sg('ring-q-two', se('ring-q-one'))) === 'И11');
  check('этап: rep-q-mmd без стрелки INT-9 → И3 (и И15: карточки нет в порядке)', reds(sg('rep-q-mmd', se('rep-q-mmd').replace('    S7->>S2: INT-9\n', ''))) === 'И3,И15');
  check('этап: chain-q-idk с нарисованной INT-3 → И3, И6, И15', reds(sg('chain-q-idk', build('mmd', CP, CA, head('chain-q-idk')))) === 'И3,И6,И15');
  check('этап: chain-q-idk без цепочки INT-2 (знака в скобках у неё нет — без ответа она рисуется) → И3, И15',
    reds(sg('chain-q-idk', build('mmd', ['clinic-web', 'booking-api', 'notify'], [KA[0], [4, 2, 3, '~', 'appointment.created'], KA[4]], head('chain-q-idk')))) === 'И3,И15');
  check('этап: шапка «по времени, со слов аналитика» у chain-q-idk → Ш1', reds(sg('chain-q-idk', se('chain-q-idk', undefined, 'по времени, со слов аналитика'))) === 'Ш1');
  check('этап: шапка «по номерам карточек, не по времени» у det-o-one → Ш1', reds(sg('det-o-one', se('det-o-one', undefined, 'по номерам карточек, не по времени'))) === 'Ш1');
  check('этап, Ш1: шапки нет → красный при любом порядке; «по номерам карточек» рядом с «со слов аналитика» → красный', reds(sg('det-o-one', se('det-o-one', undefined, null))) === 'Ш1'
    && reds(sg('chain-q-idk', se('chain-q-idk', undefined, null))) === 'Ш1' && headOrder('порядок стрелок — по номерам карточек, со слов аналитика', false) === false);
  check('этап, Ш1: фраза с переносом строки шапки (Mermaid `>`, PlantUML `\'`) и с заглавной — та же фраза',
    headOrder(se('det-o-one').replace('—\n> по времени, со слов аналитика', '— по времени, со\n> слов аналитика'), true)
    && headOrder(se('ring-q-one').replace("—\n' по времени, со слов аналитика", "— По времени, со\n' слов аналитика"), true)
    && se('det-o-one').includes('—\n> по времени, со слов аналитика') && se('ring-q-one').includes("—\n' по времени, со слов аналитика"));
  check('пороги короткой (§9): пара порядка 16/20, пара имён 15/20, контроль 18/20, спросил 68/80, схема верна 64/80; ниже на один — нет; без прогонов — нет',
    passes([16, 20], GATES.short.order) && !passes([15, 20], GATES.short.order) && passes([15, 20], GATES.short.names) && !passes([14, 20], GATES.short.names)
    && passes([18, 20], GATES.short.solo) && !passes([17, 20], GATES.short.solo) && passes([68, 80], GATES.short.asked) && !passes([67, 80], GATES.short.asked)
    && passes([64, 80], GATES.short.core) && !passes([63, 80], GATES.short.core) && !passes([0, 0], GATES.short.core));
  check('пороги сценарной (§10): спросил 36/40, схема верна 28/40, пара 14/20; ниже на один — нет', passes([36, 40], GATES.scen.asked) && !passes([35, 40], GATES.scen.asked)
    && passes([28, 40], GATES.scen.core) && !passes([27, 40], GATES.scen.core) && passes([14, 20], GATES.scen.pair) && !passes([13, 20], GATES.scen.pair));

  // Этап С (сценарная, 4.1.0): тела карточек, истина по пробам, эталоны в обоих форматах, мутации по С-якорям.
  const SB = bodies(detSpec);
  check('сценарная: тела PRK-9 — поля в фигурных скобках и поля события; путь `/{id}`, «не применимо», «пустое тело» — не тело',
    Object.entries(SB).map(([n, b]) => `${n}:${b.req.join('+')}/${b.ans.join('+')}`).join(' ') === '1:zoneId+plate/sessionId+startedAt 2:sessionId+plate+startedAt/ 3:/pricePerHour+freeMinutes 4:/ 5:/amount+status 6:plate+passedAt/');
  const tableOk = (scen) => {
    const inScen = scen.map((rows) => [...new Set(rows.filter((x) => x[0] === 'r').map((x) => x[1]))]);
    return uniq(inScen.flat()) && eqSet(inScen.flat(), det.map((c) => c.n)) && scen.every((rows, i) => inScen[i].every((n) => {
      const c = det.find((x) => x.n === n);
      const has = (k, j = 1) => rows.some((x) => x[0] === k && x[1] === n && (x[2] ?? 1) === j);
      return c.hops.every((h, j) => has('r', j + 1) && has('a', j + 1) === (!c.event && h.sign !== '↔'))
        && has('q') === SB[n].req.length > 0 && has('p') === SB[n].ans.length > 0;
    }) && rows.every((x, k) => x[0] !== 'u' || (k === 0 && /нажал/.test(det.find((c) => c.n === x[1]).trigger))));
  };
  check('сценарная: истина А, Б и «не знаю» — карточка ровно в одном сценарии, все звенья, ответ у каждого → и ←, пометка ровно где тело, пользователь первым и только у «нажал»',
    [SCEN_A, SCEN_B, SCEN_IDK].every(tableOk));
  check('сценарная: сценариев А — 3, Б — 2, «не знаю» — 6; пользователь в А и Б у INT-1 и INT-5, в «не знаю» — нигде; шаг — только в А, у parking-api после запроса INT-1',
    [SCEN_A, SCEN_B, SCEN_IDK].map((s) => s.length).join() === '3,2,6'
    && [SCEN_A, SCEN_B, SCEN_IDK].map((s) => s.filter((rows) => rows[0][0] === 'u').map((rows) => rows[0][1]).join('+')).join('|') === '1+5|1+5|'
    && JSON.stringify(stepPlaces(scenTruth(SCEN_A[0], det))) === JSON.stringify([{ who: 'parking-api', text: '', word: 'сессии', at: 'r1.1|r3.1' }])
    && [SCEN_B, SCEN_IDK].every((s) => s.every((rows) => rows.every((x) => x[0] !== 's'))));
  check('сценарная: пробы — det-s-mmd, det-s-puml (А), det-s-alt (Б), det-s-idk (не знаю), det-y-scen (гипотеза хода 2), rep-s-mmd (REP-214), chb-s-mmd, chb-s-idk (ESS-31, тела по звеньям); у всех три хода; имя разбирается, суффикс раунда не мешает; det-s, det-s-xyz, det-y, rep-s, chb-s, chb-s-puml → не распознано',
    Object.keys(SCEN).map((k) => { const p = parseProbe(`${k}-r2`); return `${p.name}:${p.format}:${p.sc === SCEN[k]}:${SCEN[k].turns}:${!p.st && !p.q}`; }).join()
      === 'det-s-mmd:mmd:true:3:true,det-s-puml:puml:true:3:true,det-s-alt:mmd:true:3:true,det-s-idk:mmd:true:3:true,det-y-scen:mmd:true:3:true,rep-s-mmd:mmd:true:3:true,'
      + 'chb-s-mmd:mmd:true:3:true,chb-s-idk:mmd:true:3:true'
    && SCEN['det-s-mmd'].scen === SCEN_A && SCEN['det-s-puml'].scen === SCEN_A && SCEN['det-s-alt'].scen === SCEN_B && SCEN['det-s-idk'].scen === SCEN_IDK
    && SCEN['det-y-scen'].dyn && SCEN['det-y-scen'].scen === null && SCEN['rep-s-mmd'].scen === SCEN_REP && SCEN['rep-s-mmd'].fx === 'rep'
    && SCEN['chb-s-mmd'].scen === SCEN_CHB && SCEN['chb-s-idk'].scen === SCEN_CHB_IDK && ['chb-s-mmd', 'chb-s-idk'].every((k) => SCEN[k].fx === 'chb')
    && Object.keys(SCEN).filter((k) => SCEN[k].opt).join() === 'chb-s-mmd,chb-s-idk'
    && ['det-s', 'det-s-xyz', 'det-s-mmdx', 'det-y', 'det-y-scenx', 'rep-s', 'rep-s-puml', 'chb-s', 'chb-s-puml', 'chb-s-mmdx'].every((b) => parseProbe(b) === null) && parseProbe('det-short-mmd').sc == null);
  // Истина построчно — второй записью, чтобы правка таблицы `SCEN_*` не прошла молча (эталоны собираются из неё же).
  const flowOf = (scen) => scen.map((rows) => scenTruth(rows, det).map((e) => (e.cls === 'user' ? 'u' : e.cls === 'step' ? `s:${e.who}` : e.key)).join(' ')).join(' | ');
  check('сценарная: истина А построчно', flowOf(SCEN_A) === 'u r1.1 q1 s:parking-api r3.1 a3.1 p3 r4.1 a4.1 a1.1 p1 r2.1 q2 | u r5.1 r5.2 a5.2 a5.1 p5 | r6.1 q6 a6.1');
  check('сценарная: истина Б построчно', flowOf(SCEN_B) === 'u r1.1 q1 r3.1 a3.1 p3 a1.1 p1 r4.1 a4.1 r2.1 q2 | u r5.1 r5.2 a5.2 a5.1 p5 r6.1 q6 a6.1');
  check('сценарная: истина «не знаю» построчно', flowOf(SCEN_IDK) === 'r1.1 q1 a1.1 p1 | r2.1 q2 | r3.1 a3.1 p3 | r4.1 a4.1 | r5.1 r5.2 a5.2 a5.1 p5 | r6.1 q6 a6.1');
  check('сценарная: стороны в истине — INT-6 от gate-controller к parking-api, ответ обратно; пометки над получателями', JSON.stringify(scenTruth(SCEN_A[2], det).map((e) => e.ends ?? e.over))
    === JSON.stringify([['gate-controller', 'parking-api'], 'parking-api', ['parking-api', 'gate-controller']])
    && scenTruth(SCEN_A[0], det).filter((e) => e.cls === 'note').map((e) => e.over).join() === 'parking-api,parking-api,parking-web,notify');
  const tailOf = (n, j) => TA.filter((a) => a[0] === n)[j - 1][4];
  // Фикстура сценарной пробы: карточки после ответа, тела, хвосты подписей, ключ спеки. Истина `det-y-scen` в эталонах
  // ниже — гипотеза вопросов `S1` (`SCEN_T`), сама гипотеза проверяется отдельно.
  const RB = bodies(repSpec);
  const REPC = withAnswer(rp, SCEN['rep-s-mmd'].truth);
  const tailRep = (n) => Q1A.find((a) => a[0] === n)[4];
  // ESS-31 (тела по звеньям): карточки, тела с `CHB_AT`, хвосты подписей — методы контракта по звеньям.
  const chbSpec = read(join(fixDir('chb'), specRel('chb')));
  const chb = parseCards(chbSpec);
  const CB = withAt(bodies(chbSpec), CHB_AT);
  const tailChb = (n, j) => chb.find((c) => c.n === n).paths[j - 1]?.join(' ') ?? '';
  const FXS = { det: { cards: det, body: SB, tail: tailOf, key: 'PRK-9' }, rep: { cards: REPC, body: RB, tail: tailRep, key: 'REP-214' },
    chb: { cards: chb, body: CB, tail: tailChb, key: 'ESS-31' } };
  const SCEN_T = Object.fromEntries(Object.keys(SCEN).map((k) => [k, SCEN[k].scen]));
  const se2 = (k, format = SCEN[k].format, scen = SCEN_T[k], known = SCEN[k].known, body = FXS[SCEN[k].fx].body) => {
    const x = FXS[SCEN[k].fx];
    return buildScen(format, scen, x.cards, body, { tail: x.tail, step: () => 'проверить, что открытой сессии нет', known, key: x.key });
  };
  const sg2 = (k, text, format = SCEN[k].format) => ({ ...gradeScenarios(text, format, FXS[SCEN[k].fx].cards, SCEN_T[k], FXS[SCEN[k].fx].body, SCEN[k].maybe, { over: !!SCEN[k].over }),
    'Ш1 шапка: источник сценариев': headScen(text, SCEN[k].known) });
  for (const k of Object.keys(SCEN).filter((x) => SCEN[x].fx === 'det' && SCEN[x].scen)) for (const f of ['mmd', 'puml']) green(`${k} ${f}: эталон сценарной зелёный`, sg2(k, se2(k, f), f));
  // Мутация строк истины: сценарий i пробы k переписан функцией `fn`, эталон собран заново и оценён по истине пробы.
  const sm = (k, i, fn, f = SCEN[k].format) => reds(sg2(k, se2(k, f, SCEN[k].scen.map((rows, x) => (x === i ? fn(rows.map((row) => [...row])) : rows))), f));
  const at = (rows, row) => rows.findIndex((x) => x.join() === row.join());
  const drop = (...gone) => (rows) => rows.filter((x) => !gone.some((g) => g.join() === x.join()));
  const put = (after, ...added) => (rows) => { const i = at(rows, after) + 1; return [...rows.slice(0, i), ...added, ...rows.slice(i)]; };
  check('С3: перестановка карточек (INT-2 раньше INT-4 в det-s-alt; INT-5 и INT-6 в det-s-alt; вложенные INT-3 и INT-4 в det-s-puml) → С3 и С4 (место ответов — в общей последовательности), у det-s-puml ещё С6 (шаг перед INT-3)',
    sm('det-s-alt', 0, (rows) => [...rows.slice(0, 8), ['r', 2], ['q', 2], ['r', 4], ['a', 4]]) === 'С3,С4'
    && sm('det-s-alt', 1, (rows) => [rows[0], ...rows.slice(6), ...rows.slice(1, 6)]) === 'С3,С4'
    && sm('det-s-puml', 0, (rows) => [...rows.slice(0, 4), ...rows.slice(7, 9), ...rows.slice(4, 7), ...rows.slice(9)]) === 'С3,С4,С6');
  check('С4: вложенная карточка INT-3 после ответа внешней INT-1 → только С4', sm('det-s-alt', 0, (rows) => [rows[0], rows[1], rows[2], rows[6], rows[7], rows[3], rows[4], rows[5], ...rows.slice(8)]) === 'С4');
  check('С4: ответ у события INT-2, пропущенный ответ INT-4, лишний ответ INT-3, ответы цепочки INT-5 не в том порядке → С4',
    sm('det-s-mmd', 0, put(['q', 2], ['a', 2])) === 'С4' && sm('det-s-mmd', 0, drop(['a', 4])) === 'С4' && sm('det-s-mmd', 0, put(['a', 3], ['a', 3])) === 'С4'
    && sm('det-s-mmd', 1, () => [['u', 5], ['r', 5, 1], ['r', 5, 2], ['a', 5, 1], ['p', 5], ['a', 5, 2]]) === 'С4');
  const e1 = se2('det-s-mmd');
  check('С3: запрос INT-6 в обратную сторону (от parking-api к gate-controller) → С3', e1.includes('S1->>S2: INT-6') && reds(sg2('det-s-mmd', e1.replace('S1->>S2: INT-6', 'S2->>S1: INT-6'))) === 'С3');
  check('С4: ответ сплошной стрелкой — это лишний запрос → С3, С4 и С5 (пометка тела ответа уже не после ответа); ответ асинхронной стрелкой → С4',
    reds(sg2('det-s-mmd', e1.replace('S3-->>S2: INT-3 · ответ', 'S3->>S2: INT-3 · ответ'))) === 'С3,С4,С5'
    && reds(sg2('det-s-mmd', e1.replace('S3-->>S2: INT-3 · ответ', 'S3--)S2: INT-3 · ответ'))) === 'С4');
  check('С5: пометка у карточки без тела (INT-4), не сразу после запроса (после шага), без поля plate → С5',
    sm('det-s-mmd', 0, put(['a', 4], ['p', 4])) === 'С5' && sm('det-s-mmd', 0, (rows) => put(['s', 'parking-api', 'сессии'], ['q', 1])(drop(['q', 1])(rows))) === 'С5'
    && reds(sg2('det-s-mmd', e1.replace('{ zoneId, plate }', '{ zoneId }'))) === 'С5' && sm('det-s-idk', 1, drop(['q', 2])) === 'С5');
  check('С6: пропущенный шаг, лишний шаг (det-s-alt), шаг не той стороной, шаг не на месте, текст шага без «сессии» → С6',
    sm('det-s-mmd', 0, drop(['s', 'parking-api', 'сессии'])) === 'С6' && sm('det-s-alt', 0, put(['q', 1], ['s', 'parking-api', 'сессии'])) === 'С6'
    && sm('det-s-mmd', 0, (rows) => rows.map((x) => (x[0] === 's' ? ['s', 'parking-web', 'сессии'] : x))) === 'С6'
    && sm('det-s-mmd', 0, (rows) => put(['p', 3], ['s', 'parking-api', 'сессии'])(drop(['s', 'parking-api', 'сессии'])(rows))) === 'С6'
    && reds(sg2('det-s-mmd', e1.replace('проверить, что открытой сессии нет', 'проверить номер'))) === 'С6');
  const lastBlock = (text, from, to) => { const i = text.lastIndexOf(from); return text.slice(0, i) + to + text.slice(i + from.length); };
  check('С7: actor в сценарии без пользователя (mmd и puml), сценарий пользователя без него, стрелка пользователя без текста «Триггера» → С7',
    reds(sg2('det-s-mmd', lastBlock(e1, 'sequenceDiagram\n', 'sequenceDiagram\n    actor U as Пользователь\n'))) === 'С7'
    && reds(sg2('det-s-puml', lastBlock(se2('det-s-puml'), '@startuml\n', '@startuml\nactor "Пользователь" as U\n'), 'puml')) === 'С7'
    && sm('det-s-mmd', 1, drop(['u', 5])) === 'С7' && reds(sg2('det-s-mmd', e1.replace('U->>S1: водитель нажал «Завершить и оплатить»', 'U->>S1: оплата'))) === 'С7'
    && reds(sg2('det-s-mmd', e1.replace('U->>S1: водитель нажал «Начать', 'U->>S2: водитель нажал «Начать'))) === 'С7'
    && reds(sg2('det-s-mmd', e1.replace('U->>S1: водитель нажал «Начать', 'U->>S1: «водитель» нажал Начать'))) === '');
  const merged = se2('det-s-mmd', 'mmd', [SCEN_A[0], [...SCEN_A[1], ...SCEN_A[2]]]);
  check('С2: два сценария слиты в один → С2 (и якоря пары, где сценарий не совпал); сценариев больше, чем в истине → С2',
    reds(sg2('det-s-mmd', merged)).startsWith('С2,С3,С4,С5') && reds(sg2('det-s-alt', e1)).startsWith('С2'));
  check('И-якоря в сценарии: алиас не S1 → И10; чужой путь → И9; событие синхронной стрелкой → И8; участник из другого сценария → И6; `activate` → И5; плейсхолдер → И12',
    reds(sg2('det-s-mmd', e1.replace(/S5/g, 'N5'))) === 'И10'
    && reds(sg2('det-s-mmd', e1.replace('INT-3 · GET /internal/tariffs/{zoneId}', 'INT-3 · GET /internal/tariffs'))) === 'И9'
    && reds(sg2('det-s-mmd', e1.replace('S2-)S5: INT-2', 'S2->>S5: INT-2'))) === 'И8'
    && reds(sg2('det-s-mmd', e1.replace('    participant S3 as billing', '    participant S3 as billing\n    participant S4 as notify'))) === 'И6'
    && reds(sg2('det-s-mmd', e1.replace('    S2->>S2: проверить', '    activate S2\n    S2->>S2: проверить'))) === 'И5'
    && reds(sg2('det-s-mmd', e1.replace('## Сценарий 3 — без пользователя: INT-6', '## Сценарий 3 — <текст «Триггера»>'))) === 'И12');
  check('Ш1 сценарной: «по сценариям со слов аналитика» у det-s-idk → Ш1; «по карточке на сценарий» у det-s-mmd → Ш1; перенос строки фразу не рвёт',
    reds(sg2('det-s-idk', se2('det-s-idk', 'mmd', SCEN_IDK, true))) === 'Ш1' && reds(sg2('det-s-mmd', se2('det-s-mmd', 'mmd', SCEN_A, false))) === 'Ш1'
    && headScen(e1.replace('по сценариям со слов аналитика', 'по сценариям со\n> слов аналитика'), true));

  // Тела по определению `reference/scenario.md`: скобки, перечисление (запятая, «и», подпункты), что не тело.
  const fo = (s, o) => fieldsOf(s, o).join('+');
  check('fieldsOf: {…} вне пути; перечисление после «тело:», метода (и «с»), имени события, «🟡 … —» и в начале строки; «и» и подпункты; скобки после имени не берутся',
    fo('`POST /v1/sessions`, тело `{ zoneId, plate }`') === 'zoneId+plate' && fo('`GET /internal/tariffs/{zoneId}`') === '' && fo('тело: zoneId, plate') === 'zoneId+plate'
    && fo('`noteId` (string), `state` (enum: `open`, `closed`)') === 'noteId+state' && fo('`id` возврата и `status`') === 'id+status'
    && fo('🟡 к валидации — предположительно `POST /v3/refunds` с `payment_id` и `amount`; заголовок `Idempotence-Key`') === 'payment_id+amount'
    && fo('`session.started` — `sessionId`, `plate`', { event: true }) === 'sessionId+plate' && fo('🟡 к валидации — `id`, `status`') === 'id+status'
    && fo('', { subs: ['`paymentId` (string) — id платежа', '`status`: enum'] }) === 'paymentId+status'
    && fo('`parking-web` получает от `parking-api` `{ amount, status: "paid" }`; тело ответа `billing` для `parking-api` в спеке не описано') === 'amount+status');
  check('fieldsOf: не тело — заголовок со значением, код ответа, одно имя во фразе, «ETag объекта», PutObject с ключом-путём, имя стороны, имя события, TBD, ❓',
    fo('`POST /v3/payments` — `amount`, `capture`; заголовок `Idempotence-Key` = `paymentId`') === 'amount+capture' && fo('`200` без тела; любой другой код — повтор') === ''
    && fo('переход по `confirmation_url`; по завершении провайдер возвращает браузер на `return_url`') === '' && fo('ETag объекта') === ''
    && fo('PutObject в бакет документов, ключ `projects/{pid}/receipts/{paymentId}.pdf`, `Content-Type: application/pdf`') === ''
    && fo('`a`, `parking-api`', { skip: new Set(['parking-api']) }) === 'a' && fo('`session.started`', { event: true }) === '' && fo('TBD') === '' && fo('❓ зависит от направления') === '');
  check('сценарная: тела PRK-9 — правка «Контракт (ответ)» INT-5 («`parking-web` получает от `parking-api` `{ amount, status }`; тело `billing` не описано») читается как прежде: amount, status',
    SB[5].ans.join() === 'amount,status' && /parking-web` получает от `parking-api`/.test(detSpec));
  check('И0: спека PRK-9 до правки INT-5 — не правка; другая правка спеки — правка', specUntouched(detSpec, detSpec, 'det')
    && specUntouched(detSpec.replace(SPEC_PAST.det[0][0], SPEC_PAST.det[0][1]), detSpec, 'det') && !specUntouched(detSpec.replace('`409`', '`410`'), detSpec, 'det')
    && !specUntouched(detSpec.replace(SPEC_PAST.det[0][0], SPEC_PAST.det[0][1]), detSpec, 'rep') && !specUntouched(null, detSpec, 'det') && detSpec.includes(SPEC_PAST.det[0][0]));

  // rep-s-mmd: REP-214 по реплике `ID-REP/s-turn2.txt` — тела списком, двоякие пометки, склейка имён, INT-9 по ответу.
  check('rep-s-mmd: тела REP-214 — перечисления после «тело:», метода, имени события и в начале строки ответа; «с `payment_id` и `amount`», «`id` возврата и `status`» — тела; INT-3, INT-5, ответ INT-4 — без тела',
    Object.entries(RB).map(([n, b]) => `${n}:${b.req.join('+')}/${b.ans.join('+')}`).join(' ') === '1:acceptanceId+returnUrl/paymentId+status+amount+confirmationUrl '
    + '2:amount.value+amount.currency+confirmation.type+confirmation.return_url+capture+metadata.paymentId/id+status+confirmation.confirmation_url 3:/ '
    + '4:event+object.id+object.status+object.metadata.paymentId/ 5:/ 6:projectId+paymentId+amount+customerName/ 7:/paymentId+status+amount+paidAt+receiptUrl 8:payment_id+amount/id+status 9:/');
  const flowOfC = (scen, cards) => scen.map((rows) => scenTruth(rows, cards).map((e) => (e.cls === 'user' ? 'u' : e.cls === 'step' ? `s:${e.who}` : e.key)).join(' ')).join(' | ');
  check('rep-s-mmd: истина построчно — 4 сценария; INT-2 внутри INT-1, затем INT-3 и INT-7; INT-5 и INT-6 внутри INT-4; INT-8 с пользователем; INT-9 без',
    flowOfC(SCEN_REP, REPC) === 'u r1.1 q1 r2.1 q2 a2.1 p2 a1.1 p1 r3.1 r7.1 a7.1 p7 | r4.1 q4 r5.1 a5.1 r6.1 q6 a4.1 | u r8.1 q8 a8.1 p8 | r9.1 a9.1');
  const repInScen = SCEN_REP.map((rows) => [...new Set(rows.filter((x) => x[0] === 'r').map((x) => x[1]))]);
  check('rep-s-mmd: каждая карточка ровно в одном сценарии; ответ у каждого → и ←, у ↔ и события нет; пометка ровно где тело по `bodies`; пользователь первым у INT-1 и INT-8',
    uniq(repInScen.flat()) && eqSet(repInScen.flat(), REPC.map((c) => c.n)) && SCEN_REP.every((rows, i) => repInScen[i].every((n) => {
      const c = REPC.find((x) => x.n === n);
      const has = (k) => rows.some((x) => x[0] === k && x[1] === n);
      return has('a') === (!c.event && c.hops[0].sign !== '↔') && has('q') === RB[n].req.length > 0 && has('p') === RB[n].ans.length > 0;
    })) && SCEN_REP.map((rows) => (rows[0][0] === 'u' ? rows[0][1] : '-')).join() === '1,-,8,-');
  check('rep-s-mmd: стороны — INT-4 от ЮKassa к repairy-api, INT-8 к ЮKassa (YooKassa склеена), INT-9 от 1С, INT-3 двусторонняя; текст пользователя INT-8 — из реплики, «Триггер» его содержит',
    JSON.stringify(scenTruth(SCEN_REP[1], REPC)[0].ends) === JSON.stringify(['ЮKassa', 'repairy-api']) && scenTruth(SCEN_REP[2], REPC)[1].ends.join() === 'repairy-api,ЮKassa'
    && scenTruth(SCEN_REP[3], REPC)[0].ends.join() === '1С,repairy-api' && scenTruth(SCEN_REP[0], REPC)[9].both === true
    && bare(rp[7].trigger).includes(bare(SCEN_REP[2][0][2])) && bare(rp[0].trigger) === bare(SCEN_REP[0][0][2]));
  const eR = se2('rep-s-mmd');
  green('rep-s-mmd: эталон сценарной зелёный', sg2('rep-s-mmd', eR));
  // Двоякие пометки INT-5: строки истины с пометкой и тело для неё — эталон «пометка есть».
  const withNotes = (q, p, body5) => se2('rep-s-mmd', 'mmd', SCEN_REP.map((rows, i) => (i !== 1 ? rows
    : rows.flatMap((x) => (x.join() === 'r,5' && q ? [x, ['q', 5]] : x.join() === 'a,5' && p ? [x, ['p', 5]] : [x])))), true, { ...RB, 5: body5 });
  check('rep-s-mmd, двоякие места: пометка запроса INT-5 («ключ …») и ответа («ETag») — годятся и есть, и нет, порознь и вместе; текст «Key», путь «projects/…» тоже',
    [[true, false], [false, true], [true, true]].every(([q, p]) => reds(sg2('rep-s-mmd', withNotes(q, p, { req: ['ключ', 'Content-Type'], ans: ['ETag'] }))) === '')
    && reds(sg2('rep-s-mmd', withNotes(true, false, { req: ['Key'], ans: [] }))) === '' && reds(sg2('rep-s-mmd', withNotes(true, false, { req: ['projects/{pid}/receipts/{paymentId}.pdf'], ans: [] }))) === '');
  check('rep-s-mmd, двоякие места: пометка INT-5 не о том ({ pid, paymentId } из пути; ответ без ETag) → С5; две пометки запроса INT-5 → С5',
    reds(sg2('rep-s-mmd', withNotes(true, false, { req: ['pid', 'paymentId'], ans: [] }))) === 'С5' && reds(sg2('rep-s-mmd', withNotes(false, true, { req: [], ans: ['200'] }))) === 'С5'
    && reds(sg2('rep-s-mmd', eR.replace('    S2->>S3: INT-5\n', '    S2->>S3: INT-5\n    Note over S3: ключ\n    Note over S3: ключ\n'))) === 'С5');
  // Имена через точку (INT-2 `amount.value`, `metadata.paymentId`; INT-4 `object.id`; ответ INT-2 `confirmation.confirmation_url`):
  // годятся как написано, свёрнутыми до верхнего уровня и вперемешку; нет ни имени, ни его верхнего уровня → С5.
  const repBody = (b2req, b2ans, b4req) => se2('rep-s-mmd', 'mmd', SCEN_REP, true, { ...RB, 2: { req: b2req, ans: b2ans }, 4: { req: b4req, ans: [] } });
  check('rep-s-mmd, тела с точкой: свёрнутые до верхнего уровня (amount, confirmation, metadata, object) и вперемешку — зелёный; без metadata или без object → С5',
    reds(sg2('rep-s-mmd', repBody(['amount', 'confirmation', 'capture', 'metadata'], ['id', 'status', 'confirmation'], ['event', 'object']))) === ''
    && reds(sg2('rep-s-mmd', repBody(['amount.value', 'amount.currency', 'confirmation', 'capture', 'metadata.paymentId'], ['id', 'status', 'confirmation.confirmation_url'], ['event', 'object.id', 'object']))) === ''
    && reds(sg2('rep-s-mmd', repBody(['amount', 'confirmation', 'capture'], ['id', 'status', 'confirmation'], ['event', 'object']))) === 'С5'
    && reds(sg2('rep-s-mmd', repBody(['amount', 'confirmation', 'capture', 'metadata'], ['id', 'status', 'confirmation'], ['event', 'status']))) === 'С5'
    && reds(sg2('rep-s-mmd', repBody(['amount', 'confirmation', 'capture', 'metadata'], ['id', 'status'], ['event', 'object']))) === 'С5');
  const rm = (fn) => reds(sg2('rep-s-mmd', se2('rep-s-mmd', 'mmd', SCEN_REP.map((rows, i) => fn(rows.map((r) => [...r]), i)))));
  check('rep-s-mmd: пометки по определению — нет пометки запроса INT-8 («с … и …») или ответа INT-8 («… и …») → С5; пометка «переход по `confirmation_url`» у INT-3 или «200» у ответа INT-4 → С5',
    rm((rows, i) => (i === 2 ? drop(['q', 8])(rows) : rows)) === 'С5' && rm((rows, i) => (i === 2 ? drop(['p', 8])(rows) : rows)) === 'С5'
    && reds(sg2('rep-s-mmd', eR.replace('INT-3\n', 'INT-3\n    Note over S3: { confirmation_url }\n'))) === 'С5'
    && reds(sg2('rep-s-mmd', eR.replace('INT-4 · ответ\n', 'INT-4 · ответ\n    Note over S2: 200\n'))) === 'С5');
  check('rep-s-mmd: INT-6 после ответа INT-4, а не внутри → С4; INT-9 от repairy-api к 1С → С3 и С4; стрелка пользователя INT-8 с «Триггером» целиком — годится, без «Вернуть» → С7',
    rm((rows, i) => (i === 1 ? [...rows.slice(0, 4), rows[6], rows[4], rows[5]] : rows)) === 'С4'
    && reds(sg2('rep-s-mmd', eR.replace('S1->>S2: INT-9', 'S2->>S1: INT-9').replace('S2-->>S1: INT-9', 'S1-->>S2: INT-9'))) === 'С3,С4'
    && reds(sg2('rep-s-mmd', eR.replace('U->>S1: владелец компании нажимает «Вернуть» у оплаченного онлайн-платежа', `U->>S1: ${rp[7].trigger}`))) === ''
    && reds(sg2('rep-s-mmd', eR.replace('U->>S1: владелец компании нажимает «Вернуть» у оплаченного онлайн-платежа', 'U->>S1: владелец оформляет возврат'))) === 'С7');
  const yoo = eR.replace(/(## Сценарий 3[\s\S]*?)as ЮKassa/, '$1as YooKassa');
  check('rep-s-mmd: INT-8 к отдельному участнику YooKassa (склейку не учёл) → С3 и И6 среди красных', yoo !== eR && ['С3', 'И6'].every((k) => reds(sg2('rep-s-mmd', yoo)).split(',').includes(k)));

  // chb-s-mmd, chb-s-idk: ESS-31 — тела по звеньям цепочки; эталон по требованию владельца, а не по тексту скилла.
  check('chb: карточек 3, звеньев 3/2/1; стороны INT-1 — school-web, school-api, essay-checker, Lexa («(внешний LLM)» снято); вопрос по карточке — цепочки INT-1 и INT-2',
    chb.map((c) => c.hops.length).join() === '3,2,1' && sides(chb[0].border).join() === 'school-web,school-api,essay-checker,Lexa'
    && sidesOf(chb).join() === 'school-web,school-api,essay-checker,Lexa,plagiarism-check,journal-service'
    && cardAsks(chb).map((p) => `${p.id} INT-${p.n}`).join() === 'цепочка INT-1,цепочка INT-2' && chb.every((c) => !c.event && c.hops.every((h) => h.sign === '→')));
  check('chb: методы по звеньям — INT-1 из подпунктов «Контракт (по звеньям)» (у звена 3 метода нет), у INT-2 методов нет, у INT-3 один',
    chb.map((c) => c.paths.map((p) => p.join(' ')).join('+')).join(' | ') === 'POST /v1/essays/{essayId}/review+POST /internal/reviews |  | POST /v1/journal/batch');
  const subOf = (pre) => chbSpec.split('\n').find((l) => l.trimStart().startsWith(pre)) ?? '';
  check('chb: тела — у INT-1 полей шаблона нет («по звеньям»), тела среднего звена — из его подпункта (`CHB_AT`), у звена 1 «тела нет», у звена 3 контракта нет; INT-2 и INT-3 — по `bodies`',
    Object.entries(bodies(chbSpec)).map(([n, b]) => `${n}:${b.req.join('+')}/${b.ans.join('+')}`).join(' ') === '1:/ 2:language+threshold/similarity+matches 3:classId+grades/accepted+rejected'
    && /^\s+- `school-api` → `essay-checker`: `POST \/internal\/reviews`, .*Запрос — JSON `ReviewRequest \{ essayText, gradeLevel \}`\. Ответ — JSON `ReviewResult \{ score \}`\.$/.test(subOf('- `school-api` → `essay-checker`'))
    && /тела нет/.test(subOf('- `school-web` → `school-api`')) && /не описан/.test(subOf('- `essay-checker` → Lexa'))
    && JSON.stringify(CHB_AT) === '{"1":{"2":{"req":["essayText","gradeLevel"],"ans":["score"]}}}'
    && [['q1.2', 1], ['p1.2', 1], ['q1', 1], ['q2.2', 2], ['p2.2', 2], ['q3', 3], ['p3', 3]].map(([key, n]) => bodyOf(CB, key, n).join('+')).join(' ')
      === 'essayText+gradeLevel score  language+threshold similarity+matches classId+grades accepted+rejected');
  const bLines = chbSpec.split('\n').filter((l) => /^- \*\*Контракт \((запрос|ответ)\):\*\* .*(language|similarity)/.test(l));
  check('chb: звено тел INT-2 из карточки не определить — в «Контракт (запрос)» и «Контракт (ответ)» только тела: ни метода с путём, ни имён сторон',
    bLines.join('\n') === '- **Контракт (запрос):** тело `{ language, threshold }`\n- **Контракт (ответ):** `{ similarity, matches }`'
    && bLines.every((l) => !PATH_RE.test(l) && !sidesOf(chb).some((nm) => l.includes(nm))));
  check('chb: истина построчно — пометки INT-1 у звена 2 (запрос — после r1.2, ответ — после a1.2), у звеньев 1 и 3 нет; INT-2 — у звена 2 по реплике, на «не знаю» нет; INT-3 — контроль',
    flowOfC(SCEN_CHB, chb) === 'u r1.1 r1.2 q1.2 r1.3 a1.3 a1.2 p1.2 a1.1 | u r2.1 r2.2 q2.2 a2.2 p2.2 a2.1 | r3.1 q3 a3.1 p3'
    && flowOfC(SCEN_CHB_IDK, chb) === 'u r1.1 r1.2 q1.2 r1.3 a1.3 a1.2 p1.2 a1.1 | u r2.1 r2.2 a2.2 a2.1 | r3.1 q3 a3.1 p3');
  check('chb: пометки над получателями — запрос INT-1 над essay-checker, ответ над school-api; INT-2 — над plagiarism-check и school-api; INT-3 — над journal-service и school-api',
    SCEN_CHB.map((rows) => scenTruth(rows, chb).filter((e) => e.cls === 'note').map((e) => `${e.key}:${e.over}`).join()).join(' | ')
      === 'q1.2:essay-checker,p1.2:school-api | q2.2:plagiarism-check,p2.2:school-api | q3:journal-service,p3:school-api');
  const chbTurn = (f) => read(join(fixDir('chb'), f)) ?? '';
  const [sT, iT] = [chbTurn('s-turn2.txt').split('\n'), chbTurn('idk-turn2.txt').split('\n')];
  check('chb: реплики хода 3 различаются одной строкой о телах INT-2 (звено school-api → plagiarism-check / «не знаю»), о телах INT-1 молчат; сценарии реплики = истине; тип — «Сценарную.»; в запросе нет «сценар»',
    sT.length === iT.length && sT.filter((l, i) => l !== iT[i]).join('|') === 'Тела INT-2 (запрос и ответ) — звена school-api → plagiarism-check.'
    && iT.filter((l, i) => l !== sT[i]).join('|') === 'Тела INT-2 — не знаю, к какому звену они относятся.' && !/Тел[аоу]? INT-1/.test(sT.join('\n'))
    && /1\) «ученик нажал «Проверить эссе» на странице задания» — INT-1; до ответа INT-1 и после него других карточек нет\. 2\) «учитель нажал «Проверить на заимствования» в карточке эссе» — INT-2; до ответа INT-2 и после него других карточек нет\. Без пользователя: INT-3\./.test(sT.join('\n'))
    && [chb[0].trigger, chb[1].trigger].every((t) => sT.join('\n').includes(`«${t}»`)) && SCEN_CHB.map((rows) => rows[0][0]).join() === 'u,u,r'
    && chbTurn('type-scen-turn2.txt').trim() === 'Сценарную.' && !/сценар/i.test(chbTurn('mmd-prompt.txt')) && /Mermaid/.test(chbTurn('mmd-prompt.txt')));
  const chbMan = chbTurn('_manifest.txt').split('\n').filter(Boolean);
  check('chb: манифест = файлам фикстуры (без него самого); реплики — `*-turn2.txt`, промпт — `*-prompt.txt`', chbMan.length === listFiles(fixDir('chb')).length - 1
    && eqSet(chbMan, listFiles(fixDir('chb')).filter((f) => f !== '_manifest.txt'))
    && ['coddoc/ESS-31/technical_specification.md', 's-turn2.txt', 'idk-turn2.txt', 'type-scen-turn2.txt', 'mmd-prompt.txt', 'README.md'].every((f) => chbMan.includes(f)));
  const eC = { mmd: se2('chb-s-mmd'), idk: se2('chb-s-idk') };
  for (const k of ['chb-s-mmd', 'chb-s-idk']) for (const f of ['mmd', 'puml']) green(`${k} ${f}: эталон сценарной зелёный`, sg2(k, se2(k, f), f));
  check('chb-s-mmd: в эталоне пометка — сразу за стрелкой своего звена, над получателем',
    eC.mmd.includes('    S2->>S3: INT-1 · POST /internal/reviews\n    Note over S3: { essayText, gradeLevel }\n    S3->>S4: INT-1\n    S4-->>S3: INT-1 · ответ\n    S3-->>S2: INT-1 · ответ\n    Note over S2: { score }\n    S2-->>S1: INT-1 · ответ\n')
    && eC.mmd.includes('    S1->>S2: INT-2\n    S2->>S3: INT-2\n    Note over S3: { language, threshold }\n    S3-->>S2: INT-2 · ответ\n    Note over S2: { similarity, matches }\n    S2-->>S1: INT-2 · ответ\n')
    && eC.mmd.includes('    S1->>S2: INT-3 · POST /v1/journal/batch\n    Note over S2: { classId, grades }\n    S2-->>S1: INT-3 · ответ\n    Note over S1: { accepted, rejected }\n')
    && !eC.idk.includes('{ language, threshold }') && !eC.idk.includes('{ similarity, matches }'));
  // Мутации эталона: пары [было, стало] по порядку; подстроки нет — строка-ошибка вместо красных якорей.
  const cr = (k, ...pairs) => {
    let t = eC[k];
    for (const [a, b] of pairs) { if (!t.includes(a)) return `нет в эталоне: ${a}`; t = t.replace(a, b); }
    return reds(sg2(k === 'mmd' ? 'chb-s-mmd' : 'chb-s-idk', t));
  };
  const A_Q = ['/review\n    S2->>S3: INT-1 · POST /internal/reviews\n    Note over S3: { essayText, gradeLevel }\n', '/review\n    Note over S2: { essayText, gradeLevel }\n    S2->>S3: INT-1 · POST /internal/reviews\n'];
  const A_P = ['    Note over S2: { score }\n    S2-->>S1: INT-1 · ответ\n', '    S2-->>S1: INT-1 · ответ\n    Note over S1: { score }\n'];
  const B_Q = ['    S1->>S2: INT-2\n    S2->>S3: INT-2\n    Note over S3: { language, threshold }\n', '    S1->>S2: INT-2\n    Note over S2: { language, threshold }\n    S2->>S3: INT-2\n'];
  const B_P = ['    Note over S2: { similarity, matches }\n    S2-->>S1: INT-2 · ответ\n', '    S2-->>S1: INT-2 · ответ\n    Note over S1: { similarity, matches }\n'];
  check('chb-s-mmd: тела по правилу «запрос — после первого запроса цепочки, ответ — после последнего ответа» (INT-1 и INT-2, порознь и вместе) → С5',
    [[A_Q], [A_P], [B_Q], [B_P], [A_Q, A_P, B_Q, B_P]].every((ps) => cr('mmd', ...ps) === 'С5'));
  check('chb-s-mmd: пометка на месте, но не над получателем (запрос INT-1 над school-api, ответ INT-2 над plagiarism-check, ответ INT-3 над journal-service) → С5; без сверки «над кем» тот же файл зелёный',
    cr('mmd', ['    Note over S3: { essayText, gradeLevel }', '    Note over S2: { essayText, gradeLevel }']) === 'С5'
    && cr('mmd', ['    Note over S2: { similarity, matches }', '    Note over S3: { similarity, matches }']) === 'С5'
    && cr('mmd', ['    Note over S1: { accepted, rejected }', '    Note over S2: { accepted, rejected }']) === 'С5'
    && Object.values(gradeScenarios(eC.mmd.replace('    Note over S3: { essayText, gradeLevel }', '    Note over S2: { essayText, gradeLevel }'), 'mmd', chb, SCEN_CHB, CB)).every(Boolean));
  check('chb-s-mmd: нет пометки запроса INT-1, пометка у звена 3 (к Lexa), поле потеряно, лишняя пустая пометка, тела INT-1 повторены у звена 1 → С5; имя типа перед полями и поля без скобок — годятся',
    cr('mmd', ['    Note over S3: { essayText, gradeLevel }\n', '']) === 'С5'
    && cr('mmd', ['    S3->>S4: INT-1\n', '    S3->>S4: INT-1\n    Note over S4: { essayText, gradeLevel }\n']) === 'С5'
    && cr('mmd', ['{ essayText, gradeLevel }', '{ essayText }']) === 'С5'
    && cr('mmd', ['    S4-->>S3: INT-1 · ответ\n', '    S4-->>S3: INT-1 · ответ\n    Note over S3: { }\n']) === 'С5'
    && cr('mmd', ['/review\n', '/review\n    Note over S2: { essayText, gradeLevel }\n']) === 'С5'
    && cr('mmd', ['{ essayText, gradeLevel }', 'ReviewRequest { essayText, gradeLevel }'], ['{ score }', 'ReviewResult: score']) === '');
  check('chb: пробы читаются парой — эталон chb-s-mmd на chb-s-idk → только С5 (пометки INT-2 лишние), эталон chb-s-idk на chb-s-mmd → только С5 (их нет); chb-s-idk с пометками INT-2 у звена 1 → С5',
    reds(sg2('chb-s-idk', eC.mmd)) === 'С5' && reds(sg2('chb-s-mmd', eC.idk)) === 'С5'
    && cr('idk', ['    S1->>S2: INT-2\n', '    S1->>S2: INT-2\n    Note over S2: { language, threshold }\n'], ['    S2-->>S1: INT-2 · ответ\n', '    S2-->>S1: INT-2 · ответ\n    Note over S1: { similarity, matches }\n']) === 'С5');
  check('chb: контроль INT-3 (`A → B`) — нет пометки ответа → С5; пометка запроса над отправителем → С5; пометка ответа до ответа → С5',
    cr('mmd', ['    Note over S1: { accepted, rejected }\n', '']) === 'С5'
    && cr('mmd', ['    Note over S2: { classId, grades }', '    Note over S1: { classId, grades }']) === 'С5'
    && cr('mmd', ['    S2-->>S1: INT-3 · ответ\n    Note over S1: { accepted, rejected }\n', '    Note over S1: { accepted, rejected }\n    S2-->>S1: INT-3 · ответ\n']) === 'С5');
  check('chb: прежние пробы не задеты — ключи пометок звена 1 прежние (q5, p5), пометка после звена 2 у PRK-9 — по-прежнему лишняя (С5)',
    scenTruth(SCEN_A[1], det).filter((e) => e.cls === 'note').map((e) => e.key).join() === 'p5'
    && sm('det-s-mmd', 1, put(['r', 5, 2], ['q', 5, 2])) === 'С5' && sm('det-s-mmd', 1, (rows) => put(['a', 5, 2], ['p', 5, 2])(drop(['p', 5])(rows))) === 'С5');
  // В1 и диагностика: вопрос о звене тел INT-2 обязателен, о звене тел INT-1 — лишний (тело однозначно при среднем звене).
  const CQ = 'INT-2: тела `{ language, threshold }` и `{ similarity, matches }` — к какому звену относятся: school-web → school-api или school-api → plagiarism-check?';
  const CA1 = 'INT-1: тела `{ essayText, gradeLevel }` и `{ score }` рисую у звена school-api → essay-checker. Верно?';
  const CS1 = [...chb.map((c) => `INT-${c.n} «карточка» — триггер: «${c.trigger}»`),
    `1. Участников 6: ${sidesOf(chb).join(', ')}. Считаю всех разными. Есть ли среди них один сервис под двумя именами?`,
    '2. INT-1: рисую звенья school-web → school-api (`POST /v1/essays/{essayId}/review`), school-api → essay-checker (`POST /internal/reviews`), essay-checker → Lexa. Верно?',
    '3. INT-2: рисую звенья school-web → school-api, school-api → plagiarism-check. Верно?',
    `4. ${CQ}`,
    '5. Сценарии: 1) «ученик нажал «Проверить эссе» на странице задания» — INT-1; 2) «учитель нажал «Проверить на заимствования» в карточке эссе» — INT-2. Без пользователя: INT-3. Верно?',
    '6. Внутренних шагов в карточках нет — рисую без них. Верно?'].join('\n');
  check('bodyAsk: вопрос о звене тел INT-2 — номер и «тело» или имя поля, `?` в той же строке или следующей → да',
    bodyAsk(CQ, 2, CHB_ASK.fields) && bodyAsk('5. **INT-2** — к какому звену относится тело запроса и ответа?', 2)
    && bodyAsk('INT-2: `language`, `threshold` — запрос какого звена?', 2, CHB_ASK.fields) && bodyAsk('5. INT-2: тело запроса и ответа рисую у звена school-web → school-api.\n   Верно?', 2));
  check('bodyAsk: нет — вопрос о цепочке INT-2 без тел, «учитель» в триггере, тела без номера, INT-12 вместо INT-2, без `?`, номер и тело в разных строках',
    !bodyAsk(CS1.split('\n')[5], 2, CHB_ASK.fields) && !bodyAsk(CS1.split('\n')[7], 2, CHB_ASK.fields)
    && !bodyAsk('К какому звену относятся тела запроса и ответа?', 2, CHB_ASK.fields) && !bodyAsk('INT-12: к какому звену относится тело?', 2)
    && !bodyAsk('INT-2: тела `{ language, threshold }` рисую у звена school-api → plagiarism-check.', 2, CHB_ASK.fields) && !bodyAsk('INT-2: рисую два звена.\nК какому звену тело?', 2));
  check('chb, В1: полный набор (участники, цепочки INT-1 и INT-2, тела INT-2, сценарии, шаги) — вопросы Step 3 все, о телах INT-2 спрошено, о телах INT-1 — нет; лишний вопрос о телах INT-1 опознан',
    unaskedScen(CS1, chb).join() === '' && bodyAsk(CS1, 2, CHB_ASK.fields) && !bodyAsk(CS1, 1, CHB_EXTRA.fields) && bodyAsk(`${CS1}\n7. ${CA1}`, 1, CHB_EXTRA.fields)
    && !bodyAsk(CS1.replace(`4. ${CQ}\n`, ''), 2, CHB_ASK.fields) && unaskedScen(CS1.replace(`4. ${CQ}\n`, ''), chb).join() === '');

  // det-y-scen: гипотеза хода 2 → прочтения (формы из t-pool1), правило триггеров, выбор прочтения при оценке.
  const DQ = {
    templ: ['3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-2, INT-3, INT-4; 2) «водитель нажал «Завершить и оплатить»» — INT-5, внутри него INT-3; 3) Без пользователя: INT-6. Верно? Если нет — назовите сценарии и карточки в каждом: вложенный вызов — „внутри INT-N“, следующая карточка сценария — „затем INT-N“.',
      'u1[2,3,4] | u5[3] | 6'],
    then: ['3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-2, затем INT-3 и INT-4; 2) «водитель нажал «Завершить и оплатить»» — INT-5; 3) без пользователя: INT-6. Верно?',
      'u1[2,3,4] | u5 | 6 || u1[2]>3>4 | u5 | 6'],
    list: ['3. **Сценарии:** \n   - 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри INT-1 идут INT-3, INT-4; затем INT-2\n   - 2) «водитель нажал «Завершить и оплатить»» — INT-5, внутри INT-5 идёт INT-3\n   - 3) Без пользователя: INT-6\n   \n   Верно? Если нет — назовите сценарии и карточки в каждом.',
      'u1[3,4,2] | u5[3] | 6 || u1[3,4]>2 | u5[3] | 6'],
    rule: ['3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1; 2) «водитель нажал «Завершить и оплатить»» — INT-5. Без пользователя: INT-2, INT-3, INT-4, INT-6 — каждая своим. Верно?',
      'u1 | u5 | 2 | 3 | 4 | 6'],
    twice: ['3. Сценарии:\n   - Сценарий 1: «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-3, внутри него INT-4\n   - Сценарий 2: «водитель нажал «Завершить и оплатить»» — INT-5, внутри него INT-3\n   - Без пользователя: INT-2, INT-6\n   Верно?',
      'u1[3[4]] | u5[3] | 2 | 6 || u1[3,4] | u5[3] | 2 | 6'],
    bare: ['3. Сценарии: 1) «водитель нажал «Начать парковку»» — INT-1, внутри INT-3; 2) «водитель нажал «Завершить и оплатить»» — INT-5, внутри INT-6, затем INT-2. Верно?',
      'u1[3] | u5[6,2] | 4 || u1[3] | u5[6]>2 | 4'],
    missing: ['3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-3, INT-4. Верно?', 'u1[3,4] | 2 | 5 | 6'],
    quoted: ['3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1; 2) «сессия успешно создана» — INT-2; 3) «водитель нажал «Завершить и оплатить»» — INT-5; Сценарий 4 — без пользователя: INT-3; 5) «без пользователя» — INT-4; 6) без пользователя — INT-6. Верно?',
      'u1 | u2 | u5 | 3 | 4 | 6'],
    inquote: ['3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1; 2) «после INT-1, внутри него INT-4» — INT-3, внутри него INT-2. Без пользователя: INT-4, INT-5, INT-6. Верно?',
      'u1 | u3[2] | 4 | 5 | 6'],
  };
  for (const [k, [t, want]] of Object.entries(DQ)) {
    const got = (hypoReadings(t, det) ?? []).map(sigAll).join(' || ');
    check(`det-y-scen, гипотеза «${k}»: ${want}`, got === want);
    if (got !== want) console.log(`  разобрано: ${got}`);
  }
  const hyp = (t) => hypothesis(t, det, SB, PERSON.det);
  // Реплики А и Б (строка «Сценарии:») читаются одним способом, и строки истины по ним — те же, что `SCEN_A` и `SCEN_B`
  // (у А — без внутреннего шага: его в строке «Сценарии» нет).
  const replyLine = (f) => (read(join(fixDir('det'), f)) ?? '').match(/^Сценарии:.*$/m)?.[0] ?? '';
  const noStep = (s) => s.replace(/ s:[^ ]+/g, '');
  check('реплики А и Б однозначны («до ответа … потом …; после ответа …») и дают прежние эталоны: А — u1[3,4]>2 | u5 | 6 = SCEN_A, Б — u1[3]>4>2 | u5>6 = SCEN_B',
    (hypoReadings(replyLine('s-turn2.txt'), det) ?? []).map(sigAll).join(' || ') === 'u1[3,4]>2 | u5 | 6'
    && (hypoReadings(replyLine('s-alt-turn2.txt'), det) ?? []).map(sigAll).join(' || ') === 'u1[3]>4>2 | u5>6'
    && hyp(replyLine('s-turn2.txt')).cands.length === 1 && flowOfC(hyp(replyLine('s-turn2.txt')).cands[0].rows, det) === noStep(flowOf(SCEN_A))
    && hyp(replyLine('s-alt-turn2.txt')).cands.length === 1 && flowOfC(hyp(replyLine('s-alt-turn2.txt')).cands[0].rows, det) === flowOf(SCEN_B)
    && /до ответа INT-1 parking-api вызывает INT-3, потом INT-4; после ответа INT-1 — INT-2/.test(replyLine('s-turn2.txt'))
    && /до ответа INT-1 parking-api вызывает только INT-3; после ответа INT-1 — INT-4, потом INT-2.*INT-5; после ответа INT-5 приложению — INT-6\. Без пользователя: нет\./.test(replyLine('s-alt-turn2.txt')));
  check('det-y-scen, правило триггеров: «каждая своим» без вложенных — да; вложенные по смыслу, INT-5 без пользователя, лишний пользователь у INT-2 — нет',
    hyp(DQ.rule[0]).rule && !hyp(DQ.templ[0]).rule && !hyp(DQ.missing[0]).rule && !hyp(DQ.quoted[0]).rule
    && sigAll(ruleScens(det, PERSON.det)) === 'u1 | 2 | 3 | 4 | u5 | 6');
  const noHyp = hyp('1. Участников 6: parking-web, parking-api. Есть ли среди них один сервис под двумя именами?\n4. Внутренних шагов нет — верно?');
  check('det-y-scen: гипотезы в ходе 2 нет → эталон по правилу триггеров, «по правилу» — нет', !noHyp.found && noHyp.readings === 0 && !noHyp.rule
    && noHyp.cands.map((c) => c.sig).join(' || ') === 'u1 | 2 | 3 | 4 | u5 | 6' && hypoReadings('', det) === null);
  const yFile = (c) => buildScen('mmd', c.rows, det, SB, { tail: tailOf, step: () => '', known: true });
  const gy = (text, t) => gradeHypo(text, 'mmd', det, t, SB, PERSON.det);
  const allGreen = (r) => Object.values(r).every(Boolean);
  check('det-y-scen: двоякая гипотеза («внутри …, затем …») — схема по любому прочтению зелёная, прочтений 2; схема по другой гипотезе — красная',
    hyp(DQ.then[0]).cands.length === 2 && hyp(DQ.then[0]).cands.every((c) => allGreen(gy(yFile(c), DQ.then[0]).r)) && gy(yFile(hyp(DQ.then[0]).cands[0]), DQ.then[0]).diag.readings === 2
    && !allGreen(gy(yFile(hyp(DQ.templ[0]).cands[0]), DQ.then[0]).r) && !allGreen(gy(yFile(hyp(DQ.then[0]).cands[0]), DQ.templ[0]).r));
  const inChain = '3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-2, INT-3, INT-4; 2) «водитель нажал «Завершить и оплатить»» — INT-5, внутри него INT-6. Верно?';
  check('det-y-scen: вложенная в цепочку INT-5 карточка, которую не вызывает получатель ни одного звена (INT-6), — после любого звена; INT-3 в INT-5 — после звена к parking-api',
    hyp(inChain).cands.length === 2 && hyp(inChain).cands.every((c) => allGreen(gy(yFile(c), inChain).r))
    && flowOfC(hyp(inChain).cands.map((c) => c.rows[1]), det) === 'u r5.1 r6.1 q6 a6.1 r5.2 a5.2 a5.1 p5 | u r5.1 r5.2 r6.1 q6 a6.1 a5.2 a5.1 p5'
    && flowOfC([hyp(DQ.templ[0]).cands[0].rows[1]], det) === 'u r5.1 r3.1 a3.1 p3 r5.2 a5.2 a5.1 p5');
  check('det-y-scen: порядок сценариев — как в гипотезе или по номеру первой карточки, оба зелёные; другой порядок — красный',
    hyp(DQ.rule[0]).cands.map((c) => c.sig).join(' || ') === 'u1 | u5 | 2 | 3 | 4 | 6 || u1 | 2 | 3 | 4 | u5 | 6'
    && hyp(DQ.rule[0]).cands.every((c) => allGreen(gy(yFile(c), DQ.rule[0]).r))
    && !allGreen(gy(yFile({ rows: [...hyp(DQ.rule[0]).cands[0].rows].reverse() }), DQ.rule[0]).r));
  const yb = yFile(hyp(DQ.bare[0]).cands[0]);
  check('det-y-scen: текст стрелки пользователя — кавычки гипотезы («водитель нажал «Начать парковку»») или «Триггер» целиком; другой → С7; диагностика в якоря не идёт',
    allGreen(gy(yb, DQ.bare[0]).r) && yb.includes('U->>S1: водитель нажал «Начать парковку»\n')
    && allGreen(gy(yb.replace('U->>S1: водитель нажал «Начать парковку»\n', `U->>S1: ${det[0].trigger}\n`), DQ.bare[0]).r)
    && reds(gy(yb.replace('U->>S1: водитель нажал «Начать парковку»\n', 'U->>S1: водитель открыл экран\n'), DQ.bare[0]).r) === 'С7'
    && !Object.keys(gy(yb, DQ.bare[0]).r).some((k) => /правил|гипотез/.test(k)));

  // Запись инструмента — в форме настоящего `stream.jsonl` пула: событие `assistant`, блок `tool_use`.
  const ev = (name, input, parent = null) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_x', name, input, caller: { type: 'direct' } }] }, parent_tool_use_id: parent, session_id: 's' });
  const readEv = ev('Read', { file_path: 'C:/sb/coddoc/RET-512/technical_specification.md' });
  const writeEv = (parent) => ev('Write', { file_path: 'C:/sb/coddoc/RET-512/interaction_diagram.puml', content: '@startuml' }, parent);
  check('В1: Write схемы ведущим → файл записан', wroteDiagram([readEv, writeEv(null)].join('\n')) === true);
  check('В1: Write субагента, Read, чужой файл и битая строка — не запись', wroteDiagram([readEv, writeEv('toolu_parent'), '{обрыв',
    ev('Write', { file_path: 'C:/sb/notes.md', content: 'x' })].join('\n')) === false);
  const A1 = 'Перед схемой — два вопроса.\n1. Вне §1.2: Покупатель, бэкенд возвратов — рисую отдельными участниками. Верно?\n2. INT-11: склад → 1С. Верно?';
  check('В1: вопросы по обоим поводам ring', unasked(A1, 'ring').length === 0);
  check('В1: INT-1 со знаком вопроса не засчитан за INT-11', unasked(A1.replace('INT-11: склад → 1С', 'INT-1: так'), 'ring').join() === 'П2');
  check('В1: знака вопроса нет нигде → не спросил; знак в другой строке, чем повод, — спросил', askedIn(A1.replace(/\?/g, '.'), 'ring') === false
    && askedIn(A1.replace('участниками. Верно?', 'участниками.'), 'ring') && askedIn(A1, 'ring'));
  check('В1: П2 без номера карточки → не спросил; имена П3 в обратных кавычках и с заглавной засчитаны', unasked('Кто начинает обмен: repairy-api или 1С?\nВне §1.2: `Браузер заказчика`, `repairy-telegram`, `YooKassa` — отдельные участники?', 'rep').join() === 'П2'
    && askedIn('Планшет группы — отдельный участник, верно?', 'id'));
  check('В1: П3 назвал одно имя из двух или из трёх → не спросил', unasked(A1.replace('Покупатель, ', ''), 'ring').join() === 'П3'
    && unasked('INT-9: 1С → repairy-api?\nВне §1.2: YooKassa — отдельный участник?', 'rep').join() === 'П3');
  const CHK = 'INT-10: бэкенд возвратов → warehouse-service — «—»\nINT-11: склад, 1С — П2\nПокупатель — нет\nбэкенд возвратов — нет\n**поводы: П2 INT-11; П3 Покупатель, бэкенд возвратов**\n';
  check('В1: письменная проверка вопросом не считается — имя только в проверке → не спросил', unasked(`${CHK}INT-11: склад → 1С?\nВне §1.2: бэкенд возвратов — отдельный участник?`, 'ring').join() === 'П3'
    && askedIn(`${CHK}Жду ответа.`, 'ring') === false);
  const tail = 'INT-11: склад → 1С?\nВне §1.2: бэкенд возвратов — отдельный участник?';
  check('В1: итог с номером пункта, со словом перед ним и жирным — всё равно итог', ['3. поводы: П2 INT-11; П3 Покупатель, бэкенд возвратов',
    '**Итог:** `поводы: П2 INT-11; П3 Покупатель, бэкенд возвратов`', '**поводы**: П2 INT-11; П3 Покупатель, бэкенд возвратов']
    .every((sum) => unasked(`Покупатель — нет\n${sum}\n${tail}`, 'ring').join() === 'П3'));
  check('В1: проверка и полный вопрос после неё → спросил', askedIn(`${CHK}${A1}`, 'ring') && questions('без итога\nвопрос?') === 'без итога\nвопрос?');
  check('В1: Bash и Edit с путём схемы — запись; Bash без него — нет', wroteDiagram(ev('Bash', { command: "cat > coddoc/PRK-9/interaction_diagram_detailed.md <<'EOF'\nsequenceDiagram\nEOF" }))
    && wroteDiagram(ev('Edit', { file_path: 'C:/sb/coddoc/PRK-9/interaction_diagram.md', old_string: 'a', new_string: 'b' })) && wroteDiagram(ev('Bash', { command: 'ls coddoc/PRK-9' })) === false);
  check('В4: строка «со слов аналитика» с именем из реплики', bySaid('Схема записана.\n- **со слов аналитика (в спеке нет):** «бэкенд возвратов» — это returns-api', QPROBES['ring-q-one'].said));
  check('В4: «—» при имени в другой строке → красный; у «не знаю» хватает самой строки', bySaid('бэкенд возвратов склеен\nсо слов аналитика (в спеке нет): —', QPROBES['ring-q-one'].said) === false
    && bySaid('со слов аналитика (в спеке нет): —', QPROBES['chain-q-idk'].said) && bySaid('нет в §1.2: —', QPROBES['chain-q-idk'].said) === false);
  check('В4: rep — нужны и INT-9, и YooKassa/INT-8', bySaid('со слов аналитика: INT-9 — 1С → repairy-api', QPROBES['rep-q-mmd'].said) === false
    && bySaid('со слов аналитика: INT-9 — 1С → repairy-api; INT-8 — ЮKassa', QPROBES['rep-q-mmd'].said));
  // Шаблон отчёта Step 5 — «со слов аналитика: участники — все разные»: у id-q-mmd это верный отчёт (t-pool1: run-03, 06, 10).
  check('В4 id-q-mmd: «участники — все разные» и «все участники разные» по шаблону годятся, как и «планшет группы»; «—» и строка «порядок: …» — нет',
    ['со слов аналитика: участники — все разные', 'со слов аналитика: все участники разные', 'со слов аналитика: «планшет группы» — отдельный участник', '- со слов аналитика: INT-4 — к планшету']
      .every((l) => bySaid(l, STAGE['id-q-mmd'].said)) && !bySaid('со слов аналитика: —', STAGE['id-q-mmd'].said)
    && !bySaid('порядок: по времени, со слов аналитика', STAGE['id-q-mmd'].said) && STAGE['id-q-mmd'].said.join() === QPROBES['id-q-mmd'].said.join());

  // Песочницы во временной папке: служебные файлы ходов, В1 по потоку первого хода, сбой API вне знаменателя.
  const tmp = mkdtempSync(join(tmpdir(), 'grade-id-'));
  try {
    const pool = join(tmp, 'ring-q-one');
    const Q = QPROBES['ring-q-one'];
    const A2 = 'Схема записана: coddoc/RET-512/interaction_diagram.puml\nбез стрелки: INT-11 — направление не решено\nсо слов аналитика (в спеке нет): «бэкенд возвратов» (INT-10) — это returns-api';
    const mk = (run, files, fx = 'ring', root = pool) => {
      for (const f of listFiles(fixDir(fx))) { mkdirSync(dirname(join(root, run, f)), { recursive: true }); writeFileSync(join(root, run, f), readFileSync(join(fixDir(fx), f))); }
      for (const [f, text] of Object.entries(files)) if (text != null) writeFileSync(join(root, run, f), text); // null — файла нет
    };
    // Прогон 4.3.0 — три хода. Папки ниже описаны в прежних двух ходах (вопросы → файл); `three` сдвигает их на ход вперёд
    // и ставит первым ходом вопрос о типе `t1` с потоком `s1` (по умолчанию — верный Т1: только чтение, без записи).
    const T1_OK = 'Какую схему рисовать: короткую — кто кого вызывает, по времени, — или сценарную — по диаграмме на действие пользователя, с ответами и телами запросов?';
    const SHIFT = { 'answer-01.md': 'answer-02.md', 'answer-02.md': 'answer-03.md', 'stream.jsonl': 'stream-02.jsonl', 'stream-02.jsonl': 'stream-03.jsonl' };
    const three = (files, t1 = T1_OK, s1 = readEv) => ({ 'answer-01.md': t1, 'stream.jsonl': s1,
      ...Object.fromEntries(Object.entries(files).map(([f, v]) => [SHIFT[f] ?? f, f === 'answer.md' ? t1 + v : v])) });
    const mk3 = (run, files, fx = 'ring', root = pool, t1 = T1_OK, s1 = readEv) => mk(run, three(files, t1, s1), fx, root);
    const two = { 'answer-01.md': A1, 'answer-02.md': A2, 'answer.md': A1 + A2, 'stream.jsonl': readEv, 'stream-02.jsonl': writeEv(null), '_seeded.txt': '', '_stderr.log': '' };
    const diag = wantFile(specRel('ring'), 'puml', false);
    mk3('run-01', { ...two, [diag]: QG['ring-q-one'] });
    mk3('run-02', { ...two, [diag]: ringPuml }); // спросил, ответ не использовал
    mk3('run-03', { ...two, [diag]: QG['ring-q-one'], 'stream.jsonl': [readEv, writeEv(null)].join('\n') }); // файл с хода вопросов
    mk3('run-04', { 'answer-01.md': A1, 'answer.md': A1, 'stream.jsonl': readEv, '_api-failure-turn.txt': 'ход 3: отказ API или пустой ответ' });
    mk('run-05', { 'stream.jsonl': '', '_api-failure.txt': 'API Error' });
    mk3('run-06', { ...two, [diag]: QG['ring-q-one'], 'answer-02.md': A2.replace('INT-11', 'одна карточка') }); // INT-11 назван только в ходе вопросов
    mk3('run-07', { ...two, [diag]: QG['ring-q-one'] }, 'ring', join(tmp, 'ring-q-one-t1'), `${T1_OK}\n${A1}`); // вопросы Step 3 уже в ходе 1
    const gr = (run, root = pool) => gradeRun(join(root, run), 'puml', 'ring', false, Q);
    green('песочница: спросил, схема по ответу — зелёный целиком', gr('run-01').r);
    check('песочница: три хода — служебные файлы ходов не «новые» (И1), И14 не ставится, отчёт — из answer-03', gr('run-01').made.join() === diag
      && !Object.keys(gr('run-01').r).some((k) => k.startsWith('И14')) && lastAnswer(join(pool, 'run-01')) === A2);
    check('песочница: спросил, ответ не использовал → И6, И11, В3', reds(gr('run-02').r) === 'И6,И11,В3');
    check('песочница: файл схемы с хода вопросов (ход 2) → только В1', reds(gr('run-03').r) === 'В1');
    check('песочница: И13 читается по последнему ходу, не по склейке', reds(gr('run-06').r) === 'И13');
    check('песочница опросника: вопросы Step 3 в ходе 1 (Т1) → только В1', reds(gr('run-07', join(tmp, 'ring-q-one-t1')).r) === 'В1');
    check('сбой API: обе метки опознаны', apiFailed(join(pool, 'run-04')) && apiFailed(join(pool, 'run-05')) && !apiFailed(join(pool, 'run-01')));
    const gp = gradePool(pool, { ...parseProbe('ring-q-one'), st: null }); // прежний опросник: имя теперь за этапом К, его строка снята
    check('пул: знаменатель 4 из 6, сбоев API 2, клетки В3 2/1/1', gp.n === 4 && gp.failed.join() === 'run-04,run-05' && gp.cells.join() === '2,1,1' && gp.whole === 1 && gp.core === 1);
    check('пул: строки «сбой API», счёт по знаменателю без сбоев', gp.out.includes('run-04: сбой API — в счёт не идёт') && gp.out.includes('В1 спросил: 3/4')
      && gp.out.includes('В3 по пулу: спросил и верно 2 / спросил и неверно 1 / не спросил 1') && gp.out.includes('сбой API: 2 (run-04, run-05)')
      && gp.out.includes('схема верна (без И14, Д5, В4): 1/4'));
    check('пул: отдельная строка «спросил (В1)»', gp.out.includes('спросил (В1): 3/4'));
    // Старое имя пробы: сбой API вне знаменателя, как у опросных; строк опросника в выводе нет.
    const oldPool = join(tmp, 'ring-puml');
    mkdirSync(join(oldPool, 'run-01'), { recursive: true });
    writeFileSync(join(oldPool, 'run-01', '_api-failure.txt'), 'API Error');
    const go = gradePool(oldPool, parseProbe('ring-puml'));
    check('пул старой пробы: сбой API вне знаменателя, отдельной строкой; строк опросника нет', go.n === 0 && go.failed.join() === 'run-01'
      && go.out.includes('схема верна (без И14, Д5): 0/0') && go.out[go.out.length - 1] === 'сбой API: 1 (run-01)' && !go.out.some((l) => /В3|спросил/.test(l)));

    // В1 на синтетике: папка прогона из файлов хода 1 (вопрос о типе `t1`, поток `s1`) и хода вопросов 2 (`a1`, `stream`).
    const q1 = (name, a1, stream = readEv, t1 = T1_OK, s1 = readEv) => {
      mkdirSync(join(tmp, 'q1', name), { recursive: true });
      for (const [f, text] of Object.entries({ 'answer-01.md': t1, 'stream.jsonl': s1, 'answer-02.md': a1, 'stream-02.jsonl': stream })) {
        if (text != null) writeFileSync(join(tmp, 'q1', name, f), text);
      }
      return join(tmp, 'q1', name);
    };
    const D1 = 'INT-5: ответ и ошибки `402, 502` — от кого к кому? Рисую от parking-api к parking-web. Верно?';
    const bashEv = ev('Bash', { command: "cat > coddoc/PRK-9/interaction_diagram_detailed.md <<'EOF'\nsequenceDiagram\nEOF" });
    check('В1: вопрос П4 одной строкой → спросил', asked(q1('p4', D1), 'det'));
    check('В1: файл записан через Bash на ходу вопросов → не спросил', asked(q1('bash', D1, [readEv, bashEv].join('\n')), 'det') === false);
    check('В1 опросника: вопрос П4 на ходу 2, но в ходе 1 нет вопроса о типе или записан файл → не спросил', asked(q1('t1-no', D1, readEv, 'Рисую короткую.'), 'det') === false
      && asked(q1('t1-file', D1, readEv, T1_OK, [readEv, bashEv].join('\n')), 'det') === false && asked(q1('t1-none', D1, readEv, null, null), 'det') === false);
    check('В1: вопрос П3 назвал одно имя из двух → не спросил', asked(q1('p3', A1.replace('Покупатель, ', '')), 'ring') === false);
    check('В1: вопрос П4 только про звенья INT-5, без «ответ/ошибки» → не спросил',
      asked(q1('hops', 'INT-5: рисую звенья parking-web → parking-api (`POST /v1/sessions/{id}/finish`), parking-api → billing (`POST /v2/charges`). Верно?'), 'det') === false);
    check('В1: вопрос в несколько строк (номер в одной, `?` в другой) → спросил',
      asked(q1('multi', '**INT-5** — цепочка из трёх сторон.\n\nОтвет и ошибки `402, 502` рисую от parking-api к parking-web.\nВерно?'), 'det'));
    check('В1: «ответ» через строку от номера — не тот вопрос → не спросил',
      asked(q1('far', 'INT-5: рисую два звена.\nМетоды — по порядку.\nВерно?\nОтвет нужен до записи файла.'), 'det') === false);

    // Подробная с поводом П4: истина ответа и ошибок INT-5 — из реплики пробы; В3 включает Д3 и Д4.
    const detDiag = wantFile(specRel('det'), 'mmd', true);
    const D2 = (who) => `схема: ${detDiag} (Mermaid)\nкарточек: 6 из 6, стрелок: 7\nответов: 4, ошибок: 3\nбез стрелки: —\nсо слов аналитика: INT-5 — ответ и ошибки ${who}`;
    const dtwo = (who) => ({ 'answer-01.md': D1, 'answer-02.md': D2(who), 'answer.md': D1 + D2(who), 'stream.jsonl': readEv, 'stream-02.jsonl': bashEv, '_seeded.txt': '', '_stderr.log': '' });
    const [detPool, altPool] = [join(tmp, 'det-q-mmd'), join(tmp, 'det-q-alt')];
    mk3('run-01', { ...dtwo('от parking-api к parking-web'), [detDiag]: tg.mmd }, 'det', detPool);
    mk3('run-02', { ...dtwo('от parking-api к parking-web'), [wantFile(specRel('det'), 'mmd', false)]: ts.mmd }, 'det', detPool); // короткий файл вместо подробного
    mk3('run-03', { ...dtwo('от parking-api к parking-web'), [detDiag]: altMmd }, 'det', detPool);
    mk3('run-01', { ...dtwo('от billing к parking-api'), [detDiag]: altMmd }, 'det', altPool);
    mk3('run-02', { ...dtwo('от billing к parking-api'), [detDiag]: tg.mmd }, 'det', altPool); // спросил, нарисовал по гипотезе
    const gd = (root, run) => { const p = parseProbe(root.split(/[\\/]/).pop()); return gradeRun(join(root, run), p.format, p.fx, p.detailed, p.q).r; };
    green('det-q-mmd: песочница по реплике — зелёный целиком', gd(detPool, 'run-01'));
    check('det-q-mmd: короткий файл вместо подробного → И1, И2, В3', reds(gd(detPool, 'run-02')) === 'И1,И2,В3');
    check('det-q-mmd: alt-эталон → Д3, Д4, В3', reds(gd(detPool, 'run-03')) === 'Д3,Д4,В3');
    green('det-q-alt: песочница по реплике — зелёный целиком', gd(altPool, 'run-01'));
    check('det-q-alt: базовый эталон → Д3, Д4, В3', reds(gd(altPool, 'run-02')) === 'Д3,Д4,В3');
    const ga = gradePool(altPool, parseProbe('det-q-alt'));
    check('det-q-alt: пул — спросил 2/2, клетки В3 1/1/0, сбоев нет', ga.n === 2 && ga.cells.join() === '1,1,0' && ga.out.includes('спросил (В1): 2/2')
      && ga.out.includes('Д3 ответы: 1/2') && ga.out[ga.out.length - 1] === 'сбой API: 0');

    // ID-DIAG с поводом П3 и ID-CHAIN с ответом «не знаю»: отчёт по последнему ходу.
    const idPool = join(tmp, 'id-q-mmd');
    const I1 = 'Вне §1.2: планшет группы — рисую отдельным участником, верно? Если это сервис из §1.2 под другим именем — назовите какой';
    const I2 = 'схема: coddoc/DSP-330/interaction_diagram.md (Mermaid)\nкарточек: 6 из 6, стрелок: 6\nбез стрелки: —\nсо слов аналитика: «планшет группы» — отдельный участник';
    mk3('run-01', { 'answer-01.md': I1, 'answer-02.md': I2, 'answer.md': I1 + I2, 'stream.jsonl': readEv, 'stream-02.jsonl': bashEv, [wantFile(specRel('id'), 'mmd', false)]: good.mmd }, 'id', idPool);
    green('id-q-mmd: песочница — зелёный целиком', gd(idPool, 'run-01'));
    const idkPool = join(tmp, 'chain-q-idk');
    const K1 = 'INT-3: рисую звенья clinic-web → clinic-core, clinic-core → lab-service, lab-service → LabNet. Верно?\nВне §1.2: LabNet — рисую отдельным участником, верно?';
    const K2 = 'схема: coddoc/CHN-4/interaction_diagram.md (Mermaid)\nкарточек: 4 из 5, стрелок: 5\nбез стрелки: INT-3 — аналитик не ответил, как читать границу\nсо слов аналитика: —';
    const ktwo = { 'answer-01.md': K1, 'answer-02.md': K2, 'answer.md': K1 + K2, 'stream.jsonl': readEv, 'stream-02.jsonl': bashEv };
    const chDiag = wantFile(specRel('chain'), 'mmd', false);
    mk3('run-01', { ...ktwo, [chDiag]: QG['chain-q-idk'] }, 'chain', idkPool);
    mk3('run-02', { ...ktwo, [chDiag]: QG['chain-q-idk'], 'answer-02.md': K2.replace('INT-3 — аналитик не ответил, как читать границу', '—') }, 'chain', idkPool); // INT-3 назван только в вопросе
    mk3('run-03', { ...ktwo, [chDiag]: cg.mmd, 'answer-02.md': K2.replace('без стрелки: INT-3 — аналитик не ответил, как читать границу', 'без стрелки: —') }, 'chain', idkPool); // гипотеза нарисована
    green('chain-q-idk: песочница — INT-3 без стрелок и назван в последнем ответе', gd(idkPool, 'run-01'));
    check('chain-q-idk: INT-3 назван только на ходу вопросов → И13', reds(gd(idkPool, 'run-02')) === 'И13');
    check('chain-q-idk: INT-3 нарисована гипотезой → И3, И6, И13, В3', reds(gd(idkPool, 'run-03')) === 'И3,И6,И13,В3');

    // Контроль det-short-mmd: один ход, короткий файл; сбой API вне знаменателя и у неопросной пробы.
    const shortPool = join(tmp, 'det-short-mmd');
    mk('run-01', { 'answer.md': 'схема: coddoc/PRK-9/interaction_diagram.md (Mermaid)\nкарточек: 6 из 6, стрелок: 7\nбез стрелки: —', 'stream.jsonl': [readEv, bashEv].join('\n'),
      [wantFile(specRel('det'), 'mmd', false)]: ts.mmd }, 'det', shortPool);
    mk('run-02', { 'stream.jsonl': '', '_api-failure.txt': 'API Error' }, 'det', shortPool);
    mk('run-03', { 'answer.md': D1, 'stream.jsonl': readEv }, 'det', shortPool); // спросил без повода — файла нет
    const gs = gradePool(shortPool, parseProbe('det-short-mmd'));
    check('det-short-mmd: файл с первого хода зелёный, вопрос вместо файла → И1, И2', gs.out.includes('run-01: зелёный  новые файлы: coddoc/PRK-9/interaction_diagram.md')
      && gs.out.includes('run-03: красный И1,И2'));
    check('det-short-mmd: сбой API вне знаменателя', gs.n === 2 && gs.failed.join() === 'run-02' && gs.whole === 1 && gs.out.includes('run-02: сбой API — в счёт не идёт')
      && gs.out.includes('зелёный целиком: 1/2') && gs.out[gs.out.length - 1] === 'сбой API: 1 (run-02)' && !gs.out.some((l) => /В3|спросил/.test(l)));

    // Этап К на синтетике: В1 по тексту вопросов и по папке первого хода, К1, Р1.
    const ask = (fx, extra = []) => [`1. Участников ${sidesOf(asIs(fx)).length}: ${sidesOf(asIs(fx)).join(', ')}. Считаю всех разными. Есть ли среди них один сервис под двумя именами?`,
      `2. Карточки в спеке идут так: ${asIs(fx).map((c) => `INT-${c.n} «карточка»`).join(', ')}. По времени порядок тот же?`, ...extra].join('\n');
    const un = (fx, a1) => unaskedStage(a1, asIs(fx)).join();
    check('этап, В1: полный набор → спросил (все пять фикстур; номера цепочки и карточки без направления хватает в вопросе о порядке)', ['det', 'id', 'chain', 'ring', 'rep'].every((fx) => un(fx, ask(fx)) === ''));
    check('этап, В1: список участников без одного имени → не спросил «участники»; сторона только из карточки со знаком в скобках (LabNet) не требуется', un('det', ask('det').replace('tariff-service, ', '')) === 'участники'
      && un('ring', ask('ring').replace(', бэкенд возвратов', '')) === 'участники' && un('chain', ask('chain').replace('schedule-service, ', '')) === 'участники' && un('chain', ask('chain').replace('LabNet, ', '')) === '');
    check('этап, В1: слова с корнем «поряд» нет или названы не все карточки (INT-1 не засчитан за INT-10, INT-11) → не спросил «порядок»',
      un('det', ask('det').replace('По времени порядок тот же?', 'По времени так же?')) === 'порядок'
      && un('det', ask('det').replace('INT-4 «карточка», ', '')) === 'порядок' && un('ring', ask('ring').replace('INT-1 «карточка», ', '')) === 'порядок');
    check('этап, В1: цепочка или карточка без направления не названа → не спросил, в списке рядом с «порядок»', un('ring', ask('ring').replace(', INT-11 «карточка»', '')) === 'порядок,нет направления INT-11'
      && un('chain', ask('chain').replace('INT-3 «карточка», ', '')) === 'порядок,цепочка INT-3' && un('chain', ask('chain').replace('INT-2 «карточка», ', '')) === 'порядок,цепочка INT-2'
      && un('det', ask('det').replace('INT-5 «карточка», ', '')) === 'порядок,цепочка INT-5' && un('rep', ask('rep').replace(', INT-9 «карточка»', '')) === 'порядок,нет направления INT-9');
    check('этап, В1: имена в обратных кавычках и с другим регистром засчитаны', un('id', ask('id').replace('планшет группы', '`Планшет группы`').replace('dispatch-api', '`Dispatch-API`')) === '');
    const na = (name, a1, stream = readEv, t1 = T1_OK, s1 = readEv) => notAsked(q1(name, a1, stream, t1, s1), asIs('det')).join();
    const writeShort = ev('Write', { file_path: 'C:/sb/coddoc/PRK-9/interaction_diagram.md', content: 'x' });
    check('этап, В1: ходы 1–2 в порядке — спросил; файл схемы ходом вопросов, нет знака «?», нет ни одного хода → не спросил', na('s-ok', ask('det')) === ''
      && na('s-file', ask('det'), [readEv, writeShort].join('\n')) === 'файл схемы записан вторым ходом'
      && na('s-noq', ask('det').replace(/\?/g, '.')) === 'знака «?» нет' && notAsked(join(tmp, 'q1', 'нет-такой'), asIs('det')).join() === 'Т1 первого хода нет,второго хода нет');
    // Т1: ход 1 — только вопрос о типе. Прежний первый ход (список карточек и вопросы Step 3) теперь красный.
    const t1 = (name, text, s1 = readEv) => typeTurn(q1(name, ask('det'), readEv, text, s1)).join();
    check('Т1: вопрос о типе («короткую … или сценарную …?»), поток без записи → зелёный; то же списком вариантов и с заглавной → зелёный', t1('t1-ok', T1_OK) === ''
      && t1('t1-list', 'Какую схему рисовать?\n1. Короткая — кто кого вызывает, по времени.\n2. Сценарная — по диаграмме на действие пользователя.') === '');
    check('Т1: список карточек в ходе 1 → красный (есть INT-N)', t1('t1-cards', `${T1_OK}\nINT-1 «Начало парковочной сессии»: parking-web → parking-api\nINT-2 «Событие»: parking-api → notify`) === 'есть INT-N');
    check('Т1: номера карточек без стрелки и без «?» («Карточки INT-1 до INT-6 на месте.») → зелёный', t1('t1-range', `Спецификация прочитана. Карточки INT-1 до INT-6 на месте.\n${T1_OK}`) === '');
    check('Т1: вопрос без «сценар» («короткую или подробную?») → красный', t1('t1-noscen', 'Какую схему рисовать: короткую или подробную?') === 'нет «сценар»');
    check('Т1: файл схемы записан на ходу 1 (Write ведущего) → красный', t1('t1-file', T1_OK, [readEv, writeShort].join('\n')) === 'файл схемы записан');
    check('Т1: вопросы Step 3 в ходе 1 — вместо вопроса о типе и вместе с ним → красный', t1('t1-step3', ask('det')) === 'нет «коротк»,нет «сценар»,есть INT-N'
      && t1('t1-both', `${T1_OK}\n${ask('det')}`) === 'есть INT-N');
    check('Т1: тип назван без вопроса («Рисую короткую, не сценарную.») → красный; нет хода 1 → красный', t1('t1-noq', 'Рисую короткую, не сценарную.') === 'знака «?» нет'
      && typeTurn(q1('t1-none', ask('det'), readEv, null, null)).join() === 'первого хода нет');
    check('Т1 в В1: вопросы хода 2 полные, ход 1 со списком карточек → не спросил, промах с префиксом «Т1»',
      na('s-t1', ask('det'), readEv, `${T1_OK}\nINT-1 «Начало»: parking-web → parking-api`) === 'Т1 есть INT-N');
    const K5 = 'INT-5: рисую звенья parking-web → parking-api (`POST /v1/sessions/{id}/finish`), parking-api → billing (`POST /v2/charges`). Верно?';
    const K3 = 'INT-3: рисую стрелку parking-api → tariff-service (`GET /internal/tariffs/{zoneId}`). Верно?'; // одно звено — спрашивать не о чем
    const CARD_Q = { det: [`3. ${K5}`], chain: ['3. INT-2: рисую звенья clinic-web → booking-api (`POST /v1/appointments`), booking-api → schedule-service (`POST /internal/slots/{slotId}/hold`). Верно?',
      '4. INT-3: рисую звенья clinic-web → clinic-core (`POST /v1/lab-orders`), clinic-core → lab-service (`POST /internal/orders`), lab-service → LabNet. Верно?'],
    ring: ['3. INT-11: направление не указано. склад → 1С или 1С → склад?'], rep: ['3. INT-9: направление не указано. 1С → repairy-api или repairy-api → 1С?'] };
    const nq = (fx, extra) => noCardQuestion(ask(fx, extra), asIs(fx));
    check('этап, К1: вопросы об участниках и порядке — лишнего нет; вопрос о цепочке «INT-5: рисую звенья … Верно?» у det — не лишний', nq('det') && nq('det', CARD_Q.det));
    check('этап, К1: вопросы о цепочках chain INT-2, INT-3 и о карточках без направления ring INT-11, rep INT-9 — не лишние', nq('chain', CARD_Q.chain) && nq('ring', CARD_Q.ring) && nq('rep', CARD_Q.rep));
    check('этап, К1: вопрос о карточке с одним звеном («INT-3: … Верно?» у det, INT-1 у chain, INT-10 у ring, INT-4 у id) → лишний', nq('det', [...CARD_Q.det, `4. ${K3}`]) === false
      && nq('chain', [...CARD_Q.chain, '5. INT-1: clinic-web → booking-api. Верно?']) === false && nq('ring', ['3. INT-10: бэкенд возвратов → warehouse-service. Верно?']) === false
      && nq('id', ['3. INT-4: событие от notify к «планшет группы» — асинхронной стрелкой?']) === false
      && nq('chain', ['5. **INT-5: в контракте описаны сообщения `{ slotId, busy }` — нужна ли конкретная подпись на стрелке, или только `INT-5`?**']) === false);
    // Вопрос, один ли это сервис, — вопрос «участники», а не о карточке, даже с одним номером в строке (формы из t-pool1 ring-q-two).
    check('этап, К1: вопрос-гипотеза об имени с номером карточки (это returns-api?, одним сервисом?, один из этих сервисов или другое имя?, отдельный участник?, YooKassa = ЮKassa?) — не лишний',
      nq('ring', ['3. INT-10: «бэкенд возвратов» — это returns-api?']) && nq('id', ['3. INT-4: «планшет группы» — отдельный участник?'])
      && nq('ring', ['Есть ли среди них один сервис под двумя именами? (В частности, «бэкенд возвратов» в INT-10 — это returns-api?)'])
      && nq('ring', ['1. В INT-10 указано «бэкенд возвратов», а в остальном — `returns-api`. Считать их одним сервисом?'])
      && nq('ring', ['В INT-10 «бэкенд возвратов» — это один из этих сервисов или другое имя? Если одно из названных — какое?'])
      && nq('rep', ['YooKassa (INT-8) — это ЮKassa?']) && nq('rep', ['INT-8: YooKassa = ЮKassa?']));
    check('этап, К1 (sameQuestion): «это» без имени стороны после него и без слов о сервисе/участнике — вопрос о карточке; имени стороны в строке нет — тоже',
      !sameQuestion('INT-4: notify — это получатель события?', asIs('id')) && !sameQuestion('INT-2: это событие? parking-api → notify', asIs('det'))
      && !sameQuestion('INT-3: это синхронный вызов?', asIs('det')) && sameQuestion('INT-10: «бэкенд возвратов» — это `returns-api`?', asIs('ring'))
      && sameQuestion('INT-6: repairy-telegram — это Telegram-бот из §1.2?', asIs('rep')));
    check('этап, К1: номер карточки без «?» и «?» в строке с двумя номерами — не вопрос о карточке', nq('det', ['INT-3 — одно звено.', 'INT-3 идёт после INT-6?']));
    // Скилл 5.0.0: за прогон — файл входа, типа и формата, по одному из папки `reference/`.
    const SEED = 'C:/Users/u/AppData/Local/Temp/skill-eval-seed/r-skills/interaction-diagram/reference';
    const refOne = (p, parent = null) => ev('Read', { file_path: `${SEED}/${p}` }, parent);
    const refs = (kind, format) => ['inputs/spec.md', `kinds/${kind}`, `notation/${format === 'puml' ? 'plantuml' : 'mermaid'}.md`].map((p) => refOne(p)).join('\n');
    const refEv = refs('short.md', 'mmd');
    const rd = (name, files) => {
      mkdirSync(join(tmp, 'ref', name), { recursive: true });
      for (const [f, text] of Object.entries(files)) writeFileSync(join(tmp, 'ref', name, f), text);
      return join(tmp, 'ref', name);
    };
    check('этап, Р1: Read входа, типа и формата — на первом ходу, по ходам или с обратными косыми в пути → прочитан', readReference(rd('first', { 'stream.jsonl': [readEv, refEv].join('\n'), 'stream-02.jsonl': writeEv(null) }))
      && readReference(rd('two', { 'stream.jsonl': [readEv, refOne('inputs/spec.md')].join('\n'), 'stream-02.jsonl': [refOne('kinds/short.md'), refOne('notation/mermaid.md')].join('\n') }))
      && readReference(rd('back', { 'stream.jsonl': ['inputs\\spec.md', 'kinds\\short.md', 'notation\\mermaid.md'].map((p) => ev('Read', { file_path: `C:\\seed\\interaction-diagram\\reference\\${p}` })).join('\n') }))
      && readReference(rd('puml', { 'stream.jsonl': refs('scenario.md', 'puml') }), 'scenario.md', 'puml'));
    check('этап, Р1: без Read, Read субагента, файла формата нет, лишний файл из папки, не тот тип или формат, путь в Bash, папки нет → не прочитан', readReference(rd('none', { 'stream.jsonl': readEv, 'stream-02.jsonl': writeEv(null) })) === false
      && readReference(rd('sub', { 'stream.jsonl': ['inputs/spec.md', 'kinds/short.md', 'notation/mermaid.md'].map((p) => refOne(p, 'toolu_parent')).join('\n') })) === false
      && readReference(rd('nonot', { 'stream.jsonl': [refOne('inputs/spec.md'), refOne('kinds/short.md')].join('\n') })) === false
      && readReference(rd('extra', { 'stream.jsonl': [refEv, refOne('kinds/scenario.md')].join('\n') })) === false
      && readReference(rd('kind', { 'stream.jsonl': refs('scenario.md', 'mmd') })) === false
      && readReference(rd('fmt', { 'stream.jsonl': refEv }), 'short.md', 'puml') === false
      && readReference(rd('bash', { 'stream.jsonl': [refOne('inputs/spec.md'), refOne('notation/mermaid.md'), ev('Bash', { command: `cat ${SEED}/kinds/short.md` })].join('\n') })) === false
      && readReference(join(tmp, 'ref', 'нет-такой')) === false);

    // Раунд этапа К на синтетике: прогон на пробу с эталоном по истине; якоря песочницы, сводка и итог по порогам.
    const round = join(tmp, 'round');
    const SAID = { 'det-o-one': 'участники — все разные; INT-5 — два звена', 'det-o-two': 'участники — все разные; INT-5 — два звена',
      'det-t-short': 'участники — все разные; INT-5 — два звена', 'det-y-short': 'участники — все разные; порядок — как в списке; INT-5 — два звена',
      'id-q-mmd': 'участники — все разные, «планшет группы» — отдельный участник',
      'chain-q-mmd': 'участники — все разные; INT-2 — два звена; INT-3 — три звена', 'ring-q-one': '«бэкенд возвратов» = returns-api', 'ring-q-two': '«бэкенд возвратов» — отдельный участник',
      'rep-q-mmd': 'YooKassa = ЮKassa; INT-9: 1С → repairy-api' };
    const box = (k, over = {}) => { // в прежних двух ходах; `three` ставит перед ними ход 1, reference/short.md уезжает в ход 2 — как по Step 1
      const s = STAGE[k];
      const file = wantFile(specRel(s.fx), s.format, false);
      const a1 = ask(s.fx, CARD_Q[s.fx]);
      const a2 = [`схема: ${file}`, `порядок: ${head(k)}`, `со слов аналитика: ${SAID[k] ?? '—'}`, `без ответа: ${s.known ? '—' : 'участники, порядок, INT-2 — цепочка, INT-3 — цепочка'}`, // «без стрелки» — только INT-3
        `без стрелки: ${ST[k].filter((c) => !c.hops).map((c) => `INT-${c.n}`).join(', ') || '—'}`, 'другой формат рядом: —'].join('\n');
      return { 'answer-01.md': a1, 'answer-02.md': a2, 'answer.md': a1 + a2, 'stream.jsonl': [readEv, refs('short.md', s.format)].join('\n'), 'stream-02.jsonl': writeEv(null), [file]: se(k), ...over };
    };
    const srAt = (root, k, run, over, t1, s1) => {
      mk3(run, box(k, over), STAGE[k].fx, join(root, k), t1, s1);
      const p = parseProbe(k);
      return gradeRun(join(root, k, run), p.format, p.fx, p.detailed, p.q, p.st).r;
    };
    const sr = (k, run, over, t1, s1) => srAt(round, k, run, over, t1, s1);
    const SR = Object.fromEntries(Object.keys(STAGE).map((k) => [k, sr(k, 'run-01')]));
    for (const k of Object.keys(STAGE)) green(`${k}: песочница этапа (три хода) — зелёный целиком`, SR[k]);
    const has = (tag) => Object.keys(STAGE).filter((k) => Object.keys(SR[k]).some((a) => a.startsWith(`${tag} `))).join();
    check('этап: В4 нет только у chain-q-idk, Т1 и К1 — у всех десяти; И13 — где есть карточка без стрелок; И14 и В3 не ставятся', has('В4') === 'det-o-one,det-o-two,det-t-short,det-y-short,id-q-mmd,chain-q-mmd,ring-q-one,ring-q-two,rep-q-mmd'
      && has('И13') === 'chain-q-idk,ring-q-one,ring-q-two' && has('И14') === '' && has('В3') === ''
      && Object.keys(STAGE).every((k) => ['И0', 'И1', 'И15', 'Т1', 'В1', 'К1', 'Ш1', 'Р1'].every((tag) => Object.keys(SR[k]).some((a) => a.startsWith(`${tag} `)))));
    // Т1 в песочнице — отдельная папка, чтобы не менять счёт раунда ниже.
    const t1x = join(tmp, 't1x');
    check('этап, Т1: список карточек в ходе 1 → Т1 и В1 (схема верна); строка прогона называет промах', reds(srAt(t1x, 'det-o-one', 'run-01', {}, `${T1_OK}\nINT-1 «Начало»: parking-web → parking-api`)) === 'Т1,В1'
      && gradePool(join(t1x, 'det-o-one'), parseProbe('det-o-one')).out.includes('run-01: красный Т1,В1  новые файлы: coddoc/PRK-9/interaction_diagram.md  В1: Т1 есть INT-N'));
    check('этап, Т1: файл схемы записан на ходу 1 → Т1 и В1; вопросы хода 2 и схема не задеты', reds(srAt(t1x, 'ring-q-one', 'run-01', {}, T1_OK, [readEv, writeEv(null)].join('\n'))) === 'Т1,В1');
    check('det-t-short: сценарный файл вместо короткого (тип взят из запроса, а не из ответа) → И1, И2, Ш1', reds(srAt(t1x, 'det-t-short', 'run-01',
      { [wantFile(specRel('det'), 'mmd', false)]: null, 'coddoc/PRK-9/interaction_scenarios.md': '# Сценарии взаимодействий — PRK-9\n' })) === 'И1,И2,Ш1');
    const gsp = gradePool(join(round, 'det-o-one'), parseProbe('det-o-one'));
    check('этап: пул пробы — «схема верна» по якорям И, строка «спросил (В1)», клеток В3 нет', gsp.core === 1 && gsp.out.includes('схема верна (И0–И13, И15): 1/1')
      && gsp.out.includes('спросил (В1): 1/1') && gsp.out.includes('Р1 прочитан reference: 1/1') && !gsp.out.some((l) => l.includes('В3')));
    const ra = gradeRound(round);
    check('раунд: десять проб по прогону — спросил 10/10, схема верна 10/10 (det-t-short и det-y-short в сводке короткой), пары и контроль 2/2, итог зелёный', ra.green && ra.totals.asked.join() === '10,10' && ra.totals.core.join() === '10,10'
      && [ra.pairs.order, ra.pairs.names, ra.pairs.solo].map((x) => x.join('/')).join() === '2/2,2/2,2/2' && ra.out[ra.out.length - 1] === 'ИТОГ: ЗЕЛЁНЫЙ');
    check('раунд: строки сводки с порогами', ra.out.includes('спросил: 10/10 (100%) — порог 85%: да') && ra.out.includes('схема верна: 10/10 (100%) — порог 80%: да')
      && ra.out.includes('пара порядка det-o-one + det-o-two: 2/2 — порог 2/2: да') && ra.out.includes('пара имён ring-q-one + ring-q-two: 2/2 — порог 2/2: да')
      && ra.out.includes('контроль (К1) det-o-one + det-o-two: 2/2 — порог 2/2: да') && ra.out.includes('сбой API (вне знаменателей): 0'));
    // Отдельный счёт «схему верной» не красит, якорь файла — красит; сбой API и чужие папки раунда — вне знаменателей.
    const one = (k, run, over) => reds(sr(k, run, over));
    check('этап: файл схемы первым ходом → В1; reference не открыт → Р1; «со слов аналитика: —» → В4', one('ring-q-one', 'run-02', { 'stream.jsonl': [readEv, refs('short.md', 'puml'), writeEv(null)].join('\n') }) === 'В1'
      && one('ring-q-one', 'run-03', { 'stream.jsonl': readEv }) === 'Р1' && one('det-o-one', 'run-02', { 'answer-02.md': 'порядок: по времени, со слов аналитика\nсо слов аналитика: —' }) === 'В4');
    check('этап: снимок засева `_seeded.sha256` от раннера — не новый файл (И1 зелёный); чужой файл рядом — И1',
      reds(srAt(join(tmp, 'junk'), 'det-o-one', 'run-01', { '_seeded.sha256': 'abc  coddoc/PRK-9/technical_specification.md\n' })) === ''
      && reds(srAt(join(tmp, 'junk'), 'det-o-one', 'run-02', { 'notes.md': 'x' })) === 'И1');
    check('этап: вопрос о карточке с одним звеном → К1; INT-11 не назван в последнем ответе → И13; шапка не та → Ш1', one('det-o-one', 'run-03', { 'answer-01.md': ask('det', [...CARD_Q.det, `4. ${K3}`]) }) === 'К1'
      && one('ring-q-two', 'run-02', { 'answer-02.md': 'со слов аналитика: «бэкенд возвратов» — отдельный участник\nбез стрелки: одна карточка' }) === 'И13'
      && one('chain-q-idk', 'run-02', { [wantFile(specRel('chain'), 'mmd', false)]: se('chain-q-idk', undefined, 'по времени, со слов аналитика') }) === 'Ш1');
    const bad = sr('det-o-two', 'run-02', { 'answer-01.md': ask('det', [...CARD_Q.det, `4. ${K3}`]).replace('gate-controller, ', ''), [wantFile(specRel('det'), 'mmd', false)]: se('det-o-one') });
    check('этап: det-o-two в порядке det-o-one, без имени в вопросе, с вопросом о карточке с одним звеном → И15, В1, К1', reds(bad) === 'И15,В1,К1'
      && gradePool(join(round, 'det-o-two'), parseProbe('det-o-two')).out.includes('run-02: красный И15,В1,К1  новые файлы: coddoc/PRK-9/interaction_diagram.md  В1: участники'));
    check('этап: ring-q-two со склейкой в песочнице → И11', one('ring-q-two', 'run-03', { [wantFile(specRel('ring'), 'puml', false)]: se('ring-q-one') }) === 'И11');
    mk('run-04', { 'stream.jsonl': '', '_api-failure.txt': 'API Error' }, 'ring', join(round, 'ring-q-one'));
    mk3('run-04', { 'answer-01.md': ask('ring'), 'answer.md': ask('ring'), 'stream.jsonl': readEv, '_api-failure-turn.txt': 'ход 3: отказ API или пустой ответ' }, 'ring', join(round, 'ring-q-two'));
    mkdirSync(join(round, '_skills'), { recursive: true });
    mkdirSync(join(round, 'det-q-mmd', 'run-01'), { recursive: true });
    writeFileSync(join(round, '_commit.txt'), 'нет git');
    const rb = gradeRound(round);
    check('раунд: отдельный счёт «схему верной» не красит — схема верна 15/18 (83.3%) проходит, спросил 16/18 (88.8%) — проходит при пороге 85%', rb.out.includes('схема верна: 15/18 (83.3%) — порог 80%: да')
      && rb.out.includes('спросил: 16/18 (88.8%) — порог 85%: да') && rb.totals.core.join() === '15,18' && rb.totals.asked.join() === '16,18');
    check('раунд: пара порядка 4/5 при пороге 4/5 — да, пара имён 4/6 при пороге 5/6 — нет, контроль 3/5 — нет; итог красный', rb.out.includes('пара порядка det-o-one + det-o-two: 4/5 — порог 4/5: да')
      && rb.out.includes('пара имён ring-q-one + ring-q-two: 4/6 — порог 5/6: нет') && rb.out.includes('контроль (К1) det-o-one + det-o-two: 3/5 — порог 5/5: нет')
      && !rb.green && rb.out[rb.out.length - 1] === 'ИТОГ: КРАСНЫЙ');
    check('раунд: сбой API вне знаменателей и отдельной строкой; папка не этапа названа и не оценена, служебные пропущены', rb.failed.join() === 'ring-q-one/run-04,ring-q-two/run-04'
      && rb.out.includes('сбой API (вне знаменателей): 2 — ring-q-one/run-04, ring-q-two/run-04') && rb.out.includes('папки не этапа К (не оценены): det-q-mmd')
      && !rb.out.some((l) => l.startsWith('_') || l.startsWith('det-q-mmd:')));
    check('раунд: строка пробы — схема верна, спросил, Т1, К1, Ш1, Р1, В4, сбои API', rb.out.includes('det-o-one: схема верна 3/3 · спросил 3/3 · Т1 3/3 · К1 2/3 · Ш1 3/3 · Р1 3/3 · В4 2/3 · сбой API 0')
      && rb.out.includes('chain-q-idk: схема верна 2/2 · спросил 2/2 · Т1 2/2 · К1 2/2 · Ш1 1/2 · Р1 2/2 · В4 — · сбой API 0')
      && rb.out.includes('ring-q-one: схема верна 3/3 · спросил 2/3 · Т1 3/3 · К1 3/3 · Ш1 3/3 · Р1 2/3 · В4 3/3 · сбой API 1')
      && rb.out.includes('det-t-short: схема верна 1/1 · спросил 1/1 · Т1 1/1 · К1 1/1 · Ш1 1/1 · Р1 1/1 · В4 1/1 · сбой API 0')
      && rb.out.includes('det-y-short: схема верна 1/1 · спросил 1/1 · Т1 1/1 · К1 1/1 · Ш1 1/1 · Р1 1/1 · В4 1/1 · сбой API 0'));
    const cli = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--round', round], { encoding: 'utf8' });
    check('раунд: `--round` из командной строки печатает ту же сводку', norm(cli).trimEnd() === rb.out.join('\n'));
    // Вопрос об участниках судится по карточкам ДО ответа: имя, которое аналитик потом склеил, в вопросе обязано быть.
    check('этап: ring-q-one без «бэкенд возвратов» в вопросе → В1; chain-q-idk без schedule-service в вопросе → В1',
      one('ring-q-one', 'run-05', { 'answer-01.md': ask('ring', CARD_Q.ring).replace(', бэкенд возвратов', '') }) === 'В1'
      && one('chain-q-idk', 'run-03', { 'answer-01.md': ask('chain').replace('schedule-service, ', '') }) === 'В1');
    // Неполный раунд: все пороги пройдены, но у одной пробы прогонов нет, у другой — только сбой API.
    const part = join(tmp, 'round-part');
    for (const k of Object.keys(STAGE).filter((x) => x !== 'id-q-mmd' && x !== 'rep-q-mmd')) mk3('run-01', box(k), STAGE[k].fx, join(part, k));
    mk('run-01', { 'stream.jsonl': '', '_api-failure.txt': 'API Error' }, 'rep', join(part, 'rep-q-mmd'));
    const rc = gradeRound(part);
    check('раунд: неполный — пороги пройдены, пробы без прогонов в счёте названы, итог красный', !rc.green && rc.out.includes('спросил: 8/8 (100%) — порог 85%: да')
      && rc.out.filter((l) => l.endsWith(': да')).length === 5 && rc.out.includes('нет прогонов пробы: id-q-mmd, rep-q-mmd') && rc.out[rc.out.length - 1] === 'ИТОГ: КРАСНЫЙ');

    // Сценарная на синтетике: В1 по тексту первого хода, песочницы проб, сводка раунда по двум типам.
    const S1 = [...det.map((c) => `INT-${c.n} «карточка» — триггер: «${c.trigger}»`),
      `1. Участников 6: ${sidesOf(asIs('det')).join(', ')}. Считаю всех разными. Есть ли среди них один сервис под двумя именами?`, `2. ${K5}`,
      '3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-3; 2) «водитель нажал «Завершить и оплатить»» — INT-5. Без пользователя: INT-2, INT-4, INT-6. Верно?',
      '4. Внутренних шагов в карточках нет — рисую без них. Верно?'].join('\n');
    const us = (a1) => unaskedScen(a1, asIs('det')).join();
    check('сценарная, В1: полный набор → спросил; вопрос о порядке вместо сценариев → «сценарии»; без вопроса о шагах или только «Шаг 3» в заголовке → «шаги»',
      us(S1) === '' && us(S1.replace('3. Сценарии:', '3. По времени порядок:')) === 'сценарии'
      && us(S1.replace('4. Внутренних шагов в карточках нет — рисую без них. Верно?', '')) === 'шаги'
      && us(`**Шаг 3.** Вопросы\n${S1.replace('4. Внутренних шагов в карточках нет — рисую без них. Верно?', '')}`) === 'шаги');
    check('сценарная, В1: без одного участника → «участники»; INT-5 не назван нигде → «сценарии» и «цепочка INT-5»', us(S1.replace('notify, ', '')) === 'участники'
      && us(S1.replace(/INT-5/g, 'INT-X')) === 'сценарии,цепочка INT-5');
    // REP-214: вопросы хода 2 — участники (7 имён), направление INT-9, гипотеза сценариев со всеми номерами, шаги.
    const RS1 = [...rp.map((c) => `INT-${c.n} «карточка» — триггер: «${c.trigger}»`),
      `1. Участников 7: ${sidesOf(asIs('rep')).join(', ')}. Считаю всех разными. Есть ли среди них один сервис под двумя именами?`,
      '2. INT-9: направление не указано. 1С → repairy-api или repairy-api → 1С?',
      '3. Сценарии: 1) «заказчик нажимает «Оплатить этап» на принятом акте приёмки» — INT-1, внутри него INT-2, затем INT-3, INT-7; 2) «владелец компании нажимает «Вернуть» у оплаченного онлайн-платежа» — INT-8. Без пользователя: INT-4, внутри него INT-5, INT-6; INT-9. Верно?',
      '4. Внутренних шагов в карточках нет — рисую без них. Верно?'].join('\n');
    check('rep-s-mmd, В1: участники, направление INT-9, сценарии со всеми номерами, шаги → спросил; без YooKassa → «участники»; без INT-9 → «сценарии», «нет направления INT-9»',
      unaskedScen(RS1, asIs('rep')).join() === '' && unaskedScen(RS1.replace(', YooKassa', ''), asIs('rep')).join() === 'участники'
      && unaskedScen(RS1.replace(/INT-9/g, 'INT-X'), asIs('rep')).join() === 'сценарии,нет направления INT-9');
    // det-y-scen в песочнице: ход 2 — `S1`, истина — его гипотеза (INT-3 внутри INT-1, остальные без пользователя).
    SCEN_T['det-y-scen'] = hypothesis(S1, det, SB, PERSON.det).cands[0].rows;
    check('det-y-scen: гипотеза вопросов S1 — u1[3] | u5 | 2 | 4 | 6, не по правилу; построчно', sigAll(hypoReadings(S1, det)[0]) === 'u1[3] | u5 | 2 | 4 | 6' && !hypothesis(S1, det, SB, PERSON.det).rule
      && flowOfC(SCEN_T['det-y-scen'], det) === 'u r1.1 q1 r3.1 a3.1 p3 a1.1 p1 | u r5.1 r5.2 a5.2 a5.1 p5 | r2.1 q2 | r4.1 a4.1 | r6.1 q6 a6.1');
    const refScen = (k) => refs('scenario.md', SCEN[k].format);
    const sfile = (k) => specRel(SCEN[k].fx).replace('technical_specification.md', SCEN_FILES[SCEN[k].format]);
    const QS = { det: S1, rep: RS1, chb: CS1 };
    const sbox = (k, over = {}) => {
      const a1 = QS[SCEN[k].fx];
      const a2 = `схема: ${sfile(k)}\nсценариев: ${SCEN_T[k].length}\nсценарии: ${SCEN[k].known ? 'со слов аналитика' : 'не подтверждены, по карточке на сценарий'}`;
      const files = { 'answer-01.md': a1, 'answer-02.md': a2, 'answer.md': a1 + a2, 'stream.jsonl': [readEv, refScen(k)].join('\n'), 'stream-02.jsonl': writeEv(null), [sfile(k)]: se2(k), ...over };
      return Object.fromEntries(Object.entries(files).filter(([, v]) => v != null));
    };
    const sx = join(tmp, 'scen');
    const ssr = (k, run, over, root = sx, t1, s1) => { mk3(run, sbox(k, over), SCEN[k].fx, join(root, k), t1, s1); return gradeScenRun(join(root, k, run), SCEN[k].format, SCEN[k]).r; };
    for (const k of Object.keys(SCEN)) green(`${k}: песочница сценарной (три хода) — зелёный целиком`, ssr(k, 'run-01'));
    check('сценарная, Т1: файл сценариев записан на ходу 1 → Т1 и В1; список карточек с триггерами в ходе 1 → Т1 и В1',
      reds(ssr('det-s-mmd', 'run-11', {}, sx, T1_OK, [readEv, ev('Write', { file_path: 'C:/sb/coddoc/PRK-9/interaction_scenarios.md', content: 'x' })].join('\n'))) === 'Т1,В1'
      && reds(ssr('det-s-mmd', 'run-12', {}, sx, `${T1_OK}\n${S1}`)) === 'Т1,В1');
    check('сценарная, песочница: короткий файл вместо сценарного → С1, И2, Ш1; сценарный и короткий вместе → С1',
      reds(ssr('det-s-mmd', 'run-02', { [sfile('det-s-mmd')]: null, 'coddoc/PRK-9/interaction_diagram.md': ts.mmd })) === 'С1,И2,Ш1'
      && reds(ssr('det-s-mmd', 'run-03', { 'coddoc/PRK-9/interaction_diagram.md': ts.mmd })) === 'С1');
    check('сценарная, песочница: файл сценариев ходом вопросов → В1; вопроса о шагах нет → В1; открыт файл короткой вместо сценарной → Р1',
      reds(ssr('det-s-alt', 'run-02', { 'stream.jsonl': [readEv, refScen('det-s-alt'), ev('Write', { file_path: 'C:/sb/coddoc/PRK-9/interaction_scenarios.md', content: 'x' })].join('\n') })) === 'В1'
      && reds(ssr('det-s-alt', 'run-03', { 'answer-01.md': S1.replace('4. Внутренних шагов в карточках нет — рисую без них. Верно?', '') })) === 'В1'
      && reds(ssr('det-s-idk', 'run-02', { 'stream.jsonl': [readEv, refs('short.md', SCEN['det-s-idk'].format)].join('\n') })) === 'Р1');
    check('det-y-scen, песочница: схема по другой гипотезе (реплика А) → красный; та же гипотеза, ход 2 без неё → эталон по правилу, красный; строка пула — гипотеза и «по правилу»',
      !Object.values(ssr('det-y-scen', 'run-02', { [sfile('det-y-scen')]: se2('det-s-mmd') })).every(Boolean)
      && !Object.values(ssr('det-y-scen', 'run-03', { 'answer-01.md': S1.replace(/3\. Сценарии:.*\n/, '') })).every(Boolean)
      && gradePool(join(sx, 'det-y-scen'), parseProbe('det-y-scen')).out.includes('run-01: зелёный  новые файлы: coddoc/PRK-9/interaction_scenarios.md  гипотеза: u1[3] | u5 | 2 | 4 | 6 · по правилу триггеров: нет')
      && gradePool(join(sx, 'det-y-scen'), parseProbe('det-y-scen')).out.includes('гипотеза по правилу триггеров (вне «схема верна» и порогов): 0/3')
      && gradePool(join(sx, 'det-y-scen'), parseProbe('det-y-scen')).out.some((l) => l.startsWith('run-03: красный') && l.endsWith('гипотеза: не найдена (эталон — правило триггеров) · по правилу триггеров: нет')));
    check('rep-s-mmd, песочница: схема без склейки YooKassa → красный; «Сценарную.» без пометок INT-5 и с ними — зелёный',
      !Object.values(ssr('rep-s-mmd', 'run-02', { [sfile('rep-s-mmd')]: yoo })).every(Boolean)
      && Object.values(ssr('rep-s-mmd', 'run-03', { [sfile('rep-s-mmd')]: withNotes(true, true, { req: ['ключ'], ans: ['ETag'] }) })).every(Boolean));
    // chb: В1 с вопросом о телах INT-2, диагностика вопроса о телах INT-1, файл по прежнему правилу «первый запрос / последний ответ».
    const oldRule = [A_Q, A_P, B_Q, B_P].reduce((t, [a, b]) => t.replace(a, b), eC.mmd);
    check('chb-s-mmd, песочница: без вопроса о телах INT-2 → только В1 (промах «тело INT-2»); вопрос о телах INT-1 сверх набора — зелёный; файл по правилу «первый запрос / последний ответ» → С5; chb-s-idk с пометками INT-2 → С5',
      reds(ssr('chb-s-mmd', 'run-02', { 'answer-01.md': CS1.replace(`4. ${CQ}\n`, '') })) === 'В1'
      && reds(ssr('chb-s-mmd', 'run-03', { 'answer-01.md': `${CS1}\n7. ${CA1}` })) === ''
      && oldRule !== eC.mmd && reds(ssr('chb-s-mmd', 'run-04', { [sfile('chb-s-mmd')]: oldRule })) === 'С5'
      && reds(ssr('chb-s-idk', 'run-02', { [sfile('chb-s-idk')]: eC.mmd })) === 'С5');
    const gcp = gradePool(join(sx, 'chb-s-mmd'), parseProbe('chb-s-mmd'));
    check('chb-s-mmd, пул: строка прогона — промах В1 и диагностика «лишний вопрос о звене тела INT-1: да/нет»; сводная строка диагностики вне «схема верна»; «схема верна» 3/4 (В1 не красит)',
      gcp.out.includes('run-01: зелёный  новые файлы: coddoc/ESS-31/interaction_scenarios.md  лишний вопрос о звене тела INT-1: нет')
      && gcp.out.includes('run-02: красный В1  новые файлы: coddoc/ESS-31/interaction_scenarios.md  В1: тело INT-2  лишний вопрос о звене тела INT-1: нет')
      && gcp.out.includes('run-03: зелёный  новые файлы: coddoc/ESS-31/interaction_scenarios.md  лишний вопрос о звене тела INT-1: да')
      && gcp.out.includes('run-04: красный С5  новые файлы: coddoc/ESS-31/interaction_scenarios.md  лишний вопрос о звене тела INT-1: нет')
      && gcp.out.includes('лишний вопрос о звене тела INT-1 (вне «схема верна» и порогов): 1/4') && gcp.out.includes('схема верна (якоря И и С): 3/4')
      && gcp.out.includes('спросил (В1): 3/4') && gcp.extraQ === 1);
    const sgp = gradePool(join(sx, 'det-s-alt'), parseProbe('det-s-alt'));
    check('сценарная, пул: «схема верна» по якорям И и С, отдельный счёт не красит; строка «спросил (В1)»', sgp.core === 3 && sgp.whole === 1
      && sgp.out.includes('схема верна (якоря И и С): 3/3') && sgp.out.includes('спросил (В1): 1/3') && sgp.out.includes('run-03: красный В1  новые файлы: coddoc/PRK-9/interaction_scenarios.md  В1: шаги'));
    const sround = join(tmp, 'sround');
    for (const k of Object.keys(SCEN)) ssr(k, 'run-01', {}, sround);
    const sa = gradeRound(sround);
    check('раунд сценарной: короткой нет — её пороги не оцениваются; спросил 8/8, схема верна 8/8 (det-y-scen, rep-s-mmd и chb-* в сводке сценарной), пара 2/2; итог зелёный',
      sa.out.includes('--- короткая: проб в раунде нет — пороги не оцениваются') && sa.out.includes('спросил: 8/8 (100%) — порог 90%: да')
      && sa.out.includes('схема верна: 8/8 (100%) — порог 70%: да') && sa.out.includes('пара det-s-mmd + det-s-alt: 2/2 — порог 2/2: да')
      && sa.out.includes('det-s-idk: схема верна 1/1 · спросил 1/1 · Т1 1/1 · Ш1 1/1 · Р1 1/1 · сбой API 0')
      && sa.out.includes('det-y-scen: схема верна 1/1 · спросил 1/1 · Т1 1/1 · Ш1 1/1 · Р1 1/1 · по правилу триггеров 0/1 · сбой API 0')
      && sa.out.includes('rep-s-mmd: схема верна 1/1 · спросил 1/1 · Т1 1/1 · Ш1 1/1 · Р1 1/1 · сбой API 0')
      && sa.out.includes('chb-s-mmd: схема верна 1/1 · спросил 1/1 · Т1 1/1 · Ш1 1/1 · Р1 1/1 · лишний вопрос о теле INT-1 0/1 · сбой API 0')
      && sa.out.includes('chb-s-idk: схема верна 1/1 · спросил 1/1 · Т1 1/1 · Ш1 1/1 · Р1 1/1 · лишний вопрос о теле INT-1 0/1 · сбой API 0')
      && sa.green && sa.out[sa.out.length - 1] === 'ИТОГ: ЗЕЛЁНЫЙ');
    ssr('det-s-alt', 'run-02', { [sfile('det-s-alt')]: se2('det-s-mmd') }, sround); // реплика Б, а схема по реплике А
    const sb2 = gradeRound(sround);
    check('раунд сценарной: схема det-s-alt по реплике А → пара 2/3 ниже порога 3/3, схема верна 8/9 (88.8%) проходит; итог красный',
      sb2.out.includes('пара det-s-mmd + det-s-alt: 2/3 — порог 3/3: нет') && sb2.out.includes('схема верна: 8/9 (88.8%) — порог 70%: да') && !sb2.green
      && sb2.scen.pair.join('/') === '2/3');
    // Старый раунд (шесть прежних проб, chb-* нет) сводится как до chb: ни строки, ни «нет прогонов» о chb-*. Раунд из одних chb-* —
    // секция сценарной, прежние пробы названы непрогнанными (итог красный, как у любого неполного раунда).
    const sold = join(tmp, 'sold');
    for (const k of Object.keys(SCEN).filter((x) => !SCEN[x].opt)) ssr(k, 'run-01', {}, sold);
    const so = gradeRound(sold);
    const sonly = join(tmp, 'sonly');
    for (const k of ['chb-s-mmd', 'chb-s-idk']) ssr(k, 'run-01', {}, sonly);
    const sn = gradeRound(sonly);
    check('раунд без chb-*: спросил 6/6, схема верна 6/6, итог зелёный, о chb-* ни слова; раунд из одних chb-*: сценарная 2/2, «нет прогонов» — шесть прежних, итог красный',
      so.out.includes('спросил: 6/6 (100%) — порог 90%: да') && so.out.includes('схема верна: 6/6 (100%) — порог 70%: да') && so.green
      && !so.out.some((l) => l.includes('chb')) && so.out.length === sa.out.length - 2
      && sn.out.includes('спросил: 2/2 (100%) — порог 90%: да') && sn.out.includes('схема верна: 2/2 (100%) — порог 70%: да')
      && sn.out.includes('нет прогонов пробы: det-s-mmd, det-s-puml, det-s-alt, det-s-idk, det-y-scen, rep-s-mmd') && !sn.green);
    const mixed = join(tmp, 'mixed');
    mk3('run-01', box('det-o-one'), 'det', join(mixed, 'det-o-one'));
    ssr('det-s-mmd', 'run-01', {}, mixed);
    const mx = gradeRound(mixed);
    check('раунд из двух типов: обе сводки, пробы без прогонов названы по типам, итог красный', mx.out.includes('--- короткая') && mx.out.includes('--- сценарная')
      && mx.out.includes('нет прогонов пробы: det-o-two, det-t-short, det-y-short, id-q-mmd, chain-q-mmd, chain-q-idk, ring-q-one, ring-q-two, rep-q-mmd')
      && mx.out.includes('нет прогонов пробы: det-s-puml, det-s-alt, det-s-idk, det-y-scen, rep-s-mmd') && !mx.green);
    mkdirSync(join(tmp, 'nothing', 'det-q-mmd'), { recursive: true });
    const nx = gradeRound(join(tmp, 'nothing'));
    check('раунд без проб этапов: оба типа не оцениваются, итог красный', nx.out.filter((l) => l.endsWith('пороги не оцениваются')).length === 2 && nx.out[nx.out.length - 1] === 'ИТОГ: КРАСНЫЙ');
    // Известный результат: реальный зелёный прогон 4.2.0 `runs/2026-09-30-s-pool2/det-s-mmd/run-02` (два хода) сдвинут на ход
    // вперёд, ход 1 — выдуманный верный вопрос о типе: грейд обязан остаться зелёным. Тот же прогон как есть — красный Т1, В1.
    // Прогон 4.2.0 открывал `reference/scenario.md` — в копию дописаны чтения путей 5.0.0 (Р1); как есть он красный и по Р1.
    const real = join(HERE, 'runs/2026-09-30-s-pool2/det-s-mmd/run-02');
    if (existsSync(join(real, 'stream-02.jsonl'))) {
      const kr = join(tmp, 'known', 'det-s-mmd');
      mk3('run-02', Object.fromEntries(listFiles(real).map((f) => [f, readFileSync(join(real, f), 'utf8') + (f === 'stream-02.jsonl' ? `\n${refScen('det-s-mmd')}` : '')])), 'det', kr);
      check('известный результат: det-s-mmd/run-02 из s-pool2 со сдвигом на ход — зелёный; без сдвига (ход 1 — список и вопросы) → Т1, В1 (и Р1: пути 4.2.0)',
        gradePool(kr, parseProbe('det-s-mmd')).out.includes('run-02: зелёный  новые файлы: coddoc/PRK-9/interaction_scenarios.md')
        && reds(gradeScenRun(real, 'mmd', SCEN['det-s-mmd']).r) === 'Т1,В1,Р1');
    } else console.log('skip: прогона runs/2026-09-30-s-pool2/det-s-mmd/run-02 нет на диске');
    // Известный результат для динамической истины: файлы `t-pool1/det-s-alt` (реплика Б), гипотеза хода 2 той же формы, что
    // старая реплика Б. Зелёные по `SCEN_B` run-01 — зелёный и здесь; run-05 (INT-2 раньше INT-4) — красный и здесь.
    const altDir = join(HERE, 'runs/2026-10-01-t-pool1/det-s-alt');
    if (existsSync(join(altDir, 'run-05', 'coddoc/PRK-9/interaction_scenarios.md'))) {
      const HB = '3. Сценарии: 1) «водитель нажал «Начать парковку» на экране зоны» — INT-1, внутри него INT-3; затем INT-4, затем INT-2; 2) «водитель нажал «Завершить и оплатить»» — INT-5, затем INT-6. Верно?';
      const ga1 = gradeHypo(read(join(altDir, 'run-01', 'coddoc/PRK-9/interaction_scenarios.md')), 'mmd', det, HB, SB, PERSON.det);
      const ga5 = gradeHypo(read(join(altDir, 'run-05', 'coddoc/PRK-9/interaction_scenarios.md')), 'mmd', det, HB, SB, PERSON.det);
      check('известный результат det-y-scen: t-pool1 det-s-alt run-01 по гипотезе формы реплики Б — зелёный (u1[3]>4>2 | u5>6), run-05 — С3, С4',
        Object.values(ga1.r).every(Boolean) && ga1.diag.sig === 'u1[3]>4>2 | u5>6' && reds(ga5.r) === 'С3,С4');
    } else console.log('skip: прогонов runs/2026-10-01-t-pool1/det-s-alt нет на диске');
    // Проба id-ask (формат и тип не названы): по 4.3.0 первым ходом — вопрос о типе и вопрос о формате, больше ничего.
    const askRun = (name, answer) => { mk(name, { 'answer.md': answer }, 'id', join(tmp, 'id-ask')); return gradeRun(join(tmp, 'id-ask', name), 'ask', 'id').r; };
    const FMT = 'В каком формате нарисовать: Mermaid или PlantUML?';
    check('id-ask: вопрос о типе и о формате → зелёный; только о формате → А3; только о типе → А2; с ними список карточек → А3',
      Object.values(askRun('run-01', `${T1_OK}\n${FMT}`)).every(Boolean) && reds(askRun('run-02', FMT)) === 'А3' && reds(askRun('run-03', T1_OK)) === 'А2'
      && reds(askRun('run-04', `${T1_OK}\n${FMT}\nINT-1 «Создание заявки»: dispatch-web → dispatch-api`)) === 'А3');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  console.log(ok ? 'SELFTEST OK' : 'SELFTEST FAILED');
  process.exit(ok ? 0 : 1);
}

/**
 * Имя папки пробы → фикстура, тип, формат; пробы этапа К — по таблице `STAGE` (в `st`, имя пробы — в `name`; `q` —
 * строка прежнего опросника под тем же именем, оценке не нужна), пробы опросника — по `QPROBES`, именные — по `NAMED`.
 * Не распознано — null.
 */
export function parseProbe(base) {
  const key = (t) => Object.keys(t).find((k) => base === k || base.startsWith(`${k}-`));
  const ck = key(SCEN);
  if (ck) return { fx: SCEN[ck].fx, detailed: false, format: SCEN[ck].format, q: null, st: null, sc: SCEN[ck], name: ck };
  const sk = key(STAGE);
  if (sk) return { fx: STAGE[sk].fx, detailed: false, format: STAGE[sk].format, q: QPROBES[sk] ?? null, st: STAGE[sk], name: sk };
  const qk = key(QPROBES);
  if (qk) return { fx: QPROBES[qk].fx, detailed: !!QPROBES[qk].detailed, format: QPROBES[qk].format, q: QPROBES[qk] };
  if (key(NAMED)) return { ...NAMED[key(NAMED)], q: null };
  const bm = base.match(/^(id|ring|dir|rep|chain|det)(-det)?-(mmd|puml|ask)/);
  if (!bm) return null;
  return { fx: bm[1], detailed: bm[1] === 'det' || !!bm[2], format: bm[3], q: null }; // префикс det или вставка -det- — подробная
}

/** Пул пробы: строки вывода и счёт. Прогон со сбоем API в знаменатель не идёт ни у одной пробы. `st` — проба этапа К. */
export function gradePool(dir, { fx, detailed, format, q, st = null, sc = null }) {
  const out = [];
  const all = readdirSync(dir).filter((e) => /^run-\d+$/.test(e)).sort();
  const failed = all.filter((run) => apiFailed(join(dir, run)));
  const runs = all.filter((run) => !failed.includes(run));
  const tally = {};
  let whole = 0;
  // Зелёные все якоря, кроме И14 и Д5 (у них отдельный счёт); у опросника — ещё кроме В4. У этапа К — только якоря И
  // (И0–И13, И15): Т1, В1, В4, К1, Ш1, Р1 считаются отдельно. У сценарной — якоря И и С; Т1, В1, Ш1, Р1 — отдельно.
  let core = 0;
  let ruled = 0; // `det-y-scen`: гипотеза хода 2 совпала с правилом триггеров — диагностика вне «схема верна»
  let extraQ = 0; // `chb-*`: задан вопрос о звене тела, которого задавать не нужно (`extraBody`), — диагностика вне «схема верна»
  const cells = [0, 0, 0]; // В3: спросил и верно / спросил и неверно / не спросил
  for (const run of all) {
    if (failed.includes(run)) { out.push(`${run}: сбой API — в счёт не идёт`); continue; }
    const { r, made, miss = [], diag = null, extra = null } = sc ? gradeScenRun(join(dir, run), format, sc) : gradeRun(join(dir, run), format, fx, detailed, q, st);
    const green = Object.values(r).every(Boolean);
    if (green) whole += 1;
    if (Object.entries(r).every(([k, v]) => v || (sc ? !/^[ИС]\d+ /.test(k) : st ? !/^И\d+ /.test(k) : /^(И14|Д5|В4) /.test(k)))) core += 1;
    if (q && !st) cells[!r['В1 спросил'] ? 2 : r['В3 схема по ответу'] ? 0 : 1] += 1;
    for (const [k, v] of Object.entries(r)) tally[k] = (tally[k] ?? 0) + (v ? 1 : 0);
    if (diag?.rule) ruled += 1;
    if (extra) extraQ += 1;
    const red = Object.entries(r).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]);
    const hypo = !diag ? '' : `  гипотеза: ${diag.found ? diag.sig : 'не найдена (эталон — правило триггеров)'}${diag.readings > 1 ? ` (прочтений ${diag.readings})` : ''}`
      + ` · по правилу триггеров: ${diag.rule ? 'да' : 'нет'}`;
    const xq = extra == null ? '' : `  лишний вопрос о звене тела INT-${sc.extraBody.n}: ${extra ? 'да' : 'нет'}`;
    out.push(`${run}: ${green ? 'зелёный' : 'красный ' + red.join(',')}${made.length ? '  новые файлы: ' + made.join(', ') : ''}${miss.length ? '  В1: ' + miss.join(', ') : ''}${hypo}${xq}`);
  }
  out.push('---');
  for (const [k, v] of Object.entries(tally)) out.push(`${k}: ${v}/${runs.length}`);
  out.push(`зелёный целиком: ${whole}/${runs.length}`);
  if (sc) {
    out.push(`схема верна (якоря И и С): ${core}/${runs.length}`);
    out.push(`спросил (В1): ${tally['В1 спросил'] ?? 0}/${runs.length}`);
    if (sc.dyn) out.push(`гипотеза по правилу триггеров (вне «схема верна» и порогов): ${ruled}/${runs.length}`);
    if (sc.extraBody) out.push(`лишний вопрос о звене тела INT-${sc.extraBody.n} (вне «схема верна» и порогов): ${extraQ}/${runs.length}`);
  } else if (st) {
    out.push(`схема верна (И0–И13, И15): ${core}/${runs.length}`);
    out.push(`спросил (В1): ${tally['В1 спросил'] ?? 0}/${runs.length}`);
  } else {
    out.push(`схема верна (без И14, Д5${q ? ', В4' : ''}): ${core}/${runs.length}`);
    if (q) {
      out.push(`В3 по пулу: спросил и верно ${cells[0]} / спросил и неверно ${cells[1]} / не спросил ${cells[2]}`);
      out.push(`спросил (В1): ${cells[0] + cells[1]}/${runs.length}`);
    }
  }
  out.push(`сбой API: ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}`);
  return { out, n: runs.length, failed, whole, core, cells, tally, ruled, extraQ };
}

/** Порог пройден: доля не ниже `pct` процентов; без прогонов порог не пройден. */
export const passes = ([k, n], pct) => n > 0 && k * 100 >= n * pct;

/**
 * Сводка раунда: строка на папку пробы из `STAGE` (короткая) и `SCEN` (сценарная), затем по каждому типу — сводные
 * доли, пары и пороги `GATES`. Проб типа в раунде нет — его пороги не оцениваются, об этом строка. Прогоны со сбоем
 * API — вне знаменателей, отдельной строкой. Проба оцениваемого типа без единого прогона в счёте — итог красный: порог
 * пары по одному плечу не меряется; кроме проб `opt` (`chb-*`) — их нет в старых раундах, и без них сводка та же, что была.
 * Итог зелёный, только если оценён хотя бы один тип и все его пороги пройдены.
 */
export function gradeRound(roundDir) {
  const out = [];
  const rows = []; // { name, n, core, asked, solo } на папку пробы
  const failed = [];
  const other = []; // папки раунда не из `STAGE` и `SCEN` — не оцениваются
  for (const e of readdirSync(roundDir).sort()) {
    if (e.startsWith('_') || !statSync(join(roundDir, e)).isDirectory()) continue;
    const p = parseProbe(e);
    if (!p?.st && !p?.sc) { other.push(e); continue; }
    const g = gradePool(join(roundDir, e), p);
    const t = (k, on = true) => (on ? `${g.tally[k] ?? 0}/${g.n}` : '—');
    const t1 = `Т1 ${t('Т1 первый ход — вопрос о типе')}`;
    out.push(p.st
      ? `${e}: схема верна ${g.core}/${g.n} · спросил ${t('В1 спросил')} · ${t1} · К1 ${t('К1 лишнего вопроса о карточке нет')} · Ш1 ${t('Ш1 шапка: порядок')}`
        + ` · Р1 ${t('Р1 прочитан reference')} · В4 ${t('В4 со слов аналитика', !!p.st.said)} · сбой API ${g.failed.length}`
      : `${e}: схема верна ${g.core}/${g.n} · спросил ${t('В1 спросил')} · ${t1} · Ш1 ${t('Ш1 шапка: источник сценариев')} · Р1 ${t('Р1 прочитан reference')}`
        + `${p.sc.dyn ? ` · по правилу триггеров ${g.ruled}/${g.n}` : ''}${p.sc.extraBody ? ` · лишний вопрос о теле INT-${p.sc.extraBody.n} ${g.extraQ}/${g.n}` : ''}`
        + ` · сбой API ${g.failed.length}`);
    rows.push({ name: p.name, n: g.n, core: g.core, asked: g.tally['В1 спросил'] ?? 0, solo: g.tally['К1 лишнего вопроса о карточке нет'] ?? 0 });
    failed.push(...g.failed.map((run) => `${e}/${run}`));
  }
  const sum = (f, names) => rows.filter((x) => names.includes(x.name)).reduce(([k, n], x) => [k + x[f], n + x.n], [0, 0]);
  const pct = ([k, n]) => (n ? `${Math.floor((1000 * k) / n) / 10}%` : '—');
  const need = ([, n], gate) => `${Math.ceil((n * gate) / 100)}/${n}`;
  const [K, S] = [Object.keys(STAGE), Object.keys(SCEN)];
  const types = [ // [тип, пробы, строки: [подпись, счёт, порог, доля в процентах или минимум «k/N»]]
    ['короткая', K, [
      ['спросил', sum('asked', K), GATES.short.asked, true],
      ['схема верна', sum('core', K), GATES.short.core, true],
      [`пара порядка ${PAIRS.order.join(' + ')}`, sum('core', PAIRS.order), GATES.short.order, false],
      [`пара имён ${PAIRS.names.join(' + ')}`, sum('core', PAIRS.names), GATES.short.names, false],
      [`контроль (К1) ${PAIRS.solo.join(' + ')}`, sum('solo', PAIRS.solo), GATES.short.solo, false],
    ]],
    ['сценарная', S, [
      ['спросил', sum('asked', S), GATES.scen.asked, true],
      ['схема верна', sum('core', S), GATES.scen.core, true],
      [`пара ${PAIRS.scen.join(' + ')}`, sum('core', PAIRS.scen), GATES.scen.pair, false],
    ]],
  ];
  const empty = [];
  let green = true;
  let rated = 0;
  for (const [title, names, lines] of types) {
    if (!rows.some((x) => names.includes(x.name))) { out.push(`--- ${title}: проб в раунде нет — пороги не оцениваются`); continue; }
    rated += 1;
    out.push(`--- ${title}`);
    for (const [label, s, gate, share] of lines) {
      out.push(`${label}: ${s[0]}/${s[1]}${share ? ` (${pct(s)})` : ''} — порог ${share ? `${gate}%` : need(s, gate)}: ${passes(s, gate) ? 'да' : 'нет'}`);
    }
    const none = names.filter((k) => !SCEN[k]?.opt && sum('core', [k])[1] === 0); // `opt` — в раунде по желанию
    if (none.length) out.push(`нет прогонов пробы: ${none.join(', ')}`);
    empty.push(...none);
    green = green && none.length === 0 && lines.every(([, s, gate]) => passes(s, gate));
  }
  out.push('---');
  out.push(`сбой API (вне знаменателей): ${failed.length}${failed.length ? ` — ${failed.join(', ')}` : ''}`);
  if (other.length) out.push(`папки не этапа К (не оценены): ${other.join(', ')}`);
  out.push(`ИТОГ: ${rated > 0 && green ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}`);
  const [short, scen] = types.map(([, , lines]) => lines);
  return { out, green: rated > 0 && green, rows, failed, empty, totals: { asked: short[0][1], core: short[1][1] }, pairs: { order: short[2][1], names: short[3][1], solo: short[4][1] },
    scen: { asked: scen[0][1], core: scen[1][1], pair: scen[2][1] } };
}

// CLI — только при запуске этого файла, не при импорте из другого грейдера (`grade-pt.mjs`).
const isMain = process.argv[1] != null && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
const args = process.argv.slice(2);
if (args[0] === '--selftest') selftest();
else if (args[0] === '--round') {
  if (!args[1] || !existsSync(args[1]) || !statSync(args[1]).isDirectory()) { console.error(`папки раунда нет: '${args[1] ?? ''}' — usage: node grade-id.mjs --round <папка-раунда>`); process.exit(1); }
  for (const l of gradeRound(args[1]).out) console.log(l);
} else if (args[0]) {
  const dir = args[0];
  const fmtArg = args.find((a) => a.startsWith('--format='));
  const base = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const probe = parseProbe(base);
  if (!probe) { console.error(`имя пробы не распознано: '${base}' — ждём (id|ring|dir|rep|chain|det)[-det]-(mmd|puml|ask) или пробу из таблиц: ${[...new Set([...Object.keys(SCEN), ...Object.keys(STAGE), ...Object.keys(QPROBES), ...Object.keys(NAMED)])].join(', ')}`); process.exit(1); }
  if (fmtArg) probe.format = fmtArg.slice(9);
  if (probe.detailed && probe.format !== 'ask' && !DETAIL[probe.fx]) { console.error(`для ${FIXTURES[probe.fx]} нет таблицы истины подробной схемы (DETAIL)`); process.exit(1); }
  for (const l of gradePool(dir, probe).out) console.log(l);
} else {
  console.error('usage: node grade-id.mjs <папка-пробы> [--format=mmd|puml|ask] | --round <папка-раунда> | --selftest');
  process.exit(1);
}
}
