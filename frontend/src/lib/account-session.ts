import {UserManager,WebStorageStateStore,User,ErrorResponse} from 'oidc-client-ts';
import {ACCOUNT_POOL,ACCOUNT_CLIENT,ACCOUNT_DOMAIN,safeReturnTo} from './account-config';
import {isEmbedded,isPopupCallback,POPUP_STATE,openLogoutWindow,SIGNOUT_BLOCKED} from './account-window';
let manager:UserManager|undefined;
const authority=`https://cognito-idp.${ACCOUNT_POOL.split('_')[0]}.amazonaws.com/${ACCOUNT_POOL}`;
const userKey=`user:${authority}:${ACCOUNT_CLIENT}`;
const signedOutKey=`mab-signed-out:${ACCOUNT_CLIENT}`;
const checkingKey=`mab-sso-check:${ACCOUNT_CLIENT}`;
let rememberedStorage:Storage|undefined;
let tabStore:Storage|undefined;
function tabStorage():Storage{
  if(tabStore)return tabStore;
  try{const storage=window.sessionStorage;storage.setItem('mab-tab-check','1');storage.removeItem('mab-tab-check');return tabStore=storage;}
  catch{
    // Some browsers block all embedded storage. The current window can still sign in.
    const values=new Map<string,string>();
    return tabStore={get length(){return values.size;},clear(){values.clear();},getItem:key=>values.get(key)??null,key:index=>Array.from(values.keys())[index]??null,removeItem:key=>{values.delete(key);},setItem:(key,value)=>{values.set(key,value);}};
  }
}
function persistentStorage():Storage {
  if(rememberedStorage)return rememberedStorage;
  try{const storage=window.localStorage,key='mab-storage-check';storage.setItem(key,'1');storage.removeItem(key);return rememberedStorage=storage;}
  catch{return rememberedStorage=tabStorage();}
}
export function accountManager():UserManager {
  if(!ACCOUNT_CLIENT)throw new Error('Account client is not configured.');
  if(!manager){manager=new UserManager({
    authority,
    client_id:ACCOUNT_CLIENT,redirect_uri:window.location.origin+'/',response_type:'code',scope:'openid email profile',
    userStore:new WebStorageStateStore({store:persistentStorage()}),stateStore:new WebStorageStateStore({store:tabStorage()}),
    popup_redirect_uri:window.location.origin+'/',
    automaticSilentRenew:!isEmbedded(),loadUserInfo:true,
  });
    const mgr=manager;
    mgr.events.addUserLoaded(user=>{if(persistentStorage().getItem(signedOutKey))void forgetUser();else if(user.refresh_token)mgr.startSilentRenew();else if(isEmbedded())mgr.stopSilentRenew();});
    window.addEventListener('storage',event=>{
      if((event.key===null||event.key==='oidc.'+userKey)&&event.newValue===null){void forgetUser();return;}
      if(event.key===null||event.key==='oidc.'+userKey)void mgr.getUser(true).then(user=>{
        if(!user)window.dispatchEvent(new Event('mab-sign-in-required'));
      }).catch(()=>{/* Retry session synchronization on the next visit or focus. */});
    });
    window.addEventListener('mab-sign-in-required',()=>{void forgetUser();});
    const resume=()=>{void rememberedUser().then(user=>{
      if(user&&!user.expired)void mgr.getUser(true);
    }).catch(()=>{/* Keep a remembered session during temporary network failures. */});};
    window.addEventListener('focus',resume);window.addEventListener('online',resume);
  }
  return manager;
}
function restoreLocation(value:unknown){window.history.replaceState({},'',safeReturnTo(value));window.dispatchEvent(new Event('hashchange'));}
async function beforeRedirect(){
  // GToTree registers its genome transfer here, before navigation can sever its opener.
  const pending:Promise<unknown>[]=[];
  window.dispatchEvent(new CustomEvent('mab-before-sign-in',{detail:{waitUntil:(task:Promise<unknown>)=>pending.push(task)}}));
  if(pending.length){
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([Promise.all(pending),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Genome transfer is still in progress. Try again.')),5000);})]);}
    finally{if(timeout)clearTimeout(timeout);}
  }
}
async function redirectToAccount(check=false){
  if(!isEmbedded())await beforeRedirect();
  const state={returnTo:safeReturnTo(window.location.href),ssoCheck:check};
  if(check)tabStorage().setItem(checkingKey,String(Date.now()));
  else {tabStorage().removeItem(checkingKey);persistentStorage().removeItem(signedOutKey);}
  const mgr=accountManager();
  if(isEmbedded())return mgr.signinPopup({state,url_state:POPUP_STATE,popupAbortOnClose:true,popupWindowFeatures:{width:520,height:700}});
  return mgr.signinRedirect({state,...(check?{prompt:'none'}:{})});
}
let renewal:Promise<User|null>|undefined;
async function forgetUser(){await accountManager().removeUser();await new WebStorageStateStore({store:tabStorage()}).remove(userKey);}
async function rememberedUser():Promise<User|null>{
  const mgr=accountManager();if(persistentStorage().getItem(signedOutKey)){await forgetUser();return null;}let user=await mgr.getUser();
  if(!user){
    const legacy=new WebStorageStateStore({store:tabStorage()}),saved=await legacy.get(userKey);
    if(saved){user=User.fromStorageString(saved);await mgr.storeUser(user);await legacy.remove(userKey);user=await mgr.getUser();}
  }
  if(user?.expired){
    if(!user.refresh_token){await forgetUser();return null;}
    renewal??=mgr.signinSilent().catch(async error=>{
      if(error instanceof ErrorResponse&&['invalid_grant','invalid_token'].includes(error.error??'')){await forgetUser();return null;}
      throw error;
    }).finally(()=>{renewal=undefined;});
    user=await renewal;
  }
  if(user?.refresh_token)mgr.startSilentRenew();
  return user;
}
let initialization:Promise<User|null>|undefined;
export function initializeAccount():Promise<User|null> {
  if(!initialization)initialization=(async()=>{
    const mgr=accountManager(),params=new URLSearchParams(window.location.search);
    if(params.get('mab-signout')==='1'&&!isEmbedded()){await signOut();return null;}
    if(isPopupCallback(params)){await mgr.signinPopupCallback();return null;}
    if(params.has('state')&&(params.has('code')||params.has('error'))){
      try{
        const user=await mgr.signinRedirectCallback();tabStorage().removeItem(checkingKey);restoreLocation((user.state as {returnTo?:unknown})?.returnTo);
        if(persistentStorage().getItem(signedOutKey)){await forgetUser();return null;}return user;
      }catch(error){
        const state=error instanceof ErrorResponse?error.state as {returnTo?:unknown;ssoCheck?:boolean}|undefined:undefined;
        if(state?.ssoCheck&&['login_required','interaction_required','consent_required','account_selection_required'].includes((error as ErrorResponse).error??'')){
          tabStorage().removeItem(checkingKey);restoreLocation(state.returnTo);return null;
        }
        restoreLocation('/');throw new Error('Sign-in could not be completed. Please try again.');
      }
    }
    const user=await rememberedUser();if(user)return user;
    // Cognito disallows framing. A user-initiated popup is required in an embedded app.
    if(isEmbedded())return null;
    // Once per navigation. A missing Cognito session returns to the free-account screen.
    // The short in-flight guard also stops a broken callback from causing a redirect loop.
    const attempted=Number(tabStorage().getItem(checkingKey)||0);
    if(persistentStorage().getItem(signedOutKey)||Date.now()-attempted<60000)return null;
    await redirectToAccount(true);return null;
  })();
  return initialization;
}
export async function createFreeAccount(){
  if(!isEmbedded())await beforeRedirect();
  persistentStorage().removeItem(signedOutKey);tabStorage().removeItem(checkingKey);
  const mgr=accountManager();
  // Cognito's documented /signup endpoint takes the same OAuth/PKCE parameters.
  // Keep the library's state store and verifier so the ordinary callback validates it.
  const signup=new UserManager({...mgr.settings,metadata:undefined,metadataSeed:{...mgr.settings.metadataSeed,authorization_endpoint:ACCOUNT_DOMAIN+'/signup'}});
  const state={returnTo:safeReturnTo(window.location.href)};
  if(isEmbedded()){
    try{
      const user=await signup.signinPopup({state,url_state:POPUP_STATE,popupAbortOnClose:true,popupWindowFeatures:{width:520,height:700}});
      await mgr.storeUser(user);await mgr.getUser(true);return;
    }finally{signup.stopSilentRenew();await signup.events.unload();}
  }
  return signup.signinRedirect({state});
}
export function signIn(){return redirectToAccount();}
export async function accessToken():Promise<string> {
  const mgr=accountManager(),user=await rememberedUser();
  if(!user||user.expired){await forgetUser();window.dispatchEvent(new Event('mab-sign-in-required'));throw new Error('Sign in to your MAB account.');}
  return user.access_token;
}
export async function signOut(){
  const embedded=isEmbedded(),popup=embedded?openLogoutWindow():null;
  persistentStorage().setItem(signedOutKey,'1');tabStorage().removeItem(checkingKey);
  const mgr=accountManager();mgr.stopSilentRenew();try{await mgr.revokeTokens(['refresh_token']);}catch{/* Local removal and Cognito logout still run. */}
  await forgetUser();
  if(embedded){if(!popup)window.dispatchEvent(new CustomEvent('mab-account-error',{detail:SIGNOUT_BLOCKED}));return;}
  const url=new URL(ACCOUNT_DOMAIN+'/logout');url.searchParams.set('client_id',ACCOUNT_CLIENT);url.searchParams.set('logout_uri',window.location.origin+'/');window.location.assign(url.href);
}
