import type { DesktopUpdateState } from '@arava/shared';

export type AboutUpdateAction = 'CHECK' | 'DOWNLOAD' | 'INSTALL';

export const MAC_MANUAL_INSTALL_MESSAGE =
  'Автоматическая установка на macOS недоступна. Установите новую версию вручную.';

export function getAboutUpdateAction(state?: DesktopUpdateState): AboutUpdateAction {
  if (state?.status === 'AVAILABLE') return 'DOWNLOAD';
  if (state?.status === 'DOWNLOADED' && state.installMode === 'AUTOMATIC') return 'INSTALL';
  return 'CHECK';
}

export function getAboutUpdateActionLabel(
  action: AboutUpdateAction,
  state?: DesktopUpdateState,
): string {
  if (action === 'DOWNLOAD') {
    return state?.installMode === 'MANUAL' ? 'Скачать новую версию' : 'Скачать обновление';
  }
  if (action === 'INSTALL') return 'Перезапустить и установить';
  return 'Проверить обновления';
}
