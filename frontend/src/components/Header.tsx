import { useTheme } from "../lib/theme";
import { Sun, Moon } from "lucide-react";
import mabLogo from "/mab-logo.png";
export function Header({onTitleClick}: {onTitleClick?:()=>void}) {
  const {theme,toggle}=useTheme();
  return <header className="sticky top-0 z-30 bg-surface border-b border-border"><div className="mab-header">
    <a className="mab-company" href="https://midauthorbio.com" aria-label="Middle Author Bioinformatics"><img src={mabLogo} alt="Middle Author Bioinformatics" /></a>
    <button onClick={onTitleClick} className="mab-app-name" type="button">GToTree</button>
    <div className="mab-header-actions"><button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme==="dark"?"light":"dark"} mode`}>{theme==="dark"?<Sun size={16}/>:<Moon size={16}/>}</button></div>
  </div></header>;
}
