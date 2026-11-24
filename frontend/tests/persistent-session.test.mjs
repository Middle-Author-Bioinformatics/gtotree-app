import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {User} from 'oidc-client-ts';

const issuer='https://cognito-idp.us-east-2.amazonaws.com/us-east-2_VzCBot5S3',client='test-client';
const key='oidc.user:'+issuer+':'+client;
const profile={iss:issuer,aud:client,sub:'member',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
const jwt=p=>Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.signature';
const user=(expired=false)=>new User({id_token:jwt(profile),access_token:'access-old',refresh_token:'refresh-token',token_type:'Bearer',scope:'openid email profile',profile,expires_at:Math.floor(Date.now()/1000)+(expired?-60:3600)});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
async function harness(t,{url='https://app.example/?result=Example123#/results/Example123',local,session,fetcher,storageBlocked=false,embedded=false,tabBlocked=false}={}){
  const dom=new JSDOM('',{url}),events=new EventTarget(),navigations=[],requests=[];
  const location={};
  function setLocation(value){const next=new URL(value,location.href||url);Object.assign(location,{href:next.href,origin:next.origin,search:next.search,hash:next.hash,pathname:next.pathname});}
  setLocation(url);location.assign=value=>{navigations.push(new URL(value));events.dispatchEvent(new Event('pageshow'));};
  const win={location,sessionStorage:session||dom.window.sessionStorage,localStorage:local||dom.window.localStorage,history:{replaceState(a,b,value){setLocation(value);}},addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),stop(){}};
  win.self=win;win.top=embedded?{}:win;
  if(storageBlocked)Object.defineProperty(win,'localStorage',{get(){throw new Error('blocked');}});
  if(tabBlocked)Object.defineProperty(win,'sessionStorage',{get(){throw new Error('blocked');}});
  Object.assign(globalThis,{window:win});
  globalThis.fetch=async(url,options={})=>{
    requests.push({url:String(url),options});
    if(String(url).includes('.well-known'))return json({issuer,authorization_endpoint:'https://accounts.example/oauth2/authorize',token_endpoint:'https://accounts.example/oauth2/token',userinfo_endpoint:'https://accounts.example/oauth2/userInfo',revocation_endpoint:'https://accounts.example/oauth2/revoke',jwks_uri:'https://accounts.example/keys'});
    if(String(url).endsWith('/userInfo'))return json({sub:'member',name:'Scientist',email:'scientist@example.org',email_verified:true});
    if(String(url).endsWith('/revoke'))return new Response('');
    if(fetcher)return fetcher(url,options);
    throw new Error('Unexpected request '+url);
  };
  const directory=await mkdtemp(fileURLToPath(new URL('./.session-',import.meta.url)));
  await build({entryPoints:[fileURLToPath(new URL('../src/lib/account-session.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',packages:'external',outfile:directory+'/session.mjs',define:{'import.meta.env':JSON.stringify({VITE_MAB_CLIENT_ID:client,VITE_MAB_COGNITO_DOMAIN:'https://accounts.example'})},logLevel:'silent'});
  const api=await import(pathToFileURL(directory+'/session.mjs'));
  t.after(async()=>{api.accountManager().stopSilentRenew();await api.accountManager().events.unload();dom.window.close();await rm(directory,{recursive:true,force:true});});
  return {api,win,navigations,requests,setLocation,dom};
}

test('a remembered account survives a new tab/revisit without OAuth; old tab sessions migrate',async t=>{
  const first=await harness(t);first.win.sessionStorage.setItem(key,user().toStorageString());
  assert.equal((await first.api.initializeAccount()).profile.sub,'member');
  assert(first.win.localStorage.getItem(key));assert.equal(first.win.sessionStorage.getItem(key),null);assert.equal(first.navigations.length,0);
  const next=await harness(t,{local:first.win.localStorage});
  assert.equal((await next.api.initializeAccount()).access_token,'access-old');assert.equal(next.navigations.length,0);
});
test('expired saved access tokens refresh before the gate opens, with no password or iframe',async t=>{
  let refreshed=0;
  const h=await harness(t,{fetcher:(url,options)=>{
    assert(String(url).endsWith('/token'));const body=new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'),'refresh_token');assert.equal(body.get('refresh_token'),'refresh-token');assert.equal(body.get('client_id'),client);assert(!body.has('password'));refreshed++;
    return json({access_token:'access-new',id_token:jwt(profile),expires_in:3600,token_type:'Bearer'});
  }});
  h.win.localStorage.setItem(key,user(true).toStorageString());
  const loaded=await h.api.initializeAccount();assert.equal(loaded.access_token,'access-new');assert.equal(await h.api.accessToken(),'access-new');assert.equal(refreshed,1);assert.equal(h.navigations.length,0);
});
test('the open app renews tokens in the background before expiry',async t=>{
  let refreshed=0;
  const h=await harness(t,{fetcher:()=>{refreshed++;return json({access_token:'background-access',id_token:jwt(profile),expires_in:3600,token_type:'Bearer'});}});
  const ending=user();ending.expires_at=Math.floor(Date.now()/1000)+1;h.win.localStorage.setItem(key,ending.toStorageString());
  await h.api.initializeAccount();await new Promise(resolve=>setTimeout(resolve,1400));
  assert.equal(refreshed,1);assert.equal((await h.api.accountManager().getUser()).access_token,'background-access');assert.equal(h.navigations.length,0);
});
test('a first app visit checks shared Cognito login automatically and validates a no-session callback without loops',async t=>{
  const h=await harness(t);await h.api.initializeAccount();await h.api.initializeAccount();
  assert.equal(h.navigations.length,1);const redirect=h.navigations[0];assert.equal(redirect.searchParams.get('prompt'),'none');assert.equal(redirect.searchParams.get('code_challenge_method'),'S256');
  const state=redirect.searchParams.get('state');
  const callback=await harness(t,{local:h.win.localStorage,session:h.win.sessionStorage,url:'https://app.example/?error=login_required&state='+state});
  assert.equal(await callback.api.initializeAccount(),null);assert.equal(callback.win.location.href,'https://app.example/?result=Example123#/results/Example123');assert.equal(callback.navigations.length,0);
  assert.equal(await callback.api.initializeAccount(),null);assert.equal(callback.navigations.length,0);
});
test('a successful shared Cognito session signs in without a button click and restores the result route',async t=>{
  const h=await harness(t);await h.api.initializeAccount();const request=h.navigations[0];
  const callback=await harness(t,{local:h.win.localStorage,session:h.win.sessionStorage,url:'https://app.example/?code=shared-session-code&state='+request.searchParams.get('state'),fetcher:(url,options)=>{
    assert(String(url).endsWith('/token'));const body=new URLSearchParams(options.body);assert.equal(body.get('grant_type'),'authorization_code');assert.equal(body.get('code'),'shared-session-code');assert(body.get('code_verifier'));
    return json({access_token:'shared-access',refresh_token:'shared-refresh',id_token:jwt(profile),token_type:'Bearer',expires_in:3600});
  }});
  assert.equal((await callback.api.initializeAccount()).access_token,'shared-access');assert.equal(callback.win.location.href,'https://app.example/?result=Example123#/results/Example123');assert.equal(callback.navigations.length,0);
  assert(callback.win.localStorage.getItem(key));assert.equal(callback.win.location.search.includes('code='),false);
});
test('an unknown or forged OAuth error state cannot bypass callback validation',async t=>{
  const h=await harness(t,{url:'https://app.example/?error=login_required&state=forged'});
  await assert.rejects(h.api.initializeAccount(),/Sign-in could not be completed/);assert.equal(h.navigations.length,0);
});
test('transient refresh errors preserve the saved account and never start a new login',async t=>{
  const h=await harness(t,{fetcher:()=>{throw new Error('offline');}});h.win.localStorage.setItem(key,user(true).toStorageString());
  await assert.rejects(h.api.initializeAccount(),/offline/);assert(h.win.localStorage.getItem(key));assert.equal(h.navigations.length,0);
});
test('revoked refresh tokens are discarded before one shared-session recovery attempt',async t=>{
  const h=await harness(t,{fetcher:()=>json({error:'invalid_grant'},400)});h.win.localStorage.setItem(key,user(true).toStorageString());
  assert.equal(await h.api.initializeAccount(),null);assert.equal(h.win.localStorage.getItem(key),null);assert.equal(h.navigations.length,1);assert.equal(h.navigations[0].searchParams.get('prompt'),'none');
});
test('sign-out removes remembered and legacy credentials and suppresses immediate automatic sign-in',async t=>{
  const h=await harness(t);h.win.localStorage.setItem(key,user().toStorageString());h.win.sessionStorage.setItem(key,user().toStorageString());
  await h.api.signOut();assert.equal(h.win.localStorage.getItem(key),null);assert.equal(h.win.sessionStorage.getItem(key),null);assert.equal(h.navigations[0].pathname,'/logout');
  // A token refresh already in flight must not restore the signed-out account.
  await h.api.accountManager().storeUser(user());await h.api.accountManager().getUser(true);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.win.localStorage.getItem(key),null);
  const next=await harness(t,{local:h.win.localStorage,session:h.win.sessionStorage});assert.equal(await next.api.initializeAccount(),null);assert.equal(next.navigations.length,0);
  // An explicit later sign-in in another tab clears the shared logout marker.
  await next.api.signIn();await h.api.accountManager().storeUser(user());await h.api.accountManager().getUser(true);await new Promise(resolve=>setTimeout(resolve,0));assert(h.win.localStorage.getItem(key));
});
test('sign-out in another tab clears this tab rather than restoring its old legacy session',async t=>{
  const h=await harness(t);h.win.localStorage.setItem(key,user().toStorageString());await h.api.initializeAccount();
  h.win.sessionStorage.setItem(key,user().toStorageString());h.win.localStorage.removeItem(key);
  const changed=new Event('storage');Object.assign(changed,{key});h.win.dispatchEvent(changed);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.win.sessionStorage.getItem(key),null);assert.equal(await h.api.accountManager().getUser(),null);
});
test('blocked persistent storage falls back to an existing tab session',async t=>{
  const h=await harness(t,{storageBlocked:true});h.win.sessionStorage.setItem(key,user().toStorageString());
  assert.equal((await h.api.initializeAccount()).profile.sub,'member');assert.equal(h.navigations.length,0);
});
test('OAuth navigation waits for the genome handoff and saves the clean return route',async t=>{
  const h=await harness(t,{url:'https://app.example/#mab-import=nonce&source=https%3A%2F%2Ftaxon.example'});
  let finish;const transferred=new Promise(resolve=>{finish=resolve;});h.win.addEventListener('mab-before-sign-in',event=>event.detail.waitUntil(transferred));
  const initializing=h.api.initializeAccount();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(h.navigations.length,0);
  h.setLocation('/');finish();await initializing;
  const saved=JSON.parse(h.win.sessionStorage.getItem('oidc.'+h.navigations[0].searchParams.get('state')));assert.equal(saved.data.returnTo,'/');
});

test('an embedded anonymous app never navigates its iframe to Cognito or opens an automatic popup',async t=>{
  const h=await harness(t,{embedded:true});h.win.open=()=>{throw new Error('No automatic popups');};
  assert.equal(await h.api.initializeAccount(),null);assert.equal(h.navigations.length,0);assert.equal(h.requests.length,0);
});
test('embedded saved sessions still restore and renew without any popup',async t=>{
  const h=await harness(t,{embedded:true,fetcher:()=>json({access_token:'embedded-new',id_token:jwt(profile),expires_in:3600,token_type:'Bearer'})});
  h.win.localStorage.setItem(key,user(true).toStorageString());h.win.open=()=>{throw new Error('No popup needed');};
  assert.equal((await h.api.initializeAccount()).access_token,'embedded-new');assert.equal(h.navigations.length,0);
});
async function embeddedPopup(t,register=false,storageBlocked=false){
  const h=await harness(t,{embedded:true,storageBlocked,tabBlocked:storageBlocked,fetcher:(url,options)=>{
    assert.equal(new URLSearchParams(options.body).get('grant_type'),'authorization_code');
    assert(new URLSearchParams(options.body).get('code_verifier'));
    return json({access_token:'popup-access',refresh_token:'popup-refresh',id_token:jwt(profile),token_type:'Bearer',expires_in:3600});
  }});
  assert.equal(await h.api.initializeAccount(),null);
  let opened=false,destination;const popup={closed:false,focus(){},close(){this.closed=true;},location:{replace(url){destination=new URL(url);}}};
  t.after(()=>popup.close());
  h.win.open=()=>{opened=true;assert.equal(h.requests.length,0,'the popup opens before metadata/network requests');return popup;};
  const signIn=register?h.api.createFreeAccount():h.api.signIn();
  assert(opened,'open during the user click, before the first async wait');
  for(let i=0;i<30&&!destination;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert(destination);assert.equal(destination.pathname,register?'/signup':'/oauth2/authorize');assert.equal(destination.searchParams.get('code_challenge_method'),'S256');
  assert.equal(destination.searchParams.get('redirect_uri'),'https://app.example/');assert(destination.searchParams.get('state').endsWith(';mab-popup-v1'));
  const callback='https://app.example/?code=popup-code&state='+encodeURIComponent(destination.searchParams.get('state'));
  const spoof=new Event('message');Object.assign(spoof,{origin:'https://evil.example',source:popup,data:{source:'oidc-client',url:callback}});h.win.dispatchEvent(spoof);
  const wrongState=new Event('message');Object.assign(wrongState,{origin:'https://app.example',source:{},data:{source:'oidc-client',url:'https://app.example/?code=forged&state=wrong'}});h.win.dispatchEvent(wrongState);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(h.requests.filter(r=>r.url.endsWith('/token')).length,0);
  const callbackWindow={location:{origin:'https://app.example',href:callback},opener:{postMessage(data,origin){
    assert.equal(origin,'https://app.example');queueMicrotask(()=>{globalThis.window=h.win;
    const message=new Event('message');Object.assign(message,{data,origin,source:popup});h.win.dispatchEvent(message);});
  }}};
  globalThis.window=callbackWindow;await h.api.accountManager().signinPopupCallback(callback);globalThis.window=h.win;
  await signIn;assert(popup.closed);assert.equal(await h.api.accessToken(),'popup-access');assert.equal(h.navigations.length,0);assert.equal(h.win.location.hash,'#/results/Example123');
  return h;
}
test('embedded sign-in uses the real OIDC popup callback and stores tokens in the opening iframe',async t=>{await embeddedPopup(t);});
test('embedded registration returns to the original iframe and updates the main account manager',async t=>{await embeddedPopup(t,true);});
test('embedded sign-in still works when a browser blocks both persistent and tab storage',async t=>{await embeddedPopup(t,false,true);});
test('popup callback relays the result without looking for the opener PKCE state in its own storage',async t=>{
  const h=await harness(t,{url:'https://app.example/?code=opaque-code&state=opaque-id%3Bmab-popup-v1'}),messages=[];
  h.win.opener={postMessage(data,origin){messages.push({data,origin});}};
  assert.equal(await h.api.initializeAccount(),null);assert.equal(messages.length,1);assert.equal(messages[0].origin,'https://app.example');assert(messages[0].data.url.includes('opaque-code'));assert.equal(h.requests.length,0);assert.equal(h.win.localStorage.getItem(key),null);
});
test('a blocked sign-in popup never redirects the embedded frame to Cognito',async t=>{
  const h=await harness(t,{embedded:true});await h.api.initializeAccount();h.win.open=()=>null;
  await assert.rejects(h.api.signIn());assert.equal(h.navigations.length,0);assert.equal(h.win.localStorage.getItem(key),null);
});
test('embedded sign-out opens a first-party logout window and leaves the iframe in place',async t=>{
  const h=await harness(t,{embedded:true});h.win.localStorage.setItem(key,user().toStorageString());await h.api.initializeAccount();
  const opened=[],popup={closed:false,location:{origin:'https://app.example',search:'?mab-signout=1'},close(){this.closed=true;}};
  h.win.open=url=>{opened.push(new URL(url));return popup;};await h.api.signOut();
  assert.equal(opened[0].searchParams.get('mab-signout'),'1');assert.equal(h.win.localStorage.getItem(key),null);assert.equal(h.navigations.length,0);assert.equal(popup.closed,false);
  popup.location.search='';await new Promise(resolve=>setTimeout(resolve,250));assert(popup.closed);
});
test('the first-party logout landing clears credentials before using the existing Cognito sign-out URL',async t=>{
  const h=await harness(t,{url:'https://app.example/?mab-signout=1'});h.win.localStorage.setItem(key,user().toStorageString());
  assert.equal(await h.api.initializeAccount(),null);assert.equal(h.win.localStorage.getItem(key),null);assert.equal(h.navigations[0].pathname,'/logout');assert.equal(h.navigations[0].searchParams.get('logout_uri'),'https://app.example/');
});
test('blocked logout windows still clear the embedded account and expose the full-page fallback',async t=>{
  const h=await harness(t,{embedded:true}),errors=[];h.win.localStorage.setItem(key,user().toStorageString());await h.api.initializeAccount();
  h.win.open=()=>null;h.win.addEventListener('mab-account-error',event=>errors.push(event.detail));await h.api.signOut();
  assert.equal(h.win.localStorage.getItem(key),null);assert.equal(h.navigations.length,0);assert.equal(errors.length,1);assert(errors[0].includes('sign-out window was blocked'));
});
