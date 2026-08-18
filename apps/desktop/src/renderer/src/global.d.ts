import type { AravaDesktopApi, CustomerDisplayViewApi } from '@arava/shared';

declare global {
  interface Window {
    arava?: AravaDesktopApi;
    customerDisplayView?: CustomerDisplayViewApi;
  }
}

export {};
