import {UserManager,WebStorageStateStore,User,ErrorResponse} from 'oidc-client-ts';
import {ACCOUNT_POOL,ACCOUNT_CLIENT,ACCOUNT_DOMAIN,safeReturnTo} from './account-config';
let manager:UserManager|undefined;
const authority=`https://cognito-idp.${ACCOUNT_POOL.split('_')[0]}.amazonaws.com/${ACCOUNT_POOL}`;
const userKey=`user:${authority}:${ACCOUNT_CLIENT}`;
const signedOutKey=`mab-signed-out:${ACCOUNT_CLIENT}`;
const checkingKey=`mab-sso-check:${ACCOUNT_CLIENT}`;
let rememberedStorage:Storage|undefined;
function persistentStorage():Storage {
  if(rememberedStorage)return rememberedStorage;
  try{const storage=window.localStorage,key='mab-storage-check';storage.setItem(key,'1');storage.removeItem(key);return rememberedStorage=storage;}
  catch{return rememberedStorage=window.sessionStorage;}
}
export function accountManager():UserManager {
  if(!ACCOUNT_CLIENT)throw new Error('Account client is not configured.');
  if(!manager){manager=new UserManager({
    authority,
    client_id:ACCOUNT_CLIENT,redirect_uri:window.location.origin+'/',response_type:'code',scope:'openid email profile',
    userStore:new WebStorageStateStore({store:persistentStorage()}),stateStore:new WebStorageStateStore({store:window.sessionStorage}),
    automaticSilentRenew:true,loadUserInfo:true,
  });
    const mgr=manager;
    mgr.events.addUserLoaded(()=>{if(persistentStorage().getItem(signedOutKey))void forgetUser();});
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
  await beforeRedirect();
  const state={returnTo:safeReturnTo(window.location.href),ssoCheck:check};
  if(check)window.sessionStorage.setItem(checkingKey,String(Date.now()));
  else {window.sessionStorage.removeItem(checkingKey);persistentStorage().removeItem(signedOutKey);}
  return accountManager().signinRedirect({state,...(check?{prompt:'none'}:{})});
}
let renewal:Promise<User|null>|undefined;
async function forgetUser(){await accountManager().removeUser();await new WebStorageStateStore({store:window.sessionStorage}).remove(userKey);}
async function rememberedUser():Promise<User|null>{
  const mgr=accountManager();if(persistentStorage().getItem(signedOutKey)){await forgetUser();return null;}let user=await mgr.getUser();
  if(!user){
    const legacy=new WebStorageStateStore({store:window.sessionStorage}),saved=await legacy.get(userKey);
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
  return user;
}
let initialization:Promise<User|null>|undefined;
export function initializeAccount():Promise<User|null> {
  if(!initialization)initialization=(async()=>{
    const mgr=accountManager(),params=new URLSearchParams(window.location.search);
    if(params.has('state')&&(params.has('code')||params.has('error'))){
      try{
        const user=await mgr.signinRedirectCallback();window.sessionStorage.removeItem(checkingKey);restoreLocation((user.state as {returnTo?:unknown})?.returnTo);
        if(persistentStorage().getItem(signedOutKey)){await forgetUser();return null;}return user;
      }catch(error){
        const state=error instanceof ErrorResponse?error.state as {returnTo?:unknown;ssoCheck?:boolean}|undefined:undefined;
        if(state?.ssoCheck&&['login_required','interaction_required','consent_required','account_selection_required'].includes((error as ErrorResponse).error??'')){
          window.sessionStorage.removeItem(checkingKey);restoreLocation(state.returnTo);return null;
        }
        restoreLocation('/');throw new Error('Sign-in could not be completed. Please try again.');
      }
    }
    const user=await rememberedUser();if(user)return user;
    // Once per navigation. A missing Cognito session returns to the free-account screen.
    // The short in-flight guard also stops a broken callback from causing a redirect loop.
    const attempted=Number(window.sessionStorage.getItem(checkingKey)||0);
    if(persistentStorage().getItem(signedOutKey)||Date.now()-attempted<60000)return null;
    await redirectToAccount(true);return null;
  })();
  return initialization;
}
export async function createFreeAccount(){
  await beforeRedirect();persistentStorage().removeItem(signedOutKey);window.sessionStorage.removeItem(checkingKey);
  const mgr=accountManager();
  const metadata=await mgr.metadataService.getMetadata();
  // Cognito's documented /signup endpoint takes the same OAuth/PKCE parameters.
  // Keep the library's state store and verifier so the ordinary callback validates it.
  const signup=new UserManager({...mgr.settings,metadata:{...metadata,authorization_endpoint:ACCOUNT_DOMAIN+'/signup'}});
  return signup.signinRedirect({state:{returnTo:safeReturnTo(window.location.href)}});
}
export function signIn(){return redirectToAccount();}
export async function accessToken():Promise<string> {
  const mgr=accountManager(),user=await rememberedUser();
  if(!user||user.expired){await forgetUser();window.dispatchEvent(new Event('mab-sign-in-required'));throw new Error('Sign in to your MAB account.');}
  return user.access_token;
}
export async function signOut(){
  persistentStorage().setItem(signedOutKey,'1');window.sessionStorage.removeItem(checkingKey);
  const mgr=accountManager();mgr.stopSilentRenew();try{await mgr.revokeTokens(['refresh_token']);}catch{/* Local removal and Cognito logout still run. */}
  await forgetUser();
  const url=new URL(ACCOUNT_DOMAIN+'/logout');url.searchParams.set('client_id',ACCOUNT_CLIENT);url.searchParams.set('logout_uri',window.location.origin+'/');window.location.assign(url.href);
}
