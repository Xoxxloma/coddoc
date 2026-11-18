// Пробы скилла work-plan: первый запуск, две инициативы — по плану на каждую или в один, повторный запуск, «следим»
// (два запуска подряд), «добавь» (с запросом на правку), выбор из двух планов. Задачи в песочнице вливают в dev, а
// origin/HEAD — на main: новый план начинается с вопроса о главной ветке. Скилл задаёт вопросы — прогон идёт в несколько ходов
// (`--resume`): ход 1 — команда, ход 2 — ответ аналитика, последний — «да», только если файлы плана ещё не готовы
// (лишний вопрос — метка). Ход с `fresh` — новый запуск скилла в новой сессии.
//
//   node agent-version/_skill-eval/run-work-plan-probes.mjs <раунд> [прогонов на пробу] [модель] [пробы через запятую]
//   node agent-version/_skill-eval/run-work-plan-probes.mjs --selftest            // оценщик на заведомо известных данных
//   node agent-version/_skill-eval/run-work-plan-probes.mjs --seed <папка> [rerun|add|pick] // только песочница + peek --list, без модели
//
// Снимок обоих скиллов (work-plan и peek) — один раз на раунд, в `runs/<раунд>/_skills/`. Песочница каждого прогона —
// вне репозитория скиллов (временная папка ОС): bare-origin, клон коллеги и клон человека `me/` (в нём идёт прогон);
// скиллы — в `me/.claude/skills/`, `.claude/` и `.coddoc-tmp/` — в `.git/info/exclude`. Оценка — по файлам плана после
// каждого хода и по потоку, после ВСЕХ прогонов; цена прогона — максимум total_cost_usd по его потокам.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { modelId } from './model-id.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SKILLS = ['work-plan', 'peek'];
const TODAY = new Date().toLocaleDateString('sv-SE');

// ---------------------------------------------------------------- песочница

const BT7 = 'coddoc/INV-7/business_requirements.md';
const SPEC7 = 'coddoc/INV-7/technical_specification.md';
const BT9 = 'coddoc/INV-9/business_requirements.md';
const CR8 = 'coddoc/INV-8/change_request.md';
const NB = 'notes/списание-запчастей/notebook.md';
const PLAN7 = 'INV-7.md';
const PLAN9 = 'INV-9.md';
const PLAN_ALL = 'Склад.md';
// Ядра вопросов — проверка «словами документа».
const Q = {
  bt7a: 'Кто утверждает списание запчасти дороже 50 000 ₽',
  bt7b: 'Срок хранения списанных запчастей на складе',
  spec7: 'какой сервис хранит фото списанной запчасти',
  bt9: 'Нужна ли выгрузка остатков в 1С',
  nb1: 'Списывать ли запчасть, если гарантия ещё действует',
  nb2: 'Нужна ли подпись кладовщика на акте',
  nbClosed: 'Как считать износ',
  nbNew: 'Кто забирает списанные запчасти',
  nbNext: 'Куда везти списанные запчасти',
  bt9b: 'Как часто выгружать остатки',
  cr1: 'С какой даты действует новый лимит',
  cr2: 'Распространяется ли лимит на расходники',
};
const GOAL_RERUN = 'БТ влит, спека согласована с Голубевым';

const doc = (kind, key, status, block, items) => {
  const title = kind === 'bt' ? 'Бизнес-требования' : 'Техническая спецификация';
  const head = `# ${title}: ${key}\n\n> **Задача:** ${key}\n> **Редакция:** 1\n>\n> **Статус готовности:** ${status}\n>\n`;
  const list = items.length ? `> **${block}:**\n` + items.map((q, i) => `> ${i + 1}. ${q}\n`).join('')
    : '> *Все ключевые данные подтверждены.*\n';
  return head + list + '\n## 1. Описание\n\nСписание запчастей со склада.\n';
};
const BT = (key, items) => doc('bt', key, items.length ? `Требуются уточнения (${items.length})` : 'Готово к оценке',
  'Открытые вопросы (требуют уточнения перед оценкой)', items);
const SPEC = (key, items) => doc('spec', key, `Требуются уточнения (${items.length})`,
  'Открытые вопросы (решить до / во время разработки)', items);

const NB_HEAD = '---\nтема: списание запчастей\nключ: INV-7\nо чём: списание запчастей со склада\nроли: —\n---\n# Ноут: списание запчастей\n\n';
const NB_DAY1 = '## 2026-11-10\n\n### 1 · созвон с Голубевым А. (главный механик) со слов аналитика\n' +
  `- [открыто] ${Q.nb1} — ждёт: Голубев А. · 2026-11-10 №1.1\n` +
  `- [открыто] ${Q.nb2} — ждёт: — · 2026-11-10 №1.2\n` +
  `- [открыто] ${Q.nbClosed} — ждёт: Голубев А. · 2026-11-10 №1.3 ‖ закрыт: 2026-11-12 №1.1\n\n` +
  '## 2026-11-12\n\n### 1 · письмо Голубева А.\n' +
  '- [решено] Износ считается по пробегу — решил: Голубев А.; отвечает на: 2026-11-10 №1.3 · 2026-11-12 №1.1\n' +
  '> Износ считаем по пробегу.\n';
const NB_BASE = NB_HEAD + NB_DAY1;
const NB_RERUN = NB_HEAD + NB_DAY1.replace(`${Q.nb2} — ждёт: — · 2026-11-10 №1.2\n`, `${Q.nb2} — ждёт: — · 2026-11-10 №1.2 ‖ закрыт: 2026-11-17 №1.1\n`) +
  '\n## 2026-11-17\n\n### 1 · чат с Голубевым А.\n' +
  '- [решено] Подпись кладовщика на акте не нужна — решил: Голубев А.; отвечает на: 2026-11-10 №1.2 · 2026-11-17 №1.1\n' +
  `- [открыто] ${Q.nbNew} — ждёт: Сидоров П. · 2026-11-17 №1.2\n` +
  '> Голубев А.: подпись не нужна. Кто забирает списанное — это к Сидорову.\n';
const BASE = 'origin/dev';  // задачи вливают в dev; origin/HEAD — на main
const PLAN_RERUN = `# План: INV-7\n\nобновлён: 2026-11-12\nглавная: ${BASE}\nцель: ${GOAL_RERUN}\n\n## Документы\n` +
  `- ${BT7} · feature/inv-7 · открытых: 2\n- ${NB} · ${BASE} · открытых: 2\n\n## Дела\n` +
  `1. ${Q.bt7a} — не назван. — ждём: — · ${BT7}, пункт 1\n` +
  `2. ${Q.bt7b} — не назван. — ждём: — · ${BT7}, пункт 2\n` +
  `3. ${Q.nb1} — ждём: Голубев А. · ${NB}, 2026-11-10 №1.1\n` +
  `4. ${Q.nb2} — ждём: — · ${NB}, 2026-11-10 №1.2\n`;
// Второй запуск «следим»: за день в ноуте появился ещё вопрос.
const NB_NEXT = NB_RERUN + '\n## 2026-11-18\n\n### 1 · письмо Сидорова П.\n' +
  `- [открыто] ${Q.nbNext} — ждёт: Сидоров П. · 2026-11-18 №1.1\n`;
// Запрос на правку: вопросы — в разделе «## Открытые вопросы», не в шапке.
const CR = '---\ntype: change-request\ntask: INV-8\nsource: документа нет — решение аналитика\n---\n\n' +
  '# Запрос на правку: лимит списания без утверждения\n\n> **Статус готовности:** Требуются уточнения (2)\n' +
  '> **Задача:** INV-8\n> **Редакция:** 1\n\n## 1. Затронутый бизнес-процесс\nСписание запчасти, экран акта.\n\n' +
  '## 4. Как должно стать\n- **FR-1:** Лимит списания без утверждения — 20 000 ₽.\n\n' +
  `## Открытые вопросы\n1. ${Q.cr1}\n2. ${Q.cr2}\n`;
const PLAN9_OLD = `# План: INV-9\n\nобновлён: 2026-11-13\nглавная: ${BASE}\nцель: БТ и спека влиты\n\n## Документы\n` +
  `- ${BT9} · feature/inv-9 · открытых: 1\n\n## Дела\n1. ${Q.bt9} — не подтверждено. — ждём: — · ${BT9}, пункт 1\n`;

function gitIn(cwd, env, ...args) {
  return execFileSync('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
}

// origin.git, irina/ (коллега), me/ (человек, на feature/inv-7). variant: create | rerun | add | pick.
function seed(box, variant) {
  mkdirSync(box, { recursive: true });
  const config = join(box, 'gitconfig');
  writeFileSync(config, '[user]\n\tname = Я\n\temail = me@example.com\n[init]\n\tdefaultBranch = main\n[core]\n\tautocrlf = false\n[commit]\n\tgpgsign = false\n');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const g = (cwd, ...args) => gitIn(cwd, env, ...args);
  const put = (repo, rel, body) => { const p = join(repo, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); };
  const as = (who, date) => ({ ...env, GIT_AUTHOR_NAME: who, GIT_COMMITTER_NAME: who, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  const commit = (repo, who, date, msg) => {
    g(repo, 'add', '-A');
    execFileSync('git', ['commit', '-q', '-m', msg], { cwd: repo, stdio: 'ignore', env: as(who, date) });
  };
  const origin = join(box, 'origin.git'), irina = join(box, 'irina'), me = join(box, 'me');
  g(box, 'init', '-q', '--bare', origin);
  g(box, 'clone', '-q', origin, irina);
  put(irina, 'README.md', '# Склад запчастей\n');
  put(irina, 'coddoc/INV-1/business_requirements.md', BT('INV-1', ['Формат накладной — не назван.']));
  put(irina, NB, NB_BASE);
  commit(irina, 'Ирина', '2026-11-10T10:00:00+03:00', 'основная');
  g(irina, 'push', '-q', 'origin', 'main');
  // Задачи вливают в dev, а не в main (ветка по умолчанию, на неё — origin/HEAD); INV-3 влита в dev.
  g(irina, 'checkout', '-q', '-b', 'dev');
  g(irina, 'checkout', '-q', '-b', 'feature/inv-3');
  put(irina, 'coddoc/INV-3/business_requirements.md', BT('INV-3', ['Кто принимает возврат — не назван.']));
  commit(irina, 'Ирина', '2026-11-11T10:00:00+03:00', 'INV-3');
  g(irina, 'push', '-q', 'origin', 'feature/inv-3');
  g(irina, 'checkout', '-q', 'dev');
  execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'влить INV-3', 'feature/inv-3'], { cwd: irina, stdio: 'ignore', env: as('Ирина', '2026-11-11T12:00:00+03:00') });
  g(irina, 'push', '-q', 'origin', 'dev');
  g(irina, 'checkout', '-q', '-b', 'feature/inv-7');
  put(irina, BT7, BT('INV-7', [`${Q.bt7a} — не назван.`, `${Q.bt7b} — не назван.`]));
  commit(irina, 'Ирина', '2026-11-12T10:00:00+03:00', 'INV-7');
  g(irina, 'push', '-q', 'origin', 'feature/inv-7');
  g(irina, 'checkout', '-q', 'dev');
  g(irina, 'checkout', '-q', '-b', 'feature/inv-9');
  put(irina, BT9, BT('INV-9', [`${Q.bt9} — не подтверждено.`]));
  commit(irina, 'Ирина', '2026-11-13T10:00:00+03:00', 'INV-9');
  if (variant === 'pick') {  // после прошлого плана INV-9 в БТ появился второй вопрос
    put(irina, BT9, BT('INV-9', [`${Q.bt9} — не подтверждено.`, `${Q.bt9b} — не назван.`]));
    commit(irina, 'Ирина', '2026-11-14T10:00:00+03:00', 'INV-9: ещё вопрос');
  }
  g(irina, 'push', '-q', 'origin', 'feature/inv-9');
  if (variant === 'add') {
    g(irina, 'checkout', '-q', 'dev');
    g(irina, 'checkout', '-q', '-b', 'feature/inv-8');
    put(irina, CR8, CR);
    commit(irina, 'Ирина', '2026-11-14T10:00:00+03:00', 'INV-8');
    g(irina, 'push', '-q', 'origin', 'feature/inv-8');
  }

  g(box, 'clone', '-q', origin, me);
  // Локальные dev и влитая feature/inv-3 — от main «невлитые», от dev — нет.
  g(me, 'branch', '-q', 'dev', 'origin/dev');
  g(me, 'branch', '-q', 'feature/inv-3', 'origin/feature/inv-3');
  g(me, 'branch', '-q', 'feature/inv-9', 'origin/feature/inv-9');
  if (variant === 'add') g(me, 'branch', '-q', 'feature/inv-8', 'origin/feature/inv-8');
  g(me, 'checkout', '-q', '-b', 'feature/inv-7', 'origin/feature/inv-7');
  if (variant === 'add') put(me, `.coddoc-tmp/work-plan/${PLAN7}`, PLAN_RERUN);
  if (variant === 'pick') {
    put(me, `.coddoc-tmp/work-plan/${PLAN7}`, PLAN_RERUN);
    put(me, `.coddoc-tmp/work-plan/${PLAN9}`, PLAN9_OLD);
  }
  if (variant === 'rerun') {
    put(me, BT7, BT('INV-7', []));
    commit(me, 'Я', '2026-11-17T10:00:00+03:00', 'INV-7: вопросы закрыты');
    put(me, NB, NB_RERUN);  // правка ноута на диске, не закоммичена
    put(me, `.coddoc-tmp/work-plan/${PLAN7}`, PLAN_RERUN);
  }
  put(me, SPEC7, SPEC('INV-7', [`❓ TBD: ${Q.spec7}.`]));  // новая спека — только на диске
  appendFileSync(join(me, '.git', 'info', 'exclude'), '.claude/\n.coddoc-tmp/\n');
  return me;
}

// Состояние, которое прогон не должен менять.
function state(me) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  return ['rev-parse HEAD', 'symbolic-ref HEAD', 'status --porcelain=v1 -uall', 'diff', 'for-each-ref refs/heads']
    .map((c) => gitIn(me, env, ...c.split(' '))).join('\n---\n');
}

function plans(me) {
  const dir = join(me, '.coddoc-tmp', 'work-plan');
  const out = {};
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith('.md')) out[f] = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  return out;
}

// ---------------------------------------------------------------- оценщик

/** Файл плана → { goal, updated, docs: [строки], tasks: [строки] }; режем по строкам, без регулярок из строк. */
function parsePlan(text) {
  const lines = (text ?? '').split('\n');
  const section = (title) => {
    const at = lines.findIndex((l) => l.trim() === `## ${title}`);
    if (at < 0) return [];
    const out = [];
    for (const l of lines.slice(at + 1)) { if (l.startsWith('## ')) break; out.push(l); }
    return out;
  };
  const value = (name) => (lines.find((l) => l.startsWith(`${name}:`)) ?? '').slice(name.length + 1).trim();
  return {
    goal: value('цель'), updated: value('обновлён'), main: value('главная'),
    docs: section('Документы').filter((l) => l.startsWith('- ')),
    tasks: section('Дела').filter((l) => /^\d+\.\s/.test(l)),
  };
}

const PROBES = [
  // Ход 1 — вопрос о главной ветке (гипотеза origin/main), ход 2 — «dev», дальше выбор.
  { id: 'p-create', variant: 'create', turns: ['/work-plan', 'Нет, задачи вливают в dev.', '1, 2, 3'], fallback: 'Да, так.', done: (p) => !!p[PLAN7] },
  { id: 'p-split', variant: 'create', turns: ['/work-plan', 'Нет, задачи вливают в dev.', '1, 4', 'По плану на инициативу.'],
    fallback: 'Да.', done: (p) => !!p[PLAN7] && !!p[PLAN9] },
  { id: 'p-merge', variant: 'create', turns: ['/work-plan', 'Нет, задачи вливают в dev.', '1, 4', 'Все в один, назови Склад.'],
    fallback: 'Да.', done: (p) => !!p[PLAN_ALL] },
  { id: 'p-rerun', variant: 'rerun', turns: ['/work-plan INV-7', 'Закончили.'], fallback: 'Да.', done: (p) => p[PLAN7] !== PLAN_RERUN },
  // Ход 3 — новый запуск скилла в новой сессии: за день в ноуте появился вопрос; про БТ «следим» спрашивать нельзя.
  { id: 'p-watch', variant: 'rerun', fallback: 'Следим.', done: (p) => (p[PLAN7] ?? '').includes(Q.nbNext),
    turns: ['/work-plan INV-7', 'Следим дальше.', { text: '/work-plan INV-7', fresh: true, before: (me) => writeFileSync(join(me, ...NB.split('/')), NB_NEXT) }] },
  { id: 'p-add', variant: 'add', turns: ['/work-plan INV-7 добавь', '1, 2'], fallback: 'Да.', done: (p) => p[PLAN7] !== PLAN_RERUN },
  { id: 'p-pick', variant: 'pick', turns: ['/work-plan', 'INV-9'], fallback: 'Да.', done: (p) => p[PLAN9] !== PLAN9_OLD },
];
const turnOf = (t) => (typeof t === 'string' ? { text: t } : t);

/** run: { cmds, snaps: [планы после каждого хода], answer (последний ход), answers (по ходам), intact, loaded } */
function grade(probe, run) {
  const last = run.snaps[run.snaps.length - 1] ?? {};
  const has = (line, text) => line.includes(text);
  const taskWith = (plan, text) => plan.tasks.find((t) => has(t, text));
  const marks = {
    'скилл загружен': run.loaded,
    'peek --list': run.cmds.some((c) => c.includes('peek.py') && c.includes('--list')),
    'ветку не трогал': !run.cmds.some((c) => /\bgit\b[^|;&]*\b(checkout|switch|stash|pull|worktree|reset|merge|rebase|restore|commit|add)\b/.test(c)),
    'репозиторий цел': run.intact,
  };
  const fromBase = run.cmds.some((c) => c.includes('peek.py') && c.includes('--base') && c.includes('dev'));
  if (['p-create', 'p-split', 'p-merge'].includes(probe.id)) {
    const first = run.answers[0] ?? '';
    marks['спросил главную ветку'] = Object.keys(run.snaps[0] ?? {}).length === 0 && first.includes('main') && first.includes('?');
    marks['список от dev'] = fromBase;
    marks['влитое не предложено'] = !(run.answers[1] ?? '').includes('INV-3');
    marks['главная в шапке'] = Object.values(last).length > 0 && Object.values(last).every((t) => parsePlan(t).main.includes('dev'));
  }
  if (probe.id === 'p-create') {
    const p = parsePlan(last[PLAN7]);
    marks['спросил до записи'] = !(run.snaps[1] ?? {})[PLAN7];
    marks['без лишнего вопроса'] = run.snaps.length === 3;
    marks['файл INV-7.md'] = !!last[PLAN7];
    marks['один план'] = Object.keys(last).length === 1;
    marks['цель по умолчанию'] = p.goal === 'БТ и спека влиты';
    marks['обновлён сегодня'] = p.updated === TODAY;
    marks['документы — три выбранных'] = p.docs.length === 3 && [BT7, SPEC7, NB].every((d) => p.docs.some((l) => has(l, d)));
    marks['дел 5'] = p.tasks.length === 5;
    marks['вопросы дословно'] = [Q.bt7a, Q.bt7b, Q.spec7, Q.nb1, Q.nb2].every((q) => taskWith(p, q));
    const nb1 = taskWith(p, Q.nb1) ?? '';
    marks['ноут: кого ждём и номер'] = has(nb1, 'Голубев') && has(nb1, '2026-11-10 №1.1');
    marks['закрытое не взято'] = !taskWith(p, Q.nbClosed);
  } else if (probe.id === 'p-split' || probe.id === 'p-merge') {
    const asked = run.answers[2] ?? '';
    marks['спросил разбивку до записи'] = Object.keys(run.snaps[2] ?? {}).length === 0 && run.snaps.length === 4
      && asked.includes('INV-7') && asked.includes('INV-9');
    if (probe.id === 'p-split') {
      const p7 = parsePlan(last[PLAN7]), p9 = parsePlan(last[PLAN9]);
      marks['два файла'] = !!last[PLAN7] && !!last[PLAN9] && Object.keys(last).length === 2;
      marks['INV-7: БТ и 2 дела'] = p7.docs.length === 1 && has(p7.docs[0], BT7) && p7.tasks.length === 2
        && !!taskWith(p7, Q.bt7a) && !!taskWith(p7, Q.bt7b);
      marks['INV-9: БТ и 1 дело'] = p9.docs.length === 1 && has(p9.docs[0], BT9) && p9.tasks.length === 1 && !!taskWith(p9, Q.bt9);
    } else {
      const p = parsePlan(last[PLAN_ALL]);
      marks['один файл Склад.md'] = Object.keys(last).join() === PLAN_ALL;
      marks['Склад: оба БТ, 3 дела'] = p.docs.length === 2 && has(p.docs[0], BT7) && has(p.docs[1], BT9) && p.tasks.length === 3
        && [Q.bt7a, Q.bt7b, Q.bt9].every((q) => taskWith(p, q));
    }
  } else if (probe.id === 'p-watch') {
    const mid = parsePlan((run.snaps[1] ?? {})[PLAN7]), p = parsePlan(last[PLAN7]);
    const btLine = (plan) => plan.docs.find((l) => has(l, BT7)) ?? '';
    const watched = (l) => has(l, 'feature/inv-7') && has(l, 'открытых: 0') && has(l, 'следим');
    marks['спросил до записи'] = (run.snaps[0] ?? {})[PLAN7] === PLAN_RERUN;
    marks['«следим»: строка БТ'] = watched(btLine(mid));
    marks['«следим»: дела без БТ'] = mid.tasks.length === 2 && !!taskWith(mid, Q.nb1) && !!taskWith(mid, Q.nbNew);
    marks['второй запуск: не переспросил'] = run.snaps.length === 3 && !/закончили[^.\n]*\?|следим дальше\?/i.test(run.answer);
    marks['второй запуск: пометка осталась'] = watched(btLine(p));
    marks['второй запуск: новое дело'] = p.tasks.length === 3 && [Q.nb1, Q.nbNew, Q.nbNext].every((q) => taskWith(p, q));
    marks['цель как была'] = p.goal === GOAL_RERUN;
    marks['один план'] = Object.keys(last).length === 1;
  } else if (probe.id === 'p-add') {
    const p = parsePlan(last[PLAN7]);
    marks['спросил до записи'] = (run.snaps[0] ?? {})[PLAN7] === PLAN_RERUN;
    marks['без лишнего вопроса'] = run.snaps.length === 2;
    marks['один план'] = Object.keys(last).length === 1;
    marks['цель как была'] = p.goal === GOAL_RERUN;
    marks['обновлён сегодня'] = p.updated === TODAY;
    marks['документы: новые в конец'] = p.docs.length === 4 && [BT7, NB, SPEC7, CR8].every((d, i) => has(p.docs[i], d));
    marks['дел 7'] = p.tasks.length === 7;
    marks['вопросы дословно'] = [Q.bt7a, Q.bt7b, Q.nb1, Q.nb2, Q.spec7].every((q) => taskWith(p, q));
    marks['запрос на правку: раздел вопросов'] = [Q.cr1, Q.cr2].every((q) => has(taskWith(p, q) ?? '', CR8));
    marks['отчёт: «добавь»'] = run.answer.includes('/work-plan INV-7 добавь');
  } else if (probe.id === 'p-pick') {
    const p = parsePlan(last[PLAN9]);
    marks['спросил, какой план'] = (run.snaps[0] ?? {})[PLAN7] === PLAN_RERUN && (run.snaps[0] ?? {})[PLAN9] === PLAN9_OLD;
    marks['без лишнего вопроса'] = run.snaps.length === 2;
    marks['INV-7 не тронут'] = last[PLAN7] === PLAN_RERUN && Object.keys(last).length === 2;
    marks['INV-9: открытых 2'] = p.docs.length === 1 && has(p.docs[0], BT9) && has(p.docs[0], 'открытых: 2');
    marks['INV-9: дела 2'] = p.tasks.length === 2 && !!taskWith(p, Q.bt9) && !!taskWith(p, Q.bt9b);
    marks['цель как была'] = p.goal === 'БТ и спека влиты';
    marks['обновлён сегодня'] = p.updated === TODAY;
    marks['отчёт: появилось'] = run.answer.toLowerCase().includes(Q.bt9b.toLowerCase());
  } else {
    const p = parsePlan(last[PLAN7]);
    marks['спросил до записи'] = (run.snaps[0] ?? {})[PLAN7] === PLAN_RERUN;
    marks['без лишнего вопроса'] = run.snaps.length === 2;
    marks['файл обновлён'] = !!last[PLAN7] && last[PLAN7] !== PLAN_RERUN;
    marks['один план'] = Object.keys(last).length === 1;
    marks['БТ убран, ноут остался'] = !p.docs.some((l) => has(l, BT7)) && p.docs.some((l) => has(l, NB));
    marks['спека сама не добавлена'] = !p.docs.some((l) => has(l, SPEC7));
    marks['цель как была'] = p.goal === GOAL_RERUN;
    marks['обновлён сегодня'] = p.updated === TODAY;
    marks['дела: старое и новое'] = p.tasks.length === 2 && !!taskWith(p, Q.nb1) && !!taskWith(p, Q.nbNew);
    marks['отчёт: появилось'] = run.answer.includes(Q.nbNew);
    // Отчёт пересказывает: дословность — только в файле плана; здесь — что названы и вопрос ноута, и вопросы убранного БТ.
    const said = run.answer.toLowerCase();
    marks['отчёт: закрылось'] = said.includes('подпись кладовщика') && said.includes('утверждает списание');
    marks['отчёт: «добавь»'] = run.answer.includes('/work-plan INV-7 добавь');
    marks['список от главной из файла'] = fromBase;
    marks['главная как была'] = p.main === BASE;
    marks['влитое не в отчёте'] = !run.answer.includes('INV-3');
  }
  return marks;
}

function selftest() {
  let fails = 0;
  const check = (label, marks, want) => {
    for (const [k, v] of Object.entries(marks)) if (v !== want) { fails++; console.log(`  ✗ ${label}: ${k} = ${v}`); }
  };
  // Плохие наборы: каждый пункт должен покраснеть хотя бы в одном.
  const checkBad = (label, list) => {
    for (const k of Object.keys(list[0])) if (list.every((m) => m[k])) { fails++; console.log(`  ✗ ${label}: «${k}» не пойман`); }
  };
  const P = (id) => PROBES.find((p) => p.id === id);
  const ok = { cmds: ['python .claude/skills/work-plan/../peek/reference/peek.py --list',
    'python .claude/skills/work-plan/../peek/reference/peek.py --list --base dev'], answer: '',
  answers: ['Главная ветка — origin/main? Если задачи вливают в другую — назови её.', 'Какие берём в план? 1. INV-7 · …',
    'Найдено 2 инициативы: INV-7, INV-9. По плану на инициативу или все в один план — под каким именем?'],
  intact: true, loaded: true };
  const plan = (goal, docs, tasks, main = BASE) => `# План: x\n\nобновлён: ${TODAY}\n${main ? `главная: ${main}\n` : ''}цель: ${goal}\n\n` +
    `## Документы\n${docs.map((d) => `- ${d}\n`).join('')}\n## Дела\n` + tasks.map((t, i) => `${i + 1}. ${t}\n`).join('');
  const create = plan('БТ и спека влиты', [`${BT7} · feature/inv-7 · открытых: 2`, `${SPEC7} · рабочая копия · открытых: 1`, `${NB} · ${BASE} · открытых: 2`],
    [`${Q.bt7a} — не назван. — ждём: — · ${BT7}, пункт 1`, `${Q.bt7b} — не назван. — ждём: — · ${BT7}, пункт 2`,
      `❓ TBD: ${Q.spec7}. — ждём: — · ${SPEC7}, пункт 1`, `${Q.nb1} — ждём: Голубев А. · ${NB}, 2026-11-10 №1.1`, `${Q.nb2} — ждём: — · ${NB}, 2026-11-10 №1.2`]);
  check('создание, хороший', grade(P('p-create'), { ...ok, snaps: [{}, {}, { [PLAN7]: create }] }), true);
  const badCreate = plan('БТ', [`${BT7}`, `${BT9}`], [`${Q.nbClosed} — ждём: Голубев`, 'Кто утверждает списание'], '')
    .replace(`обновлён: ${TODAY}`, 'обновлён: 2026-11-12');
  const bad = { cmds: ['git checkout main', 'git log --all'], answer: 'Готово.', answers: ['Готово.', '1. INV-3 · coddoc/INV-3/…', 'Готово.'],
    intact: false, loaded: false };
  const many = { [PLAN7]: badCreate, [PLAN9]: 'x' };
  checkBad('создание, плохой', [
    grade(P('p-create'), { ...bad, snaps: [{ [PLAN7]: badCreate }, many, many, many] }),
    grade(P('p-create'), { ...bad, snaps: [{}, {}] })]);
  const g7 = plan('БТ и спека влиты', [`${BT7} · feature/inv-7 · открытых: 2`], [`${Q.bt7a} — не назван.`, `${Q.bt7b} — не назван.`]);
  const g9 = plan('БТ и спека влиты', [`${BT9} · feature/inv-9 · открытых: 1`], [`${Q.bt9} — не подтверждено.`]);
  check('разбивка, хороший', grade(P('p-split'), { ...ok, snaps: [{}, {}, {}, { [PLAN7]: g7, [PLAN9]: g9 }] }), true);
  checkBad('разбивка, плохой', [grade(P('p-split'), { ...bad, snaps: [{ [PLAN7]: create }, { [PLAN7]: create }] }),
    grade(P('p-split'), { ...bad, snaps: [{}, {}, {}, { [PLAN7]: badCreate }] })]);
  const all = plan('БТ и спека влиты', [`${BT7} · feature/inv-7 · открытых: 2`, `${BT9} · feature/inv-9 · открытых: 1`],
    [`${Q.bt7a} — не назван.`, `${Q.bt7b} — не назван.`, `${Q.bt9} — не подтверждено.`]);
  check('в один, хороший', grade(P('p-merge'), { ...ok, snaps: [{}, {}, {}, { [PLAN_ALL]: all }] }), true);
  checkBad('в один, плохой', [grade(P('p-merge'), { ...bad, snaps: [{ [PLAN7]: create }, { [PLAN7]: create }] }),
    grade(P('p-merge'), { ...bad, snaps: [{}, {}, {}, { [PLAN_ALL]: badCreate }] })]);
  const rerun = plan(GOAL_RERUN, [`${NB} · рабочая копия · открытых: 2`],
    [`${Q.nb1} — ждём: Голубев А. · ${NB}, 2026-11-10 №1.1`, `${Q.nbNew} — ждём: Сидоров П. · ${NB}, 2026-11-17 №1.2`]);
  const answer = `Закрылось: ${Q.bt7a}; ${Q.bt7b}; ${Q.nb2}. Появилось: ${Q.nbNew}. Ещё 2 документа — добавить: /work-plan INV-7 добавь`;
  check('повтор, хороший', grade(P('p-rerun'), { ...ok, answer, snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: rerun }] }), true);
  const badRerun = plan('БТ и спека влиты', [`${BT7} · feature/inv-7 · открытых: 0`, `${SPEC7} · рабочая копия · открытых: 1`],
    [`${Q.nb2} — ждём: —`], '').replace(`обновлён: ${TODAY}`, 'обновлён: 2026-11-12');
  checkBad('повтор, плохой', [
    grade(P('p-rerun'), { ...bad, snaps: [{ [PLAN7]: badRerun }, { [PLAN7]: badRerun }, { [PLAN7]: badRerun, x: '' }] }),
    grade(P('p-rerun'), { ...bad, answer: 'Ещё 3 документа: INV-3 …', snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: PLAN_RERUN }] })]);

  const nbTask = (q, who, n) => `${q} — ждём: ${who} · ${NB}, ${n}`;
  const watchDocs = (n) => [`${BT7} · feature/inv-7 · открытых: 0 · следим`, `${NB} · рабочая копия · открытых: ${n}`];
  const watchMid = plan(GOAL_RERUN, watchDocs(2), [nbTask(Q.nb1, 'Голубев А.', '2026-11-10 №1.1'), nbTask(Q.nbNew, 'Сидоров П.', '2026-11-17 №1.2')]);
  const watchEnd = plan(GOAL_RERUN, watchDocs(3), [nbTask(Q.nb1, 'Голубев А.', '2026-11-10 №1.1'),
    nbTask(Q.nbNew, 'Сидоров П.', '2026-11-17 №1.2'), nbTask(Q.nbNext, 'Сидоров П.', '2026-11-18 №1.1')]);
  check('следим, хороший', grade(P('p-watch'), { ...ok, answer: `План обновлён. Появилось: ${Q.nbNext}.`,
    snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: watchMid }, { [PLAN7]: watchEnd }] }), true);
  const watchBad = plan('БТ и спека влиты', [`${BT7} · feature/inv-7 · открытых: 0`], [nbTask(Q.nb1, '—', '')]);
  checkBad('следим, плохой', [grade(P('p-watch'), { ...bad, answer: 'Закончили с ним или следим дальше?',
    snaps: [{ [PLAN7]: watchMid }, { [PLAN7]: PLAN_RERUN }, { [PLAN7]: watchBad }, { [PLAN7]: watchBad, x: '' }] })]);

  const addGood = plan(GOAL_RERUN, [`${BT7} · feature/inv-7 · открытых: 2`, `${NB} · origin/main · открытых: 2`,
    `${SPEC7} · рабочая копия · открытых: 1`, `${CR8} · feature/inv-8 · открытых: 2`],
    [`${Q.bt7a} — не назван. — ждём: — · ${BT7}, пункт 1`, `${Q.bt7b} — не назван. — ждём: — · ${BT7}, пункт 2`,
      nbTask(Q.nb1, 'Голубев А.', '2026-11-10 №1.1'), nbTask(Q.nb2, '—', '2026-11-10 №1.2'),
      `❓ TBD: ${Q.spec7}. — ждём: — · ${SPEC7}, пункт 1`, `${Q.cr1} — ждём: — · ${CR8}, пункт 1`, `${Q.cr2} — ждём: — · ${CR8}, пункт 2`]);
  check('добавь, хороший', grade(P('p-add'), { ...ok, answer: 'Ещё 1 документ в работе не в плане — добавить: /work-plan INV-7 добавь',
    snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: addGood }] }), true);
  const addBad = plan('БТ и спека влиты', [`${SPEC7}`, `${BT7}`], [`${Q.cr1} — ждём: — · ${SPEC7}`])
    .replace(`обновлён: ${TODAY}`, 'обновлён: 2026-11-12');
  checkBad('добавь, плохой', [grade(P('p-add'), { ...bad, snaps: [{ [PLAN7]: addBad }, { [PLAN7]: addBad, x: '' }, { [PLAN7]: addBad, x: '' }] })]);

  const pickGood = plan('БТ и спека влиты', [`${BT9} · feature/inv-9 · открытых: 2`],
    [`${Q.bt9} — не подтверждено. — ждём: — · ${BT9}, пункт 1`, `${Q.bt9b} — не назван. — ждём: — · ${BT9}, пункт 2`]);
  check('выбор плана, хороший', grade(P('p-pick'), { ...ok, answer: `Появилось: ${Q.bt9b.toLowerCase()} — не назван.`,
    snaps: [{ [PLAN7]: PLAN_RERUN, [PLAN9]: PLAN9_OLD }, { [PLAN7]: PLAN_RERUN, [PLAN9]: pickGood }] }), true);
  const pickBad = plan('БТ', [`${BT9} · feature/inv-9 · открытых: 1`], [`${Q.bt9} — не подтверждено.`])
    .replace(`обновлён: ${TODAY}`, 'обновлён: 2026-11-13');
  checkBad('выбор плана, плохой', [grade(P('p-pick'), { ...bad,
    snaps: [{ [PLAN7]: create }, { [PLAN7]: create, [PLAN9]: pickBad }, { [PLAN7]: create, [PLAN9]: pickBad }] })]);
  console.log(fails ? `оценщик: провалов ${fails}` : 'оценщик: хорошие данные — всё ✓, плохие — пойман каждый пункт');
  return fails;
}

// ---------------------------------------------------------------- прогоны

function runClaude(cwd, prompt, model, out, file, sid = null) {
  return new Promise((done) => {
    // MSYS_NO_PATHCONV: Git Bash переписывает аргумент, начатый с «/», в путь Windows.
    const resume = sid ? ' --resume "$PROBE_SID"' : '';
    const p = spawn('bash', ['-c', `claude -p "$PROBE_PROMPT"${resume} --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose`],
      { cwd, env: { ...process.env, PROBE_PROMPT: prompt, PROBE_MODEL: model, PROBE_SID: sid ?? '', MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' },
        stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill(), 900_000);
    p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(out, file), stdout); writeFileSync(join(out, `_stderr-${file}.log`), stderr); done(code); });
  });
}

const events = (path) => readFileSync(path, 'utf8').split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

async function main() {
  if (process.argv[2] === '--selftest') process.exit(selftest() ? 1 : 0);
  if (process.argv[2] === '--seed') {
    const me = seed(resolve(process.argv[3]), process.argv[4] ?? 'create');
    for (const s of SKILLS) cpSync(resolve(here, '..', s), join(me, '.claude', 'skills', s), { recursive: true });
    console.log(me);
    return;
  }
  const round = process.argv[2];
  const n = Number(process.argv[3] ?? 1);
  const model = modelId(process.argv[4] ?? 'claude-sonnet-5');
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  if (!round) throw new Error('нужно имя раунда');
  if (selftest()) throw new Error('оценщик не прошёл самопроверку — прогоны не запускаю');

  const roundDir = join(here, 'runs', round);
  for (const s of SKILLS) { const snap = join(roundDir, '_skills', s); if (!existsSync(snap)) cpSync(resolve(here, '..', s), snap, { recursive: true }); }
  const boxRoot = join(tmpdir(), 'work-plan-probes', round);
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
      const me = seed(join(boxRoot, tag), job.probe.variant);
      for (const s of SKILLS) cpSync(join(roundDir, '_skills', s), join(me, '.claude', 'skills', s), { recursive: true });
      let before = state(me);
      const t0 = Date.now();
      job.snaps = []; job.codes = [];
      const replies = [...job.probe.turns, job.probe.fallback].map(turnOf);
      let sid = null;
      for (let t = 0; t < replies.length; t++) {
        if (t === replies.length - 1 && job.probe.done(plans(me))) break;  // «да» — только если планы не готовы
        // Новый запуск: правка песочницы «за день» (она — не дело прогона) и новая сессия.
        if (replies[t].before) { replies[t].before(me); before = state(me); }
        if (replies[t].fresh) sid = null;
        const file = `stream-${t + 1}.jsonl`;
        job.codes.push(await runClaude(me, replies[t].text, model, out, file, sid));
        job.snaps.push(plans(me));
        sid = events(join(out, file)).find((e) => e.session_id)?.session_id ?? null;
        if (!sid) break;
      }
      job.intact = state(me) === before;
      for (const [f, body] of Object.entries(plans(me))) writeFileSync(join(out, `plan-${f}`), body);
      job.out = out; job.ms = Date.now() - t0;
      console.log(`прогон ${tag}: ходов ${job.codes.length}, коды ${job.codes.join(',')}, ${Math.round(job.ms / 1000)} с`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const report = [`раунд ${round} · модель ${model} · прогонов на пробу ${n} · ${new Date().toISOString()}`, ''];
  let total = 0;
  for (const probe of probes) {
    report.push(`## ${probe.id} — ${probe.turns.map(turnOf).map((t) => `«${t.text}»${t.fresh ? ' (новая сессия)' : ''}`).join(' → ')}`);
    for (const job of jobs.filter((j) => j.probe === probe)) {
      const streams = readdirSync(job.out).filter((f) => /^stream-\d+\.jsonl$/.test(f)).sort();
      const ev = streams.flatMap((f) => events(join(job.out, f)));
      const main = ev.filter((e) => !e.parent_tool_use_id);
      const uses = main.filter((e) => e.type === 'assistant').flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === 'tool_use'));
      const cmds = uses.filter((u) => ['Bash', 'PowerShell'].includes(u.name)).map((u) => String(u.input?.command ?? ''));
      const results = ev.filter((e) => e.type === 'result');
      // total_cost_usd копится внутри сессии (--resume): максимум по сессии, сумма по сессиям.
      const bySession = {};
      for (const r of results) bySession[r.session_id ?? '?'] = Math.max(bySession[r.session_id ?? '?'] ?? 0, Number(r.total_cost_usd ?? 0));
      const cost = Object.values(bySession).reduce((a, b) => a + b, 0);
      const answer = String(results[results.length - 1]?.result ?? '');
      // Текст скилла по «/work-plan» в поток -p не попадает: скилл есть в init песочницы, и первая команда — из скилла
      // (`peek.py --list`; путь `<скилл>/../peek/` модель пишет и как `.claude/skills/peek/` — это тот же файл).
      const init = ev.find((e) => e.subtype === 'init') ?? {};
      const loaded = (init.skills ?? []).includes('work-plan') && cmds.length > 0 && cmds[0].includes('peek.py') && cmds[0].includes('--list');
      total += cost;
      const answers = results.map((r) => String(r.result ?? ''));
      const marks = grade(probe, { cmds, snaps: job.snaps, answer, answers, intact: job.intact, loaded });
      const bad = Object.entries(marks).filter(([, v]) => !v).map(([k]) => k);
      report.push(`run-${String(job.i).padStart(2, '0')}: ${bad.length ? '✗ ' + bad.join(', ') : '✓ всё'} · $${cost.toFixed(3)} · ходов ${job.codes.length} · ${Math.round(job.ms / 1000)} с`);
      report.push(`  ответы хода: ${results.map((r) => String(r.result ?? '').replace(/\s+/g, ' ').slice(0, 220)).join(' ⏎ ')}`);
      writeFileSync(join(job.out, 'answer.md'), results.map((r, k) => `## ход ${k + 1}\n\n${r.result ?? ''}\n`).join('\n'));
    }
    report.push('');
  }
  report.push(`итого: $${total.toFixed(2)}`);
  writeFileSync(join(roundDir, 'GRADE-REPORT.txt'), report.join('\n') + '\n');
  console.log('\n' + report.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
