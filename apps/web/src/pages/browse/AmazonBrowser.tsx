import { useState, useMemo, useEffect } from 'react';
import { Search, Package, Truck, Monitor, Shirt, UtensilsCrossed, Home, Dumbbell, Apple, BookOpen, TreePine, Sparkles, PawPrint, Briefcase, Gamepad2, Zap, ShoppingCart } from 'lucide-react';
import type { AmazonOrder } from '../../lib/amazon-extractor';
import { loadCanonicalSourceDataset } from '../../lib/canonical-package-lineage';
import { ExtractionHighlight } from '../../components/ExtractionHighlight';
import type { ExtractionMatch } from '../../components/ExtractionHighlight';
import { FactsSidebar } from './FactsSidebar';
import './browser-themes.css';

// ── Category normalization ────────────────────────────────────────────────

const CATEGORY_NORMALIZE: Record<string, string> = {
  clothing: 'Clothing', apparel: 'Clothing', shoes: 'Clothing', fashion: 'Clothing',
  'running shoes': 'Clothing',
  electronics: 'Electronics', computers: 'Electronics', 'cell phones': 'Electronics',
  'tech accessories': 'Electronics', 'phone accessories': 'Electronics',
  'fashion accessories': 'Clothing', accessories: 'Clothing',
  books: 'Books', 'kindle store': 'Books',
  home: 'Home', kitchen: 'Home', furniture: 'Home', 'home & kitchen': 'Home',
  health: 'Health', fitness: 'Health', sports: 'Health', 'sports & outdoors': 'Health',
  supplements: 'Health', 'health & household': 'Health',
  grocery: 'Food', food: 'Food', 'gourmet food': 'Food', 'grocery & gourmet food': 'Food',
  pet: 'Pet', 'pet supplies': 'Pet',
  beauty: 'Beauty', 'personal care': 'Beauty',
  'video games': 'Entertainment', 'movies & tv': 'Entertainment', music: 'Entertainment',
  'smart home': 'Smart Home',
  garden: 'Garden', 'patio, lawn & garden': 'Garden', 'lawn & garden': 'Garden',
  'outdoor gear': 'Outdoors', outdoors: 'Outdoors',
  office: 'Office', 'office products': 'Office',
  stationery: 'Office',
  toys: 'Toys', 'toys & games': 'Toys',
  digital: 'Electronics',
  'running accessories': 'Health',
  outerwear: 'Clothing',
  'home & office': 'Home',
  'health & nutrition': 'Health',
  'turntable accessories': 'Electronics',
  photography: 'Electronics',
};

function normalizeCategory(cat: string): string {
  return CATEGORY_NORMALIZE[cat.toLowerCase().trim()] ?? cat;
}

// ── Category icon mapping ─────────────────────────────────────────────────

const CATEGORY_ICON_MAP: Record<string, typeof Package> = {
  Electronics: Monitor,
  Clothing: Shirt,
  Home: Home,
  Health: Dumbbell,
  Food: Apple,
  Books: BookOpen,
  Outdoors: TreePine,
  Beauty: Sparkles,
  Pet: PawPrint,
  Office: Briefcase,
  Entertainment: Gamepad2,
  'Smart Home': Zap,
  Garden: TreePine,
  Toys: Gamepad2,
};

function getImageCategoryIcon(item: { category: string; imageCategory?: string }) {
  if (item.imageCategory) {
    const map: Record<string, typeof Package> = {
      electronics: Monitor,
      clothing: Shirt,
      kitchen: UtensilsCrossed,
      home: Home,
      fitness: Dumbbell,
      food: Apple,
      books: BookOpen,
      outdoors: TreePine,
      beauty: Sparkles,
      pets: PawPrint,
      office: Briefcase,
      toys: Gamepad2,
      digital: Monitor,
    };
    return map[item.imageCategory] ?? Package;
  }
  return CATEGORY_ICON_MAP[normalizeCategory(item.category)] ?? Package;
}

// ── Star Rating component ─────────────────────────────────────────────────

function StarRating({ rating, count }: { rating: number; count?: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= Math.floor(rating)) {
      stars.push(<span key={i} className="text-[#ffa41c]">&#9733;</span>);
    } else if (i - 0.5 <= rating) {
      stars.push(<span key={i} className="text-[#ffa41c]">&#9733;</span>);
    } else {
      stars.push(<span key={i} className="text-[#d5d9d9]">&#9733;</span>);
    }
  }
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      {stars}
      {count !== undefined && (
        <span className="text-[#007185] text-xs ml-0.5">{count.toLocaleString()}</span>
      )}
    </span>
  );
}

// ── Extraction patterns for product names ─────────────────────────────────

const PRODUCT_PATTERNS: Array<{ regex: RegExp; factKey: string; category: string; confidence: number }> = [
  { regex: /\b(running|marathon|trail|hiking|climbing)\b/i, factKey: 'fitness.activity', category: 'Fitness', confidence: 0.75 },
  { regex: /\b(yoga|meditation|pilates)\b/i, factKey: 'fitness.activity', category: 'Fitness', confidence: 0.75 },
  { regex: /\b(protein|vitamin|supplement|creatine|omega)\b/i, factKey: 'health.supplements', category: 'Health & Fitness', confidence: 0.7 },
  { regex: /\b(macbook|iphone|ipad|airpods|apple)\b/i, factKey: 'tech.ecosystem', category: 'Work', confidence: 0.8 },
  { regex: /\b(kindle|paperback|hardcover)\b/i, factKey: 'reading.format', category: 'Shopping', confidence: 0.65 },
  { regex: /\bsize\s+(\d+(?:\.\d)?|XS|S|M|L|XL|XXL)\b/i, factKey: 'apparel.size', category: 'Shopping', confidence: 0.85 },
  { regex: /\b(organic|natural|non-gmo)\b/i, factKey: 'food.preferences', category: 'Food & Dining', confidence: 0.7 },
  { regex: /\b(dog|cat|pet|puppy|kitten)\b/i, factKey: 'home.pets', category: 'Home & Living', confidence: 0.75 },
  { regex: /\b(coffee|espresso|grinder)\b/i, factKey: 'food.coffee_preferences', category: 'Food & Dining', confidence: 0.7 },
];

function extractProductMatches(name: string): ExtractionMatch[] {
  const matches: ExtractionMatch[] = [];
  for (const pattern of PRODUCT_PATTERNS) {
    const regex = new RegExp(pattern.regex, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(name)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        factKey: pattern.factKey,
        category: pattern.category,
        confidence: pattern.confidence,
      });
    }
  }
  return matches;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}

// ── Tab options ───────────────────────────────────────────────────────────

const ORDER_TABS = ['Orders', 'Buy Again', 'Not Yet Shipped', 'Cancelled Orders'];

// ── Main Component ───────────────────────────────────────────────────────

interface AmazonBrowserProps {
  persona: string;
  className?: string;
}

export function AmazonBrowser({ persona, className }: AmazonBrowserProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('Orders');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [factsOpen, setFactsOpen] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Lazy-load persona data on demand
  const [orders, setOrders] = useState<AmazonOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [prevPersona, setPrevPersona] = useState(persona);
  if (persona !== prevPersona) { setPrevPersona(persona); setLoading(true); }
  useEffect(() => {
    let cancelled = false;
    loadCanonicalSourceDataset<AmazonOrder>('amazon', persona)
      .then(data => { if (!cancelled) setOrders(data); })
      .catch(err => { if (!cancelled) { console.error('Failed to load data:', err); setOrders([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [persona]);

  // Filter orders
  const filtered = useMemo(() => {
    let result = [...orders].sort((a, b) =>
      new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime()
    );

    // Tab filtering
    if (activeTab === 'Not Yet Shipped') {
      result = result.filter(o => o.status !== 'Delivered');
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(o =>
        o.items.some(item => item.name.toLowerCase().includes(q)) ||
        o.orderId.toLowerCase().includes(q)
      );
    }

    return result;
  }, [orders, search, activeTab]);

  // Auto-select first order so facts sidebar shows content by default
  const effectiveSelectedId = selectedOrderId ?? filtered[0]?.orderId ?? null;

  // Extraction on selected order (or first visible order by default)
  const extractionResults = useMemo(() => {
    if (!effectiveSelectedId) return { matches: [] as ExtractionMatch[], facts: [] as Array<{ key: string; value: string; confidence: number; category: string }> };
    const order = orders.find(o => o.orderId === effectiveSelectedId);
    if (!order) return { matches: [], facts: [] };
    const allMatches: ExtractionMatch[] = [];
    const facts: Array<{ key: string; value: string; confidence: number; category: string }> = [];
    for (const item of order.items) {
      const m = extractProductMatches(item.name);
      allMatches.push(...m);
      for (const match of m) {
        facts.push({
          key: match.factKey,
          value: item.name.slice(match.start, match.end),
          confidence: match.confidence,
          category: match.category,
        });
      }
    }
    return { matches: allMatches, facts };
  }, [effectiveSelectedId, orders]);

  if (loading) {
    return (
      <div className={className ? `amazon-browser bg-white rounded-lg overflow-hidden border border-[#d5d9d9] ${className}` : "amazon-browser bg-white rounded-lg overflow-hidden border border-[#d5d9d9] mt-4"}>
        <div className={className ? "flex items-center justify-center h-full" : "flex items-center justify-center h-[calc(100vh-280px)] min-h-[500px]"}>
          <p className="text-[#565959] text-sm">Loading orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className ? `amazon-browser bg-white rounded-lg overflow-hidden border border-[#d5d9d9] flex flex-col ${className}` : "amazon-browser bg-white rounded-lg overflow-hidden border border-[#d5d9d9] mt-4 h-[calc(100vh-280px)] min-h-[500px] flex flex-col"}>
      {/* ── Amazon dark header bar ─────────────────────────────────────── */}
      <div className="h-[50px] bg-[#131921] flex items-center px-4 gap-4 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <span className="text-white text-xl font-bold tracking-tight">amazon</span>
          <span className="text-[#febd69] text-xl leading-none mt-1">&#8250;</span>
        </div>

        {/* Search bar */}
        <div className="flex-1 max-w-[600px] flex">
          <div className="flex-1 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your orders"
              className="w-full h-[44px] pl-3 pr-3 bg-white rounded-l text-[#0f1111] text-sm placeholder:text-[#767676] focus:outline-none"
            />
          </div>
          <button className="h-[44px] w-[42px] bg-[#febd69] hover:bg-[#f3a847] rounded-r flex items-center justify-center">
            <Search className="w-5 h-5 text-[#131921]" />
          </button>
        </div>

        {/* Nav links */}
        <div className="flex flex-col text-[11px] leading-tight text-white">
          <span className="text-[#ccc]">Returns</span>
          <span className="font-bold">& Orders</span>
        </div>
        <div className="flex items-center gap-1 text-white">
          <ShoppingCart className="w-5 h-5" />
          <span className="text-xs font-bold">Cart</span>
        </div>
      </div>

      {/* ── Sub-header: Your Orders + tabs ──────────────────────────── */}
      <div className="bg-white border-b border-[#d5d9d9] px-4 pt-3 pb-0 flex-shrink-0">
        <h1 className="text-[28px] text-[#0f1111] font-normal leading-[36px] mb-3">Your Orders</h1>
        <div className="flex items-center gap-6">
          {ORDER_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm transition-colors ${
                activeTab === tab
                  ? 'text-[#0f1111] border-b-2 border-[#e77600] font-medium'
                  : 'text-[#565959] hover:text-[#c45500]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stats bar ────────────────────────────────────────────────── */}
      {orders.length > 0 && (() => {
        const totalSpend = orders.reduce((s, o) => s + o.total, 0);
        const avgOrder = totalSpend / orders.length;
        const catCounts: Record<string, number> = {};
        for (const o of orders) {
          for (const item of o.items) {
            const cat = normalizeCategory(item.category);
            catCounts[cat] = (catCounts[cat] || 0) + 1;
          }
        }
        const topCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
        return (
          <div className="bg-[#f0f2f2] px-4 py-2.5 border-b border-[#d5d9d9] flex-shrink-0 flex items-center gap-6">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-[#565959] font-medium">Total Spend</span>
              <span className="text-sm font-bold text-[#0f1111]">{formatPrice(totalSpend)}</span>
            </div>
            <div className="w-px h-4 bg-[#d5d9d9]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-[#565959] font-medium">Orders</span>
              <span className="text-sm font-bold text-[#0f1111]">{orders.length}</span>
            </div>
            <div className="w-px h-4 bg-[#d5d9d9]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-[#565959] font-medium">Avg Order</span>
              <span className="text-sm font-bold text-[#0f1111]">{formatPrice(avgOrder)}</span>
            </div>
            <div className="w-px h-4 bg-[#d5d9d9]" />
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-[#565959] font-medium">Top Category</span>
              <span className="text-sm font-bold text-[#0f1111]">{topCategory}</span>
            </div>
          </div>
        );
      })()}

      {/* ── Results info bar ────────────────────────────────────────── */}
      <div className="bg-white px-4 py-2 border-b border-[#d5d9d9] flex-shrink-0">
        <span className="text-sm text-[#565959]">
          <span className="font-bold text-[#c45500]">{filtered.length}</span> order{filtered.length !== 1 ? 's' : ''} placed
        </span>
      </div>

      {/* ── Order list + facts sidebar ──────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {filtered.map(order => {
            const isExpanded = expandedOrder === order.orderId;
            const isSelected = effectiveSelectedId === order.orderId;

            return (
              <div
                key={order.orderId}
                className={`border rounded-lg overflow-hidden ${
                  isSelected ? 'border-[#e77600] ring-1 ring-[#e77600]/30' : 'border-[#d5d9d9]'
                }`}
                onClick={() => setSelectedOrderId(order.orderId)}
              >
                {/* ── Order header bar (gray) ────────────────────── */}
                <div className="bg-[#f0f2f2] px-4 py-3 flex items-center justify-between text-xs text-[#565959] border-b border-[#d5d9d9]">
                  <div className="flex items-center gap-4">
                    <div>
                      <div className="uppercase text-[11px] tracking-wide font-medium">Order placed</div>
                      <div className="text-[#0f1111] text-sm">{formatDate(order.orderDate)}</div>
                    </div>
                    <div>
                      <div className="uppercase text-[11px] tracking-wide font-medium">Total</div>
                      <div className="text-[#0f1111] text-sm">{formatPrice(order.total)}</div>
                    </div>
                    <div>
                      <div className="uppercase text-[11px] tracking-wide font-medium">Ship to</div>
                      <div className="text-[#007185] text-sm">{order.shippingAddress.city}, {order.shippingAddress.state}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="uppercase text-[11px] tracking-wide font-medium">Order # {order.orderId}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedOrder(isExpanded ? null : order.orderId); }}
                      className="text-[#007185] hover:text-[#c45500] hover:underline text-sm mt-0.5"
                    >
                      {isExpanded ? 'Hide order details' : 'View order details'}
                    </button>
                  </div>
                </div>

                {/* ── Order body: items ──────────────────────────── */}
                <div className="bg-white p-4">
                  {/* Delivery status */}
                  <div className="mb-3">
                    {order.status === 'Delivered' ? (
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-[#007600]" />
                        <span className="text-[#007600] font-bold text-sm">
                          Delivered {order.deliveryDate ? formatDate(order.deliveryDate) : ''}
                        </span>
                      </div>
                    ) : order.status?.startsWith('Arriving') ? (
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-[#c45500]" />
                        <span className="text-[#c45500] font-bold text-sm">{order.status}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-[#007185]" />
                        <span className="text-[#007185] font-bold text-sm">{order.status || 'Shipped'}</span>
                      </div>
                    )}
                  </div>

                  {/* Items */}
                  {order.items.map((item, i) => {
                    const Icon = getImageCategoryIcon(item);
                    const productMatches = extractProductMatches(item.name);

                    return (
                      <div key={i} className="flex gap-4 mb-3 last:mb-0">
                        {/* Product image placeholder */}
                        <div className="w-[110px] h-[110px] bg-[#f7f8f8] border border-[#d5d9d9] rounded flex items-center justify-center flex-shrink-0">
                          <Icon className="w-10 h-10 text-[#565959]/40" />
                        </div>

                        {/* Product details */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[#007185] hover:text-[#c45500] hover:underline cursor-default mb-1 line-clamp-2">
                            <ExtractionHighlight
                              text={item.name}
                              matches={productMatches}
                              showTooltips
                              theme="light"
                            />
                          </div>

                          {/* Star rating */}
                          {item.starRating && (
                            <div className="mb-1">
                              <StarRating rating={item.starRating} count={item.reviewCount} />
                            </div>
                          )}

                          {/* Price */}
                          <div className="text-lg font-medium text-[#0f1111]">{formatPrice(item.price)}</div>

                          {/* Details */}
                          <div className="flex gap-3 text-xs text-[#565959] mt-1">
                            {item.size && <span>Size: {item.size}</span>}
                            {item.color && <span>Color: {item.color}</span>}
                            {item.brand && <span>{item.brand}</span>}
                            {item.quantity > 1 && <span>Qty: {item.quantity}</span>}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2 mt-2">
                            <button className="px-2.5 py-1 bg-[#ffd814] hover:bg-[#f7ca00] border border-[#fcd200] rounded-full text-[11px] text-[#0f1111] font-medium">
                              Buy it again
                            </button>
                            <button className="px-2.5 py-1 bg-white hover:bg-[#f7fafa] border border-[#d5d9d9] rounded-full text-[11px] text-[#0f1111]">
                              View your item
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Expanded order details ─────────────────────── */}
                {isExpanded && (
                  <div className="border-t border-[#d5d9d9] bg-[#fafafa] px-4 py-3">
                    <div className="text-xs text-[#565959]">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="font-medium">Order ID:</span> {order.orderId}
                        </div>
                        <div>
                          <span className="font-medium">Order Date:</span> {formatDate(order.orderDate)}
                        </div>
                        <div>
                          <span className="font-medium">Ship To:</span> {order.shippingAddress.city}, {order.shippingAddress.state}
                        </div>
                        <div>
                          <span className="font-medium">Order Total:</span> {formatPrice(order.total)}
                        </div>
                        {order.deliveryDate && (
                          <div>
                            <span className="font-medium">Delivered:</span> {formatDate(order.deliveryDate)}
                          </div>
                        )}
                      </div>
                      {order.items.length > 1 && (
                        <div className="mt-2 pt-2 border-t border-[#e8e8e8]">
                          <div className="font-medium mb-1">Items in this order:</div>
                          {order.items.map((item, i) => (
                            <div key={i} className="flex justify-between py-0.5">
                              <span className="text-[#0f1111] truncate mr-4">{item.name}</span>
                              <span className="text-[#0f1111] flex-shrink-0">{formatPrice(item.price)} x{item.quantity}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-[#565959]">
              <Package className="w-12 h-12 mx-auto mb-3 text-[#d5d9d9]" />
              <p className="text-sm">No orders match your search</p>
            </div>
          )}
        </div>

        {/* ── Extracted facts sidebar ──────────────────────────────── */}
        <FactsSidebar
          facts={extractionResults.facts}
          isOpen={factsOpen}
          onToggle={() => setFactsOpen(!factsOpen)}
          theme="light"
        />
      </div>
    </div>
  );
}
