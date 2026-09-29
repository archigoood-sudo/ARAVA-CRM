import { BrowserWindow } from 'electron';
import type { PayrollPeriodDetail } from '@arava/shared';
import { buildPayrollDocumentHtml, payrollPdfOptions } from './payroll-document';

export async function generatePayrollPdf(period: PayrollPeriodDetail): Promise<Buffer> {
  const html = buildPayrollDocumentHtml(period);
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await window.webContents.printToPDF(payrollPdfOptions);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
