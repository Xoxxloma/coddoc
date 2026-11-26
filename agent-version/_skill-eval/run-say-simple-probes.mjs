// Пробы say-simple: прошлый ход сессии — реальный ответ агента, потом «/say-simple» тем же разговором.
//
//   node agent-version/_skill-eval/run-say-simple-probes.mjs <раунд> [прогонов на пробу] [модель] [пробы через запятую]
//   node agent-version/_skill-eval/run-say-simple-probes.mjs --selftest   // оценщик на заведомо известных текстах
//
// Пробы — реальные ответы из сессий, поэтому лежат вне git: product/say-simple/fixtures/<проба>/
//   session.json — { user, assistant }: вопрос пользователя и ответ агента дословно;
//   context/     — предметное описание задачи (не у всех проб);
//   expect.json  — anchors (что должно остаться слово в слово), ctx (термин и чем его объясняет context/),
//                  unknown (термин, которого нет нигде, и догадка по имени), question, points (пункты оригинала).
// Раунд пишется туда же: product/say-simple/runs/<раунд>/. Снимок скилла — один на раунд, `_skills/say-simple/`.
// Прошлый ход подкладывается файлом сессии в ~/.claude/projects/<папка песочницы>/<id>.jsonl, ход 2 — `--resume`.
// Оценка — после ВСЕХ прогонов; цена — из total_cost_usd.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { modelId } from './model-id.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const skillSrc = resolve(here, '..', 'say-simple');
const fxRoot = join(repo, 'product', 'say-simple', 'fixtures');
const runsRoot = join(repo, 'product', 'say-simple', 'runs');

// ---------------------------------------------------------------- метрики текста

const SLOP = [
  'важно отметить', 'стоит (?:подчеркнуть|отметить)', 'играет (?:ключевую|важную) роль', 'критически важн', 'ключев\\p{L}*',
  'данн(?:ый|ая|ое|ого|ой|ом)','явля(?:ется|ются)', 'осуществля\\p{L}*', 'в рамках', 'обеспечива\\p{L}*',
  'комплексн\\p{L}*', 'реализ\\p{L}* функционал', 'не просто', 'не только', 'в связи с тем', 'на данный момент', 'в целях',
  'имеет возможность', 'в случае(?:,)? если', 'давайте', 'разбер[её]м', 'по сути', 'на самом деле', 'надеюсь',
  'хотите, я', 'если будут вопросы', 'в целом',
];
const slopRe = new RegExp(`(?<![\\p{L}])(?:${SLOP.join('|')})(?![\\p{L}])`, 'giu');

const noCode = (t) => t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, 'X');
function sentences(t) {
  return noCode(t).split(/\n+/).map((l) => l.replace(/^\s*(?:[-*]|\d+\.|#+|\|)\s*/, ''))
    .flatMap((l) => l.split(/(?<=[.!?…])\s+/)).map((s) => s.trim()).filter((s) => /\p{L}/u.test(s));
}
const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function metrics(t) {
  const ss = sentences(t);
  const lens = ss.map(words);
  const long = lens.filter((n) => n > 25).length;
  return {
    chars: t.length,
    sent: ss.length,
    avg: lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0,
    max: lens.length ? Math.max(...lens) : 0,
    long,
    slop: (t.match(slopRe) ?? []).length,
    slopWords: [...new Set((t.match(slopRe) ?? []).map((w) => w.toLowerCase()))],
    bold: (t.match(/\*\*[^*\n]+\*\*/g) ?? []).length,
    latin: (noCode(t).match(/(?<![\p{L}])[A-Za-z][A-Za-z-]{2,}(?![\p{L}])/gu) ?? []).length,
  };
}

// ---------------------------------------------------------------- оценщик

// Тело пересказа — до списка терминов: якоря и вопрос меряются в нём, а не в словаре в конце.
const bodyOf = (t) => t.split(/\n[#*\s]*Термины/u)[0];
// Якорь — текст как есть; [ ] не экранируются нарочно: класс символов в якоре («30[–—-]40»).
const anchorRe = (a) => new RegExp(a.replace(/[.*+?^${}()|\\/]/g, (c) => '\\' + c), 'u');

function grade(exp, answer, uses) {
  const marks = {};
  const body = bodyOf(answer);
  const lost = exp.anchors.filter((a) => !anchorRe(a).test(body));
  marks['якоря в тексте'] = lost.length === 0;
  // Значение из context/ — в одной строке с термином; источник скилл не пишет, открытие context/ — строкой в отчёте.
  for (const c of exp.ctx ?? []) {
    marks[`«${c.term}» пояснено`] = answer.split('\n').some((l) => l.includes(c.term) && new RegExp(c.means, 'iu').test(l));
  }
  // Значение из самого разговора законно, «не нашёл» не требуется: меряется только догадка по имени.
  const guessed = (exp.unknowns ?? []).filter((u) => new RegExp(u.guess, 'iu').test(answer)).map((u) => u.term);
  marks['без догадок по имени'] = guessed.length === 0;
  const prose = noCode(body);
  if (exp.question) marks['вопрос в конце'] = /\?|спрашива/iu.test(prose.slice(Math.floor(prose.length * 0.5)));
  else marks['своих вопросов нет'] = !/\?/.test(prose);
  const bad = uses.filter((u) => !['Skill', 'Read', 'Grep', 'Glob'].includes(u.name));
  const outside = uses.filter((u) => ['Read', 'Grep', 'Glob'].includes(u.name))
    // Песочница сама лежит в папке «say-simple-probes»: разрешены только context/ и папка скилла, у Glob — и по шаблону.
    .filter((u) => {
      const p = [u.input?.file_path, u.input?.path, u.input?.pattern].filter(Boolean).join(' ').replace(/\\/g, '/');
      return !/(?:^|[\/ ])context(?:\/|$| )|\.claude\/skills\/say-simple(?:\/|$| )/.test(p);
    });
  marks['инструменты — только чтение'] = bad.length === 0;
  marks['не читал лишнего'] = outside.length === 0;
  marks['ответ есть'] = answer.trim().length > 200;
  return { marks, lost, guessed, bad: bad.map((u) => `${u.name} ${JSON.stringify(u.input).slice(0, 120)}`), outside: outside.map((u) => `${u.name} ${JSON.stringify(u.input).slice(0, 120)}`) };
}

function selftest() {
  let fails = 0;
  for (const id of readdirSync(fxRoot)) {
    const exp = JSON.parse(readFileSync(join(fxRoot, id, 'expect.json'), 'utf8'));
    const orig = JSON.parse(readFileSync(join(fxRoot, id, 'session.json'), 'utf8')).assistant;
    // Хороший: оригинал + строка термина из context/ после заголовка «Термины»; плохой: короткий, с догадками,
    // своим вопросом (или без вопроса оригинала), записью файла и чтением кода.
    const good = orig + '\n\n**Термины:**\n' + (exp.ctx ?? []).map((c) => `- ${c.term} — ${c.means.split('|')[0]}… — context/x.md`).join('\n');
    const g = grade(exp, good, [{ name: 'Read', input: { file_path: '/x/.claude/skills/say-simple/reference/plain-russian.md' } },
      { name: 'Glob', input: { pattern: '**/*', path: '/x/.claude/skills/say-simple' } }, { name: 'Grep', input: { path: 'context' } }]);
    for (const [k, v] of Object.entries(g.marks)) if (!v) { fails++; console.log(`  ✗ ${id}: хороший провалил «${k}» ${g.lost.join(', ')}`); }
    const bad = 'Коротко: всё сделано.' + (exp.question ? '' : ' Удалить за вас?') + ' ' + (exp.unknowns ?? []).map((u) => u.guess.split('|')[0]).join(', ');
    const b = grade(exp, bad, [{ name: 'Write', input: { file_path: 'x.md' } }, { name: 'Read', input: { file_path: 'src/app.ts' } }]);
    for (const [k, v] of Object.entries(b.marks)) if (v) { fails++; console.log(`  ✗ ${id}: плохой прошёл «${k}»`); }
  }
  console.log(fails ? `оценщик: провалов ${fails}` : 'оценщик: хороший текст — всё ✓, плохой — пойман по каждой метке');
  return fails;
}

// ---------------------------------------------------------------- прогоны

function craftSession(cwd, fx) {
  const sid = randomUUID(), u = randomUUID(), a = randomUUID();
  const base = { isSidechain: false, userType: 'external', entrypoint: 'cli', cwd, sessionId: sid, version: '2.1.327', gitBranch: '' };
  const lines = [
    { ...base, parentUuid: null, type: 'user', message: { role: 'user', content: fx.user }, uuid: u, timestamp: '2026-11-18T10:00:00.000Z' },
    { ...base, parentUuid: u, type: 'assistant', uuid: a, timestamp: '2026-11-18T10:03:00.000Z',
      message: { id: 'msg_' + a.replace(/-/g, ''), type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text: fx.assistant }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 500 } } },
  ];
  const dir = join(homedir(), '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, sid + '.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return sid;
}

function runClaude(cwd, prompt, sid, model, out) {
  return new Promise((done) => {
    const p = spawn('bash', ['-c', 'claude -p "$PROBE_PROMPT" --resume "$PROBE_SID" --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose'],
      { cwd, env: { ...process.env, PROBE_PROMPT: prompt, PROBE_SID: sid, PROBE_MODEL: model, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill(), 600_000);
    p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(out, 'stream.jsonl'), stdout); writeFileSync(join(out, '_stderr.log'), stderr); done(code); });
  });
}

const f1 = (x) => (Math.round(x * 10) / 10).toString();

async function main() {
  if (process.argv[2] === '--selftest') process.exit(selftest() ? 1 : 0);
  // --regrade <раунд> — перегрейд готовых потоков без модели (после правки оценщика).
  if (process.argv[2] === '--regrade') {
    const roundDir = join(runsRoot, process.argv[3]);
    const probes = readdirSync(fxRoot).filter((p) => existsSync(join(roundDir, p)));
    const jobs = probes.flatMap((probe) => readdirSync(join(roundDir, probe)).filter((r) => /^run-\d+$/.test(r))
      .map((r) => ({ probe, i: Number(r.slice(4)), out: join(roundDir, probe, r), ms: 0 })));
    if (selftest()) throw new Error('оценщик не прошёл самопроверку');
    return writeReport(process.argv[3], roundDir, '(перегрейд)', 0, probes, jobs);
  }
  const round = process.argv[2];
  const n = Number(process.argv[3] ?? 1);
  const model = modelId(process.argv[4] ?? 'claude-sonnet-5');
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  if (!round) throw new Error('нужно имя раунда');
  if (selftest()) throw new Error('оценщик не прошёл самопроверку — прогоны не запускаю');

  const roundDir = join(runsRoot, round);
  const snap = join(roundDir, '_skills', 'say-simple');
  if (!existsSync(snap)) cpSync(skillSrc, snap, { recursive: true });
  const boxRoot = join(tmpdir(), 'say-simple-probes', round);
  rmSync(boxRoot, { recursive: true, force: true });

  const probes = readdirSync(fxRoot).filter((p) => !only || only.includes(p));
  const jobs = [];
  for (const probe of probes) for (let i = 1; i <= n; i++) jobs.push({ probe, i });
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const tag = `${job.probe}/run-${String(job.i).padStart(2, '0')}`;
      const out = join(roundDir, tag);
      mkdirSync(out, { recursive: true });
      const box = join(boxRoot, job.probe, `run-${String(job.i).padStart(2, '0')}`);
      mkdirSync(box, { recursive: true });
      cpSync(snap, join(box, '.claude', 'skills', 'say-simple'), { recursive: true });
      const ctx = join(fxRoot, job.probe, 'context');
      if (existsSync(ctx)) cpSync(ctx, join(box, 'context'), { recursive: true });
      const fx = JSON.parse(readFileSync(join(fxRoot, job.probe, 'session.json'), 'utf8'));
      const sid = craftSession(box, fx);
      const t0 = Date.now();
      job.code = await runClaude(box, '/say-simple', sid, model, out);
      job.out = out; job.ms = Date.now() - t0;
      console.log(`прогон ${tag}: код ${job.code}, ${Math.round(job.ms / 1000)} с`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeReport(round, roundDir, model, n, probes, jobs);
}

function writeReport(round, roundDir, model, n, probes, jobs) {
  const report = [`раунд ${round} · модель ${model} · прогонов на пробу ${n} · ${new Date().toISOString()}`, ''];
  const table = ['| Проба | Прогон | Знаков | Предложений | Средн. слов | Макс. слов | > 25 слов | Слова-маркеры | Жирный | Якоря | $ |',
    '|---|---|---|---|---|---|---|---|---|---|---|'];
  let cost = 0;
  for (const probe of probes) {
    const exp = JSON.parse(readFileSync(join(fxRoot, probe, 'expect.json'), 'utf8'));
    const orig = JSON.parse(readFileSync(join(fxRoot, probe, 'session.json'), 'utf8')).assistant;
    const b = metrics(orig);
    table.push(`| ${probe} | до | ${b.chars} | ${b.sent} | ${f1(b.avg)} | ${b.max} | ${b.long} | ${b.slop} | ${b.bold} | — | — |`);
    report.push(`## ${probe}`);
    report.push(`до: маркеры ${b.slopWords.join(', ') || '—'}`);
    for (const job of jobs.filter((j) => j.probe === probe)) {
      const ev = readFileSync(join(job.out, 'stream.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const result = ev.find((e) => e.type === 'result') ?? {};
      const uses = ev.filter((e) => e.type === 'assistant' && !e.parent_tool_use_id).flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use'));
      const answer = String(result.result ?? '');
      writeFileSync(join(job.out, 'answer.md'), answer);
      const g = grade(exp, answer, uses, {});
      const m = metrics(answer);
      const c = Number(result.total_cost_usd ?? 0);
      cost += c;
      const kept = exp.anchors.length - g.lost.length;
      table.push(`| ${probe} | после ${job.i} | ${m.chars} | ${m.sent} | ${f1(m.avg)} | ${m.max} | ${m.long} | ${m.slop} | ${m.bold} | ${kept}/${exp.anchors.length} | ${c.toFixed(3)} |`);
      const fails = Object.entries(g.marks).filter(([, v]) => !v).map(([k]) => k);
      report.push(`run-${String(job.i).padStart(2, '0')}: ${fails.length ? '✗ ' + fails.join(', ') : '✓ всё'} · $${c.toFixed(3)} · ходов ${result.num_turns ?? '?'} · ${Math.round(job.ms / 1000)} с`);
      report.push(`  инструменты: ${uses.map((u) => u.name + ' ' + String(u.input?.file_path ?? u.input?.path ?? u.input?.pattern ?? u.input?.skill ?? '').slice(-60)).join(' ⏎ ') || '—'}`);
      if (exp.ctx?.length) report.push(`  context/: ${uses.some((u) => /(?:^|[\/ ])context(?:\/|$| )/.test([u.input?.file_path, u.input?.path, u.input?.pattern].filter(Boolean).join(' ').replace(/\\/g, '/'))) ? 'открыт' : 'не открыт'}`);
      if (g.lost.length) report.push(`  потеряны якоря: ${g.lost.join(', ')}`);
      if (g.guessed.length) report.push(`  догадка по имени: ${g.guessed.join(', ')}`);
      if (g.bad.length) report.push(`  лишние инструменты: ${g.bad.join(' ⏎ ')}`);
      if (g.outside.length) report.push(`  читал вне context/: ${g.outside.join(' ⏎ ')}`);
      report.push(`  после: маркеры ${m.slopWords.join(', ') || '—'}`);
    }
    report.push('');
  }
  report.push(`итого: $${cost.toFixed(2)}`);
  writeFileSync(join(roundDir, 'GRADE-REPORT.txt'), report.join('\n') + '\n');
  writeFileSync(join(roundDir, 'TABLE.md'), table.join('\n') + '\n');
  console.log('\n' + report.join('\n') + '\n\n' + table.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
