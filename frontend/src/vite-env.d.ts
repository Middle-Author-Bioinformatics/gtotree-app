/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GTOTREE_API_BASE?: string;
  readonly VITE_GTOTREE_INPUT_BUCKET?: string;
  readonly VITE_GTOTREE_PUBLIC_RESULTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
