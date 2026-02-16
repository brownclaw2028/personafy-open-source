import type { AmazonOrder } from '../amazon-extractor';

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

interface AmazonCsvFilesInput {
  path: string;
  content: string;
}

interface AmazonOrderAccumulator {
  order: AmazonOrder;
  itemSignatures: Set<string>;
}

type CanonicalColumn =
  | 'orderId'
  | 'orderDate'
  | 'total'
  | 'currency'
  | 'status'
  | 'shippingCity'
  | 'shippingState'
  | 'itemTitle'
  | 'itemCategory'
  | 'itemPrice'
  | 'itemQuantity'
  | 'itemSize'
  | 'itemColor'
  | 'itemBrand'
  | 'itemAsin';

const COLUMN_ALIASES: Record<CanonicalColumn, string[]> = {
  orderId: ['Order ID', 'order_id', 'OrderId'],
  orderDate: ['Order Date', 'order_date', 'OrderDate'],
  total: ['Total Amount', 'Total', 'Order Total', 'total_owed'],
  currency: ['Currency', 'Currency Code', 'currency_code'],
  status: ['Status', 'Order Status', 'order_status'],
  shippingCity: ['Shipping City', 'Ship City', 'City', 'ship_city'],
  shippingState: ['Shipping State', 'Ship State', 'State', 'ship_state'],
  itemTitle: ['Item Title', 'Product Name', 'item_title', 'product_name'],
  itemCategory: ['Item Category', 'Category', 'item_category'],
  itemPrice: ['Item Price', 'Price', 'Unit Price', 'item_price'],
  itemQuantity: ['Item Quantity', 'Quantity', 'item_quantity'],
  itemSize: ['Item Size', 'Size', 'item_size'],
  itemColor: ['Item Color', 'Color', 'item_color'],
  itemBrand: ['Item Brand', 'Brand', 'item_brand'],
  itemAsin: ['Item ASIN', 'ASIN', 'asin'],
};

function normalizeHeader(input: string): string {
  return input.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/[\s_-]+/g, ' ');
}

function parseCsv(content: string): ParsedCsv {
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentCell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!inQuotes && char === '\n') {
      currentRow.push(currentCell);
      const rowHasValues = currentRow.some((value) => value.trim().length > 0);
      if (rowHasValues) rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    const rowHasValues = currentRow.some((value) => value.trim().length > 0);
    if (rowHasValues) rows.push(currentRow);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  return {
    headers: rows[0].map((header) => header.trim()),
    rows: rows.slice(1),
  };
}

function resolveColumnIndexes(headers: string[]): Partial<Record<CanonicalColumn, number>> {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const indexes: Partial<Record<CanonicalColumn, number>> = {};

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES) as Array<
    [CanonicalColumn, string[]]
  >) {
    const aliasSet = new Set(aliases.map((alias) => normalizeHeader(alias)));
    const index = normalizedHeaders.findIndex((header) => aliasSet.has(header));
    if (index >= 0) indexes[canonical] = index;
  }

  return indexes;
}

function readColumn(
  row: string[],
  indexes: Partial<Record<CanonicalColumn, number>>,
  key: CanonicalColumn,
): string {
  const index = indexes[key];
  if (index === undefined || index < 0 || index >= row.length) return '';
  return row[index]?.trim() ?? '';
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[$,]/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseQuantity(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 1;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildItemSignature(item: AmazonOrder['items'][number]): string {
  return [
    item.name,
    item.category,
    String(item.price),
    String(item.quantity),
    item.size ?? '',
    item.color ?? '',
    item.brand ?? '',
    item.asin ?? '',
  ].join('|');
}

function splitComparablePath(pathValue: string): [number, string] {
  const normalized = pathValue.replace(/\\/g, '/').toLowerCase();
  const match = normalized.match(/orderhistory[^0-9]*(\d+)/);
  const index = match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  return [index, normalized];
}

function sortAmazonCsvFiles(files: AmazonCsvFilesInput[]): AmazonCsvFilesInput[] {
  return [...files].sort((a, b) => {
    const [aIndex, aPath] = splitComparablePath(a.path);
    const [bIndex, bPath] = splitComparablePath(b.path);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return aPath.localeCompare(bPath);
  });
}

function defaultOrder(orderId: string): AmazonOrder {
  return {
    orderId,
    orderDate: '',
    items: [],
    total: 0,
    shippingAddress: { city: '', state: '' },
    status: '',
  };
}

export function parseAmazonOrderHistoryCsvFiles(
  files: AmazonCsvFilesInput[],
): AmazonOrder[] {
  const orders = new Map<string, AmazonOrderAccumulator>();
  const orderSequence: string[] = [];

  for (const file of sortAmazonCsvFiles(files)) {
    const parsed = parseCsv(file.content);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) continue;

    const indexes = resolveColumnIndexes(parsed.headers);
    for (const row of parsed.rows) {
      const orderId = readColumn(row, indexes, 'orderId');
      if (!orderId) continue;

      let accumulator = orders.get(orderId);
      if (!accumulator) {
        accumulator = {
          order: defaultOrder(orderId),
          itemSignatures: new Set<string>(),
        };
        orders.set(orderId, accumulator);
        orderSequence.push(orderId);
      }

      const current = accumulator.order;
      const orderDate = readColumn(row, indexes, 'orderDate');
      const total = parseNumber(readColumn(row, indexes, 'total'));
      const status = readColumn(row, indexes, 'status');
      const shippingCity = readColumn(row, indexes, 'shippingCity');
      const shippingState = readColumn(row, indexes, 'shippingState');
      const currency = readColumn(row, indexes, 'currency');

      if (!current.orderDate && orderDate) current.orderDate = orderDate;
      if (!current.status && status) current.status = status;
      if (!current.shippingAddress.city && shippingCity) current.shippingAddress.city = shippingCity;
      if (!current.shippingAddress.state && shippingState) current.shippingAddress.state = shippingState;
      if (current.total === 0 && total > 0) current.total = total;
      if (!current.currency && currency) current.currency = currency;

      const name = readColumn(row, indexes, 'itemTitle');
      const category = readColumn(row, indexes, 'itemCategory');
      if (!name) continue;

      const item: AmazonOrder['items'][number] = {
        name,
        category: category || 'Unknown',
        price: parseNumber(readColumn(row, indexes, 'itemPrice')),
        quantity: parseQuantity(readColumn(row, indexes, 'itemQuantity')),
      };

      const size = readColumn(row, indexes, 'itemSize');
      const color = readColumn(row, indexes, 'itemColor');
      const brand = readColumn(row, indexes, 'itemBrand');
      const asin = readColumn(row, indexes, 'itemAsin');
      if (size) item.size = size;
      if (color) item.color = color;
      if (brand) item.brand = brand;
      if (asin) item.asin = asin;

      const signature = buildItemSignature(item);
      if (accumulator.itemSignatures.has(signature)) continue;
      accumulator.itemSignatures.add(signature);
      current.items.push(item);
    }
  }

  return orderSequence
    .map((orderId) => orders.get(orderId)?.order)
    .filter((order): order is AmazonOrder => Boolean(order && order.items.length > 0))
    .map((order) => ({
      ...order,
      orderDate: order.orderDate || new Date(0).toISOString().replace('.000Z', 'Z'),
      status: order.status || 'Unknown',
      shippingAddress: {
        city: order.shippingAddress.city || 'Unknown',
        state: order.shippingAddress.state || 'Unknown',
      },
    }));
}
