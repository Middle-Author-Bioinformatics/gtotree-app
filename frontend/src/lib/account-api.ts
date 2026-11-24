import {ACCOUNT_API,validApiBase} from './account-config';
import {accessToken} from './account-session';
export interface Profile {name:string;email:string;institution:string;position:string;favorite_software:string;research_area:string;last_seen?:string;last_app?:string;created_at?:string;}
export interface ProfileResult {identity:{name:string;email:string};profile:Profile|null;complete:boolean;admin:boolean;}
export async function accountFetch(path:string,options:RequestInit={}):Promise<Response>{
  if(!validApiBase(ACCOUNT_API)||!path.startsWith('/')||path.startsWith('//'))throw new Error('Account service unavailable.');
  const headers=new Headers(options.headers);headers.set('Authorization','Bearer '+await accessToken());
  const response=await fetch(ACCOUNT_API+path,{...options,headers,credentials:'omit',cache:'no-store',redirect:'error'});
  if(response.status===401)window.dispatchEvent(new Event('mab-sign-in-required'));
  if(response.status===403){try{const data=await response.clone().json();if(data.code==='profile_required')window.dispatchEvent(new Event('mab-profile-required'));}catch{/* Generic response below. */}}
  return response;
}
export async function accountJson<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await accountFetch(path,options),data=await response.json();
  if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Account service unavailable.');
  return data as T;
}
export async function downloadAccountArtifact(path:string,filename:string){
  const response=await accountFetch(path);if(!response.ok)throw new Error('Download unavailable.');
  const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function csvCell(value:unknown):string {
  let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}
