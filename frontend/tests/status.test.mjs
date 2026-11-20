import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const text=await readFile(new URL('../src/lib/job-status.ts',import.meta.url),'utf8');
const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {finalState,validateJobState}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('tree upload does not complete a running report job',()=>assert.equal(finalState('succeeded',false,{state:'running'}),'running'));
test('final status wins over old artifacts on retry/failure',()=>assert.equal(finalState('succeeded',true,{state:'failed'}),'failed'));
test('report and final marker are both needed',()=>{
 assert.equal(finalState('succeeded',false,{state:'complete',has_report:true}),'running');
 assert.equal(finalState('succeeded',true,{state:'complete',has_report:true}),'succeeded');
 assert.equal(finalState('succeeded',false,{state:'complete',has_report:false}),'failed');
});
test('legacy results remain available; malformed statuses are explicit errors',()=>{
 assert.equal(finalState('succeeded',false,null),'succeeded');
 assert.throws(()=>validateJobState({state:'untrusted'}));
});
