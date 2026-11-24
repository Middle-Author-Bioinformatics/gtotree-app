import type {INavigator,IWindow,NavigateParams,NavigateResponse} from 'oidc-client-ts';
import {ACCOUNT_API,ACCOUNT_DOMAIN,validApiBase} from './account-config';

const MARKER=/^mabpopup2\.([a-f0-9]{64})\.([a-f0-9]{64})\.([a-f0-9]{32})$/;
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
async function relay(action:string,body:unknown,signal?:AbortSignal):Promise<any>{
  if(!validApiBase(ACCOUNT_API))throw new Error('Account service unavailable.');
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),15000);
  const abort=()=>timeout.abort();signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)timeout.abort();
  try{
    const response=await fetch(ACCOUNT_API+'/oauth/popup/'+action,{method:'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:timeout.signal});
    if(!response.ok)throw new Error('Sign-in could not be completed. Please try again or open the full page.');
    return response.status===204?null:await response.json();
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function pause(signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('Sign-in cancelled.'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},2000);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
let active:AbortController|undefined;
export function cancelPopupSignIn(){active?.abort();}
export function isRelayCallback(params=new URLSearchParams(window.location.search)):boolean{return MARKER.test(params.get('state')??'');}
export function isPopupLanding():boolean{const p=new URLSearchParams(window.location.search);return isRelayCallback(p)||p.has('mab-popup-wait')||p.has('mab-popup-done');}
export async function finishRelayCallback():Promise<void>{
  const params=new URLSearchParams(window.location.search),match=MARKER.exec(params.get('state')??'');
  if(!match)throw new Error('Invalid sign-in response.');
  const [,id,secret,state]=match,code=params.get('code'),error=params.get('error');
  if(Boolean(code)===Boolean(error))throw new Error('Invalid sign-in response.');
  // No token or PKCE verifier leaves the original iframe. Only the one-use code is relayed.
  try{await relay('finish',{id,secret,state,...(code?{code}:{error})});}
  finally{window.history.replaceState({},'','/?mab-popup-done=1');}
  try{window.close();}catch{/* The completion screen remains if the browser prevents closing. */}
}

export class RelayPopupNavigator implements INavigator{
  async prepare():Promise<IWindow>{
    cancelPopupSignIn();
    const controller=new AbortController();active=controller;
    // Open synchronously in the user's click, before metadata or relay network requests.
    const popup=window.open(window.location.origin+'/?mab-popup-wait=1','_blank','popup,width=520,height=700');
    if(!popup){controller.abort();throw new Error('Sign-in window blocked. Open the full page.');}
    return {
      navigate:async(params:NavigateParams):Promise<NavigateResponse>=>{
        const id=random(),secret=random(),writeSecret=random();let registered=false;
        const deadline=Date.now()+600000,expiry=setTimeout(()=>controller.abort(),600000);
        try{
          if(!params.state||!/^[a-f0-9]{32}$/.test(params.state))throw new Error('Invalid sign-in state.');
          const destination=new URL(params.url);
          if(destination.origin!==new URL(ACCOUNT_DOMAIN).origin||!['/oauth2/authorize','/signup'].includes(destination.pathname))throw new Error('Invalid sign-in destination.');
          await relay('start',{id,state:params.state,read_hash:await hash(secret),write_hash:await hash(writeSecret)},controller.signal);registered=true;
          destination.searchParams.set('state',`mabpopup2.${id}.${writeSecret}.${params.state}`);
          popup.location.replace(destination.href);
          // COOP can make popup.closed true while it is open. It is not a cancellation signal.
          while(Date.now()<deadline&&!controller.signal.aborted){
            const result=await relay('read',{id,secret},controller.signal);
            if(result.ready){
              if(result.state!==params.state||Boolean(result.code)===Boolean(result.error))throw new Error('Invalid sign-in response.');
              const callback=new URL('/',window.location.origin);callback.searchParams.set('state',params.state);
              if(result.code)callback.searchParams.set('code',result.code);else callback.searchParams.set('error',result.error);
              try{popup.close();}catch{/* The callback also closes its own window. */}
              return {url:callback.href};
            }
            await pause(controller.signal);
          }
          throw new Error('Sign-in expired or was cancelled. Please try again.');
        }finally{
          clearTimeout(expiry);if(active===controller)active=undefined;
          if(registered)void relay('cancel',{id,secret}).catch(()=>{/* Consumed and expired tickets need no cleanup. */});
        }
      },
      close(){controller.abort();try{popup.close();}catch{/* Isolated windows can close themselves. */}}
    };
  }
  async callback():Promise<void>{await finishRelayCallback();}
}
