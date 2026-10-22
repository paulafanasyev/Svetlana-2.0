/**
 * Safe, in-memory extraction of source files from ZIP archives for chat context.
 * No files are written to disk and archive paths are never used as filesystem paths.
 */
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_TEXT_BYTES = 240 * 1024;
const MAX_ENTRY_BYTES = 80 * 1024;
const TEXT_EXTENSIONS = /\.(txt|md|rst|csv|tsv|json|jsonc|json5|log|xml|ya?ml|html?|css|scss|sass|less|js|mjs|cjs|jsx|ts|tsx|mts|cts|py|pyi|ipynb|sql|toml|ini|cfg|conf|sh|bash|zsh|ps1|bat|cmd|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|rb|swift|dart|vue|svelte|astro|gradle|properties|env|gitignore|dockerignore|makefile|cmake|diff|patch|graphql|proto|tf|hcl|ex|exs|erl|hrl|scala|clj|cljs|lua|pl|r|jl|wasmtext)$/i;
const SKIP_PATH = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|vendor|\.gradle|\.idea|\.vscode|Pods|target|\.venv|venv|__pycache__)(\/|$)/i;

export interface ChatAttachmentText {
  name: string;
  size: number;
  content: string;
  note?: string;
}

function isTextFile(name: string): boolean {
  const base = name.split('/').pop() ?? name;
  return TEXT_EXTENSIONS.test(base) || /^(Dockerfile|Makefile|Justfile|Gemfile|Rakefile|Procfile|LICENSE|NOTICE|README|CHANGELOG)$/i.test(base);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Этот Android WebView не умеет распаковывать ZIP. Обновите Android System WebView или Chrome.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads ZIP central directory, accepts stored/deflate entries, skips binary and dependency/build folders. */
export async function readZipProject(file: File): Promise<ChatAttachmentText> {
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP слишком большой. Максимальный размер архива — 25 МБ.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - 22 - 65535);
  let eocd = -1;
  for (let p = bytes.length - 22; p >= minEocd; p--) {
    if (view.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('Не удалось прочитать ZIP: отсутствует центральный каталог архива.');
  const count = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 пока не поддерживается. Создайте обычный ZIP-архив проекта.');
  }
  const decoder = new TextDecoder('utf-8');
  let cursor = centralOffset;
  let total = 0;
  let accepted = 0;
  const chunks: string[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < count && i < 10000; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen)).replace(/\\/g, '/');
    cursor += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/') || SKIP_PATH.test(name) || !isTextFile(name)) continue;
    if ((flags & 1) !== 0) { skipped.push(name + ' (зашифрован)'); continue; }
    if (uncompressedSize > MAX_ENTRY_BYTES || total + uncompressedSize > MAX_TEXT_BYTES || accepted >= MAX_FILES) {
      skipped.push(name + ' (лимит размера/количества)');
      continue;
    }
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      skipped.push(name + ' (повреждённая запись)');
      continue;
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.length) { skipped.push(name + ' (неполные данные)'); continue; }
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let raw: Uint8Array;
    try {
      if (method === 0) raw = compressed.slice();
      else if (method === 8) raw = await inflateRaw(compressed);
      else { skipped.push(name + ' (метод сжатия не поддержан)'); continue; }
    } catch {
      skipped.push(name + ' (ошибка распаковки)');
      continue;
    }
    if (raw.length > MAX_ENTRY_BYTES || total + raw.length > MAX_TEXT_BYTES) {
      skipped.push(name + ' (превышен лимит извлечённого текста)');
      continue;
    }
    // Reject likely binary content rather than injecting arbitrary bytes into a prompt.
    if (raw.subarray(0, Math.min(raw.length, 8192)).some(b => b === 0)) {
      skipped.push(name + ' (бинарный файл)');
      continue;
    }
    const content = decoder.decode(raw);
    if (!content.trim()) continue;
    chunks.push('===== ' + name + ' =====\n' + content);
    total += raw.length;
    accepted++;
  }
  if (!accepted) throw new Error('В ZIP не найдено поддерживаемых текстовых файлов. Архивы с node_modules, сборками и бинарными файлами пропускаются.');
  const note = skipped.length ? 'Пропущено файлов: ' + skipped.length + '. Причины/имена: ' + skipped.slice(0, 20).join(', ') : undefined;
  const manifest = 'Архив: ' + file.name + '\nФайлов кода/текста включено: ' + accepted + '\nОбъём извлечённого текста: ' + total + ' байт' + (note ? '\n' + note : '');
  return { name: file.name, size: file.size, content: manifest + '\n\n' + chunks.join('\n\n'), note };
}
