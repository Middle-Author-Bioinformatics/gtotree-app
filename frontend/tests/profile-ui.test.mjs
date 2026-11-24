import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('profile form gates access, requires institution/position and leaves the two interest fields optional',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://tree.example/?result=Example123'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
 const directory=await mkdtemp(fileURLToPath(new URL('./.profile-',import.meta.url)));let root;
 let saved=null;const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});assert.equal(new Headers(options.headers).get('Authorization'),'Bearer valid');
   if(options.method==='PUT')saved=JSON.parse(options.body);
   return new Response(JSON.stringify({identity:{name:'Lab Scientist',email:'scientist@example.org'},profile:saved,complete:!!saved,admin:false}));};
 try{
  await build({entryPoints:[fileURLToPath(new URL('../src/components/Account.tsx',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',outfile:directory+'/component.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_AUTH_ENABLED:'true',VITE_MAB_API_BASE:'https://accounts.example',VITE_MAB_CLIENT_ID:'test-client'})},plugins:[{name:'test-session',setup(b){b.onResolve({filter:/account-session$/},()=>({path:'session',namespace:'fixture'}));b.onResolve({filter:/^\.\/Header$/},()=>({path:'header',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='header'?'export function Header(){return null}':`export function accountManager(){return {events:{addUserLoaded(){},removeUserLoaded(){}}}}; export async function initializeAccount(){return {profile:{sub:'user'},access_token:'valid'}}; export async function accessToken(){return 'valid'};export function createFreeAccount(){};export function signIn(){};export function signOut(){}`,loader:'js'}));}}],logLevel:'silent'});
  const {AccountProvider,AccountGate}=await import(pathToFileURL(directory+'/component.mjs'));
  root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(AccountProvider,null,React.createElement(AccountGate,null,React.createElement('div',null,'Application available'))));await new Promise(r=>setTimeout(r,0));});
  assert(!document.body.textContent.includes('Application available'));
  const form=document.querySelector('form'),inputs=[...form.querySelectorAll('input')],select=form.querySelector('select');
  assert.equal(inputs[0].value,'Lab Scientist');assert.equal(inputs[1].value,'scientist@example.org');
  assert.equal(inputs[2].required,true);assert.equal(select.required,true);assert.equal(inputs[3].required,false);assert.equal(inputs[4].required,false);
  assert.equal(form.querySelector('button').disabled,true);
  await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(inputs[2],'Independent');inputs[2].dispatchEvent(new dom.window.Event('input',{bubbles:true}));select.value='Student';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>{form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));});
  assert.equal(saved.institution,'Independent');assert.equal(saved.position,'Student');assert.equal(saved.favorite_software,'');assert.equal(saved.research_area,'');
  assert(document.body.textContent.includes('Application available'));
  assert.equal(window.location.search,'?result=Example123');
  assert(requests.every(req=>req.url.startsWith('https://accounts.example/')));
 }finally{if(root)await act(async()=>root.unmount());await rm(directory,{recursive:true,force:true});dom.window.close();}
});
