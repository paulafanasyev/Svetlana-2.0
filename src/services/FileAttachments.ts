/**
 * Safe attachment ingestion for Svetlana chat.
 * Archives are inspected in memory only; no archive path is written to disk.
 */
export interface ChatAttachmentMedia {
  mimeType: string;
  dataBase64: string;
}
export interface ChatAttachmentText {
  name: string;
  size: number;
  content: string;
  media?: ChatAttachmentMedia[];
  note?: string;
}
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_TEXT_BYTES = 240 * 1024;
const MAX_ENTRY_BYTES = 80 * 1024;
const MAX_DIRECT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const TEXT_EXTENSIONS = /\.(txt|md|rst|csv|tsv|json|jsonc|json5|log|xml|ya?ml|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|mts|cts|py|pyi|ipynb|sql|toml|ini|cfg|conf|sh|bash|zsh|ps1|bat|cmd|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|rb|swift|dart|vue|svelte|astro|gradle|properties|env|gitignore|dockerignore|makefile|cmake|diff|patch|graphql|proto|tf|hcl|ex|exs|erl|hrl|scala|clj|cljs|lua|pl|r|jl)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|vendor|\.gradle|\.idea|\.vscode|Pods|target|\.venv|venv|__pycache__)(\/|$)/i;
const OFFICE_EXT = /\.(docx|pptx|xlsx|odt|odp|ods|epub)$/i;

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}
function xmlToText(xml: string): string {
  return decodeXml(xml.replace(/<(?:a:br|w:br|w:tab|a:tab)\b[^>]*\/?>/g, '\n')
    .replace(/<\/(?:a:p|w:p|w:tr|w:tc|a:sp|a:graphicFrame|text:p)>/g, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim());
}
function officePathAllowed(path: string, extension: string): boolean {
  if (extension === '.docx') return /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(path);
  if (extension === '.pptx') return /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i.test(path);
  if (extension === '.xlsx') return /^(xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|xl\/workbook\.xml)$/i.test(path);
  if (extension === '.odt' || extension === '.odp' || extension === '.ods') return path === 'content.xml';
  if (extension === '.epub') return /\.(xhtml|html)$/i.test(path) || /(^|\/)nav\.xhtml$/i.test(path);
  return false;
}
function isTextFile(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  return TEXT_EXTENSIONS.test(base) || /^(Dockerfile|Makefile|Justfile|Gemfile|Rakefile|Procfile|LICENSE|NOTICE|README|CHANGELOG)$/i.test(base);
}
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
  return btoa(binary);
}
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Этот Android WebView не умеет распаковывать ZIP. Обновите Android System WebView или Chrome.');
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ENTRY_BYTES) { await reader.cancel(); throw new Error('Превышен лимит размера распакованного файла.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}
async function readZipEntries(file: File, filter: (name: string) => boolean): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('Архив слишком большой. Максимальный размер — 25 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= minEocd; p--) if (view.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  if (eocd < 0) throw new Error('Не удалось прочитать архив: центральный каталог не найден.');
  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new Error('ZIP64 пока не поддерживается.');
  const decoder = new TextDecoder('utf-8');
  let cursor = centralOffset;
  const entries: Array<{ name: string; bytes: Uint8Array }> = [];
  for (let i = 0; i < count && i < 10000; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true), uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true), extraLen = view.getUint16(cursor + 30, true), commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)).replace(/\\/g, '/');
    cursor += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/') || !filter(name)) continue;
    if ((flags & 1) !== 0 || uncompressedSize > MAX_ENTRY_BYTES) continue;
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + compressedSize > bytes.length) continue;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    try {
      const raw = method === 0 ? compressed.slice() : method === 8 ? await inflateRaw(compressed) : null;
      if (raw && raw.length <= MAX_ENTRY_BYTES) entries.push({ name, bytes: raw });
    } catch { /* Skip malformed entries; never execute archive contents. */ }
    if (entries.length >= MAX_FILES) break;
  }
  return entries;
}
export async function readZipProject(file: File): Promise<ChatAttachmentText> {
  const decoder = new TextDecoder('utf-8');
  const entries = await readZipEntries(file, name => !SKIP_PATH.test(name) && isTextFile(name));
  let total = 0;
  const chunks: string[] = [];
  for (const entry of entries) {
    if (entry.bytes.subarray(0, Math.min(entry.bytes.length, 8192)).some(b => b === 0)) continue;
    if (total + entry.bytes.length > MAX_TEXT_BYTES) break;
    const content = decoder.decode(entry.bytes);
    if (!content.trim()) continue;
    chunks.push('===== ' + entry.name + ' =====\n' + content);
    total += entry.bytes.length;
  }
  if (!chunks.length) throw new Error('В ZIP не найдены поддерживаемые текстовые файлы.');
  return { name: file.name, size: file.size, content: 'Архив проекта: ' + file.name + '\nФайлов включено: ' + chunks.length + '\nОбъём текста: ' + total + ' байт\n\n' + chunks.join('\n\n') };
}
async function readOffice(file: File): Promise<ChatAttachmentText> {
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const decoder = new TextDecoder('utf-8');
  const entries = await readZipEntries(file, name => officePathAllowed(name, ext));
  const chunks = entries.map(e => '===== ' + e.name + ' =====\n' + xmlToText(decoder.decode(e.bytes))).filter(x => x.trim().length > 40);
  if (!chunks.length) throw new Error('Не удалось извлечь текст из документа. Возможно, файл повреждён или защищён паролем.');
  const content = chunks.join('\n\n').slice(0, MAX_TEXT_BYTES);
  return { name: file.name, size: file.size, content: 'Извлечённый текст документа ' + file.name + ':\n' + content };
}
async function readPdf(file: File): Promise<ChatAttachmentText> {
  if (file.size > MAX_DIRECT_FILE_BYTES) throw new Error('PDF больше 5 МБ. Разделите документ на части.');
  const raw = await file.arrayBuffer();
  const bytes = new Uint8Array(raw);
  const latin = new TextDecoder('latin1').decode(bytes);
  // Best-effort extraction for uncompressed PDF text objects. Scanned/stream-compressed PDFs require OCR and are not falsely reported as fully read.
  const strings: string[] = [];
  for (const match of latin.matchAll(/\(((?:\\.|[^\\)]){1,2000})\)\s*Tj/g)) strings.push(match[1].replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n'));
  for (const match of latin.matchAll(/\[((?:.|\n|\r){1,10000}?)\]\s*TJ/g)) {
    for (const item of match[1].matchAll(/\(((?:\\.|[^\\)]){1,1000})\)/g)) strings.push(item[1].replace(/\\([()\\])/g, '$1'));
  }
  const text = strings.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('В PDF не удалось извлечь текстовый слой. Для сканов нужен OCR; сохраните документ как DOCX или загрузите страницы изображениями.');
  return { name: file.name, size: file.size, content: 'Текст, извлечённый из PDF (может быть неполным, особенно при сжатых потоках):\n' + text.slice(0, MAX_TEXT_BYTES), note: 'PDF извлечён упрощённым методом; полнота не гарантируется.' };
}
async function readImage(file: File): Promise<ChatAttachmentText> {
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Изображение больше 8 МБ. Уменьшите его размер перед отправкой.');
  const mimeType = file.type.startsWith('image/') ? file.type : ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', heic: 'image/heic' } as Record<string, string>)[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(mimeType)) throw new Error('Формат изображения не поддерживается моделью напрямую. Используйте JPG, PNG, WEBP или GIF.');
  const bitmap = await createImageBitmap(file);
  try {
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось обработать изображение.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Не удалось сжать изображение.')), 'image/jpeg', 0.82));
    if (blob.size > MAX_MEDIA_BYTES) throw new Error('После обработки изображение всё ещё слишком большое.');
    const dataBase64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    return { name: file.name, size: file.size, content: 'Изображение прикреплено: ' + file.name + ' (' + bitmap.width + '×' + bitmap.height + '). Модели необходимо проанализировать само изображение.', media: [{ mimeType: 'image/jpeg', dataBase64 }] };
  } finally { bitmap.close(); }
}
async function readVideo(file: File): Promise<ChatAttachmentText> {
  if (file.size > 100 * 1024 * 1024) throw new Error('Видео больше 100 МБ. Выберите короткий фрагмент до 100 МБ.');
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Не удалось открыть видео. Используйте MP4 или WEBM.'));
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Не удалось определить длительность видео.');
    const duration = video.duration;
    const times = Array.from(new Set([0, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0, duration - 0.1)])).slice(0, 5);
    const media: ChatAttachmentMedia[] = [];
    for (const time of times) {
      video.currentTime = time;
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('Не удалось прочитать кадр видео.'));
      });
      const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Не удалось обработать кадр видео.')), 'image/jpeg', 0.72));
      media.push({ mimeType: 'image/jpeg', dataBase64: toBase64(new Uint8Array(await blob.arrayBuffer())) });
    }
    if (!media.length) throw new Error('Не удалось извлечь кадры видео.');
    return { name: file.name, size: file.size, content: 'Видео: ' + file.name + '. Длительность: ' + Math.round(duration) + ' с. Для анализа передано кадров: ' + media.length + '. Звук/речь видео не расшифрованы.', media, note: 'Анализируются выбранные кадры, а не каждый кадр видео; звук не расшифровывается.' };
  } finally { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); }
}
export async function readChatAttachment(file: File): Promise<ChatAttachmentText> {
  const name = file.name.toLowerCase();
  if (file.size === 0) throw new Error('Файл пустой: ' + file.name);
  if (/\.zip$/i.test(name)) return readZipProject(file);
  if (OFFICE_EXT.test(name)) return readOffice(file);
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') return readPdf(file);
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(name)) return readImage(file);
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name)) return readVideo(file);
  if (file.size > MAX_DIRECT_FILE_BYTES) throw new Error('Файл «' + file.name + '» больше 5 МБ. Для проекта используйте ZIP до 25 МБ.');
  if (TEXT_EXTENSIONS.test(name) || /(^|\/)(Dockerfile|Makefile|README(?:\..*)?|LICENSE|CHANGELOG)$/i.test(name)) {
    const content = await file.text();
    if (!content.trim()) throw new Error('Файл «' + file.name + '» пустой или не содержит читаемого текста.');
    return { name: file.name, size: file.size, content: content.slice(0, 50000) };
  }
  throw new Error('Формат «' + file.name + '» пока не поддерживается. Поддерживаются код, ZIP, PDF, DOCX/PPTX/XLSX/ODT/ODP/ODS/EPUB, изображения JPG/PNG/WEBP/GIF и видео MP4/WEBM/MOV.');
}
