import {UserManager,WebStorageStateStore,type User} from 'oidc-client-ts';
import {ACCOUNT_POOL,ACCOUNT_CLIENT,ACCOUNT_DOMAIN,safeReturnTo} from './account-config';
let manager:UserManager|undefined;
export function accountManager():UserManager {
  if(!ACCOUNT_CLIENT)throw new Error('Account client is not configured.');
  if(!manager)manager=new UserManager({
    authority:`https://cognito-idp.${ACCOUNT_POOL.split('_')[0]}.amazonaws.com/${ACCOUNT_POOL}`,
    client_id:ACCOUNT_CLIENT,redirect_uri:window.location.origin+'/',response_type:'code',scope:'openid email profile',
    userStore:new WebStorageStateStore({store:window.sessionStorage}),stateStore:new WebStorageStateStore({store:window.sessionStorage}),
    automaticSilentRenew:false,loadUserInfo:true,
  });
  return manager;
}
let initialization:Promise<User|null>|undefined;
export function initializeAccount():Promise<User|null> {
  if(!initialization)initialization=(async()=>{
    const mgr=accountManager(),params=new URLSearchParams(window.location.search);
    if(params.has('state')&&(params.has('code')||params.has('error'))){
      try{const user=await mgr.signinRedirectCallback();window.history.replaceState({},'',safeReturnTo((user.state as {returnTo?:unknown})?.returnTo));window.dispatchEvent(new Event('hashchange'));return user;}
      catch{window.history.replaceState({},'','/');throw new Error('Sign-in could not be completed. Please try again.');}
    }
    return mgr.getUser();
  })();
  return initialization;
}
export async function createFreeAccount(){
  const mgr=accountManager();
  const metadata=await mgr.metadataService.getMetadata();
  // Cognito's documented /signup endpoint takes the same OAuth/PKCE parameters.
  // Keep the library's state store and verifier so the ordinary callback validates it.
  const signup=new UserManager({...mgr.settings,metadata:{...metadata,authorization_endpoint:ACCOUNT_DOMAIN+'/signup'}});
  return signup.signinRedirect({state:{returnTo:safeReturnTo(window.location.href)}});
}
export function signIn(){return accountManager().signinRedirect({state:{returnTo:safeReturnTo(window.location.href)}});}
let renewal:Promise<User>|undefined;
export async function accessToken():Promise<string> {
  const mgr=accountManager();let user=await mgr.getUser();
  if(user?.expired&&user.refresh_token){
    try{renewal??=mgr.signinSilent().then(value=>{if(!value)throw new Error();return value;}).finally(()=>{renewal=undefined;});user=await renewal;}catch{user=null;}
  }
  if(!user||user.expired){await mgr.removeUser();window.dispatchEvent(new Event('mab-sign-in-required'));throw new Error('Sign in to your MAB account.');}
  return user.access_token;
}
export async function signOut(){
  const mgr=accountManager();try{await mgr.revokeTokens(['refresh_token']);}catch{/* Local removal and Cognito logout still run. */}
  await mgr.removeUser();
  const url=new URL(ACCOUNT_DOMAIN+'/logout');url.searchParams.set('client_id',ACCOUNT_CLIENT);url.searchParams.set('logout_uri',window.location.origin+'/');window.location.assign(url.href);
}
