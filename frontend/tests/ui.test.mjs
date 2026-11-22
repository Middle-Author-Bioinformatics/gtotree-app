import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('imported reference metadata and an uploaded genome reach the actual upload bundle',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://tree.example'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');
 const directory=await mkdtemp(fileURLToPath(new URL('./.ui-',import.meta.url)));
 const payload={version:1,source:'assembly-grasp',created_at:'2026-11-20',genomes:[{assembly_accession:'GCF_000000001.1',organism_name:'Example bacterium',dataset_id:'snapshot1'}]};
 const uploaded=[];
 class XHR {upload={};status=200;statusText='OK';open(){}setRequestHeader(){}send(file){uploaded.push(file);queueMicrotask(()=>this.onload());}}
 globalThis.XMLHttpRequest=XHR;
 globalThis.fetch=async(_url,opts)=>{const d=JSON.parse(opts.body);return new Response(JSON.stringify({entries:d.files.map(f=>({file_name:f.name,url:'https://upload.example/'+f.name}))}),{headers:{'Content-Type':'application/json'}});};
 try{
  await build({entryPoints:[fileURLToPath(new URL('../src/components/SubmitView.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile:directory+'/component.mjs',define:{'import.meta.env':JSON.stringify({VITE_GTOTREE_API_BASE:'https://api.example',VITE_GTOTREE_PUBLIC_RESULTS:'https://results.example'})},logLevel:'silent'});
  const {SubmitView}=await import(pathToFileURL(directory+'/component.mjs').href);
  const root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(SubmitView,{onSubmitted(){},onLookup(){}})));
  async function choose(input,file){Object.defineProperty(input,'files',{value:[file],configurable:true});await act(async()=>{input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));});}
  await choose(document.querySelector('input[accept=".json,application/json"]'),new File([JSON.stringify(payload)],'selection.json',{type:'application/json'}));
  assert.match(document.body.textContent,/Imported 1 reference genomes/);
  assert.match(document.querySelector('textarea[aria-label="NCBI assembly accessions"]').value,/GCF_000000001.1/);
  await choose(document.querySelector('input[type=file][accept=".fa,.fasta,.fna"]'),new File(['>contig\nATGC\n'],'mine.fna'));
  await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Submit run').click();await new Promise(r=>setTimeout(r,0));});
  assert(uploaded.some(f=>f.name==='mine.fna'));
  const metadata=uploaded.find(f=>f.name==='selected-genomes.json');assert(metadata);assert.equal(JSON.parse(await metadata.text()).genomes[0].organism_name,'Example bacterium');
  assert.equal(await uploaded.find(f=>f.name==='accessions.txt').text(),'GCF_000000001.1\n');
  assert.equal(uploaded.at(-1).name,'form-data.txt');
  assert.match(await uploaded.at(-1).text(),/Genome Metadata File: selected-genomes.json/);
  assert.match(await uploaded.at(-1).text(),/Genome File: mine.fna/);
  await act(async()=>root.unmount());
 }finally{await rm(directory,{recursive:true,force:true});dom.window.close();}
});
