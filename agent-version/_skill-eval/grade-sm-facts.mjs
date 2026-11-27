#!/usr/bin/env node
// Independent fact oracle. No imports from the skill or its card/check parsers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const fixture = path.join(import.meta.dirname, 'fixtures/SM-FACTS');
const defaultExpect = JSON.parse(fs.readFileSync(path.join(fixture, 'expect.json'), 'utf8'));
export const oracleSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(fixture, 'expect.json'))).digest('hex');
const sections = new Set(['Публичный контракт', 'Владеет данными', 'События', 'Фоновые задачи']);
const fold = s => s.replaceAll('`','').replaceAll('ё','е').toLowerCase().replace(/\s+/gu,' ').trim();
export function canonical(s) {
  s = s.replaceAll('`','').split(' — ')[0].trim().replace(/\s+/gu,' ');
  s = s.replace(/\{([^}]+)\}/g, ':$1');
  const gql = s.match(/^(query|mutation|subscription)(?:\s+|\.)(\w+)/i);
  if (gql) return gql[1].toLowerCase()+' '+gql[2];
  return s.replace(/^(get|post|put|patch|delete|options|head) /i, v => v.toUpperCase());
}
export function parse(text) {
  const blocks = new Map(), duplicates = [];
  let section = '', key = '';
  for (const line of text.replaceAll('\r','').split('\n')) {
    if (/^## /.test(line)) { section=line.slice(3).trim();key='';continue; }
    if (/^### /.test(line)) {
      key = sections.has(section) ? canonical(line.slice(4)) : '';
      if (key) { if(blocks.has(key)) duplicates.push(key); else blocks.set(key,''); }
      continue;
    }
    if(key) blocks.set(key,blocks.get(key)+'\n'+line);
  }
  return {blocks,duplicates};
}
export function grade(text, audit, config={}) {
  const expect=config.expect||defaultExpect;
  const boundOracleSha256=config.oracleSha256||oracleSha256;
  const requireAllCritical=config.requireAllCritical!==false;
  if(!Array.isArray(expect.keys)||!expect.keys.length||!Array.isArray(expect.facts)||!expect.facts.length||
    !Array.isArray(expect.forbidden)||new Set(expect.keys).size!==expect.keys.length||
    !expect.facts.every(f=>f&&expect.keys.includes(f.key)&&Array.isArray(f.all)&&f.all.length&&typeof f.source==='string'))
    return {pass:false,status:'not_measured',configurationError:'Invalid independent oracle'};
  const {blocks,duplicates} = parse(text), missingKeys=expect.keys.filter(k=>!blocks.has(k));
  const extraKeys=[...blocks.keys()].filter(k=>!expect.keys.includes(k));
  const missingFacts=[], coveredFacts=[];
  expect.facts.forEach((fact,index)=>{
    const body=fold(blocks.get(fact.key)||'');
    (fact.all.every(p=>new RegExp(p,'iu').test(body))?coveredFacts:missingFacts).push({index,...fact});
  });
  const contradictions=expect.forbidden.filter(f=>new RegExp(f.pattern,'iu').test(fold(blocks.get(f.key)||'')));
  const sha256=crypto.createHash('sha256').update(text).digest('hex');
  // A reviewer checks every fact against its actual block and the independent source.
  // A blanket signature cannot turn uncertain lexical matching into semantic evidence.
  const reviews = Array.isArray(audit?.facts) ? audit.facts : [];
  const seen = new Set();
  const auditValid=audit?.sha256===sha256 && audit.oracleSha256===boundOracleSha256 &&
    ['pass','fail'].includes(audit.verdict) && Number.isInteger(audit.inventions) && audit.inventions>=0 &&
    typeof audit.reviewer==='string' && audit.reviewer.trim()!=='' && Array.isArray(audit.notes) &&
    audit.contradictionsReviewed===true && reviews.length===expect.facts.length && reviews.every(r=>{
      if(!r || typeof r!=='object') return false;
      const fact=expect.facts[r.index];
      if(!fact || seen.has(r.index) || !Number.isInteger(r.index)) return false;
      seen.add(r.index);
      if(r.source!==fact.source || !['present','missing'].includes(r.status) || typeof r.reason!=='string' || !r.reason.trim()) return false;
      return r.status==='missing' || (typeof r.evidence==='string' && !!r.evidence.trim() &&
        fold(blocks.get(fact.key)||'').includes(fold(r.evidence)));
    });
  const semanticMissing = auditValid ? reviews.filter(r=>r.status==='missing').map(r=>({index:r.index,...expect.facts[r.index]})) : null;
  const semanticFacts = auditValid ? reviews.filter(r=>r.status==='present').length : null;
  const fraction=coveredFacts.length/expect.facts.length;
  const automaticPass=missingKeys.length===0 && extraKeys.length===0 && duplicates.length===0 &&
    fraction>=0.9 && (!requireAllCritical||missingFacts.every(f=>!f.critical)) && contradictions.length===0;
  const pass=auditValid && audit.verdict==='pass' && audit.inventions===0 &&
    missingKeys.length===0 && extraKeys.length===0 && duplicates.length===0 &&
    semanticFacts/expect.facts.length>=0.9 && (!requireAllCritical||semanticMissing.every(f=>!f.critical));
  return {pass,status:!auditValid?'not_measured':pass?'green':'red',automaticPass,automaticScoresProvisional:true,
    keys:blocks.size,expectedKeys:expect.keys.length,
    missingKeys,extraKeys,duplicates,facts:coveredFacts.length,expectedFacts:expect.facts.length,
    coverage:fraction,missingFacts,contradictions,manualAudit:auditValid?'completed':'not_measured',
    semanticFacts,semanticCoverage:auditValid?semanticFacts/expect.facts.length:null,semanticMissingFacts:semanticMissing,
    inventions:auditValid?audit.inventions:null,sha256,oracleSha256:boundOracleSha256,cost:null,peakContext:null,fileTransitions:null};
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2), card=args.find(a=>!a.startsWith('--'));
  if(!card) throw Error('usage: node grade-sm-facts.mjs <card.md> [--json] [--auto]');
  const auditPath=card+'.audit.json';
  const result=grade(fs.readFileSync(card,'utf8'),fs.existsSync(auditPath)?JSON.parse(fs.readFileSync(auditPath,'utf8')):undefined);
  if(args.includes('--json')) console.log(JSON.stringify(result,null,2));
  else {
    console.log(`SM-FACTS: ключи ${result.keys}/${result.expectedKeys}, предварительно факты ${result.facts}/${result.expectedFacts}; итог ${result.status}; аудит ${result.manualAudit}`);
    for(const fact of result.missingFacts) console.log(`  нет факта: ${fact.key}: ${fact.claim} (${fact.source})`);
    for(const key of result.missingKeys) console.log('  нет ключа: '+key);
    for(const key of result.extraKeys) console.log('  лишний ключ: '+key);
    for(const fact of result.contradictions) console.log('  противоречие: '+fact.key+': '+fact.claim);
  }
  process.exitCode=args.includes('--auto')?(result.automaticPass?0:1):result.status==='not_measured'?3:result.pass?0:1;
}
