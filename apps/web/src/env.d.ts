/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ADMIN_API_KEY?: string;
  readonly VITE_WOWHEAD_LINKS_ENABLED?: string;
  readonly VITE_WOWHEAD_TOOLTIPS_ENABLED?: string;
  readonly VITE_CHARACTER_MEDIA_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
