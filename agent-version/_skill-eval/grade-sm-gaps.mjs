#!/usr/bin/env node
// grade-sm-gaps.mjs <раунд> — грейдер фикстуры SM-GAPS (fixtures/SM-GAPS/KEY.md): шесть классов потерь
// service-map-2.0 против v1 — связь без клиента, «объявлено, но не работает», вход, точки встраивания,
// параллельный запуск задачи, дробность «Что умеет». Раунд — папка run-sm-mono.sh (`_mono.json`,
// `sandbox/mono-NN/w/AI-SDD/services/<сервис>.md`). Грейдит файл карточки, а не отчёт прогона.
import fs from 'node:fs';
import path from 'node:path';

const round = process.argv[2];
if (!round) { console.error('грейдер: node grade-sm-gaps.mjs <раунд>'); process.exit(2); }
const meta = JSON.parse(fs.readFileSync(path.join(round, '_mono.json'), 'utf8'));
const { fixture, service } = meta;
if (!/^SM-GAPS-(BACK|FRONT|KT|NODE)$/.test(fixture)) { console.error(`раунд не SM-GAPS: ${fixture}`); process.exit(2); }

// Секции «## …» карточки: имя → строки тела.
export function sections(md) {
  const out = {}; let cur = null;
  for (const l of md.split(/\r?\n/)) {
    const m = l.match(/^## (.+?)\s*$/);
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur) out[cur].push(l);
  }
  return out;
}
const sec = (S, name) => { const k = Object.keys(S).find((x) => x.startsWith(name)); return k ? S[k] : []; };
// Строки данных таблицы: без заголовка и разделителя.
const rows = (lines) => {
  const t = lines.filter((l) => /^\|/.test(l));
  return t.filter((l, i) => !/^\|[\s:|-]+\|\s*$/.test(l) && !(i + 1 < t.length && /^\|[\s:|-]+\|\s*$/.test(t[i + 1])));
};
// Блоки «### …» секции: заголовок → текст блока.
const blocks = (lines) => {
  const out = []; let cur = null;
  for (const l of lines) {
    if (/^### /.test(l)) { cur = { head: l.slice(4), body: [] }; out.push(cur); continue; }
    if (cur) cur.body.push(l);
  }
  return out.map((b) => ({ head: b.head, text: b.head + '\n' + b.body.join('\n') }));
};
const cell1 = (row) => (row.split('|')[1] || '').trim();

// Склеенная строка «Что умеет» — два разных глагола-действия в колонке «Возможность».
const VERBS = ['посмотреть', 'смотреть', 'сохранить', 'отправить', 'подтвердить', 'вернуть', 'отклонить', 'запросить',
  'открыть', 'решить', 'выгрузить', 'скачать', 'добавить', 'создать', 'удалить', 'назначить', 'изменить', 'найти',
  'показать', 'включить', 'сравнить', 'отметить', 'нарисовать', 'получить', 'заполнить', 'загрузить', 'выбрать',
  'собрать', 'увидеть', 'вести', 'править', 'согласовать', 'завести', 'убрать', 'закрыть', 'задать'];
const glued = (row) => {
  const words = cell1(row).toLowerCase().replace(/ё/g, 'е').match(/[а-я]+/g) || [];
  return new Set(words.filter((w) => VERBS.includes(w))).size >= 2;
};

const NOTWORK = /недоступ|не реализ|не работает|501|NOT_IMPLEMENTED|заглушк|не готов/i;
// догадка — утверждение «роли/вход выдаёт (проверяет, ставит) шлюз/оболочка»; цитата кода без такого глагола — не догадка
const GUESS_WHO = '(шлюз|оболочк|host-shell|хост[ -]?приложени)';
const GUESS_DO = '(выда|разда|ставит|проставл|назнача|определя|проверя)';
const GUESS = new RegExp(`${GUESS_DO}[а-яё]*[^|.;]{0,40}${GUESS_WHO}|${GUESS_WHO}[а-яё]*[^|.;]{0,40}${GUESS_DO}`, 'i');

function gradeBack(md) {
  const S = sections(md);
  const dep = sec(S, 'Зависит от').join('\n');
  const roles = sec(S, 'Роли и доступ').join('\n');
  const contract = blocks(sec(S, 'Публичный контракт'));
  const jobs = blocks(sec(S, 'Фоновые задачи'));
  const can = rows(sec(S, 'Что умеет'));
  const canText = can.join('\n');
  const r = {};
  r['1 pest-watch в «Зависит от»'] = /pest-?watch|pestwatch/i.test(dep);
  r['1 land-registry в «Зависит от»'] = /land-?registry|landreg/i.test(dep);
  r['1 weather-grid в «Зависит от»'] = /weather-?grid|weathergrid/i.test(dep);
  r['1 контроль staff-profile'] = /staff-?profile/i.test(dep);
  r['1 контроль audit-hub'] = /audit-?hub/i.test(dep);
  const station = blocks(sec(S, 'Владеет данными')).find((b) => /StationReading/.test(b.head));
  r['1 справочно: StationReading во «Владеет данными»'] = !station ? 'нет' : (/чуж|weather-?grid|weathergrid|только чтение|не владеет/i.test(station.text) ? 'есть, помечена чужой' : 'есть как своя');
  const decl = contract.find((b) => /POST\s+`?\S*\/entries\/\{agronomist\}`?\s*$/.test(b.head.trim()));
  const declCan = can.find((x) => /за агроном/i.test(x));
  r['2 POST /entries/{agronomist} помечен «не работает»'] = decl ? (NOTWORK.test(decl.text) ? true : 'блок есть, описан как рабочий')
    : (declCan && NOTWORK.test(declCan) ? 'только в «Что умеет»' : false);
  const send = contract.find((b) => /\/reports\/digest\/send/.test(b.head));
  const sendCan = can.find((x) => /разосла|рассыл/i.test(x));
  r['2 POST /reports/digest/send помечен «не работает»'] = send ? (NOTWORK.test(send.text) ? true : 'блок есть, описан как рабочий')
    : (sendCan && NOTWORK.test(sendCan) ? 'только в «Что умеет»' : false);
  const upload = contract.find((b) => /\/imports\/weather/.test(b.head));
  r['3 справочно: загрузка показаний без проверки роли'] = upload ? (/без проверки|любой|не проверя/i.test(upload.text) ? 'да' : 'блок есть, о роли молчит') : 'блока нет';
  const pdf = contract.find((b) => /\/export\/pdf/.test(b.head));
  r['2 GET /export/pdf помечен «не работает»'] = pdf ? (NOTWORK.test(pdf.text) ? true : 'блок есть, описан как рабочий') : false;
  r['3 вход: заголовки X-Employee-*'] = /X-Employee-(Number|Roles)|заголов/i.test(roles) ? true
    : (/X-Employee-(Number|Roles)/.test(md) ? 'в карточке есть, но не в «Ролях и доступе»' : false);
  r['3 догадка «шлюз/оболочка» в «Ролях»'] = GUESS.test(roles);
  const esc = jobs.find((b) => /escalate|UnsubmittedWeeks/i.test(b.head));
  r['4 задача escalate: нет блокировки'] = esc ? (/блокировк|lock|реплик|дубл|параллел|одновремен/i.test(esc.text) ? true : 'блок есть, о запуске молчит') : false;
  r['6 «Что умеет»: строк'] = can.length;
  r['6 «Что умеет»: склеенных'] = can.filter(glued).length;
  r['6 удаление культуры удаляет значения'] = /культур[^|]*удал[^|]*значен|удал[^|]*культур[^|]*значен/i.test(canText);
  r['контроль: блоков контракта'] = contract.length;
  r['контроль: роли кода 3/3'] = ['AGRONOMIST', 'HEAD_AGRONOMIST', 'METHODIST'].filter((x) => new RegExp('`?' + x + '`?').test(roles)).length;
  return r;
}

function gradeFront(md) {
  const S = sections(md);
  const dep = sec(S, 'Зависит от').join('\n');
  const roles = sec(S, 'Роли и доступ').join('\n');
  const screens = rows(sec(S, 'Экраны'));
  const can = rows(sec(S, 'Что умеет'));
  const r = {};
  r['1 cargo-tracker в «Зависит от»'] = /cargo-?tracker/i.test(dep);
  r['1 portal-shell в «Зависит от»'] = /portal-?shell/i.test(dep);
  r['1 контроль yard-api'] = /yard-api/i.test(dep);
  const drv = md.split(/\r?\n/).filter((l) => /водител/i.test(l));
  r['2 водители: «не работает/скрыто/моки»'] = drv.length === 0 ? false
    : (drv.some((l) => NOTWORK.test(l) || /скрыт|мок|закоммент/i.test(l)) ? true : 'описаны как рабочие');
  r['2 контроль: /blocks/layer «не вызывается»'] = md.split(/\r?\n/).some((l) => /blocks\/layer/.test(l) && /не вызыва|не использ/i.test(l));
  r['3 вход: константа токена / интерсептор'] = /token|токен|интерсептор|authorization/i.test(roles) ? true
    : (/token\.ts|константы? `?token/i.test(md) ? 'в карточке есть, но не в «Ролях и доступе»' : false);
  r['3 догадка «шлюз/оболочка» в «Ролях»'] = GUESS.test(roles);
  r['4 точки встраивания в «Экранах» (из 3)'] = ['YardMap', 'MovePlanner', 'GateJournal'].filter((x) => screens.some((s) => s.includes(x))).length;
  r['4 входы хоста названы (из 4)'] = ['onContainerSelect', 'onPlanSaved', 'terminalId', 'initialBlock'].filter((x) => md.includes(x)).length;
  r['6 «Что умеет»: строк'] = can.length;
  r['6 «Что умеет»: склеенных'] = can.filter(glued).length;
  r['контроль: роутов в «Экранах» (из 4)'] = ['/yard', '/moves', '/gates', '/sandbox/draw'].filter((x) => screens.some((s) => s.includes('`' + x + '`'))).length;
  return r;
}

// SM-GAPS-KT: ручки — методы классов Kotlin, реализующих интерфейсы, которые генератор собирает при сборке из
// спецификации вне дерева (пометки у метода нет, пути не видно). Плюс механизм: строка разведчика с условием
// файла и итог плана — из стенограмм прогона.
const KT_IMPL = {
  LotsController: ['listLots', 'getLot', 'createLot', 'updateLot', 'retireLot', 'splitLot'],
  VaultController: ['listShelves', 'getShelf', 'moveLot', 'reserveSlot', 'releaseSlot'],
  GerminationController: ['startTest', 'recordCount', 'finishTest', 'listTests', 'getTest', 'cancelTest'],
  DonorsController: ['listDonors', 'getDonor', 'registerDonor', 'mergeDonors', 'blockDonor'],
  RequestsController: ['submitRequest', 'approveRequest', 'rejectRequest', 'shipRequest', 'listRequests', 'getRequest', 'cancelRequest'],
};
function gradeKt(md, dir) {
  const S = sections(md);
  const contract = blocks(sec(S, 'Публичный контракт'));
  const heads = contract.map((b) => b.head);
  const methods = Object.values(KT_IMPL).flat();
  const isImpl = (h) => methods.some((m) => new RegExp(`\\b${m}\\b`).test(h));
  const r = {};
  r['A реализации: блоков по методам (из 29)'] = methods.filter((m) => heads.some((h) => new RegExp(`\\b${m}\\b`).test(h))).length;
  r['A заголовки с путём не из кода'] = heads.filter((h) => /^`?(GET|POST|PUT|PATCH|DELETE)\s+`?\//.test(h) && !/\/internal\/ping|\/exports\/lots\.csv/.test(h)).length;
  r['A блоки реализаций с выдуманным путём'] = contract.filter((b) => isImpl(b.head) && /путь:\s*`?((GET|POST|PUT|PATCH|DELETE)\s+)?\/[A-Za-z{]/.test(b.text)).length;
  r['A ручки с аннотацией (из 2)'] = ['/internal/ping', '/exports/lots.csv'].filter((p) => heads.some((h) => h.includes(p))).length;
  r['A чужие override в контракте'] = ['compareTo', 'toString', 'preHandle', 'addInterceptors'].filter((m) => heads.some((h) => h.includes(m))).length;
  r['контроль: сущностей (из 6)'] = ['SeedLot', 'Shelf', 'Slot', 'GerminationTest', 'Donor', 'SeedRequest']
    .filter((e) => blocks(sec(S, 'Владеет данными')).some((b) => new RegExp(`\\b${e}\\b`).test(b.head))).length;
  r['контроль: задача ReservationSweeper'] = blocks(sec(S, 'Фоновые задачи')).some((b) => /sweep|ReservationSweeper/i.test(b.head));
  const sub = path.join(dir, '_sub');
  const subTxt = fs.existsSync(sub) ? fs.readdirSync(sub).map((f) => fs.readFileSync(path.join(sub, f), 'utf8')).join('\n') : '';
  const scoped = subTxt.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(##\s*)?контракт\s*::.*::\s*в файлах с\s/.test(l));
  r['механизм: строка разведчика «в файлах с»'] = scoped.length ? scoped[0].slice(0, 140) : 'нет';
  const st = fs.existsSync(path.join(dir, '_stream.jsonl')) ? fs.readFileSync(path.join(dir, '_stream.jsonl'), 'utf8') : '';
  r['механизм: итог плана'] = (st.match(/итог по классам: [^"\\]*/) || ['нет'])[0];
  r['механизм: вне условия файла'] = (st.match(/вне условия файла: [^"\\]*/) || ['нет'])[0];
  return r;
}

// SM-GAPS-NODE: имена топиков только в config/default.yaml (node-config), код берёт их из конфига; config/test.yaml —
// тестовые имена. Плюс механизм: строка разведчика `конфиг топиков` и сверка check.sh «топики … конфига против «Событий»».
const NODE_TOPICS = ['parcels.scanned', 'routes.assigned', 'couriers.status', 'parcels.delivered', 'parcels.lost'];
function gradeNode(md, dir) {
  const S = sections(md);
  const ev = blocks(sec(S, 'События'));
  const r = {};
  r['A топики конфига блоками «Событий» (из 5)'] = NODE_TOPICS.filter((t) => ev.some((b) => b.head.includes(t))).length;
  r['A тестовые имена (it.*) в карточке'] = /\bit\.(parcels|routes)\./.test(md);
  r['контроль: ручки (из 6)'] = ['/parcels/:track', '/parcels/:track/delivered', '/parcels/:track/lost', '/couriers', '/couriers/:id', '/health']
    .filter((p) => blocks(sec(S, 'Публичный контракт')).some((b) => new RegExp(`\\s\`?${p.replace(/\//g, '\\/').replace(/:(\w+)/g, '(:$1|\\{$1\\})')}\`?\\s*$`).test(b.head))).length;
  r['контроль: сущности (из 2)'] = ['Parcel', 'Courier'].filter((e) => blocks(sec(S, 'Владеет данными')).some((b) => new RegExp(`\\b${e}\\b`).test(b.head))).length;
  const sub = path.join(dir, '_sub');
  const subTxt = fs.existsSync(sub) ? fs.readdirSync(sub).map((f) => fs.readFileSync(path.join(sub, f), 'utf8')).join('\n') : '';
  const cfg = subTxt.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(##\s*)?конфиг топиков\s*::/.test(l));
  r['механизм: строка разведчика «конфиг топиков»'] = cfg.length ? [...new Set(cfg.map((l) => l.replace(/.*[\\/]/, '')))].join(', ') : 'нет';
  const st = fs.existsSync(path.join(dir, '_stream.jsonl')) ? fs.readFileSync(path.join(dir, '_stream.jsonl'), 'utf8') : '';
  r['механизм: сверка check.sh'] = (st.match(/топики (основного )?конфига( разведчика)? против «Событий»: [^"\\]*/) || ['нет'])[0];
  return r;
}

const sb = path.join(round, 'sandbox');
const runs = fs.existsSync(sb) ? fs.readdirSync(sb).filter((d) => /^mono-\d+$/.test(d)).sort() : [];
console.log(`SM-GAPS: ${fixture}, сервис ${service}, модель ${meta.model}, прогонов ${runs.length}`);
for (const d of runs) {
  const card = path.join(sb, d, 'w', 'AI-SDD', 'services', `${service}.md`);
  const cost = fs.existsSync(path.join(sb, d, '_cost.txt')) ? fs.readFileSync(path.join(sb, d, '_cost.txt'), 'utf8').trim() : '?';
  if (!fs.existsSync(card)) { console.log(`\n${d}: карточки нет (${fs.existsSync(path.join(sb, d, '_api-failure.txt')) ? 'отказ API — не измерено' : 'прогон не записал'})`); continue; }
  const md = fs.readFileSync(card, 'utf8');
  const res = fixture === 'SM-GAPS-BACK' ? gradeBack(md) : fixture === 'SM-GAPS-KT' ? gradeKt(md, path.join(sb, d)) : fixture === 'SM-GAPS-NODE' ? gradeNode(md, path.join(sb, d)) : gradeFront(md);
  console.log(`\n${d} (стоимость ${cost}):`);
  for (const [k, v] of Object.entries(res)) console.log(`  ${k}: ${v === true ? 'да' : v === false ? 'нет' : v}`);
}
