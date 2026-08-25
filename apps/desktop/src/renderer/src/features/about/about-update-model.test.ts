import type { DesktopUpdateState } from '@arava/shared';
import { describe, expect, it } from 'vitest';

import {
  getAboutUpdateAction,
  getAboutUpdateActionLabel,
  MAC_MANUAL_INSTALL_MESSAGE,
} from './about-update-model';

function state(
  installMode: DesktopUpdateState['installMode'],
  status: DesktopUpdateState['status'],
): DesktopUpdateState {
  return {
    availableVersion: '0.4.7',
    currentVersion: '0.4.6',
    installMode,
    message: 'Доступна версия 0.4.7',
    status,
  };
}

describe('About update controls', () => {
  it('offers a manual download with a clear macOS explanation', () => {
    const updateState = state('MANUAL', 'AVAILABLE');
    const action = getAboutUpdateAction(updateState);

    expect(action).toBe('DOWNLOAD');
    expect(getAboutUpdateActionLabel(action, updateState)).toBe('Скачать новую версию');
    expect(MAC_MANUAL_INSTALL_MESSAGE).toContain('Установите новую версию вручную');
  });

  it('keeps the Windows restart-and-install action', () => {
    const updateState = state('AUTOMATIC', 'DOWNLOADED');
    const action = getAboutUpdateAction(updateState);

    expect(action).toBe('INSTALL');
    expect(getAboutUpdateActionLabel(action, updateState)).toBe('Перезапустить и установить');
  });
});
