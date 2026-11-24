import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const state='d'.repeat(32),authorization='https://accounts.example/oauth2/authorize?state='+state;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function harness(t,respond){
  const directory=await mkdtemp(fileURLToPath(new URL('./.relay-',import.meta.url))),requests=[],navigations=[];
  const popup={closed:true,location:{replace(url){navigations.push(url);}},close(){}};
  globalThis.window={location:{origin:'https://app.example',search:'',href:'https://app.example/'},open(){return popup;},history:{replaceState(){}}};
  globalThis.fetch=async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return respond(String(url).split('/').pop(),JSON.parse(options.body),options);};
  await build({entryPoints:[fileURLToPath(new URL('../src/lib/account-popup.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',outfile:directory+'/popup.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_API_BASE:'https://relay.example',VITE_MAB_COGNITO_DOMAIN:'https://accounts.example'})},logLevel:'silent'});
  const api=await import(pathToFileURL(directory+'/popup.mjs'));t.after(async()=>{api.cancelPopupSignIn();await rm(directory,{recursive:true,force:true});});
  return {api,requests,navigations,popup};
}
test('relay navigator ignores isolated WindowProxy.closed and needs no opener, storage or broadcast channel',async t=>{
  const h=await harness(t,action=>json(action==='start'?{expires_at:Date.now()/1000+600}:action==='read'?{ready:true,state,code:'opaque-code'}:{}));
  const handle=await new h.api.RelayPopupNavigator().prepare();
  const result=await handle.navigate({url:authorization,state});
  assert.equal(new URL(result.url).searchParams.get('code'),'opaque-code');assert.equal(new URL(result.url).searchParams.get('state'),state);
  assert.equal(h.navigations.length,1);assert.match(new URL(h.navigations[0]).searchParams.get('state'),/^mabpopup2\./);
  const start=h.requests.find(r=>r.url.endsWith('/start')).body,read=h.requests.find(r=>r.url.endsWith('/read')).body;
  assert.notEqual(start.read_hash,read.secret);assert.notEqual(start.write_hash,start.read_hash);assert.equal(start.code_verifier,undefined);assert.equal(start.access_token,undefined);
});
test('an unavailable or old backend never sends the popup to Cognito',async t=>{
  const h=await harness(t,()=>json({error:'sign_in_required'},401));
  const handle=await new h.api.RelayPopupNavigator().prepare();await assert.rejects(handle.navigate({url:authorization,state}),/full page/);assert.equal(h.navigations.length,0);
});
test('a returned state mismatch cannot reach the OIDC token exchange',async t=>{
  const h=await harness(t,action=>json(action==='read'?{ready:true,state:'e'.repeat(32),code:'wrong'}:{}));
  const handle=await new h.api.RelayPopupNavigator().prepare();await assert.rejects(handle.navigate({url:authorization,state}),/Invalid sign-in response/);
  assert(h.requests.every(r=>!String(r.url).endsWith('/token')));
});
test('cancel aborts a pending disconnected popup and removes its relay ticket',async t=>{
  let onRead;const reading=new Promise(resolve=>{onRead=resolve;});
  const h=await harness(t,action=>{if(action==='read')onRead();return json(action==='read'?{ready:false}:{});});
  const handle=await new h.api.RelayPopupNavigator().prepare(),pending=handle.navigate({url:authorization,state});
  await reading;h.api.cancelPopupSignIn();await assert.rejects(pending,/cancel/i);await new Promise(resolve=>setTimeout(resolve,0));
  assert(h.requests.some(r=>r.url.endsWith('/cancel')));
});
test('popup callbacks reject malformed state and conflicting code/error before contacting the service',async t=>{
  const h=await harness(t,()=>{throw new Error('Unexpected network request');});
  assert.equal(h.api.isRelayCallback(new URLSearchParams('state=forged')),false);
  window.location.search='?state=mabpopup2.'+'a'.repeat(64)+'.'+'b'.repeat(64)+'.'+state+'&code=one&error=access_denied';
  await assert.rejects(h.api.finishRelayCallback(),/Invalid/);assert.equal(h.requests.length,0);
});
test('an unexpected authorization host is rejected before registration or navigation',async t=>{
  const h=await harness(t,()=>{throw new Error('Unexpected network request');});
  const handle=await new h.api.RelayPopupNavigator().prepare();await assert.rejects(handle.navigate({url:'https://evil.example/oauth2/authorize',state}),/destination/);
  assert.equal(h.requests.length,0);assert.equal(h.navigations.length,0);
});
