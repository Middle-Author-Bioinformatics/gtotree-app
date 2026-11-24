import {createContext,useContext,useEffect,useState,type ReactNode,type FormEvent} from 'react';
import type {User} from 'oidc-client-ts';
import {ACCOUNT_ENABLED,ACCOUNT_API,ACCOUNT_CLIENT,POSITIONS,validApiBase} from '../lib/account-config';
import {accountManager,initializeAccount,createFreeAccount,signIn,signOut} from '../lib/account-session';
import {accountJson,csvCell,type Profile,type ProfileResult} from '../lib/account-api';

interface AccountState {user:User|null;data:ProfileResult|null;busy:boolean;error:string;editing:boolean;adminView:boolean;reload:()=>Promise<void>;edit:()=>void;users:()=>void;close:()=>void;}
const AccountContext=createContext<AccountState|null>(null);
export function AccountProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(null),[data,setData]=useState<ProfileResult|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(false),[adminView,setAdminView]=useState(false);
  async function loadProfile(){setBusy(true);setError('');try{setData(await accountJson<ProfileResult>('/profile'));setEditing(false);}catch{setError('Your account could not be loaded. Please try again.');}finally{setBusy(false);}}
  useEffect(()=>{
    if(!ACCOUNT_CLIENT){setBusy(false);return;}
    let active=true,initialized=false,userSub:string|undefined;
    const signedOut=()=>{userSub=undefined;setUser(null);setData(null);setBusy(false);setError('');setEditing(false);setAdminView(false);};
    const required=()=>{setEditing(true);};
    window.addEventListener('mab-sign-in-required',signedOut);window.addEventListener('mab-profile-required',required);
    const loaded=(next:User)=>{if(!active||!initialized)return;setUser(next);if(userSub!==next.profile.sub){userSub=next.profile.sub;setData(null);setAdminView(false);setEditing(false);void loadProfile();}};
    accountManager().events.addUserLoaded(loaded);
    accountManager().events.addUserUnloaded?.(signedOut);
    void initializeAccount().then(async next=>{if(!active)return;initialized=true;if(!next){setBusy(false);return;}userSub=next.profile.sub;setUser(next);await loadProfile();}).catch(()=>{if(active){setError('Sign-in could not be completed. Please try again.');setBusy(false);}});
    return()=>{active=false;window.removeEventListener('mab-sign-in-required',signedOut);window.removeEventListener('mab-profile-required',required);accountManager().events.removeUserLoaded(loaded);accountManager().events.removeUserUnloaded?.(signedOut);};
  },[]);
  return <AccountContext.Provider value={{user,data,busy,error,editing,adminView,reload:loadProfile,edit:()=>setEditing(true),users:()=>setAdminView(true),close:()=>{setEditing(false);setAdminView(false);}}}>{children}</AccountContext.Provider>;
}
export function AccountControls(){
  const account=useContext(AccountContext);
  const [open,setOpen]=useState(false);
  if(!account?.user)return null;
  return <div className="relative"><button className="btn-ghost" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Account</button>{open&&<div className="absolute right-0 top-full mt-2 p-2 bg-surface border border-border rounded-md shadow-lg min-w-40 z-40 flex flex-col gap-1" onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}><button className="btn-ghost text-left" onClick={()=>{setOpen(false);account.edit();}}>Profile</button>{account.data?.admin&&<button className="btn-ghost text-left" onClick={()=>{setOpen(false);account.users();}}>Users</button>}<button className="btn-ghost text-left" onClick={()=>void signOut()}>Sign out</button></div>}</div>;
}
export function AccountGate({children,header}:{children:ReactNode;header?:ReactNode}){
  const account=useContext(AccountContext);
  if(!ACCOUNT_ENABLED)return <>{children}</>;
  if(!account)throw new Error('Account provider missing');
  let content;
  if(!validApiBase(ACCOUNT_API)||!ACCOUNT_CLIENT)content=<p role="alert">Account service unavailable.</p>;
  else if(account.busy)content=<p role="status">Loading account…</p>;
  else if(!account.user)content=<AccountEntry error={account.error}/>;
  else if(account.error)content=<section className="panel panel-bd" role="alert">{account.error} <button className="btn-ghost" onClick={()=>void account.reload()}>Retry</button></section>;
  else if(!account.data?.complete||account.editing)content=<ProfileForm account={account}/>;
  else if(account.adminView)content=<AdminUsers onBack={account.close}/>;
  else return <>{children}</>;
  return <div className="min-h-full mab-account-shell">{header}<main className="max-w-7xl mx-auto px-6 py-8">{content}</main></div>;
}
function AccountEntry({error}:{error:string}){
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState('');
  async function enter(register:boolean){setBusy(true);setFailure('');try{await (register?createFreeAccount():signIn());}catch{setFailure('Sign-in is unavailable. Please try again.');}finally{setBusy(false);}}
  return <section className="panel panel-bd max-w-lg mx-auto space-y-4"><h1 className="text-xl font-semibold">MAB account</h1>{(failure||error)&&<p role="alert">{failure||error}</p>}<div className="flex gap-3"><button className="btn-primary" disabled={busy} onClick={()=>void enter(true)}>Create free account</button><button className="btn-ghost" disabled={busy} onClick={()=>void enter(false)}>Sign in</button></div></section>;
}
function ProfileForm({account}:{account:AccountState}){
  const data=account.data,initial=data?.profile;
  const [institution,setInstitution]=useState(initial?.institution??''),[position,setPosition]=useState(initial?.position??''),[software,setSoftware]=useState(initial?.favorite_software??''),[research,setResearch]=useState(initial?.research_area??''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setSaving(true);setError('');try{await accountJson('/profile',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({institution,position,favorite_software:software,research_area:research})});await account.reload();}catch(error){setError(error instanceof Error?error.message:'Profile could not be saved.');}finally{setSaving(false);}}
  return <form onSubmit={submit} className="panel panel-bd max-w-xl mx-auto space-y-4"><h1 className="text-xl font-semibold">Your MAB profile</h1>
    <label className="block text-sm">Full name<input className="field w-full mt-1" value={data?.identity.name??''} readOnly required/></label>
    <label className="block text-sm">Verified email<input className="field w-full mt-1" value={data?.identity.email??''} readOnly required/></label>
    <label className="block text-sm">Institution / company<input className="field w-full mt-1" required maxLength={200} value={institution} onChange={e=>setInstitution(e.target.value)} placeholder="Institution, company or Independent"/></label>
    <label className="block text-sm">Position<select className="field w-full mt-1" required value={position} onChange={e=>setPosition(e.target.value)}><option value="">Select position</option>{POSITIONS.map(role=><option key={role}>{role}</option>)}</select></label>
    <label className="block text-sm">Favorite bioinformatics software <span className="text-fg-muted">(optional)</span><input className="field w-full mt-1" maxLength={300} value={software} onChange={e=>setSoftware(e.target.value)}/></label>
    <label className="block text-sm">Main research area <span className="text-fg-muted">(optional)</span><input className="field w-full mt-1" maxLength={500} value={research} onChange={e=>setResearch(e.target.value)}/></label>
    {error&&<p role="alert" className="text-danger text-sm">{error}</p>}
    <div className="flex gap-2"><button className="btn-primary" disabled={saving||!institution.trim()||!position}>{saving?'Saving…':'Save profile'}</button>{data?.complete&&<button type="button" className="btn-ghost" onClick={account.close}>Cancel</button>}</div>
  </form>;
}
function AdminUsers({onBack}:{onBack:()=>void}){
  const [users,setUsers]=useState<Profile[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(next?:string){setBusy(true);setError('');try{const data=await accountJson<{users:Profile[];cursor:string|null}>('/admin/users'+(next?'?cursor='+encodeURIComponent(next):''));setUsers(prev=>next?[...prev,...data.users]:data.users);setCursor(data.cursor);}catch{setError('Users could not be loaded.');}finally{setBusy(false);}}
  useEffect(()=>{void load();},[]);
  function download(){const columns=['name','email','institution','position','favorite_software','research_area','created_at','last_seen','last_app'] as const;const csv=[columns.map(csvCell).join(','),...users.map(user=>columns.map(key=>csvCell(user[key])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='mab-users.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <section className="panel panel-bd space-y-4"><div className="flex flex-wrap items-center gap-3"><button className="btn-ghost" onClick={onBack}>Back</button><h1 className="text-xl font-semibold">MAB users</h1><button className="btn-ghost ml-auto" onClick={download} disabled={!users.length||busy}>Export loaded users</button></div>{error&&<p role="alert">{error}</p>}<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Name','Email','Institution','Position','Software','Research area','Last active'].map(label=><th key={label} className="text-left p-2">{label}</th>)}</tr></thead><tbody>{users.map(user=><tr key={user.email}>{[user.name,user.email,user.institution,user.position,user.favorite_software,user.research_area,user.last_seen].map((value,i)=><td key={i} className="p-2">{value||'—'}</td>)}</tr>)}</tbody></table></div>{cursor&&<button className="btn-ghost" disabled={busy} onClick={()=>void load(cursor)}>Load more</button>}{busy&&<p role="status">Loading…</p>}</section>;
}
