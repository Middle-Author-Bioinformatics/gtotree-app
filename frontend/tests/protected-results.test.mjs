import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('protected reports and downloads use bearer headers, never public S3 or tokens in URLs',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://tree.example/?result=Example123'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
 const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
 const directory=await mkdtemp(fileURLToPath(new URL('./.protected-',import.meta.url)));let root;
 const requests=[],downloads=[];
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 globalThis.fetch=async(url,options)=>{
   requests.push(String(url));assert.equal(new Headers(options.headers).get('Authorization'),'Bearer valid');
   assert(String(url).startsWith('https://accounts.example/'));
   if(String(url).includes('/results/'))return new Response(JSON.stringify({files:[{key:'Example123/gtotree-report.html',size:100},{key:'Example123/output/GToTree_output.tre',size:30}]}));
   if(String(url).includes('status.json'))return new Response(JSON.stringify({state:'complete',has_report:true}));
   if(String(url).includes('GToTree_output.tre'))return new Response('(A:0.1,B:0.2);');
   if(String(url).includes('gtotree-report.html'))return new Response('<html><head></head><body>Report</body></html>',{headers:{'Content-Type':'text/html'}});
   throw new Error('Unexpected URL: '+url);
 };
 try{
   await build({entryPoints:[fileURLToPath(new URL('../src/components/ResultsView.tsx',import.meta.url))],bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',outfile:directory+'/component.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_AUTH_ENABLED:'true',VITE_MAB_API_BASE:'https://accounts.example',VITE_GTOTREE_PUBLIC_RESULTS:'https://public-s3.invalid'})},plugins:[{name:'session',setup(b){b.onResolve({filter:/account-session$/},()=>({path:'session',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export async function accessToken(){return 'valid'}",loader:'js'}));}}],logLevel:'silent'});
   const {ResultsView}=await import(pathToFileURL(directory+'/component.mjs'));
   root=createRoot(document.getElementById('root'));
   await act(async()=>{root.render(React.createElement(ResultsView,{folder:'Example123',onBack(){}}));await new Promise(r=>setTimeout(r,20));});
   const frame=document.querySelector('iframe');assert(frame);assert.equal(frame.getAttribute('sandbox'),'allow-scripts allow-downloads');assert(frame.src.startsWith('blob:'));
   const open=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='Open in new tab');assert.equal(open.href,'https://tree.example/?result=Example123');
   const button=text=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===text);
   await act(async()=>{button('Refresh').click();await new Promise(r=>setTimeout(r,0));});assert.equal(document.querySelector('iframe'),frame);
   await act(async()=>{button('Download report').click();await new Promise(r=>setTimeout(r,0));});assert.equal(downloads[0].name,'GToTree_Example123_report.html');
   await act(async()=>[...document.querySelectorAll('button')].find(b=>/^Files/.test(b.textContent)).click());
   await act(async()=>{button('Download').click();await new Promise(r=>setTimeout(r,0));});assert(downloads.length>=2);
   assert(requests.every(url=>!url.includes('public-s3')&&!url.includes('valid')&&!url.includes('access_token')));
 }finally{if(root)await act(async()=>root.unmount());await rm(directory,{recursive:true,force:true});dom.window.close();}
});
