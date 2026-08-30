/// <reference lib="dom" />

import { _electron as electron, type ElectronApplication } from '@playwright/test';

type ElectronLaunchOptions = NonNullable<Parameters<typeof electron.launch>[0]>;

export function isBackgroundE2E(): boolean {
  return process.env.ARAVA_E2E_BACKGROUND !== '0';
}

async function suppressNativeTestUI(application: ElectronApplication): Promise<void> {
  const suppressRendererDialogs = () => {
    window.alert = () => undefined;
    window.confirm = () => true;
    window.prompt = () => null;
  };
  await application.context().addInitScript(suppressRendererDialogs);
  await Promise.all(application.windows().map((page) => page.evaluate(suppressRendererDialogs)));
  await application.evaluate(({ app, BrowserWindow, dialog, shell }) => {
    if (process.platform === 'darwin') app.dock?.hide();
    BrowserWindow.prototype.show = function showInBackground() {
      this.hide();
    };
    BrowserWindow.prototype.showInactive = function showInactiveInBackground() {
      this.hide();
    };
    for (const window of BrowserWindow.getAllWindows()) window.hide();

    const safeDialog = dialog as unknown as {
      showErrorBox: () => void;
      showMessageBox: (...arguments_: unknown[]) => Promise<{
        checkboxChecked: boolean;
        response: number;
      }>;
      showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      showSaveDialog: () => Promise<{ canceled: boolean; filePath: undefined }>;
    };
    safeDialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
    safeDialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: undefined });
    safeDialog.showMessageBox = (...arguments_) => {
      const options = (arguments_.at(-1) ?? {}) as { cancelId?: number };
      return Promise.resolve({
        checkboxChecked: false,
        response: options.cancelId ?? 0,
      });
    };
    safeDialog.showErrorBox = () => undefined;

    shell.openExternal = () => Promise.resolve();
    shell.openPath = () => Promise.resolve('');
    shell.showItemInFolder = () => undefined;
  });
}

export async function launchElectron(options: ElectronLaunchOptions): Promise<ElectronApplication> {
  const background = isBackgroundE2E();
  const args = [...(options.args ?? [])];
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, ...options.env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  const application = await electron.launch({
    ...options,
    args,
    env: environment,
  });
  if (background) await suppressNativeTestUI(application);
  return application;
}
