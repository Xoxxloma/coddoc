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

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
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
  bt7c: 'Кто подписывает акт списания',
};
const GOAL_RERUN = 'БТ влит, спека согласована с Голубевым';
const GOAL_OWN = 'Согласовать списание с Голубевым до 25.11';  // своя цель в ответ на гипотезу
// Гипотеза цели — готовые статусы выбранных документов: БТ — к оценке, спека — к разработке, ноут — без вопросов.
const goalIs = (goal, ...parts) => parts.every((s) => goal.toLowerCase().includes(s));

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

// Свой вопрос аналитика с уточнением в скобках: группа «Ваши дела», уточнение — в сути.
const NB2_WHO = 'аналитик (сверить с актом формы)';
const NB_HEAD ='---\nтема: списание запчастей\nключ: INV-7\nо чём: списание запчастей со склада\nроли: —\n---\n# Ноут: списание запчастей\n\n';
const NB_DAY1 = '## 2026-11-10\n\n### 1 · созвон с Голубевым А. (главный механик) со слов аналитика\n' +
  `- [открыто] ${Q.nb1} — ждёт: Голубев А. · 2026-11-10 №1.1\n` +
  `- [открыто] ${Q.nb2} — ждёт: ${NB2_WHO} · 2026-11-10 №1.2\n` +
  `- [открыто] ${Q.nbClosed} — ждёт: Голубев А. · 2026-11-10 №1.3 ‖ закрыт: 2026-11-12 №1.1\n\n` +
  '## 2026-11-12\n\n### 1 · письмо Голубева А.\n' +
  '- [решено] Износ считается по пробегу — решил: Голубев А.; отвечает на: 2026-11-10 №1.3 · 2026-11-12 №1.1\n' +
  '> Износ считаем по пробегу.\n';
const NB_BASE = NB_HEAD + NB_DAY1;
const NB_RERUN = NB_HEAD + NB_DAY1.replace(`${Q.nb2} — ждёт: ${NB2_WHO} · 2026-11-10 №1.2\n`, `${Q.nb2} — ждёт: ${NB2_WHO} · 2026-11-10 №1.2 ‖ закрыт: 2026-11-17 №1.1\n`) +
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
  `4. ${Q.nb2} — ждём: ${NB2_WHO} · ${NB}, 2026-11-10 №1.2\n`;  // форма 1.2.0: дело — одна строка
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

// План с датами (1.5.0) «Склад»: четыре документа, у дела ноута — ручная правка сути человеком (HAND).
const HAND = 'Списывать ли запчасть при действующей гарантии — дожать до пятницы';
const BT7_ITEMS = [[`Кто утверждает списание дороже 50 000 ₽ · БТ INV-7 п.1`, `${Q.bt7a} — не назван.`],
  [`Срок хранения списанных запчастей · БТ INV-7 п.2`, `${Q.bt7b} — не назван.`]];
const BT9_ITEM = [`Нужна ли выгрузка остатков в 1С · БТ INV-9 п.1`, `${Q.bt9} — не подтверждено.`];
const datedGroups = (bt7, bt9 = [BT9_ITEM]) => [
  ['Голубев А.', [[`${HAND} · списание-запчастей 2026-11-10 №1.1`, Q.nb1]]],
  ['Ваши дела', [[`Проверить, нужна ли подпись кладовщика на акте (сверить с актом формы) · списание-запчастей 2026-11-10 №1.2`, Q.nb2]]],
  ['Без адресата', [...bt7, ...bt9, [`Какой сервис хранит фото списанной запчасти · спека INV-7 п.1`, `❓ TBD: ${Q.spec7}.`]]]];
const DATED_DOCS = [BT7, BT9, SPEC7, NB];
// p-step3: план INV-7 без БТ INV-9; в работе появился запрос на правку той же инициативы — Шаг 3 дописывает его в файл.
const CR7 = 'coddoc/INV-7/change_request.md';
const STEP3_DOCS = [BT7, SPEC7, NB];
const step3Plan = (docs, updated = '2026-11-19') =>
  planText({ name: 'INV-7', updated, goal: GOAL_RERUN, docs, groups: datedGroups(BT7_ITEMS, []) });
/** Файл плана формы 1.3.0+: groups — [[группа, [[суть · откуда, оригинал], …]], …]. */
function planText({ name, updated, goal, docs, groups }) {
  let k = 0;
  const n = groups.reduce((a, [, items]) => a + items.length, 0);
  return `# План: ${name}\n\nобновлён: ${updated}\nглавная: ${BASE}\nцель: ${goal}\n\n## Документы\n${docs.map((d) => `- ${d}\n`).join('')}\n` +
    `## Дела\nВсего ${n}: ${groups.map(([g, items]) => `${g} — ${items.length}`).join(' · ')}\n\n` +
    groups.map(([g, items]) => `### ${g} — ${items.length}\n` + items.map(([line, quote]) => `${++k}. ${line}\n   > ${quote}\n`).join('')).join('\n');
}
const datedPlan = (docs, updated = '2026-11-19', bt7 = BT7_ITEMS) =>
  planText({ name: 'Склад', updated, goal: GOAL_OWN, docs, groups: datedGroups(bt7) });
const SETTINGS_15 = '# Слежка за планом работы\n\nслежка: каждые 15 минут\nрасписание: */15 * * * *\n';

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
  if (variant === 'dated-cr') {
    g(irina, 'checkout', '-q', 'dev');
    g(irina, 'checkout', '-q', '-b', 'feature/inv-7-cr');
    put(irina, CR7, CR.replace(/INV-8/g, 'INV-7'));
    commit(irina, 'Ирина', '2026-11-19T11:00:00+03:00', 'INV-7: запрос на правку');
    g(irina, 'push', '-q', 'origin', 'feature/inv-7-cr');
  }
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
  if (variant === 'dated-cr') g(me, 'branch', '-q', 'feature/inv-7-cr', 'origin/feature/inv-7-cr');
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
  if (variant.startsWith('dated')) {
    // План «Склад» с датами — из строк настоящего peek --list (дата — в часовом поясе машины); у спеки на диске mtime
    // закреплён, чтобы дата не зависела от минуты засева. Потом — «за время слежки»: один документ поменялся,
    // ветка документа удалена или есть файл настроек.
    const t = new Date('2026-11-14T09:00:00+03:00');
    utimesSync(join(me, ...SPEC7.split('/')), t, t);
    const peek = resolve(here, '..', 'peek', 'reference', 'peek.py');
    const out = execFileSync(process.platform === 'win32' ? 'python' : 'python3', [peek, '--list', '--base', 'dev'],
      { cwd: me, env: { ...env, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
    const lines = {};
    for (const l of out.split(/\r?\n/).filter((x) => x.startsWith('  '))) {
      const [, path, where, , date, open] = l.trim().split(' · ');
      lines[path] = `${path} · ${where} · ${date} · ${open}`;
    }
    if (DATED_DOCS.some((d) => !lines[d])) throw new Error(`засев dated: peek не дал всех документов:\n${out}`);
    if (variant === 'dated-cr') {
      if (!lines[CR7]) throw new Error(`засев dated-cr: peek не дал запрос на правку:\n${out}`);
      put(me, `.coddoc-tmp/work-plan/${PLAN7}`, step3Plan(STEP3_DOCS.map((d) => lines[d])));
      return me;
    }
    put(me, `.coddoc-tmp/work-plan/${PLAN_ALL}`, datedPlan(DATED_DOCS.map((d) => lines[d])));
    if (variant === 'dated-one') {
      put(me, BT7, BT('INV-7', [`${Q.bt7a} — не назван.`, `${Q.bt7b} — не назван.`, `${Q.bt7c} — не назван.`]));
      g(me, 'add', BT7);
      execFileSync('git', ['commit', '-q', '-m', 'INV-7: ещё вопрос'], { cwd: me, stdio: 'ignore', env: as('Я', '2026-11-19T15:00:00+03:00') });
    }
    if (variant === 'dated-gone') g(me, 'branch', '-q', '-D', 'feature/inv-9');
    if (variant === 'dated-set') put(me, '.coddoc-tmp/coddoc-settings/work-plan.md', SETTINGS_15);
  }
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
  // Дело 1.3.0: «### <группа> — K», строка «N. <суть> · <откуда>», под ней «   > <оригинал>»; 1.2.0 — одна строка.
  const items = [];
  let group = '';
  for (const l of section('Дела')) {
    if (l.startsWith('### ')) group = l.slice(4).trim();
    else if (/^\d+\.\s/.test(l)) items.push({ group, line: l, quote: '' });
    else if (items.length && /^\s+>/.test(l)) items[items.length - 1].quote += l.replace(/^\s+>\s?/, '');
  }
  return {
    goal: value('цель'), updated: value('обновлён'), main: value('главная'),
    docs: section('Документы').filter((l) => l.startsWith('- ')),
    summary: section('Дела').find((l) => l.startsWith('Всего')) ?? '',
    items,
    tasks: items.map((t) => `${t.group} | ${t.line} | ${t.quote}`),
  };
}

const PROBES = [
  // Ход 1 — вопрос о главной ветке (гипотеза origin/main), ход 2 — «dev», дальше выбор; последний — ответ на вопрос о цели.
  { id: 'p-create', variant: 'create', turns: ['/work-plan', 'Нет, задачи вливают в dev.', '1, 2, 3', 'Да.'], fallback: 'Да, так.', done: (p) => !!p[PLAN7] },
  { id: 'p-split', variant: 'create', turns: ['/work-plan', 'Нет, задачи вливают в dev.', '1, 4', 'По плану на инициативу.', 'Да.'],
    fallback: 'Да, так.', done: (p) => !!p[PLAN7] && !!p[PLAN9] },
  { id: 'p-merge', variant: 'create', turns: ['/work-plan', 'Нет, задачи вливают в dev.', '1, 4', 'Все в один, назови Склад.', GOAL_OWN],
    fallback: 'Да, так.', done: (p) => !!p[PLAN_ALL] },
  { id: 'p-rerun', variant: 'rerun', turns: ['/work-plan INV-7', 'Закончили.'], fallback: 'Да.', done: (p) => p[PLAN7] !== PLAN_RERUN },
  // Ход 3 — новый запуск скилла в новой сессии: за день в ноуте появился вопрос; про БТ «следим» спрашивать нельзя.
  { id: 'p-watch', variant: 'rerun', fallback: 'Следим.', done: (p) => (p[PLAN7] ?? '').includes(Q.nbNext),
    turns: ['/work-plan INV-7', 'Следим дальше.', { text: '/work-plan INV-7', fresh: true, before: (me) => writeFileSync(join(me, ...NB.split('/')), NB_NEXT) }] },
  { id: 'p-add', variant: 'add', turns: ['/work-plan INV-7 добавь', '1, 2'], fallback: 'Да.', done: (p) => p[PLAN7] !== PLAN_RERUN },
  { id: 'p-pick', variant: 'pick', turns: ['/work-plan', 'INV-9'], fallback: 'Да.', done: (p) => p[PLAN9] !== PLAN9_OLD },
  // 1.5.0 — план с датами «Склад» (4 документа). Ответа «да» нет: ход — как тик слежки.
  { id: 'p-same', variant: 'dated', turns: ['/work-plan Склад'], done: () => true },
  { id: 'p-one', variant: 'dated-one', turns: ['/work-plan Склад'], done: () => true },
  { id: 'p-gone', variant: 'dated-gone', turns: ['/work-plan Склад'], done: () => true },
  // Вопрос висит, приходит тик — та же команда в той же сессии: не ответ.
  { id: 'p-pending', variant: 'dated-gone', turns: ['/work-plan Склад', '/work-plan Склад'], done: () => true },
  // stream — все ходы одним процессом (`--input-format stream-json`): задачи cron живут только в процессе.
  { id: 'p-follow', variant: 'dated', stream: true, turns: ['/work-plan Склад следи', '/work-plan Склад следи'] },
  { id: 'p-stop', variant: 'dated', stream: true, turns: ['/work-plan Склад следи', '/work-plan стоп'] },
  { id: 'p-follow-set', variant: 'dated-set', turns: ['/work-plan Склад следи'], done: () => true },
  // Шаг 3 дописывает выбранный документ в существующий план INV-7 (без «добавь»): быстрого пути нет.
  { id: 'p-step3', variant: 'dated-cr', turns: ['/work-plan', 'Новый план.', 'Да.', 'Только запрос на правку INV-7.'],
    fallback: 'Да.', done: (p) => (p[PLAN7] ?? '').includes(CR7) },
];
const DATED_PROBES = ['p-same', 'p-one', 'p-gone', 'p-pending', 'p-follow', 'p-stop', 'p-follow-set', 'p-step3'];

/** Какие документы плана прочитаны из копий: Read/Grep по пути, Bash (не peek.py) с путём документа в команде. */
function docReads(uses) {
  const out = new Set();
  for (const u of uses) {
    const text = (u.name === 'Read' ? String(u.input?.file_path ?? '') : u.name === 'Grep' ? String(u.input?.path ?? '')
      : ['Bash', 'PowerShell'].includes(u.name) ? String(u.input?.command ?? '') : '').replace(/\\/g, '/');
    if (!text || (u.name !== 'Read' && text.includes('peek.py'))) continue;
    for (const d of DATED_DOCS) if (text.includes(d)) out.add(d);
    if (u.name === 'Grep' && /peek\/list\/?$/.test(text)) out.add('вся папка копий');
  }
  return out;
}
const cronCalls = (uses, name) => uses.filter((u) => u.name === name);
const asksGone = (text) => /закончили/i.test(text) && /следим/i.test(text) && text.includes('INV-9');
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
  if (DATED_PROBES.includes(probe.id)) {
    const before = (run.initial ?? {})[PLAN_ALL];
    const all = (run.turns ?? []).flat();
    const [t1 = [], t2 = []] = run.turns ?? [];
    const untouched = last[PLAN_ALL] === before && Object.keys(last).length === 1;
    if (probe.id === 'p-same') {
      marks['файл не тронут'] = untouched;
      marks['документы не читались'] = docReads(all).size === 0;
      marks['одна строка «без изменений»'] = /без изменений/i.test(run.answer)
        && run.answer.trim().split('\n').filter((l) => l.trim()).length <= 2;
    } else if (probe.id === 'p-one') {
      const p = parsePlan(last[PLAN_ALL]), p0 = parsePlan(before);
      const reads = docReads(all);
      marks['прочитан только изменённый'] = reads.size === 1 && reads.has(BT7);
      marks['строка БТ INV-7: новая дата и N'] = has(p.docs[0] ?? '', BT7) && has(p.docs[0], 'открытых: 3') && has(p.docs[0], '2026-11-19');
      marks['остальные строки документов как были'] = p.docs.length === 4 && p.docs.slice(1).join('\n') === p0.docs.slice(1).join('\n');
      marks['дела INV-7: три, без адресата'] = [Q.bt7a, Q.bt7b, Q.bt7c]
        .every((q) => p.items.some((t) => t.quote.includes(q) && t.group.startsWith('Без адресата')));
      const bare = (line) => line.replace(/^\d+\.\s+/, '');
      marks['дела остальных дословно'] = p0.items.filter((t) => ![Q.bt7a, Q.bt7b].some((q) => t.quote.includes(q)))
        .every((o) => p.items.some((t) => t.quote === o.quote && bare(t.line) === bare(o.line) && t.group.split(' — ')[0] === o.group.split(' — ')[0]));
      marks['ручная правка цела'] = p.items.some((t) => t.line.includes(HAND));
      marks['всего 7'] = p.items.length === 7 && p.summary.startsWith('Всего 7');
      marks['цель и главная как были'] = p.goal === GOAL_OWN && p.main === BASE;
      marks['обновлён сегодня'] = p.updated === TODAY;
      marks['отчёт: появилось'] = run.answer.toLowerCase().includes(Q.bt7c.toLowerCase());
    } else if (probe.id === 'p-gone') {
      marks['спросил «закончили или следим»'] = asksGone(run.answers[0] ?? '');
      marks['план не изменён до ответа'] = untouched;
    } else if (probe.id === 'p-pending') {
      marks['ход 1: спросил'] = asksGone(run.answers[0] ?? '');
      marks['ход 2 (тик): спросил снова'] = asksGone(run.answers[1] ?? '');
      marks['тик — не ответ: план не изменён'] = untouched;
    } else if (probe.id === 'p-follow') {
      const make = cronCalls(t1, 'CronCreate');
      const at = (name) => t1.findIndex((u) => u.name === name);
      marks['ход 1: CronList до CronCreate'] = at('CronList') >= 0 && at('CronList') < at('CronCreate');
      marks['ход 1: одна задача, */10, промпт плана'] = make.length === 1 && make[0].input?.cron === '*/10 * * * *'
        && String(make[0].input?.prompt ?? '').trim() === '/work-plan Склад' && make[0].input?.recurring !== false;
      marks['ход 1: «Слежу …», команда стоп'] = (run.answers[0] ?? '').includes('Слежу') && (run.answers[0] ?? '').includes('/work-plan стоп');
      marks['ход 2: «уже слежу», второй задачи нет'] = cronCalls(t2, 'CronCreate').length === 0 && /уже слежу/i.test(run.answers[1] ?? '');
      marks['файл не тронут'] = untouched;
    } else if (probe.id === 'p-stop') {
      const make = cronCalls(t1, 'CronCreate');
      const id = (String(make[0]?.result ?? '').match(/\b([0-9a-f]{8})\b/) ?? [])[1];
      marks['ход 1: задача поставлена'] = make.length === 1 && String(make[0].input?.prompt ?? '').trim() === '/work-plan Склад';
      marks['ход 2: найдена через CronList, снята'] = cronCalls(t2, 'CronList').length > 0 && !!id
        && cronCalls(t2, 'CronDelete').some((u) => Object.values(u.input ?? {}).includes(id));
      marks['ход 2: новой задачи нет'] = cronCalls(t2, 'CronCreate').length === 0;
      marks['ход 2: «снята»'] = /снят/i.test(run.answers[1] ?? '');
    } else if (probe.id === 'p-step3') {
      const p = parsePlan(last[PLAN7]), p0 = parsePlan((run.initial ?? {})[PLAN7]);
      const bare = (line) => line.replace(/^\d+\.\s+/, '');
      marks['один план, переписан'] = Object.keys(last).join() === PLAN7 && last[PLAN7] !== (run.initial ?? {})[PLAN7];
      marks['запрос на правку — в «Документах» в конце'] = p.docs.length === 4 && has(p.docs[3], CR7)
        && p.docs.slice(0, 3).join('\n') === p0.docs.join('\n');
      marks['дела запроса на правку'] = [Q.cr1, Q.cr2].every((q) => p.items.some((t) => t.quote.includes(q)));
      marks['остальные дела дословно'] = p0.items.length === 5
        && p0.items.every((o) => p.items.some((t) => t.quote === o.quote && bare(t.line) === bare(o.line)));
      marks['ручная правка цела'] = p.items.some((t) => t.line.includes(HAND));
      marks['INV-9 не взят'] = !p.docs.some((l) => has(l, BT9));
      marks['цель как была'] = p.goal === GOAL_RERUN;
      marks['обновлён сегодня'] = p.updated === TODAY;
      marks['не «без изменений»'] = !/без изменений/i.test(run.answer);
    } else {
      const make = cronCalls(all, 'CronCreate');
      marks['расписание из настроек дословно'] = make.length === 1 && make[0].input?.cron === '*/15 * * * *'
        && String(make[0].input?.prompt ?? '').trim() === '/work-plan Склад';
      marks['строка: каждые 15 минут'] = run.answer.includes('каждые 15 минут');
      marks['файл не тронут'] = untouched;
    }
    return marks;
  }
  if (['p-create', 'p-split', 'p-merge'].includes(probe.id)) {
    const first = run.answers[0] ?? '';
    marks['спросил главную ветку'] = Object.keys(run.snaps[0] ?? {}).length === 0 && first.includes('main') && first.includes('?');
    marks['список от dev'] = fromBase;
    // Только строки списка кандидатов («N. …»): пояснение «INV-3 уже влита» — не предложение.
    marks['влитое не предложено'] = !/^\s*\d+\.[^\n]*INV-3/m.test(run.answers[1] ?? '');
    marks['главная в шапке'] = Object.values(last).length > 0 && Object.values(last).every((t) => parsePlan(t).main.includes('dev'));
  }
  if (probe.id === 'p-create') {
    const p = parsePlan(last[PLAN7]);
    const goalAsk = run.answers[2] ?? '';
    marks['спросил цель до записи, гипотеза из состава'] = !(run.snaps[2] ?? {})[PLAN7] && goalAsk.includes('?')
      && goalIs(goalAsk, 'к оценке', 'к разработке', 'без открытых');
    marks['без лишнего вопроса'] = run.snaps.length === 4;
    marks['файл INV-7.md'] = !!last[PLAN7];
    marks['один план'] = Object.keys(last).length === 1;
    marks['цель — гипотеза'] = goalIs(p.goal, 'к оценке', 'к разработке', 'без открытых');
    marks['обновлён сегодня'] = p.updated === TODAY;
    marks['документы — три выбранных'] = p.docs.length === 3 && [BT7, SPEC7, NB].every((d) => p.docs.some((l) => has(l, d)));
    marks['дел 5'] = p.tasks.length === 5;
    // Форма 1.3.0: оригинал — второй строкой, группы по «кого ждём», источник коротко.
    const item = (q) => p.items.find((t) => t.quote.includes(q)) ?? { group: '', line: '', quote: '' };
    marks['оригинал дословно второй строкой'] = [Q.bt7a, Q.bt7b, Q.spec7, Q.nb1, Q.nb2].every((q) => item(q).line);
    marks['строка «Всего 5»'] = p.summary.startsWith('Всего 5');
    const groups = [...new Set(p.items.map((t) => t.group))];
    marks['группы: Голубев, Ваши дела, Без адресата — последняя'] = item(Q.nb1).group.startsWith('Голубев')
      && item(Q.nb2).group.startsWith('Ваши дела') && item(Q.bt7a).group.startsWith('Без адресата')
      && groups.length === 3 && groups[2].startsWith('Без адресата');
    marks['уточнение из скобок — в сути'] = has(item(Q.nb2).line, 'сверить с актом');
    marks['источник коротко'] = has(item(Q.bt7a).line, 'БТ INV-7 п.1') && has(item(Q.nb1).line, '2026-11-10 №1.1')
      && !p.items.some((t) => has(t.line, 'coddoc/') || has(t.line, 'notebook.md'));
    marks['закрытое не взято'] = !taskWith(p, Q.nbClosed);
  } else if (probe.id === 'p-split' || probe.id === 'p-merge') {
    const asked = run.answers[2] ?? '';
    marks['спросил разбивку до записи'] = Object.keys(run.snaps[2] ?? {}).length === 0 && asked.includes('INV-7') && asked.includes('INV-9');
    marks['спросил цель до записи'] = Object.keys(run.snaps[3] ?? {}).length === 0 && goalIs(run.answers[3] ?? '', 'к оценке');
    marks['без лишнего вопроса'] = run.snaps.length === 5;
    if (probe.id === 'p-split') {
      const p7 = parsePlan(last[PLAN7]), p9 = parsePlan(last[PLAN9]);
      marks['два файла'] = !!last[PLAN7] && !!last[PLAN9] && Object.keys(last).length === 2;
      marks['цель — гипотеза у обоих'] = goalIs(p7.goal, 'к оценке') && goalIs(p9.goal, 'к оценке')
        && !goalIs(p7.goal, 'разработк') && !goalIs(p9.goal, 'ноут');
      marks['INV-7: БТ и 2 дела'] = p7.docs.length === 1 && has(p7.docs[0], BT7) && p7.tasks.length === 2
        && !!taskWith(p7, Q.bt7a) && !!taskWith(p7, Q.bt7b);
      marks['INV-9: БТ и 1 дело'] = p9.docs.length === 1 && has(p9.docs[0], BT9) && p9.tasks.length === 1 && !!taskWith(p9, Q.bt9);
    } else {
      const p = parsePlan(last[PLAN_ALL]);
      marks['один файл Склад.md'] = Object.keys(last).join() === PLAN_ALL;
      marks['цель — своя, как сказано'] = goalIs(p.goal, GOAL_OWN.toLowerCase());
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
    marks['отчёт: закрылось'] = said.includes('кладовщик') && (said.includes('утверждает списание') || said.includes('50 000'));
    marks['отчёт: «добавь»'] = run.answer.includes('/work-plan INV-7 добавь');
    // План был в форме 1.2.0 (дело — одна строка): переписан в 1.3.0, и оставшееся дело не названо закрытым или новым
    // («осталось: …» — можно).
    marks['переписан в новую форму'] = p.items.length === 2 && p.items.every((t) => t.group && t.quote);
    // По предложениям: «…закрылся …, появился … . Вопрос про гарантию остался.» — одна строка, но гарантия названа
    // оставшейся. Конец предложения — «.» или «;» перед пробелом или в конце: точки в путях и датах не режут.
    marks['оставшееся — не «закрылось» и не «появилось»'] = !said.split(/\n|[.;](?=\s|$)/)
      .some((l) => /закрыл|появил/.test(l) && l.includes('гаранти'));
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
    'Цель плана — «1 БТ готов к оценке, 1 спека готова к разработке, 1 ноут без открытых вопросов»? Или напиши свою.'],
  intact: true, loaded: true };
  const okSplit = { ...ok, answers: [...ok.answers.slice(0, 2),
    'Найдено 2 инициативы: INV-7, INV-9. По плану на инициативу или все в один план — под каким именем?',
    'Цель плана — «1 БТ готов к оценке»? Или напиши свою.'] };
  const plan = (goal, docs, tasks, main = BASE) => `# План: x\n\nобновлён: ${TODAY}\n${main ? `главная: ${main}\n` : ''}цель: ${goal}\n\n` +
    `## Документы\n${docs.map((d) => `- ${d}\n`).join('')}\n## Дела\n` + tasks.map((t, i) => `${i + 1}. ${t}\n`).join('');
  // Форма 1.3.0: groups — [[группа, [[суть · откуда, оригинал], …]], …].
  const plan13 = (goal, docs, groups) => {
    let k = 0;
    const n = groups.reduce((a, [, items]) => a + items.length, 0);
    return `# План: x\n\nобновлён: ${TODAY}\nглавная: ${BASE}\nцель: ${goal}\n\n## Документы\n${docs.map((d) => `- ${d}\n`).join('')}\n` +
      `## Дела\nВсего ${n}: ${groups.map(([g, items]) => `${g} — ${items.length}`).join(' · ')}\n\n` +
      groups.map(([g, items]) => `### ${g} — ${items.length}\n` + items.map(([line, quote]) => `${++k}. ${line}\n   > ${quote}\n`).join('')).join('\n');
  };
  const create = plan13('1 БТ готов к оценке, 1 спека готова к разработке, 1 ноут без открытых вопросов', [`${BT7} · feature/inv-7 · открытых: 2`, `${SPEC7} · рабочая копия · открытых: 1`, `${NB} · ${BASE} · открытых: 2`], [
    ['Голубев А.', [[`Списывать ли запчасть при действующей гарантии · списание-запчастей 2026-11-10 №1.1`, Q.nb1]]],
    ['Ваши дела', [[`Проверить, нужна ли подпись кладовщика (сверить с актом формы) · списание-запчастей 2026-11-10 №1.2`, Q.nb2]]],
    ['Без адресата', [[`Кто утверждает списание дороже 50 000 ₽ · БТ INV-7 п.1`, `${Q.bt7a} — не назван.`],
      [`Срок хранения списанных запчастей · БТ INV-7 п.2`, `${Q.bt7b} — не назван.`],
      [`Какой сервис хранит фото · спека INV-7 п.1`, `❓ TBD: ${Q.spec7}.`]]]]);
  check('создание, хороший', grade(P('p-create'), { ...ok, snaps: [{}, {}, {}, { [PLAN7]: create }] }), true);
  const badCreate = plan('БТ', [`${BT7}`, `${BT9}`], [`${Q.nbClosed} — ждём: Голубев`, 'Кто утверждает списание'], '')
    .replace(`обновлён: ${TODAY}`, 'обновлён: 2026-11-12');
  const bad = { cmds: ['git checkout main', 'git log --all'], answer: 'Готово.',
    answers: ['Готово.', '1. INV-3 · coddoc/INV-3/…', 'Готово.', 'Готово.'], intact: false, loaded: false };
  const many = { [PLAN7]: badCreate, [PLAN9]: 'x' };
  checkBad('создание, плохой', [
    grade(P('p-create'), { ...bad, snaps: [{ [PLAN7]: badCreate }, many, many, many, many] }),
    grade(P('p-create'), { ...bad, snaps: [{}, {}] })]);
  const g7 = plan('1 БТ готов к оценке', [`${BT7} · feature/inv-7 · открытых: 2`], [`${Q.bt7a} — не назван.`, `${Q.bt7b} — не назван.`]);
  const g9 = plan('1 БТ готов к оценке', [`${BT9} · feature/inv-9 · открытых: 1`], [`${Q.bt9} — не подтверждено.`]);
  check('разбивка, хороший', grade(P('p-split'), { ...okSplit, snaps: [{}, {}, {}, {}, { [PLAN7]: g7, [PLAN9]: g9 }] }), true);
  checkBad('разбивка, плохой', [grade(P('p-split'), { ...bad, snaps: [{ [PLAN7]: create }, { [PLAN7]: create }] }),
    grade(P('p-split'), { ...bad, snaps: [{}, {}, {}, {}, { [PLAN7]: badCreate }] })]);
  const all = plan(GOAL_OWN, [`${BT7} · feature/inv-7 · открытых: 2`, `${BT9} · feature/inv-9 · открытых: 1`],
    [`${Q.bt7a} — не назван.`, `${Q.bt7b} — не назван.`, `${Q.bt9} — не подтверждено.`]);
  check('в один, хороший', grade(P('p-merge'), { ...okSplit, snaps: [{}, {}, {}, {}, { [PLAN_ALL]: all }] }), true);
  checkBad('в один, плохой', [grade(P('p-merge'), { ...bad, snaps: [{ [PLAN7]: create }, { [PLAN7]: create }] }),
    grade(P('p-merge'), { ...bad, snaps: [{}, {}, {}, {}, { [PLAN_ALL]: badCreate }] })]);
  const rerun = plan13(GOAL_RERUN, [`${NB} · рабочая копия · открытых: 2`], [
    ['Голубев А.', [[`Списывать ли при гарантии · списание-запчастей 2026-11-10 №1.1`, Q.nb1]]],
    ['Сидоров П.', [[`Кто забирает списанное · списание-запчастей 2026-11-17 №1.2`, Q.nbNew]]]]);
  const answer = `Закрылось: ${Q.bt7a}; ${Q.bt7b}; ${Q.nb2}. Появилось: ${Q.nbNew}. Ещё 2 документа — добавить: /work-plan INV-7 добавь`;
  check('повтор, хороший', grade(P('p-rerun'), { ...ok, answer, snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: rerun }] }), true);
  const answerOneLine = `Убран БТ ${BT7} — его дела закрылись: «${Q.bt7a}» и «${Q.bt7b}». Ноут обновился: вопрос о подписи ` +
    `кладовщика закрылся, появился новый вопрос «${Q.nbNew}». Вопрос про гарантию остался. Ещё 2 документа — добавить: /work-plan INV-7 добавь`;
  check('повтор, хороший — всё одной строкой', grade(P('p-rerun'), { ...ok, answer: answerOneLine,
    snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: rerun }] }), true);
  // Пара к нему: гарантия названа закрытой в той же строке, рядом путь с точками — красный.
  const keptMark = 'оставшееся — не «закрылось» и не «появилось»';
  const closedOneLine = answerOneLine.replace('Вопрос про гарантию остался.', `Ноут ${NB} от 2026-11-20: вопрос про гарантию закрылся.`);
  if (grade(P('p-rerun'), { ...ok, answer: closedOneLine, snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: rerun }] })[keptMark] !== false) {
    fails++; console.log(`  ✗ повтор, плохой — гарантия «закрылась» одной строкой: «${keptMark}» не пойман`);
  }
  const badRerun = plan('БТ и спека влиты', [`${BT7} · feature/inv-7 · открытых: 0`, `${SPEC7} · рабочая копия · открытых: 1`],
    [`${Q.nb2} — ждём: —`], '').replace(`обновлён: ${TODAY}`, 'обновлён: 2026-11-12');
  checkBad('повтор, плохой', [
    grade(P('p-rerun'), { ...bad, snaps: [{ [PLAN7]: badRerun }, { [PLAN7]: badRerun }, { [PLAN7]: badRerun, x: '' }] }),
    grade(P('p-rerun'), { ...bad, answer: `Появилось: ${Q.nb1}. Ещё 3 документа: INV-3 …`, snaps: [{ [PLAN7]: PLAN_RERUN }, { [PLAN7]: PLAN_RERUN }] })]);

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
  // 1.5.0: план с датами, быстрый путь, выборочное обновление, слежка.
  const dl = [`${BT7} · feature/inv-7 · 2026-11-12 10:00 · открытых: 2`, `${BT9} · feature/inv-9 · 2026-11-13 10:00 · открытых: 1`,
    `${SPEC7} · рабочая копия · 2026-11-14 09:00 · открытых: 1`, `${NB} · origin/dev · 2026-11-10 10:00 · открытых: 2`];
  const PD = datedPlan(dl);
  const peekUse = { name: 'Bash', input: { command: 'python .claude/skills/work-plan/../peek/reference/peek.py --list --base dev' } };
  const readPlan = { name: 'Read', input: { file_path: 'C:\\box\\me\\.coddoc-tmp\\work-plan\\Склад.md' } };
  const readCopy = (d) => ({ name: 'Read', input: { file_path: `C:\\box\\me\\.coddoc-tmp\\peek\\list\\${d.replace(/\//g, '\\')}` } });
  const okD = { ...ok, initial: { [PLAN_ALL]: PD } };
  const badD = { ...bad, initial: { [PLAN_ALL]: PD } };
  const gone = 'По coddoc/INV-9/business_requirements.md (INV-9) открытых вопросов в работе больше нет. Закончили с ним или следим дальше?';
  check('без изменений, хороший', grade(P('p-same'), { ...okD, answer: 'План Склад: без изменений с 2026-11-19',
    turns: [[peekUse, readPlan]], snaps: [{ [PLAN_ALL]: PD }] }), true);
  checkBad('без изменений, плохой', [grade(P('p-same'), { ...badD, answer: 'План обновлён.\nДел 6.\nЗакрылось: —',
    turns: [[peekUse, readPlan, readCopy(BT9)]], snaps: [{ [PLAN_ALL]: PD + 'x' }] })]);
  const one = datedPlan([`${BT7} · feature/inv-7 · 2026-11-19 15:00 · открытых: 3`, ...dl.slice(1)], TODAY,
    [...BT7_ITEMS, [`Кто подписывает акт · БТ INV-7 п.3`, `${Q.bt7c} — не назван.`]]);
  check('изменился один, хороший', grade(P('p-one'), { ...okD, answer: `Появилось: ${Q.bt7c} — не назван.`,
    turns: [[peekUse, readPlan, readCopy(BT7)]], snaps: [{ [PLAN_ALL]: one }] }), true);
  const oneBad = datedPlan([dl[0], dl[1].replace('10:00', '11:00'), ...dl.slice(2)], '2026-01-01', [BT7_ITEMS[0]])
    .replace(HAND, 'Списывать ли при гарантии').replace(GOAL_OWN, 'БТ');
  checkBad('изменился один, плохой', [grade(P('p-one'), { ...badD, answer: 'План обновлён.',
    turns: [[peekUse, ...DATED_DOCS.map(readCopy)]], snaps: [{ [PLAN_ALL]: oneBad }] })]);
  check('пропал документ, хороший', grade(P('p-gone'), { ...okD, answers: [gone], snaps: [{ [PLAN_ALL]: PD }] }), true);
  checkBad('пропал документ, плохой', [grade(P('p-gone'), { ...badD, answers: ['План обновлён, INV-9 убран.'], snaps: [{ [PLAN_ALL]: PD + 'x' }] })]);
  check('висящий вопрос, хороший', grade(P('p-pending'), { ...okD, answers: [gone, gone], snaps: [{ [PLAN_ALL]: PD }, { [PLAN_ALL]: PD }] }), true);
  checkBad('висящий вопрос, плохой', [grade(P('p-pending'), { ...badD, answers: ['План обновлён.', 'Убрал INV-9.'],
    snaps: [{ [PLAN_ALL]: PD }, { [PLAN_ALL]: PD + 'x' }] })]);
  const make = (cron, prompt = '/work-plan Склад', result = 'Scheduled recurring job 6979cba8 (Every 10 minutes).') =>
    ({ name: 'CronCreate', input: { cron, prompt, recurring: true }, result });
  const list = { name: 'CronList', input: {} };
  const follow1 = 'План Склад: без изменений с 2026-11-19\nСлежу за планом Склад каждые 10 минут, пока открыта эта сессия; ' +
    'после перезапуска — снова /work-plan следи. Остановить — /work-plan стоп';
  check('следи, хороший', grade(P('p-follow'), { ...okD, answers: [follow1, 'Уже слежу за планом Склад. Остановить — /work-plan стоп'],
    turns: [[peekUse, readPlan, list, make('*/10 * * * *')], [peekUse, list]], snaps: [{ [PLAN_ALL]: PD }] }), true);
  checkBad('следи, плохой', [grade(P('p-follow'), { ...badD, answers: ['Готово.', 'Слежу за планом.'],
    turns: [[make('*/5 * * * *', '/work-plan'), list], [make('*/10 * * * *')]], snaps: [{ [PLAN_ALL]: PD + 'x' }] })]);
  check('стоп, хороший', grade(P('p-stop'), { ...okD, answers: [follow1, 'Слежка за планом Склад снята'],
    turns: [[peekUse, list, make('*/10 * * * *')], [list, { name: 'CronDelete', input: { id: '6979cba8' } }]], snaps: [{ [PLAN_ALL]: PD }] }), true);
  checkBad('стоп, плохой', [grade(P('p-stop'), { ...badD, answers: ['', 'Готово.'],
    turns: [[make('*/10 * * * *', '/work-plan x'), make('*/10 * * * *')], [{ name: 'CronDelete', input: { id: 'deadbeef' } }, make('*/10 * * * *')]],
    snaps: [{ [PLAN_ALL]: PD }] })]);
  check('следи с настройкой, хороший', grade(P('p-follow-set'), { ...okD, answer: follow1.replace('10 минут', '15 минут'),
    turns: [[peekUse, list, make('*/15 * * * *')]], snaps: [{ [PLAN_ALL]: PD }] }), true);
  checkBad('следи с настройкой, плохой', [grade(P('p-follow-set'), { ...badD, answer: follow1,
    turns: [[make('*/10 * * * *')]], snaps: [{ [PLAN_ALL]: PD + 'x' }] })]);
  const s3dl = [dl[0], dl[2], dl[3]];
  const S3 = step3Plan(s3dl);
  const s3Good = planText({ name: 'INV-7', updated: TODAY, goal: GOAL_RERUN,
    docs: [...s3dl, `${CR7} · feature/inv-7-cr · 2026-11-19 11:00 · открытых: 2`],
    groups: [datedGroups(BT7_ITEMS, [])[0], datedGroups(BT7_ITEMS, [])[1],
      ['Без адресата', [...datedGroups(BT7_ITEMS, [])[2][1], [`С какой даты новый лимит · запрос на правку INV-7 п.1`, `${Q.cr1}`],
        [`Лимит на расходники · запрос на правку INV-7 п.2`, `${Q.cr2}`]]]] });
  check('Шаг 3 в существующий план, хороший', grade(P('p-step3'), { ...ok, initial: { [PLAN7]: S3 },
    answer: 'План INV-7 обновлён: 4 документа, 7 дел. Появилось: …', snaps: [{}, {}, {}, { [PLAN7]: s3Good }] }), true);
  checkBad('Шаг 3 в существующий план, плохой', [
    grade(P('p-step3'), { ...bad, initial: { [PLAN7]: S3 }, answer: 'План INV-7: без изменений с 2026-11-19', snaps: [{ [PLAN7]: S3 }] }),
    grade(P('p-step3'), { ...bad, initial: { [PLAN7]: S3 }, answer: 'Готово.', snaps: [{ [PLAN7]: S3, x: '' }] }),
    grade(P('p-step3'), { ...bad, initial: { [PLAN7]: S3 }, answer: 'Готово.',
      snaps: [{ [PLAN7]: planText({ name: 'INV-7', updated: '2026-01-01', goal: 'БТ', docs: [`${CR7} · x`, ...s3dl, `${BT9} · y`],
        groups: [['Без адресата', [[`x · y`, Q.bt7a]]]] }).replace(HAND, '') }] })]);
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

// Все ходы — одним процессом: сообщения пользователя строками stream-json в stdin (задачи cron живут, пока жив процесс).
function runClaudeStream(cwd, texts, model, out, file) {
  return new Promise((done) => {
    const p = spawn('bash', ['-c', 'claude -p --input-format stream-json --model "$PROBE_MODEL" --permission-mode bypassPermissions --output-format stream-json --verbose'],
      { cwd, env: { ...process.env, PROBE_MODEL: model, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.stdin.end(texts.map((t) => JSON.stringify({ type: 'user', message: { role: 'user', content: t } })).join('\n') + '\n');
    const timer = setTimeout(() => p.kill(), 1_200_000);
    p.on('close', (code) => { clearTimeout(timer); writeFileSync(join(out, file), stdout); writeFileSync(join(out, `_stderr-${file}.log`), stderr); done(code); });
  });
}

/** Вызовы инструментов ведущего по ходам (ход кончается событием result), у каждого — текст результата. */
function turnsOf(ev) {
  const results = {};
  for (const e of ev) if (e.type === 'user') for (const c of e.message?.content ?? []) {
    if (c.type === 'tool_result') results[c.tool_use_id] = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
  }
  const turns = [[]];
  for (const e of ev) {
    if (e.type === 'result') { turns.push([]); continue; }
    if (e.type !== 'assistant' || e.parent_tool_use_id) continue;
    for (const c of e.message?.content ?? []) if (c.type === 'tool_use') turns[turns.length - 1].push({ name: c.name, input: c.input ?? {}, result: results[c.id] ?? '' });
  }
  if (!turns[turns.length - 1].length) turns.pop();
  return turns;
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
      job.snaps = []; job.codes = []; job.initial = plans(me);
      const replies = job.probe.stream ? [] : [...job.probe.turns, job.probe.fallback].map(turnOf);
      if (job.probe.stream) {
        job.codes.push(await runClaudeStream(me, job.probe.turns, model, out, 'stream-1.jsonl'));
        job.snaps.push(plans(me));
      }
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
      const marks = grade(probe, { cmds, snaps: job.snaps, answer, answers, intact: job.intact, loaded, initial: job.initial, turns: turnsOf(ev) });
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
