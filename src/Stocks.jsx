import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import "./Stocks.css";

// ── Yahoo Finance via CORS proxy ──────────────────────────────
// Yahoo Finance doesn't send CORS headers, so browser requests need a proxy.
// corsproxy.io is a free, open-source CORS proxy.

const CORS_PROXY = "https://corsproxy.io/?url=";
const YF_CHART   = "https://query1.finance.yahoo.com/v8/finance/chart";

const _cache = new Map(); // symbol -> { data, ts }
const TTL    = 5 * 60 * 1000; // re-fetch after 5 minutes

function formatTime(ts) {
  const d = new Date(ts * 1000); // Yahoo sends Unix seconds
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

  const price     = meta.regularMarketPrice ?? points[points.length - 1]?.price ?? 0;
  const open      = meta.chartPreviousClose ?? meta.regularMarketOpen ?? price;
  const change    = price - open;
  const changePct = open > 0 ? (change / open) * 100 : 0;

  return {
    symbol:      symbol.toUpperCase(),
    name:        meta.shortName ?? meta.longName ?? symbol,
    price,
    open,
    change,
    changePct,
    up:          changePct >= 0,
    points,
    currency:    meta.currency ?? "USD",
    marketState: meta.marketState ?? "REGULAR",
    isMock:      false,
  };
}

async function fetchSymbolData(symbol) {
  const sym    = symbol.toUpperCase();
  const cached = _cache.get(sym);
  if (cached && Date.now() - cached.ts < TTL) return cached.data;

  const yfUrl = `${YF_CHART}/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=false`;
  const res   = await fetch(CORS_PROXY + encodeURIComponent(yfUrl));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json  = await res.json();

  const data = parseYahooResponse(sym, json);
  _cache.set(sym, { data, ts: Date.now() });
  return data;
}

// ── Seeded mock data (fallback when Yahoo Finance is unreachable) ──

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
  const open  = price;
  const pts   = [];

  for (let i = 0; i <= 78; i++) {
    const min = 570 + i * 5;
    price = Math.max(price * (1 + (rand() - 0.478) * vol * 2), 0.01);
    pts.push({ time: `${Math.floor(min / 60)}:${(min % 60).toString().padStart(2, "0")}`, price, i });
  }

  const last = pts[pts.length - 1].price;
  const chg  = last - open;
  const pct  = (chg / open) * 100;
  return { symbol: sym, name: STOCK_NAMES[sym] ?? sym, price: last, open, change: chg, changePct: pct, up: pct >= 0, points: pts, currency: "USD", marketState: "MOCK", isMock: true };
}

// ── Market index config ───────────────────────────────────────

const INDEX_CFG = [
  { key: "^GSPC", label: "S&P 500", ticker: "SPX" },
  { key: "^IXIC", label: "NASDAQ",  ticker: "NDX" },
  { key: "^DJI",  label: "DOW",     ticker: "DJI" },
  { key: "^VIX",  label: "VIX",     ticker: "VIX" },
];

// Static fallback for indices (shown until real data arrives)
const INDEX_FALLBACK = {
  "^GSPC": { label: "S&P 500", value: "—",  change: "—", up: true  },
  "^IXIC": { label: "NASDAQ",  value: "—",  change: "—", up: true  },
  "^DJI":  { label: "DOW",     value: "—",  change: "—", up: false },
  "^VIX":  { label: "VIX",     value: "—",  change: "—", up: false },
};

// ── News headlines (static) ───────────────────────────────────

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

// ── Financials fetch — Alpha Vantage ──────────────────────────
// Key lives in .env as VITE_AV_KEY (git-ignored).
// Alpha Vantage supports browser CORS natively — no proxy needed.

const AV_BASE = "https://www.alphavantage.co/query";
const AV_KEY  = import.meta.env.VITE_AV_KEY ?? "";

const _finCache = new Map();
const FIN_TTL   = 6 * 60 * 60 * 1000; // 6 hours — filings don't change intraday

function avNum(v)  { return v && v !== "None" && !isNaN(v) ? parseFloat(v)                       : null; }
function avPct(v)  { const n = avNum(v); return n != null ? `${(n * 100).toFixed(1)}%`           : "—";  }
function avFmt(v)  { const n = avNum(v); return n != null ? n.toFixed(2)                          : "—";  }
function avInt(v)  { return parseInt(v, 10) || 0; }

async function fetchFinancials(symbol) {
  const sym    = symbol.toUpperCase();
  const cached = _finCache.get(sym);
  if (cached && Date.now() - cached.ts < FIN_TTL) return cached.data;

  if (!AV_KEY) throw new Error("No API key — add VITE_AV_KEY to your .env file");

  // Fetch income statement + company overview in parallel
  const [incRes, ovRes] = await Promise.all([
    fetch(`${AV_BASE}?function=INCOME_STATEMENT&symbol=${sym}&apikey=${AV_KEY}`),
    fetch(`${AV_BASE}?function=OVERVIEW&symbol=${sym}&apikey=${AV_KEY}`),
  ]);

  if (!incRes.ok) throw new Error(`Income statement fetch failed (${incRes.status})`);
  if (!ovRes.ok)  throw new Error(`Overview fetch failed (${ovRes.status})`);

  const [inc, ov] = await Promise.all([incRes.json(), ovRes.json()]);

  // Alpha Vantage returns an "Information" key when rate-limited
  if (inc.Information || inc.Note) throw new Error("Alpha Vantage rate limit reached (25 req/day on free tier)");
  if (!inc.quarterlyReports?.length) throw new Error("No quarterly data returned — check the ticker symbol");

  const quarters = inc.quarterlyReports.slice(0, 4).reverse().map((q) => {
    const rev  = avInt(q.totalRevenue);
    const gp   = avInt(q.grossProfit);
    const ni   = avInt(q.netIncome);
    const cogs = avInt(q.costOfRevenue);
    return {
      date:           q.fiscalDateEnding,
      revenue:        rev,  revenueStr:    fmtB(rev),
      grossProfit:    gp,   grossStr:      fmtB(gp),
      netIncome:      ni,   netIncomeStr:  fmtB(ni),
      costOfRevenue:  cogs,
      operatingIncome: avInt(q.operatingIncome),
    };
  });

  // Gross margin: derive from TTM figures if available, else latest quarter
  const gpTTM  = avNum(ov.GrossProfitTTM);
  const revTTM = avNum(ov.RevenueTTM);
  const grossMarginStr = gpTTM && revTTM && revTTM > 0
    ? `${((gpTTM / revTTM) * 100).toFixed(1)}%`
    : (quarters.length && quarters[quarters.length - 1].revenue > 0
        ? `${((quarters[quarters.length - 1].grossProfit / quarters[quarters.length - 1].revenue) * 100).toFixed(1)}%`
        : "—");

  const data = {
    quarters,
    profitMargin:    avPct(ov.ProfitMargin),
    grossMargin:     grossMarginStr,
    operatingMargin: avPct(ov.OperatingMarginTTM),
    returnOnEquity:  avPct(ov.ReturnOnEquityTTM),
    revenueGrowth:   avPct(ov.QuarterlyRevenueGrowthYOY),
    earningsGrowth:  avPct(ov.QuarterlyEarningsGrowthYOY),
    peRatio:         avFmt(ov.TrailingPE   || ov.ForwardPE),
    eps:             avFmt(ov.EPS),
    beta:            avFmt(ov.Beta),
    returnOnAssets:  avPct(ov.ReturnOnAssetsTTM),
  };

  _finCache.set(sym, { data, ts: Date.now() });
  return data;
}

// ── Helpers ───────────────────────────────────────────────────

function fmtPrice(p) {
  if (p >= 10000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (p >= 1000)  return `$${p.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${p.toFixed(2)}`;
}

function fmtB(n) {
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const neg = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${neg}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${neg}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${neg}$${(abs / 1e6).toFixed(1)}M`;
  return `${neg}$${abs.toLocaleString()}`;
}

function fmtQuarter(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  const [year, month] = dateStr.split("-").map(Number);
  return `Q${Math.ceil(month / 3)} '${String(year).slice(2)}`;
}

// ── FinancialLineChart ────────────────────────────────────────

function FinancialLineChart({ quarters, dataKey, label, color }) {
  const [hovered, setHovered] = useState(null);
  const values = quarters.map((q) => q[dataKey]);
  const labels = quarters.map((q) => fmtQuarter(q.date));

  if (!values.length || values.every((v) => !v)) {
    return (
      <div className="sk-fin-chart">
        <div className="sk-fin-chart-label">{label}</div>
        <div className="sk-fin-chart-empty">No data</div>
      </div>
    );
  }

  const W = 280, H = 130;
  const PAD = { top: 28, right: 16, bottom: 34, left: 8 };
  const PW  = W - PAD.left - PAD.right;
  const PH  = H - PAD.top  - PAD.bottom;
  const n   = values.length;

  const minV  = Math.min(...values);
  const maxV  = Math.max(...values);
  const range = maxV - minV || 1;
  const xOf   = (i) => PAD.left + (i / Math.max(n - 1, 1)) * PW;
  const yOf   = (v)  => PAD.top  + PH - ((v - minV) / range) * PH;

  const d     = values.map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const fillD = `${d} L ${xOf(n - 1).toFixed(1)} ${PAD.top + PH} L ${xOf(0).toFixed(1)} ${PAD.top + PH} Z`;
  const gid   = `fg-${label.replace(/\W/g, "")}-${color.slice(1)}`;

  return (
    <div className="sk-fin-chart">
      <div className="sk-fin-chart-label">{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, overflow: "visible" }}
        onMouseLeave={() => setHovered(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={color} stopOpacity="0.2" />
            <stop offset="100%" stopColor={color} stopOpacity="0"   />
          </linearGradient>
        </defs>

        {/* horizontal grid lines */}
        {[0, 0.5, 1].map((f, i) => (
          <line key={i} x1={PAD.left} y1={PAD.top + PH * (1 - f)} x2={W - PAD.right} y2={PAD.top + PH * (1 - f)}
            stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}

        <path d={fillD} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

        {values.map((v, i) => {
          const cx = xOf(i), cy = yOf(v);
          const isHov = hovered === i;
          const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
          return (
            <g key={i} onMouseEnter={() => setHovered(i)} style={{ cursor: "default" }}>
              {/* invisible wider hit area */}
              <circle cx={cx} cy={cy} r={12} fill="transparent" />
              <circle cx={cx} cy={cy} r={isHov ? 5.5 : 3.5}
                fill={color} stroke="#080c14" strokeWidth="2"
                style={{ transition: "r 0.15s" }} />
              {/* X-axis quarter label */}
              <text x={cx} y={H - 4} textAnchor={anchor}
                style={{ fill: "rgba(255,255,255,0.3)", fontSize: 9, fontFamily: "monospace" }}>
                {labels[i]}
              </text>
              {/* Hover value label */}
              {isHov && (
                <text x={cx} y={cy - 12} textAnchor={anchor}
                  style={{ fill: color, fontSize: 10, fontFamily: "monospace", fontWeight: 700 }}>
                  {fmtB(v)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── FinancialModal ────────────────────────────────────────────

function FinancialModal({ symbol, stockInfo, onClose }) {
  const [fins,    setFins]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    fetchFinancials(symbol)
      .then((d) => { setFins(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [symbol]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { name, price, change, changePct, up } = stockInfo ?? {};
  const priceColor = up ? "#4DFFB4" : "#FF6B6B";

  const METRICS = fins ? [
    { label: "PROFIT MARGIN",    value: fins.profitMargin    },
    { label: "GROSS MARGIN",     value: fins.grossMargin     },
    { label: "OPERATING MARGIN", value: fins.operatingMargin },
    { label: "RETURN ON EQUITY", value: fins.returnOnEquity  },
    { label: "RETURN ON ASSETS", value: fins.returnOnAssets  },
    { label: "P/E RATIO",        value: fins.peRatio         },
    { label: "EPS (TTM)",        value: fins.eps             },
    { label: "BETA",             value: fins.beta            },
    { label: "REVENUE GROWTH",   value: fins.revenueGrowth   },
    { label: "EARNINGS GROWTH",  value: fins.earningsGrowth  },
  ] : [];

  return (
    <div className="sk-modal-overlay" onClick={onClose}>
      <div className="sk-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="sk-modal-header">
          <div className="sk-modal-title-group">
            <span className="sk-modal-symbol">{symbol}</span>
            <span className="sk-modal-name">{name ?? symbol}</span>
          </div>
          {stockInfo && (
            <div className="sk-modal-price-group">
              <span className="sk-modal-price">{fmtPrice(price)}</span>
              <span className="sk-modal-change" style={{ color: priceColor }}>
                {up ? "▲" : "▼"} {Math.abs(change ?? 0).toFixed(2)} ({up ? "+" : ""}{(changePct ?? 0).toFixed(2)}%)
              </span>
            </div>
          )}
          <button className="sk-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="sk-modal-body">
          {loading && (
            <div className="sk-modal-loading">
              <div className="sk-skeleton" style={{ height: 130, marginBottom: 14, borderRadius: 8 }} />
              <div className="sk-skeleton" style={{ height: 130, marginBottom: 20, borderRadius: 8 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="sk-skeleton" style={{ height: 52, borderRadius: 8 }} />)}
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="sk-modal-error">
              <div className="sk-modal-error-icon">⊗</div>
              <div>Could not load financials</div>
              <div className="sk-modal-error-sub">{error}</div>
            </div>
          )}

          {fins && !loading && (
            <>
              <div className="sk-fin-section-label">QUARTERLY FINANCIALS — LAST 4 QUARTERS</div>

              {/* Dual line charts */}
              <div className="sk-fin-charts">
                <FinancialLineChart quarters={fins.quarters} dataKey="revenue"   label="REVENUE"    color="#00C8E0" />
                <FinancialLineChart quarters={fins.quarters} dataKey="netIncome" label="NET INCOME" color="#4DFFB4" />
              </div>

              {/* Quarter table */}
              <div className="sk-fin-table">
                <div className="sk-fin-table-head">
                  <span>PERIOD</span>
                  <span>REVENUE</span>
                  <span>GROSS PROFIT</span>
                  <span>NET INCOME</span>
                  <span>COST OF REV.</span>
                </div>
                {fins.quarters.map((q, i) => (
                  <div key={i} className="sk-fin-table-row">
                    <span className="sk-fin-quarter">{fmtQuarter(q.date)}</span>
                    <span style={{ color: "#00C8E0" }}>{q.revenueStr}</span>
                    <span style={{ color: "#B94FFF" }}>{q.grossStr}</span>
                    <span style={{ color: q.netIncome >= 0 ? "#4DFFB4" : "#FF6B6B" }}>{q.netIncomeStr}</span>
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{fmtB(q.costOfRevenue)}</span>
                  </div>
                ))}
              </div>

              {/* Key metrics */}
              <div className="sk-fin-section-label" style={{ marginTop: 22 }}>KEY METRICS</div>
              <div className="sk-fin-metrics">
                {METRICS.map((m) => (
                  <div key={m.label} className="sk-fin-metric">
                    <div className="sk-fin-metric-label">{m.label}</div>
                    <div className="sk-fin-metric-value">{m.value}</div>
                  </div>
                ))}
              </div>
            </>
          )}
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

function StockWidget({ id, symbol, data, loading, error, onRetry, onRemove, onSelect, idx, dragSrc, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }) {
  const isDragging = dragSrc === idx;
  const isOver     = dragOver === idx && dragSrc !== idx;

  const cardClass = ["sk-widget", isDragging ? "sk-widget-dragging" : "", isOver ? "sk-widget-over" : ""].filter(Boolean).join(" ");

  const dragHandlers = {
    onDragOver:  (e) => { e.preventDefault(); onDragOver(idx); },
    onDragLeave: onDragLeave,
    onDrop:      (e) => { e.preventDefault(); onDrop(idx); },
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className={cardClass} {...dragHandlers}>
        <div className="sk-widget-header" draggable onDragStart={() => onDragStart(idx)} onDragEnd={onDragEnd}>
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

  // ── No data ──
  if (!data) return null;

  const { name, price, change, changePct, up, points, isMock, marketState } = data;
  const color      = up ? "#4DFFB4" : "#FF6B6B";
  const isMarketOpen = marketState === "REGULAR";

  return (
    <div className={cardClass} {...dragHandlers}>
      <div className="sk-widget-header" draggable onDragStart={() => onDragStart(idx)} onDragEnd={onDragEnd}>
        <span className="sk-drag-handle">⠿</span>
        <span className="sk-widget-symbol">{symbol}</span>
        <span className="sk-widget-name">{name}</span>
        {isMock && <span className="sk-mock-badge" title="Yahoo Finance unavailable — showing demo data">demo</span>}
        {error && !isMock && <span className="sk-mock-badge sk-error-badge" title={error}>err</span>}
        <button className="sk-widget-remove" onClick={() => onRemove(id)}>✕</button>
      </div>

      <div className="sk-widget-body sk-widget-clickable" onClick={() => onSelect(symbol)} title="Click for financials">
        <div className="sk-price-row">
          <span className="sk-price">{fmtPrice(price)}</span>
          <span className="sk-change" style={{ color }}>
            {up ? "▲" : "▼"} {Math.abs(change).toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
          </span>
        </div>
        {!isMarketOpen && !isMock && (
          <div className="sk-market-closed">
            {marketState === "PRE" ? "Pre-market" : marketState === "POST" ? "After-hours" : "Market closed"}
          </div>
        )}

        <StockMiniChart points={points} up={up} />

        <div className="sk-time-bar">
          <span>9:30</span>
          <span>12:00</span>
          <span>16:00</span>
        </div>

        <div className="sk-financials-hint">↗ Tap for financials</div>

        {isMock && (
          <button className="sk-retry-btn" onClick={(e) => { e.stopPropagation(); onRetry(symbol); }}>
            ↻ Retry live data
          </button>
        )}
      </div>
    </div>
  );
}

// ── Ticker Bar ────────────────────────────────────────────────

function TickerBar({ stockData, indexData }) {
  const indexItems = INDEX_CFG
    .map(({ key, ticker }) => {
      const d = indexData[key];
      if (!d) return null;
      return { sym: ticker, price: fmtPrice(d.price), pct: `${d.up ? "+" : ""}${d.changePct.toFixed(2)}%`, up: d.up };
    })
    .filter(Boolean);

  const stockItems = Object.values(stockData)
    .filter((d) => !d.isMock)
    .map((d) => ({ sym: d.symbol, price: fmtPrice(d.price), pct: `${d.up ? "+" : ""}${d.changePct.toFixed(2)}%`, up: d.up }));

  const items = [...indexItems, ...stockItems];
  if (items.length === 0) {
    return (
      <div className="sk-ticker-outer">
        <div className="sk-ticker-loading">Fetching market data…</div>
      </div>
    );
  }

  const all = [...items, ...items]; // duplicate for seamless loop

  return (
    <div className="sk-ticker-outer">
      <div className="sk-ticker-track" style={{ animationDuration: `${Math.max(20, all.length * 3)}s` }}>
        {all.map((item, i) => (
          <span key={i} className="sk-ticker-item">
            <span className="sk-ticker-sym">{item.sym}</span>
            <span className="sk-ticker-price">{item.price}</span>
            <span className="sk-ticker-chg" style={{ color: item.up ? "#4DFFB4" : "#FF6B6B" }}>
              {item.up ? "▲" : "▼"} {item.pct}
            </span>
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
    if (d) {
      return { label, value: fmtPrice(d.price), change: `${d.up ? "+" : ""}${d.changePct.toFixed(2)}%`, up: d.up };
    }
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
    onAdd(s);
    setInput(""); setErr("");
  };

  return (
    <div className="sk-add-panel">
      <div className="sk-add-row">
        <input ref={inputRef} className="sk-add-input"
          placeholder="Ticker symbol (e.g. AAPL, GOOGL, TSLA)"
          value={input}
          onChange={(e) => { setInput(e.target.value.toUpperCase()); setErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(input); if (e.key === "Escape") onClose(); }}
          maxLength={8}
        />
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

  const [stockData, setStockData] = useState({});  // symbol -> parsed data
  const [loading,   setLoading]   = useState({});  // symbol -> bool
  const [errors,    setErrors]    = useState({});  // symbol -> string
  const [indexData, setIndexData] = useState({});  // "^GSPC" -> parsed data
  const [showAdd,      setShowAdd]      = useState(false);
  const [dragSrc,      setDragSrc]      = useState(null);
  const [dragOver,     setDragOver]     = useState(null);
  const [selectedStock, setSelectedStock] = useState(null);

  useEffect(() => {
    localStorage.setItem("stocks-watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  // ── Fetch market indices once ──
  useEffect(() => {
    INDEX_CFG.forEach(({ key }) => {
      fetchSymbolData(key)
        .then((d) => setIndexData((p) => ({ ...p, [key]: d })))
        .catch(() => {}); // silent — INDEX_FALLBACK is shown
    });
  }, []);

  // ── Fetch any watchlist symbol not yet loaded ──
  useEffect(() => {
    watchlist.forEach(({ symbol }) => {
      if (stockData[symbol] || loading[symbol]) return;
      setLoading((p) => ({ ...p, [symbol]: true }));

      fetchSymbolData(symbol)
        .then((data) => {
          setStockData((p) => ({ ...p, [symbol]: data }));
          setLoading((p)   => ({ ...p, [symbol]: false }));
          setErrors((p)    => ({ ...p, [symbol]: null }));
        })
        .catch((err) => {
          // Fall back to seeded mock data so the widget still shows something
          const mock = getMockData(symbol);
          setStockData((p) => ({ ...p, [symbol]: mock }));
          setLoading((p)   => ({ ...p, [symbol]: false }));
          setErrors((p)    => ({ ...p, [symbol]: err.message }));
        });
    });
  }, [watchlist.map((w) => w.symbol).join(",")]);

  const addStock = (sym) => {
    setWatchlist((prev) => [...prev, { id: `s${Date.now()}`, symbol: sym }]);
    setShowAdd(false);
  };

  const removeStock = (id) => setWatchlist((prev) => prev.filter((w) => w.id !== id));

  const retryStock = (sym) => {
    _cache.delete(sym); // clear stale cache entry
    setLoading((p)   => ({ ...p, [sym]: true }));
    setStockData((p) => { const n = { ...p }; delete n[sym]; return n; });

    fetchSymbolData(sym)
      .then((data) => {
        setStockData((p) => ({ ...p, [sym]: data }));
        setLoading((p)   => ({ ...p, [sym]: false }));
        setErrors((p)    => ({ ...p, [sym]: null }));
      })
      .catch((err) => {
        const mock = getMockData(sym);
        setStockData((p) => ({ ...p, [sym]: mock }));
        setLoading((p)   => ({ ...p, [sym]: false }));
        setErrors((p)    => ({ ...p, [sym]: err.message }));
      });
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

  const existingSymbols = watchlist.map((w) => w.symbol);

  return (
    <div className="sk-page">
      <div className="sk-blob sk-blob-cyan" />
      <div className="sk-blob sk-blob-purple" />

      {/* Header */}
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

      {/* Watchlist header */}
      <div className="sk-watchlist-hd">
        <span className="sk-section-label">WATCHLIST</span>
        <span className="sk-watchlist-count">{watchlist.length} stocks</span>
        <button className="sk-add-btn" onClick={() => setShowAdd((p) => !p)}>
          {showAdd ? "✕ Close" : "+ Add Stock"}
        </button>
      </div>

      {showAdd && <AddStockPanel onAdd={addStock} onClose={() => setShowAdd(false)} existing={existingSymbols} />}

      {/* Grid */}
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
            key={item.id}
            id={item.id}
            symbol={item.symbol}
            data={stockData[item.symbol] ?? null}
            loading={!!loading[item.symbol]}
            error={errors[item.symbol] ?? null}
            onRetry={retryStock}
            onRemove={removeStock}
            onSelect={setSelectedStock}
            idx={i}
            dragSrc={dragSrc}
            dragOver={dragOver}
            onDragStart={setDragSrc}
            onDragEnd={() => { setDragSrc(null); setDragOver(null); }}
            onDragOver={setDragOver}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop}
          />
        ))}
      </div>

      <div className="sk-demo-note">
        ⊙ Data sourced from Yahoo Finance via corsproxy.io · Widgets showing "demo" badge are using generated fallback data · Prices refresh every 5 minutes
      </div>

      {selectedStock && (
        <FinancialModal
          symbol={selectedStock}
          stockInfo={stockData[selectedStock] ?? null}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  );
}
