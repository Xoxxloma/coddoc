#!/usr/bin/env node
// grade-sm-listmonk.mjs <раунд> [<раунд> …] — грейдер фикстуры SM-LISTMONK (fixtures/SM-LISTMONK/KEY.md): карточка
// listmonk (Go, echo, Postgres без ORM) на настоящем коде. Покрытие ручек (`routes.tsv`), выдуманные пути, таблицы
// (справочно), задачи, опорные факты L1–L14. Раунд — папка run-sm-mono.sh. Грейдит файл карточки, а не отчёт.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FX = path.join(HERE, 'fixtures', 'SM-LISTMONK');
const norm = (p) => p.replace(/\{[^}]*\}|:[A-Za-z_]\w*|\*/g, '{}').replace(/\/+$/, '').toLowerCase() || '/';
const keyOf = (m, p) => `${m.toUpperCase()} ${norm(p)}`;
const ROUTES = fs.readFileSync(path.join(FX, 'routes.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split('\t'));
const ALL = new Map(ROUTES.map(([m, p]) => [keyOf(m, p), p]));
const part = (p) => (p.startsWith('/api/') ? 'api' : p.startsWith('/admin') ? 'admin' : 'pub');
const TOTAL = { api: 0, admin: 0, pub: 0 }; for (const [, p] of ALL) TOTAL[part(p)]++;
const TABLES = ['subscribers', 'lists', 'subscriber_lists', 'templates', 'campaigns', 'campaign_lists', 'campaign_views', 'media',
  'campaign_media', 'links', 'link_clicks', 'settings', 'bounces', 'roles', 'users', 'sessions'];
const tnorm = (s) => s.toLowerCase().replace(/[_`\s]/g, '').replace(/s$/, '');

function sections(md) {
  const out = {}; let cur = null;
  for (const l of md.split(/\r?\n/)) {
    const m = l.match(/^## (.+?)\s*$/);
    if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur) out[cur].push(l);
  }
  return out;
}
const sec = (S, name) => { const k = Object.keys(S).find((x) => x.startsWith(name)); return k ? S[k] : []; };
const blocks = (lines) => {
  const out = []; let cur = null;
  for (const l of lines) { if (/^### /.test(l)) { cur = { head: l.slice(4).replace(/`/g, '').trim(), body: [] }; out.push(cur); continue; } if (cur) cur.body.push(l); }
  return out.map((b) => ({ head: b.head, text: b.head + '\n' + b.body.join('\n') }));
};
const rows = (lines) => {
  const t = lines.filter((l) => /^\|/.test(l));
  return t.filter((l, i) => !/^\|[\s:|-]+\|\s*$/.test(l) && !(i + 1 < t.length && /^\|[\s:|-]+\|\s*$/.test(t[i + 1])));
};
const VERBS = ['посмотреть', 'смотреть', 'сохранить', 'отправить', 'подтвердить', 'вернуть', 'отклонить', 'запросить', 'открыть',
  'выгрузить', 'скачать', 'добавить', 'создать', 'удалить', 'назначить', 'изменить', 'найти', 'показать', 'включить', 'выключить',
  'сравнить', 'опубликовать', 'получить', 'загрузить', 'импортировать', 'экспортировать', 'заблокировать', 'разблокировать',
  'разослать', 'запустить', 'остановить', 'приостановить', 'подписать', 'отписать', 'подписаться', 'отписаться', 'стереть',
  'настроить', 'проверить', 'войти', 'выйти', 'очистить', 'переименовать', 'скопировать'];
const glued = (row) => {
  const words = ((row.split('|')[1] || '').toLowerCase().replace(/ё/g, 'е').match(/[а-я]+/g)) || [];
  return new Set(words.filter((w) => VERBS.includes(w))).size >= 2;
};

function grade(md) {
  const S = sections(md);
  const r = {};
  const cb = blocks(sec(S, 'Публичный контракт'));
  const hit = new Set(), alien = []; let nometh = 0;
  for (const b of cb) {
    const m = b.head.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)/i);
    if (!m) { nometh++; continue; }
    const k = keyOf(m[1], m[2]);
    if (ALL.has(k)) hit.add(k); else alien.push(b.head);
  }
  const by = { api: 0, admin: 0, pub: 0 }; for (const k of hit) by[part(ALL.get(k))]++;
  r['блоков контракта'] = cb.length;
  r[`ручки (из ${ALL.size})`] = hit.size;
  r[`  из них /api (из ${TOTAL.api}) / /admin (из ${TOTAL.admin}) / публичные (из ${TOTAL.pub})`] = `${by.api} / ${by.admin} / ${by.pub}`;
  r['блоков с путём не из ручек (выдумка — смотреть глазами)'] = alien.length + (alien.length ? ' — например: ' + alien.slice(0, 4).join(' | ') : '');
  r['блоков без метода и пути'] = nometh;
  const ent = blocks(sec(S, 'Владеет данными')).map((b) => tnorm(b.head.split(/[\s—]/)[0]));
  r['справочно: таблицы во «Владеет данными» (из 16)'] = TABLES.filter((t) => ent.includes(tnorm(t))).length;
  const jobs = sec(S, 'Фоновые задачи').join('\n');
  r['задача: сканер кампаний'] = /scanCampaigns|manager|кампани/i.test(jobs);
  r['задача: ящик отказов POP3'] = /pop3?|ящик|bounce|отказ/i.test(jobs);
  r['задача: кэш медленных запросов'] = /slow|медленн/i.test(jobs);
  r['задача: VACUUM'] = /vacuum/i.test(jobs);
  r['задача: проверка обновлений'] = /update|обновлен/i.test(jobs);
  r['задача: чистка временных токенов'] = /tmptoken|временн[а-яё]* токен|2fa|сброс[а-яё]* парол/i.test(jobs);
  const dep = sec(S, 'Зависит от').join('\n');
  const roles = sec(S, 'Роли и доступ').join('\n');
  const L = md.split(/\r?\n/);
  const blockWith = (re) => cb.filter((b) => re.test(b.head)).map((b) => b.text).join('\n');
  r['L1 вход: cookie/сессия и токен в заголовке'] = /cookie|сесси/i.test(roles) && /authorization|токен|token/i.test(roles);
  r['L2 OIDC'] = /oidc|openid/i.test(dep + roles);
  r['L3 2FA / TOTP'] = /2fa|totp|двухфактор|одноразов[а-яё]* код/i.test(md);
  r['L4 роли списков (второй набор)'] = /рол[а-яё]* списк|list.?role|роли на списк/i.test(roles);
  r['L5 порог отказов и действия'] = /bounce\.actions|после\s+\S+\s+отказ|порог[а-яё]*[^|]{0,40}отказ|отказ[а-яё]*[^|]{0,80}(блок|удал|отпис)/i.test(md);
  r['L6 ящик POP3 и сервисы отказов в «Зависит от»'] = /pop3?|почтов[а-яё]* ящик/i.test(dep) && /\bses\b|sendgrid|postmark|forward ?email|azure|lettermint|вебхук[а-яё]* отказ|сервис[а-яё]* отказ/i.test(dep);
  r['L7 SMTP и HTTP-postback в «Зависит от»'] = /smtp/i.test(dep) && /postback|http[- ]мессенджер|мессенджер[а-яё]* http|вебхук/i.test(dep);
  r['L8 S3'] = /\bS3\b/.test(md);
  r['L9 сервер обновлений'] = /update\.listmonk\.app|сервер[а-яё]* обновлен|провер[а-яё]* обновлен/i.test(md);
  r['L10 лимиты скорости рассылки'] = /message_rate|sliding_window|скользящ|скорост[а-яё]* (рассыл|отправ)|писем в секунду|concurrency|параллельн/i.test(md);
  r['L11 кампании раз в 5 с'] = /(каждые|раз в|интервал[а-яё]*)\s*5\s*(с(?![а-яё])|сек|s\b)|5\s*секунд/i.test(md);
  r['L12 выгрузка и стирание — по настройке'] = /allow_(export|wipe)|разреш|настройк|privacy|включ|запрещ/i.test(blockWith(/\/subscription\/(export|wipe)/i));
  r['L13 архив — по настройке'] = /enable_?public_?archive|архив[а-яё]* (включ|выключ)|настройк|при включ|если включ/i.test(blockWith(/\/archive|\/api\/public\/archive/i));
  r['L14 справочно: чистка сессий один раз'] = L.some((l, i) => /prune|чистк[а-яё]* сесси|сесси[а-яё]*[^|]{0,30}(чист|удал)/i.test(l) && L.slice(i, i + 3).some((x) => /один раз|однократн|не повторя|без цикла|только при старт/i.test(x)));
  const can = rows(sec(S, 'Что умеет'));
  r['«Что умеет»: строк'] = can.length;
  r['«Что умеет»: склеенных'] = can.filter(glued).length;
  return r;
}

for (const round of process.argv.slice(2)) {
  const meta = JSON.parse(fs.readFileSync(path.join(round, '_mono.json'), 'utf8'));
  const skill = fs.existsSync(path.join(round, '_skills', 'service-map', 'SKILL.md'))
    ? (fs.readFileSync(path.join(round, '_skills', 'service-map', 'SKILL.md'), 'utf8').match(/^version:\s*(\S+)/m) || [, '?'])[1] : '?';
  const sb = path.join(round, 'sandbox');
  const runs = fs.existsSync(sb) ? fs.readdirSync(sb).filter((d) => /^mono-\d+$/.test(d)).sort() : [];
  console.log(`\nSM-LISTMONK: ${path.basename(round)} — скилл ${skill}, модель ${meta.model}, прогонов ${runs.length}`);
  for (const d of runs) {
    const card = path.join(sb, d, 'w', 'AI-SDD', 'services', 'listmonk.md');
    const cost = fs.existsSync(path.join(sb, d, '_cost.txt')) ? fs.readFileSync(path.join(sb, d, '_cost.txt'), 'utf8').trim() : '?';
    if (!fs.existsSync(card)) { console.log(`  ${d}: карточки нет (${fs.existsSync(path.join(sb, d, '_api-failure.txt')) ? 'отказ API — не измерено' : 'прогон не записал'})`); continue; }
    console.log(`  ${d} (стоимость ${cost}):`);
    for (const [k, v] of Object.entries(grade(fs.readFileSync(card, 'utf8')))) console.log(`    ${k}: ${v === true ? 'да' : v === false ? 'нет' : v}`);
  }
}
