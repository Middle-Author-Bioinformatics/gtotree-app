import { useTheme } from "../lib/theme";
import { HAS_BACKEND } from "../lib/gtotree-config";
import { Sun, Moon, AlertTriangle } from "lucide-react";
import mabLogo from "/mab-logo.jpg";

interface Props {
  onTitleClick?: () => void;
}

export function Header({ onTitleClick }: Props) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
        <button
          type="button"
          onClick={onTitleClick}
          className="flex items-center gap-3 mr-2 min-w-0 group">
          <img
            src={mabLogo}
            alt="Middle Author Bioinformatics"
            className="h-9 w-auto rounded-md shrink-0 ring-1 ring-border"
          />
          <div className="h-7 w-px bg-border" aria-hidden />
          <div className="flex items-center gap-2 min-w-0">
            <div className="leading-tight min-w-0 text-left">
              <div className="text-base font-semibold tracking-tight truncate
                              group-hover:text-accent transition-colors">
                GToTree Web Server
              </div>
              <div className="text-[11px] text-fg-muted -mt-0.5 truncate">
                phylogenomic trees from genomes
              </div>
            </div>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-2 text-xs">
          {!HAS_BACKEND && (
            <span className="pill border-warn/40 bg-warn/10 text-warn">
              <AlertTriangle size={12} /> preview mode
            </span>
          )}
          <button
            onClick={toggle}
            className="icon-btn"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>
    </header>
  );
}
