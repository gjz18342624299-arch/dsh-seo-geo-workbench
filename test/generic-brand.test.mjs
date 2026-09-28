import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {initialState,autoJudgeEntity,isOfficialCitation} from '../analysis.js';
import {judgeSystemPrompt} from '../entity-judge.js';
import {Store} from '../store.js';
const brand={name:'Acme',aliases:['Acme'],domain:'acme.example',officialUrl:'https://acme.example/',officialSources:['https://github.com/acme/widgets'],entityRivals:['other-acme.example'],competitors:[],organization:'Acme Inc'};
test('fresh installation is empty and generic brands cannot inherit DSH identity',()=>{
 assert.equal(initialState().brand.name,'');
 assert.equal(autoJudgeEntity({answer:'DSH Desktop by DataElement, anywhere-labs',citations:['https://github.com/dataelement/dsh']},brand).entity,'');
 assert.equal(autoJudgeEntity({question:'acme.example 是什么',answer:'不知道',citations:[]},brand).entity,'');
 assert.equal(autoJudgeEntity({answer:'Acme',citations:['https://acme.example/help']},brand).entity,'ours');
 assert.equal(autoJudgeEntity({answer:'Acme',citations:['https://other-acme.example/']},brand).entity,'rival');
 assert.equal(isOfficialCitation('https://github.com/acme/widgets/issues/1',brand),true);
 assert.equal(isOfficialCitation('https://github.com/acme/widgets-evil',brand),false);
 assert.equal(isOfficialCitation('https://acme.example.evil.test/',brand),false);
 assert.doesNotMatch(judgeSystemPrompt(brand),/DataElem|dshdesktop|anywhere-labs/);
});
test('brand settings persist and historical data cannot be silently reassigned',async()=>{
 const qa=new URL('../../qa-market/',import.meta.url);await mkdir(qa,{recursive:true});const store=new Store(await mkdtemp(new URL('brand-',qa)));
 await store.action({type:'brand.save',brand});assert.equal((await store.read()).brand.organization,'Acme Inc');
 await store.mutate(s=>{s.records.push({id:'history'});});
 await assert.rejects(store.action({type:'brand.save',brand:{...brand,name:'Other',officialUrl:'https://other.example/'}}),/历史/);
 assert.equal((await store.read()).brand.name,'Acme');
});
