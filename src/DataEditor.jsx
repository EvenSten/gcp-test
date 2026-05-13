import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ref, onValue, set } from "firebase/database";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import "./DataEditor.css";

const PRESET_COLORS = [
  "#00E5FF",
  "#FF6B35",
  "#B94FFF",
  "#FFD93D",
  "#4DFFB4",
  "#FF6B6B",
  "#57C7FF",
  "#FF9F43",
];
const PRESET_ICONS = ["⬡", "⚙", "◈", "◎", "◬", "◆", "▲", "●"];

const DEFAULT_SEGMENTS = [
  {
    id: 1,
    label: "Infrastructure",
    value: 34,
    color: "#00E5FF",
    icon: "⬡",
    description:
      "Cloud servers, networking hardware, and data center operations.",
    trend: "+12%",
    trendUp: true,
    totalBudget: 408000,
    breakdown: [
      { name: "AWS Compute (EC2/EKS)", amount: 128400, category: "Cloud" },
      { name: "S3 Storage & Glacier", amount: 41200, category: "Cloud" },
      { name: "CloudFront CDN", amount: 22800, category: "Network" },
      { name: "Dedicated Fiber Links", amount: 31600, category: "Network" },
      { name: "Co-location Rack Fees", amount: 58200, category: "Datacenter" },
      { name: "Hardware Leases", amount: 18900, category: "Datacenter" },
      { name: "DDoS & WAF Protection", amount: 14700, category: "Security" },
      { name: "SSL/PKI Management", amount: 9400, category: "Security" },
      { name: "Monitoring & Observability", amount: 17300, category: "Ops" },
      { name: "Disaster Recovery", amount: 65500, category: "Ops" },
    ],
  },
  {
    id: 2,
    label: "Engineering",
    value: 28,
    color: "#FF6B35",
    icon: "⚙",
    description:
      "Salaries, tooling, and software licenses for the engineering team.",
    trend: "+5%",
    trendUp: true,
    totalBudget: 336000,
    breakdown: [
      {
        name: "Senior Engineer Salaries",
        amount: 142000,
        category: "Headcount",
      },
      { name: "Junior / Mid Salaries", amount: 68000, category: "Headcount" },
      { name: "Contract Developers", amount: 31200, category: "Headcount" },
      { name: "GitHub Enterprise", amount: 8400, category: "Tooling" },
      { name: "JetBrains / IDEs", amount: 3800, category: "Tooling" },
      { name: "CI/CD Pipeline (CircleCI)", amount: 12300, category: "Tooling" },
      { name: "Datadog APM", amount: 9600, category: "Tooling" },
      { name: "Technical Training", amount: 11200, category: "Growth" },
      { name: "Conference & Travel", amount: 6800, category: "Growth" },
      { name: "Recruiting & Onboarding", amount: 42700, category: "Growth" },
    ],
  },
  {
    id: 3,
    label: "Marketing",
    value: 18,
    color: "#B94FFF",
    icon: "◈",
    description: "Paid campaigns, creative assets, and brand partnerships.",
    trend: "-3%",
    trendUp: false,
    totalBudget: 216000,
    breakdown: [
      { name: "Google Ads", amount: 44000, category: "Paid" },
      { name: "Meta / Instagram Ads", amount: 28000, category: "Paid" },
      { name: "LinkedIn Sponsored", amount: 10000, category: "Paid" },
      { name: "Video Production", amount: 18400, category: "Creative" },
      { name: "Graphic Design Studio", amount: 13200, category: "Creative" },
      { name: "Copywriting Retainer", amount: 7800, category: "Creative" },
      { name: "Influencer Partnerships", amount: 22000, category: "Brand" },
      { name: "Event Sponsorships", amount: 14600, category: "Brand" },
      { name: "PR Agency Retainer", amount: 31000, category: "Brand" },
      { name: "Analytics & Attribution", amount: 27000, category: "Analytics" },
    ],
  },
  {
    id: 4,
    label: "Operations",
    value: 12,
    color: "#FFD93D",
    icon: "◎",
    description: "Legal, compliance, admin, and office expenses.",
    trend: "+1%",
    trendUp: true,
    totalBudget: 144000,
    breakdown: [
      { name: "Legal Counsel Retainer", amount: 18000, category: "Legal" },
      { name: "IP & Patent Filings", amount: 7400, category: "Legal" },
      { name: "SOC 2 / ISO Audits", amount: 12200, category: "Compliance" },
      { name: "GDPR / Privacy Programs", amount: 6800, category: "Compliance" },
      { name: "Office Lease", amount: 28000, category: "Facilities" },
      { name: "Utilities & Internet", amount: 5400, category: "Facilities" },
      {
        name: "Office Supplies & Equipment",
        amount: 4800,
        category: "Facilities",
      },
      { name: "HR & Payroll Platform", amount: 9600, category: "Admin" },
      { name: "Finance & Accounting", amount: 14200, category: "Admin" },
      { name: "Travel & Expenses", amount: 37600, category: "Admin" },
    ],
  },
  {
    id: 5,
    label: "R&D",
    value: 8,
    color: "#4DFFB4",
    icon: "◬",
    description:
      "Experimental projects, research grants, and innovation budget.",
    trend: "+22%",
    trendUp: true,
    totalBudget: 96000,
    breakdown: [
      {
        name: "ML / AI Research Salaries",
        amount: 32000,
        category: "Research",
      },
      { name: "Academic Partnerships", amount: 8000, category: "Research" },
      { name: "GPU Cluster Access", amount: 14400, category: "Compute" },
      { name: "Dataset Licensing", amount: 6200, category: "Compute" },
      { name: "Prototype Hardware", amount: 9800, category: "Prototyping" },
      {
        name: "3D Printing & Fabrication",
        amount: 4400,
        category: "Prototyping",
      },
      { name: "Lab Equipment Leases", amount: 8600, category: "Lab" },
      { name: "Chemical / Materials", amount: 3200, category: "Lab" },
      {
        name: "Open Source Contributions",
        amount: 5400,
        category: "Community",
      },
      { name: "Innovation Hackathons", amount: 4000, category: "Community" },
    ],
  },
];

function emptySegment() {
  return {
    id: Date.now(),
    label: "New Segment",
    value: 10,
    color: PRESET_COLORS[0],
    icon: "◈",
    description: "",
    trend: "+0%",
    trendUp: true,
    totalBudget: 0,
    breakdown: [],
  };
}

function emptyItem() {
  return { name: "", amount: 0, category: "" };
}

const THIS_YEAR = new Date().getFullYear();

function normalizeSegs(val) {
  if (!val) return [];
  const arr = Array.isArray(val) ? val : Object.values(val);
  return arr.filter(Boolean).map((seg) => ({
    ...seg,
    breakdown: Array.isArray(seg.breakdown)
      ? seg.breakdown
      : Object.values(seg.breakdown || {}),
  }));
}

function fmtFull(n) { return "$" + Number(n).toLocaleString(); }
function fmtShort(n) {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
}
function jitter(val, pct = 0.10) {
  return Math.round(val * (1 + (Math.random() * 2 - 1) * pct));
}

export default function DataEditor() {
  const [segments, setSegments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedYear, setSelectedYear] = useState(THIS_YEAR);
  const [availableYears, setAvailableYears] = useState([THIS_YEAR]);
  const [globalTotal, setGlobalTotal] = useState(1_000_000);

  // On mount: discover which years already exist in Firebase history
  useEffect(() => {
    const unsub = onValue(ref(db, "history"), (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const years = Object.keys(val)
          .map(Number)
          .filter((y) => y > 2000 && y < 2100)
          .sort((a, b) => a - b);
        if (years.length > 0) {
          setAvailableYears(years);
          setSelectedYear(years[years.length - 1]);
        }
      }
    }, { onlyOnce: true });
    return () => unsub();
  }, []);

  // When selected year changes, load that year's data
  useEffect(() => {
    const unsub = onValue(ref(db, `history/${selectedYear}`), (snapshot) => {
      const val = snapshot.val();
      const normalized = normalizeSegs(val?.segments ?? null);
      setSegments(normalized);
      setSelectedId(normalized[0]?.id ?? null);
      const total = normalized.reduce((s, seg) => s + (seg.totalBudget || 0), 0);
      if (total > 0) setGlobalTotal(total);
    }, { onlyOnce: true });
    return () => unsub();
  }, [selectedYear]);

  const handleGlobalTotalChange = (newTotal) => {
    setGlobalTotal(newTotal);
    if (newTotal > 0) {
      setSegments((segs) =>
        segs.map((seg) => ({
          ...seg,
          totalBudget: Math.round((seg.value / 100) * newTotal),
        }))
      );
    }
  };

  const [addingYear, setAddingYear] = useState(false);
  const [yearInput, setYearInput] = useState("");

  const confirmAddYear = () => {
    const y = parseInt(yearInput, 10);
    if (!isNaN(y) && y >= 1900 && y <= THIS_YEAR + 10) {
      if (!availableYears.includes(y)) {
        setAvailableYears((prev) => [...prev, y].sort((a, b) => a - b));
      }
      setSelectedYear(y);
      // segments will load via the useEffect when selectedYear changes
    }
    setAddingYear(false);
    setYearInput("");
  };

  const handleYearKey = (e) => {
    if (e.key === "Enter") confirmAddYear();
    if (e.key === "Escape") { setAddingYear(false); setYearInput(""); }
  };

  const selected = segments.find((s) => s.id === selectedId) ?? null;

  // ── Segment mutations ──────────────────────────────────
  const updateSeg = (patch) =>
    setSegments((segs) =>
      segs.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)),
    );

  const addSegment = () => {
    const seg = emptySegment();
    setSegments((segs) => [...segs, seg]);
    setSelectedId(seg.id);
  };

  const removeSegment = (id) => {
    setSegments((segs) => segs.filter((s) => s.id !== id));
    setSelectedId((prev) =>
      prev === id ? (segments.find((s) => s.id !== id)?.id ?? null) : prev,
    );
  };

  // ── Breakdown mutations ────────────────────────────────
  const addItem = () =>
    setSegments((segs) =>
      segs.map((s) =>
        s.id === selectedId
          ? { ...s, breakdown: [...s.breakdown, emptyItem()] }
          : s,
      ),
    );

  const updateItem = (idx, patch) =>
    setSegments((segs) =>
      segs.map((s) => {
        if (s.id !== selectedId) return s;
        const breakdown = s.breakdown.map((item, i) =>
          i === idx ? { ...item, ...patch } : item,
        );
        return { ...s, breakdown };
      }),
    );

  const removeItem = (idx) =>
    setSegments((segs) =>
      segs.map((s) => {
        if (s.id !== selectedId) return s;
        return { ...s, breakdown: s.breakdown.filter((_, i) => i !== idx) };
      }),
    );

  // ── Firebase actions ───────────────────────────────────
  const pushToFirebase = async () => {
    setSaving(true);
    const timestamp = Date.now();
    await Promise.all([
      set(ref(db, "budget"), segments),
      set(ref(db, `history/${selectedYear}`), { year: selectedYear, timestamp, segments }),
    ]);
    setAvailableYears((prev) =>
      prev.includes(selectedYear) ? prev : [...prev, selectedYear].sort((a, b) => a - b)
    );
    setSaving(false);
    showToast(`FY ${selectedYear} pushed ✓`);
  };

  const seedDefaults = () => {
    const randomized = DEFAULT_SEGMENTS.map((seg) => ({
      ...seg,
      totalBudget: jitter(seg.totalBudget),
      breakdown: seg.breakdown.map((item) => ({ ...item, amount: jitter(item.amount) })),
    }));
    const newTotal = randomized.reduce((s, seg) => s + seg.totalBudget, 0);
    const withPcts = randomized.map((seg) => ({
      ...seg,
      value: parseFloat(((seg.totalBudget / newTotal) * 100).toFixed(1)),
    }));
    setGlobalTotal(newTotal);
    setSegments(withPcts);
    setSelectedId(withPcts[0].id);
    showToast("Random example data loaded — click Push to save");
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  return (
    <div className="de-page">
      <div className="de-blob de-blob-cyan" />
      <div className="de-blob de-blob-purple" />

      <header className="de-header">
        <div>
          <div className="de-logo">◈ NEXUS <span className="de-logo-sep">/</span> DATA EDITOR</div>
          <div className="de-hsub">history/{selectedYear}</div>
        </div>
        <div className="de-year-toggle">
          {availableYears.map((year) => (
            <button
              key={year}
              className={`de-year-btn${year === selectedYear ? " de-year-btn--active" : ""}`}
              onClick={() => setSelectedYear(year)}
            >
              {year}
            </button>
          ))}
          {addingYear ? (
            <input
              className="de-year-input"
              type="number"
              placeholder="YYYY"
              value={yearInput}
              autoFocus
              onChange={(e) => setYearInput(e.target.value)}
              onKeyDown={handleYearKey}
              onBlur={confirmAddYear}
            />
          ) : (
            <button className="de-year-add" onClick={() => setAddingYear(true)} title="Add any year">+</button>
          )}
        </div>
        <div className="de-header-right">
          <Link to="/" className="de-back-link">← Dashboard</Link>
          <button className="de-signout-btn" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </header>

      <div className="de-body">
        {/* ── Left: segment list ── */}
        <aside className="de-sidebar">
          <div className="de-sidebar-title">SEGMENTS</div>
          <div className="de-seg-list">
            {segments.map((seg) => (
              <div
                key={seg.id}
                className={`de-seg-item${seg.id === selectedId ? " de-seg-item--active" : ""}`}
                style={{
                  borderLeft: `3px solid ${seg.color}`,
                  background:
                    seg.id === selectedId ? `${seg.color}10` : "transparent",
                }}
                onClick={() => setSelectedId(seg.id)}
              >
                <span
                  className="de-seg-dot"
                  style={{ background: seg.color }}
                />
                <span className="de-seg-label">{seg.label || "Untitled"}</span>
                <span className="de-seg-pct" style={{ color: seg.color }}>
                  {seg.value}%
                </span>
                <button
                  className="de-seg-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSegment(seg.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button className="de-add-seg-btn" onClick={addSegment}>
            + Add Segment
          </button>
        </aside>

        {/* ── Right: edit form ── */}
        <div className="de-form-area">
          {/* Global budget — always visible */}
          {(() => {
            const allocated = segments.reduce((s, seg) => s + (seg.totalBudget || 0), 0);
            const pctUsed = globalTotal > 0 ? ((allocated / globalTotal) * 100).toFixed(1) : 0;
            const balanced = allocated === globalTotal;
            return (
              <div className="de-global-budget">
                <div className="de-global-left">
                  <label className="de-label">TOTAL ANNUAL BUDGET</label>
                  <input
                    className="de-input de-global-input"
                    type="number"
                    min="0"
                    value={globalTotal}
                    onChange={(e) => handleGlobalTotalChange(Number(e.target.value))}
                  />
                </div>
                <div className="de-global-right">
                  <div className="de-global-fmt">{fmtShort(globalTotal)}</div>
                  <div className="de-global-sub" style={{ color: balanced ? "#4DFFB4" : "rgba(255,255,255,0.3)" }}>
                    {fmtFull(allocated)} allocated ({pctUsed}%)
                  </div>
                </div>
              </div>
            );
          })()}

          {!selected ? (
            <div className="de-placeholder">
              <div style={{ fontSize: 36, opacity: 0.12, marginBottom: 10 }}>
                ◈
              </div>
              <div className="de-placeholder-text">Select or add a segment</div>
            </div>
          ) : (
            <>
              <div className="de-section-title">SEGMENT DETAILS</div>

              <div className="de-grid-2">
                <div className="de-field">
                  <label className="de-label">LABEL</label>
                  <input
                    className="de-input"
                    value={selected.label}
                    onChange={(e) => updateSeg({ label: e.target.value })}
                  />
                </div>
                <div className="de-field">
                  <label className="de-label">ICON</label>
                  <div className="de-icon-row">
                    <input
                      className="de-input de-input-icon"
                      value={selected.icon}
                      onChange={(e) => updateSeg({ icon: e.target.value })}
                    />
                    <div className="de-icon-presets">
                      {PRESET_ICONS.map((ic) => (
                        <button
                          key={ic}
                          className={`de-icon-btn${selected.icon === ic ? " de-icon-btn--active" : ""}`}
                          onClick={() => updateSeg({ icon: ic })}
                        >
                          {ic}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="de-field">
                  <label className="de-label">SHARE (%)</label>
                  <input
                    className="de-input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={selected.value}
                    onChange={(e) => {
                      const pct = parseFloat(e.target.value) || 0;
                      updateSeg({
                        value: pct,
                        totalBudget: Math.round((pct / 100) * globalTotal),
                      });
                    }}
                  />
                </div>
                <div className="de-field">
                  <label className="de-label">SEGMENT BUDGET ($)</label>
                  <input
                    className="de-input"
                    type="number"
                    min="0"
                    value={selected.totalBudget}
                    onChange={(e) => {
                      const budget = parseInt(e.target.value) || 0;
                      updateSeg({
                        totalBudget: budget,
                        value: globalTotal > 0
                          ? parseFloat(((budget / globalTotal) * 100).toFixed(1))
                          : 0,
                      });
                    }}
                  />
                </div>
                <div className="de-field">
                  <label className="de-label">TREND</label>
                  <input
                    className="de-input"
                    value={selected.trend}
                    placeholder="+12%"
                    onChange={(e) => updateSeg({ trend: e.target.value })}
                  />
                </div>
                <div className="de-field">
                  <label className="de-label">DIRECTION</label>
                  <div className="de-toggle-row">
                    <button
                      className={`de-toggle-btn${selected.trendUp ? " de-toggle-btn--active" : ""}`}
                      style={
                        selected.trendUp
                          ? { borderColor: "#4DFFB4", color: "#4DFFB4" }
                          : {}
                      }
                      onClick={() => updateSeg({ trendUp: true })}
                    >
                      ▲ Up
                    </button>
                    <button
                      className={`de-toggle-btn${!selected.trendUp ? " de-toggle-btn--active" : ""}`}
                      style={
                        !selected.trendUp
                          ? { borderColor: "#FF6B6B", color: "#FF6B6B" }
                          : {}
                      }
                      onClick={() => updateSeg({ trendUp: false })}
                    >
                      ▼ Down
                    </button>
                  </div>
                </div>
              </div>

              <div className="de-field de-field-full">
                <label className="de-label">DESCRIPTION</label>
                <textarea
                  className="de-input de-textarea"
                  value={selected.description}
                  onChange={(e) => updateSeg({ description: e.target.value })}
                />
              </div>

              <div className="de-field de-field-full">
                <label className="de-label">COLOR</label>
                <div className="de-color-row">
                  <input
                    type="color"
                    className="de-color-picker"
                    value={selected.color}
                    onChange={(e) => updateSeg({ color: e.target.value })}
                  />
                  <span
                    className="de-color-hex"
                    style={{ color: selected.color }}
                  >
                    {selected.color.toUpperCase()}
                  </span>
                  <div className="de-color-presets">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        className="de-color-swatch"
                        style={{
                          background: c,
                          outline:
                            selected.color === c ? `2px solid ${c}` : "none",
                          outlineOffset: 2,
                        }}
                        onClick={() => updateSeg({ color: c })}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Breakdown items ── */}
              <div className="de-breakdown-header">
                <div className="de-section-title" style={{ marginBottom: 0 }}>
                  BREAKDOWN ITEMS
                </div>
                <button className="de-add-item-btn" onClick={addItem}>
                  + Add Item
                </button>
              </div>

              {selected.breakdown.length === 0 ? (
                <div className="de-breakdown-empty">
                  No items yet — click + Add Item
                </div>
              ) : (
                <div className="de-item-list">
                  <div className="de-item-header">
                    <span style={{ flex: 1 }}>NAME</span>
                    <span style={{ width: 110 }}>AMOUNT ($)</span>
                    <span style={{ width: 52 }}>% SEG</span>
                    <span style={{ width: 120 }}>CATEGORY</span>
                    <span style={{ width: 28 }} />
                  </div>
                  {selected.breakdown.map((item, idx) => (
                    <div key={idx} className="de-item-row">
                      <input
                        className="de-input de-item-input de-item-name"
                        style={{ flex: 1 }}
                        value={item.name}
                        placeholder="Item name"
                        onChange={(e) =>
                          updateItem(idx, { name: e.target.value })
                        }
                      />
                      <input
                        className="de-input de-item-input de-item-amt"
                        style={{ width: 110 }}
                        type="number"
                        min="0"
                        value={item.amount}
                        onChange={(e) =>
                          updateItem(idx, { amount: Number(e.target.value) })
                        }
                      />
                      <span className="de-item-pct-read" style={{ width: 52 }}>
                        {selected.totalBudget > 0
                          ? ((item.amount / selected.totalBudget) * 100).toFixed(1) + "%"
                          : "–"}
                      </span>
                      <input
                        className="de-input de-item-input de-item-cat"
                        style={{ width: 120 }}
                        value={item.category}
                        placeholder="Category"
                        onChange={(e) =>
                          updateItem(idx, { category: e.target.value })
                        }
                      />
                      <button
                        className="de-item-del"
                        onClick={() => removeItem(idx)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Footer actions ── */}
      <footer className="de-footer">
        <button className="de-seed-btn" onClick={seedDefaults}>
          ↺ Load Example Data
        </button>
        <div className="de-footer-right">
          {toast && <span className="de-toast">{toast}</span>}
          <button
            className="de-push-btn"
            onClick={pushToFirebase}
            disabled={saving || segments.length === 0}
          >
            {saving ? "Pushing..." : "↑ Publish Data"}
          </button>
        </div>
      </footer>
    </div>
  );
}
