import test from 'node:test';
import assert from 'node:assert/strict';
import {createSamplingTasks,summarizeTasks,hasCompleteEvidence} from '../core.js';
test('sampling tasks validate platforms/questions and cap repeat count',()=>{let i=0;const tasks=createSamplingTasks({platformIds:['chatgpt','invalid'],questionIds:['BRAND01','invalid'],repeat:99,id:()=>String(++i)});assert.equal(tasks.length,5);assert.equal(new Set(tasks.map(t=>t.id)).size,5);assert.equal(summarizeTasks(tasks).queued,5);});
test('complete evidence requires answer, timestamp and screenshot',()=>{assert.equal(hasCompleteEvidence({answer:'text'}),false);assert.equal(hasCompleteEvidence({answer:'text',sampledAt:1,evidence:{screenshotPath:'evidence.png'}}),true);});
