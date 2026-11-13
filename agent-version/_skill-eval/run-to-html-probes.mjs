// Пробы вызова скилла to-html моделью: правильная команда своей ОС, верный путь, md не читается, ответ — по
// строке скрипта.
//
//   node agent-version/_skill-eval/run-to-html-probes.mjs <раунд> [прогонов на пробу] [модель]
//   node agent-version/_skill-eval/run-to-html-probes.mjs --selftest      // оценщик на заведомо известных потоках
//
// Снимок скилла — один раз на раунд, в `runs/<раунд>/_skills/to-html/`: все прогоны раунда читают один текст.
// Песочницы — вне репозитория (временная папка ОС), чтобы прогон не подхватил CLAUDE.md и файлы репо.
// В песочнице скилл лежит и в `.claude/skills/` (там его находит Claude Code), и в `.gigacode/skills/` — пути
// команд в SKILL.md такие, как на проде. Браузер не открывается: TO_HTML_NO_OPEN=1, вывод скрипта прежний.
// Оценка — только после того, как закончились ВСЕ прогоны; в отчёт — по пробе и стоимость из total_cost_usd.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { png } from './to-html-fixtures.mjs';
import { modelId } from './model-id.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const skillSrc = resolve(here, '..', 'to-html');
const win = process.platform === 'win32';

// ---------------------------------------------------------------- пробы

// Запросы и имена в песочнице НЕ совпадают с примерами SKILL.md («заметки про поездку», «README сервиса», `coddoc`):
// иначе проба мерит, узнаёт ли модель пример, а не правило (пилот 2026-10-20 списал запросы с примеров).
const PROBES = [
  { id: 'p-dir', prompt: '/to-html handbook', paths: [['handbook']] },
  { id: 'p-file', prompt: '/to-html notes/дача/Дневник.md', paths: [['notes/дача/Дневник.md']] },
  { id: 'p-words-notes', prompt: 'Хочу посмотреть в браузере свои записи про дачу.',
    paths: [['notes/дача'], ['notes/дача/Дневник.md']] },
  { id: 'p-words-readme', prompt: 'Выведи в браузер описание сервиса billing, текстом читать тяжело.',
    paths: [['services/billing/README.md'], ['services/billing']] },
  { id: 'p-empty', prompt: '/to-html', paths: [[]] },
];

// Песочница — «репозиторий» с документацией, заметками и сервисами; содержимое нейтральное.
function seed(dir) {
  const put = (rel, body) => { const p = join(dir, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };
  put('handbook/README.md', '# Справочник команды\n\nКак устроен сервис — [архитектура](architecture.md).\n');
  put('handbook/architecture.md', '# Как устроен сервис\n\n```mermaid\nsequenceDiagram\n  web->>api: POST /orders\n```\n');
  put('handbook/img/стенд.png', png(80, 40, 1));
  put('notes/дача/Дневник.md', '# Дневник\n\n## 12 мая\n\n- Посадки — в [[Посадки]].\n\n![[теплица.png]]\n');
  put('notes/дача/Посадки.md', '# Посадки\n\nТоматы — вторая грядка.\n');
  put('notes/дача/вложения/теплица.png', png(60, 40, 2));
  put('notes/работа/Встречи.md', '# Встречи\n\nСозвон по вторникам.\n');
  put('services/billing/README.md', '# billing\n\nСервис оплаты: счета, возвраты.\n');
  put('services/billing/src/main.go', 'package main\n');
  put('services/catalog/README.md', '# catalog\n\nКаталог товаров.\n');
}

// ---------------------------------------------------------------- оценщик

/** Аргументы после пути скрипта: кавычки снимаются, флаги отбрасываются. */
function argsOf(cmd) {
  const m = cmd.match(/pack\.(?:sh|ps1)["']?(.*)$/s);
  if (!m) return null;
  const out = [];
  for (const t of m[1].matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const v = t[1] ?? t[2] ?? t[3];
    if (/^(--no-open|-NoOpen|\||>|2>.*|&&|;)$/.test(v)) { if (/^[|>;&]/.test(v)) break; continue; }
    out.push(v.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, ''));
  }
  return out;
}

function grade(probe, lines, sandboxHasPage) {
  const ev = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const main = ev.filter((e) => !e.parent_tool_use_id);
  const uses = main.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use'));
  const result = ev.find((e) => e.type === 'result') ?? {};
  const cmds = uses.filter((u) => ['Bash', 'PowerShell'].includes(u.name)).map((u) => String(u.input?.command ?? ''));
  const packs = cmds.filter((c) => /pack\.(sh|ps1)/.test(c));
  const reads = uses.filter((u) => u.name === 'Read').map((u) => String(u.input?.file_path ?? '').replace(/\\/g, '/'));
  const mdReads = reads.filter((p) => /\.(md|markdown)$/i.test(p) && !/\/SKILL\.md$/i.test(p));
  const catMd = cmds.filter((c) => /\b(cat|type|Get-Content|head|less|more)\b[^|]*\.md\b/i.test(c) && !/pack\./.test(c));
  const answer = String(result.result ?? '');
  const args = packs.length ? argsOf(packs[0]) : null;
  const want = probe.paths.map((p) => JSON.stringify(p));
  const marks = {
    'запущен pack': packs.length >= 1,
    'один запуск': packs.length === 1,
    'команда своей ОС': packs.length > 0 && (win ? /pack\.ps1/.test(packs[0]) && /powershell/i.test(packs[0]) : /bash\s+\S*pack\.sh/.test(packs[0])),
    'верный путь': args !== null && want.includes(JSON.stringify(args)),
    'md не читал': mdReads.length === 0 && catMd.length === 0,
    'страница собрана': sandboxHasPage,
    'ответ по строке скрипта': /открыл|откры/i.test(answer) && !/page=/i.test(answer),
  };
  return { marks, args, packs, mdReads: [...mdReads, ...catMd], answer, cost: Number(result.total_cost_usd ?? 0), turns: result.num_turns ?? null };
}

// Оценщик на известных потоках: хороший ход проходит всё, плохой — валится ровно там, где сломан.
function selftest() {
  const tool = (name, input) => JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name, input }] } });
  const res = (text) => JSON.stringify({ type: 'result', result: text, total_cost_usd: 0.01, num_turns: 3 });
  const probe = PROBES[1];
  const cmd = win ? 'powershell -NoProfile -ExecutionPolicy Bypass -File .gigacode/skills/to-html/reference/pack.ps1 "notes/дача/Дневник.md"'
    : 'bash .gigacode/skills/to-html/reference/pack.sh "notes/дача/Дневник.md"';
  const good = [tool('Skill', { skill: 'to-html' }), tool(win ? 'PowerShell' : 'Bash', { command: cmd }), res('Открыл в браузере: Дневник. После правок — снова /to-html, потом F5. Если вкладка не появилась — открой: file:///C:/x/.to-html/notes--%D0%B4/index.html')];
  const bad = [tool('Read', { file_path: 'C:/x/notes/дача/Дневник.md' }),
    tool('Bash', { command: 'bash .gigacode/skills/to-html/reference/pack.sh "notes"' }),
    tool('Bash', { command: 'bash .gigacode/skills/to-html/reference/pack.sh "notes"' }),
    res('Готово: file:///C:/x/.to-html/notes/index.html')];
  const g = grade(probe, good, true), b = grade(probe, bad, false);
  let fails = 0;
  for (const [k, v] of Object.entries(g.marks)) if (!v) { fails++; console.log('  ✗ хороший поток провалил: ' + k); }
  const expectBad = { 'один запуск': false, 'верный путь': false, 'md не читал': false, 'страница собрана': false, 'ответ по строке скрипта': false };
  if (win) expectBad['команда своей ОС'] = false;
  for (const [k, v] of Object.entries(expectBad)) if (b.marks[k] !== v) { fails++; console.log('  ✗ плохой поток не пойман: ' + k); }
  if (JSON.stringify(argsOf('powershell -File x/pack.ps1 "a b" -NoOpen | tail -1')) !== '["a b"]') { fails++; console.log('  ✗ разбор аргументов'); }
  console.log(fails ? `оценщик: провалов ${fails}` : 'оценщик: хороший поток — всё ✓, плохой — пойман по каждой поломке');
  return fails;
}

// ---------------------------------------------------------------- прогоны

function runClaude(cwd, prompt, model, out) {
  return new Promise((done) => {
    // MSYS_NO_PATHCONV: Git Bash переписывает аргумент, начатый с «/», в путь Windows — «/to-html x» доходил до
    // модели как «C:/Program Files/Git/to-html x» (пилот 2026-10-20: три пробы из пяти испорчены стендом).
    const p = spawn('bash', ['-c', 'claude -p "$PROBE_PROMPT" --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose'],
      { cwd, env: { ...process.env, PROBE_PROMPT: prompt, PROBE_MODEL: model, TO_HTML_NO_OPEN: '1', MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
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
  const round = process.argv[2];
  const n = Number(process.argv[3] ?? 1);
  const model = modelId(process.argv[4] ?? 'claude-sonnet-5');
  // Пятый аргумент — пробы через запятую (по умолчанию все).
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  if (!round) throw new Error('нужно имя раунда');
  if (selftest()) throw new Error('оценщик не прошёл самопроверку — прогоны не запускаю');

  const roundDir = join(here, 'runs', round);
  const snap = join(roundDir, '_skills', 'to-html');
  if (!existsSync(snap)) cpSync(skillSrc, snap, { recursive: true });
  const boxRoot = join(tmpdir(), 'to-html-probes', round);
  rmSync(boxRoot, { recursive: true, force: true });

  const probes = PROBES.filter((p) => !only || only.includes(p.id));
  const jobs = [];
  for (const probe of probes) for (let i = 1; i <= n; i++) jobs.push({ probe, i });
  // Все прогоны — до оценки; по три сразу.
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const tag = `${job.probe.id}/run-${String(job.i).padStart(2, '0')}`;
      const sb = join(boxRoot, tag);
      const out = join(roundDir, tag);
      mkdirSync(out, { recursive: true });
      seed(sb);
      for (const where of ['.claude/skills/to-html', '.gigacode/skills/to-html']) cpSync(snap, join(sb, ...where.split('/')), { recursive: true });
      const t0 = Date.now();
      const code = await runClaude(sb, job.probe.prompt, model, out);
      job.sb = sb; job.out = out; job.code = code; job.ms = Date.now() - t0;
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
      const pagesDir = join(job.sb, '.coddoc-tmp', 'to-html');
      const hasPage = existsSync(pagesDir) && readdirSync(pagesDir).some((d) => existsSync(join(pagesDir, d, 'index.html')));
      const g = grade(probe, lines, hasPage);
      cost += g.cost;
      const bad = Object.entries(g.marks).filter(([, v]) => !v).map(([k]) => k);
      report.push(`run-${String(job.i).padStart(2, '0')}: ${bad.length ? '✗ ' + bad.join(', ') : '✓ всё'} · $${g.cost.toFixed(3)} · ходов ${g.turns} · ${Math.round(job.ms / 1000)} с`);
      report.push(`  команда: ${g.packs.join(' ⏎ ') || '—'}`);
      report.push(`  путь: ${JSON.stringify(g.args)}` + (g.mdReads.length ? ` · читал md: ${g.mdReads.join(', ')}` : ''));
      report.push(`  ответ: ${g.answer.replace(/\s+/g, ' ').slice(0, 300)}`);
      writeFileSync(join(job.out, 'answer.md'), g.answer);
    }
    report.push('');
  }
  report.push(`итого: $${cost.toFixed(2)}`);
  writeFileSync(join(roundDir, 'GRADE-REPORT.txt'), report.join('\n') + '\n');
  console.log('\n' + report.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
