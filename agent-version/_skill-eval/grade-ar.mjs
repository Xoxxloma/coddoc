// Грейдер archive-spec 2.0: архивация запускает ре-скан по подсказке «Задето»; карточки скилл не пишет.
// Запуск: node agent-version/_skill-eval/grade-ar.mjs <папка-раунда> [проба...]
//
// ПРОБА ОДНОХОДОВАЯ — ЭТО ПОТОЛОК ИЗМЕРЕНИЯ, А НЕ ПРОВАЛ СКИЛЛА. Шаг 3 требует подтверждения состава
// человеком и останавливает ход; до Шагов 4–6 (список сервисов, строка про клоны, вызов скана,
// отчёт) прогон в одном ходу не доходит. Поэтому такие проверки считаются, ТОЛЬКО когда состоялся
// второй ход (`answer-02.md`), а иначе печатаются как «не измеряется». Первая редакция грейдера
// считала их провалом — и красила зелёным ровно те прогоны, что нарушали Шаг 3 и бежали вперёд.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const base = join(process.cwd(), 'agent-version/_skill-eval');
const roundArg = process.argv[2];
if (!roundArg) { console.error('usage: node grade-ar.mjs <папка-раунда> [проба...]'); process.exit(1) }
const round = roundArg.startsWith('/') ? roundArg : join(process.cwd(), roundArg);

// scan: кого скилл обязан отдать в скан; named: кого обязан назвать, но в скан НЕ отдавать (Р5:
// роль «потребитель» без изменения контракта перечитывать незачем — спека назвала бы его иначе).
const PROBES = {
  arbasic:  { fix: 'AR-BASIC',  key: 'ARS-57',  scan: ['auth', 'geo'], named: ['incident-web'] },
  arepic:   { fix: 'AR-EPIC',   key: 'ARS-100', scan: [], named: [] },
  arlate:   { fix: 'AR-LATE',   key: 'ARS-100', scan: [], named: [] },
  arnocard: { fix: 'AR-NOCARD', key: 'ARS-70',  scan: ['auth', 'notify'], named: [] },
  artype:   { fix: 'AR-TYPE',   key: 'ARS-61',  scan: ['billing'], named: [] },
  arreal:   { fix: 'AR-REAL',   key: 'ARS-77',  scan: ['repairy-api', 'repairy-web'], named: [] },
  arbatch:  { fix: 'AR-BATCH',  key: 'SHP-11',  scan: ['orders-api', 'shop-web'], named: ['admin-web'] },
};
// Строки таблицы истории: | дата | задача | описание |
const histRows = (t) => t.split('\n').filter((l) => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)])) : []);
const probes = process.argv.slice(3).filter((p) => PROBES[p]);

for (const probe of (probes.length ? probes : Object.keys(PROBES))) {
  const { fix, key, scan, named } = PROBES[probe];
  const runsDir = join(round, probe);
  if (!existsSync(runsDir)) { console.log(`\n=== ${probe.toUpperCase()} — прогонов нет`); continue }
  const fixture = join(base, 'fixtures', fix);
  const runs = readdirSync(runsDir).filter((f) => /^run-\d+$/.test(f)).sort().map((f) => join(runsDir, f));
  const tally = {}; const lines = [];

  for (const run of runs) {
    const name = run.split(/[\\/]/).pop();
    const full = read(join(run, 'answer.md'));
    const turn2 = existsSync(join(run, 'answer-02.md'));       // подтверждение состава состоялось
    const streams = walk(run).filter((f) => /stream.*\.jsonl$/.test(f)).map(read).join('\n');
    const trace = read(join(run, '_trace.log'));
    const scanRan = /service-map ВЫЗВАН/i.test(trace);
    const fixCards = walk(join(fixture, 'services')).map((p) => p.slice(join(fixture, 'services').length + 1)).filter((f) => !/^_history[\\/]/.test(f));
    const hasServices = fixCards.length > 0 && fixCards.every((f) => existsSync(join(run, 'services', f)));
    const scanLines = full.split('\n').filter((l) => /service-map/i.test(l)).join('\n');
    const rel = (root) => walk(join(root, 'coddoc')).filter((f) => /\.archived$/.test(f)).map((f) => f.slice(join(root, 'coddoc').length + 1));
    const seeded = new Set(rel(fixture));
    const marks = rel(run).filter((m) => !seeded.has(m));   // только поставленные прогоном

    const res = {
      // ── Шаг 3: меряется в любом прогоне ───────────────────────────────────────────────
      'AR-8 состав предъявлен и подтверждения ждут': new RegExp(`(состав|${key})`, 'i').test(full) && /подтвер(д|жд)/i.test(full),
      'AR-20.3 карточки и манифест не тронуты': hasServices ? fixCards.every((f) => read(join(run, 'services', f)) === read(join(fixture, 'services', f))) : null,
      'AR-18 git не запускался': streams ? !/"name":"Bash"[^\n]*(?<![.\w/-])git /.test(streams) : null,
      'AR-24 файла отчёта на диск нет': walk(join(run, 'coddoc')).every((f) => !/ARCHIVE_REPORT/i.test(f)),
      'AR-3 без подтверждения метка не кладётся': turn2 ? null : marks.length === 0,   // marks = новые, без засеянных
      // ── Шаги 4–6: только после подтверждения ──────────────────────────────────────────
      'AR-20.1 скан вызван (по следу заглушки)': turn2 ? scanRan : null,
      'AR-22 клоны названы перед сканом': turn2 ? /(подтян|клон)/i.test(full) : null,
      'AR-28 подсказка «Задето» дошла до скана': turn2 ? (scanRan ? /подсказка=(?!нет)\S/i.test(trace) : /задето/i.test(full)) : null,
      'AR-23 метка поставлена после успешного скана': scanRan ? marks.length > 0 : null,
    };
    if (scan.length) res['AR-20.2 в скан отданы нужные сервисы'] = turn2 ? scan.every((s) => new RegExp(s).test(scanRan ? trace : scanLines)) : null;
    if (named.length) {
      res['Р5 потребитель назван, но в скан не отдан'] = turn2 ? named.every((s) => new RegExp(s).test(full) && !new RegExp(s).test(scanRan ? trace : scanLines)) : null;
    }
    if (probe === 'arbasic') res['AR-22 депрекейт §6.2 назван кандидатом в notes'] = turn2 ? /v1\/session/.test(full) && /notes/i.test(full) : null;
    if (probe === 'arepic' || probe === 'arlate') {
      res['AR-20 метка не на корне эпика'] = !existsSync(join(run, 'coddoc', key, '.archived'));
      res['прежние метки целы'] = !existsSync(join(fixture, 'coddoc', key, 'ARS-101/.archived')) || existsSync(join(run, 'coddoc', key, 'ARS-101/.archived'));
    }
    if (probe === 'arepic') res['AR-7 ARS-103 назван как узел без спеки'] = /ARS-103/.test(full);
    if (probe === 'arepic') {
      // История — только по изменяемым сервисам: фундамент меняет geo, ARS-102 — incident-web (geo у него «потребитель»).
      const keys = (svc) => histRows(read(join(run, 'services/_history', svc + '.md'))).map((r) => r[1]);
      const g = keys('geo'), w = keys('incident-web');
      res['AR-H история только по изменяемым сервисам'] = turn2 ? g.length > 0 && g.every((k) => k === key) && w.length > 0 && w.every((k) => k === 'ARS-102') : null;
    }
    // Состав предъявляется в первом ходу; на повторную реплику после работы «всё уже архивировано» — верный ответ.
    const first = read(join(run, 'answer-01.md')) || full;
    if (probe === 'arlate') res['AR-25 поздняя спека ARS-103 взята в состав'] = /ARS-103/.test(first) && !/всё уже архивировано/i.test(first);
    if (probe === 'arnocard') res['AR-21 карточка отсутствующему сервису не создана'] = !existsSync(join(run, 'services/notify.md'));
    if (probe === 'arreal') {
      const src = scanRan ? trace : full;
      res['AR-29 вызов remind в подсказке'] = turn2 ? /acceptances\/:id\/remind/.test(src) : null;
      res['AR-30 поле lastRemindedAt в подсказке'] = turn2 ? /lastRemindedAt|когда последний раз напоминали/i.test(src) : null;
      res['AR-31 число §5.1 (45 → 60 с) в подсказке'] = turn2 ? /60 ?с|60 секунд/.test(src) : null;
    }
    if (probe === 'arbatch') {
      const calls = (trace.match(/service-map ВЫЗВАН/g) || []).length;
      const seedHist = read(join(fixture, 'services/_history/orders-api.md'));
      const apiHist = read(join(run, 'services/_history/orders-api.md'));
      const webHist = read(join(run, 'services/_history/shop-web.md'));
      const apiNew = histRows(apiHist).slice(histRows(seedHist).length);
      const webNew = histRows(webHist);
      const n = (rows, k) => rows.filter((r) => r[1] === k).length;
      const desc = (rows, k) => (rows.find((r) => r[1] === k) || [])[2] || '';
      const all = [...apiNew, ...webNew];
      res['B1 пачка — один вызов скана'] = turn2 ? calls === 1 : null;
      res['B2 метки на трёх задачах пачки'] = turn2 ? ['SHP-11', 'SHP-12', 'SHP-15'].every((k) => existsSync(join(run, 'coddoc', k, '.archived'))) : null;
      res['B3 SHP-14 вне пачки не тронута'] = !existsSync(join(run, 'coddoc/SHP-14/.archived'));
      res['B4 прежние строки истории целы'] = turn2 ? apiHist.startsWith(seedHist.trimEnd()) : null;
      res['B5 orders-api: SHP-11 и SHP-12 по строке, SHP-15 нет'] = turn2 ? n(apiNew, 'SHP-11') === 1 && n(apiNew, 'SHP-12') === 1 && n(apiNew, 'SHP-15') === 0 : null;
      res['B6 shop-web: файл создан, SHP-11 и SHP-15 по строке, SHP-12 нет'] = turn2 ? /\|\s*Дата\s*\|\s*Задача\s*\|\s*Описание\s*\|/.test(webHist) && n(webNew, 'SHP-11') === 1 && n(webNew, 'SHP-15') === 1 && n(webNew, 'SHP-12') === 0 : null;
      res['B7 строка — дата, задача, описание'] = turn2 ? all.length > 0 && all.every((r) => r.length === 3) : null;
      res['B8 описание — название задачи'] = turn2 ? /напомина/i.test(desc(apiNew, 'SHP-11')) && /(лимит|выгрузк)/i.test(desc(apiNew, 'SHP-12')) && /(дат|часов)/i.test(desc(webNew, 'SHP-15')) : null;
      res['B9 одна дата на пачку'] = turn2 ? new Set(all.map((r) => r[0])).size === 1 : null;
      res['B10 у потребителя истории нет'] = turn2 ? !existsSync(join(run, 'services/_history/admin-web.md')) : null;
      res['B11 CSV «не найдено» назван в отчёте'] = turn2 ? /CSV[\s\S]{0,400}(не найден|не наш[её]л|не нашл)|(не найден|не наш[её]л|не нашл)[\s\S]{0,400}CSV/i.test(full) : null;
    }
    if (probe === 'artype') res['AR-11 расхождение типа названо'] = turn2 ? /экран/i.test(full) && /(тип|type|backend|frontend|фронт|манифест)/i.test(full) : null;

    const failed = Object.entries(res).filter(([, v]) => v === false).map(([k]) => k);
    const skipped = Object.entries(res).filter(([, v]) => v === null).length;
    for (const [k, v] of Object.entries(res)) { if (v === null) continue; tally[k] = tally[k] || { pass: 0, total: 0 }; tally[k].total++; if (v) tally[k].pass++ }
    lines.push(`${name}: ${failed.length ? 'FAIL — ' + failed.join('; ') : 'PASS'}   [ходов: ${turn2 ? '2+' : '1'}, не измерено: ${skipped}, меток поставлено: ${marks.length}]`);
  }

  console.log(`\n=== ${probe.toUpperCase()} (${fix}) — ${runs.length} прогонов ===`);
  lines.forEach((l) => console.log(l));
  console.log('--- по пунктам (только измеренное) ---');
  for (const [k, v] of Object.entries(tally)) console.log(`${v.pass}/${v.total}  ${k}`);
  console.log(`ПРОБА ЦЕЛИКОМ: ${lines.filter((l) => l.includes(': PASS')).length}/${runs.length}`);
}
