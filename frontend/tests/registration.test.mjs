import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';

test('Create free account opens Cognito signup with PKCE/state and the app-specific callback; Sign in uses authorize',async()=>{
  const dom=new JSDOM('',{url:'https://app.example/#/fegenie/results/Example123'});
  const events=new EventTarget(),navigations=[];
  const location={href:dom.window.location.href,origin:'https://app.example',search:'',assign(url){navigations.push(new URL(url));events.dispatchEvent(new Event('pageshow'));}};
  const win={location,sessionStorage:dom.window.sessionStorage,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),stop(){}};win.self=win;win.top=win;
  Object.assign(globalThis,{window:win,sessionStorage:dom.window.sessionStorage});
  globalThis.fetch=async()=>new Response(JSON.stringify({issuer:'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_VzCBot5S3',authorization_endpoint:'https://accounts.example/oauth2/authorize',token_endpoint:'https://accounts.example/oauth2/token',userinfo_endpoint:'https://accounts.example/oauth2/userInfo',jwks_uri:'https://accounts.example/keys'}),{headers:{'Content-Type':'application/json'}});
  const directory=await mkdtemp(fileURLToPath(new URL('./.signup-',import.meta.url)));
  try{
    await build({entryPoints:[fileURLToPath(new URL('../src/lib/account-session.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',outfile:directory+'/session.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_CLIENT_ID:'this-app-client',VITE_MAB_COGNITO_DOMAIN:'https://accounts.example'})},logLevel:'silent'});
    const session=await import(pathToFileURL(directory+'/session.mjs'));
    await session.createFreeAccount();
    const signup=navigations[0];assert.equal(signup.pathname,'/signup');assert.equal(signup.searchParams.get('client_id'),'this-app-client');
    assert.equal(signup.searchParams.get('redirect_uri'),'https://app.example/');assert.equal(signup.searchParams.get('response_type'),'code');
    assert.equal(signup.searchParams.get('code_challenge_method'),'S256');assert.equal(signup.searchParams.get('scope'),'openid email profile');
    const state=JSON.parse(dom.window.sessionStorage.getItem('oidc.'+signup.searchParams.get('state')));
    assert.equal(state.data.returnTo,'/#/fegenie/results/Example123');
    assert.equal(createHash('sha256').update(state.code_verifier).digest('base64url'),signup.searchParams.get('code_challenge'));
    await session.signIn();assert.equal(navigations[1].pathname,'/oauth2/authorize');
    assert.notEqual(navigations[1].searchParams.get('state'),signup.searchParams.get('state'));
  }finally{dom.window.close();await rm(directory,{recursive:true,force:true});}
});

test('the account entry offers Create free account and a separate Sign in action',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://app.example/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,__mabEntryActions:[]});
  const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
  const directory=await mkdtemp(fileURLToPath(new URL('./.entry-',import.meta.url)));let root;
  try{
    await build({entryPoints:[fileURLToPath(new URL('../src/components/Account.tsx',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',jsx:'automatic',outfile:directory+'/entry.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_AUTH_ENABLED:'true',VITE_MAB_API_BASE:'https://accounts.example',VITE_MAB_CLIENT_ID:'this-app-client'})},plugins:[{name:'session',setup(b){b.onResolve({filter:/account-session$/},()=>({path:'session',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function accountManager(){return {events:{addUserLoaded(){},removeUserLoaded(){}}}};export async function initializeAccount(){return null};export async function accessToken(){throw new Error('No session')};export async function createFreeAccount(){globalThis.__mabEntryActions.push('register')};export async function signIn(){globalThis.__mabEntryActions.push('signin')};export async function signOut(){}`,loader:'js'}));}}],logLevel:'silent'});
    const {AccountProvider,AccountGate}=await import(pathToFileURL(directory+'/entry.mjs'));root=createRoot(document.getElementById('root'));
    await act(async()=>{root.render(React.createElement(AccountProvider,null,React.createElement(AccountGate,null,'Private workspace')));});
    const buttons=[...document.querySelectorAll('button')];assert.deepEqual(buttons.map(b=>b.textContent),['Create free account','Sign in']);assert(!document.body.textContent.includes('Private workspace'));
    await act(async()=>buttons[0].click());await act(async()=>buttons[1].click());assert.deepEqual(globalThis.__mabEntryActions,['register','signin']);
  }finally{if(root)await act(async()=>root.unmount());dom.window.close();await rm(directory,{recursive:true,force:true});}
});
