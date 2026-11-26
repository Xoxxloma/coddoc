// Истина по спеке — механический оракул для тира B (парный замер «автор против приёмки»).
//
// Зачем отдельный грейдер. В тире B спеку пишет прогон, и заранее известного ключа ответов у неё
// нет: что в ней нарушено — надо посчитать по файлу. Этот скрипт считает ровно те пункты
// чек-листа спеки, которые проверяются сканом и счётом, и возвращает список нарушений с цитатами.
// Дальше по нему меряются оба лечения: сколько из НАСТОЯЩИХ нарушений назвал автор в самопроверке
// и сколько — независимая приёмка, и сколько каждый добавил ложных.
//
// Разбор построчный. Регулярки только литеральные и только внутри строки: собирать выражения из
// строк в этой репе запрещено (`\Z` — это буква Z, на ней уже терялись пункты).
//
// Запуск:  node grade-rv-truth.mjs <путь-к-technical_specification.md>
//          node grade-rv-truth.mjs --self-test        (проверка на трёх известных фикстурах)

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ---------------------------------------------------------------- разбор файла

function parse(specPath) {
  const text = readFileSync(specPath, 'utf8');
  const lines = text.split('\n');

  // Шапка-легенда — блок строк, начинающихся с «>». Символы пометок в ней стоят по шаблону
  // в каждой спеке, и считать их за пометки нельзя: пункт сработал бы на любом документе.
  const isLegend = (s) => /^\s*>/.test(s);
  const body = lines.map((s, i) => ({ n: i + 1, s })).filter((o) => !isLegend(o.s));

  const statusLine = lines.find((s) => /Статус готовности/i.test(s)) ?? '';
  const status = (statusLine.split(':')[1] ?? '').replace(/\*/g, '').trim();

  // Карточки взаимодействий: от «### INT-» до следующего заголовка любого уровня.
  const cards = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^### INT-/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^#{2,3} /.test(lines[j])) j += 1;
    cards.push({ head: lines[i], from: i + 1, to: j, text: lines.slice(i, j).join('\n') });
  }

  // Секции: заголовок -> его текст до следующего заголовка ТОГО ЖЕ ИЛИ БОЛЕЕ ВЫСОКОГО уровня.
  // Вложенные подсекции входят в текст родителя: иначе §2 «Взаимодействия» выглядит пустой —
  // весь её текст лежит в карточках `### INT-*`. Самотест поймал это первым же прогоном.
  const levelOf = (s) => (s.match(/^#+/) ?? [''])[0].length;
  const sections = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^#{2,4} /.test(lines[i])) continue;
    const lvl = levelOf(lines[i]);
    let j = i + 1;
    while (j < lines.length && !(/^#{2,4} /.test(lines[j]) && levelOf(lines[j]) <= lvl)) j += 1;
    sections.set(lines[i].replace(/^#+\s*/, '').trim(), lines.slice(i + 1, j).join('\n').trim());
  }

  const sectionText = (prefix) => {
    for (const [head, txt] of sections) if (head.startsWith(prefix)) return txt;
    return null;
  };

  return { text, lines, body, status, cards, sections, sectionText };
}

// Пометка происхождения карточки: в заголовке либо строкой «Происхождение».
function markOf(card) {
  const src = card.head + '\n' + card.text;
  if (/(?:🔵|🟡)\s*подтвержд/i.test(src)) return 'yellow-confirmed';
  if (/🟡\s*к валидации/i.test(src) || (/🟡/.test(src) && /к валидации/i.test(src))) return 'yellow-tovalidate';
  if (/🟢/.test(src)) return 'green';
  if (/❓/.test(src)) return 'open';
  if (/🔵|🟡/.test(src)) return 'yellow-plain';
  return null;
}

const hasTransport = (t) =>
  /(GET|POST|PUT|PATCH|DELETE)\s*`?\s*\//.test(t) || /топик|очеред|событи[ея]\s+`/i.test(t);
const hasJson = (t) => /```json/.test(t);
const hasAuth = (t) => /авторизац/i.test(t);
const hasFields = (t) => /:\s*(int|string|iso8601|timestamp|jsonb|bool|uuid|number)\b/i.test(t);

// Список секций шаблона спеки — по чек-листу, пункт 11.
const TEMPLATE = [
  '1.1', '1.2', '1.3', '2.', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3', '4.3.1', '4.4',
  '5.1', '5.2', '5.3', '6.1', '6.2', '6.3', '6.4', '6.5', '7.', '8.',
];

// ---------------------------------------------------------------- сами проверки

export function truth(specPath) {
  const spec = parse(specPath);
  const v = [];
  const add = (code, where, evidence) => v.push({ code, where, evidence });

  // 4 — статус вне словаря спеки
  const statusOk = /^Готово к разработке$/.test(spec.status) || /^Требуются уточнения \(\d+\)$/.test(spec.status);
  if (!statusOk) add('status-vocab', 'шапка', spec.status || '(строки нет)');

  // 5 — заглушка шаблона
  const placeholder = spec.lines.find((s) => /<[А-ЯA-Z][^>]*>/.test(s));
  if (placeholder) add('placeholder', 'шапка', placeholder.trim());

  // 2 / 1 / 7 / 8 / 9 — по карточкам
  for (const c of spec.cards) {
    const name = (c.head.match(/INT-\d+/) ?? ['INT-?'])[0];
    const mark = markOf(c);
    if (!mark) add('no-provenance', name, c.head.trim());
    if (mark === 'yellow-tovalidate') {
      if (hasTransport(c.text) || hasJson(c.text) || hasFields(c.text)) {
        add('concrete-under-tovalidate', name, (c.text.split('\n').find((s) => hasTransport(s) || /```json/.test(s)) ?? '').trim());
      }
    }
    if (mark === 'green') {
      if (!hasTransport(c.text)) add('green-no-transport', name, c.head.trim());
      if (!hasJson(c.text)) add('green-no-example', name, c.head.trim());
      const s33 = spec.sectionText('3.3') ?? '';
      const s44 = spec.sectionText('4.4') ?? '';
      if (!hasAuth(c.text) && !/доступ/i.test(s33) && !/доступ/i.test(s44)) {
        add('green-no-auth', name, c.head.trim());
      }
    }
  }

  // 3 — FR источника без строки в §7
  const btPath = join(dirname(specPath), 'business_requirements.md');
  if (existsSync(btPath)) {
    const bt = readFileSync(btPath, 'utf8');
    const frs = [...new Set((bt.match(/FR-\d+/g) ?? []))];
    const s7 = spec.sectionText('7.') ?? '';
    for (const fr of frs) {
      const re = new RegExp(`${fr}(?!\\d)`);           // единственный собранный шаблон: номер FR
      if (!re.test(s7)) add('fr-no-acceptance', '§7', `${fr} нет в трассировке приёмки`);
    }
  }

  // 10 — открытая развилка при закрытом статусе (легенда исключена разбором)
  const forkLine = spec.body.find((o) => /❓/.test(o.s));
  if (forkLine && /^Готово к разработке$/.test(spec.status)) {
    add('open-fork-vs-status', `строка ${forkLine.n}`, forkLine.s.trim());
  }

  // 6 — число в статусе против блока §8
  const s8 = spec.sectionText('8.') ?? '';
  const openItems = s8.split('\n').filter((s) => /^\s*[-*]\s+\S/.test(s)).length;
  const declared = (spec.status.match(/\((\d+)\)/) ?? [])[1];
  if (declared !== undefined && Number(declared) !== openItems) {
    add('status-count-mismatch', '§8', `в статусе ${declared}, пунктов ${openItems}`);
  }
  if (/^Готово к разработке$/.test(spec.status) && openItems > 0) {
    add('status-count-mismatch', '§8', `статус закрыт, а пунктов ${openItems}`);
  }

  // 11 — секция шаблона отсутствует либо пуста без «не применимо»
  for (const pref of TEMPLATE) {
    const txt = spec.sectionText(pref);
    if (txt === null) add('section-missing', `§${pref}`, 'секции нет');
    else if (!txt.trim() && !/не применимо/i.test(txt)) add('section-empty', `§${pref}`, 'секция пуста');
  }

  // счётная строка: 🟡 подтверждено аналитиком с конкретикой
  const memory = spec.cards.filter(
    (c) => markOf(c) === 'yellow-confirmed' && (hasTransport(c.text) || hasFields(c.text)),
  ).length;

  return { violations: v, memory, status: spec.status, cards: spec.cards.length };
}

// ---------------------------------------------------------------- CLI

const arg = process.argv[2];

if (arg === '--self-test') {
  // Правило репы: грейдер валидируется на заведомо известном результате ДО публикации чисел.
  const base = join(process.cwd(), 'agent-version', '_skill-eval', 'fixtures');
  const at = (f) => join(base, f, 'coddoc', 'RMS-4021', 'technical_specification.md');
  const cases = [
    ['RV-CLEAN', 0, []],
    ['RV-DIRTY', 4, ['concrete-under-tovalidate', 'no-provenance', 'fr-no-acceptance', 'status-vocab']],
    ['RV-LOOP', 4, ['status-vocab', 'green-no-transport', 'green-no-example', 'green-no-auth']],
  ];
  let bad = 0;
  for (const [name, expected, codes] of cases) {
    const r = truth(at(name));
    const got = r.violations.map((x) => x.code);
    const okCount = got.length === expected;
    const okCodes = codes.every((c) => got.includes(c));
    if (!okCount || !okCodes) bad += 1;
    console.log(`${okCount && okCodes ? 'OK  ' : 'FAIL'} ${name}: ${got.length} нарушений (ждали ${expected}), память=${r.memory}`);
    for (const x of r.violations) console.log(`       ${x.code}  ${x.where}  «${x.evidence}»`);
  }
  process.exit(bad ? 1 : 0);
} else if (arg) {
  const r = truth(arg);
  console.log(JSON.stringify(r, null, 2));
} else {
  console.error('нужен путь к спеке либо --self-test');
  process.exit(1);
}
