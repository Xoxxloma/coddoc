// Точечные пробы deep-search на случаи, которые основной пул не достаёт (ревью 2026-10-24):
//   E1, E1b, E1c — вход «Утверждение» у разведчика (этап 2: вызов из спеки), `Сервис` дан: утверждение
//     ложное / верное / верное в главном, но с неверной деталью;
//   E2 — `Сервис` дан, а кода сервиса рядом нет: пункт `[не нашёл]`, блока нет;
//   E3 — сверка ведущим составного пункта: одна ссылка подтверждается, другая нет;
//   E4, E5 — вопрос ведущего по блоку `## НУЖЕН ВЫБОР`: три варианта / один вариант, оба — с «Не надо».
//
//   node agent-version/_skill-eval/run-deep-search-edge.mjs <раунд> [прогонов] [модель] [пробы через запятую]
//   node agent-version/_skill-eval/run-deep-search-edge.mjs --selftest   // метки E1c, E4, E5 на известных ответах
//   node agent-version/_skill-eval/run-deep-search-edge.mjs --regrade <раунд>
//
// Песочница — как в run-deep-search-probes.mjs: копия fixtures/DS-BASE/ws во временной папке, `.git` дописываются.
// E2 дописывает в манифест сервис `pickup-points` без папки. E3 подаёт ведущему готовый ответ разведчика.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { modelId } from './model-id.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillSrc = resolve(here, '..', 'deep-search');
const fixtureWs = join(here, 'fixtures', 'DS-BASE', 'ws');

function seed(sb) {
  const ws = join(sb, 'ws');
  cpSync(fixtureWs, ws, { recursive: true });
  const put = (rel, body) => { const p = join(ws, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };
  put('AI-SDD/.git/HEAD', 'ref: refs/heads/main\n');
  put('tool-rental/.git/HEAD', 'ref: refs/heads/develop\n');
  put('deposit-service/.git/HEAD', 'ref: refs/heads/main\n');
  put('tool-catalog/.git', 'gitdir: /srv/git/tool-catalog/worktrees/main\n');
  return ws;
}

const scoutPrompt = (brief, root, lines) => [`Ты — разведчик скилла deep-search. Скилл уже запущен, ты его часть: инструмент Skill не вызывай. Сначала прочитай бриф ${brief} и работай строго по нему.`, ...lines, `Корень: ${root}`].join('\n');
// Ведущему — готовый ответ разведчика: только Шаги 3 и 4, без запуска разведчика.
const leadPrompt = (skill, question, scoutAnswer) => [
  `Ты — ведущий скилла deep-search: прочитай ${skill}. Разведчик уже отработал, его ответ ниже. Выполни только Шаги 3 и 4 — сверку ссылок и ответ в чат; разведчика не запускай.`,
  `Вопрос аналитика: ${question}`, '', ...scoutAnswer].join('\n');
const slash = (p) => p.replace(/\\/g, '/');
// Вопрос — в AskUserQuestion или текстом ответа (в `claude -p` вопрос приходит текстом).
const asked = (a, s) => `${s.asks}\n${a}`;
// Утверждение о tool-rental — как его отдаст спека: с `Сервис`.
const statement = (text) => ({ brief, root }) => scoutPrompt(brief, root, [`Утверждение: ${text}`]).replace(`Корень: ${root}`, `Корень: ${root}\nСервис: tool-rental`);
const noBlock = { 'блока выбора нет': (a) => !/## НУЖЕН ВЫБОР/.test(a), 'строки «вне манифеста» нет': (a) => !/вне манифеста:/i.test(a) };

const EDGE = [
  { id: 'e1-statement',
    prompt: ({ brief, root }) => scoutPrompt(brief, root, [
      'Утверждение: событие о возврате инструмента уходит в кафку внутри транзакции возврата, и при ошибке отправки возврат откатывается']).replace(`Корень: ${root}`, `Корень: ${root}\nСервис: tool-rental`),
    checks: {
      'вердикт «в коде иначе»': (a) => /Вердикт:\s*в коде иначе/i.test(a),
      'после коммита со ссылкой': (a) => /AFTER_COMMIT|после\s+коммит/i.test(a) && /RentalEventsPublisher\.kt:\d+/.test(a),
      'блока выбора нет': (a) => !/## НУЖЕН ВЫБОР/.test(a),
      'строки «вне манифеста» нет': (a) => !/вне манифеста:/i.test(a),
    } },
  { id: 'e1b-statement-true',
    prompt: statement('событие о возврате инструмента уходит в кафку после коммита транзакции возврата, ключ сообщения — toolId'),
    checks: {
      'вердикт «подтверждается»': (a) => /Вердикт:\s*подтверждается/i.test(a),
      'ссылка на отправку': (a) => /RentalEventsPublisher\.kt:\d+/.test(a),
      ...noBlock,
    } },
  { id: 'e1c-statement-partial',
    prompt: statement('событие о возврате инструмента уходит в кафку после коммита транзакции возврата, ключ сообщения — rentalId'),
    checks: {
      'вердикт «в коде иначе»': (a) => /Вердикт:\s*в коде иначе/i.test(a),
      'после коммита подтверждено': (a) => /AFTER_COMMIT|после\s+коммит/i.test(a),
      'ключ toolId из кода': (a) => /toolId/.test(a),
      'нет «ключ rentalId» как факта кода': (a) => !a.split('\n').some((l) => /\[в коде\][^\n]*ключ[^\n]{0,40}rentalId/i.test(l) && !/не\s+`?rentalId|а не|вместо|утвержд/i.test(l)),
      ...noBlock,
    } },
  { id: 'e2-service-nocode', manifestAdd: '  - name: pickup-points\n    path: ../pickup-points\n    type: backend\n',
    prompt: ({ brief, root }) => scoutPrompt(brief, root, ['Вопрос: как сейчас выдаётся инструмент через постамат?']).replace(`Корень: ${root}`, `Корень: ${root}\nСервис: pickup-points`),
    checks: {
      '«кода рядом нет» пунктом': (a) => /\[не нашёл\][^\n]*pickup-points[^\n]*(нет|не найден)|\[не нашёл\][^\n]*(кода|папк)[^\n]*pickup-points/i.test(a),
      'блока выбора нет': (a) => !/## НУЖЕН ВЫБОР/.test(a),
      'строки «вне манифеста» нет': (a) => !/вне манифеста:/i.test(a),
      'два заголовка ответа': (a) => /## ОТВЕТ ПО КОДУ/.test(a) && /## ПРОЧИТАНО/.test(a),
    } },
  { id: 'e3-composite',
    prompt: ({ skill, ws }) => [
      `Ты — ведущий скилла deep-search: прочитай ${skill}. Разведчик уже отработал, его ответ ниже. Выполни только Шаги 3 и 4 — сверку ссылок и ответ в чат; разведчика не запускай.`,
      'Вопрос аналитика: как сейчас уходит в кафку событие о возврате инструмента?',
      '',
      '## ОТВЕТ ПО КОДУ',
      '- [в коде] событие отправляет слушатель после коммита транзакции, ключ сообщения — rentalId — tool-rental/src/main/kotlin/ru/toolhire/rental/events/RentalEventsPublisher.kt:17; tool-rental/src/main/kotlin/ru/toolhire/rental/domain/RentalService.kt:4',
      '- [в коде] топик берётся из настройки rental.events-topic — tool-rental/src/main/resources/application.yml:22',
      '',
      '## ПРОЧИТАНО',
      `карточки: services/tool-rental.md; репа: tool-rental — ${join(ws, 'tool-rental').replace(/\\/g, '/')}, ветка develop; файлов кода открыто: 3`,
      'вне манифеста: —',
    ].join('\n'),
    checks: {
      'подтверждённая часть осталась': (a) => /после\s+коммит|AFTER_COMMIT/i.test(a),
      'неподтверждённая часть убрана': (a) => !a.split('\n').some((l) => /ключ[^\n]{0,40}rentalId/i.test(l) && !/не\s+подтверд|убрал|убран/i.test(l)),
      // Смысл, а не дословная строка: «убрал часть … не подтверждают» (P8, круг 2026-10-24) — то же.
      'строка о снятом': (a) => /не\s+подтвер|убрал/i.test(a),
      'второй пункт на месте': (a) => /rental\.events-topic|application\.yml:22/.test(a),
    } },
  { id: 'e4-block-three',
    prompt: ({ skill, ws }) => leadPrompt(skill, 'как сейчас считается стоимость доставки инструмента курьером?', [
      '## ОТВЕТ ПО КОДУ',
      '- [не нашёл] доставки курьером в описаниях карточек нет',
      '',
      '## НУЖЕН ВЫБОР',
      'причина: сервис не определён',
      `варианты: tool-rental; deposit-service; tool-catalog — ${slash(join(ws, 'tool-catalog'))}`,
      '',
      '## ПРОЧИТАНО',
      'карточки: —; репа: —; файлов кода открыто: 0',
      `вне манифеста: tool-catalog — ${slash(join(ws, 'tool-catalog'))}`]),
    checks: {
      // Смысл причины: «не определён» и «не могу определить» (круг 2026-10-24, перегрейд).
      'причина в вопросе': (a, s) => /не\s+(могу\s+|удалось\s+)?определ/i.test(asked(a, s)),
      'все три варианта': (a, s) => ['tool-rental', 'deposit-service', 'tool-catalog'].every((v) => asked(a, s).includes(v)),
      '«Не надо» вариантом': (a, s) => /не надо/i.test(asked(a, s)),
      'разведчика не запускал': (a, s) => s.agents === 0,
      'своих пунктов нет': (a) => !/\[в коде\]/.test(a),
    } },
  { id: 'e5-block-one',
    prompt: ({ skill, ws }) => leadPrompt(skill, 'как сейчас выдаётся инструмент через постамат?', [
      '## ОТВЕТ ПО КОДУ',
      '- [не нашёл] кода pickup-points рядом нет',
      '',
      '## НУЖЕН ВЫБОР',
      'причина: кода нет',
      `варианты: tool-catalog — ${slash(join(ws, 'tool-catalog'))}`,
      '',
      '## ПРОЧИТАНО',
      'карточки: services/pickup-points.md; репа: —; файлов кода открыто: 0',
      `вне манифеста: tool-catalog — ${slash(join(ws, 'tool-catalog'))}`]),
    checks: {
      'причина в вопросе': (a, s) => /кода[^\n]{0,30}нет/i.test(asked(a, s)),
      'вариант tool-catalog': (a, s) => asked(a, s).includes('tool-catalog'),
      '«Не надо» вариантом': (a, s) => /не надо/i.test(asked(a, s)),
      'разведчика не запускал': (a, s) => s.agents === 0,
      'своих пунктов нет': (a) => !/\[в коде\]/.test(a),
    } },
];

function selftest() {
  let fails = 0;
  const e4 = EDGE.find((e) => e.id === 'e4-block-three'), e5 = EDGE.find((e) => e.id === 'e5-block-one');
  const good4 = '- [не нашёл] доставки нет\nСервис не определён. Где посмотреть? 1) tool-rental 2) deposit-service 3) tool-catalog 4) Не надо';
  const good5 = '- [не нашёл] кода pickup-points рядом нет\nКода pickup-points нет. Посмотреть в tool-catalog? — tool-catalog / Не надо';
  for (const [e, a] of [[e4, good4], [e5, good5]]) for (const [k, f] of Object.entries(e.checks)) if (!f(a, { asks: '', agents: 0 })) { fails++; console.log(`  ✗ хороший ответ ${e.id} провалил: ${k}`); }
  const bad = '- [в коде] доставка считается в tool-rental — tool-rental/x.kt:1\nПосмотреть в tool-rental? Да / Нет';
  for (const e of [e4, e5]) for (const k of ['«Не надо» вариантом', 'разведчика не запускал', 'своих пунктов нет'])
    if (e.checks[k](bad, { asks: '', agents: 1 }) !== false) { fails++; console.log(`  ✗ плохой ответ ${e.id} не пойман: ${k}`); }
  if (e4.checks['все три варианта'](bad, { asks: '', agents: 0 })) { fails++; console.log('  ✗ e4: неполные варианты не пойманы'); }
  if (!e4.checks['причина в вопросе']('Не могу определить сервис. Где искать?', { asks: '' }) || e4.checks['причина в вопросе']('Где искать?', { asks: '' })) { fails++; console.log('  ✗ e4: метка причины'); }
  const e1c = EDGE.find((e) => e.id === 'e1c-statement-partial');
  const goodC = '## ОТВЕТ ПО КОДУ\nВердикт: в коде иначе\n- [в коде] отправка после коммита — tool-rental/x/RentalEventsPublisher.kt:17\n- [в коде] ключ сообщения — toolId, а не rentalId — tool-rental/x/RentalEventsPublisher.kt:19\n\n## ПРОЧИТАНО\nкарточки: services/tool-rental.md';
  const badC = '## ОТВЕТ ПО КОДУ\nВердикт: подтверждается\n- [в коде] после коммита, ключ сообщения rentalId — tool-rental/x/RentalEventsPublisher.kt:17\n\n## НУЖЕН ВЫБОР\n\nвне манифеста: tool-catalog';
  for (const [k, f] of Object.entries(e1c.checks)) {
    if (!f(goodC)) { fails++; console.log(`  ✗ хороший ответ e1c провалил: ${k}`); }
    if (k !== 'после коммита подтверждено' && f(badC)) { fails++; console.log(`  ✗ плохой ответ e1c не пойман: ${k}`); }
  }
  console.log(fails ? `оценщик: провалов ${fails}` : 'оценщик: хорошие ответы — всё ✓, плохие — пойманы');
  return fails;
}

function runClaude(cwd, prompt, model, out) {
  return new Promise((done) => {
    const p = spawn('bash', ['-c', 'claude -p "$PROBE_PROMPT" --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose'],
      { cwd, env: { ...process.env, PROBE_PROMPT: prompt, PROBE_MODEL: model, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    const timer = setTimeout(() => p.kill(), 600_000);
    p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(out, 'stream.jsonl'), stdout); done(code); });
  });
}

/** Последний result, вопросы ведущего и число его запусков субагента. */
function readStream(path) {
  const ev = readFileSync(path, 'utf8').split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const main = ev.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id).flatMap((e) => e.message?.content ?? []).filter((c) => c.type === 'tool_use');
  return { r: ev.filter((e) => e.type === 'result').at(-1) ?? {},
    asks: main.filter((c) => c.name === 'AskUserQuestion').map((c) => JSON.stringify(c.input ?? {})).join('\n'),
    agents: main.filter((c) => ['Agent', 'Task'].includes(c.name)).length };
}

async function main() {
  if (process.argv[2] === '--selftest') process.exit(selftest() ? 1 : 0);
  if (process.argv[2] === '--regrade') {
    if (selftest()) throw new Error('оценщик не прошёл самопроверку');
    const roundDir = join(here, 'runs', process.argv[3]);
    const edge = EDGE.filter((e) => existsSync(join(roundDir, e.id)));
    const jobs = edge.flatMap((e) => readdirSync(join(roundDir, e.id)).filter((d) => /^run-\d+$/.test(d)).sort()
      .map((d) => ({ e, i: Number(d.slice(4)), out: join(roundDir, e.id, d) })));
    return writeReport(roundDir, `раунд ${process.argv[3]} · перегрейд`, edge, jobs);
  }
  const round = process.argv[2];
  const n = Number(process.argv[3] ?? 3);
  const model = modelId(process.argv[4] ?? 'claude-sonnet-5');
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  if (!round) throw new Error('нужно имя раунда');
  if (selftest()) throw new Error('оценщик не прошёл самопроверку — прогоны не запускаю');
  const roundDir = join(here, 'runs', round);
  const snap = join(roundDir, '_skills', 'deep-search');
  cpSync(skillSrc, snap, { recursive: true });
  const boxRoot = join(tmpdir(), 'deep-search-edge', round);
  rmSync(boxRoot, { recursive: true, force: true });
  const edge = EDGE.filter((e) => !only || only.includes(e.id));
  const jobs = edge.flatMap((e) => Array.from({ length: n }, (_, k) => ({ e, i: k + 1 })));
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const tag = `${job.e.id}/run-${String(job.i).padStart(2, '0')}`;
      const sb = join(boxRoot, tag); const out = join(roundDir, tag); mkdirSync(out, { recursive: true });
      const ws = seed(sb); const cwd = join(ws, 'AI-SDD');
      for (const where of ['.claude/skills/deep-search', '.gigacode/skills/deep-search']) cpSync(snap, join(cwd, ...where.split('/')), { recursive: true });
      if (job.e.manifestAdd) appendFileSync(join(cwd, 'services', 'manifest.yaml'), job.e.manifestAdd);
      const ctx = { brief: join(cwd, '.claude/skills/deep-search/reference/brief.md').replace(/\\/g, '/'), skill: join(cwd, '.claude/skills/deep-search/SKILL.md').replace(/\\/g, '/'), root: cwd.replace(/\\/g, '/'), ws };
      await runClaude(cwd, job.e.prompt(ctx), model, out);
      Object.assign(job, { out });
      console.log(`прогон ${tag} готов`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeReport(roundDir, `раунд ${round} · модель ${model} · прогонов ${n}`, edge, jobs);
}

function writeReport(roundDir, head, edge, jobs) {
  const report = [head, ''];
  let cost = 0;
  for (const e of edge) {
    report.push(`## ${e.id}`);
    for (const job of jobs.filter((j) => j.e === e)) {
      const s = readStream(join(job.out, 'stream.jsonl'));
      const { r } = s;
      const a = String(r.result ?? '');
      cost += Number(r.total_cost_usd ?? 0);
      const bad = Object.entries(e.checks).filter(([, f]) => !f(a, s)).map(([k]) => k);
      report.push(`run-${String(job.i).padStart(2, '0')}: ${bad.length ? '✗ ' + bad.join(', ') : '✓ всё'} · $${Number(r.total_cost_usd ?? 0).toFixed(3)}`);
      for (const l of a.split('\n')) report.push('    ' + l);
      writeFileSync(join(job.out, 'answer.md'), a);
    }
    report.push('');
  }
  report.push(`итого: $${cost.toFixed(2)}`);
  writeFileSync(join(roundDir, 'GRADE-REPORT.txt'), report.join('\n') + '\n');
  console.log(report.filter((l) => /^(##|run-|итого)/.test(l)).join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
