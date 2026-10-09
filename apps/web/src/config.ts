/** Typed, build-time configuration (values come from env/.env.<APP_ENV> via Vite's envDir). */
export interface AppConfig {
  /** Base URL the browser calls for the API, no trailing slash. '/api' = same origin. */
  apiBaseUrl: string
  appName: string
}

export function resolveConfig(env: Partial<ImportMetaEnv> = import.meta.env): AppConfig {
  const base = (env.VITE_API_BASE_URL ?? '').trim() || '/api'
  return {
    apiBaseUrl: base.replace(/\/+$/, '') || '/api',
    appName: (env.VITE_APP_NAME ?? '').trim() || 'Workshop Registration',
  }
}

export const config: AppConfig = resolveConfig()
