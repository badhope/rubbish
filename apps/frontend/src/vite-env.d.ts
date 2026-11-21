/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_QA_AUTOLOGIN_TOKEN?: string
  readonly VITE_QA_AUTOLOGIN_USER_ID?: string
  readonly VITE_QA_AUTOLOGIN_USERNAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
