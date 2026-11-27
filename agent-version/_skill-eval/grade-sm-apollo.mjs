#!/usr/bin/env node
// grade-sm-apollo.mjs <раунд> [<раунд> …] — грейдер фикстуры SM-APOLLO (fixtures/SM-APOLLO/KEY.md): карточка
// apollo-portal на настоящем коде. Покрытие ключей (внутренние ручки, внешний OpenAPI v1, сущности, задачи),
// выдуманные пути, опорные факты A1–A14. Раунд — папка run-sm-mono.sh. Грейдит файл карточки, а не отчёт.
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const FX = path.join(HERE, 'fixtures', 'SM-APOLLO');
const norm = (p) => p.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '').toLowerCase();
const keyOf = (m, p) => `${m.toUpperCase()} ${norm(p)}`;
const tsv = (f) => fs.readFileSync(path.join(FX, f), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const REST = new Set(tsv('portal-rest.tsv').map(([m, p]) => keyOf(m, p)));
const OPS = tsv('openapi-ops.tsv');
const V1 = new Set(OPS.map(([m, p]) => keyOf(m, p)));
const OPIDS = OPS.map(([, , id]) => id);
const ENTITIES = ['Consumer', 'ConsumerAudit', 'ConsumerRole', 'ConsumerToken', 'Authority', 'Favorite', 'Permission',
  'Role', 'RolePermission', 'ServerConfig', 'UserPO', 'UserRole', 'UserToken', 'UserTokenAudit'];

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
const heads = (lines) => lines.filter((l) => /^### /.test(l)).map((l) => l.slice(4).replace(/`/g, '').trim());
const rows = (lines) => {
  const t = lines.filter((l) => /^\|/.test(l));
  return t.filter((l, i) => !/^\|[\s:|-]+\|\s*$/.test(l) && !(i + 1 < t.length && /^\|[\s:|-]+\|\s*$/.test(t[i + 1])));
};
const VERBS = ['посмотреть', 'смотреть', 'сохранить', 'отправить', 'подтвердить', 'вернуть', 'отклонить', 'запросить',
  'открыть', 'выгрузить', 'скачать', 'добавить', 'создать', 'удалить', 'назначить', 'изменить', 'найти', 'показать',
  'включить', 'выключить', 'сравнить', 'опубликовать', 'откатить', 'получить', 'загрузить', 'импортировать',
  'экспортировать', 'выдать', 'отозвать', 'заблокировать', 'вести', 'править', 'снять', 'слить', 'синхронизировать'];
const glued = (row) => {
  const words = ((row.split('|')[1] || '').toLowerCase().replace(/ё/g, 'е').match(/[а-я]+/g)) || [];
  return new Set(words.filter((w) => VERBS.includes(w))).size >= 2;
};

function grade(md) {
  const S = sections(md);
  const r = {};
  const ck = heads(sec(S, 'Публичный контракт'));
  const cardKeys = ck.map((h) => { const m = h.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\S+)/i); return m ? keyOf(m[1], m[2]) : null; });
  const rest = new Set(), v1 = new Set(), alien = [];
  cardKeys.forEach((k, i) => {
    if (!k) return;
    const any = 'ANY ' + k.slice(k.indexOf(' ') + 1);   // @RequestMapping без метода — любой глагол
    if (REST.has(k)) rest.add(k); else if (REST.has(any)) rest.add(any); else if (V1.has(k)) v1.add(k); else alien.push(ck[i]);
  });
  const body = sec(S, 'Публичный контракт').join('\n');
  const opMentioned = OPIDS.filter((id) => new RegExp('\\b' + id + '\\b').test(body)).length;
  r['блоков контракта'] = ck.length;
  r['внутренние ручки (из 137)'] = rest.size;
  r['внешний OpenAPI v1 по пути (из 153)'] = v1.size;
  r['внешний OpenAPI v1 по имени операции (из 153)'] = opMentioned;
  r['блоков с путём не из списка ручек и спеки (фильтр входа или выдумка — смотреть глазами)'] = alien.length + (alien.length ? ' — например: ' + alien.slice(0, 4).join(' | ') : '');
  r['блоков без метода и пути'] = cardKeys.filter((k) => !k).length;
  const ent = heads(sec(S, 'Владеет данными'));
  r['сущности (из 14)'] = ENTITIES.filter((e) => ent.some((h) => h.split(/[\s—]/)[0] === e)).length;
  const jobs = sec(S, 'Фоновые задачи').join('\n');
  r['задача: адреса adminservice'] = /AdminServiceAddressLocator|RefreshAdminServer|адрес[а-я]* adminservice|адрес[а-я]* сервис[а-я]* админ/i.test(jobs);
  r['задача: здоровье сред'] = /PortalSettings|HealthCheck|здоров/i.test(jobs);
  r['задача: адреса мета-сервера'] = /PortalMetaDomainService|MetaServiceLocator|мета/i.test(jobs);
  const dep = sec(S, 'Зависит от').join('\n');
  const roles = sec(S, 'Роли и доступ').join('\n');
  r['A1 adminservice в «Зависит от»'] = /admin-?service/i.test(dep);
  r['A2 configservice / мета-сервер в «Зависит от»'] = /config-?service|meta|мета/i.test(dep);
  r['A3 вебхуки в «Зависит от»'] = /web-?hook|веб-?хук/i.test(dep);
  r['A4 почта в «Зависит от»'] = /smtp|почт|e-?mail/i.test(dep);
  r['A5 LDAP / OIDC в «Зависит от»'] = /ldap|oidc/i.test(dep);
  // строка «без входа» — про открытые страницы, не про режим по умолчанию: нужен пользователь apollo или «по умолчанию … вход не нужен»
  r['A6 вход по умолчанию — пользователь apollo'] = /`apollo`|«apollo»|пользовател[а-я]* apollo\b|по умолчанию[^|]{0,100}(вход не нужен|без входа|не требуется|встроенн|фиктивн|вшит|подставля)/i.test(roles);
  r['A7 режимы входа (auth / ldap / oidc)'] = /ldap|oidc/i.test(roles);
  r['A8 токен потребителя и лимит 429'] = /Authorization|заголов[а-яё]* авторизац/i.test(md) && /429|Too Many|лимит[а-я]* запрос/i.test(md);
  // заглушка — в той же строке, что очередь, или в трёх следующих (блок «сообщение» пишет её строкой ниже)
  const L = md.split(/\r?\n/);
  r['A9 очередь — заглушка'] = L.some((l, i) => /MQ|очеред/i.test(l) && L.slice(i, i + 4).some((x) => /заглушк|ничего не делает|ничего не отправля|не работает|no-?op|пуст|не отправля/i.test(x)));
  r['A10 суперадмин из настройки'] = /superAdmin|суперадмин/i.test(md);
  r['A11 экстренный релиз — по списку сред'] = /emergencyPublish|экстренн/i.test(md);
  r['A12 только участникам — по списку сред'] = /memberOnly|только участник/i.test(md);
  r['A13 здоровье сред: 10 с и 2 неудачи'] = /10\s*(с(?![а-яё])|сек|s\b)/i.test(md) && /(2|двух|два|две|втор[а-яё]*)\s*(неудач|провал|сбо|раз|подряд|проверк)/i.test(md);
  r['A14 два интервала обновления адресов'] = /офлайн|offline|(хоть одн|какая-то|какой-то|одна из)[а-яё -]{0,20}не обновил/i.test(md);
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
  console.log(`\nSM-APOLLO: ${path.basename(round)} — скилл ${skill}, модель ${meta.model}, K ${meta.K || 'как в тексте'}, прогонов ${runs.length}`);
  for (const d of runs) {
    const card = path.join(sb, d, 'w', 'AI-SDD', 'services', 'apollo-portal.md');
    const cost = fs.existsSync(path.join(sb, d, '_cost.txt')) ? fs.readFileSync(path.join(sb, d, '_cost.txt'), 'utf8').trim() : '?';
    if (!fs.existsSync(card)) { console.log(`  ${d}: карточки нет (${fs.existsSync(path.join(sb, d, '_api-failure.txt')) ? 'отказ API — не измерено' : 'прогон не записал'})`); continue; }
    console.log(`  ${d} (стоимость ${cost}):`);
    for (const [k, v] of Object.entries(grade(fs.readFileSync(card, 'utf8')))) console.log(`    ${k}: ${v === true ? 'да' : v === false ? 'нет' : v}`);
  }
}
