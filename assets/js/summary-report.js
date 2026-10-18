"use strict";
const summaryPeriods = [
  [1, "1 month"],
  [3, "3 months"],
  [6, "6 months"],
  [12, "1 year"],
  ["yoy", "Year over year"],
];
let summarySelection = { period: 3, end: "" };
const reportDay = (date) => Date.parse(date + "T00:00:00Z") / 86400000;
const reportMonthEnd = (month) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
const reportInside = (r, s, e) =>
  r.period_start && r.period_end && r.period_start >= s && r.period_end <= e;
const reportOverlaps = (r, s, e) =>
  r.period_start && r.period_end && r.period_start <= e && r.period_end >= s;
function reportCoverage(periods, start, end) {
  const spans = periods
    .filter((p) => reportInside(p, start, end))
    .map((p) => [reportDay(p.period_start), reportDay(p.period_end)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  let overlap = false;
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1] + 1) {
      if (span[0] <= last[1]) overlap = true;
      last[1] = Math.max(last[1], span[1]);
    } else merged.push([...span]);
  }
  const days = merged.reduce((n, [a, b]) => n + b - a + 1, 0),
    totalDays = reportDay(end) - reportDay(start) + 1;
  return {
    days,
    totalDays,
    full: days === totalDays && !overlap,
    overlap,
    spans: merged,
  };
}
function reportSource(d, type, rows, start, end) {
  // Group by report period so allocations and product rows do not multiply coverage.
  const periods = new Map();
  for (const r of rows)
    if (r.period_start && r.period_end)
      periods.set(r.period_start + "|" + r.period_end, r);
  for (const b of d.batches || [])
    if (b.report_type === type && b.period_start && b.period_end)
      periods.set(b.period_start + "|" + b.period_end, b);
  const all = [...periods.values()],
    selected = rows.filter((r) => reportInside(r, start, end));
  const coverage = reportCoverage(all, start, end);
  const crossing = all.filter(
    (r) => reportOverlaps(r, start, end) && !reportInside(r, start, end),
  );
  const hasZero = all.some(
    (p) =>
      reportInside(p, start, end) &&
      p.source_total !== null &&
      p.source_total !== undefined &&
      Number(p.source_total) === 0,
  );
  const known = selected.length > 0 || hasZero;
  return {
    rows: selected,
    periods: all.filter((p) => reportInside(p, start, end)),
    crossing,
    coverage,
    known,
    value: known ? sumOf(selected, (r) => r.sales) : null,
  };
}
function reportWindow(d, start, end) {
  const wholesale = reportSource(
    d,
    "sales_customer",
    d.mappedRows || [],
    start,
    end,
  );
  const direct = reportSource(
    d,
    "festival_sales",
    d.festRows || [],
    start,
    end,
  );
  const products = reportSource(d, "sales_item", d.itemRows || [], start, end);
  const invoiceRows = new Map();
  for (const r of wholesale.rows)
    invoiceRows.set(
      r.id ?? r.zoho_name,
      r.source_invoice_count ?? r.invoice_count,
    );
  const invoices =
    wholesale.known &&
    [...invoiceRows.values()].every((n) => n !== null && n !== undefined)
      ? sumOf([...invoiceRows.values()], Number)
      : null;
  const customers = new Map();
  for (const r of wholesale.rows)
    if (r.mapped_store && r.mapped_store !== "Other")
      customers.set(
        r.mapped_store,
        (customers.get(r.mapped_store) || 0) + Number(r.sales),
      );
  const buyers = [...customers]
    .filter(([, sales]) => sales > 0)
    .sort((a, b) => b[1] - a[1]);
  const listedSales = sumOf(buyers, ([, v]) => v),
    estimated = wholesale.rows.some((r) => r.is_allocated);
  const payments = (d.payments || []).filter(
    (p) => p.payment_date >= start && p.payment_date <= end,
  );
  const paymentCoverage = reportCoverage(
    (d.batches || []).filter((b) => b.report_type === "payments_received"),
    start,
    end,
  );
  const snapshots = [
    ...new Set(
      (d.balances || [])
        .map((b) => b.as_of_date)
        .filter((date) => date && date <= end),
    ),
  ].sort();
  const snapshot = snapshots.at(-1) || null;
  const receivables = snapshot
    ? sumOf(
        d.balances.filter((b) => b.as_of_date === snapshot),
        (b) => b.outstanding_balance,
      )
    : null;
  return {
    start,
    end,
    wholesale,
    direct,
    products,
    invoices,
    averageInvoice: invoices > 0 ? wholesale.value / invoices : null,
    buyers,
    listedSales,
    estimated,
    concentration: listedSales > 0 ? (buyers[0][1] / listedSales) * 100 : null,
    total:
      wholesale.known || direct.known
        ? (wholesale.value || 0) + (direct.value || 0)
        : null,
    full:
      wholesale.known &&
      direct.known &&
      wholesale.coverage.full &&
      direct.coverage.full,
    payments,
    paymentCoverage,
    collected:
      payments.length || paymentCoverage.full
        ? sumOf(payments, (p) => p.amount)
        : null,
    snapshot,
    receivables,
  };
}
function buildSummaryReport(d, period = 3, endMonth) {
  if (!summaryPeriods.some(([key]) => String(key) === String(period)))
    throw Error("Choose a supported reporting period.");
  const latestCompleted = addMonths(businessDay().slice(0, 7), -1);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(endMonth) || endMonth > latestCompleted)
    throw Error("Choose a completed month for a fair comparison.");
  const n = period === "yoy" ? 12 : Number(period),
    startMonth = addMonths(endMonth, 1 - n);
  const start = startMonth + "-01",
    end = reportMonthEnd(endMonth);
  const previousEnd = addMonths(endMonth, period === "yoy" ? -12 : -n);
  const previousStart =
    addMonths(startMonth, period === "yoy" ? -12 : -n) + "-01";
  const current = reportWindow(d, start, end),
    previous = reportWindow(d, previousStart, reportMonthEnd(previousEnd));
  const comparisonLabel =
    period === "yoy"
      ? "same 12 months a year earlier"
      : "previous " + n + " " + (n === 1 ? "month" : "months");
  const compareCombined = current.full && previous.full;
  const comparable =
    compareCombined ||
    (current.wholesale.known &&
      previous.wholesale.known &&
      current.wholesale.coverage.full &&
      previous.wholesale.coverage.full);
  const currentValue = compareCombined
      ? current.total
      : current.wholesale.value,
    previousValue = compareCombined ? previous.total : previous.wholesale.value;
  const change = comparable ? currentValue - previousValue : null,
    changePct =
      comparable && previousValue > 0 ? (change / previousValue) * 100 : null;
  const changeScope = compareCombined
    ? "Combined reported sales"
    : "Wholesale sales";
  const strengths = [],
    notes = [];
  const add = (list, title, detail) => list.push({ title, detail });
  let headline = "A clearer baseline",
    assessment;
  if (comparable) {
    const subject = compareCombined ? "Sales" : "Wholesale sales";
    headline =
      change > 0
        ? `${subject} are growing`
        : change < 0
          ? `${subject} need attention`
          : `${subject} are holding steady`;
    assessment = `${changeScope} ${change > 0 ? "increased" : change < 0 ? "decreased" : "were unchanged"}${changePct !== null ? ` ${Math.abs(changePct).toFixed(1)}%` : ""} compared with the ${comparisonLabel}, moving from ${fmt(previousValue)} to ${fmt(currentValue)}. `;
    if (change > 0)
      add(
        strengths,
        "Sales growth",
        `${changeScope} increased ${fmt(change)}${changePct !== null ? ` (${changePct.toFixed(1)}%)` : ""} against a fully covered comparison period.`,
      );
    else if (change < 0)
      add(
        notes,
        "Investigate the sales decline",
        `${changeScope} fell ${fmt(-change)}. Review customer and product changes before choosing a response.`,
      );
    else
      add(
        notes,
        "Sales were unchanged",
        `${changeScope} matched the previous period. Review product mix and customer activity for changes beneath the total.`,
      );
  } else {
    headline =
      current.total === null
        ? "More detail is needed"
        : "Performance is not yet comparable";
    assessment =
      current.total === null
        ? `The available reports cannot isolate sales for ${fmtDate(start)} to ${fmtDate(end)}. `
        : `Reports wholly inside the selected period contain ${fmt(current.total)} in reported sales. `;
    assessment +=
      "Reporting coverage is insufficient for a like-for-like growth assessment. ";
    add(
      notes,
      "Complete the comparison period",
      `Growth is withheld until the selected period and its ${comparisonLabel} have complete, comparable source coverage.`,
    );
  }
  if (current.buyers.length)
    assessment += `${current.buyers.length} listed customer ${current.buyers.length === 1 ? "location has" : "locations have"} attributed wholesale sales${current.estimated ? ", including provisional location estimates" : ""}. `;
  if (current.snapshot)
    assessment += `The latest available receivables snapshot is ${fmt(current.receivables)} as of ${fmtDate(current.snapshot)}. `;
  assessment += "Profitability cannot yet be assessed from these reports.";
  if (current.wholesale.known && current.wholesale.value > 0)
    add(
      strengths,
      "Wholesale sales recorded",
      `${fmt(current.wholesale.value)} appears in ${current.wholesale.periods.length} wholesale reporting ${current.wholesale.periods.length === 1 ? "period" : "periods"} within this window. This establishes a reported sales baseline.`,
    );
  if (current.direct.known && current.direct.value > 0)
    add(
      strengths,
      "A separate direct sales channel",
      `${fmt(current.direct.value)} in Square gross item sales is recorded separately from wholesale, providing another channel to evaluate.`,
    );
  if (current.buyers.length >= 2 && !current.estimated)
    add(
      strengths,
      "Multiple purchasing relationships",
      `${current.buyers.length} listed customer locations have sales in the included reports. This is an observed count, not a retention measure.`,
    );
  if (current.collected > 0)
    add(
      strengths,
      "Collections recorded",
      `${fmt(current.collected)} in imported customer payments falls within the selected dates. Payments are collections and are not added to sales.`,
    );
  if (
    current.concentration !== null &&
    current.concentration < 30 &&
    current.buyers.length >= 5 &&
    !current.estimated
  )
    add(
      strengths,
      "Sales spread across listed customers",
      `The largest listed customer represents ${current.concentration.toFixed(1)}% of listed-customer sales. Unlisted buyers are excluded from this measure.`,
    );
  const productSales = new Map();
  for (const row of current.products.rows)
    productSales.set(
      row.item_name,
      (productSales.get(row.item_name) || 0) + Number(row.sales),
    );
  const soldProducts = [...productSales]
    .filter(([, sales]) => sales > 0)
    .sort((a, b) => b[1] - a[1]);
  if (soldProducts.length > 1)
    add(
      strengths,
      "Sales across the product portfolio",
      `${soldProducts.length} products have positive sales in the included item reports. ${soldProducts[0][0]} leads that report with ${fmt(soldProducts[0][1])} in sales. Product totals are not added again to wholesale.`,
    );
  const relevantBatches = (d.batches || []).filter((b) =>
    reportOverlaps(b, start, end),
  );
  if (
    relevantBatches.length &&
    relevantBatches.every((b) => b.reconciliation === "pass")
  )
    add(
      strengths,
      "Included report checks passed",
      `${relevantBatches.length} overlapping source imports reconciled to their printed totals. This is an import check, not an audit opinion.`,
    );
  const incomplete = [
    ...[
      ["Zoho wholesale", current.wholesale],
      ["Square direct", current.direct],
    ].filter(([, s]) => !s.coverage.full || !s.known),
  ];
  if (incomplete.length)
    add(
      notes,
      "Close reporting gaps",
      incomplete
        .map(
          ([label, s]) =>
            `${label}: ${s.coverage.days} of ${s.coverage.totalDays} days covered by usable whole reports${s.crossing.length ? `; ${s.crossing.length} report period crosses the selection boundary and is excluded` : ""}`,
        )
        .join(". ") + ". Missing days are not treated as zero sales.",
    );
  if (current.estimated)
    add(
      notes,
      "Confirm estimated customer locations",
      "Some customer sales use an owner-approved provisional split. It preserves source totals but affects purchasing-location counts, rankings, and concentration.",
    );
  if (current.concentration >= 30)
    add(
      notes,
      "Review customer concentration",
      `${current.buyers[0][0]} contributes ${current.concentration.toFixed(1)}% of listed-customer sales${current.estimated ? ", including estimates" : ""}. Maintain that relationship while developing others.`,
    );
  if (current.snapshot && reportDay(end) - reportDay(current.snapshot) > 0)
    add(
      notes,
      "Refresh the receivables position",
      `The snapshot is dated ${fmtDate(current.snapshot)}, ${reportDay(end) - reportDay(current.snapshot)} days before the selected period ends. It is not a period-end or overdue balance.`,
    );
  if (!current.snapshot)
    add(
      notes,
      "Add a receivables snapshot",
      "No balance snapshot exists on or before the selected period end. A current balance cannot be substituted into this historical report.",
    );
  if (current.direct.known)
    add(
      notes,
      "Reconcile direct sales deductions",
      "Square figures represent gross item sales. Discounts, refunds, tax, and processing fees must be reconciled before assessing net sales or cash.",
    );
  add(
    notes,
    "Establish profitability inputs",
    "Current reference unit costs can support pricing decisions. Historical costs, discounts, freight, returns, and operating expenses are needed before reporting business profit.",
  );
  const metrics = [
    {
      label: "Reported sales",
      value: current.total === null ? "Not available" : fmt(current.total),
      detail: current.full
        ? "Both channels have full period coverage"
        : "Available whole reports only; coverage is incomplete",
    },
    {
      label: "Sales change",
      value:
        changePct !== null
          ? `${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%`
          : change !== null
            ? fmt(change)
            : "Not comparable",
      detail: comparable
        ? `${changeScope} vs ${comparisonLabel}`
        : "Complete matching periods are required",
    },
    {
      label: "Wholesale invoices",
      value:
        current.invoices === null ? "Not available" : String(current.invoices),
      detail:
        current.averageInvoice !== null
          ? `${fmt(current.averageInvoice)} average invoice value`
          : "Source invoice counts, counted once",
    },
    {
      label: "Purchasing locations",
      value: current.wholesale.known
        ? String(current.buyers.length)
        : "Not available",
      detail: current.estimated
        ? "Listed locations; includes provisional estimates"
        : "Listed customers with positive attributed sales",
    },
    {
      label: "Payments received",
      value:
        current.collected === null ? "Not available" : fmt(current.collected),
      detail: current.paymentCoverage.full
        ? "Imported payment report covers the full period"
        : "Recorded imported payments; coverage may be incomplete",
    },
    {
      label: "Receivables snapshot",
      value:
        current.receivables === null
          ? "Not available"
          : fmt(current.receivables),
      detail: current.snapshot
        ? `As of ${fmtDate(current.snapshot)}; not an overdue measure`
        : "No historical snapshot available",
    },
    {
      label: "Customer concentration",
      value:
        current.concentration === null
          ? "Not available"
          : `${current.concentration.toFixed(1)}%`,
      detail: current.estimated
        ? "Largest listed customer share; includes estimates"
        : "Largest listed customer share of listed wholesale sales",
    },
    {
      label: "Reported product units",
      value: current.products.known
        ? sumOf(
            current.products.rows,
            (row) => row.quantity_sold,
          ).toLocaleString()
        : "Not available",
      detail: current.products.known
        ? `${soldProducts.length} products with sales in included wholesale item reports`
        : "Whole product reports inside the selection are required",
    },
  ];
  return {
    period,
    endMonth,
    start,
    end,
    previousStart,
    previousEnd: previous.end,
    comparisonLabel,
    current,
    previous,
    comparable,
    change,
    changePct,
    headline,
    assessment,
    strengths: strengths.slice(0, 5),
    notes: notes.slice(0, 5),
    metrics,
  };
}
function summaryReportHtml(r) {
  const pointList = (items, empty) =>
    items.length
      ? `<ol>${items.map((p) => `<li><b>${esc(p.title)}</b><p>${esc(p.detail)}</p></li>`).join("")}</ol>`
      : `<p class="summary-empty">${empty}</p>`;
  const channels = [
    ["Zoho wholesale", r.current.wholesale],
    ["Square direct", r.current.direct],
  ];
  return `<header class="summary-brand"><div><strong>ANTARI</strong><span>A TASTE OF ARMENIA · NEW YORK</span></div><div><b>Business summary</b><span>${esc(summaryPeriods.find(([p]) => String(p) === String(r.period))[1])}</span></div></header>
    <section class="summary-opening"><span class="eyebrow">${esc(fmtDate(r.start))} to ${esc(fmtDate(r.end))}</span><h1>${esc(r.headline)}</h1><p>${esc(r.assessment)}</p><span class="summary-status ${r.comparable ? "ready" : ""}">${r.comparable ? "Comparable reporting periods" : "Coverage limits apply"}</span></section>
    <div class="summary-kpis">${r.metrics.map((m) => `<section><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong><small>${esc(m.detail)}</small></section>`).join("")}</div>
    <section class="summary-channel"><div class="summary-section-title"><h2>Sales & reporting coverage</h2><span>Each source is counted once</span></div>${channels.map(([name, s]) => `<div class="summary-channel-row"><span><b>${name}</b><small>${s.coverage.days} / ${s.coverage.totalDays} days of usable coverage</small></span><div class="summary-meter" role="img" aria-label="${esc(name)} reporting coverage ${s.coverage.days} of ${s.coverage.totalDays} days"><i style="width:${Math.min(100, (s.coverage.days / s.coverage.totalDays) * 100)}%"></i></div><strong>${s.value === null ? "Not available" : fmt(s.value)}</strong></div>`).join("")}<p class="summary-source-note">Comparison: ${fmtDate(r.previousStart)} to ${fmtDate(r.previousEnd)}. Whole report periods are used; multi-month totals are never divided into invented monthly figures.</p></section>
    <div class="summary-findings"><section><span class="eyebrow">WHAT IS WORKING</span><h2>Strengths supported by the records</h2>${pointList(r.strengths, "There is not enough evidence to identify a business strength for this selection. Add reports for these dates to build an assessment.")}${r.strengths.length < 5 ? '<p class="summary-source-note">Fewer than five strengths are shown because the records do not support five distinct conclusions.</p>' : ""}</section><section><span class="eyebrow">WHERE TO FOCUS</span><h2>Improvements & key observations</h2>${pointList(r.notes, "No additional observations are supported for this selection.")}</section></div>
    <footer class="summary-footer"><span>OWNER MANAGEMENT REPORT · ${fmtDate(businessDay())}</span><p>Prepared from reports loaded into Antari. All business types are included. Square figures are gross item sales; deductions require reconciliation. Snapshot balances are dated separately. Field sale drafts are excluded from financial totals. This management report is not audited financial statements.</p>${isPreview ? "<b>Design preview. All figures and customer names are fictional.</b>" : ""}</footer>`;
}
function openSummaryReport() {
  if (!D) return;
  const latestCompleted = addMonths(businessDay().slice(0, 7), -1);
  if (!summarySelection.end || summarySelection.end > latestCompleted)
    summarySelection.end = latestCompleted;
  gmOpen(
    `<div class="summary-toolbar"><div><span class="modal-rank">OWNER REPORTING</span><h3>Summary report</h3></div><button class="btn-ghost" data-action="gmClose" aria-label="Close summary report">Close</button></div><div class="summary-controls"><div class="summary-periods" role="group" aria-label="Summary report period">${summaryPeriods.map(([p, label]) => `<button data-summary-period="${p}" aria-pressed="${String(p) === String(summarySelection.period)}">${label}</button>`).join("")}</div><label>Through month<input id="summary-end" type="month" value="${summarySelection.end}" max="${latestCompleted}" min="2000-01"/></label><button class="btn-solid" id="summary-print">Print / Save PDF</button></div><p class="summary-controls-note">Uses completed calendar months. Year over year compares 12 months with the same 12 months a year earlier.</p><p id="summary-error" class="pay-error" role="alert"></p><article id="summary-paper" class="summary-paper"></article>`,
    true,
  );
  document.getElementById("gm-modal").classList.add("summary-dialog");
  const render = () => {
    const error = document.getElementById("summary-error");
    try {
      const report = buildSummaryReport(
        D,
        summarySelection.period,
        summarySelection.end,
      );
      document.getElementById("summary-paper").innerHTML =
        summaryReportHtml(report);
      error.textContent = "";
      document.getElementById("summary-print").disabled = false;
    } catch (e) {
      error.textContent = e.message;
      document.getElementById("summary-print").disabled = true;
      document.getElementById("summary-paper").replaceChildren();
    }
  };
  document.querySelectorAll("[data-summary-period]").forEach((b) =>
    b.addEventListener("click", () => {
      summarySelection.period = b.dataset.summaryPeriod;
      document
        .querySelectorAll("[data-summary-period]")
        .forEach((p) => p.setAttribute("aria-pressed", String(p === b)));
      render();
    }),
  );
  document.getElementById("summary-end").addEventListener("change", (e) => {
    summarySelection.end = e.target.value;
    render();
  });
  document
    .getElementById("summary-print")
    .addEventListener("click", () => window.print());
  render();
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-summary-report]")) openSummaryReport();
});
