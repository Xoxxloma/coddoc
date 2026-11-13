// Пробы вызова скилла peek моделью: одна команда со скриптом, верный ключ или слова, без переключения ветки и
// поиска руками, ответ — по выводу скрипта.
//
//   node agent-version/_skill-eval/run-peek-probes.mjs <раунд> [прогонов на пробу] [модель] [пробы через запятую]
//   node agent-version/_skill-eval/run-peek-probes.mjs --selftest      // оценщик на заведомо известных потоках
//   node agent-version/_skill-eval/run-peek-probes.mjs --seed <папка>  // только песочница, без модели
//
// Снимок скилла — один раз на раунд, в `runs/<раунд>/_skills/peek/`: все прогоны раунда читают один текст.
// Песочница каждого прогона — вне репозитория скиллов (временная папка ОС): bare-origin, клон коллеги и клон
// человека `me/` (в нём идёт прогон). У me незакоммиченная правка; после прогона HEAD, ветки и статус — как до.
// Скилл лежит в `me/.claude/skills/` (там его находит Claude Code) и в `me/.gigacode/skills/` (пути команд в SKILL.md),
// обе папки — в `.git/info/exclude`. Оценка — после ВСЕХ прогонов; стоимость — из total_cost_usd.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { modelId } from './model-id.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillSrc = resolve(here, '..', 'peek');

// ---------------------------------------------------------------- пробы

// Ключи и слова песочницы НЕ совпадают с примером SKILL.md (`PAY-123`).
const PROBES = [
  { id: 'p-key', prompt: '/peek CRM-41', key: 'CRM-41', branch: 'feature/crm-41', author: 'Марина' },
  { id: 'p-words', prompt: '/peek начисление баллов', words: ['начисление', 'баллов'], found: 'CRM-58' },
  { id: 'p-natural', prompt: 'Марина писала БТ по задаче CRM-58 у себя в ветке. Покажи, что там у неё сейчас, свою ветку не трогай.',
    key: 'CRM-58', branch: 'feature/crm-58', author: 'Марина' },
];

const BR = (title, key, edition, status, body) => `# Бизнес-требования: ${title}\n\n> **Задача:** ${key}\n> **Редакция:** ${edition}\n>\n` +
  `> **Статус готовности:** ${status}\n\n## Описание\n\n${body}\n`;

function gitIn(cwd, env, ...args) {
  return execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
}

// Песочница: origin.git, marina/ (коллега), me/ (человек). Git сборки изолирован от настроек машины.
function seed(box) {
  mkdirSync(box, { recursive: true });
  const config = join(box, 'gitconfig');
  writeFileSync(config, '[user]\n\tname = Олег\n\temail = o@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const g = (cwd, ...args) => gitIn(cwd, env, ...args);
  const put = (repo, rel, body) => { const p = join(repo, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };
  const commit = (repo, who, date, msg) => {
    g(repo, 'add', '-A');
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: repo, stdio: 'ignore',
      env: { ...env, GIT_AUTHOR_NAME: who, GIT_COMMITTER_NAME: who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  };
  const origin = join(box, 'origin.git'), marina = join(box, 'marina'), me = join(box, 'me');
  g(box, 'init', '-q', '--bare', origin);
  g(box, 'clone', '-q', origin, marina);
  put(marina, 'README.md', '# Программа лояльности\n');
  put(marina, 'coddoc/CRM-41/business_requirements.md',
    BR('Списание баллов при возврате', 'CRM-41', '1', 'Требуются уточнения (3)', 'Списание баллов при возврате товара.'));
  put(marina, 'coddoc/CRM-58/business_requirements.md',
    BR('Партнёрские магазины', 'CRM-58', '1', 'Требуются уточнения (5)', 'Покупки в партнёрских магазинах.'));
  commit(marina, 'Олег', '2026-11-01T10:00:00+03:00', 'старт');
  g(marina, 'push', '-q', 'origin', 'main');
  g(marina, 'checkout', '-q', '-b', 'feature/crm-41');
  put(marina, 'coddoc/CRM-41/business_requirements.md',
    BR('Списание баллов при возврате', 'CRM-41', '2 (2026-11-06)', 'Готово к разработке', 'Списание баллов при возврате товара и при отмене заказа.'));
  put(marina, 'coddoc/CRM-41/technical_specification.md', '# Техническая спецификация: Списание баллов\n\nЧерновик.\n');
  commit(marina, 'Марина', '2026-11-06T12:00:00+03:00', 'CRM-41');
  g(marina, 'push', '-q', 'origin', 'feature/crm-41');
  g(marina, 'checkout', '-q', 'main');
  g(marina, 'checkout', '-q', '-b', 'feature/crm-58');
  put(marina, 'coddoc/CRM-58/business_requirements.md',
    BR('Партнёрские магазины', 'CRM-58', '2 (2026-11-08)', 'Требуются уточнения (1)',
      'Покупки в партнёрских магазинах.\n\nНачисление баллов за покупку в партнёрском магазине — через сутки.'));
  commit(marina, 'Марина', '2026-11-08T12:00:00+03:00', 'CRM-58');
  g(marina, 'push', '-q', 'origin', 'feature/crm-58');

  g(box, 'clone', '-q', origin, me);
  g(me, 'checkout', '-q', '-b', 'work');
  put(me, 'coddoc/CRM-77/business_requirements.md', BR('Своя задача', 'CRM-77', '1', 'Черновик', 'Своя задача.'));
  commit(me, 'Я', '2026-11-09T09:00:00+03:00', 'своя задача');
  put(me, 'README.md', '# Программа лояльности — правлю\n');  // незакоммиченная правка
  appendFileSync(join(me, '.git', 'info', 'exclude'), '.claude/\n.gigacode/\n.coddoc-tmp/\n');
  return me;
}

// Состояние, которое прогон не должен менять.
function state(me) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  return ['rev-parse HEAD', 'symbolic-ref HEAD', 'status --porcelain=v1 -uall', 'diff', 'for-each-ref refs/heads']
    .map((c) => gitIn(me, env, ...c.split(' '))).join('\n---\n');
}

// ---------------------------------------------------------------- оценщик

/** Аргументы после пути скрипта: кавычки снимаются; стоп на |, >, ;, &&. */
function argsOf(cmd) {
  const m = cmd.match(/peek\.py["']?(.*)$/s);
  if (!m) return null;
  const out = [];
  for (const t of m[1].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const v = t[1] ?? t[2] ?? t[3];
    if (/^(\||>|2>.*|&&|;|2>&1)$/.test(v) || /^[|>;&]/.test(v)) break;
    out.push(v);
  }
  return out.join(' ').split(/\s+/).filter(Boolean);
}

function grade(probe, lines, sandbox) {
  const ev = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const main = ev.filter((e) => !e.parent_tool_use_id);
  const uses = main.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use'));
  const result = ev.find((e) => e.type === 'result') ?? {};
  const cmds = uses.filter((u) => ['Bash', 'PowerShell'].includes(u.name)).map((u) => String(u.input?.command ?? ''));
  const peeks = cmds.filter((c) => /peek\.py/.test(c));
  const last = peeks.length ? argsOf(peeks[peeks.length - 1]) : null;
  const switching = cmds.filter((c) => /\bgit\b[^|;&]*\b(checkout|switch|stash|pull|worktree|reset|merge|rebase|restore)\b/.test(c));
  const manual = [
    ...cmds.filter((c) => !/peek\.py/.test(c) && /\bgit\b[^|;&]*\b(show|log|ls-tree|grep|branch|cat-file|diff)\b/.test(c)),
    ...uses.filter((u) => ['Grep', 'Glob'].includes(u.name)).map((u) => `${u.name} ${JSON.stringify(u.input)}`),
  ];
  const answer = String(result.result ?? '');
  const marks = {
    'запущен peek': peeks.length >= 1,
    'верный вход': last !== null && (probe.key ? JSON.stringify(last) === JSON.stringify([probe.key])
      : JSON.stringify(last.map((w) => w.toLowerCase())) === JSON.stringify(probe.words)),
    'ветку не трогал': switching.length === 0,
    'сам не искал': manual.length === 0,
  };
  if (probe.key) {
    marks['выгрузка есть'] = sandbox.exported;
    marks['ответ: ветка и автор'] = answer.includes(probe.branch) && answer.includes(probe.author);
    marks['ответ: /to-html'] = /\/to-html/.test(answer);
  } else {
    marks['ответ: найденная строка'] = answer.includes(probe.found);
    marks['ответ: /peek <ключ>'] = new RegExp(`/peek\\s+${probe.found}`).test(answer);
  }
  marks['рабочая копия цела'] = sandbox.intact;
  return { marks, args: last, peeks, switching, manual, answer, cost: Number(result.total_cost_usd ?? 0), turns: result.num_turns ?? null };
}

function selftest() {
  const tool = (name, input) => JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name, input }] } });
  const res = (text) => JSON.stringify({ type: 'result', result: text, total_cost_usd: 0.01, num_turns: 3 });
  const probe = PROBES[0];
  const good = [tool('Skill', { skill: 'peek' }), tool('Bash', { command: 'python .gigacode/skills/peek/reference/peek.py "CRM-41" 2>&1' }),
    res('CRM-41 — ветка origin/feature/crm-41 · Марина · 2026-11-06. Открыть в браузере: /to-html C:/x/.coddoc-tmp/peek/CRM-41')];
  const bad = [tool('Bash', { command: 'git checkout feature/crm-41' }), tool('Bash', { command: 'git log --all -- coddoc/CRM-41' }),
    tool('Bash', { command: 'python3 .gigacode/skills/peek/reference/peek.py CRM-4' }), res('Готово.')];
  const g = grade(probe, good, { exported: true, intact: true });
  const b = grade(probe, bad, { exported: false, intact: false });
  let fails = 0;
  for (const [k, v] of Object.entries(g.marks)) if (!v) { fails++; console.log('  ✗ хороший поток провалил: ' + k); }
  for (const [k, v] of Object.entries(b.marks)) if (v && k !== 'запущен peek') { fails++; console.log('  ✗ плохой поток не пойман: ' + k); }
  const w = grade(PROBES[1], [tool('Bash', { command: "python3 x/peek.py 'Начисление баллов' | tail -5" }),
    res('CRM-58 · origin/feature/crm-58 · … Документы задачи: /peek CRM-58')], { exported: false, intact: true });
  for (const [k, v] of Object.entries(w.marks)) if (!v) { fails++; console.log('  ✗ слова: хороший поток провалил: ' + k); }
  console.log(fails ? `оценщик: провалов ${fails}` : 'оценщик: хороший поток — всё ✓, плохой — пойман по каждой поломке');
  return fails;
}

// ---------------------------------------------------------------- прогоны

function runClaude(cwd, prompt, model, out) {
  return new Promise((done) => {
    // MSYS_NO_PATHCONV: Git Bash переписывает аргумент, начатый с «/», в путь Windows.
    const p = spawn('bash', ['-c', 'claude -p "$PROBE_PROMPT" --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose'],
      { cwd, env: { ...process.env, PROBE_PROMPT: prompt, PROBE_MODEL: model, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill(), 600_000);
    p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(out, 'stream.jsonl'), stdout); writeFileSync(join(out, '_stderr.log'), stderr); done(code); });
  });
}

async function main() {
  if (process.argv[2] === '--selftest') process.exit(selftest() ? 1 : 0);
  // --seed <папка> — только собрать песочницу (проверить фикстуру скриптом без модели).
  if (process.argv[2] === '--seed') { console.log(seed(resolve(process.argv[3]))); return; }
  const round = process.argv[2];
  const n = Number(process.argv[3] ?? 1);
  const model = modelId(process.argv[4] ?? 'claude-sonnet-5');
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  if (!round) throw new Error('нужно имя раунда');
  if (selftest()) throw new Error('оценщик не прошёл самопроверку — прогоны не запускаю');

  const roundDir = join(here, 'runs', round);
  const snap = join(roundDir, '_skills', 'peek');
  if (!existsSync(snap)) cpSync(skillSrc, snap, { recursive: true });
  const boxRoot = join(tmpdir(), 'peek-probes', round);
  rmSync(boxRoot, { recursive: true, force: true });

  const probes = PROBES.filter((p) => !only || only.includes(p.id));
  const jobs = [];
  for (const probe of probes) for (let i = 1; i <= n; i++) jobs.push({ probe, i });
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const tag = `${job.probe.id}/run-${String(job.i).padStart(2, '0')}`;
      const out = join(roundDir, tag);
      mkdirSync(out, { recursive: true });
      const me = seed(join(boxRoot, tag));
      for (const where of ['.claude/skills/peek', '.gigacode/skills/peek']) cpSync(snap, join(me, ...where.split('/')), { recursive: true });
      const before = state(me);
      const t0 = Date.now();
      const code = await runClaude(me, job.probe.prompt, model, out);
      const key = job.probe.key;
      const dest = key ? join(me, '.coddoc-tmp', 'peek', key) : null;
      job.sandbox = { exported: !!dest && existsSync(dest) && readdirSync(dest).length > 0, intact: state(me) === before };
      job.out = out; job.code = code; job.ms = Date.now() - t0;
      console.log(`прогон ${tag}: код ${code}, ${Math.round(job.ms / 1000)} с`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const report = [`раунд ${round} · модель ${model} · прогонов на пробу ${n} · ${new Date().toISOString()}`, ''];
  let cost = 0;
  for (const probe of probes) {
    report.push(`## ${probe.id} — «${probe.prompt}»`);
    for (const job of jobs.filter((j) => j.probe === probe)) {
      const lines = readFileSync(join(job.out, 'stream.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
      const g = grade(probe, lines, job.sandbox);
      cost += g.cost;
      const bad = Object.entries(g.marks).filter(([, v]) => !v).map(([k]) => k);
      report.push(`run-${String(job.i).padStart(2, '0')}: ${bad.length ? '✗ ' + bad.join(', ') : '✓ всё'} · $${g.cost.toFixed(3)} · ходов ${g.turns} · ${Math.round(job.ms / 1000)} с`);
      report.push(`  команда: ${g.peeks.join(' ⏎ ') || '—'}`);
      if (g.switching.length) report.push(`  трогал ветку: ${g.switching.join(' ⏎ ')}`);
      if (g.manual.length) report.push(`  искал сам: ${g.manual.join(' ⏎ ')}`);
      report.push(`  ответ: ${g.answer.replace(/\s+/g, ' ').slice(0, 400)}`);
      writeFileSync(join(job.out, 'answer.md'), g.answer);
    }
    report.push('');
  }
  report.push(`итого: $${cost.toFixed(2)}`);
  writeFileSync(join(roundDir, 'GRADE-REPORT.txt'), report.join('\n') + '\n');
  console.log('\n' + report.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
