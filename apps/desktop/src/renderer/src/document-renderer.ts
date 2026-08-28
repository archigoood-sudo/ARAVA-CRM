import { renderAsync } from 'docx-preview';

declare global {
  var renderAravaDocx: (base64: string) => Promise<void>;
}

document.body.style.margin = '0';
globalThis.renderAravaDocx = async (base64) => {
  const root = document.querySelector<HTMLElement>('#document');
  if (!root) throw new Error('Document renderer is unavailable.');
  root.replaceChildren();
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  await renderAsync(bytes.buffer, root, undefined, {
    breakPages: true,
    ignoreFonts: false,
    inWrapper: false,
    renderComments: false,
    renderFooters: true,
    renderHeaders: true,
  });
  await document.fonts.ready;
};
