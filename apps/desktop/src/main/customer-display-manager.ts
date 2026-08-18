import {
  CustomerDisplayService,
  type ApplicationService,
  type DatabaseClient,
} from '@arava/database';
import {
  IPC_CHANNELS,
  type CustomerDisplaySettings,
  type CustomerDisplaySlide,
  type CustomerDisplaySlideInput,
  type CustomerDisplayState,
  type CustomerDisplayStatus,
} from '@arava/shared';
import { app, BrowserWindow, dialog, screen } from 'electron';
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { CustomerDisplayStateController } from './customer-display-state';
import {
  describeDisplays,
  displayBounds,
  selectedSecondaryDisplay,
} from './customer-display-window';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME_TYPES: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export class CustomerDisplayManager {
  private readonly service: CustomerDisplayService;
  private readonly mediaDirectory: string;
  private readonly secret = randomUUID();
  private customerWindow: BrowserWindow | undefined;
  private preview = false;
  private readonly controller = new CustomerDisplayStateController(
    { mode: 'PROMO', settings: { showLastName: false, slideSeconds: 8 }, slides: [] },
    (state) => this.publish(state),
  );

  constructor(database: DatabaseClient, application: ApplicationService) {
    this.service = new CustomerDisplayService(database, application);
    this.mediaDirectory = join(app.getPath('userData'), 'media', 'customer-display');
  }

  async initialize(): Promise<void> {
    await mkdir(this.mediaDirectory, { recursive: true });
    await this.refreshState();
    screen.on('display-added', this.handleDisplaysChanged);
    screen.on('display-removed', this.handleDisplaysChanged);
    screen.on('display-metrics-changed', this.handleDisplaysChanged);
  }

  async getStatus(token: string): Promise<CustomerDisplayStatus> {
    await this.service.getConfiguration(token);
    return this.status();
  }

  async updateSettings(
    token: string,
    settings: CustomerDisplaySettings,
  ): Promise<CustomerDisplayStatus> {
    await this.service.updateSettings(token, settings);
    await this.refreshState();
    if (!settings.enabled) this.closeWindow();
    else if (!this.preview) await this.openPhysical();
    return this.status();
  }

  async open(token: string): Promise<CustomerDisplayStatus> {
    await this.service.getConfiguration(token);
    await this.openPhysical();
    return this.status();
  }

  async openPreview(token: string): Promise<CustomerDisplayStatus> {
    await this.service.getConfiguration(token);
    this.closeWindow();
    this.preview = true;
    await this.createWindow(undefined, false);
    return this.status();
  }

  async close(token: string): Promise<CustomerDisplayStatus> {
    await this.service.getConfiguration(token);
    this.closeWindow();
    return this.status();
  }

  async returnToPromo(token?: string): Promise<CustomerDisplayStatus | undefined> {
    if (token) await this.service.getConfiguration(token);
    this.controller.returnToPromo();
    if (token) return this.status();
    return undefined;
  }

  async showStudentForScan(token: string, studentId: string): Promise<void> {
    try {
      const settings = await this.service.getStoredSettings();
      if (!settings.enabled || !this.customerWindow) return;
      const student = await this.service.getSafeStudent(token, studentId);
      this.controller.showStudent(student, settings.customerSeconds);
    } catch {
      this.controller.returnToPromo();
    }
  }

  getDisplayState(secret: string): CustomerDisplayState {
    if (secret !== this.secret) throw new Error('Доступ к экрану клиента запрещён.');
    return this.controller.getState();
  }

  async selectImage(token: string): Promise<{ mediaId: string } | undefined> {
    await this.service.getConfiguration(token);
    const result = await dialog.showOpenDialog({
      filters: [{ extensions: ['jpg', 'jpeg', 'png', 'webp'], name: 'Изображения' }],
      properties: ['openFile'],
      title: 'Выберите изображение для экрана клиента',
    });
    const source = result.filePaths[0];
    if (result.canceled || !source) return undefined;
    const extension = extname(source).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension))
      throw new Error('Этот формат изображения не поддерживается.');
    const mediaId = `${randomUUID()}${extension}`;
    await copyFile(source, join(this.mediaDirectory, mediaId));
    return { mediaId };
  }

  async saveSlide(token: string, input: CustomerDisplaySlideInput): Promise<CustomerDisplayStatus> {
    if (!input.title.trim()) throw new Error('Укажите название слайда.');
    if (input.mediaId) this.assertMediaId(input.mediaId);
    const before = await this.service.getStoredSlides();
    const previousMedia = input.id ? before.find(({ id }) => id === input.id)?.mediaId : undefined;
    const after = await this.service.saveSlide(token, input);
    if (
      previousMedia &&
      previousMedia !== input.mediaId &&
      !after.some(({ mediaId }) => mediaId === previousMedia)
    )
      await this.safeDeleteMedia(previousMedia);
    await this.refreshState();
    return this.status();
  }

  async deleteSlide(token: string, id: string): Promise<CustomerDisplayStatus> {
    const result = await this.service.deleteSlide(token, id);
    if (result.mediaId && !result.slides.some(({ mediaId }) => mediaId === result.mediaId)) {
      await this.safeDeleteMedia(result.mediaId);
    }
    await this.refreshState();
    return this.status();
  }

  async moveSlide(token: string, id: string, direction: 'UP' | 'DOWN') {
    await this.service.moveSlide(token, id, direction);
    await this.refreshState();
    return this.status();
  }

  shutdown(): void {
    screen.removeListener('display-added', this.handleDisplaysChanged);
    screen.removeListener('display-removed', this.handleDisplaysChanged);
    screen.removeListener('display-metrics-changed', this.handleDisplaysChanged);
    this.controller.dispose();
    this.closeWindow();
  }

  closeForMainWindow(): void {
    this.closeWindow();
  }

  async reopenIfEnabled(): Promise<void> {
    const settings = await this.service.getStoredSettings();
    if (settings.enabled) await this.openPhysical();
  }

  private readonly handleDisplaysChanged = (): void => {
    void (async () => {
      const settings = await this.service.getStoredSettings();
      const selected = selectedSecondaryDisplay(
        screen.getAllDisplays(),
        screen.getPrimaryDisplay().id,
        settings.displayId,
      );
      if (!selected && !this.preview) this.closeWindow();
      else if (settings.enabled && selected && !this.customerWindow) await this.openPhysical();
    })();
  };

  private async openPhysical(): Promise<void> {
    const settings = await this.service.getStoredSettings();
    const selected = selectedSecondaryDisplay(
      screen.getAllDisplays(),
      screen.getPrimaryDisplay().id,
      settings.displayId,
    );
    if (!settings.enabled || !selected) return;
    this.closeWindow();
    this.preview = false;
    await this.createWindow(displayBounds(selected), settings.fullscreen);
  }

  private async createWindow(
    bounds: { height: number; width: number; x: number; y: number } | undefined,
    fullscreen: boolean,
  ): Promise<void> {
    const window = new BrowserWindow({
      ...(bounds ?? { height: 700, width: 1100 }),
      autoHideMenuBar: true,
      backgroundColor: '#F6F2EA',
      frame: !fullscreen,
      fullscreen,
      focusable: this.preview,
      show: false,
      skipTaskbar: !this.preview,
      title: 'ARAVA — Экран клиента',
      webPreferences: {
        additionalArguments: ['--arava-customer-display', `--arava-customer-secret=${this.secret}`],
        contextIsolation: true,
        devTools: !app.isPackaged,
        nodeIntegration: false,
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
      },
    });
    this.customerWindow = window;
    window.setMenuBarVisibility(false);
    window.on('closed', () => {
      if (this.customerWindow === window) this.customerWindow = undefined;
    });
    window.once('ready-to-show', () => {
      if (this.preview) window.show();
      else window.showInactive();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) await window.loadURL(`${rendererUrl}?customer-display=1`);
    else
      await window.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
        query: { 'customer-display': '1' },
      });
  }

  private closeWindow(): void {
    this.controller.returnToPromo();
    this.customerWindow?.close();
    this.customerWindow = undefined;
    this.preview = false;
  }

  private publish(state: CustomerDisplayState): void {
    const window = this.customerWindow;
    if (window && !window.isDestroyed())
      window.webContents.send(IPC_CHANNELS.customerDisplayStateChanged, state);
  }

  private async refreshState(): Promise<void> {
    const [settings, storedSlides] = await Promise.all([
      this.service.getStoredSettings(),
      this.service.getStoredSlides(),
    ]);
    const slides = await Promise.all(storedSlides.map((slide) => this.decorateSlide(slide)));
    this.controller.replaceBase({
      settings: { showLastName: settings.showLastName, slideSeconds: settings.slideSeconds },
      slides: slides.filter(({ isActive }) => isActive),
    });
  }

  private async status(): Promise<CustomerDisplayStatus> {
    const [settings, storedSlides] = await Promise.all([
      this.service.getStoredSettings(),
      this.service.getStoredSlides(),
    ]);
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return {
      displays: describeDisplays(displays, primary.id),
      preview: this.preview,
      secondDisplayAvailable: displays.length > 1,
      selectedDisplayPresent: Boolean(
        selectedSecondaryDisplay(displays, primary.id, settings.displayId),
      ),
      settings,
      slides: await Promise.all(storedSlides.map((slide) => this.decorateSlide(slide))),
      windowOpen: Boolean(this.customerWindow && !this.customerWindow.isDestroyed()),
    };
  }

  private async decorateSlide(slide: CustomerDisplaySlide): Promise<CustomerDisplaySlide> {
    if (!slide.mediaId) return slide;
    try {
      this.assertMediaId(slide.mediaId);
      const extension = extname(slide.mediaId).toLowerCase();
      const data = await readFile(join(this.mediaDirectory, slide.mediaId));
      return {
        ...slide,
        imageUrl: `data:${MIME_TYPES[extension] ?? 'application/octet-stream'};base64,${data.toString('base64')}`,
      };
    } catch {
      return slide;
    }
  }

  private assertMediaId(mediaId: string): void {
    if (
      mediaId.includes('/') ||
      mediaId.includes('\\') ||
      !IMAGE_EXTENSIONS.has(extname(mediaId).toLowerCase())
    )
      throw new Error('Некорректный файл рекламного материала.');
  }

  private async safeDeleteMedia(mediaId: string): Promise<void> {
    try {
      this.assertMediaId(mediaId);
      await unlink(join(this.mediaDirectory, mediaId));
    } catch {
      // Missing managed media is already effectively removed.
    }
  }
}
