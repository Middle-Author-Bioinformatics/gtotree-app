import {safeReturnTo} from './account-config';
export const POPUP_STATE='mab-popup-v1';
export const SIGNOUT_BLOCKED='The sign-out window was blocked. Finish signing out using the link below.';
export function isEmbedded():boolean{try{return window.self!==window.top;}catch{return true;}}
export function standaloneUrl():string{return window.location.origin+safeReturnTo(window.location.href);}
export function isPopupCallback(params:URLSearchParams):boolean{return (params.get('state')??'').endsWith(';'+POPUP_STATE);}
export function logoutStartUrl():string{const target=new URL('/',window.location.origin);target.searchParams.set('mab-signout','1');return target.href;}
/** Logout starts on our own origin, so both its first-party and embedded stores clear. */
export function openLogoutWindow():Window|null{
  const popup=window.open(logoutStartUrl(),'mab-signout-'+window.location.hostname,'popup,width=520,height=700');
  if(!popup)return null;
  const started=Date.now();
  const timer=setInterval(()=>{
    if(popup.closed||Date.now()-started>60000){clearInterval(timer);return;}
    try{
      // Only close after Cognito has returned to the registered app sign-out URL.
      if(popup.location.origin===window.location.origin&&!new URLSearchParams(popup.location.search).has('mab-signout')){popup.close();clearInterval(timer);}
    }catch{/* Cognito is a different origin while sign-out is in progress. */}
  },200);
  return popup;
}
