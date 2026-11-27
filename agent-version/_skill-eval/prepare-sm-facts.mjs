#!/usr/bin/env node
// Native-pool inputs only: no API calls, no Claude CLI, no oracle in the sandbox.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [skillDirArg,outArg,date]=process.argv.slice(2);
if(!skillDirArg||!outArg||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')) throw Error('usage: prepare-sm-facts.mjs <skill-folder> <new-round-folder> <date>');
const skillDir=path.resolve(skillDirArg),out=path.resolve(outArg),fixture=path.join(import.meta.dirname,'fixtures/SM-FACTS');
if(fs.existsSync(out)) throw Error('Round already exists: '+out);
fs.mkdirSync(out,{recursive:true});fs.cpSync(skillDir,out+'/_skill-snapshot',{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function treeHash(dir,base=dir){return fs.readdirSync(dir).sort().flatMap(n=>fs.statSync(path.join(dir,n)).isDirectory()?treeHash(path.join(dir,n),base): [{path:path.relative(base,path.join(dir,n)),sha256:hash(fs.readFileSync(path.join(dir,n)))}]);}
fs.copyFileSync(fixture+'/expect.json',out+'/_oracle.json');
const manifest={model:'gpt-6-luna',reasoning_effort:'medium',trials:3,fork_turns:'none',date,authorBudget:2,skillSha256:hash(fs.readFileSync(out+'/_skill-snapshot/SKILL.md')),skill:treeHash(out+'/_skill-snapshot'),source:treeHash(fixture+'/tree'),oracleSha256:hash(fs.readFileSync(out+'/_oracle.json')),cost:null,peakContext:null,sourceTransitions:null,finalRegression:false,trialsData:[]};
for(let i=1;i<=3;i++){
 const dir=out+'/trial-'+i;fs.mkdirSync(dir);fs.cpSync(fixture+'/tree',dir+'/source',{recursive:true});
 const skill=out+'/_skill-snapshot/SKILL.md',template=out+'/_skill-snapshot/reference/card.template.md';
 const prompt=`Вызов читающего субагента скилла service-map. Твой бриф — в файле ${skill}: блок от строки, которая начинается словами «Ты — читающий субагент скилла», до строки, которая начинается словами «Ни чисел, ни пересказа», включительно. Найди обе строки поиском, прочитай блок полностью и выполняй его дословно, с подстановками:\n<пути> = ${dir}/source; <корень> = ${dir}/source; <type> = backend; <имена> = dispatch; <шаблон> = ${template}; прежней карточки нет; заметок команды нет; <дата> = ${date}; строку о маркерах пропусти; <опись> = ${dir}/opis.md; <черновик> = ${dir}/card.md. Имя сервиса dispatch. Репозиторий — сокращённый синтетический исходник, инфраструктурные адаптеры не реализованы: описывай только подтверждённое в доступном коде.\n\nРазрешено читать только дерево ${dir}/source и снимок скилла ${out}/_skill-snapshot. Исходники только для чтения. Создай только ${dir}/opis.md и ${dir}/card.md, не читай другие прогоны и проверочные файлы. Своих субагентов не запускай. Это первое чтение из бюджета двух запусков автора с одним возможным добором. Не запускай сеть, git, сторонние CLI или исходники. Пользуйся доступными средствами поиска и чтения файлов; после сохранения верни три строки по брифу.\n`;
 fs.writeFileSync(dir+'/prompt.md',prompt);manifest.trialsData.push({trial:i,prompt:dir+'/prompt.md',promptSha256:hash(prompt),opis:dir+'/opis.md',card:dir+'/card.md',source:dir+'/source',attempts:0});
}
fs.writeFileSync(out+'/_pool.json',JSON.stringify(manifest,null,2)+'\n');console.log(out);
