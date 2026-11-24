import { useEffect, useState } from "react";
import { allowedOrigin, validateSelection, type GenomeSelection } from "./genome-selection";

const PENDING_IMPORT='mab-pending-genome-import-v1';
export function useGenomeImport(persistForLogin=false) {
  const [selection,setSelection]=useState<GenomeSelection|null>(()=>{
    if(persistForLogin)return null;
    try{const saved=window.sessionStorage.getItem(PENDING_IMPORT);return saved?validateSelection(JSON.parse(saved)):null;}catch{return null;}
  });
  const [importError,setImportError]=useState("");
  useEffect(()=>{
    if(!persistForLogin)try{window.sessionStorage.removeItem(PENDING_IMPORT);}catch{/* Selection is already in component state. */}
    const params=new URLSearchParams(window.location.hash.slice(1));
    const nonce=params.get("mab-import"),source=params.get("source")||"";
    if(!nonce)return;
    const allowed=(import.meta.env.VITE_ASSEMBLY_GRASP_ORIGINS as string|undefined)||"";
    if(!/^[a-zA-Z0-9-]{16,128}$/.test(nonce)||!allowedOrigin(source,allowed)||!window.opener){
      setImportError("Automatic transfer is not available from this origin. Download the selection JSON in TaxonSlueth and import it below.");return;
    }
    const parent=window.opener;
    let finishTransfer:()=>void=()=>{};
    const transferred=new Promise<void>(resolve=>{finishTransfer=resolve;});
    const beforeSignIn=(event:Event)=>{(event as CustomEvent<{waitUntil:(task:Promise<void>)=>void}>).detail.waitUntil(transferred);};
    if(persistForLogin)window.addEventListener('mab-before-sign-in',beforeSignIn);
    const receive=(event:MessageEvent)=>{
      if(event.origin!==source||event.source!==parent||event.data?.type!=="mab:genome-selection"||event.data?.nonce!==nonce)return;
      try{
        const parsed=validateSelection(event.data.selection);
        if(persistForLogin)window.sessionStorage.setItem(PENDING_IMPORT,JSON.stringify(parsed));
        setSelection(parsed);setImportError("");
        parent.postMessage({type:"mab:gtotree-imported",nonce},source);
        window.removeEventListener("message",receive);
        history.replaceState(null,"",window.location.pathname+window.location.search);
        finishTransfer();window.removeEventListener('mab-before-sign-in',beforeSignIn);
      }catch(e){setImportError(e instanceof Error?e.message:String(e));}
    };
    window.addEventListener("message",receive);
    parent.postMessage({type:"mab:gtotree-ready",nonce},source);
    return()=>{window.removeEventListener("message",receive);window.removeEventListener('mab-before-sign-in',beforeSignIn);finishTransfer();};
  },[]);
  return {selection,setSelection,importError,setImportError};
}

