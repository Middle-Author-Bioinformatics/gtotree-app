import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import ts from "typescript";
const source=await readFile(new URL("../src/lib/genome-selection.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {addReferences,newSelection,parseSelection,recordFromRow,allowedOrigin,sameBioSample}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const record=i=>({assembly_accession:`GCF_${String(i).padStart(9,"0")}.1`,organism_name:"Example organism"});
test("references persist across pages/searches, duplicate accessions count once, limit is atomic",()=>{
 const first=Array.from({length:60},(_,i)=>record(i));
 const second=Array.from({length:40},(_,i)=>record(i+60));
 const combined=addReferences(first,second);assert.equal(combined.length,100);
 assert.equal(addReferences(combined,[record(0)]).length,100);
 assert.throws(()=>addReferences(combined,[record(101)]),/100/);assert.equal(combined.length,100);
 assert.deepEqual(parseSelection(JSON.stringify(newSelection(combined))).genomes,combined);
});
test("handoff validates source/version, rejects bad IDs, duplicates, oversized text and malformed metadata",()=>{
 const good=newSelection([record(1)]);
 assert.throws(()=>parseSelection(JSON.stringify({...good,source:"other"})));
 assert.throws(()=>newSelection([{assembly_accession:"../etc/passwd"}]));
 assert.throws(()=>newSelection([record(1),record(1)]));
 assert.throws(()=>newSelection([{...record(1),organism_name:"x\nGenome File: secret"}]));
 assert.throws(()=>parseSelection(' '.repeat(1024*1024+1)),/1 MB/);
 const cleaned=parseSelection(JSON.stringify({...good,genomes:[{...record(1),owner:"administrator"}]}));assert.equal(cleaned.genomes[0].owner,undefined);
});
test("row mapping retains provenance and missing/invalid accessions cannot be selected",()=>{
 const r=recordFromRow(['organism_name','assembly_accession','biosample'],['Example','gca_000000001.2','SAMN123'],'snapshot1');
 assert.equal(r.assembly_accession,'GCA_000000001.2');assert.equal(r.dataset_id,'snapshot1');
 assert.equal(recordFromRow(['organism_name'],['Example'],'s'),null);
 assert.equal(sameBioSample([{...record(1),biosample:'SAMN1'},{...record(2),biosample:'SAMN1'},record(3)]),1);
});
test("origin allow-list compares exact HTTPS origins, not domain prefixes",()=>{
 assert.equal(allowedOrigin('https://grasp.example','https://grasp.example'),true);
 assert.equal(allowedOrigin('https://grasp.example.evil','https://grasp.example'),false);
 assert.equal(allowedOrigin('https://evil.example',''),false);
 assert.equal(allowedOrigin('http://grasp.example','http://grasp.example'),false);
});
