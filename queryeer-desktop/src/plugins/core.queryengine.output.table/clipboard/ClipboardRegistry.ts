import type { ClipboardFormat, ClipboardSelection } from "./ClipboardFormat";
import { plainFormat } from "./formats/plain";
import { htmlFormat } from "./formats/html";

const formats: ClipboardFormat[] = [plainFormat, htmlFormat];

export function registerClipboardFormat(format: ClipboardFormat): void {
  formats.push(format);
}

export function getClipboardFormats(): readonly ClipboardFormat[] {
  return formats;
}

export async function writeToClipboard(selection: ClipboardSelection): Promise<void> {
  const items: Record<string, Blob> = {};
  for (const fmt of formats) {
    const text = fmt.format(selection);
    if (text === null) continue;
    items[fmt.mimeType] = new Blob([text], { type: fmt.mimeType });
  }
  await navigator.clipboard.write([new ClipboardItem(items)]);
}
