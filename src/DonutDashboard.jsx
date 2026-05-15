import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import LineChart from "./LineChart";
import "./DonutDashboard.css";

// ── Constants ────────────────────────────────────────────────

const CATEGORY_COLORS = {
  Cloud: "#00C8E0", Network: "#0099BB", Datacenter: "#006688", Security: "#FF6B35", Ops: "#FF9966",
  Headcount: "#FF6B35", Tooling: "#FF9955", Growth: "#FFBB88",
  Paid: "#B94FFF", Creative: "#9933DD", Brand: "#7700BB", Analytics: "#AA55FF",
  Legal: "#FFD93D", Compliance: "#CCAA00", Facilities: "#887700", Admin: "#665500",
  Research: "#4DFFB4", Compute: "#33CC88", Prototyping: "#229966", Lab: "#116644", Community: "#008844",
};

const CX = 160, CY = 160;

const WIDGET_CATALOG = [
  { type: "donut", label: "Donut Chart",   icon: "◉", desc: "Segment breakdown" },
  { type: "bar",   label: "Bar Chart",     icon: "▦", desc: "Horizontal bars" },
  { type: "stats", label: "Key Stats",     icon: "⊟", desc: "Summary numbers" },
  { type: "line",  label: "Line Trends",   icon: "╱", desc: "History over time" },
];

const DEFAULT_WIDGETS = [
  { id: "w1", type: "donut" },
  { id: "w2", type: "stats" },
];

// full-width widget types
const FULL_WIDTH = new Set(["donut", "line"]);

// ── Helpers ──────────────────────────────────────────────────

function buildArcs(items, innerR = 74, outerR = 130, gap = 0.025) {
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total === 0) return [];
  let start = -Math.PI / 2;
  return items.map((item) => {
    const fraction = item.value / total;
    const angle = fraction * 2 * Math.PI - gap;
    const end = start + angle;
    const x1 = CX + outerR * Math.cos(start), y1 = CY + outerR * Math.sin(start);
    const x2 = CX + outerR * Math.cos(end),   y2 = CY + outerR * Math.sin(end);
    const x3 = CX + innerR * Math.cos(end),   y3 = CY + innerR * Math.sin(end);
    const x4 = CX + innerR * Math.cos(start), y4 = CY + innerR * Math.sin(start);
    const largeArc = angle > Math.PI ? 1 : 0;
    const path = [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
      "Z",
    ].join(" ");
    start += fraction * 2 * Math.PI;
    return { ...item, path };
  });
}

function fmt(n) {
  return "$" + n.toLocaleString();
}

function groupByCategory(breakdown) {
  return breakdown.reduce((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});
}

function normalizeSegments(val) {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : Object.values(val);
  return arr.filter(Boolean).map((seg) => ({
    ...seg,
    breakdown: Array.isArray(seg.breakdown)
      ? seg.breakdown
      : Object.values(seg.breakdown || {}),
  }));
}

// ── Sub-components ───────────────────────────────────────────

function MiniBar({ pct, color, delay = 0 }) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(pct), delay + 60);
    return () => clearTimeout(t);
  }, [pct, delay]);
  return (
    <div className="dd-minibar-track">
      <div className="dd-minibar-fill" style={{ width: `${w}%`, background: color, boxShadow: `0 0 5px ${color}66` }} />
    </div>
  );
}

function AnimatedNumber({ value }) {
  const [disp, setDisp] = useState(0);
  useEffect(() => {
    let start = null;
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / 600, 1);
      setDisp(Math.floor(p * value));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span>{disp}</span>;
}

// ── DonutWidget ──────────────────────────────────────────────

function DonutWidget({ data }) {
  const [active, setActive]     = useState(null);
  const [hovered, setHovered]   = useState(null);
  const [openCats, setOpenCats] = useState({});

  const arcs = useMemo(() => buildArcs(data), [data]);
  const grandTotal = data.reduce((s, d) => s + (d.totalBudget || 0), 0);
  const grandTotalDisplay = grandTotal >= 1e6
    ? `$${(grandTotal / 1e6).toFixed(1)}M`
    : fmt(grandTotal);

  const pick = (item) => {
    if (active?.id === item.id) { setActive(null); setOpenCats({}); }
    else { setActive(item); setOpenCats({}); }
  };
  const toggleCat = (cat) => setOpenCats((p) => ({ ...p, [cat]: !p[cat] }));

  const grouped   = active ? groupByCategory(active.breakdown) : {};
  const catTotals = Object.fromEntries(
    Object.entries(grouped).map(([c, items]) => [c, items.reduce((s, i) => s + i.amount, 0)])
  );
  const maxCat = Math.max(...Object.values(catTotals), 1);

  if (data.length === 0) {
    return (
      <div className="db-donut-wrap">
        <div className="dd-empty" style={{ opacity: 1, flex: "1 1 100%", padding: 40 }}>
          <div style={{ fontSize: 36, opacity: 0.15, marginBottom: 8 }}>◈</div>
          <div className="dd-et">No data yet</div>
          <div className="dd-es">
            Head to the <Link to="/editor" style={{ color: "#00E5FF" }}>Data Editor</Link> to add segments.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="db-donut-wrap">
      {/* Left: donut + legend */}
      <div className="db-donut-left">
        <svg viewBox="0 0 320 320" className="dd-chart-svg" style={{ overflow: "visible", display: "block" }}>
          <defs>
            {arcs.map((a) => (
              <filter key={a.id} id={`glow-${a.id}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            ))}
          </defs>

          {arcs.map((arc) => {
            const isActive  = active?.id === arc.id;
            const isHovered = hovered === arc.id;
            return (
              <g key={arc.id}
                onClick={() => pick(arc)}
                onMouseEnter={() => setHovered(arc.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer", opacity: active && !isActive ? 0.28 : 1, transition: "opacity 0.3s" }}
              >
                <path
                  d={arc.path}
                  fill={arc.color}
                  filter={isActive || isHovered ? `url(#glow-${arc.id})` : undefined}
                  style={{
                    transformOrigin: `${CX}px ${CY}px`,
                    transform: `scale(${isActive ? 1.07 : isHovered ? 1.03 : 1})`,
                    transition: "transform 0.25s cubic-bezier(0.34,1.56,0.64,1)",
                  }}
                />
              </g>
            );
          })}

          {active ? (
            <>
              <text x={CX} y={CY - 16} textAnchor="middle" style={{ fill: active.color, fontSize: 26, fontFamily: "monospace", fontWeight: 700 }}>
                {active.value}%
              </text>
              <text x={CX} y={CY + 8} textAnchor="middle" style={{ fill: "#fff", fontSize: 10, fontFamily: "monospace", opacity: 0.55, letterSpacing: 2 }}>
                {active.label.toUpperCase()}
              </text>
              <text x={CX} y={CY + 26} textAnchor="middle" style={{ fill: active.color, fontSize: 11, fontFamily: "monospace", opacity: 0.75 }}>
                {fmt(active.totalBudget)}
              </text>
            </>
          ) : (
            <>
              <text x={CX} y={CY - 10} textAnchor="middle" style={{ fill: "rgba(255,255,255,0.35)", fontSize: 11, fontFamily: "monospace", letterSpacing: 2 }}>
                TOTAL
              </text>
              <text x={CX} y={CY + 16} textAnchor="middle" style={{ fill: "#fff", fontSize: 20, fontFamily: "monospace", fontWeight: 700 }}>
                {grandTotalDisplay}
              </text>
            </>
          )}
        </svg>

        <div className="dd-legend">
          {data.map((item) => {
            const isActive = active?.id === item.id;
            return (
              <div key={item.id} className="dd-li"
                onClick={() => pick(item)}
                onMouseEnter={() => setHovered(item.id)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  opacity: active && !isActive ? 0.3 : 1,
                  borderLeft: `3px solid ${item.color}`,
                  background: isActive ? `${item.color}12` : "transparent",
                }}
              >
                <span className="dd-ldot" style={{ background: item.color }} />
                <span className="dd-llabel">{item.label}</span>
                <span className="dd-lpct" style={{ color: item.color }}>{item.value}%</span>
                <span className="dd-lamt">{fmt(item.totalBudget)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: detail panel */}
      <div className={`db-donut-right${active ? "" : " db-donut-right-hidden"}`}>
        {active && (
          <>
            <div className="dd-dhead">
              <span style={{ color: active.color, fontSize: 19, marginRight: 8, flexShrink: 0 }}>{active.icon}</span>
              <div style={{ flex: 1 }}>
                <div className="dd-dtitle" style={{ color: active.color }}>{active.label}</div>
                <div className="dd-dsub">{active.description}</div>
              </div>
              <button className="dd-xbtn" onClick={() => { setActive(null); setOpenCats({}); }}>✕</button>
            </div>

            <div className="dd-stats">
              {[
                { lbl: "BUDGET SHARE", val: <><AnimatedNumber value={active.value} />%</>, col: active.color },
                { lbl: "TOTAL SPEND",  val: fmt(active.totalBudget), col: "#fff" },
                { lbl: "YoY TREND",    val: `${active.trendUp ? "▲" : "▼"} ${active.trend}`, col: active.trendUp ? "#4DFFB4" : "#FF6B6B" },
              ].map((st) => (
                <div key={st.lbl} className="dd-scard">
                  <div className="dd-slbl">{st.lbl}</div>
                  <div className="dd-sval" style={{ color: st.col }}>{st.val}</div>
                </div>
              ))}
            </div>

            <div className="dd-sec-lbl">LINE ITEMS BY CATEGORY</div>

            <div className="dd-cat-list">
              {Object.entries(grouped).map(([cat, items], gi) => {
                const ct   = catTotals[cat];
                const cpct = Math.round((ct / active.totalBudget) * 100);
                const bpct = (ct / maxCat) * 100;
                const cc   = CATEGORY_COLORS[cat] || active.color;
                const open = !!openCats[cat];
                return (
                  <div key={cat} className="dd-cat-box" style={{ borderLeft: `2px solid ${cc}33`, animationDelay: `${gi * 55}ms` }}>
                    <div className="dd-cat-row" onClick={() => toggleCat(cat)}>
                      <div className="dd-cat-row-l">
                        <span className="dd-badge" style={{ background: `${cc}1a`, color: cc, border: `1px solid ${cc}33` }}>{cat}</span>
                        <span className="dd-cat-n">{items.length} items</span>
                      </div>
                      <div className="dd-cat-row-r">
                        <span className="dd-cat-amt" style={{ color: cc }}>{fmt(ct)}</span>
                        <span className="dd-cat-pct">{cpct}%</span>
                        <span className="dd-chev" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>⌾</span>
                      </div>
                    </div>
                    <div style={{ marginTop: 7 }}>
                      <MiniBar pct={bpct} color={cc} delay={gi * 55} />
                    </div>
                    <div style={{ overflow: "hidden", maxHeight: open ? `${items.length * 56}px` : "0px", transition: "max-height 0.38s cubic-bezier(0.22,1,0.36,1)" }}>
                      <div className="dd-line-list">
                        {items.map((item, ii) => {
                          const ipct = ((item.amount / active.totalBudget) * 100).toFixed(1);
                          const ibar = (item.amount / ct) * 100;
                          return (
                            <div key={ii} className="dd-line-row" style={{ borderBottom: ii < items.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                              <div className="dd-line-top">
                                <span className="dd-line-name">{item.name}</span>
                                <span className="dd-line-amt" style={{ color: cc }}>{fmt(item.amount)}</span>
                              </div>
                              <div className="dd-line-meta">
                                <span className="dd-line-pct">{ipct}% of total</span>
                                <div style={{ flex: 1, marginLeft: 10 }}>
                                  <MiniBar pct={open ? ibar : 0} color={`${cc}88`} delay={ii * 35 + 80} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="dd-footer">
              <span className="dd-ft-lbl">TOTAL ALLOCATED</span>
              <span className="dd-ft-val" style={{ color: active.color }}>{fmt(active.totalBudget)}</span>
            </div>
          </>
        )}
      </div>

      {!active && (
        <div className="db-donut-hint">
          <div style={{ fontSize: 32, opacity: 0.12, marginBottom: 6 }}>◈</div>
          <div className="dd-et">Select a segment</div>
          <div className="dd-es">Click any slice to explore breakdowns</div>
        </div>
      )}
    </div>
  );
}

// ── BarWidget ────────────────────────────────────────────────

function BarWidget({ data }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 80);
    return () => clearTimeout(t);
  }, [data]);

  const maxVal = Math.max(...data.map((d) => d.totalBudget || 0), 1);

  if (data.length === 0) {
    return <div className="db-bar-empty">No data — add segments in the editor.</div>;
  }

  return (
    <div className="db-bar-widget">
      {data.map((item, i) => (
        <div key={item.id || i} className="db-bar-row">
          <div className="db-bar-label-col">
            <span className="db-bar-dot" style={{ background: item.color }} />
            <span className="db-bar-name">{item.label}</span>
          </div>
          <div className="db-bar-track-wrap">
            <div className="db-bar-track">
              <div
                className="db-bar-fill"
                style={{
                  width: animated ? `${((item.totalBudget || 0) / maxVal) * 100}%` : "0%",
                  background: item.color,
                  boxShadow: `0 0 8px ${item.color}44`,
                  transitionDelay: `${i * 40}ms`,
                }}
              />
            </div>
          </div>
          <span className="db-bar-pct" style={{ color: item.color }}>{item.value}%</span>
          <span className="db-bar-amt">{fmt(item.totalBudget || 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ── StatsWidget ──────────────────────────────────────────────

function StatsWidget({ data }) {
  const total  = data.reduce((s, d) => s + (d.totalBudget || 0), 0);
  const sorted = [...data].sort((a, b) => (b.totalBudget || 0) - (a.totalBudget || 0));
  const largest  = sorted[0]  ?? null;
  const smallest = sorted[sorted.length - 1] ?? null;

  const totalDisplay = total >= 1e6 ? `$${(total / 1e6).toFixed(2)}M` : fmt(total);
  const avgDisplay   = data.length > 0 ? fmt(Math.round(total / data.length)) : "—";

  const cards = [
    { label: "TOTAL BUDGET",     value: totalDisplay,              color: "#00e5ff", sub: null },
    { label: "SEGMENTS",         value: data.length || "—",        color: "#fff",    sub: null },
    { label: "LARGEST SEGMENT",  value: largest ? largest.label : "—", color: largest?.color ?? "#fff", sub: largest ? fmt(largest.totalBudget) : null },
    { label: "SMALLEST SEGMENT", value: smallest && smallest !== largest ? smallest.label : "—", color: smallest?.color ?? "#fff", sub: smallest && smallest !== largest ? fmt(smallest.totalBudget) : null },
    { label: "AVG PER SEGMENT",  value: avgDisplay,                color: "#AA55FF", sub: null },
    { label: "COVERAGE",         value: data.length > 0 ? "100%" : "—", color: "#4DFFB4", sub: "of budget allocated" },
  ];

  return (
    <div className="db-stats-widget">
      {cards.map((c) => (
        <div key={c.label} className="db-stat-card">
          <div className="db-stat-label">{c.label}</div>
          <div className="db-stat-value" style={{ color: c.color }}>{c.value}</div>
          {c.sub && <div className="db-stat-sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── LineWidget ───────────────────────────────────────────────

function LineWidget({ history, historyLoading }) {
  if (historyLoading) {
    return <div className="dd-loading-text" style={{ padding: 40 }}>LOADING HISTORY...</div>;
  }
  return <LineChart history={history} />;
}

// ── Widget card wrapper ──────────────────────────────────────

function WidgetCard({ widget, idx, dragSrc, dragOver, data, history, historyLoading, dashYear,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, onRemove }) {

  const info    = WIDGET_CATALOG.find((c) => c.type === widget.type);
  const isFull  = FULL_WIDTH.has(widget.type);
  const isDragging = dragSrc === idx;
  const isOver     = dragOver === idx && dragSrc !== idx;

  const renderContent = () => {
    switch (widget.type) {
      case "donut": return <DonutWidget data={data} />;
      case "bar":   return <BarWidget   data={data} />;
      case "stats": return <StatsWidget data={data} />;
      case "line":  return <LineWidget  history={history} historyLoading={historyLoading} />;
      default:      return null;
    }
  };

  return (
    <div
      className={[
        "db-widget-card",
        isFull ? "db-widget-full" : "db-widget-half",
        isDragging ? "db-widget-dragging" : "",
        isOver    ? "db-widget-over"     : "",
      ].filter(Boolean).join(" ")}
      onDragOver={(e) => { e.preventDefault(); onDragOver(idx); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(idx); }}
    >
      <div
        className="db-widget-header"
        draggable
        onDragStart={() => onDragStart(idx)}
        onDragEnd={onDragEnd}
      >
        <span className="db-widget-drag-handle">⠿</span>
        <span className="db-widget-icon">{info?.icon}</span>
        <span className="db-widget-title">{info?.label ?? widget.type}</span>
        {dashYear !== "live" && (widget.type === "donut" || widget.type === "bar" || widget.type === "stats") && (
          <span className="db-widget-badge-year">FY {dashYear}</span>
        )}
        <button className="db-widget-remove" onClick={() => onRemove(idx)} title="Remove widget">✕</button>
      </div>
      <div className="db-widget-content">
        {renderContent()}
      </div>
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────

export default function DonutDashboard() {
  const [data, setData]                   = useState([]);
  const [loading, setLoading]             = useState(true);
  const [history, setHistory]             = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dashYear, setDashYear]           = useState("live");
  const [dashYears, setDashYears]         = useState([]);

  const [widgets, setWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem("dashboard-widgets");
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_WIDGETS;
  });

  const [dragSrc, setDragSrc]         = useState(null);
  const [trayDragType, setTrayDragType] = useState(null);
  const [dragOver, setDragOver]       = useState(null);

  const hasLineWidget = widgets.some((w) => w.type === "line");

  // Persist widget layout
  useEffect(() => {
    localStorage.setItem("dashboard-widgets", JSON.stringify(widgets));
  }, [widgets]);

  // Load available years
  useEffect(() => {
    const unsub = onValue(ref(db, "history"), (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const years = Object.keys(val)
          .map(Number)
          .filter((y) => y > 2000 && y < 2100)
          .sort((a, b) => a - b);
        setDashYears(years);
      }
    }, { onlyOnce: true });
    return () => unsub();
  }, []);

  // Load budget data
  useEffect(() => {
    setLoading(true);
    if (dashYear === "live") {
      const unsub = onValue(ref(db, "budget"), (snapshot) => {
        setData(normalizeSegments(snapshot.val()));
        setLoading(false);
      });
      return () => unsub();
    } else {
      const unsub = onValue(ref(db, `history/${dashYear}`), (snapshot) => {
        const val = snapshot.val();
        setData(normalizeSegments(val?.segments ?? null));
        setLoading(false);
      }, { onlyOnce: true });
      return () => unsub();
    }
  }, [dashYear]);

  // Load history when a line widget is present
  useEffect(() => {
    if (!hasLineWidget) return;
    setHistoryLoading(true);
    const unsub = onValue(ref(db, "history"), (snapshot) => {
      const val = snapshot.val();
      const entries = val
        ? Object.values(val)
            .filter(Boolean)
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((e) => ({ ...e, segments: normalizeSegments(e.segments) }))
        : [];
      setHistory(entries);
      setHistoryLoading(false);
    });
    return () => unsub();
  }, [hasLineWidget]);

  // ── Widget management ──────────────────────────────────────

  const addWidget = (type) => {
    setWidgets((prev) => [...prev, { id: `w${Date.now()}`, type }]);
  };

  const removeWidget = (idx) => {
    setWidgets((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = (toIdx) => {
    if (trayDragType !== null) {
      const newWidget = { id: `w${Date.now()}`, type: trayDragType };
      setWidgets((prev) => {
        const next = [...prev];
        next.splice(toIdx, 0, newWidget);
        return next;
      });
      setTrayDragType(null);
    } else if (dragSrc !== null && dragSrc !== toIdx) {
      setWidgets((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragSrc, 1);
        const insertAt = dragSrc < toIdx ? toIdx - 1 : toIdx;
        next.splice(insertAt, 0, moved);
        return next;
      });
      setDragSrc(null);
    }
    setDragOver(null);
  };

  const handleDropEnd = (e) => {
    e.preventDefault();
    if (trayDragType !== null) {
      setWidgets((prev) => [...prev, { id: `w${Date.now()}`, type: trayDragType }]);
      setTrayDragType(null);
    } else if (dragSrc !== null) {
      setWidgets((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragSrc, 1);
        next.push(moved);
        return next;
      });
      setDragSrc(null);
    }
    setDragOver(null);
  };

  const grandTotal  = data.reduce((s, d) => s + (d.totalBudget || 0), 0);
  const grandTotalDisplay = grandTotal >= 1e6
    ? `$${(grandTotal / 1e6).toFixed(1)}M`
    : (grandTotal > 0 ? fmt(grandTotal) : "—");

  if (loading) {
    return (
      <div className="dd-page dd-loading">
        <div className="dd-loading-text">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="dd-page">
      <div className="dd-blob dd-blob-cyan" />
      <div className="dd-blob dd-blob-purple" />

      {/* ── Header ── */}
      <header className="dd-header">
        <div>
          <div className="dd-logo">◈ NEXUS</div>
          <div className="dd-hsub">Knowledge Platform</div>
        </div>
        <div className="dd-hright">
          <span
            className="dd-pill"
            style={dashYear !== "live" ? { background: "#FFD93D18", color: "#FFD93D", border: "1px solid #FFD93D40" } : {}}
          >
            {dashYear === "live" ? "LIVE" : `FY ${dashYear}`}
          </span>
          <span className="dd-hdate">{grandTotalDisplay}</span>
          <Link to="/stocks" className="dd-editor-link" style={{ borderColor: "rgba(185,79,255,0.35)", color: "#B94FFF", background: "rgba(185,79,255,0.08)" }}>▦ Stocks</Link>
          <Link to="/editor" className="dd-editor-link">Edit Data →</Link>
          <button className="dd-signout-btn" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </header>

      {/* ── Year bar ── */}
      {dashYears.length > 0 && (
        <div className="dd-year-bar">
          <button
            className={`dd-year-btn dd-year-btn--live${dashYear === "live" ? " dd-year-btn--active" : ""}`}
            onClick={() => setDashYear("live")}
          >
            ● LIVE
          </button>
          {dashYears.map((y) => (
            <button
              key={y}
              className={`dd-year-btn${dashYear === y ? " dd-year-btn--active" : ""}`}
              onClick={() => setDashYear(y)}
            >
              FY {y}
            </button>
          ))}
        </div>
      )}

      {/* ── Widget Tray ── */}
      <div className="db-tray">
        <span className="db-tray-label">ADD WIDGET</span>
        {WIDGET_CATALOG.map((w) => (
          <div
            key={w.type}
            className="db-tray-item"
            draggable
            onClick={() => addWidget(w.type)}
            onDragStart={() => setTrayDragType(w.type)}
            onDragEnd={() => setTrayDragType(null)}
            title={w.desc}
          >
            <span className="db-tray-icon">{w.icon}</span>
            <span className="db-tray-item-label">{w.label}</span>
            <span className="db-tray-plus">+</span>
          </div>
        ))}
      </div>

      {/* ── Dashboard Grid ── */}
      <div
        className="db-grid"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropEnd}
      >
        {widgets.length === 0 && (
          <div className="db-empty">
            <div style={{ fontSize: 40, opacity: 0.1, marginBottom: 10 }}>◈</div>
            <div className="db-empty-title">Dashboard is empty</div>
            <div className="db-empty-sub">Click or drag widgets from the tray above to build your view.</div>
          </div>
        )}

        {widgets.map((w, i) => (
          <WidgetCard
            key={w.id}
            widget={w}
            idx={i}
            dragSrc={dragSrc}
            dragOver={dragOver}
            data={data}
            history={history}
            historyLoading={historyLoading}
            dashYear={dashYear}
            onDragStart={setDragSrc}
            onDragEnd={() => { setDragSrc(null); setDragOver(null); }}
            onDragOver={setDragOver}
            onDragLeave={() => setDragOver(null)}
            onDrop={handleDrop}
            onRemove={removeWidget}
          />
        ))}

        {/* Drop zone at end when dragging */}
        {(dragSrc !== null || trayDragType !== null) && (
          <div
            className="db-drop-zone"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver("end"); }}
            onDrop={(e) => { e.stopPropagation(); handleDropEnd(e); }}
          />
        )}
      </div>
    </div>
  );
}
