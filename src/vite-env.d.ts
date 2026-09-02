/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_ATTENDANCE_END_POINT: string;
  readonly VITE_EXT_APP_ID: string;
  readonly VITE_EXT_APP_PASSWORD: string;
  readonly VITE_ATTENDANCE_UPLOADS_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
