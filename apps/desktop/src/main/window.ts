import { APP_NAME } from '@arava/config';
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

let mainWindow: BrowserWindow | undefined;

export function getMainWindow(): BrowserWindow | undefined {
  return mainWindow?.isDestroyed() ? undefined : mainWindow;
}

export function createMainWindow(): BrowserWindow {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(import.meta.dirname, '../../build/icon.png');
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#F7F8FA',
    height: 900,
    icon,
    minHeight: 720,
    minWidth: 1080,
    show: false,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
    },
    width: 1440,
  });

  mainWindow = window;
  window.setMenuBarVisibility(false);
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url !== currentUrl) event.preventDefault();
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
  }

  return window;
}
