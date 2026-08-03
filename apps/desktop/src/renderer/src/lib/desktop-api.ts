import type { AravaDesktopApi } from '@arava/shared';

export function getDesktopApi(): AravaDesktopApi {
  if (!window.arava) throw new Error('ARAVA desktop API is unavailable outside Electron');
  return window.arava;
}
