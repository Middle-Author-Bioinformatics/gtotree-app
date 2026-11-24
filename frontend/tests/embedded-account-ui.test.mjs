import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('an embedded account uses a sign-in window, keeps the parent page and exposes full-page access',async()=>{
  const dom=new JSDOM('<iframe src="https://app.example/#/results/Example123"></iframe>',{url:'https://midauthorbio.com/#fegenie'});
  const frame=dom.window.document.querySelector('iframe').contentWindow;frame.document.write('<div id="root"></div>');frame.document.close();
  Object.assign(globalThis,{window:frame,document:frame.document,HTMLElement:frame.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,__mabPopupCount:0});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const directory=await mkdtemp(fileURLToPath(new URL('./.embedded-',import.meta.url)));let root;
  globalThis.fetch=async(url,options)=>{assert.equal(new Headers(options.headers).get('Authorization'),'Bearer valid');return new Response(JSON.stringify({identity:{name:'Scientist',email:'scientist@example.org'},profile:{institution:'Lab',position:'PI'},complete:true,admin:false}));};
  try{
    await build({entryPoints:[fileURLToPath(new URL('../src/components/Account.tsx',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',outfile:directory+'/account.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_AUTH_ENABLED:'true',VITE_MAB_API_BASE:'https://accounts.example',VITE_MAB_CLIENT_ID:'test-client'})},plugins:[{name:'session',setup(b){b.onResolve({filter:/account-session$/},()=>({path:'session',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function accountManager(){return {events:{addUserLoaded(fn){globalThis.__mabEmbeddedLoaded=fn},removeUserLoaded(){}}}};export async function initializeAccount(){return null};export async function accessToken(){return 'valid'};export async function createFreeAccount(){};export async function signIn(){globalThis.__mabPopupCount++;globalThis.__mabEmbeddedLoaded({profile:{sub:'member'},access_token:'valid'});};export async function signOut(){}`,loader:'js'}));}}],logLevel:'silent'});
    const {AccountProvider,AccountGate,AccountControls}=await import(pathToFileURL(directory+'/account.mjs'));
    root=createRoot(document.getElementById('root'));
    await act(async()=>root.render(React.createElement(AccountProvider,null,React.createElement(AccountGate,{header:React.createElement(AccountControls)},React.createElement('div',null,React.createElement(AccountControls),React.createElement('div',null,'Private workspace'))))));
    assert(document.body.textContent.includes('Sign-in opens in a separate window.'));
    assert(!document.body.textContent.includes('Private workspace'));
    const link=document.querySelector('a');assert.equal(link.href,'https://app.example/#/results/Example123');assert.equal(link.target,'_blank');assert(link.rel.includes('noopener'));
    await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign in').click();await new Promise(resolve=>setTimeout(resolve,0));});
    assert.equal(globalThis.__mabPopupCount,1);assert(document.body.textContent.includes('Private workspace'));
    assert.equal(dom.window.location.href,'https://midauthorbio.com/#fegenie');assert.equal(frame.location.href,'https://app.example/#/results/Example123');
    assert([...document.querySelectorAll('a')].some(a=>a.textContent==='Open full page'));
  }finally{if(root)await act(async()=>root.unmount());dom.window.close();await rm(directory,{recursive:true,force:true});}
});
