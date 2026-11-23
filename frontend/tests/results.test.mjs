import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import ts from 'typescript';

const source=await readFile(new URL('../src/lib/public-results.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {isPublicResult}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('only scientific downloads are public in the viewer',()=>{
 for(const name of ['gtotree-report.html','output/GToTree_output.tre','output/Genomes_summary_info.tsv','output/Partitions.txt','output/selected-genomes.json'])assert(isPublicResult('Example123','Example123/'+name));
 for(const name of ['run.log','output/gtotree-runlog.txt','raw-results.tar.gz','status.json','result.json','output/command.txt','output/../run.log','other/GToTree_output.tre'])assert(!isPublicResult('Example123','Example123/'+name),name);
 assert(!isPublicResult('Example123','OtherJob/output/GToTree_output.tre'));
});

test('poll completion and manual refresh preserve the chosen view and mounted report; diagnostics never appear',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://tree.example'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,DOMParser:dom.window.DOMParser,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');
 const directory=await mkdtemp(fileURLToPath(new URL('./.ui-',import.meta.url)));
 const originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
 const polls=[];let pollId=90000,state='running';const requests=[];
 globalThis.setTimeout=(fn,ms,...args)=>{if(ms===8000){const id=++pollId;polls.push({id,fn});return id;}return originalTimeout(fn,ms,...args);};
 globalThis.clearTimeout=id=>{const i=polls.findIndex(t=>t.id===id);if(i>=0)polls.splice(i,1);else originalClear(id);};
 const paths=['gtotree-report.html','output/GToTree_output.tre','output/Aligned_SCGs.faa','run.log','output/gtotree-runlog.txt','raw-results.tar.gz','result.json','status.json'];
 globalThis.fetch=async url=>{
  requests.push(String(url));
  if(String(url).includes('list-type'))return new Response('<ListBucketResult>'+paths.map(p=>`<Contents><Key>Example123/${p}</Key><Size>100</Size></Contents>`).join('')+'</ListBucketResult>');
  if(String(url).includes('status.json'))return new Response(JSON.stringify({state,has_report:true,error:'/home/ark/private/credentials: diagnostic exception'}));
  if(String(url).includes('GToTree_output.tre'))return new Response('(A:0.1,B:0.2);');
  throw new Error('Unexpected diagnostic request: '+url);
 };
 let root;
 try{
  await build({entryPoints:[fileURLToPath(new URL('../src/components/ResultsView.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',jsx:'automatic',packages:'external',outfile:directory+'/component.mjs',define:{'import.meta.env':JSON.stringify({VITE_GTOTREE_PUBLIC_RESULTS:'https://results.example'})},logLevel:'silent'});
  const {ResultsView}=await import(pathToFileURL(directory+'/component.mjs').href);
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(ResultsView,{folder:'Example123',onBack(){}}));await new Promise(r=>originalTimeout(r,0));});
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const inquiry=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Request a dashboard for my lab');
  assert(inquiry);
  assert.equal(inquiry.href,'https://midauthorbio.com/#contactdash');
  assert.equal(inquiry.target,'_blank');
  assert.equal(document.querySelector('dialog'),null,'contact uses the website instead of an email form');
  assert(![...document.querySelectorAll('a')].some(a=>a.protocol==='mailto:'));
  assert.match(document.body.textContent,/from \$999\. Final pricing depends on scope/);
  const files=()=>[...document.querySelectorAll('button')].find(b=>/^Files/.test(b.textContent.trim()));
  assert.equal(button('Run log'),undefined);
  assert.equal(polls.length,1);
  await act(async()=>files().click());
  assert.match(document.body.textContent,/All result files/);
  assert.equal(document.querySelector('iframe'),null);
  assert(!document.body.textContent.includes('run.log'));
  assert(!document.body.textContent.includes('raw-results'));
  assert(![...document.querySelectorAll('a')].some(a=>/runlog|run\.log|raw-results|result\.json|status\.json/.test(a.href)));
  state='complete';
  await act(async()=>{await polls.shift().fn();});
  assert.match(document.body.textContent,/All result files/);
  assert.equal(document.querySelector('iframe'),null);
  assert.equal(polls.length,0,'terminal polling stops');
  await act(async()=>button('Tree').click());
  assert(document.querySelector('svg text'));
  await act(async()=>{button('Refresh').click();await new Promise(r=>originalTimeout(r,0));});
  assert(document.querySelector('svg text'),'tree remains selected');
  await act(async()=>button('Dashboard').click());
  const frame=document.querySelector('iframe');assert(frame);
  await act(async()=>{button('Refresh').click();await new Promise(r=>originalTimeout(r,0));});
  assert.equal(document.querySelector('iframe'),frame,'iframe is not remounted');
  state='failed';
  await act(async()=>{button('Refresh').click();await new Promise(r=>originalTimeout(r,0));});
  assert.match(document.body.textContent,/Analysis failed/);
  assert(!document.body.textContent.includes('/home/ark'));
  assert(!requests.some(url=>/gtotree-runlog|run\.log|raw-results/.test(url)));
  await act(async()=>root.unmount());root=null;
 }finally{if(root)await act(async()=>root.unmount());globalThis.setTimeout=originalTimeout;globalThis.clearTimeout=originalClear;await rm(directory,{recursive:true,force:true});dom.window.close();}
});
