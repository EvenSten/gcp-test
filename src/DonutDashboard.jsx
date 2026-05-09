import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { db } from "./firebase";
import LineChart from "./LineChart";
import "./DonutDashboard.css";

const CATEGORY_COLORS = {
  Cloud: "#00C8E0", Network: "#0099BB", Datacenter: "#006688", Security: "#FF6B35", Ops: "#FF9966",
  Headcount: "#FF6B35", Tooling: "#FF9955", Growth: "#FFBB88",
  Paid: "#B94FFF", Creative: "#9933DD", Brand: "#7700BB", Analytics: "#AA55FF",
  Legal: "#FFD93D", Compliance: "#CCAA00", Facilities: "#887700", Admin: "#665500",
  Research: "#4DFFB4", Compute: "#33CC88", Prototyping: "#229966", Lab: "#116644", Community: "#008844",
};

const SZ = 320, CX = 160, CY = 160;

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

export default function DonutDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [openCats, setOpenCats] = useState({});
  const [view, setView] = useState("donut");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dashYear, setDashYear] = useState("live");
  const [dashYears, setDashYears] = useState([]);

  // Load available years from history keys once on mount
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

  // Load budget data — persistent listener for LIVE, one-time read for a year
  useEffect(() => {
    setLoading(true);
    setActive(null);
    setOpenCats({});

    if (dashYear === "live") {
      const unsub = onValue(ref(db, "budget"), (snapshot) => {
        const normalized = normalizeSegments(snapshot.val());
        setData(normalized);
        setLoading(false);
      });
      return () => unsub();
    } else {
      const unsub = onValue(ref(db, `history/${dashYear}`), (snapshot) => {
        const val = snapshot.val();
        const normalized = normalizeSegments(val?.segments ?? null);
        setData(normalized);
        setLoading(false);
      }, { onlyOnce: true });
      return () => unsub();
    }
  }, [dashYear]);

  useEffect(() => {
    if (view !== "chart") return;
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
  }, [view]);

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

  const grouped = active ? groupByCategory(active.breakdown) : {};
  const catTotals = Object.fromEntries(
    Object.entries(grouped).map(([c, items]) => [c, items.reduce((s, i) => s + i.amount, 0)])
  );
  const maxCat = Math.max(...Object.values(catTotals), 1);

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

      <header className="dd-header">
        <div>
          <div className="dd-logo">◈ NEXUS</div>
          <div className="dd-hsub">Budget Allocation · FY 2025</div>
        </div>
        <div className="dd-view-toggle">
          <button className={`dd-vtbtn${view === "donut" ? " dd-vtbtn--active" : ""}`} onClick={() => setView("donut")}>
            ◉ Overview
          </button>
          <button className={`dd-vtbtn${view === "chart" ? " dd-vtbtn--active" : ""}`} onClick={() => setView("chart")}>
            ╱ Trends
          </button>
        </div>
        <div className="dd-hright">
          <span
            className="dd-pill"
            style={dashYear !== "live" ? { background: "#FFD93D18", color: "#FFD93D", border: "1px solid #FFD93D40" } : {}}
          >
            {dashYear === "live" ? "LIVE" : `FY ${dashYear}`}
          </span>
          <span className="dd-hdate">
            {dashYear === "live" ? "Current" : "Historical"}
          </span>
          <Link to="/editor" className="dd-editor-link">Edit Data →</Link>
        </div>
      </header>

      {/* Year selector — only shown in Overview mode */}
      {view === "donut" && dashYears.length > 0 && (
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

      <main className="dd-main">
        {/* ── Trends view ── */}
        {view === "chart" && (
          historyLoading
            ? <div className="dd-loading-text" style={{ margin: "auto" }}>LOADING HISTORY...</div>
            : <LineChart history={history} />
        )}

        {/* ── Overview (donut) view ── */}
        {view === "donut" && data.length === 0 && (
          <div className="dd-empty" style={{ opacity: 1, flex: "1 1 100%" }}>
            <div style={{ fontSize: 42, opacity: 0.15, marginBottom: 8 }}>◈</div>
            <div className="dd-et">No data yet</div>
            <div className="dd-es">
              Head to the{" "}
              <Link to="/editor" style={{ color: "#00E5FF" }}>Data Editor</Link>
              {" "}to add budget segments.
            </div>
          </div>
        )}

        {view === "donut" && data.length > 0 && (
          <>
            {/* ── Left: donut + legend ── */}
            <div className="dd-left">
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
                  const isActive = active?.id === arc.id;
                  const isHovered = hovered === arc.id;
                  return (
                    <g
                      key={arc.id}
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
                    <div
                      key={item.id}
                      className="dd-li"
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

            {/* ── Right: detail panel ── */}
            <div className={`dd-right${active ? "" : " dd-right-hidden"}`}>
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
                      const ct = catTotals[cat];
                      const cpct = Math.round((ct / active.totalBudget) * 100);
                      const bpct = (ct / maxCat) * 100;
                      const cc = CATEGORY_COLORS[cat] || active.color;
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
              <div className="dd-empty">
                <div style={{ fontSize: 42, opacity: 0.15, marginBottom: 8 }}>◈</div>
                <div className="dd-et">Select a segment</div>
                <div className="dd-es">Click any slice to explore line-item breakdowns</div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
