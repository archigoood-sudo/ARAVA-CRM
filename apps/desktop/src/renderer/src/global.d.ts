import type { AravaDesktopApi } from '@arava/shared';

declare global {
  interface Window {
    arava?: AravaDesktopApi;
  }
}

export {};
