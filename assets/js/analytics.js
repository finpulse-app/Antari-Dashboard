"use strict";
// ===================== HISTORY ENGINE (pure functions: numbers in, comparisons out) =====================
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const tt = y * 12 + (m - 1) + n;
  return `${Math.floor(tt / 12)}-${String((tt % 12) + 1).padStart(2, "0")}`;
}
function monthKeyOf(d) {
  return String(d).slice(0, 7);
}
function monthName(key) {
  return new Date(key + "-01T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}
function pctText(p) {
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
}
function deltaText(a) {
  return `${a >= 0 ? "+" : "−"}${fmt(Math.abs(a))}`;
}
// Only FULL months count. rows come from v_source_months.
function completeSeries(rows, source, field) {
  return rows
    .filter(
      (r) => r.source === source && r.status === "complete" && r[field] != null,
    )
    .map((r) => ({ month: monthKeyOf(r.month), value: Number(r[field]) }));
}
// points = full months only. Every comparison needs the SPECIFIC months it compares; if one is absent the comparison is null.
function analyzeSeries(points) {
  const s = [...points].sort((a, b) => a.month.localeCompare(b.month));
  const out = {
    count: s.length,
    latest: null,
    mom: null,
    yoy: null,
    r3: null,
    r6: null,
    ytd: null,
    best: null,
    worst: null,
    streak: null,
    seasonal: null,
  };
  if (!s.length) return out;
  const by = Object.fromEntries(s.map((p) => [p.month, p.value]));
  const last = s[s.length - 1];
  out.latest = last;
  const cmp = (from, to) => ({
    from,
    to,
    abs: to.value - from.value,
    pct: from.value > 0 ? ((to.value - from.value) / from.value) * 100 : null,
  });
  const pk = addMonths(last.month, -1);
  if (pk in by) out.mom = cmp({ month: pk, value: by[pk] }, last);
  const yk = addMonths(last.month, -12);
  if (yk in by) out.yoy = cmp({ month: yk, value: by[yk] }, last);
  const win = (n, endKey) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const k = addMonths(endKey, -i);
      if (!(k in by)) return null;
      sum += by[k];
    }
    return { sum, from: addMonths(endKey, -(n - 1)), to: endKey };
  };
  for (const n of [3, 6]) {
    const cur = win(n, last.month);
    if (!cur) continue;
    const prev = win(n, addMonths(last.month, -n));
    out[n === 3 ? "r3" : "r6"] = {
      n,
      current: cur,
      previous: prev,
      abs: prev ? cur.sum - prev.sum : null,
      pct:
        prev && prev.sum > 0 ? ((cur.sum - prev.sum) / prev.sum) * 100 : null,
    };
  }
  const yr = last.month.slice(0, 4);
  const inYear = s.filter((p) => p.month.startsWith(yr));
  const span = monthIndexOf(last.month) - monthIndexOf(inYear[0].month) + 1;
  out.ytd = {
    value: inYear.reduce((a, p) => a + p.value, 0),
    months: inYear.length,
    since: inYear[0].month,
    fromJanuary: inYear[0].month === yr + "-01",
    gaps: span - inYear.length,
  };
  if (s.length >= 3) {
    out.best = s.reduce((a, p) => (p.value > a.value ? p : a));
    out.worst = s.reduce((a, p) => (p.value < a.value ? p : a));
  }
  let moves = 0,
    dir = null;
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i - 1].month !== addMonths(s[i].month, -1)) break;
    const d = Math.sign(s[i].value - s[i - 1].value);
    if (d === 0) break;
    if (dir === null) dir = d;
    if (d !== dir) break;
    moves++;
  }
  if (moves >= 2)
    out.streak = { direction: dir > 0 ? "up" : "down", months: moves };
  if (s.length >= 24) {
    const byM = Object.create(null);
    for (const p of s)
      (byM[Number(p.month.slice(5))] =
        byM[Number(p.month.slice(5))] || []).push(p.value);
    if (
      Array.from({ length: 12 }, (_, i) => i + 1).every(
        (m) => (byM[m] || []).length >= 2,
      )
    ) {
      const overall = s.reduce((a, p) => a + p.value, 0) / s.length;
      out.seasonal = Array.from({ length: 12 }, (_, i) => {
        const v = byM[i + 1];
        const avg = v.reduce((a, x) => a + x, 0) / v.length;
        return { m: i + 1, avg, index: overall > 0 ? avg / overall : null };
      });
    }
  }
  return out;
}
function monthIndexOf(key) {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
}
// cur / prev = { name: value }. Largest increases and decreases, plus who appeared / vanished.
function rankMovers(cur, prev, n) {
  const names = new Set([...Object.keys(cur), ...Object.keys(prev)]);
  const rows = [...names].map((name) => {
    const from = prev[name] || 0,
      to = cur[name] || 0;
    return { name, from, to, abs: to - from };
  });
  return {
    ups: rows
      .filter((r) => r.abs > 0)
      .sort((a, b) => b.abs - a.abs)
      .slice(0, n),
    downs: rows
      .filter((r) => r.abs < 0)
      .sort((a, b) => a.abs - b.abs)
      .slice(0, n),
    newcomers: rows.filter((r) => r.from === 0 && r.to > 0).map((r) => r.name),
    lapsed: rows.filter((r) => r.from > 0 && r.to === 0).map((r) => r.name),
  };
}
function topShare(values, n) {
  const v = values.filter((x) => x > 0).sort((a, b) => b - a);
  const total = v.reduce((a, x) => a + x, 0);
  return total > 0
    ? (v.slice(0, n).reduce((a, x) => a + x, 0) / total) * 100
    : null;
}
