import { useState, useRef, useCallback } from "react";
import "./LineChart.css";

const SVG_W = 700, SVG_H = 360;
const M = { top: 24, right: 24, bottom: 52, left: 82 };
const PW = SVG_W - M.left - M.right;
const PH = SVG_H - M.top - M.bottom;

const ITEM_PALETTE = [
  "#00C8E0","#FF9955","#AA55FF","#4DFFB4","#FFD93D",
  "#FF6B6B","#57C7FF","#FFBB88","#9933DD","#33CC88",
  "#006688","#CCAA00","#229966","#7700BB","#FF6B35",
];

function fmtY(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildAvailable(history) {
  const segMap = new Map();
  const itemMap = new Map();
  history.forEach(({ segments }) => {
    (segments || []).forEach((seg) => {
      if (!segMap.has(seg.label)) segMap.set(seg.label, seg.color || "#888");
      (seg.breakdown || []).forEach((item) => {
        if (!itemMap.has(item.name)) itemMap.set(item.name, item.category || "");
      });
    });
  });
  const segs = Array.from(segMap.entries()).map(([label, color]) => ({
    key: `seg_${label}`, label, color,
  }));
  const items = Array.from(itemMap.entries()).map(([name, category], i) => ({
    key: `item_${name}`, label: name, category,
    color: ITEM_PALETTE[i % ITEM_PALETTE.length],
  }));
  return { segs, items };
}

function buildSeries(history, selected, available) {
  const result = [];

  if (selected.has("__total__")) {
    result.push({
      key: "__total__", label: "Total Budget", color: "#ffffff", strokeWidth: 2.5,
      points: history.map(({ segments }) =>
        (segments || []).reduce((s, g) => s + (g.totalBudget || 0), 0)
      ),
    });
  }

  available.segs.forEach(({ key, label, color }) => {
    if (!selected.has(key)) return;
    result.push({
      key, label, color, strokeWidth: 1.8,
      points: history.map(({ segments }) => {
        const seg = (segments || []).find((s) => s.label === label);
        return seg?.totalBudget || 0;
      }),
    });
  });

  available.items.forEach(({ key, label, color }) => {
    if (!selected.has(key)) return;
    result.push({
      key, label, color, strokeWidth: 1.5,
      points: history.map(({ segments }) => {
        let total = 0;
        (segments || []).forEach((seg) => {
          const item = (seg.breakdown || []).find((b) => b.name === label);
          if (item) total += item.amount;
        });
        return total;
      }),
    });
  });

  return result;
}

export default function LineChart({ history }) {
  const [selected, setSelected] = useState(() => new Set(["__total__"]));
  const [openSections, setOpenSections] = useState({ segs: true, items: false });
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const available = buildAvailable(history);
  const series = buildSeries(history, selected, available);
  const n = history.length;

  // Y scale
  const allVals = series.flatMap((s) => s.points);
  const yMax = allVals.length > 0 ? Math.max(...allVals) * 1.15 : 1000000;
  const yTicks = Array.from({ length: 6 }, (_, i) => (yMax / 5) * i);

  const xOf = (i) => (n <= 1 ? PW / 2 : (i / (n - 1)) * PW);
  const yOf = (v) => PH - (v / yMax) * PH;

  const buildD = (points) => {
    const visible = points.map((v, i) => ({ v, i })).filter(({ v }) => v > 0);
    if (visible.length === 0) return "";
    return points
      .map((v, i) => {
        const prev = i > 0 ? points[i - 1] : null;
        const cmd = prev === null || prev === 0 ? "M" : "L";
        return `${cmd} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`;
      })
      .join(" ");
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (!svgRef.current || n < 2) return;
      const rect = svgRef.current.getBoundingClientRect();
      const rawX = (e.clientX - rect.left) * (SVG_W / rect.width) - M.left;
      const i = Math.round((rawX / PW) * (n - 1));
      setHoverIdx(Math.max(0, Math.min(n - 1, i)));
    },
    [n]
  );

  const toggleKey = (key) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleSection = (sec) =>
    setOpenSections((p) => ({ ...p, [sec]: !p[sec] }));

  // X axis: show up to 8 evenly-spaced labels
  const xStep = Math.max(1, Math.ceil(n / 8));
  const xLabels = history.map((e, i) => ({
    i,
    ts: e.timestamp,
    year: e.year ?? null,
    show: i % xStep === 0 || i === n - 1,
  }));
  const xLabel = (e) => e.year ? String(e.year) : fmtDate(e.ts);

  const tooltipPct = hoverIdx !== null
    ? Math.min(70, Math.max(2, ((M.left + xOf(hoverIdx)) / SVG_W) * 100 - 8))
    : 0;

  if (n === 0) {
    return (
      <div className="lc-empty">
        <div className="lc-empty-icon">◈</div>
        <div className="lc-empty-title">No history yet</div>
        <div className="lc-empty-sub">
          Push data from the editor to start recording snapshots for trend analysis.
        </div>
      </div>
    );
  }

  return (
    <div className="lc-wrap">
      {/* ── Chart ── */}
      <div className="lc-chart-area">
        {n === 1 && (
          <div className="lc-single-note">
            Snapshot recorded — push again after changes to see trends
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="lc-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <g transform={`translate(${M.left},${M.top})`}>
            {/* Grid + Y axis */}
            {yTicks.map((v, i) => (
              <g key={i}>
                <line x1={0} y1={yOf(v)} x2={PW} y2={yOf(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
                <text x={-10} y={yOf(v)} textAnchor="end" dominantBaseline="middle"
                  style={{ fill: "rgba(255,255,255,0.28)", fontSize: 11, fontFamily: "monospace" }}>
                  {fmtY(v)}
                </text>
              </g>
            ))}

            {/* X axis baseline */}
            <line x1={0} y1={PH} x2={PW} y2={PH} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

            {/* X labels */}
            {xLabels.filter((l) => l.show).map((l) => (
              <text key={l.i} x={xOf(l.i)} y={PH + 18} textAnchor="middle"
                style={{ fill: "rgba(255,255,255,0.25)", fontSize: 10, fontFamily: "monospace" }}>
                {xLabel(l)}
              </text>
            ))}

            {/* Glow pass for total */}
            {series.filter((s) => s.key === "__total__").map((s) => (
              <path key={`glow_${s.key}`} d={buildD(s.points)}
                fill="none" stroke={s.color} strokeWidth={8} strokeOpacity={0.06}
                strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {/* Lines */}
            {series.map((s) => (
              <path key={s.key} d={buildD(s.points)}
                fill="none" stroke={s.color} strokeWidth={s.strokeWidth}
                strokeOpacity={0.88} strokeLinejoin="round" strokeLinecap="round" />
            ))}

            {/* Single-point dots (when n===1 or hovering) */}
            {(n === 1 ? series : (hoverIdx !== null ? series : [])).map((s) => {
              const idx = n === 1 ? 0 : hoverIdx;
              return (
                <circle key={`dot_${s.key}`}
                  cx={xOf(idx)} cy={yOf(s.points[idx])} r={n === 1 ? 5 : 4}
                  fill={s.color} stroke="#080c14" strokeWidth={2} />
              );
            })}

            {/* Hover crosshair */}
            {hoverIdx !== null && n > 1 && (
              <line x1={xOf(hoverIdx)} y1={0} x2={xOf(hoverIdx)} y2={PH}
                stroke="rgba(255,255,255,0.14)" strokeWidth={1} strokeDasharray="4,3" />
            )}
          </g>
        </svg>

        {/* Tooltip */}
        {hoverIdx !== null && series.length > 0 && n > 1 && (
          <div className="lc-tooltip" style={{ left: `${tooltipPct}%` }}>
            <div className="lc-tt-date">
              {history[hoverIdx].year ? `FY ${history[hoverIdx].year}` : fmtDate(history[hoverIdx].timestamp)}
            </div>
            {series.map((s) => (
              <div key={s.key} className="lc-tt-row">
                <span className="lc-tt-dot" style={{ background: s.color }} />
                <span className="lc-tt-label">{s.label}</span>
                <span className="lc-tt-val" style={{ color: s.color }}>{fmtY(s.points[hoverIdx])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Series selector ── */}
      <div className="lc-legend">
        <div className="lc-leg-title">SERIES</div>

        {/* Total */}
        <div className="lc-leg-item" onClick={() => toggleKey("__total__")}>
          <div className="lc-leg-check" style={selected.has("__total__") ? { background: "#ffffff18", borderColor: "#fff" } : {}}>
            {selected.has("__total__") && <span style={{ color: "#fff" }}>✓</span>}
          </div>
          <span className="lc-leg-dot" style={{ background: "#fff" }} />
          <span className="lc-leg-label">Total Budget</span>
        </div>

        {/* Segments section */}
        <div className="lc-leg-section" onClick={() => toggleSection("segs")}>
          <span className="lc-leg-chev">{openSections.segs ? "▾" : "▸"}</span>
          SEGMENTS
        </div>
        {openSections.segs && available.segs.map((s) => (
          <div key={s.key} className="lc-leg-item" onClick={() => toggleKey(s.key)}>
            <div className="lc-leg-check" style={selected.has(s.key) ? { background: `${s.color}18`, borderColor: s.color } : {}}>
              {selected.has(s.key) && <span style={{ color: s.color }}>✓</span>}
            </div>
            <span className="lc-leg-dot" style={{ background: s.color }} />
            <span className="lc-leg-label">{s.label}</span>
          </div>
        ))}

        {/* Line items section */}
        <div className="lc-leg-section" onClick={() => toggleSection("items")}>
          <span className="lc-leg-chev">{openSections.items ? "▾" : "▸"}</span>
          LINE ITEMS
        </div>
        {openSections.items && available.items.map((s) => (
          <div key={s.key} className="lc-leg-item" onClick={() => toggleKey(s.key)}>
            <div className="lc-leg-check" style={selected.has(s.key) ? { background: `${s.color}18`, borderColor: s.color } : {}}>
              {selected.has(s.key) && <span style={{ color: s.color }}>✓</span>}
            </div>
            <span className="lc-leg-dot" style={{ background: s.color }} />
            <span className="lc-leg-label">{s.label}</span>
            <span className="lc-leg-cat">{s.category}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
