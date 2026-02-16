import { describe, expect, it } from 'vitest';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { parseUniversalUploadFiles } from '../upload-anything';

function writeOctalField(target: Uint8Array, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  for (let i = 0; i < length - 1; i += 1) {
    target[offset + i] = text.charCodeAt(i);
  }
  target[offset + length - 1] = 0;
}

function tarFromEntries(entries: Array<{ path: string; content: string }>): Uint8Array {
  const chunks: Uint8Array[] = [];

  for (const entry of entries) {
    const body = strToU8(entry.content, true);
    const header = new Uint8Array(512);
    const nameBytes = strToU8(entry.path, true).slice(0, 100);
    header.set(nameBytes, 0);
    writeOctalField(header, 100, 8, 0o644); // mode
    writeOctalField(header, 108, 8, 0); // uid
    writeOctalField(header, 116, 8, 0); // gid
    writeOctalField(header, 124, 12, body.length); // size
    writeOctalField(header, 136, 12, Math.floor(Date.now() / 1000)); // mtime
    for (let i = 148; i < 156; i += 1) header[i] = 32; // checksum placeholder
    header[156] = '0'.charCodeAt(0);
    header.set(strToU8('ustar\0', true), 257);
    header.set(strToU8('00', true), 263);

    let checksum = 0;
    for (let i = 0; i < 512; i += 1) checksum += header[i];
    const checksumText = checksum.toString(8).padStart(6, '0');
    for (let i = 0; i < 6; i += 1) header[148 + i] = checksumText.charCodeAt(i);
    header[154] = 0;
    header[155] = 32;

    chunks.push(header, body);
    const remainder = body.length % 512;
    if (remainder !== 0) chunks.push(new Uint8Array(512 - remainder));
  }

  chunks.push(new Uint8Array(1024)); // tar end blocks
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function toBlobArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

describe('parseUniversalUploadFiles', () => {
  it('extracts records from plain text and JSON files', async () => {
    const files = [
      new File(['I always wear size 10 running shoes and prefer sushi.'], 'notes.txt', { type: 'text/plain' }),
      new File([
        JSON.stringify({
          source: 'gmail',
          events: [{ subject: 'Trip receipt', body: 'I usually prefer aisle seat and Marriott hotels.' }],
        }),
      ], 'gmail-export.json', { type: 'application/json' }),
    ];

    const result = await parseUniversalUploadFiles(files);

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.some((record) => record.sourceType === 'gmail')).toBe(true);
    expect(result.warnings.length).toBe(0);
  });

  it('extracts readable text from zip archives', async () => {
    const zipped = zipSync({
      'claude/messages.txt': strToU8('I usually run five days a week and avoid dairy.', true),
      'notion/page.md': strToU8('I prefer window seats for long flights.', true),
    });

    const files = [new File([toBlobArrayBuffer(zipped)], 'mixed-export.zip', { type: 'application/zip' })];
    const result = await parseUniversalUploadFiles(files);

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.some((record) => record.sourceType === 'claude')).toBe(true);
  });

  it('extracts text from tgz archives', async () => {
    const tar = tarFromEntries([
      { path: 'Takeout/Mail/inbox.mbox', content: 'From x\\nSubject: Receipt\\n\\nI always choose aisle seat.' },
      { path: 'notes/preferences.txt', content: 'I usually stay in Marriott hotels.' },
    ]);
    const tgz = gzipSync(tar);

    const files = [new File([toBlobArrayBuffer(tgz)], 'gmail-takeout.tgz', { type: 'application/gzip' })];
    const result = await parseUniversalUploadFiles(files);

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.some((record) => record.sourceType === 'gmail')).toBe(true);
  });
});
