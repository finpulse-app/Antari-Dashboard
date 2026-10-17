"use strict";

const SUPABASE_URL = "https://hzufqpoauamlhkaoaacx.supabase.co";
const SUPABASE_KEY = "sb_publishable_1Rw5PxX0FCzqFwe4Qi-H-Q_xKystG52";

const isPreview = document.documentElement.dataset.preview === "true";
const sb = isPreview
  ? createPreviewClient()
  : window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let pdfLibrary;
async function getPdfLibrary() {
  if (!pdfLibrary)
    pdfLibrary = import("../../vendor/pdf/pdf.mjs").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(
        "../../vendor/pdf/pdf.worker.mjs",
        document.currentScript?.src ||
          new URL("assets/js/core.js", location.href),
      ).href;
      return lib;
    });
  return pdfLibrary;
}
const fmt = (n) =>
  "$" +
  Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtCompact = (n) => {
  const v = Number(n);
  return v >= 1000 ? "$" + (v / 1000).toFixed(1) + "k" : fmt(v);
};
const fmtDate = (d) =>
  d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No payments yet";
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"],
    v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

let storeData = [];
let openBalances = []; // rows from v_open_balances, refreshed on every load()
let D = null; // everything the v14 screens need, rebuilt on every load()

// ---------------- Small helpers ----------------
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseYmd = (s) => new Date(s + "T00:00:00");
const shortDate = (d) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
function businessDay(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const daysSince = (s) =>
  Math.round(
    (Date.parse(businessDay() + "T00:00:00Z") - Date.parse(s + "T00:00:00Z")) /
      86400000,
  );
const cents = (n) => Math.round(Number(n) * 100);
// A customer is shown under its store's name when linked to one, otherwise under the name Zoho uses.
const displayNameOf = (r) =>
  r.mapped_store && r.mapped_store !== "Other" ? r.mapped_store : r.zoho_name;

// ---------------- Generic modal + toast ----------------
function gmOpen(html, wide) {
  const m = document.getElementById("gm-modal");
  m.className = "modal" + (wide ? " wide" : "");
  m.innerHTML = html;
  document.getElementById("gm-backdrop").classList.add("open");
}
function gmClose() {
  document.getElementById("gm-backdrop").classList.remove("open");
}
document.getElementById("gm-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "gm-backdrop") gmClose();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    gmClose();
    closeModal();
  }
});

let toastTimer = null;
function hideToast() {
  document.getElementById("toast").style.display = "none";
}
function showToast(msg, undoFn) {
  const t = document.getElementById("toast"),
    u = document.getElementById("toast-undo");
  document.getElementById("toast-msg").textContent = msg;
  u.disabled = false;
  if (undoFn) {
    u.style.display = "inline";
    u.onclick = async () => {
      u.disabled = true;
      await undoFn();
    };
  } else {
    u.style.display = "none";
    u.onclick = null;
  }
  t.style.display = "flex";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undoFn ? 12000 : 4000);
}

// ---------------- Line chart (one muted colour; hollow dashed point = period still in progress) ----------------
function buildPulseSvg(points, fmtVal) {
  const lineColor = "#1B3A7A";
  const W = 600,
    H = 150,
    PAD_X = 40,
    PAD_Y = 34;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals),
    max = Math.max(...vals);
  const range = max - min || 1;
  const xStep = points.length > 1 ? (W - PAD_X * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    ...p,
    x: points.length === 1 ? W / 2 : PAD_X + i * xStep,
    y: PAD_Y + (H - PAD_Y * 2) * (1 - (p.value - min) / range),
  }));
  const seg = (a, b) => {
    const mx = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  };
  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;">`;
  for (let i = 1; i < coords.length; i++) {
    svg += `<path d="${seg(coords[i - 1], coords[i])}" fill="none" stroke="${lineColor}" stroke-width="1.75" stroke-linecap="round" opacity="0.85"${coords[i].partial ? ' stroke-dasharray="5 4"' : ""}/>`;
  }
  for (const c of coords) {
    svg += c.partial
      ? `<circle cx="${c.x}" cy="${c.y}" r="3" fill="#fff" stroke="${lineColor}" stroke-width="1.5"/>`
      : `<circle cx="${c.x}" cy="${c.y}" r="2.5" fill="${lineColor}"/>`;
    svg += `<text x="${c.x}" y="${c.y - 10}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#2B2118" font-family="-apple-system,sans-serif">${fmtVal(c.value)}</text>`;
    svg += `<text x="${c.x}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="#7A6F60">${esc(c.label)}</text>`;
  }
  return svg + `</svg>`;
}
