/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // mais variáveis de ambiente aqui se necessário
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

