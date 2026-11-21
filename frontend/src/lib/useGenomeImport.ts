import { useEffect, useState } from "react";
import { allowedOrigin, validateSelection, type GenomeSelection } from "./genome-selection";

export function useGenomeImport() {
  const [selection,setSelection]=useState<GenomeSelection|null>(null);
  const [importError,setImportError]=useState("");
  useEffect(()=>{
    const params=new URLSearchParams(window.location.hash.slice(1));
    const nonce=params.get("mab-import"),source=params.get("source")||"";
    if(!nonce)return;
    const allowed=(import.meta.env.VITE_ASSEMBLY_GRASP_ORIGINS as string|undefined)||"";
    if(!/^[a-zA-Z0-9-]{16,128}$/.test(nonce)||!allowedOrigin(source,allowed)||!window.opener){
      setImportError("Automatic transfer is not available from this origin. Download the selection JSON in Assembly Grasp and import it below.");return;
    }
    const parent=window.opener;
    const receive=(event:MessageEvent)=>{
      if(event.origin!==source||event.source!==parent||event.data?.type!=="mab:genome-selection"||event.data?.nonce!==nonce)return;
      try{
        const parsed=validateSelection(event.data.selection);setSelection(parsed);setImportError("");
        parent.postMessage({type:"mab:gtotree-imported",nonce},source);
        window.removeEventListener("message",receive);
        history.replaceState(null,"",window.location.pathname+window.location.search);
      }catch(e){setImportError(e instanceof Error?e.message:String(e));}
    };
    window.addEventListener("message",receive);
    parent.postMessage({type:"mab:gtotree-ready",nonce},source);
    return()=>window.removeEventListener("message",receive);
  },[]);
  return {selection,setSelection,importError,setImportError};
}
