import fs from 'node:fs';
import assert from 'node:assert/strict';
import {grade,parse,oracleSha256} from '../../grade-sm-facts.mjs';
const expected=JSON.parse(fs.readFileSync(new URL('./expect.json',import.meta.url),'utf8'));
assert(expected.keys.length>=24);assert(expected.facts.length>=40);
let count=0;
function verify(name,run){run();count++;console.log('ok '+name);}
function card(excludedKind='',reverse=false) {
 const groups=[
  ['Публичный контракт',expected.keys.filter(k=>/^(GET|POST|PATCH|DELETE|query|mutation) /.test(k))],
  ['Владеет данными',['Shipment','Carrier']],['Фоновые задачи',['retryFailedShipments','rotateLabels']],
  ['События',expected.keys.filter(k=>/^(потребляет|публикует) /.test(k))]
 ];
 return groups.map(([s,keys])=>'## '+s+'\n'+(reverse?[...keys].reverse():keys).map(k=>
  '### '+k+'\n'+expected.facts.filter(f=>f.key===k && f.kind!==excludedKind).map(f=>'- '+f.claim).join('\n')
 ).join('\n')).join('\n');
}
const good=card();
function auditFor(text,missing=[]) {
 const {blocks}=parse(text);
 return {sha256:grade(text).sha256,oracleSha256,verdict:missing.length?'fail':'pass',inventions:0,
  reviewer:'selftest',notes:[],contradictionsReviewed:true,
  facts:expected.facts.map((f,index)=>({index,source:f.source,status:missing.includes(index)?'missing':'present',
   reason:'Selftest fact is stated explicitly in its own operation block.',evidence:blocks.get(f.key)}))};
}
verify('positive',()=>{const r=grade(good);assert(r.automaticPass,JSON.stringify(r.missingFacts));assert.equal(r.facts,expected.facts.length);});
verify('reorder',()=>assert.equal(grade(card('',true)).facts,expected.facts.length));
verify('audit-required',()=>{const r=grade(good);assert.equal(r.pass,false);assert.equal(r.inventions,null);});
verify('audit-hash',()=>{
 const audit=auditFor(good);
 assert(grade(good,audit).pass);assert(!grade(good+'\n',audit).pass);
});
verify('blanket-audit-is-not-evidence',()=>{
 const r=grade(good);assert.equal(grade(good,{sha256:r.sha256,verdict:'pass',inventions:0,reviewer:'selftest',notes:[]}).status,'not_measured');
});
verify('wrong-oracle-invalidates-audit',()=>{const a=auditFor(good);a.oracleSha256='obsolete';assert.equal(grade(good,a).status,'not_measured');});
verify('wrong-evidence-invalidates-audit',()=>{const a=auditFor(good);a.facts[0].evidence='invented evidence';assert.equal(grade(good,a).status,'not_measured');});
verify('duplicate-review-invalidates-audit',()=>{const a=auditFor(good);a.facts[1]=a.facts[0];assert.equal(grade(good,a).status,'not_measured');});
verify('malformed-review-is-unmeasured',()=>{const a=auditFor(good);a.facts[0]=null;assert.equal(grade(good,a).status,'not_measured');});
verify('critical-loss-is-red-after-audit',()=>{
 const i=expected.facts.findIndex(f=>f.critical);const changed=good.replace('- '+expected.facts[i].claim,'');
 const r=grade(changed,auditFor(changed,[i]));assert.equal(r.status,'red');assert.equal(r.semanticFacts,expected.facts.length-1);
});
verify('unreviewed-result-not-red',()=>assert.equal(grade(card('error')).status,'not_measured'));
verify('semantic-audit-resolves-paraphrase',()=>{
 const changed=good.replace('Повтор токена возвращает ранее созданное отправление','Повторный ключ идемпотентности возвращает найденное отправление');
 assert(grade(changed).missingFacts.some(f=>f.index===0));assert(grade(changed,auditFor(changed)).pass);
});
verify('gql-dot-is-same-operation',()=>{
 const changed=good.replaceAll('### query ','### Query.').replaceAll('### mutation ','### Mutation.');
 assert(grade(changed).automaticPass);assert(grade(changed,auditFor(changed)).pass);
});
verify('graphql-domain-errors-do-not-require-http-status',()=>{
 const text=good.replace('Пустая причина после trim вызывает доменную ошибку HOLD_REASON; HTTP-статус GraphQL не установлен','После trim пустая причина вызывает HOLD_REASON')
  .replace('Неприостановленное отправление вызывает доменную ошибку NOT_HELD; HTTP-статус GraphQL не установлен','Если held=false, доменная ошибка NOT_HELD');
 assert(!grade(text).missingFacts.some(f=>/^(mutation holdShipment|mutation releaseShipment)$/.test(f.key)));
 assert(grade(text,auditFor(text)).pass);
});
verify('no-audit-can-invent-missing-key',()=>{
 const changed=good.replace('### GET /health','### GET /ghost');
 assert.equal(grade(changed,auditFor(changed)).status,'red');
});
for(const kind of new Set(expected.facts.map(f=>f.kind))) verify('loss-'+kind,()=>{
 const r=grade(card(kind));assert(r.missingFacts.some(f=>f.kind===kind));
});
verify('missing-key',()=>{const r=grade(good.replace('### GET /health','### GET /invented'));assert(!r.automaticPass);assert(r.missingKeys.includes('GET /health'));assert(r.extraKeys.includes('GET /invented'));});
verify('wrong-ttl',()=>{const r=grade(good.replace('15 минут','30 минут'));assert(!r.automaticPass);assert(r.contradictions.some(f=>f.key.endsWith('/label')));});
verify('duplicate',()=>assert(!grade(good+'\n## Публичный контракт\n### GET /health\n').automaticPass));
verify('paraphrase',()=>{
 const changed=good.replace('Повтор токена возвращает ранее созданное отправление','Существующий idempotency токен возвращает прежний результат')
  .replace('Отменённые отправления исключены','CANCELLED не включается в результат');
 assert.equal(grade(changed).facts,expected.facts.length);
});
verify('custom-oracle-requires-own-binding',()=>{
 const hash='a'.repeat(64),config={expect:expected,oracleSha256:hash};
 assert.equal(grade(good,auditFor(good),config).status,'not_measured');
 const audit=auditFor(good);audit.oracleSha256=hash;assert(grade(good,audit,config).pass);
});
verify('selected-fact-threshold-does-not-change-default-critical-rule',()=>{
 const audit=auditFor(good),i=expected.facts.findIndex(f=>f.critical);
 audit.facts[i]={index:i,source:expected.facts[i].source,status:'missing',reason:'Изолированный тест различия контрактов приёмки'};
 assert.equal(grade(good,audit).status,'red');
 assert(grade(good,audit,{requireAllCritical:false}).pass);
});
verify('custom-threshold-still-requires-full-audit',()=>assert.equal(grade(good,undefined,{requireAllCritical:false}).status,'not_measured'));
verify('invalid-oracle-is-not-a-skill-failure',()=>assert.equal(grade(good,auditFor(good),{expect:{keys:[],facts:[],forbidden:[]}}).status,'not_measured'));
console.log(`Fact grader: ${count}/${count}`);
