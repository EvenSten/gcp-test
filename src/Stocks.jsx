import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import "./Stocks.css";

// ── Yahoo Finance via self-hosted proxy ───────────────────────
// Requests go to /yf-proxy/ which nginx (prod) and Vite (dev) both
// forward server-side to query1.finance.yahoo.com — no CORS proxy needed.

const YF_CHART = "/yf-proxy/v8/finance/chart";

const _cache = new Map();
const TTL    = 5 * 60 * 1000;

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function parseYahooResponse(symbol, json) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data");

  const meta   = result.meta ?? {};
  const ts     = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];

  const points = ts
    .map((t, i) => ({ time: formatTime(t), price: closes[i], i }))
    .filter((p) => p.price != null && !isNaN(p.price));

  const price     = meta.regularMarketPrice ?? 0;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
  const change    = price - prevClose;
  const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    symbol:      symbol.toUpperCase(),
    name:        meta.shortName ?? meta.longName ?? symbol,
    price,
    prevClose,
    change,
    changePct,
    up:          changePct >= 0,
    points,
    currency:    meta.currency  ?? "USD",
    marketState: meta.marketState ?? "REGULAR",
    exchange:    meta.exchangeName ?? meta.fullExchangeName ?? null,
    isMock:      false,
    dayOpen:     meta.regularMarketOpen    ?? null,
    dayHigh:     meta.regularMarketDayHigh ?? null,
    dayLow:      meta.regularMarketDayLow  ?? null,
    volume:      meta.regularMarketVolume  ?? null,
    week52High:  meta.fiftyTwoWeekHigh     ?? null,
    week52Low:   meta.fiftyTwoWeekLow      ?? null,
    marketCap:   meta.marketCap            ?? null,
    postPrice:   meta.postMarketPrice          ?? null,
    postChange:  meta.postMarketChange         ?? null,
    postPct:     meta.postMarketChangePercent  ?? null,
    prePrice:    meta.preMarketPrice           ?? null,
    preChange:   meta.preMarketChange          ?? null,
    prePct:      meta.preMarketChangePercent   ?? null,
  };
}

async function fetchSymbolData(symbol) {
  const sym    = symbol.toUpperCase();
  const cached = _cache.get(sym);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const url  = `${YF_CHART}/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=true`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const data = parseYahooResponse(sym, json);
  _cache.set(sym, { data, ts: Date.now() });
  return data;
}

// ── Seeded mock fallback ──────────────────────────────────────

const STOCK_NAMES = {
  AAPL: "Apple Inc.", GOOGL: "Alphabet Inc.", MSFT: "Microsoft Corp.", AMZN: "Amazon.com Inc.",
  NVDA: "NVIDIA Corp.", TSLA: "Tesla Inc.", META: "Meta Platforms", AMD: "Advanced Micro Devices",
  NFLX: "Netflix Inc.", JPM: "JPMorgan Chase", SPY: "S&P 500 ETF", QQQ: "Nasdaq-100 ETF",
  V: "Visa Inc.", WMT: "Walmart Inc.", DIS: "Walt Disney Co.", BRK: "Berkshire Hathaway",
  COIN: "Coinbase Global", UBER: "Uber Technologies", SHOP: "Shopify Inc.", PLTR: "Palantir",
};
const MOCK_PRICES = {
  AAPL: 232, GOOGL: 175, MSFT: 425, AMZN: 195, NVDA: 875, TSLA: 245, META: 615,
  AMD: 155, NFLX: 900, JPM: 250, SPY: 585, QQQ: 505, V: 320, WMT: 98, DIS: 115,
  BRK: 475, COIN: 255, UBER: 82, SHOP: 95, PLTR: 42,
};
const MOCK_VOL = { TSLA: 0.018, NVDA: 0.015, COIN: 0.022, PLTR: 0.020, AMD: 0.013, META: 0.011, default: 0.009 };

function seededRNG(seed) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 17), 0x45d9f3b) ^ (s >>> 11)) >>> 0; return s / 4294967296; };
}
function strSeed(str) {
  return str.split("").reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0) >>> 0;
}

function getMockData(symbol) {
  const sym  = symbol.toUpperCase();
  const base = MOCK_PRICES[sym] ?? 100;
  const vol  = MOCK_VOL[sym] ?? MOCK_VOL.default;
  const rand = seededRNG(strSeed(sym + new Date().toDateString()));

  let price = base * (1 + (rand() - 0.5) * 0.04);
  const prevClose = price;
  const pts = [];

  for (let i = 0; i <= 78; i++) {
    const min = 570 + i * 5;
    price = Math.max(price * (1 + (rand() - 0.478) * vol * 2), 0.01);
    pts.push({ time: `${Math.floor(min / 60)}:${(min % 60).toString().padStart(2, "0")}`, price, i });
  }

  const last = pts[pts.length - 1].price;
  const chg  = last - prevClose;
  const pct  = (chg / prevClose) * 100;
  return {
    symbol: sym, name: STOCK_NAMES[sym] ?? sym,
    price: last, prevClose, change: chg, changePct: pct, up: pct >= 0,
    points: pts, currency: "USD", marketState: "MOCK", isMock: true,
    dayOpen: null, dayHigh: null, dayLow: null, volume: null,
    week52High: null, week52Low: null, exchange: null, marketCap: null,
    postPrice: null, postChange: null, postPct: null,
    prePrice: null, preChange: null, prePct: null,
  };
}

// ── Market index config ───────────────────────────────────────

const INDEX_CFG = [
  { key: "^GSPC", label: "S&P 500", ticker: "SPX" },
  { key: "^IXIC", label: "NASDAQ",  ticker: "NDX" },
  { key: "^DJI",  label: "DOW",     ticker: "DJI" },
  { key: "^VIX",  label: "VIX",     ticker: "VIX" },
];

const INDEX_FALLBACK = {
  "^GSPC": { label: "S&P 500", value: "—", change: "—", up: true  },
  "^IXIC": { label: "NASDAQ",  value: "—", change: "—", up: true  },
  "^DJI":  { label: "DOW",     value: "—", change: "—", up: false },
  "^VIX":  { label: "VIX",     value: "—", change: "—", up: false },
};

// ── News (static) ─────────────────────────────────────────────

const NEWS_ITEMS = [
  { headline: "Fed Minutes Signal Rate Cut Pause as Inflation Remains Sticky",             source: "Reuters",   time: "2h ago",  ticker: "SPY",  up: false },
  { headline: "NVIDIA Posts Record Revenue, Beats Analyst Expectations by 15%",            source: "Bloomberg", time: "3h ago",  ticker: "NVDA", up: true  },
  { headline: "Apple Unveils Next-Gen AI Features Ahead of Annual Developer Conference",    source: "WSJ",       time: "4h ago",  ticker: "AAPL", up: true  },
  { headline: "Tesla Deliveries Miss Q1 Estimates; Shares Slide in Pre-Market Trading",    source: "CNBC",      time: "5h ago",  ticker: "TSLA", up: false },
  { headline: "Amazon AWS Growth Accelerates as Enterprise Cloud Spending Rebounds",       source: "FT",        time: "6h ago",  ticker: "AMZN", up: true  },
  { headline: "Meta Raises Full-Year Guidance on Back of Strong Ad Revenue Surge",         source: "Barron's",  time: "7h ago",  ticker: "META", up: true  },
  { headline: "Microsoft Copilot Reaches 100 Million Enterprise Users Milestone",          source: "Reuters",   time: "8h ago",  ticker: "MSFT", up: true  },
  { headline: "JPMorgan Beats Q1 Profit Estimates on Strong Fixed Income Trading Revenue", source: "Bloomberg", time: "9h ago",  ticker: "JPM",  up: true  },
  { headline: "S&P 500 Posts Best Week of the Year on Cooling Core Inflation Data",        source: "WSJ",       time: "10h ago", ticker: "SPY",  up: true  },
  { headline: "Palantir Wins Major Government AI Contract Worth Over $400M",               source: "CNBC",      time: "11h ago", ticker: "PLTR", up: true  },
];
const NEWS_ACCENT = ["#00C8E0","#B94FFF","#FF6B35","#4DFFB4","#FFD93D","#FF6B6B","#57C7FF","#AA55FF","#33CC88","#FF9955"];

// ── Helpers ───────────────────────────────────────────────────

function fmtPrice(p) {
  if (!p && p !== 0) return "—";
  if (p >= 10000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (p >= 1000)  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(2)}`;
}

function fmtB(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n), neg = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${neg}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${neg}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${neg}$${(abs / 1e6).toFixed(1)}M`;
  return `${neg}$${abs.toLocaleString()}`;
}

function fmtVol(v) {
  if (!v) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString();
}

function fmtChg(change, pct) {
  if (change == null || pct == null) return null;
  const up = change >= 0;
  return { str: `${up ? "▲" : "▼"} ${Math.abs(change).toFixed(2)} (${up ? "+" : ""}${pct.toFixed(2)}%)`, color: up ? "#4DFFB4" : "#FF6B6B", up };
}

// ── Large chart (modal) ───────────────────────────────────────

function LargeStockChart({ points, up }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  if (!points || points.length < 2) return null;

  const W = 700, H = 190;
  const PAD = { top: 16, right: 16, bottom: 30, left: 64 };
  const PW = W - PAD.left - PAD.right;
  const PH = H - PAD.top  - PAD.bottom;

  const prices = points.map((p) => p.price);
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);
  const range  = maxP - minP || 1;
  const n      = points.length;
  const xOf    = (i) => PAD.left + (i / (n - 1)) * PW;
  const yOf    = (v)  => PAD.top  + PH - ((v - minP) / range) * PH;
  const color  = up ? "#4DFFB4" : "#FF6B6B";
  const d      = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(pt.price).toFixed(1)}`).join(" ");
  const fillD  = `${d} L ${xOf(n - 1).toFixed(1)} ${PAD.top + PH} L ${xOf(0).toFixed(1)} ${PAD.top + PH} Z`;
  const gid    = `lc-${up ? 1 : 0}`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minP + f * range);
  const step   = Math.max(1, Math.ceil(n / 6));
  const xLabels = points.filter((_, i) => i % step === 0 || i === n - 1);

  const handleMouseMove = useCallback((e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) * (W / rect.width) - PAD.left;
    setHoverIdx(Math.max(0, Math.min(n - 1, Math.round((rawX / PW) * (n - 1)))));
  }, [n]);

  return (
    <div className="sk-large-chart">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="sk-large-chart-svg"
        onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (!svgRef.current) return;
          const rect = svgRef.current.getBoundingClientRect();
          const rawX = (t.clientX - rect.left) * (W / rect.width) - PAD.left;
          setHoverIdx(Math.max(0, Math.min(n - 1, Math.round((rawX / PW) * (n - 1)))));
        }}
        onTouchEnd={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0"   />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yOf(v)} x2={W - PAD.right} y2={yOf(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x={PAD.left - 8} y={yOf(v)} textAnchor="end" dominantBaseline="middle"
              style={{ fill: "rgba(255,255,255,0.25)", fontSize: 10, fontFamily: "monospace" }}>{fmtPrice(v)}</text>
          </g>
        ))}
        <line x1={PAD.left} y1={PAD.top + PH} x2={W - PAD.right} y2={PAD.top + PH} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
        {xLabels.map((pt) => (
          <text key={pt.i} x={xOf(pt.i)} y={H - 6} textAnchor="middle"
            style={{ fill: "rgba(255,255,255,0.22)", fontSize: 9, fontFamily: "monospace" }}>{pt.time}</text>
        ))}
        <path d={fillD} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {hoverIdx !== null && (
          <>
            <line x1={xOf(hoverIdx)} y1={PAD.top} x2={xOf(hoverIdx)} y2={PAD.top + PH}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,3" />
            <circle cx={xOf(hoverIdx)} cy={yOf(points[hoverIdx].price)} r={4}
              fill={color} stroke="#0d1220" strokeWidth="2" />
          </>
        )}
      </svg>
      {hoverIdx !== null && (
        <div className="sk-chart-tooltip">
          <span className="sk-chart-tt-time">{points[hoverIdx].time}</span>
          <span className="sk-chart-tt-price" style={{ color }}>{fmtPrice(points[hoverIdx].price)}</span>
        </div>
      )}
    </div>
  );
}

// ── Stock Detail Modal ────────────────────────────────────────

function StockDetailModal({ data, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const {
    symbol, name, price, prevClose, change, changePct, up, points,
    marketState, exchange, currency,
    dayOpen, dayHigh, dayLow, volume,
    week52High, week52Low, marketCap,
    postPrice, postChange, postPct,
    prePrice,  preChange,  prePct,
  } = data;

  const priceColor = up ? "#4DFFB4" : "#FF6B6B";
  const showPost   = postPrice && (marketState === "POST" || marketState === "CLOSED");
  const showPre    = prePrice  && marketState === "PRE";
  const postChg    = showPost ? fmtChg(postChange, postPct) : null;
  const preChg     = showPre  ? fmtChg(preChange,  prePct)  : null;

  const marketLabel = { REGULAR: "● Market Open", PRE: "◌ Pre-Market", POST: "◌ After-Hours", CLOSED: "○ Market Closed", MOCK: "⊙ Demo" }[marketState] ?? marketState;
  const marketColor = { REGULAR: "#4DFFB4", PRE: "#FFD93D", POST: "#FFD93D", CLOSED: "rgba(255,255,255,0.3)", MOCK: "rgba(255,217,61,0.5)" }[marketState] ?? "rgba(255,255,255,0.3)";

  const stats = [
    { label: "OPEN",       value: fmtPrice(dayOpen)    },
    { label: "DAY HIGH",   value: fmtPrice(dayHigh)    },
    { label: "DAY LOW",    value: fmtPrice(dayLow)     },
    { label: "PREV CLOSE", value: fmtPrice(prevClose)  },
    { label: "VOLUME",     value: fmtVol(volume)       },
    { label: "MKT CAP",    value: fmtB(marketCap)      },
    { label: "52W HIGH",   value: fmtPrice(week52High) },
    { label: "52W LOW",    value: fmtPrice(week52Low)  },
    { label: "EXCHANGE",   value: exchange ?? "—"      },
    { label: "CURRENCY",   value: currency ?? "USD"    },
  ];

  return (
    <div className="sk-modal-overlay" onClick={onClose}>
      <div className="sk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sk-modal-header">
          <div className="sk-modal-title-group">
            <span className="sk-modal-symbol">{symbol}</span>
            <span className="sk-modal-name">{name}</span>
          </div>
          <div className="sk-modal-price-group">
            <span className="sk-modal-price">{fmtPrice(price)}</span>
            <span className="sk-modal-change" style={{ color: priceColor }}>
              {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
            <span className="sk-market-state-badge" style={{ color: marketColor }}>{marketLabel}</span>
          </div>
          <button className="sk-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="sk-modal-body">
          {showPost && postChg && (
            <div className="sk-ext-hours">
              <span className="sk-ext-label">AFTER-HOURS</span>
              <span className="sk-ext-price">{fmtPrice(postPrice)}</span>
              <span style={{ color: postChg.color }}>{postChg.str}</span>
            </div>
          )}
          {showPre && preChg && (
            <div className="sk-ext-hours">
              <span className="sk-ext-label">PRE-MARKET</span>
              <span className="sk-ext-price">{fmtPrice(prePrice)}</span>
              <span style={{ color: preChg.color }}>{preChg.str}</span>
            </div>
          )}

          <div className="sk-modal-chart-wrap">
            <LargeStockChart points={points} up={up} />
          </div>

          <div className="sk-fin-section-label">DAY STATISTICS — sourced from Yahoo Finance</div>
          <div className="sk-detail-stats">
            {stats.map((s) => (
              <div key={s.label} className="sk-detail-stat">
                <div className="sk-detail-stat-label">{s.label}</div>
                <div className="sk-detail-stat-value">{s.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StockMiniChart ────────────────────────────────────────────

function StockMiniChart({ points, up }) {
  if (!points || points.length < 2) return <div className="sk-chart-wrap sk-chart-empty" />;
  const W = 300, H = 72;
  const prices = points.map((p) => p.price);
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);
  const range  = maxP - minP || 1;
  const xOf    = (i) => (i / (points.length - 1)) * W;
  const yOf    = (p)  => H - ((p - minP) / range) * H * 0.82 - H * 0.09;
  const d      = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(pt.price).toFixed(1)}`).join(" ");
  const fillD  = `${d} L ${xOf(points.length - 1).toFixed(1)} ${H} L 0 ${H} Z`;
  const color  = up ? "#4DFFB4" : "#FF6B6B";
  const gid    = `sg-${points[0]?.i ?? 0}-${points.length}-${up ? 1 : 0}`;

  return (
    <div className="sk-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="sk-minichart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0"    />
          </linearGradient>
        </defs>
        <path d={fillD} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ── Stock Widget ──────────────────────────────────────────────

function StockWidget({ id, symbol, data, loading, onRemove, onSelect,
  idx, dragSrc, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
  onTouchDragStart, onTouchDragMove, onTouchDragEnd }) {

  const isDragging = dragSrc === idx;
  const isOver     = dragOver === idx && dragSrc !== idx;
  const cardClass  = ["sk-widget", isDragging ? "sk-widget-dragging" : "", isOver ? "sk-widget-over" : ""].filter(Boolean).join(" ");
  const dragHandlers = {
    onDragOver:  (e) => { e.preventDefault(); onDragOver(idx); },
    onDragLeave: onDragLeave,
    onDrop:      (e) => { e.preventDefault(); onDrop(idx); },
  };

  const touchHandlers = {
    onTouchStart: () => onTouchDragStart(idx),
    onTouchMove:  (e) => { const t = e.touches[0]; onTouchDragMove(t.clientX, t.clientY); },
    onTouchEnd:   onTouchDragEnd,
  };

  if (loading) {
    return (
      <div className={cardClass} {...dragHandlers} data-widget-idx={idx}>
        <div className="sk-widget-header" draggable onDragStart={() => onDragStart(idx)} onDragEnd={onDragEnd} {...touchHandlers}>
          <span className="sk-drag-handle">⠿</span>
          <span className="sk-widget-symbol">{symbol}</span>
          <span className="sk-widget-name sk-shimmer-text">Fetching…</span>
          <button className="sk-widget-remove" onClick={() => onRemove(id)}>✕</button>
        </div>
        <div className="sk-widget-body">
          <div className="sk-skeleton sk-skel-price" />
          <div className="sk-skeleton sk-skel-chart" />
          <div className="sk-skeleton sk-skel-bar" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { name, price, change, changePct, up, points, isMock, marketState,
    postPrice, postChange, postPct, prePrice, preChange, prePct } = data;

  const color    = up ? "#4DFFB4" : "#FF6B6B";
  const showPost = postPrice && (marketState === "POST" || marketState === "CLOSED");
  const showPre  = prePrice  && marketState === "PRE";

  return (
    <div className={cardClass} {...dragHandlers} data-widget-idx={idx}>
      <div className="sk-widget-header" draggable onDragStart={() => onDragStart(idx)} onDragEnd={onDragEnd} {...touchHandlers}>
        <span className="sk-drag-handle">⠿</span>
        <span className="sk-widget-symbol">{symbol}</span>
        <span className="sk-widget-name">{name}</span>
        {isMock && <span className="sk-mock-badge">demo</span>}
        <button className="sk-widget-remove" onClick={(e) => { e.stopPropagation(); onRemove(id); }}>✕</button>
      </div>

      <div className="sk-widget-body sk-widget-clickable" onClick={() => onSelect(symbol)}>
        <div className="sk-price-row">
          <span className="sk-price">{fmtPrice(price)}</span>
          <span className="sk-change" style={{ color }}>
            {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
          </span>
        </div>

        {showPost && postChange != null && (
          <div className="sk-widget-ext">
            <span className="sk-widget-ext-label">After-hrs</span>
            <span className="sk-widget-ext-price">{fmtPrice(postPrice)}</span>
            <span style={{ color: postChange >= 0 ? "#4DFFB4" : "#FF6B6B", fontSize: 10 }}>
              {postChange >= 0 ? "▲" : "▼"} {postPct != null ? `${Math.abs(postPct).toFixed(2)}%` : ""}
            </span>
          </div>
        )}
        {showPre && preChange != null && (
          <div className="sk-widget-ext">
            <span className="sk-widget-ext-label">Pre-mkt</span>
            <span className="sk-widget-ext-price">{fmtPrice(prePrice)}</span>
            <span style={{ color: preChange >= 0 ? "#4DFFB4" : "#FF6B6B", fontSize: 10 }}>
              {preChange >= 0 ? "▲" : "▼"} {prePct != null ? `${Math.abs(prePct).toFixed(2)}%` : ""}
            </span>
          </div>
        )}

        <StockMiniChart points={points} up={up} />

        <div className="sk-time-bar">
          <span>9:30</span>
          <span>12:00</span>
          <span>16:00</span>
        </div>
        <div className="sk-financials-hint">↗ Tap for details</div>
      </div>
    </div>
  );
}

// ── Ticker Bar ────────────────────────────────────────────────

function TickerBar({ stockData, indexData }) {
  const indexItems = INDEX_CFG.map(({ key, ticker }) => {
    const d = indexData[key];
    if (!d) return null;
    return { sym: ticker, price: fmtPrice(d.price), pct: `${d.up ? "+" : ""}${d.changePct.toFixed(2)}%`, up: d.up };
  }).filter(Boolean);

  const stockItems = Object.values(stockData).filter((d) => !d.isMock).map((d) => ({
    sym: d.symbol, price: fmtPrice(d.price), pct: `${d.up ? "+" : ""}${d.changePct.toFixed(2)}%`, up: d.up,
  }));

  const items = [...indexItems, ...stockItems];
  if (items.length === 0) return <div className="sk-ticker-outer"><div className="sk-ticker-loading">Fetching market data…</div></div>;

  const all = [...items, ...items];
  return (
    <div className="sk-ticker-outer">
      <div className="sk-ticker-track" style={{ animationDuration: `${Math.max(20, all.length * 3)}s` }}>
        {all.map((item, i) => (
          <span key={i} className="sk-ticker-item">
            <span className="sk-ticker-sym">{item.sym}</span>
            <span className="sk-ticker-price">{item.price}</span>
            <span className="sk-ticker-chg" style={{ color: item.up ? "#4DFFB4" : "#FF6B6B" }}>{item.up ? "▲" : "▼"} {item.pct}</span>
            <span className="sk-ticker-sep">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Market Index Bar ──────────────────────────────────────────

function MarketBar({ indexData }) {
  const indices = INDEX_CFG.map(({ key, label }) => {
    const d = indexData[key];
    if (d) return { label, value: fmtPrice(d.price), change: `${d.up ? "+" : ""}${d.changePct.toFixed(2)}%`, up: d.up };
    return INDEX_FALLBACK[key] ?? { label, value: "—", change: "—", up: true };
  });
  return (
    <div className="sk-market-bar">
      {indices.map((idx) => (
        <div key={idx.label} className="sk-market-card">
          <div className="sk-market-label">{idx.label}</div>
          <div className="sk-market-value">{idx.value}</div>
          {idx.value === "—"
            ? <div className="sk-market-change sk-skeleton-inline" />
            : <div className="sk-market-change" style={{ color: idx.up ? "#4DFFB4" : "#FF6B6B" }}>{idx.up ? "▲" : "▼"} {idx.change}</div>
          }
        </div>
      ))}
    </div>
  );
}

// ── News Carousel ─────────────────────────────────────────────

function NewsCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cpv,    setCpv]    = useState(3);
  const viewRef  = useRef(null);
  const timerRef = useRef(null);
  const total    = NEWS_ITEMS.length;
  const maxIdx   = total - cpv;

  useEffect(() => {
    const update = () => setCpv(window.innerWidth <= 640 ? 1 : window.innerWidth <= 960 ? 2 : 3);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const advance = useCallback(() => setActive((p) => (p >= maxIdx ? 0 : p + 1)), [maxIdx]);
  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(advance, 5000);
    return () => clearInterval(timerRef.current);
  }, [advance, paused]);

  const go = (dir) => {
    clearInterval(timerRef.current);
    setActive((p) => Math.max(0, Math.min(maxIdx, p + dir)));
    timerRef.current = setInterval(advance, 5000);
  };

  const [cardPx, setCardPx] = useState(0);
  useEffect(() => {
    const update = () => { if (viewRef.current) setCardPx(viewRef.current.offsetWidth / cpv); };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [cpv]);

  return (
    <div className="sk-news-section" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="sk-news-hd">
        <span className="sk-section-label">MARKET NEWS</span>
        <div className="sk-news-controls">
          <button className="sk-news-btn" onClick={() => go(-1)} disabled={active === 0}>‹</button>
          <button className="sk-news-btn" onClick={() => go(1)}  disabled={active >= maxIdx}>›</button>
        </div>
      </div>
      <div className="sk-news-viewport" ref={viewRef}>
        <div className="sk-news-track" style={{ transform: `translateX(-${active * cardPx}px)`, width: `${total * cardPx}px` }}>
          {NEWS_ITEMS.map((item, i) => (
            <div key={i} className="sk-news-card" style={{ width: `${cardPx}px` }}>
              <div className="sk-news-bar" style={{ background: NEWS_ACCENT[i % NEWS_ACCENT.length] }} />
              <div className="sk-news-body">
                <div className="sk-news-meta">
                  <span className="sk-news-source">{item.source}</span>
                  <span className="sk-news-time">{item.time}</span>
                  <span className="sk-news-ticker" style={{ color: item.up ? "#4DFFB4" : "#FF6B6B" }}>{item.ticker} {item.up ? "▲" : "▼"}</span>
                </div>
                <div className="sk-news-headline">{item.headline}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="sk-news-dots">
        {Array.from({ length: maxIdx + 1 }, (_, i) => (
          <button key={i} className={`sk-news-dot${i === active ? " sk-dot-active" : ""}`}
            onClick={() => { clearInterval(timerRef.current); setActive(i); timerRef.current = setInterval(advance, 5000); }} />
        ))}
      </div>
    </div>
  );
}

// ── Add Stock Panel ───────────────────────────────────────────

const SUGGESTIONS = ["AAPL","GOOGL","MSFT","NVDA","TSLA","META","AMZN","AMD","NFLX","JPM","V","WMT","DIS","COIN","UBER","SHOP","PLTR","QQQ","SPY","BRK"];

function AddStockPanel({ onAdd, onClose, existing }) {
  const [input, setInput] = useState("");
  const [err,   setErr]   = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = (sym) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    if (existing.includes(s)) { setErr(`${s} is already in your watchlist.`); return; }
    onAdd(s); setInput(""); setErr("");
  };

  return (
    <div className="sk-add-panel">
      <div className="sk-add-row">
        <input ref={inputRef} className="sk-add-input"
          placeholder="Ticker symbol (e.g. AAPL, GOOGL, TSLA)"
          value={input}
          onChange={(e) => { setInput(e.target.value.toUpperCase()); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(input); if (e.key === "Escape") onClose(); }}
          maxLength={8} />
        <button className="sk-add-confirm" onClick={() => commit(input)}>Add</button>
        <button className="sk-add-cancel"  onClick={onClose}>Cancel</button>
      </div>
      {err && <div className="sk-add-error">{err}</div>}
      <div className="sk-suggestions">
        {SUGGESTIONS.filter((s) => !existing.includes(s)).slice(0, 12).map((s) => (
          <button key={s} className="sk-suggestion" onClick={() => commit(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}

// ── Main Stocks Page ──────────────────────────────────────────

const DEFAULT_WATCHLIST = [
  { id: "s1", symbol: "AAPL" },
  { id: "s2", symbol: "NVDA" },
  { id: "s3", symbol: "MSFT" },
  { id: "s4", symbol: "TSLA" },
  { id: "s5", symbol: "META" },
  { id: "s6", symbol: "AMZN" },
];

export default function Stocks() {
  const [watchlist, setWatchlist] = useState(() => {
    try { const s = localStorage.getItem("stocks-watchlist"); if (s) return JSON.parse(s); } catch {}
    return DEFAULT_WATCHLIST;
  });

  const [stockData,     setStockData]     = useState({});
  const [loading,       setLoading]       = useState({});
  const [indexData,     setIndexData]     = useState({});
  const [showAdd,       setShowAdd]       = useState(false);
  const [dragSrc,       setDragSrc]       = useState(null);
  const [dragOver,      setDragOver]      = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);

  const touchDragSrcRef  = useRef(null);
  const touchDragOverRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("stocks-watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    INDEX_CFG.forEach(({ key }) => {
      fetchSymbolData(key)
        .then((d) => setIndexData((p) => ({ ...p, [key]: d })))
        .catch(() => {});
    });
  }, []);

  useEffect(() => {
    watchlist.forEach(({ symbol }) => {
      if (stockData[symbol] || loading[symbol]) return;
      setLoading((p) => ({ ...p, [symbol]: true }));
      fetchSymbolData(symbol)
        .then((data) => {
          setStockData((p) => ({ ...p, [symbol]: data }));
          setLoading((p)   => ({ ...p, [symbol]: false }));
        })
        .catch(() => {
          setStockData((p) => ({ ...p, [symbol]: getMockData(symbol) }));
          setLoading((p)   => ({ ...p, [symbol]: false }));
        });
    });
  }, [watchlist.map((w) => w.symbol).join(",")]);

  const addStock    = (sym) => { setWatchlist((p) => [...p, { id: `s${Date.now()}`, symbol: sym }]); setShowAdd(false); };
  const removeStock = (id)  => setWatchlist((p) => p.filter((w) => w.id !== id));

  const handleTouchDragStart = (idx) => {
    touchDragSrcRef.current  = idx;
    touchDragOverRef.current = idx;
    setDragSrc(idx);
  };

  const handleTouchDragMove = (x, y) => {
    if (touchDragSrcRef.current === null) return;
    const el   = document.elementFromPoint(x, y);
    const card = el?.closest("[data-widget-idx]");
    if (card) {
      const idx = parseInt(card.dataset.widgetIdx, 10);
      if (!isNaN(idx)) { touchDragOverRef.current = idx; setDragOver(idx); }
    }
  };

  const handleTouchDragEnd = () => {
    const src  = touchDragSrcRef.current;
    const over = touchDragOverRef.current;
    if (src !== null && over !== null && src !== over) {
      setWatchlist((prev) => {
        const next = [...prev];
        const [moved] = next.splice(src, 1);
        next.splice(src < over ? over - 1 : over, 0, moved);
        return next;
      });
    }
    touchDragSrcRef.current  = null;
    touchDragOverRef.current = null;
    setDragSrc(null);
    setDragOver(null);
  };

  const handleDrop = (toIdx) => {
    if (dragSrc !== null && dragSrc !== toIdx) {
      setWatchlist((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragSrc, 1);
        next.splice(dragSrc < toIdx ? toIdx - 1 : toIdx, 0, moved);
        return next;
      });
      setDragSrc(null);
    }
    setDragOver(null);
  };

  return (
    <div className="sk-page">
      <div className="sk-blob sk-blob-cyan" />
      <div className="sk-blob sk-blob-purple" />

      <header className="sk-header">
        <div>
          <div className="sk-logo">◈ NEXUS</div>
          <div className="sk-hsub">Knowledge Platform</div>
        </div>
        <nav className="sk-nav">
          <Link to="/"       className="sk-nav-link">◉ Dashboard</Link>
          <Link to="/editor" className="sk-nav-link">⚙ Editor</Link>
          <span className="sk-nav-link sk-nav-active">▦ Stocks</span>
        </nav>
        <button className="sk-signout-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </header>

      <TickerBar stockData={stockData} indexData={indexData} />
      <MarketBar indexData={indexData} />
      <NewsCarousel />

      <div className="sk-watchlist-hd">
        <span className="sk-section-label">WATCHLIST</span>
        <span className="sk-watchlist-count">{watchlist.length} stocks</span>
        <button className="sk-add-btn" onClick={() => setShowAdd((p) => !p)}>
          {showAdd ? "✕ Close" : "+ Add Stock"}
        </button>
      </div>

      {showAdd && <AddStockPanel onAdd={addStock} onClose={() => setShowAdd(false)} existing={watchlist.map((w) => w.symbol)} />}

      <div className="sk-grid">
        {watchlist.length === 0 && (
          <div className="sk-empty">
            <div className="sk-empty-icon">▦</div>
            <div className="sk-empty-title">Watchlist is empty</div>
            <div className="sk-empty-sub">Click "+ Add Stock" to start tracking.</div>
          </div>
        )}
        {watchlist.map((item, i) => (
          <StockWidget
            key={item.id} id={item.id} symbol={item.symbol}
            data={stockData[item.symbol] ?? null}
            loading={!!loading[item.symbol]}
            onRemove={removeStock} onSelect={setSelectedStock}
            idx={i} dragSrc={dragSrc} dragOver={dragOver}
            onDragStart={setDragSrc}
            onDragEnd={() => { setDragSrc(null); setDragOver(null); }}
            onDragOver={setDragOver}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop}
            onTouchDragStart={handleTouchDragStart}
            onTouchDragMove={handleTouchDragMove}
            onTouchDragEnd={handleTouchDragEnd}
          />
        ))}
      </div>

      <div className="sk-demo-note">
        ⊙ Prices via Yahoo Finance · After-hours shown when markets are closed · Refreshes every 5 min · "demo" = Yahoo unavailable
      </div>

      {selectedStock && stockData[selectedStock] && (
        <StockDetailModal
          data={stockData[selectedStock]}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  );
}
