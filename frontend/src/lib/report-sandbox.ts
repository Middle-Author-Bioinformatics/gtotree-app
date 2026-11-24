/** A sandboxed report has no access to the application's session/token storage.
 * Give its theme code a private in-memory localStorage implementation instead.
 */
export function sandboxedReport(html:string,theme:'light'|'dark'):string{
  const bootstrap='<script>(()=>{const values=new Map([["gt-report-theme",'+JSON.stringify(theme)+']]);Object.defineProperty(window,"localStorage",{value:{getItem:key=>values.get(String(key))??null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear()},configurable:false});})();</script>';
  return /<head\b[^>]*>/i.test(html)?html.replace(/<head\b[^>]*>/i,head=>head+bootstrap):bootstrap+html;
}
