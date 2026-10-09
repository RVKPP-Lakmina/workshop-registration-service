/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** What the browser calls for the API ('/api' or an absolute URL). */
  readonly VITE_API_BASE_URL?: string
  /** Dev-server proxy target (read by vite.config.ts only, not shipped to the browser). */
  readonly VITE_API_PROXY_TARGET?: string
  readonly VITE_APP_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
