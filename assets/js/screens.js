"use strict";
// ===================== SCREENS built from the engine =====================
const kv = (k, v, muted) =>
  `<div class="kv"><span class="k">${k}</span><span class="v${muted ? " muted" : ""}">${v}</span></div>`;
const srcLink = (source, month, text) =>
  `<a class="src" data-src="${source}" data-month="${month}">${text}</a>`;
const sumOf = (arr, f) => arr.reduce((a, x) => a + Number(f(x) || 0), 0);

function currentMappingOf(zoho) {
  const z = String(zoho).toLowerCase();
  const s = D.stores.find((x) => x.store_name.toLowerCase() === z);
  if (s) return s.store_name;
  const m = D.mappingAll.find((x) => x.zoho_name.toLowerCase() === z);
  return m ? m.mapped_store : "Other";
}
function nameFacts(zoho) {
  const z = String(zoho).toLowerCase();
  const rows = D.mappedRows.filter((r) => r.zoho_name.toLowerCase() === z);
  const pay = D.payments.filter((p) => p.zoho_name.toLowerCase() === z);
  const owed = D.openBalances.filter((o) => o.zoho_name.toLowerCase() === z);
  return {
    sales: sumOf(rows, (r) => r.sales),
    invoices: sumOf(rows, (r) => r.invoice_count),
    payments: sumOf(pay, (p) => p.amount),
    paymentCount: pay.length,
    owed: sumOf(owed, (o) => o.outstanding_balance),
  };
}
function cashMonthComplete(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0) <= D.latestPaymentDate;
}

function prepareHistory(d) {
  const S = d.srcMonths;
  const wSeries = completeSeries(S, "wholesale", "revenue"),
    fSeries = completeSeries(S, "festival", "revenue");
  const fMap = Object.fromEntries(fSeries.map((p) => [p.month, p.value]));
  const combined = wSeries
    .filter((p) => p.month in fMap)
    .map((p) => ({ month: p.month, value: p.value + fMap[p.month] }));
  const monthCust = Object.create(null);
  for (const r of d.custMonths) {
    if (r.status !== "complete") continue;
    const k = monthKeyOf(r.month);
    const m =
      monthCust[k] ||
      (monthCust[k] = {
        listed: Object.create(null),
        other: 0,
        otherCount: 0,
        invoices: 0,
      });
    m.invoices += Number(r.invoices);
    if (r.is_listed)
      m.listed[r.customer] = (m.listed[r.customer] || 0) + Number(r.revenue);
    else {
      m.other += Number(r.revenue);
      m.otherCount++;
    }
  }
  const monthProd = Object.create(null);
  for (const r of d.prodMonths) {
    if (r.status !== "complete") continue;
    (monthProd[monthKeyOf(r.month)] = monthProd[monthKeyOf(r.month)] || {})[
      r.item_name
    ] = { units: Number(r.units), revenue: Number(r.revenue) };
  }
  const cashByMonth = Object.create(null);
  for (const p of d.payments) {
    const k = p.payment_date.slice(0, 7);
    const c = cashByMonth[k] || (cashByMonth[k] = { sum: 0, count: 0 });
    c.sum += Number(p.amount);
    c.count++;
  }
  d.an = {
    wSeries,
    fSeries,
    fMap,
    combined,
    wA: analyzeSeries(wSeries),
    fA: analyzeSeries(fSeries),
    cA: analyzeSeries(combined),
    monthCust,
    monthProd,
    cashByMonth,
    itemSeries: completeSeries(S, "items", "units"),
  };
}

function sourceSummary(rows, source) {
  const r = rows.filter((x) => x.source === source);
  if (!r.length) return "no reports loaded yet";
  const by = (st) => r.filter((x) => x.status === st);
  const c = by("complete").length,
    p = by("partial").length,
    b = by("block"),
    m = by("missing");
  const parts = [`${c} full month${c === 1 ? "" : "s"}`];
  if (p) parts.push(`${p} in progress`);
  if (b.length)
    parts.push(
      `${monthName(monthKeyOf(b[0].month))} to ${monthName(monthKeyOf(b[b.length - 1].month))} sit inside multi-month report${b.length > 1 ? "s" : ""}`,
    );
  if (m.length)
    parts.push(
      `no report for ${m.map((x) => monthName(monthKeyOf(x.month))).join(", ")}`,
    );
  return parts.join(" · ");
}
function blockNote(rows, source) {
  const b = rows.filter((x) => x.source === source && x.status === "block");
  return b.length
    ? `${monthName(monthKeyOf(b[0].month))} to ${monthName(monthKeyOf(b[b.length - 1].month))} sit inside multi-month reports, which can't be split into months.`
    : "";
}
function arMovement() {
  const snaps = [...new Set(D.balances.map((b) => b.as_of_date))].sort();
  if (snaps.length < 2) return null;
  const cur = snaps[snaps.length - 1],
    prev = snaps[snaps.length - 2];
  const byName = (date) => {
    const o = Object.create(null);
    for (const b of D.balances.filter((x) => x.as_of_date === date)) {
      const n = displayNameOf({
        mapped_store: currentMappingOf(b.zoho_name),
        zoho_name: b.zoho_name,
      });
      o[n] = (o[n] || 0) + Number(b.outstanding_balance);
    }
    return o;
  };
  const c = byName(cur),
    p = byName(prev),
    mv = rankMovers(c, p, 5);
  return {
    cur,
    prev,
    totalCur: sumOf(Object.values(c), (x) => x),
    totalPrev: sumOf(Object.values(p), (x) => x),
    ...mv,
  };
}

function channelLines(a, source) {
  const L = [],
    mv = (pt) =>
      source ? srcLink(source, pt.month, fmt(pt.value)) : fmt(pt.value);
  const chg = (c) =>
    `${mv(c.from)} → ${mv(c.to)} · ${deltaText(c.abs)}${c.pct != null ? ` (${pctText(c.pct)})` : ""}`;
  L.push(
    kv("Latest full month", `${monthName(a.latest.month)}: ${mv(a.latest)}`),
  );
  L.push(
    a.mom
      ? kv(
          `${monthName(a.mom.from.month)} → ${monthName(a.mom.to.month)}`,
          chg(a.mom),
        )
      : kv(
          "Vs previous month",
          `no full ${monthName(addMonths(a.latest.month, -1))} report`,
          true,
        ),
  );
  L.push(
    a.yoy
      ? kv(
          `${monthName(a.yoy.from.month)} → ${monthName(a.yoy.to.month)} (year over year)`,
          chg(a.yoy),
        )
      : kv("Vs same month last year", "no report from a year earlier", true),
  );
  for (const r of [a.r3, a.r6])
    if (r) {
      L.push(
        kv(
          `Last ${r.n} months (${monthName(r.current.from)} to ${monthName(r.current.to)})`,
          r.previous
            ? `${fmt(r.current.sum)} vs ${fmt(r.previous.sum)} in the ${r.n} before · ${deltaText(r.abs)}${r.pct != null ? ` (${pctText(r.pct)})` : ""}`
            : `${fmt(r.current.sum)} <span class="pulse-sub">(the ${r.n} months before aren't on file)</span>`,
        ),
      );
    }
  if (a.ytd && a.ytd.months >= 2)
    L.push(
      kv(
        `Year to date (since ${monthName(a.ytd.since)})`,
        `${fmt(a.ytd.value)}${a.ytd.fromJanuary ? "" : ` <span class="pulse-sub">· not from January</span>`}${a.ytd.gaps ? ` <span class="pulse-sub">· ${a.ytd.gaps} month${a.ytd.gaps === 1 ? "" : "s"} missing</span>` : ""}`,
      ),
    );
  if (a.best)
    L.push(
      kv(
        "Best / lowest month",
        `${monthName(a.best.month)} ${fmt(a.best.value)} / ${monthName(a.worst.month)} ${fmt(a.worst.value)}`,
      ),
    );
  if (a.streak)
    L.push(
      kv(
        "Streak",
        `${a.streak.direction === "up" ? "Up" : "Down"} ${a.streak.months} months in a row`,
      ),
    );
  return L.join("");
}

function renderStatusCard(d) {
  const an = d.an,
    el = document.getElementById("ov-status"),
    L = [];
  if (an.wA.latest) {
    const a = an.wA;
    L.push(
      kv(
        "Latest full month",
        `${monthName(a.latest.month)}: wholesale ${srcLink("wholesale", a.latest.month, fmt(a.latest.value))}${a.mom ? ` · ${deltaText(a.mom.abs)}${a.mom.pct != null ? ` (${pctText(a.mom.pct)})` : ""} vs ${monthName(a.mom.from.month)}` : ""}`,
      ),
    );
  } else {
    L.push(
      kv(
        "Latest full month",
        `none yet: month-over-month starts with your first full monthly report. ${blockNote(d.srcMonths, "wholesale")}`,
        true,
      ),
    );
  }
  const un = d.unresolved;
  L.push(
    kv(
      "Data",
      un.length
        ? `<a class="src" data-goto="data">${un.length} Zoho name${un.length === 1 ? "" : "s"} need${un.length === 1 ? "s" : ""} your decision</a>`
        : `No names waiting · ${d.batches.length} import batches on file`,
    ),
  );
  const ends = d.mappedRows
    .map((r) => r.period_end)
    .filter(Boolean)
    .sort();
  const snaps = [...new Set(d.balances.map((b) => b.as_of_date))].sort();
  const pay = d.payments.map((p) => p.payment_date).sort();
  L.push(
    kv(
      "Data through",
      `wholesale ${ends.length ? fmtDate(ends[ends.length - 1]) : "Not available"} · balances ${snaps.length ? fmtDate(snaps[snaps.length - 1]) : "Not available"} · payments ${pay.length ? fmtDate(pay[pay.length - 1]) : "Not available"}`,
      true,
    ),
  );
  el.innerHTML = `<p class="pulse-label">Status</p>${L.join("")}`;
}

function renderTrends(d) {
  const an = d.an,
    S = d.srcMonths,
    cards = [],
    notYet = [];
  const card = (title, inner, sub) =>
    `<div class="pulse-card sec"><p class="pulse-label">${title}</p>${inner}${sub ? `<p class="pulse-sub" style="margin-top:8px;">${sub}</p>` : ""}</div>`;

  // coverage strip
  const cashKeys = d.monthlyPay.map((m) => monthKeyOf(m.month)).sort();
  const cashFull = cashKeys.filter(cashMonthComplete),
    cashOpen = cashKeys.filter((k) => !cashMonthComplete(k));
  const snaps = [...new Set(d.balances.map((b) => b.as_of_date))].sort();
  document.getElementById("history-status").innerHTML =
    `<p class="pulse-label">What history is loaded</p>` +
    kv("Wholesale sales", sourceSummary(S, "wholesale")) +
    kv("Direct / festival", sourceSummary(S, "festival")) +
    kv("Products", sourceSummary(S, "items")) +
    kv(
      "Cash collected",
      `${cashFull.length} full month${cashFull.length === 1 ? "" : "s"}${cashOpen.length ? ` · ${monthName(cashOpen[cashOpen.length - 1])} in progress` : ""}`,
    ) +
    kv(
      "Balance reports",
      `${snaps.length}${snaps.length ? ` (latest ${fmtDate(snaps[snaps.length - 1])})` : ""}`,
    ) +
    `<p class="pulse-sub" style="margin-top:8px;">Comparisons use only <b>full</b> months. Anything that can't be compared yet is listed under "Not available yet" with what unlocks it. Click any dotted number to see where it came from.</p>`;

  // sales growth by channel
  if (an.wA.latest)
    cards.push(card("Wholesale revenue", channelLines(an.wA, "wholesale")));
  else
    notYet.push(
      `<b>Wholesale growth</b>: needs full months of Sales by Customer. ${blockNote(S, "wholesale")}`,
    );
  if (an.fA.latest)
    cards.push(
      card("Direct / festival revenue", channelLines(an.fA, "festival")),
    );
  else
    notYet.push(
      `<b>Direct / festival growth</b>: needs full months of the Square report. ${blockNote(S, "festival")}`,
    );
  if (an.cA.latest)
    cards.push(
      card(
        "Combined business",
        channelLines(an.cA, null),
        "Wholesale + direct, counted only for months where both are complete. The two channels are never merged in the underlying records.",
      ),
    );

  // channel mix
  const mix = an.combined.map((p) => ({
    month: p.month,
    share: (an.fMap[p.month] / p.value) * 100,
  }));
  if (
    mix.length >= 2 &&
    mix[mix.length - 1].month === addMonths(mix[mix.length - 2].month, 1)
  ) {
    const a = mix[mix.length - 2],
      b = mix[mix.length - 1];
    cards.push(
      card(
        "Channel mix",
        kv(
          `Direct / festival share of total`,
          `${a.share.toFixed(1)}% → ${b.share.toFixed(1)}% <span class="pulse-sub">(${monthName(a.month)} → ${monthName(b.month)})</span>`,
        ),
      ),
    );
  } else
    notYet.push(
      "<b>Channel mix over time</b>: needs two consecutive full months where both wholesale and direct are loaded.",
    );

  // customers driving the change
  const L = an.wA.latest ? an.wA.latest.month : null,
    P = L ? addMonths(L, -1) : null;
  if (L && an.monthCust[L] && an.monthCust[P]) {
    const cur = an.monthCust[L],
      prv = an.monthCust[P];
    const mv = rankMovers(cur.listed, prv.listed, 3);
    const row = (r) =>
      `${esc(r.name)} <span class="pulse-sub">${fmt(r.from)} → ${fmt(r.to)}</span> ${deltaText(r.abs)}`;
    const listedNow = sumOf(Object.values(cur.listed), (x) => x),
      listedPrev = sumOf(Object.values(prv.listed), (x) => x);
    let inner =
      kv(
        `Total wholesale, ${monthName(P)} → ${monthName(L)}`,
        `${fmt(listedPrev + prv.other)} → ${fmt(listedNow + cur.other)}`,
      ) +
      kv("…from your stores & restaurants", deltaText(listedNow - listedPrev)) +
      kv("…from other buyers", deltaText(cur.other - prv.other));
    mv.ups.forEach(
      (r, i) => (inner += kv(i === 0 ? "Biggest increases" : "", row(r))),
    );
    mv.downs.forEach(
      (r, i) => (inner += kv(i === 0 ? "Biggest decreases" : "", row(r))),
    );
    if (mv.newcomers.length)
      inner += kv(
        "Bought this month, not last",
        mv.newcomers.map(esc).join(", "),
      );
    if (mv.lapsed.length)
      inner += kv("Bought last month, not this", mv.lapsed.map(esc).join(", "));
    cards.push(
      card(
        "Which customers are driving the change",
        inner,
        "Listed stores and restaurants only; individual buyers are summarized as one line.",
      ),
    );
  } else
    notYet.push(
      "<b>Which customers drive the change</b>: needs two consecutive full months of Sales by Customer.",
    );

  // concentration
  const cm = Object.keys(an.monthCust).sort();
  if (cm.length) {
    const k = cm[cm.length - 1],
      m = an.monthCust[k],
      vals = Object.values(m.listed),
      listedTotal = sumOf(vals, (x) => x),
      allTotal = listedTotal + m.other;
    const share = (n, tot) => {
      const v = vals
        .filter((x) => x > 0)
        .sort((a, b) => b - a)
        .slice(0, n)
        .reduce((a, x) => a + x, 0);
      return tot > 0 ? (v / tot) * 100 : null;
    };
    let inner = [1, 3, 5]
      .map((n) =>
        kv(
          `Top ${n} customer${n === 1 ? "" : "s"}`,
          `${topShare(vals, n).toFixed(1)}% <span class="pulse-sub">of store & restaurant revenue (${fmt(listedTotal)}) · ${share(n, allTotal).toFixed(1)}% of all wholesale (${fmt(allTotal)})</span>`,
        ),
      )
      .join("");
    const pk = addMonths(k, -1);
    if (an.monthCust[pk])
      inner += kv(
        `Top 5 in ${monthName(pk)}`,
        `${topShare(Object.values(an.monthCust[pk].listed), 5).toFixed(1)}% of store & restaurant revenue`,
      );
    cards.push(card(`Customer concentration, ${monthName(k)}`, inner));
  } else
    notYet.push(
      "<b>Customer concentration</b>: needs a full month of Sales by Customer.",
    );

  // products moving
  const Li = an.itemSeries.length
      ? an.itemSeries[an.itemSeries.length - 1].month
      : null,
    Pi = Li ? addMonths(Li, -1) : null;
  if (Li && an.monthProd[Li] && an.monthProd[Pi]) {
    const toRev = (o) =>
      Object.fromEntries(Object.entries(o).map(([n, v]) => [n, v.revenue]));
    const mv = rankMovers(toRev(an.monthProd[Li]), toRev(an.monthProd[Pi]), 3);
    const row = (r) =>
      `${esc(r.name)} <span class="pulse-sub">${fmt(r.from)} → ${fmt(r.to)}</span> ${deltaText(r.abs)}`;
    let inner = "";
    mv.ups.forEach(
      (r, i) => (inner += kv(i === 0 ? "Fastest growing" : "", row(r))),
    );
    mv.downs.forEach(
      (r, i) => (inner += kv(i === 0 ? "Fastest declining" : "", row(r))),
    );
    if (mv.lapsed.length)
      inner += kv("Sold last month, not this", mv.lapsed.map(esc).join(", "));
    cards.push(
      card(
        `Products moving, ${monthName(Pi)} → ${monthName(Li)} (revenue)`,
        inner || kv("No change", "same revenue in both months", true),
        "Product reports don't say who bought what, so this is never broken down by customer.",
      ),
    );
  } else
    notYet.push(
      "<b>Which products are growing or declining</b>: needs two consecutive full months of Sales by Item.",
    );

  // cash vs sales
  const both = Object.keys(an.cashByMonth)
    .filter(
      (k) => cashMonthComplete(k) && an.wSeries.some((p) => p.month === k),
    )
    .sort();
  if (both.length) {
    const k = both[both.length - 1],
      w = an.wSeries.find((p) => p.month === k).value,
      c = an.cashByMonth[k];
    cards.push(
      card(
        `Cash vs sales, ${monthName(k)}`,
        kv(
          "Collected in the month",
          `${fmt(c.sum)} <span class="pulse-sub">(${c.count} payments)</span>`,
        ) +
          kv("Invoiced in the month", srcLink("wholesale", k, fmt(w))) +
          kv("Collected ÷ invoiced", `${((c.sum / w) * 100).toFixed(0)}%`),
        "Payments received in a month mostly settle earlier invoices, so this is a pace check, not a collection rate.",
      ),
    );
  } else
    notYet.push(
      "<b>Are payments keeping pace with sales</b>: needs a month where both the sales report and the payment history are complete.",
    );

  // receivables movement
  const mvAR = arMovement();
  if (mvAR) {
    let inner = kv(
      `Owed ${fmtDate(mvAR.prev)} → ${fmtDate(mvAR.cur)}`,
      `${fmt(mvAR.totalPrev)} → ${fmt(mvAR.totalCur)} · ${deltaText(mvAR.totalCur - mvAR.totalPrev)}${mvAR.totalPrev > 0 ? ` (${pctText(((mvAR.totalCur - mvAR.totalPrev) / mvAR.totalPrev) * 100)})` : ""}`,
    );
    mvAR.ups.forEach(
      (r, i) =>
        (inner += kv(
          i === 0 ? "Balances that grew" : "",
          `${esc(r.name)} <span class="pulse-sub">${fmt(r.from)} → ${fmt(r.to)}</span>`,
        )),
    );
    mvAR.downs.forEach(
      (r, i) =>
        (inner += kv(
          i === 0 ? "Balances that shrank" : "",
          `${esc(r.name)} <span class="pulse-sub">${fmt(r.from)} → ${fmt(r.to)}</span>`,
        )),
    );
    if (mvAR.lapsed.length)
      inner += kv("Paid off completely", mvAR.lapsed.map(esc).join(", "));
    cards.push(
      card(
        "Is outstanding AR going up or down",
        inner,
        "Balances are what Zoho reported on each date. Nothing here is called overdue: due dates aren't in the reports.",
      ),
    );
  } else
    notYet.push(
      `<b>Is outstanding AR rising or falling</b>: needs a second balance report (you have ${snaps.length}${snaps.length ? `: ${fmtDate(snaps[0])}` : ""}).`,
    );

  if (an.wA.count < 24)
    notYet.push(
      `<b>Seasonality</b>: needs 24 full months (you have ${an.wA.count}).`,
    );
  else if (an.wA.seasonal) {
    const s = an.wA.seasonal,
      hi = s.reduce((a, x) => (x.index > a.index ? x : a)),
      lo = s.reduce((a, x) => (x.index < a.index ? x : a));
    const mn = (i) =>
      new Date(2000, i - 1, 1).toLocaleDateString("en-US", { month: "long" });
    cards.push(
      card(
        "Seasonality",
        kv(
          "Strongest month",
          `${mn(hi.m)} · ${hi.index.toFixed(2)}× the average`,
        ) +
          kv(
            "Weakest month",
            `${mn(lo.m)} · ${lo.index.toFixed(2)}× the average`,
          ),
      ),
    );
  }

  document.getElementById("trend-cards").innerHTML = cards.join("");
  document.getElementById("trend-unavailable").innerHTML = notYet.length
    ? `<div class="pulse-card sec"><p class="pulse-label">Not available yet</p>${notYet.map((x) => `<div class="kv"><span class="v muted" style="text-align:left;font-weight:400;">${x}</span></div>`).join("")}</div>`
    : "";
}

// ---- Traceability: a number -> the customers and imports behind it
function openMonthDetail(source, month) {
  if (source !== "wholesale") return;
  const m = D.an.monthCust[month];
  if (!m) return;
  const listed = Object.entries(m.listed).sort((a, b) => b[1] - a[1]);
  const [y, mo] = month.split("-").map(Number);
  const first = `${month}-01`,
    last = ymd(new Date(y, mo, 0));
  const batches = D.batches.filter(
    (b) =>
      b.report_type === "sales_customer" &&
      b.period_start &&
      b.period_start >= first &&
      b.period_end <= last,
  );
  const total = sumOf(listed, (x) => x[1]) + m.other;
  gmOpen(
    `
      <div class="modal-rank">Where this number comes from</div>
      <h3>Wholesale revenue, ${monthName(month)}: ${fmt(total)}</h3>
      <p class="pulse-label" style="margin-top:14px;">Customers</p>
      ${listed.map(([n, v]) => `<div class="kv"><span class="k" style="max-width:none;">${esc(n)}</span><span class="v">${fmt(v)}</span></div>`).join("")}
      ${m.otherCount ? `<div class="kv"><span class="k" style="max-width:none;">${m.otherCount} other buyer${m.otherCount === 1 ? "" : "s"} (individuals)</span><span class="v">${fmt(m.other)}</span></div>` : ""}
      <p class="pulse-label" style="margin-top:14px;">Imported from</p>
      ${batches.length ? batches.map((b) => `<div class="kv"><span class="k" style="max-width:none;">${esc(b.file_name || "Sales by Customer")} · ${fmtDate(b.period_start)} to ${fmtDate(b.period_end)}</span><span class="v">${b.rows_added} rows · ${new Date(b.imported_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${b.imported_by_email ? " · " + esc(b.imported_by_email) : ""}</span></div>`).join("") : `<div class="empty-note">No import record found for this month.</div>`}
      <div class="pay-note">The original PDF isn't stored: the import record above shows the file name, who imported it, and its reconciled total. See the Upload tab for the full history.</div>
      <button type="button" class="modal-close" data-action="gmClose">Close</button>`,
    true,
  );
}

// ---- Monthly management report
function buildMonthlyReport(month) {
  const an = D.an,
    S = D.srcMonths,
    out = [],
    text = [];
  const sec = (h, lines) => {
    out.push(
      `<p class="pulse-label" style="margin-top:14px;">${h}</p>${lines.map(([k, v]) => kv(k, v)).join("")}`,
    );
    text.push(h.toUpperCase());
    lines.forEach(([k, v]) =>
      text.push(`  ${k}: ${String(v).replace(/<[^>]+>/g, "")}`),
    );
  };
  const pk = addMonths(month, -1),
    yk = addMonths(month, -12);
  const w = an.wSeries.find((p) => p.month === month),
    wPrev = an.wSeries.find((p) => p.month === pk),
    wYoy = an.wSeries.find((p) => p.month === yk);
  const cmpLine = (cur, prev, label) =>
    prev
      ? `${fmt(prev.value)} → ${fmt(cur.value)} · ${deltaText(cur.value - prev.value)}${prev.value > 0 ? ` (${pctText(((cur.value - prev.value) / prev.value) * 100)})` : ""}`
      : null;
  const mc = an.monthCust[month];
  const wholesale = [["Revenue", fmt(w.value)]];
  const inv = S.find(
    (r) => r.source === "wholesale" && monthKeyOf(r.month) === month,
  );
  if (inv && inv.invoices != null) {
    wholesale.push(["Invoices", inv.invoices]);
    if (Number(inv.invoices) > 0)
      wholesale.push(["Average order", fmt(w.value / Number(inv.invoices))]);
  }
  if (cmpLine(w, wPrev))
    wholesale.push([`Vs ${monthName(pk)}`, cmpLine(w, wPrev)]);
  else
    wholesale.push([`Vs ${monthName(pk)}`, "no full previous month on file"]);
  wholesale.push([
    `Vs ${monthName(yk)}`,
    wYoy ? cmpLine(w, wYoy) : "no report from a year earlier",
  ]);
  if (mc)
    wholesale.push([
      "Customers who bought",
      `${Object.keys(mc.listed).length} stores & restaurants · ${mc.otherCount} other buyers`,
    ]);
  sec("Wholesale", wholesale);

  const f = an.fSeries.find((p) => p.month === month),
    fPrev = an.fSeries.find((p) => p.month === pk);
  const fr = S.find(
    (r) => r.source === "festival" && monthKeyOf(r.month) === month,
  );
  if (f) {
    const lines = [["Revenue", fmt(f.value)]];
    if (fr && fr.units != null)
      lines.push(["Units", Number(fr.units).toLocaleString()]);
    lines.push([
      `Vs ${monthName(pk)}`,
      cmpLine(f, fPrev) || "no full previous month on file",
    ]);
    sec("Direct / festival", lines);
    sec("Combined", [
      ["Revenue", fmt(w.value + f.value)],
      [
        "Direct / festival share",
        `${((f.value / (w.value + f.value)) * 100).toFixed(1)}%`,
      ],
    ]);
  } else
    sec("Direct / festival", [
      ["Revenue", "no full month of the Square report on file"],
    ]);

  if (mc) {
    const listed = Object.entries(mc.listed).sort((a, b) => b[1] - a[1]),
      tot = sumOf(listed, (x) => x[1]);
    sec(
      "Top customers",
      listed
        .slice(0, 5)
        .map(([n, v], i) => [
          `${i + 1}. ${esc(n)}`,
          `${fmt(v)} <span class="pulse-sub">${((v / tot) * 100).toFixed(1)}% of store & restaurant revenue</span>`,
        ]),
    );
    if (an.monthCust[pk]) {
      const mv = rankMovers(mc.listed, an.monthCust[pk].listed, 3);
      const lines = [
        ...mv.ups.map((r) => [
          "Increase · " + esc(r.name),
          `${fmt(r.from)} → ${fmt(r.to)} (${deltaText(r.abs)})`,
        ]),
        ...mv.downs.map((r) => [
          "Decrease · " + esc(r.name),
          `${fmt(r.from)} → ${fmt(r.to)} (${deltaText(r.abs)})`,
        ]),
      ];
      if (mv.newcomers.length)
        lines.push([
          "Bought this month, not last",
          mv.newcomers.map(esc).join(", "),
        ]);
      if (mv.lapsed.length)
        lines.push([
          "Bought last month, not this",
          mv.lapsed.map(esc).join(", "),
        ]);
      if (lines.length) sec(`Customer changes vs ${monthName(pk)}`, lines);
    }
  }
  const pm = an.monthProd[month];
  if (pm) {
    const top = Object.entries(pm)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5);
    sec(
      "Top products",
      top.map(([n, v], i) => [
        `${i + 1}. ${esc(n)}`,
        `${fmt(v.revenue)} · ${v.units.toLocaleString()} units`,
      ]),
    );
    if (an.monthProd[pk]) {
      const rev = (o) =>
        Object.fromEntries(Object.entries(o).map(([n, v]) => [n, v.revenue]));
      const mv = rankMovers(rev(pm), rev(an.monthProd[pk]), 3);
      const lines = [
        ...mv.ups.map((r) => [
          "Up · " + esc(r.name),
          `${fmt(r.from)} → ${fmt(r.to)} (${deltaText(r.abs)})`,
        ]),
        ...mv.downs.map((r) => [
          "Down · " + esc(r.name),
          `${fmt(r.from)} → ${fmt(r.to)} (${deltaText(r.abs)})`,
        ]),
      ];
      if (lines.length) sec(`Product changes vs ${monthName(pk)}`, lines);
    }
  }
  const [yy, mm] = month.split("-").map(Number),
    monthEnd = ymd(new Date(yy, mm, 0));
  const c = an.cashByMonth[month];
  const cashLines = [
    [
      "Collected",
      c ? `${fmt(c.sum)} (${c.count} payments)` : "no payments on file",
    ],
  ];
  if (c && an.cashByMonth[pk] && cashMonthComplete(pk))
    cashLines.push([
      `Vs ${monthName(pk)}`,
      cmpLine({ value: c.sum }, { value: an.cashByMonth[pk].sum }),
    ]);
  sec("Payments received", cashLines);
  const snaps = [...new Set(D.balances.map((b) => b.as_of_date))]
    .sort()
    .filter((d) => d <= monthEnd);
  if (snaps.length) {
    const tot = (d) =>
      sumOf(
        D.balances.filter((b) => b.as_of_date === d),
        (b) => b.outstanding_balance,
      );
    const lines = [
      [
        `Owed as of ${fmtDate(snaps[snaps.length - 1])}`,
        fmt(tot(snaps[snaps.length - 1])),
      ],
    ];
    if (snaps.length > 1)
      lines.push([
        `Vs ${fmtDate(snaps[snaps.length - 2])}`,
        `${fmt(tot(snaps[snaps.length - 2]))} → ${fmt(tot(snaps[snaps.length - 1]))}`,
      ]);
    sec("Receivables", lines);
  } else
    sec("Receivables", [
      ["Owed", "no balance report on or before this month's end"],
    ]);

  const notes = [];
  if (D.unresolved.length)
    notes.push(
      `${D.unresolved.length} Zoho name${D.unresolved.length === 1 ? "" : "s"} still need a decision (${fmt(sumOf(D.unresolved, (u) => u.revenue))} of sales).`,
    );
  const bad = D.batches.filter((b) => b.reconciliation !== "pass");
  if (bad.length)
    notes.push(
      `${bad.length} import${bad.length === 1 ? "" : "s"} did not reconcile.`,
    );
  const miss = S.filter(
    (r) => r.source === "wholesale" && r.status === "missing",
  ).map((r) => monthName(monthKeyOf(r.month)));
  if (miss.length)
    notes.push(`No Sales by Customer report for ${miss.join(", ")}.`);
  sec("Data quality", [["Warnings", notes.length ? notes.join(" ") : "none"]]);

  const changes = [];
  if (wPrev)
    changes.push(
      `Wholesale revenue ${w.value >= wPrev.value ? "rose" : "fell"} ${wPrev.value > 0 ? Math.abs(((w.value - wPrev.value) / wPrev.value) * 100).toFixed(1) + "% " : ""}versus ${monthName(pk)} (${fmt(wPrev.value)} → ${fmt(w.value)}).`,
    );
  if (wYoy)
    changes.push(
      `Wholesale revenue ${w.value >= wYoy.value ? "rose" : "fell"} ${wYoy.value > 0 ? Math.abs(((w.value - wYoy.value) / wYoy.value) * 100).toFixed(1) + "% " : ""}versus ${monthName(yk)}.`,
    );
  if (mc && an.monthCust[pk]) {
    const mv = rankMovers(mc.listed, an.monthCust[pk].listed, 1);
    if (mv.ups[0])
      changes.push(
        `${mv.ups[0].name} was the largest customer increase (${deltaText(mv.ups[0].abs)}).`,
      );
    if (mv.downs[0])
      changes.push(
        `${mv.downs[0].name} was the largest customer decrease (${deltaText(mv.downs[0].abs)}).`,
      );
  }
  out.splice(
    0,
    0,
    `<p class="pulse-label" style="margin-top:6px;">What changed</p>${changes.length ? changes.map((x) => `<div class="kv"><span class="v" style="text-align:left;font-weight:400;">${esc(x)}</span></div>`).join("") : `<div class="empty-note">Nothing to compare yet: needs the previous full month.</div>`}`,
  );
  text.splice(
    0,
    0,
    "WHAT CHANGED",
    ...(changes.length
      ? changes.map((x) => "  " + x)
      : ["  Nothing to compare yet."]),
  );
  return { html: out.join(""), text: text.join("\n") };
}
function openMonthlyReport(selected) {
  const months = D.an.wSeries
    .map((p) => p.month)
    .sort()
    .reverse();
  if (!months.length) {
    gmOpen(`<div class="modal-rank">Monthly report</div><h3>No completed month yet</h3>
        <div class="pay-note" style="font-size:13px;">A report needs a full month of Sales by Customer. ${esc(blockNote(D.srcMonths, "wholesale"))} Once a month's report is uploaded after the month ends (for example October's, in early November), a one-page summary appears here.</div>
        <button type="button" class="modal-close" data-action="gmClose">Close</button>`);
    return;
  }
  const month = selected && months.includes(selected) ? selected : months[0];
  const rep = buildMonthlyReport(month);
  gmOpen(
    `<div class="modal-rank">Monthly report</div>
      <select class="field-input" id="rep-month" style="margin:6px 0 4px;">${months.map((m) => `<option value="${m}"${m === month ? " selected" : ""}>${monthName(m)}</option>`).join("")}</select>
      <div id="rep-body">${rep.html}</div>
      <div class="modal-actions"><button type="button" class="btn-ghost" id="rep-print">Print / Save PDF</button><button type="button" class="btn-ghost" id="rep-copy">Copy as text</button><button type="button" class="btn-solid" data-action="gmClose">Close</button></div>`,
    true,
  );
  document
    .getElementById("rep-month")
    .addEventListener("change", (e) => openMonthlyReport(e.target.value));
  document
    .getElementById("rep-print")
    .addEventListener("click", () => window.print());
  document.getElementById("rep-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(
        `ANTARI NYC: ${monthName(month)}\n\n${rep.text}`,
      );
      showToast("Report copied.");
    } catch (e) {
      showToast("Couldn't copy: select the text instead.");
    }
  });
}

// ---- Customer history (inside the customer window)
function customerHistoryHtml(store) {
  if (!D) return "";
  const name = store.store_name,
    an = D.an;
  const rows = D.mappedRows.filter((r) => displayNameOf(r) === name);
  const lifetime = sumOf(rows, (r) => r.sales),
    invoices = sumOf(rows, (r) => r.invoice_count);
  const zohoNames = [...new Set(rows.map((r) => r.zoho_name))];
  const L = [];
  L.push(kv("Lifetime sales", fmt(lifetime)));
  L.push(
    kv(
      "Invoices on file",
      invoices
        ? `${invoices}${lifetime > 0 ? ` · average ${fmt(lifetime / invoices)}` : ""}`
        : "0",
    ),
  );
  if (rows.length) {
    const last = rows
      .map((r) => r.period_end)
      .filter(Boolean)
      .sort()
      .pop();
    L.push(
      kv(
        "Last report period they bought in",
        `${fmtDate(rows.filter((r) => r.period_end === last)[0].period_start)} to ${fmtDate(last)}`,
      ),
    );
    L.push(kv("Appears in Zoho as", zohoNames.map(esc).join(", ")));
  }
  const series = an.wSeries.map((p) => ({
    month: p.month,
    value: (an.monthCust[p.month] && an.monthCust[p.month].listed[name]) || 0,
  }));
  const a = analyzeSeries(series);
  const situations = [];
  if (a.latest) {
    L.push(
      kv(
        `${monthName(a.latest.month)} (latest full month)`,
        fmt(a.latest.value),
      ),
    );
    L.push(
      a.mom
        ? kv(
            `Vs ${monthName(a.mom.from.month)}`,
            `${fmt(a.mom.from.value)} → ${fmt(a.mom.to.value)} · ${deltaText(a.mom.abs)}${a.mom.pct != null ? ` (${pctText(a.mom.pct)})` : ""}`,
          )
        : kv("Vs previous month", "no full previous month on file", true),
    );
    if (a.r3) L.push(kv("Last 3 months", fmt(a.r3.current.sum)));
    if (a.r6) L.push(kv("Last 6 months", fmt(a.r6.current.sum)));
    if (a.ytd && a.ytd.months >= 2)
      L.push(
        kv(`Year to date (since ${monthName(a.ytd.since)})`, fmt(a.ytd.value)),
      );
    if (a.latest.value === 0 && lifetime > 0)
      situations.push(`No purchase in ${monthName(a.latest.month)}`);
    const firstStart = rows
      .map((r) => r.period_start)
      .filter(Boolean)
      .sort()[0];
    if (
      firstStart &&
      firstStart >= `${a.latest.month}-01` &&
      a.latest.value > 0
    )
      situations.push(
        `New in ${monthName(a.latest.month)}: first purchase on file`,
      );
    if (a.mom && a.mom.abs !== 0 && a.latest.value > 0)
      situations.push(
        `${a.mom.abs > 0 ? "Up" : "Down"} ${fmt(Math.abs(a.mom.abs))} versus ${monthName(a.mom.from.month)}`,
      );
    if (a.streak)
      situations.push(
        `${a.streak.direction === "up" ? "Growing" : "Declining"} ${a.streak.months} months in a row`,
      );
  } else
    L.push(
      kv(
        "Month-by-month",
        "starts once a full month of sales is uploaded",
        true,
      ),
    );
  if (situations.length) L.push(kv("Situation", situations.join(" · ")));
  const batchIds = [
    ...new Set(rows.map((r) => r.import_batch_id).filter((x) => x != null)),
  ];
  const bs = D.batches.filter((b) => batchIds.includes(b.id));
  if (bs.length)
    L.push(
      kv(
        "Source",
        bs
          .map(
            (b) =>
              `#${b.id} ${esc(REPORT_LABEL[b.report_type] || b.report_type)}, ${new Date(b.imported_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}${b.imported_by_email ? " by " + esc(b.imported_by_email) : " (initial load)"}`,
          )
          .join("<br>"),
      ),
    );
  return `<p class="pulse-label" style="margin-top:14px;">History</p>${L.join("")}`;
}

// ---- Receivables tab
function renderReceivables(d) {
  const owedMap = Object.create(null);
  for (const r of d.openBalances) {
    const n = displayNameOf(r),
      x =
        owedMap[n] ||
        (owedMap[n] = {
          name: n,
          snap: 0,
          paid: 0,
          owed: 0,
          asOf: r.as_of_date,
        });
    x.snap += cents(r.snapshot_balance);
    x.paid += cents(r.paid_since_snapshot);
    x.owed += cents(r.outstanding_balance);
  }
  const owed = Object.values(owedMap).sort((a, b) => b.owed - a.owed);
  window.__rcOwed = owed.map((x) => x.name);
  document.getElementById("rc-owed").innerHTML =
    `<div class="pulse-card sec"><p class="pulse-label">Who owes you</p>
      ${
        owed.length
          ? `<table class="tbl"><thead><tr><th>Customer</th><th class="num">Zoho showed</th><th class="num">Recorded here</th><th class="num">Owed now</th><th></th></tr></thead><tbody>
      ${owed.map((x, i) => `<tr><td>${esc(x.name)}</td><td class="num">${fmt(x.snap / 100)}</td><td class="num">${fmt(x.paid / 100)}</td><td class="num"><b>${fmt(x.owed / 100)}</b></td><td><button type="button" class="paid-btn" data-pay="${i}">Paid</button></td></tr>`).join("")}
      <tr><td><b>Total</b></td><td class="num">${fmt(sumOf(owed, (x) => x.snap) / 100)}</td><td class="num">${fmt(sumOf(owed, (x) => x.paid) / 100)}</td><td class="num"><b>${fmt(sumOf(owed, (x) => x.owed) / 100)}</b></td><td></td></tr></tbody></table>
      <p class="pulse-sub" style="margin-top:8px;">Zoho balance report as of ${fmtDate(owed.length ? owedMap[owed[0].name].asOf : "")}. "Recorded here" are payments entered with the Paid button; record them in Zoho too. Nothing is called overdue because the reports don't include due dates.</p>`
          : `<div class="empty-note">Nothing owed to you right now.</div>`
      }</div>`;

  const mv = arMovement();
  document.getElementById("rc-movement").innerHTML = mv
    ? `<div class="pulse-card sec"><p class="pulse-label">How balances moved</p>
      ${kv(`${fmtDate(mv.prev)} → ${fmtDate(mv.cur)}`, `${fmt(mv.totalPrev)} → ${fmt(mv.totalCur)} · ${deltaText(mv.totalCur - mv.totalPrev)}`)}
      ${mv.ups.map((r, i) => kv(i === 0 ? "Grew" : "", `${esc(r.name)} ${fmt(r.from)} → ${fmt(r.to)}`)).join("")}
      ${mv.downs.map((r, i) => kv(i === 0 ? "Shrank" : "", `${esc(r.name)} ${fmt(r.from)} → ${fmt(r.to)}`)).join("")}
      ${mv.lapsed.length ? kv("Paid off", mv.lapsed.map(esc).join(", ")) : ""}</div>`
    : `<div class="pulse-card sec"><p class="pulse-label">How balances moved</p><div class="empty-note">Only one balance report so far: the next one shows whether balances are growing or shrinking.</div></div>`;

  const log = d.payLog;
  document.getElementById("rc-log").innerHTML =
    `<div class="pulse-card sec"><p class="pulse-label">Payments recorded in this dashboard</p>
      ${
        log.length
          ? `<table class="tbl"><thead><tr><th>Paid on</th><th>Customer</th><th class="num">Amount</th><th class="num">Balance before → after</th><th>Recorded by</th><th>Status</th></tr></thead><tbody>
      ${log
        .map(
          (
            p,
          ) => `<tr class="${p.voided_at ? "voided" : ""}"><td>${fmtDate(p.paid_on)}</td><td>${esc(p.mapped_store !== "Other" ? p.mapped_store : p.zoho_name)}${p.note ? `<div class="pulse-sub">${esc(p.note)}</div>` : ""}</td><td class="num">${fmt(p.amount)}</td>
        <td class="num">${p.balance_before != null ? fmt(p.balance_before) + " → " + fmt(p.balance_after) : "Not available"}</td>
        <td>${esc(p.recorded_by_email || "Not available")}<div class="pulse-sub">${new Date(p.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div></td>
        <td class="status">${p.voided_at ? `Voided by ${esc(p.voided_by_email || "Not available")}<div class="pulse-sub">${esc(p.void_reason)}</div>` : `<button type="button" class="btn-sm quiet" data-void="${p.id}">Void</button>`}</td></tr>`,
        )
        .join("")}</tbody></table>
      <p class="pulse-sub" style="margin-top:8px;">Payments can't be edited or deleted. A mistake is voided with a reason, stays in this log, and the balance is restored.</p>`
          : `<div class="empty-note">No payments recorded here yet. Use the Paid button next to a balance.</div>`
      }</div>`;

  const recent = [...d.payments]
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .slice(0, 12);
  document.getElementById("rc-recent").innerHTML =
    `<div class="pulse-card sec"><p class="pulse-label">Latest payments received (from Zoho)</p>
      <table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Invoice</th><th>How</th><th class="num">Amount</th></tr></thead><tbody>
      ${recent.map((p) => `<tr><td>${fmtDate(p.payment_date)}</td><td>${esc(displayNameOf(p))}</td><td>${esc(p.invoice_number || "Not available")}</td><td>${esc(p.payment_mode || "Not available")}</td><td class="num">${fmt(p.amount)}</td></tr>`).join("")}</tbody></table></div>`;

  const by = Object.create(null);
  for (const p of d.payments) {
    if (p.mapped_store === "Other") continue;
    (by[p.mapped_store] = by[p.mapped_store] || []).push(p.payment_date);
  }
  const beh = Object.entries(by)
    .filter(([, ds]) => ds.length >= 2)
    .map(([n, ds]) => {
      const s = [...new Set(ds)].map(parseYmd).sort((a, b) => a - b);
      if (s.length < 2) return null;
      let gap = 0;
      for (let i = 1; i < s.length; i++) gap += (s[i] - s[i - 1]) / 86400000;
      return {
        n,
        count: s.length,
        last: ymd(s[s.length - 1]),
        avg: gap / (s.length - 1),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count);
  document.getElementById("rc-behavior").innerHTML =
    `<div class="pulse-card sec"><p class="pulse-label">How your stores & restaurants pay</p>
      ${beh.length ? `<table class="tbl"><thead><tr><th>Customer</th><th class="num">Payments</th><th class="num">Avg days between</th><th>Last paid</th></tr></thead><tbody>${beh.map((b) => `<tr><td>${esc(b.n)}</td><td class="num">${b.count}</td><td class="num">${b.avg.toFixed(0)}</td><td>${fmtDate(b.last)}</td></tr>`).join("")}</tbody></table><p class="pulse-sub" style="margin-top:8px;">Days between <i>payments</i>, not orders. Only customers with two or more payments.</p>` : `<div class="empty-note">Shows up once a customer has two or more payments on file.</div>`}</div>`;
}
function openVoidModal(id) {
  const p = D.payLog.find((x) => String(x.id) === String(id));
  if (!p) return;
  gmOpen(`<div class="modal-rank">Void a payment</div><h3>${fmt(p.amount)} · ${esc(p.mapped_store !== "Other" ? p.mapped_store : p.zoho_name)}</h3>
      <div class="pay-note" style="margin-top:0;">Paid ${fmtDate(p.paid_on)}, recorded by ${esc(p.recorded_by_email || "Not available")}. Voiding restores the balance; the entry stays in the log.</div>
      <label class="field-label" for="void-reason">Why is it being voided?</label>
      <input class="field-input" id="void-reason" type="text" placeholder="e.g. entered against the wrong customer">
      <div class="pay-error" id="void-error"></div>
      <div class="modal-actions"><button type="button" class="btn-ghost" id="void-cancel">Cancel</button><button type="button" class="btn-solid" id="void-confirm">Void payment</button></div>`);
  document.getElementById("void-cancel").addEventListener("click", gmClose);
  document
    .getElementById("void-confirm")
    .addEventListener("click", async () => {
      const reason = document.getElementById("void-reason").value.trim();
      if (!reason) {
        document.getElementById("void-error").textContent =
          "A reason is required.";
        return;
      }
      const b = document.getElementById("void-confirm");
      b.disabled = true;
      b.textContent = "Saving…";
      const { error } = await sb.rpc("void_payment", {
        p_ids: [Number(id)],
        p_reason: reason,
      });
      if (error) {
        document.getElementById("void-error").textContent = error.message;
        b.disabled = false;
        b.textContent = "Void payment";
        return;
      }
      gmClose();
      showToast("Payment voided. The balance is restored.");
      reloadAfterWrite();
    });
}

// ---- Data tab: data quality + mapping workspace
function renderDataTab(d) {
  const S = d.srcMonths,
    L = [],
    un = d.unresolved;
  if (d.batches.some((b) => b.report_type === "festival_sales"))
    L.push(
      chk(
        false,
        "Square festival reports currently track gross item sales. Discounts, refunds, taxes, and processing fees need separate reconciliation before these totals can be treated as net revenue or cash.",
      ),
    );
  L.push(
    un.length
      ? chk(
          false,
          `<b>${un.length} Zoho name${un.length === 1 ? "" : "s"}</b> waiting for your decision (${fmt(sumOf(un, (u) => u.revenue))} in sales). Decide below.`,
        )
      : chk(true, "No Zoho names are waiting for a decision."),
  );
  const provisional = d.mappingAll.filter((m) =>
    /provisional owner decision/i.test(m.notes || ""),
  );
  for (const mapping of provisional)
    L.push(
      chk(
        false,
        `<b>${esc(mapping.zoho_name)}</b> is provisionally grouped under ${esc(mapping.mapped_store)}. Review future reports that still use this generic name.`,
      ),
    );
  const bad = d.batches.filter(
    (b) =>
      b.reconciliation !== "pass" ||
      b.source_total == null ||
      b.parsed_total == null ||
      Math.abs(Number(b.source_total) - Number(b.parsed_total)) > 0.005,
  );
  const suspectPayments = d.payLog.filter(
    (p) => !p.voided_at && p.paid_on <= p.as_of_date,
  );
  if (suspectPayments.length)
    L.push(
      chk(
        false,
        `<b>${suspectPayments.length} payment record(s)</b> are dated on or before their balance snapshot and may be subtracted twice. Review them in Receivables before relying on the outstanding total.`,
      ),
    );
  L.push(
    bad.length
      ? chk(
          false,
          `${bad.length} import${bad.length === 1 ? "" : "s"} did not reconcile to the report's own total.`,
        )
      : chk(
          true,
          `All ${d.batches.length} imports reconciled to their report's own total.`,
        ),
  );
  for (const [label, source] of [
    ["Wholesale sales", "wholesale"],
    ["Direct / festival", "festival"],
    ["Products", "items"],
  ]) {
    const miss = S.filter(
      (r) => r.source === source && r.status === "missing",
    ).map((r) => monthName(monthKeyOf(r.month)));
    L.push(
      !S.some((r) => r.source === source)
        ? chk(false, `${label}: no reports loaded yet.`)
        : miss.length
          ? chk(
              false,
              `${label}: no report covers ${miss.join(", ")}. Those months are left out of comparisons (never treated as zero).`,
            )
          : chk(true, `${label}: no gaps between reports.`),
    );
  }
  const snaps = [...new Set(d.balances.map((b) => b.as_of_date))].sort();
  if (snaps.length)
    L.push(
      chk(
        true,
        `Latest balance report: ${fmtDate(snaps[snaps.length - 1])} (${daysSince(snaps[snaps.length - 1])} days ago).`,
      ),
    );
  const blocks = ["wholesale", "festival", "items"]
    .map((s) => blockNote(S, s))
    .filter(Boolean);
  document.getElementById("dq-warnings").innerHTML =
    `<div class="pulse-card sec"><p class="pulse-label">Data checks</p>${L.join("")}
      ${blocks.length ? `<p class="pulse-sub" style="margin-top:8px;">Limitation, not an error: ${esc(blocks[0])} Business insights (what's happening) live on Overview and Trends.</p>` : `<p class="pulse-sub" style="margin-top:8px;">Business insights (what's happening) live on Overview and Trends.</p>`}</div>`;

  window.__unresolved = un.map((u) => u.zoho_name);
  document.getElementById("map-unresolved").innerHTML =
    `<div class="pulse-card sec"><p class="pulse-label">Zoho names waiting for your decision</p>
      <div class="pulse-sub" style="margin-bottom:6px;">Nothing is matched automatically. Until you decide, a name stays in Other.</div>
      ${
        un.length
          ? un
              .map(
                (
                  u,
                  i,
                ) => `<div class="map-row" data-i="${i}"><div class="who"><b>${esc(u.zoho_name)}</b><div class="pulse-sub">${fmt(u.revenue)} · ${u.invoices} invoice${Number(u.invoices) === 1 ? "" : "s"} · payments ${fmt(u.payments)}${Number(u.balance) > 0 ? ` · owes ${fmt(u.balance)}` : ""}${u.notes ? ` · ${esc(u.notes)}` : ""}</div></div>
        <button type="button" class="btn-sm solid" data-act="match">Match to a customer…</button><button type="button" class="btn-sm" data-act="other">Leave as Other</button><button type="button" class="btn-sm quiet" data-act="new">New customer…</button></div>`,
              )
              .join("") +
            (un.length > 1
              ? `<div style="padding-top:10px;"><button type="button" class="btn-sm quiet" data-act="all-other">Leave all ${un.length} as Other</button></div>`
              : "")
          : `<div class="empty-note">Nothing waiting. New names from future uploads will appear here.</div>`
      }</div>`;

  const reviewed = d.mappingAll
    .filter((m) => m.reviewed)
    .sort((a, b) => a.zoho_name.localeCompare(b.zoho_name));
  window.__reviewed = reviewed.map((m) => m.zoho_name);
  document.getElementById("map-reviewed").innerHTML =
    `<details class="uc-details sec"><summary>Names already decided (${reviewed.length})</summary>
      <table class="tbl" style="margin-top:6px;"><thead><tr><th>Zoho name</th><th>Grouped as</th><th></th></tr></thead><tbody>
      ${reviewed.map((m, i) => `<tr><td>${esc(m.zoho_name)}</td><td>${esc(m.mapped_store)}</td><td><button type="button" class="btn-sm quiet" data-rv="${i}">Change</button></td></tr>`).join("")}</tbody></table></details>`;
}
async function saveMapping(rows) {
  const { error } = await sb
    .from("name_mapping")
    .upsert(rows, { onConflict: "zoho_name" });
  return error;
}
function impactHtml(zoho, from, to) {
  if (from === to) return "No change.";
  const f = nameFacts(zoho);
  let s = `Moves <b>${fmt(f.sales)}</b> of sales (${f.invoices} invoice${f.invoices === 1 ? "" : "s"}), <b>${fmt(f.payments)}</b> of payments received (${f.paymentCount}) and <b>${fmt(f.owed)}</b> currently owed, from <b>${esc(from)}</b> to <b>${esc(to)}</b>.`;
  if (from === "Other" && to !== "Other")
    s += `<br>Other buyers: ${fmt(D.otherTotal)} → ${fmt(D.otherTotal - f.sales)}.`;
  if (to === "Other" && from !== "Other")
    s += `<br>Other buyers: ${fmt(D.otherTotal)} → ${fmt(D.otherTotal + f.sales)}.`;
  return (
    s +
    `<br>Your original reports aren't changed: only how this name is grouped.`
  );
}
function openMatchDialog(zoho) {
  const cur = currentMappingOf(zoho);
  const opts = [
    "Other",
    ...D.stores.map((s) => s.store_name).sort((a, b) => a.localeCompare(b)),
  ];
  gmOpen(`<div class="modal-rank">Group a Zoho name</div><h3>${esc(zoho)}</h3>
      <div class="pay-note" style="margin-top:0;">Currently grouped as <b>${esc(cur)}</b>.</div>
      <label class="field-label" for="map-target">Group it under</label>
      <select class="field-input" id="map-target">${opts.map((o) => `<option value="${esc(o)}"${o === cur ? " selected" : ""}>${o === "Other" ? "Other (not a store or restaurant)" : esc(o)}</option>`).join("")}</select>
      <div class="pay-note" id="map-impact"></div><div class="pay-error" id="map-error"></div>
      <div class="modal-actions"><button type="button" class="btn-ghost" id="map-cancel">Cancel</button><button type="button" class="btn-solid" id="map-confirm">Save</button></div>`);
  const upd = () => {
    document.getElementById("map-impact").innerHTML = impactHtml(
      zoho,
      cur,
      document.getElementById("map-target").value,
    );
  };
  document.getElementById("map-target").addEventListener("change", upd);
  upd();
  document.getElementById("map-cancel").addEventListener("click", gmClose);
  document.getElementById("map-confirm").addEventListener("click", async () => {
    const target = document.getElementById("map-target").value,
      b = document.getElementById("map-confirm");
    b.disabled = true;
    b.textContent = "Saving…";
    const error = await saveMapping([
      {
        zoho_name: cleanName(zoho),
        mapped_store: target,
        notes:
          target === "Other"
            ? "Left as Other in the mapping workspace"
            : "Matched in the mapping workspace",
        reviewed: true,
      },
    ]);
    if (error) {
      document.getElementById("map-error").textContent = error.message;
      b.disabled = false;
      b.textContent = "Save";
      return;
    }
    gmClose();
    showToast(`${zoho} is now grouped under ${target}.`);
    reloadAfterWrite();
  });
}
function openNewCustomerDialog(zoho) {
  const routes = [
    ...new Set(D.stores.map((s) => s.delivery_route).filter(Boolean)),
  ].sort();
  gmOpen(`<div class="modal-rank">Create a new customer</div><h3>${esc(zoho)}</h3>
      <div class="pay-note" style="margin-top:0;">Only do this for a real store or restaurant you deliver to. It adds the customer to your list and groups this Zoho name under it.</div>
      <label class="field-label" for="nc-name">Customer name</label><input class="field-input" id="nc-name" value="${esc(zoho)}">
      <label class="field-label" for="nc-cat">Type</label><select class="field-input" id="nc-cat"><option>Market</option><option>Deli</option><option>Bakery</option><option>Restaurant</option></select>
      <label class="field-label" for="nc-zip">Zip code</label><input class="field-input" id="nc-zip" inputmode="numeric" maxlength="5" placeholder="11235">
      <label class="field-label" for="nc-route">Delivery route</label><input class="field-input" id="nc-route" list="nc-routes" placeholder="pick one or type a new route name"><datalist id="nc-routes">${routes.map((r) => `<option value="${esc(r)}">`).join("")}</datalist>
      <div class="pay-note" id="nc-impact"></div><div class="pay-error" id="nc-error"></div>
      <div class="modal-actions"><button type="button" class="btn-ghost" id="nc-cancel">Cancel</button><button type="button" class="btn-solid" id="nc-confirm">Create customer</button></div>`);
  const f = nameFacts(zoho);
  document.getElementById("nc-impact").innerHTML =
    `Moves <b>${fmt(f.sales)}</b> of sales (${f.invoices} invoices), <b>${fmt(f.payments)}</b> of payments and <b>${fmt(f.owed)}</b> owed onto the new customer. Other buyers: ${fmt(D.otherTotal)} → ${fmt(D.otherTotal - f.sales)}.`;
  document.getElementById("nc-cancel").addEventListener("click", gmClose);
  document.getElementById("nc-confirm").addEventListener("click", async () => {
    const err = document.getElementById("nc-error"),
      name = cleanName(document.getElementById("nc-name").value),
      zip = document.getElementById("nc-zip").value.trim(),
      route = document.getElementById("nc-route").value.trim();
    if (!name) {
      err.textContent = "Enter the customer's name.";
      return;
    }
    if (!/^\d{5}$/.test(zip)) {
      err.textContent = "Enter a 5-digit zip code.";
      return;
    }
    if (!route) {
      err.textContent = "Pick or type a delivery route.";
      return;
    }
    const b = document.getElementById("nc-confirm");
    b.disabled = true;
    b.textContent = "Saving…";
    const { error } = await sb.rpc("create_customer", {
      p_name: name,
      p_zoho_name: zoho,
      p_category: document.getElementById("nc-cat").value,
      p_zip: zip,
      p_route: route,
    });
    if (error) {
      err.textContent = error.message;
      b.disabled = false;
      b.textContent = "Create customer";
      return;
    }
    gmClose();
    showToast(`${name} added to your customers.`);
    reloadAfterWrite();
  });
}
function openNameModal(zoho) {
  const f = nameFacts(zoho),
    cur = currentMappingOf(zoho);
  const pays = D.payments
    .filter((p) => p.zoho_name.toLowerCase() === zoho.toLowerCase())
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
    .slice(0, 8);
  gmOpen(`<div class="modal-rank">Zoho name</div><h3>${esc(zoho)}</h3>
      ${kv("Grouped as", esc(cur))}${kv("Sales on file", `${fmt(f.sales)} · ${f.invoices} invoice${f.invoices === 1 ? "" : "s"}`)}${kv("Payments received", `${fmt(f.payments)} · ${f.paymentCount}`)}${kv("Owed now", fmt(f.owed))}
      ${pays.length ? `<p class="pulse-label" style="margin-top:12px;">Latest payments</p>${pays.map((p) => kv(`${fmtDate(p.payment_date)} · ${esc(p.invoice_number || "Not available")}`, `${fmt(p.amount)} <span class="pulse-sub">${esc(p.payment_mode || "")}</span>`)).join("")}` : ""}
      <div class="modal-actions"><button type="button" class="btn-ghost" id="nm-change">Change grouping</button><button type="button" class="btn-solid" data-action="gmClose">Close</button></div>`);
  document
    .getElementById("nm-change")
    .addEventListener("click", () => openMatchDialog(zoho));
}

// ---- Search
function runSearch(raw) {
  const box = document.getElementById("search-results"),
    q = String(raw).trim().toLowerCase();
  if (!D || q.length < 2) {
    box.style.display = "none";
    return;
  }
  const has = (...xs) =>
    xs.some((x) => x != null && String(x).toLowerCase().includes(q));
  const groups = [];
  const add = (title, items) => {
    if (items.length)
      groups.push(
        `<div class="sr-group">${title}</div>${items.slice(0, 6).join("")}`,
      );
  };
  const item = (kind, key, main, sub) =>
    `<div class="sr-item" data-kind="${kind}" data-key="${esc(key)}"><span>${esc(main)}</span><span class="sr-sub">${esc(sub || "")}</span></div>`;
  add(
    "Customers",
    D.storeData
      .map((s, i) =>
        has(s.store_name, s.zip, s.category, s.delivery_route)
          ? item(
              "customer",
              i,
              s.store_name,
              `${s.category || ""} · ${s.zip || ""}`,
            )
          : null,
      )
      .filter(Boolean),
  );
  add(
    "Products & SKUs",
    D.sortedProducts
      .map((p, i) => {
        const sku = (D.itemRows.find((r) => r.item_name === p.item_name) || {})
          .sku;
        return has(p.item_name, sku)
          ? item("product", i, p.item_name, sku || "")
          : null;
      })
      .filter(Boolean),
  );
  const zNames = [
    ...new Set([
      ...D.mappedRows.map((r) => r.zoho_name),
      ...D.payments.map((p) => p.zoho_name),
      ...D.balances.map((b) => b.zoho_name),
    ]),
  ];
  add(
    "Zoho names",
    zNames
      .filter((n) => has(n))
      .map((n) => item("name", n, n, `grouped as ${currentMappingOf(n)}`)),
  );
  add(
    "Payments & invoices",
    D.payments
      .filter((p) =>
        has(
          p.zoho_name,
          p.invoice_number,
          p.payment_date,
          fmtDate(p.payment_date),
          Number(p.amount).toFixed(2),
          p.payment_mode,
        ),
      )
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
      .map((p) =>
        item(
          "name",
          p.zoho_name,
          `${fmtDate(p.payment_date)} · ${p.zoho_name}`,
          `${p.invoice_number || ""} · ${fmt(p.amount)}`,
        ),
      ),
  );
  add(
    "Imports",
    D.batches
      .filter((b) =>
        has(
          b.file_name,
          REPORT_LABEL[b.report_type],
          b.report_type,
          b.id,
          b.notes,
          b.imported_by_email,
          b.period_start,
          b.period_end,
          fmtDate(b.period_start || b.as_of_date || ""),
        ),
      )
      .map((b) =>
        item(
          "import",
          b.id,
          `#${b.id} ${REPORT_LABEL[b.report_type] || b.report_type}`,
          b.file_name || "initial load",
        ),
      ),
  );
  box.innerHTML = groups.length
    ? groups.join("")
    : `<div class="sr-group">No matches</div>`;
  box.style.display = "block";
}

// ---------------- Record a payment (the "Paid" button) ----------------
function openPaymentModal(displayName) {
  const rows = openBalances.filter((r) => displayNameOf(r) === displayName);
  if (!rows.length) {
    showToast("Nothing outstanding for " + displayName);
    return;
  }
  const totalC = rows.reduce((s, r) => s + cents(r.outstanding_balance), 0);
  const snapC = rows.reduce((s, r) => s + cents(r.snapshot_balance), 0);
  const paidC = rows.reduce((s, r) => s + cents(r.paid_since_snapshot), 0);
  const total = totalC / 100;
  gmOpen(`
      <div class="modal-rank">Record a payment</div>
      <h3>${esc(displayName)}</h3>
      <div class="modal-row"><span class="k">Outstanding now</span><span class="v red-text">${fmt(total)}</span></div>
      <div class="pay-options">
        <button type="button" class="pay-opt active" data-mode="full">Full balance<small>${fmt(total)}</small></button>
        <button type="button" class="pay-opt" data-mode="part">Part of it<small>enter an amount</small></button>
      </div>
      <div id="pay-part-wrap" style="display:none;">
        <label class="field-label" for="pay-amount">Amount paid</label>
        <input class="field-input" id="pay-amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="${total}" placeholder="0.00">
      </div>
      <label class="field-label" for="pay-date">Paid on</label>
      <input class="field-input" id="pay-date" type="date" max="${businessDay()}" value="${businessDay()}">
      <label class="field-label" for="pay-note">Note (optional)</label>
      <input class="field-input" id="pay-note" type="text" placeholder="e.g. paid cash at the shop">
      <div class="pay-error" id="pay-error"></div>
      <div class="pay-note">Zoho showed ${fmt(snapC / 100)} owed as of ${fmtDate(rows[0].as_of_date)}${paidC ? `; ${fmt(paidC / 100)} already recorded here since` : ""}. This only updates this dashboard: record the payment in Zoho too so your next export matches.</div>
      <div class="modal-actions"><button type="button" class="btn-ghost" id="pay-cancel">Cancel</button><button type="button" class="btn-solid" id="pay-confirm">Record payment</button></div>
    `);
  let mode = "full";
  const m = document.getElementById("gm-modal");
  m.querySelectorAll(".pay-opt").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      m.querySelectorAll(".pay-opt").forEach((x) =>
        x.classList.toggle("active", x === b),
      );
      document.getElementById("pay-part-wrap").style.display =
        mode === "part" ? "block" : "none";
      document.getElementById("pay-error").textContent = "";
      if (mode === "part") document.getElementById("pay-amount").focus();
    }),
  );
  document.getElementById("pay-cancel").addEventListener("click", gmClose);
  document.getElementById("pay-confirm").addEventListener("click", async () => {
    const err = document.getElementById("pay-error");
    let amountC = totalC;
    if (mode === "part") {
      amountC = cents(document.getElementById("pay-amount").value);
      if (!(amountC > 0)) {
        err.textContent = "Enter the amount that was paid.";
        return;
      }
      if (amountC > totalC) {
        err.textContent = `That's more than the ${fmt(total)} outstanding.`;
        return;
      }
    }
    const paidOn = document.getElementById("pay-date").value;
    if (!paidOn || paidOn <= rows[0].as_of_date || paidOn > businessDay()) {
      err.textContent =
        "Use a date after the balance snapshot and no later than today.";
      return;
    }
    const btn = document.getElementById("pay-confirm");
    btn.disabled = true;
    btn.textContent = "Saving…";
    // spread across this customer's balance rows, largest first
    let left = amountC;
    const inserts = [];
    for (const r of [...rows].sort(
      (a, b) => cents(b.outstanding_balance) - cents(a.outstanding_balance),
    )) {
      if (left <= 0) break;
      const take = Math.min(left, cents(r.outstanding_balance));
      inserts.push({
        balance_id: r.balance_id,
        amount: take / 100,
        paid_on: paidOn,
        note: (document.getElementById("pay-note").value || "").trim() || null,
      });
      left -= take;
    }
    const { data, error } = await sb
      .from("balance_payments")
      .insert(inserts)
      .select("id");
    if (error) {
      err.textContent = "Couldn't save: " + error.message;
      btn.disabled = false;
      btn.textContent = "Record payment";
      return;
    }
    const ids = data.map((d) => d.id);
    gmClose();
    closeModal();
    showToast(
      `Recorded ${fmt(amountC / 100)} from ${displayName}`,
      async () => {
        const { error: delErr } = await sb.rpc("void_payment", {
          p_ids: ids,
          p_reason: "Undone right after recording",
        });
        showToast(
          delErr
            ? "Couldn't undo: " + delErr.message
            : "Payment voided (it stays in the payment log).",
        );
        reloadAfterWrite();
      },
    );
    reloadAfterWrite();
  });
}

// ---------------- Modal ----------------
function setStoreModeRows(isStore) {
  [
    "row-revenue",
    "row-invoices",
    "row-payment",
    "row-avgorder",
    "row-share",
    "row-cadence",
  ].forEach(
    (id) =>
      (document.getElementById(id).style.display = isStore ? "flex" : "none"),
  );
  ["row-population", "row-majority", "row-notes"].forEach(
    (id) =>
      (document.getElementById(id).style.display = isStore ? "none" : "flex"),
  );
}

function openModal(store) {
  setStoreModeRows(true);
  document.getElementById("modal-rank").textContent =
    Number(store.total_revenue) > 0
      ? ordinal(store.revenue_rank) + " by revenue"
      : "No sales yet";
  document.getElementById("modal-name").textContent = store.store_name;
  document.getElementById("modal-revenue").textContent = fmt(
    store.total_revenue,
  );
  document.getElementById("modal-invoices").textContent = store.invoices;
  document.getElementById("modal-payment").textContent = fmtDate(
    store.last_payment_date,
  );
  const arRow = document.getElementById("modal-ar-row");
  if (store.outstanding_balance && Number(store.outstanding_balance) > 0) {
    arRow.style.display = "flex";
    document.getElementById("modal-ar").textContent = fmt(
      store.outstanding_balance,
    );
  } else arRow.style.display = "none";
  document.getElementById("modal-paid-btn").onclick = () =>
    openPaymentModal(store.store_name);
  document.getElementById("modal-history").innerHTML =
    customerHistoryHtml(store);
  document.getElementById("modal-avgorder").textContent =
    store.invoices > 0
      ? fmt(store.total_revenue / store.invoices)
      : "Not available";
  document.getElementById("modal-share").textContent =
    store.sharePct != null ? store.sharePct.toFixed(1) + "%" : "Not available";
  document.getElementById("modal-cadence").textContent = store.avgDaysBetween
    ? "~" + Math.round(store.avgDaysBetween) + " days"
    : "Not enough data yet";
  document.getElementById("modal-backdrop").classList.add("open");
}

function closeModal() {
  document.getElementById("modal-backdrop").classList.remove("open");
}
document.getElementById("modal-backdrop").addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

// ---------------- Auth (gates the entire dashboard now) ----------------
let authUserId = null;
let authEpoch = 0;
function clearWorkspace() {
  authEpoch++;
  authUserId = null;
  D = null;
  storeData = [];
  openBalances = [];
  uploadQueue = {};
  window.__owedNames = [];
  window.__rcOwed = [];
  window.__unresolved = [];
  window.__reviewed = [];
  document.getElementById("content").style.display = "none";
  document.getElementById("status").style.display = "none";
  document.getElementById("auth-gate").style.display = "block";
  document.getElementById("auth-badge").replaceChildren();
  document.getElementById("search-results").replaceChildren();
  document.getElementById("global-search").value = "";
  document.getElementById("upload-results").replaceChildren();
  gmClose();
  closeModal();
  hideToast();
  document.body.classList.remove("authenticated");
  if (typeof clearTerritories === "function") clearTerritories();
  document
    .querySelectorAll(".kpi .val")
    .forEach((el) => (el.textContent = "Not available"));
  for (const id of [
    "daily-priorities",
    "briefing-basis",
    "channel-composition",
    "owner-actions",
    "customer-directory",
    "ov-status",
    "ov-top",
    "ov-bottom",
    "ov-stale",
    "ov-owed",
    "store-tiles",
    "store-top-tiles",
    "store-attention-tiles",
    "product-top-tiles",
    "product-bottom-tiles",
    "product-all-rows",
    "zip-tiles",
    "route-tiles",
    "rc-owed",
    "rc-movement",
    "rc-log",
    "rc-recent",
    "rc-behavior",
    "history-status",
    "trend-cards",
    "trend-unavailable",
    "dq-warnings",
    "map-unresolved",
    "map-reviewed",
    "import-history",
    "modal-history",
  ])
    document.getElementById(id)?.replaceChildren();
  document.getElementById("gm-modal").replaceChildren();
  document.getElementById("modal-paid-btn").onclick = null;
}
async function applySession(session) {
  if (!session) {
    clearWorkspace();
    return;
  }
  if (authUserId === session.user.id) return;
  clearWorkspace();
  authUserId = session.user.id;
  const epoch = authEpoch;
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("status").style.display = "block";
  const badge = document.getElementById("auth-badge");
  const label = document.createElement("span");
  label.textContent = session.user.email;
  const button = document.createElement("button");
  button.textContent = "Sign out";
  button.addEventListener("click", signOut);
  badge.replaceChildren(label, button);
  document.body.classList.add("authenticated");
  await load(epoch);
}
async function signIn() {
  const button = document.getElementById("sign-in"),
    msg = document.getElementById("auth-msg");
  button.disabled = true;
  msg.textContent = "Signing in…";
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: document.getElementById("auth-email").value.trim(),
      password: document.getElementById("auth-password").value,
    });
    if (error) throw error;
    document.getElementById("auth-password").value = "";
    msg.textContent = "";
    await applySession(data.session);
  } catch (error) {
    msg.textContent = error.message || "Could not sign in. Try again.";
  } finally {
    button.disabled = false;
  }
}
async function signOut() {
  try {
    const { error } = await sb.auth.signOut();
    if (error) {
      showToast("Sign out failed. Please try again.");
      return;
    }
    clearWorkspace();
  } catch {
    showToast("Sign out failed. Please try again.");
  }
}
document.getElementById("auth-form").addEventListener("submit", (e) => {
  e.preventDefault();
  signIn();
});
sb.auth.onAuthStateChange((event, session) => {
  if (
    ["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(
      event,
    )
  ) {
    setTimeout(() => applySession(session).catch(showLoadError), 0);
  }
});
