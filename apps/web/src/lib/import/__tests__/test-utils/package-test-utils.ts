import { gzipSync, strToU8, zipSync } from 'fflate';

export type PackageFileMap = Record<string, string | Uint8Array>;

export interface TarEntry {
  path: string;
  content?: string | Uint8Array;
  kind?: 'file' | 'symlink' | 'hardlink';
  linkName?: string;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function asBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? strToU8(value) : value;
}

function writeString(target: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = strToU8(value);
  const slice = encoded.subarray(0, length);
  target.set(slice, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const octal = Math.max(0, value).toString(8);
  const padded = octal.padStart(length - 1, '0').slice(-length + 1);
  writeString(target, offset, length, `${padded}\0`);
}

function buildTarHeader(entry: TarEntry, byteLength: number): Uint8Array {
  const header = new Uint8Array(512);
  writeString(header, 0, 100, entry.path);
  writeString(header, 100, 8, '0000777\0');
  writeString(header, 108, 8, '0000000\0');
  writeString(header, 116, 8, '0000000\0');
  writeOctal(header, 124, 12, byteLength);
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  for (let i = 148; i < 156; i += 1) {
    header[i] = 0x20;
  }

  const kind = entry.kind ?? 'file';
  const typeFlag = kind === 'file' ? '0' : kind === 'hardlink' ? '1' : '2';
  header[156] = typeFlag.charCodeAt(0);
  if (entry.linkName) {
    writeString(header, 157, 100, entry.linkName);
  }

  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const value = checksum.toString(8).padStart(6, '0');
  writeString(header, 148, 8, `${value}\0 `);
  return header;
}

export function createTarArchive(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const content = entry.kind && entry.kind !== 'file'
      ? new Uint8Array(0)
      : asBytes(entry.content ?? '');
    const header = buildTarHeader(entry, content.length);
    blocks.push(header);
    blocks.push(content);
    const remainder = content.length % 512;
    if (remainder !== 0) {
      blocks.push(new Uint8Array(512 - remainder));
    }
  }

  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  return concatBytes(blocks);
}

export function createTgzPackage(entries: TarEntry[]): Uint8Array {
  return gzipSync(createTarArchive(entries), { level: 6 });
}

export function createZipPackage(files: PackageFileMap): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(files)) {
    payload[path] = asBytes(value);
  }
  return zipSync(payload, { level: 6 });
}

export interface GmailFixtureMessage {
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  date?: string;
  labels?: string[];
}

function sanitizeHeaderValue(input: string | undefined, fallback = ''): string {
  if (!input) return fallback;
  return input.replace(/\r?\n/g, ' ').trim();
}

function normalizeExportDate(rawDate: string | undefined): string {
  if (!rawDate) return new Date(0).toUTCString();
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.valueOf())) return new Date(0).toUTCString();
  return parsed.toUTCString();
}

function escapeMboxBody(body: string): string {
  return body.replace(/^From /gm, '>From ');
}

export function createGmailMbox(messages: GmailFixtureMessage[]): string {
  const rendered = messages.map((message, index) => {
    const id = sanitizeHeaderValue(message.id, `msg-${index + 1}`);
    const from = sanitizeHeaderValue(message.from, 'unknown@example.com');
    const to = sanitizeHeaderValue(message.to, 'unknown@example.com');
    const subject = sanitizeHeaderValue(message.subject);
    const labels = Array.isArray(message.labels)
      ? message.labels.map((label) => sanitizeHeaderValue(label)).filter(Boolean)
      : [];
    const date = normalizeExportDate(message.date);
    const body = escapeMboxBody(message.body ?? '');

    return [
      `From ${from} ${date}`,
      `X-GM-MSGID: ${id}`,
      `X-GM-THRID: ${id}`,
      `Message-ID: <${id}@personafy.test>`,
      `Date: ${date}`,
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `X-Gmail-Labels: ${labels.join(',')}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
      '',
    ].join('\n');
  });

  return `${rendered.join('\n')}\n`;
}

export function createGmailTakeoutZipFromDataset(messages: GmailFixtureMessage[]): Uint8Array {
  return createZipPackage({
    'Takeout/Mail/All mail Including Spam and Trash.mbox': createGmailMbox(messages),
    'Takeout/Mail/archive_browser.html': '<html></html>',
  });
}

export interface AmazonFixtureItem {
  name: string;
  category: string;
  price: number;
  quantity: number;
  size?: string;
  color?: string;
  brand?: string;
  asin?: string;
}

export interface AmazonFixtureOrder {
  orderId: string;
  orderDate: string;
  items: AmazonFixtureItem[];
  total: number;
  currency?: string;
  shippingAddress: { city: string; state: string };
  status: string;
}

interface AmazonCsvRow {
  orderId: string;
  orderDate: string;
  totalAmount: string;
  currency: string;
  status: string;
  shippingCity: string;
  shippingState: string;
  itemTitle: string;
  itemCategory: string;
  itemPrice: string;
  itemQuantity: string;
  itemSize: string;
  itemColor: string;
  itemBrand: string;
  itemAsin: string;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildAmazonCsvRows(orders: AmazonFixtureOrder[]): AmazonCsvRow[] {
  const rows: AmazonCsvRow[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      rows.push({
        orderId: order.orderId,
        orderDate: order.orderDate,
        totalAmount: order.total.toFixed(2),
        currency: order.currency ?? '',
        status: order.status,
        shippingCity: order.shippingAddress.city,
        shippingState: order.shippingAddress.state,
        itemTitle: item.name,
        itemCategory: item.category,
        itemPrice: item.price.toFixed(2),
        itemQuantity: String(item.quantity),
        itemSize: item.size ?? '',
        itemColor: item.color ?? '',
        itemBrand: item.brand ?? '',
        itemAsin: item.asin ?? '',
      });
    }
  }
  return rows;
}

function formatAmazonCsv(rows: AmazonCsvRow[]): string {
  const headers = [
    'Order ID',
    'Order Date',
    'Total Amount',
    'Currency',
    'Status',
    'Shipping City',
    'Shipping State',
    'Item Title',
    'Item Category',
    'Item Price',
    'Item Quantity',
    'Item Size',
    'Item Color',
    'Item Brand',
    'Item ASIN',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = [
      row.orderId,
      row.orderDate,
      row.totalAmount,
      row.currency,
      row.status,
      row.shippingCity,
      row.shippingState,
      row.itemTitle,
      row.itemCategory,
      row.itemPrice,
      row.itemQuantity,
      row.itemSize,
      row.itemColor,
      row.itemBrand,
      row.itemAsin,
    ];
    lines.push(values.map((value) => escapeCsvCell(value)).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function splitRows<T>(rows: T[], parts: number): T[][] {
  const safeParts = Math.max(1, Math.min(parts, rows.length));
  if (safeParts === 1) return [rows];

  const perPart = Math.ceil(rows.length / safeParts);
  const chunks: T[][] = [];
  for (let i = 0; i < safeParts; i += 1) {
    const start = i * perPart;
    const end = start + perPart;
    const chunk = rows.slice(start, end);
    if (chunk.length > 0) chunks.push(chunk);
  }
  return chunks;
}

export function createAmazonOrderHistoryCsv(
  orders: AmazonFixtureOrder[],
): string {
  return formatAmazonCsv(buildAmazonCsvRows(orders));
}

export function createAmazonOrderHistoryZipFromDataset(
  orders: AmazonFixtureOrder[],
  options: { parts?: number } = {},
): Uint8Array {
  const rows = buildAmazonCsvRows(orders);
  const parts = splitRows(rows, options.parts ?? 1);
  const files: PackageFileMap = {
    'Amazon/Readme.txt': 'Amazon order export\n',
  };

  if (parts.length === 1) {
    files['Amazon/Retail.OrderHistory.csv'] = formatAmazonCsv(parts[0]);
  } else {
    parts.forEach((partRows, index) => {
      files[`Amazon/Retail.OrderHistory.Part${index + 1}.csv`] = formatAmazonCsv(partRows);
    });
  }

  return createZipPackage(files);
}

export interface NotionFixturePage {
  id: string;
  title: string;
  type: 'page' | 'database' | 'journal' | 'task' | 'note';
  content: string;
  properties?: Record<string, string>;
  created_time?: string;
  last_edited_time?: string;
  tags?: string[];
}

function sanitizeNotionPathPart(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'Untitled';
  return normalized;
}

function renderNotionMarkdown(page: NotionFixturePage): string {
  const lines: string[] = [`# ${page.title}`, ''];

  if (page.created_time) {
    lines.push(`Created time: ${page.created_time}`);
  }
  if (page.last_edited_time) {
    lines.push(`Last edited time: ${page.last_edited_time}`);
  }
  lines.push(`Type: ${page.type}`);
  if (page.tags && page.tags.length > 0) {
    lines.push(`Tags: ${page.tags.join(', ')}`);
  }
  if (page.properties && Object.keys(page.properties).length > 0) {
    lines.push('');
    lines.push('## Properties');
    Object.keys(page.properties)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        lines.push(`- ${key}: ${page.properties?.[key] ?? ''}`);
      });
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(page.content);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderNotionDatabaseCsv(page: NotionFixturePage): string {
  const propertyKeys = Object.keys(page.properties ?? {}).sort((a, b) => a.localeCompare(b));
  const headers = [
    'Name',
    'ID',
    'Type',
    'Created time',
    'Last edited time',
    'Tags',
    'Content',
    ...propertyKeys,
  ];
  const row = [
    page.title,
    page.id,
    page.type,
    page.created_time ?? '',
    page.last_edited_time ?? '',
    page.tags?.join(', ') ?? '',
    page.content,
    ...propertyKeys.map((key) => page.properties?.[key] ?? ''),
  ];

  return `${headers.map((value) => escapeCsvCell(value)).join(',')}\n${row.map((value) => escapeCsvCell(value)).join(',')}\n`;
}

function notionFolderForType(type: NotionFixturePage['type']): string {
  if (type === 'database') return 'Databases';
  if (type === 'journal') return 'Journals';
  if (type === 'note') return 'Notes';
  if (type === 'task') return 'Tasks';
  return 'Pages';
}

export function createNotionExportZipFromDataset(
  pages: NotionFixturePage[],
  options: { rootDir?: string; includeLegacyJson?: boolean } = {},
): Uint8Array {
  const rootDir = sanitizeNotionPathPart(options.rootDir ?? 'notion-export');
  const files: PackageFileMap = {
    [`${rootDir}/index.html`]: '<html><body>Notion Export</body></html>\n',
  };

  pages.forEach((page, index) => {
    const safeTitle = sanitizeNotionPathPart(page.title || 'Untitled');
    const safeId = sanitizeNotionPathPart(page.id || `notion-${index + 1}`).replace(/\s+/g, '-');
    const folder = notionFolderForType(page.type);
    const fileStem = `${safeTitle} ${safeId}`;

    if (page.type === 'database') {
      files[`${rootDir}/${folder}/${fileStem}.csv`] = renderNotionDatabaseCsv(page);
    } else {
      files[`${rootDir}/${folder}/${fileStem}.md`] = renderNotionMarkdown(page);
    }
  });

  if (options.includeLegacyJson) {
    files[`${rootDir}/pages.json`] = `${JSON.stringify(pages)}\n`;
  }

  return createZipPackage(files);
}
