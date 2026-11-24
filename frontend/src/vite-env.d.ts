/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAB_AUTH_ENABLED?: string;
  readonly VITE_MAB_API_BASE?: string;
  readonly VITE_MAB_USER_POOL_ID?: string;
  readonly VITE_MAB_CLIENT_ID?: string;
  readonly VITE_MAB_COGNITO_DOMAIN?: string;
  readonly VITE_GTOTREE_API_BASE?: string;
  readonly VITE_GTOTREE_INPUT_BUCKET?: string;
  readonly VITE_GTOTREE_PUBLIC_RESULTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

