import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('TaxonSleuth selection is received before login and consumed after the redirect',async()=>{
 const nonce='12345678-1234-1234-1234-123456789012';
 const dom=new JSDOM('<div id="root"></div>',{url:'https://tree.example/#'+new URLSearchParams({'mab-import':nonce,source:'https://taxon.example'})});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,history:dom.window.history,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const messages=[],opener={postMessage(message,origin){messages.push({message,origin});}};
 Object.defineProperty(window,'opener',{value:opener});
 const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
 const directory=await mkdtemp(fileURLToPath(new URL('./.handoff-',import.meta.url)));let root;
 try{
  await build({entryPoints:[fileURLToPath(new URL('../src/lib/useGenomeImport.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',outfile:directory+'/hook.mjs',define:{'import.meta.env':JSON.stringify({VITE_ASSEMBLY_GRASP_ORIGINS:'https://taxon.example'})},logLevel:'silent'});
  const {useGenomeImport}=await import(pathToFileURL(directory+'/hook.mjs'));
  function Bridge(){useGenomeImport(true);return null;}
  function Form(){const{selection}=useGenomeImport();return React.createElement('div',null,selection?.genomes[0].assembly_accession??'None');}
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Bridge)));
  assert.equal(messages[0].message.type,'mab:gtotree-ready');
  const deferred=[];window.dispatchEvent(new dom.window.CustomEvent('mab-before-sign-in',{detail:{waitUntil:task=>deferred.push(task)}}));
  assert.equal(deferred.length,1);let transferred=false;deferred[0].then(()=>{transferred=true;});await Promise.resolve();assert.equal(transferred,false);
  const selection={version:1,source:'assembly-grasp',created_at:'2026-11-23',genomes:[{assembly_accession:'GCF_000000001.1',organism_name:'Example bacterium'}]};
  await act(async()=>window.dispatchEvent(new dom.window.MessageEvent('message',{origin:'https://taxon.example',source:opener,data:{type:'mab:genome-selection',nonce,selection}})));
  assert.equal(messages.at(-1).message.type,'mab:gtotree-imported');
  assert(window.sessionStorage.getItem('mab-pending-genome-import-v1'));
  assert.equal(window.location.hash,'');
  await deferred[0];assert.equal(transferred,true);
  const after=[];window.dispatchEvent(new dom.window.CustomEvent('mab-before-sign-in',{detail:{waitUntil:task=>after.push(task)}}));assert.equal(after.length,0);
  await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Form)));
  assert.equal(document.body.textContent,'GCF_000000001.1');assert.equal(window.sessionStorage.getItem('mab-pending-genome-import-v1'),null);
 }finally{if(root)await act(async()=>root.unmount());await rm(directory,{recursive:true,force:true});dom.window.close();}
});
