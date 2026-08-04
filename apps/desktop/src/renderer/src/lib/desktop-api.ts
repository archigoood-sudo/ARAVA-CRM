import type { AravaDesktopApi } from '@arava/shared';

export function getDesktopApi(): AravaDesktopApi {
  if (!window.arava) throw new Error('Интерфейс ARAVA доступен только в настольном приложении.');
  return window.arava;
}
