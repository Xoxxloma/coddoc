#!/usr/bin/env node
// grade-sm-vikunja.mjs <раунд> [<раунд> …] — грейдер фикстуры SM-VIKUNJA (fixtures/SM-VIKUNJA/KEY.md): карточка
// vikunja-frontend (Vue 3 + TS) на настоящем коде. Экраны (`routes.tsv`), вызовы API (`api-calls.tsv`, эталон
// приблизительный), опорные факты V1–V12. Раунд — папка run-sm-mono.sh. Грейдит файл карточки, а не отчёт.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FX = path.join(HERE, 'fixtures', 'SM-VIKUNJA');
// имя роута в скобках после пути (`/projects/:id/settings/edit (project.settings.edit)`) — не часть пути; ведущий `/`
// у вызова не дописывается — его отсутствие должно быть видно
const np = (p) => p.replace(/`/g, '').trim().replace(/\s+\([^)]*\)\s*$/, '').replace(/\$\{[^}]*\}|\{[^}]*\}|:[A-Za-z_]\w*(\([^)]*\))?\*?/g, '{}').replace(/\?.*$/, '').replace(/\/+$/, '').toLowerCase() || '/';
const tsv = (f) => fs.readFileSync(path.join(FX, f), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split('\t'));
const SCREENS = new Set(tsv('routes.tsv').map(([p]) => p).filter((p) => !/pathMatch/.test(p)).map(np));
const CALLS = new Set(tsv('api-calls.tsv').map(([m, p]) => `${m} ${np(p)}`));

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
const rows = (lines) => {
  const t = lines.filter((l) => /^\|/.test(l));
  return t.filter((l, i) => !/^\|[\s:|-]+\|\s*$/.test(l) && !(i + 1 < t.length && /^\|[\s:|-]+\|\s*$/.test(t[i + 1])));
};
const cell = (row, i) => (row.split('|')[i] || '').trim();
const VERBS = ['посмотреть', 'смотреть', 'сохранить', 'отправить', 'подтвердить', 'вернуть', 'открыть', 'выгрузить', 'скачать',
  'добавить', 'создать', 'удалить', 'назначить', 'изменить', 'найти', 'показать', 'включить', 'выключить', 'сравнить',
  'получить', 'загрузить', 'импортировать', 'экспортировать', 'перенести', 'переместить', 'архивировать', 'поделиться',
  'отметить', 'закрыть', 'настроить', 'войти', 'выйти', 'зарегистрироваться', 'сбросить', 'переименовать', 'скопировать', 'дублировать'];
const glued = (row) => {
  const words = ((row.split('|')[1] || '').toLowerCase().replace(/ё/g, 'е').match(/[а-я]+/g)) || [];
  return new Set(words.filter((w) => VERBS.includes(w))).size >= 2;
};

function grade(md) {
  const S = sections(md);
  const r = {};
  const scr = rows(sec(S, 'Экраны')).map((x) => cell(x, 1));
  const shit = new Set(), salien = [];
  for (const s of scr) { const k = np(s); if (SCREENS.has(k)) shit.add(k); else if (s && s !== '—') salien.push(s); }
  r['строк «Экранов»'] = scr.length;
  r[`экраны из роутера (из ${SCREENS.size})`] = shit.size;
  r['строк «Экранов» не из роутера (точка встраивания или выдумка — смотреть глазами)'] = salien.length + (salien.length ? ' — например: ' + salien.slice(0, 4).join(' | ') : '');
  const api = rows(sec(S, 'Потребляемые API'));
  const chit = new Set(), calien = [];
  for (const a of api) {
    const m = cell(a, 2).replace(/`/g, '').match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
    if (!m) continue;
    let p = m[2].replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '');
    const k = `${m[1].toUpperCase()} ${np(p)}`;
    if (CALLS.has(k)) chit.add(k); else calien.push(`${m[1]} ${m[2]}`);
  }
  r['строк «Потребляемых API»'] = api.length;
  r[`вызовы из эталона (из ${CALLS.size}, эталон приблизительный)`] = chit.size;
  r['вызовы не из эталона (смотреть глазами)'] = calien.length + (calien.length ? ' — например: ' + calien.slice(0, 4).join(' | ') : '');
  const dep = sec(S, 'Зависит от').join('\n');
  const roles = sec(S, 'Роли и доступ').join('\n');
  r['API vikunja в «Зависит от»'] = /vikunja/i.test(dep);
  r['V1 вход: токен в заголовке'] = /bearer|authorization|jwt|токен/i.test(roles);
  r['V2 продление токена'] = /продле|renew|обновлен[а-яё]* токен|обновля[а-яё]* токен/i.test(md);
  r['V3 вход по ссылке-шаре'] = /share|шар[аеуыо]|ссылк/i.test(roles);
  r['V4 OpenID'] = /openid|oidc/i.test(md);
  r['V5 три уровня прав'] = /(чтени|read)/i.test(roles) && /(запис|write)/i.test(roles) && /(админ|admin)/i.test(roles);
  // вне «Потребляемых API»: путь вызова с `/api/v1` — не про настройку адреса
  const noApi = Object.entries(S).filter(([k]) => !k.startsWith('Потребляемые API')).map(([, v]) => v.join('\n')).join('\n');
  r['V6 адрес API в конфигурации'] = /API_URL|адрес[а-яё]* (сервера )?API|URL API|api\/v1/i.test(noApi);
  r['V7 опрос уведомлений раз в 10 с'] = /10\s*(с(?![а-яё])|сек|s\b)|10 секунд/i.test(md) && /уведомл|notification/i.test(md);
  r['V8 импорт: Todoist / Trello / Microsoft'] = /todoist|trello|microsoft/i.test(dep);
  r['V9 Sentry'] = /sentry/i.test(md);
  r['V10 флаги сервера из /info'] = /\/info\b|флаг[а-яё]*[^|]{0,30}сервер|сервер[а-яё]*[^|]{0,40}(включ|выключ|разреш)/i.test(md);
  r['V11 Unsplash'] = /unsplash/i.test(md);
  r['V12 TOTP / 2FA'] = /totp|2fa|двухфактор/i.test(md);
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
  console.log(`\nSM-VIKUNJA: ${path.basename(round)} — скилл ${skill}, модель ${meta.model}, прогонов ${runs.length}`);
  for (const d of runs) {
    const card = path.join(sb, d, 'w', 'AI-SDD', 'services', 'vikunja-frontend.md');
    const cost = fs.existsSync(path.join(sb, d, '_cost.txt')) ? fs.readFileSync(path.join(sb, d, '_cost.txt'), 'utf8').trim() : '?';
    if (!fs.existsSync(card)) { console.log(`  ${d}: карточки нет (${fs.existsSync(path.join(sb, d, '_api-failure.txt')) ? 'отказ API — не измерено' : 'прогон не записал'})`); continue; }
    console.log(`  ${d} (стоимость ${cost}):`);
    for (const [k, v] of Object.entries(grade(fs.readFileSync(card, 'utf8')))) console.log(`    ${k}: ${v === true ? 'да' : v === false ? 'нет' : v}`);
  }
}
