import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileText, X } from "lucide-react";
import { cn, fmtBytes } from "../lib/utils";

interface Props {
  files: File[];
  setFiles: (f: File[]) => void;
  /** Comma-separated accept string, e.g. ".fastq,.fastq.gz". */
  accept: string;
  /** Short helper line under the prompt. */
  hint: string;
  /** Allow more than one file (reads = yes, reference = no). */
  multiple?: boolean;
}

export function Dropzone({ files, setFiles, accept, hint, multiple = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (!multiple) {
      // single-file slot: keep only the most recent selection
      setFiles(incoming.slice(-1));
      return;
    }
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const f of incoming) byName.set(f.name, f);
    setFiles(Array.from(byName.values()));
  }, [files, setFiles, multiple]);

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "cursor-pointer rounded-xl border-2 border-dashed",
          "px-6 py-8 text-center transition-colors",
          drag
            ? "border-accent/70 bg-accent/5"
            : "border-border hover:border-fg-faint bg-surface-2/40"
        )}>
        <UploadCloud className="mx-auto mb-3 text-accent" size={30} />
        <div className="text-sm">
          <span className="text-fg font-medium">
            {multiple ? "Drop files here" : "Drop a file here"}
          </span>
          <span className="text-fg-subtle"> or click to browse</span>
        </div>
        <div className="text-xs text-fg-subtle mt-1">{hint}</div>
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";  // allow re-selecting same file
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 animate-fade-in">
          {files.map((f) => (
            <li key={f.name}
                className="flex items-center gap-3 px-3 py-2 rounded-lg
                           bg-surface-2 border border-border">
              <FileText size={16} className="text-accent shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{f.name}</div>
                <div className="text-[11px] text-fg-subtle">{fmtBytes(f.size)}</div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFiles(files.filter((x) => x.name !== f.name));
                }}
                className="text-fg-subtle hover:text-danger transition-colors"
                aria-label={`Remove ${f.name}`}>
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
