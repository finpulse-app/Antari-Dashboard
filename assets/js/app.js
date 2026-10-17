"use strict";
// ---------------- v14 wiring (delegated clicks, search) ----------------
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) {
    const tab = document.querySelector(`.tab[data-tab="${g.dataset.goto}"]`);
    if (tab) tab.click();
  }
  if (!e.target.closest(".searchbar"))
    document.getElementById("search-results").style.display = "none";
});
document.getElementById("trend-cards").addEventListener("click", (e) => {
  const a = e.target.closest("a.src");
  if (a && a.dataset.src) openMonthDetail(a.dataset.src, a.dataset.month);
});
document.getElementById("ov-status").addEventListener("click", (e) => {
  const a = e.target.closest("a.src");
  if (a && a.dataset.src) openMonthDetail(a.dataset.src, a.dataset.month);
});
document.getElementById("open-report").addEventListener("click", () => {
  if (D) openMonthlyReport();
});
document.getElementById("rc-owed").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay]");
  if (b) openPaymentModal(window.__rcOwed[Number(b.dataset.pay)]);
});
document.getElementById("rc-log").addEventListener("click", (e) => {
  const b = e.target.closest("[data-void]");
  if (b) openVoidModal(b.dataset.void);
});
document
  .getElementById("map-unresolved")
  .addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const row = b.closest(".map-row"),
      name = row ? window.__unresolved[Number(row.dataset.i)] : null;
    if (b.dataset.act === "match") openMatchDialog(name);
    else if (b.dataset.act === "new") openNewCustomerDialog(name);
    else if (b.dataset.act === "other") {
      const error = await saveMapping([
        {
          zoho_name: cleanName(name),
          mapped_store: "Other",
          notes: "Left as Other in the mapping workspace",
          reviewed: true,
        },
      ]);
      if (error) showToast("Couldn't save: " + error.message);
      else {
        showToast(`${name} left as Other.`);
        load();
      }
    } else if (b.dataset.act === "all-other") {
      const names = window.__unresolved,
        f = names.reduce((s, n) => s + nameFacts(n).sales, 0);
      gmOpen(`<div class="modal-rank">Leave as Other</div><h3>${names.length} names</h3><div class="pay-note" style="margin-top:0;font-size:13px;">These ${names.length} Zoho names (${fmt(f)} of sales) will stay grouped as Other and stop appearing here. You can change any of them later under "Names already decided".</div>
        <div class="modal-actions"><button type="button" class="btn-ghost" id="ao-cancel">Cancel</button><button type="button" class="btn-solid" id="ao-confirm">Leave all as Other</button></div>`);
      document.getElementById("ao-cancel").addEventListener("click", gmClose);
      document
        .getElementById("ao-confirm")
        .addEventListener("click", async () => {
          const error = await saveMapping(
            names.map((n) => ({
              zoho_name: cleanName(n),
              mapped_store: "Other",
              notes: "Left as Other in the mapping workspace",
              reviewed: true,
            })),
          );
          if (error) {
            showToast("Couldn't save: " + error.message);
            return;
          }
          gmClose();
          showToast(`${names.length} names left as Other.`);
          load();
        });
    }
  });
document.getElementById("map-reviewed").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rv]");
  if (b) openMatchDialog(window.__reviewed[Number(b.dataset.rv)]);
});
let searchTimer = null;
document.getElementById("global-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => runSearch(v), 120);
});
document.getElementById("search-results").addEventListener("click", (e) => {
  const it = e.target.closest(".sr-item");
  if (!it || !D) return;
  const kind = it.dataset.kind,
    key = it.dataset.key;
  document.getElementById("search-results").style.display = "none";
  if (kind === "customer") openModal(D.storeData[Number(key)]);
  else if (kind === "product") openProductModal(D.sortedProducts[Number(key)]);
  else if (kind === "name") openNameModal(key);
  else if (kind === "import") {
    document.querySelector('.tab[data-tab="upload"]').click();
  }
});

const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("click", () =>
  document.getElementById("file-input").click(),
);
document.getElementById("file-input").addEventListener("change", (e) => {
  handleFiles(e.target.files);
  e.target.value = "";
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  handleFiles(e.dataTransfer.files);
});

// ---------------- Main dashboard load ----------------
let loadInFlight = null;
function load(epoch = authEpoch) {
  if (loadInFlight && loadInFlight.epoch === epoch) return loadInFlight.promise;
  const promise = loadDashboard(epoch).finally(() => {
    if (loadInFlight?.promise === promise) loadInFlight = null;
  });
  loadInFlight = { epoch, promise };
  return promise;
}
async function loadDashboard(epoch) {
  const refresh = document.getElementById("refresh-data");
  refresh.disabled = true;
  try {
    // Each query is named, and results are read back BY NAME: so a reordering typo can't scramble the data again.
    const queries = {
      prospects: () => sb.from("territory_prospects").select("*"),
      followups: () => sb.from("customer_followups").select("*"),
      scenarios: () => sb.from("territory_scenarios").select("*"),
      initiatives: () => sb.from("territory_initiatives").select("*"),
      visitNotes: () =>
        sb
          .from("customer_visit_notes")
          .select(
            "id,store_name,note,created_at,recorded_by_email,activity_kind,product,quantity,quantity_unit,discount_pct,discount_reason,unit_price,sale_on",
          ),
      storeRank: () =>
        sb.from("v_store_ranking").select("*").order("revenue_rank"),
      prodRank: () =>
        sb.from("v_product_ranking").select("*").order("revenue_rank"),
      ar: () => sb.from("v_accounts_receivable").select("*"),
      zip: () => sb.from("v_zip_ranking").select("*").order("revenue_rank"),
      route: () => sb.from("v_route_summary").select("*"),
      channel: () => sb.from("v_channel_summary").select("*"),
      other: () => sb.from("v_other_bucket").select("*"),
      stores: () =>
        sb
          .from("stores")
          .select(
            "store_name,zip,delivery_route,category,contact_name,phone_email,notes",
          ),
      monthlyW: () => sb.from("v_monthly_wholesale").select("*"),
      monthlyF: () => sb.from("v_monthly_festival").select("*"),
      monthlyAR: () => sb.from("v_monthly_ar").select("*"),
      monthlyPay: () => sb.from("v_monthly_payments").select("*"),
      demo: () => sb.from("zip_demographics").select("*"),
      ancestry: () => sb.from("zip_ancestry").select("*"),
      payMapped: () =>
        sb
          .from("v_payments_mapped")
          .select(
            "id,payment_date,mapped_store,zoho_name,amount,invoice_number,payment_mode",
          ),
      mappedRows: () =>
        sb
          .from("v_sales_customer_mapped")
          .select(
            "id,zoho_name,mapped_store,sales,invoice_count,period_start,period_end,import_batch_id",
          ),
      openBal: () => sb.from("v_open_balances").select("*"),
      itemRows: () =>
        sb
          .from("sales_item")
          .select(
            "id,item_name,sku,quantity_sold,sales,period_start,period_end",
          ),
      festRows: () =>
        sb.from("festival_sales").select("id,period_start,period_end"),
      srcMonths: () => sb.from("v_source_months").select("*"),
      custMonths: () => sb.from("v_customer_months").select("*"),
      prodMonths: () => sb.from("v_product_months").select("*"),
      balancesAll: () =>
        sb
          .from("customer_balances")
          .select("id,as_of_date,zoho_name,outstanding_balance"),
      payLog: () =>
        sb
          .from("v_payment_log")
          .select("*")
          .order("created_at", { ascending: false }),
      unresolved: () => sb.from("v_unresolved_names").select("*"),
      mappingAll: () => sb.from("name_mapping").select("*"),
      batches: () =>
        sb
          .from("import_batches")
          .select("*")
          .order("imported_at", { ascending: false }),
    };
    const orderKeys = {
      prospects: ["id"],
      followups: ["id"],
      scenarios: ["id"],
      initiatives: ["id"],
      visitNotes: ["id"],
      storeRank: ["store_name"],
      prodRank: ["item_name"],
      ar: ["store_name"],
      zip: ["zip"],
      route: ["delivery_route"],
      channel: ["channel"],
      stores: ["store_name"],
      monthlyW: ["month"],
      monthlyF: ["month"],
      monthlyAR: ["as_of_date"],
      monthlyPay: ["month"],
      demo: ["zip"],
      ancestry: ["id"],
      payMapped: ["id"],
      mappedRows: ["id"],
      openBal: ["balance_id"],
      itemRows: ["id"],
      festRows: ["id"],
      srcMonths: ["source", "month"],
      custMonths: ["customer", "month"],
      prodMonths: ["item_name", "month"],
      balancesAll: ["id"],
      payLog: ["id"],
      unresolved: ["zoho_name"],
      mappingAll: ["zoho_name"],
      batches: ["id"],
    };
    const entries = Object.entries(queries),
      R = {};
    // Four parallel queries keep the database responsive on mobile connections.
    for (let i = 0; i < entries.length; i += 4) {
      await Promise.all(
        entries.slice(i, i + 4).map(async ([name, factory]) => {
          R[name] = {
            data: await fetchAllRows(factory, orderKeys[name] || []),
          };
        }),
      );
      if (epoch !== authEpoch || !authUserId) return;
    }
    const access = await sb.rpc("is_owner");
    if (epoch !== authEpoch || !authUserId) return;
    if (access.error || access.data !== true)
      throw new Error(
        "This account has no owner access. Contact the workspace owner.",
      );
    const {
      storeRank,
      prodRank,
      ar,
      zip,
      route,
      channel,
      other,
      stores,
      monthlyW,
      monthlyF,
      monthlyAR,
      monthlyPay,
      demo,
      ancestry,
      payMapped,
      mappedRows,
      openBal,
      itemRows,
      festRows,
      srcMonths,
      custMonths,
      prodMonths,
      balancesAll,
      payLog,
      unresolved,
      mappingAll,
      batches,
    } = R;
    openBalances = openBal.data;

    const wholesale = Number(
      channel.data.find((c) => c.channel === "Wholesale")?.net_revenue || 0,
    );
    const direct = Number(
      channel.data.find((c) => c.channel === "Direct / Festival")
        ?.net_revenue || 0,
    );
    const arTotal = ar.data.reduce(
      (s, r) => s + Number(r.outstanding_balance),
      0,
    );
    const o = other.data[0] || { total_revenue: 0, invoices: 0 };

    document.getElementById("kpi-total").textContent = fmtCompact(
      wholesale + direct,
    );
    document.getElementById("kpi-wholesale").textContent =
      fmtCompact(wholesale);
    document.getElementById("kpi-direct").textContent = fmtCompact(direct);
    document.getElementById("kpi-ar").textContent = fmtCompact(arTotal);
    document.getElementById("kpi-other").textContent = fmtCompact(
      o.total_revenue,
    );

    // ---------------- Overview: your real customers = stores + restaurants. Everyone else is "Other" and is never ranked. ----------------
    const nameOf = displayNameOf;
    const categoryOf = Object.fromEntries(
      stores.data.map((s) => [s.store_name, s.category]),
    );
    const custMap = Object.create(null);
    for (const r of mappedRows.data) {
      const n = nameOf(r);
      const c =
        custMap[n] ||
        (custMap[n] = {
          name: n,
          revenue: 0,
          invoices: 0,
          listed: r.mapped_store !== "Other",
          category: categoryOf[n] || "",
        });
      c.revenue += Number(r.sales);
      c.invoices += Number(r.invoice_count);
    }
    const allBuyers = Object.values(custMap);
    const customers = allBuyers.filter((c) => c.listed); // stores + restaurants that bought in this period
    const otherBuyers = allBuyers.filter((c) => !c.listed); // individuals / one-offs: summarized, never ranked
    const salesStarts = mappedRows.data
      .map((r) => r.period_start)
      .filter(Boolean)
      .sort();
    const salesEnds = mappedRows.data
      .map((r) => r.period_end)
      .filter(Boolean)
      .sort();
    const salesSpanDays = salesStarts.length
      ? Math.round(
          (parseYmd(salesEnds[salesEnds.length - 1]) -
            parseYmd(salesStarts[0])) /
            86400000,
        ) + 1
      : null;
    const invoiceText = (c) =>
      `${c.category ? esc(c.category) + " · " : ""}${c.invoices} invoice${c.invoices === 1 ? "" : "s"}${salesSpanDays ? ` in ${salesSpanDays} days` : ""}`;
    const unlistedTag = (c) =>
      c.listed ? "" : `<span class="tag-unlisted">other buyer</span>`;
    const ovRow = (c, sub, valueHtml) =>
      `<div class="ov-row"><div class="ov-line"><span class="ov-name">${esc(c.name)}${unlistedTag(c)}</span><span class="ov-val">${valueHtml}</span></div>${sub ? `<div class="ov-sub">${sub}</div>` : ""}</div>`;
    const emptyNote = (txt) => `<div class="empty-note">${txt}</div>`;

    const byRev = [...customers].sort((a, b) => b.revenue - a.revenue);
    const topN = byRev.slice(0, 5);
    const bottomN = byRev.slice(topN.length).slice(-5).reverse(); // never repeats someone already in the top list
    document.getElementById("ov-top-label").textContent = topN.length
      ? `Top ${topN.length} customers`
      : "Top customers";
    document.getElementById("ov-bottom-label").textContent = bottomN.length
      ? `Bottom ${bottomN.length} customers`
      : "Bottom customers";
    document.getElementById("ov-top").innerHTML =
      topN.map((c) => ovRow(c, invoiceText(c), fmt(c.revenue))).join("") ||
      emptyNote("No store or restaurant purchases loaded yet.");
    document.getElementById("ov-bottom").innerHTML =
      bottomN.map((c) => ovRow(c, invoiceText(c), fmt(c.revenue))).join("") ||
      emptyNote("Not enough customers yet to show a separate bottom list.");

    const lastPaidBy = Object.create(null);
    for (const p of payMapped.data) {
      const n = nameOf(p);
      if (!lastPaidBy[n] || p.payment_date > lastPaidBy[n])
        lastPaidBy[n] = p.payment_date;
    }
    const stale = customers
      .filter((c) => lastPaidBy[c.name])
      .map((c) => ({
        ...c,
        last: lastPaidBy[c.name],
        days: daysSince(lastPaidBy[c.name]),
      }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 5);
    document.getElementById("ov-stale").innerHTML =
      stale
        .map((c) =>
          ovRow(
            c,
            `Last paid ${fmtDate(c.last)} · ${fmt(c.revenue)} total`,
            `${c.days} days ago`,
          ),
        )
        .join("") || emptyNote("No payment history yet.");

    // Money owed is shown for EVERYONE (including other buyers): an unpaid balance matters whoever owes it.
    const owedMap = Object.create(null);
    for (const r of openBalances) {
      const n = nameOf(r);
      const x =
        owedMap[n] ||
        (owedMap[n] = {
          name: n,
          cents: 0,
          listed: r.mapped_store !== "Other",
        });
      x.cents += cents(r.outstanding_balance);
    }
    const owedList = Object.values(owedMap).sort((a, b) => b.cents - a.cents);
    window.__owedNames = owedList.map((x) => x.name);
    document.getElementById("ov-owed").innerHTML =
      owedList
        .map((x, i) =>
          ovRow(
            x,
            "",
            `<span class="red-text">${fmt(x.cents / 100)}</span><button type="button" class="paid-btn" data-pay="${i}">Paid</button>`,
          ),
        )
        .join("") || emptyNote("Nothing owed to you right now.");
    document.getElementById("ov-owed").onclick = (e) => {
      const b = e.target.closest("[data-pay]");
      if (b) openPaymentModal(window.__owedNames[Number(b.dataset.pay)]);
    };

    const noSalesCount = storeRank.data.filter(
      (s) => Number(s.total_revenue) === 0,
    ).length;
    document.getElementById("ov-footnote").textContent =
      `Rankings include only your ${stores.data.length} stores and restaurants, as named in Zoho, ${salesStarts.length ? fmtDate(salesStarts[0]) + " to " + fmtDate(salesEnds[salesEnds.length - 1]) : "no period loaded"}. ` +
      `Not ranked: ${otherBuyers.length} other buyers (individuals and one-time purchases) with ${fmt(otherBuyers.reduce((s, c) => s + c.revenue, 0))} in sales. ` +
      `${noSalesCount} of your ${stores.data.length} customers had no purchases in this period: see the Customers tab. ` +
      `Payment dates describe collections, not purchase dates. Invoice-level data is needed for reorder and overdue insights.`;

    const storeMeta = Object.fromEntries(
      stores.data.map((s) => [s.store_name, s]),
    );
    const arMap = Object.fromEntries(
      ar.data.map((a) => [a.store_name, a.outstanding_balance]),
    );

    // cadence: avg days between payments, per store
    const paysByStore = Object.create(null);
    for (const p of payMapped.data) {
      if (!paysByStore[p.mapped_store]) paysByStore[p.mapped_store] = [];
      paysByStore[p.mapped_store].push(p.payment_date);
    }
    const cadenceByStore = Object.create(null);
    for (const [store, dates] of Object.entries(paysByStore)) {
      const sorted = [...new Set(dates)].map(parseYmd).sort((a, b) => a - b);
      if (sorted.length < 2) continue;
      let totalGap = 0;
      for (let i = 1; i < sorted.length; i++)
        totalGap += (sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24);
      cadenceByStore[store] = totalGap / (sorted.length - 1);
    }

    const totalWholesale = storeRank.data.reduce(
      (s, r) => s + Number(r.total_revenue),
      0,
    );

    storeData = storeRank.data.map((s) => ({
      ...s,
      zip: storeMeta[s.store_name]?.zip,
      delivery_route: storeMeta[s.store_name]?.delivery_route,
      category: storeMeta[s.store_name]?.category,
      outstanding_balance: arMap[s.store_name] || 0,
      avgDaysBetween: cadenceByStore[s.store_name] ?? null,
      sharePct:
        totalWholesale > 0
          ? (Number(s.total_revenue) / totalWholesale) * 100
          : 0,
    }));

    function renderStoreTile(s, i) {
      const zero = Number(s.total_revenue) === 0;
      const owes = Number(s.outstanding_balance) > 0;
      return `<div class="tile ${zero ? "zero" : ""}" data-customer="${esc(s.store_name)}">
          <div class="rank">${zero ? "" : "#" + s.revenue_rank}</div>
          <p class="name">${esc(s.store_name)}</p>
          <div class="revenue">${fmtCompact(s.total_revenue)}</div>
          <div class="sub">${s.category ? esc(s.category) + " · " : ""}${s.invoices} invoice${s.invoices === 1 ? "" : "s"}</div>
          ${owes ? `<div class="owes">Owes ${fmt(s.outstanding_balance)}</div>` : ""}
        </div>`;
    }

    document.getElementById("store-tiles").innerHTML = storeData
      .map((s, i) => renderStoreTile(s, i))
      .join("");

    const byRevenueDesc = storeData
      .map((s, i) => ({ ...s, _i: i }))
      .sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue));
    const topStores = byRevenueDesc.slice(0, 5);
    // "Needs attention": zero-revenue stores first, then longest-since-payment among the rest
    const zeroRevenue = byRevenueDesc.filter(
      (s) => Number(s.total_revenue) === 0,
    );
    const withGap = byRevenueDesc
      .filter(
        (s) =>
          Number(s.total_revenue) > 0 &&
          s.avgDaysBetween == null &&
          s.last_payment_date,
      )
      .sort(
        (a, b) => new Date(a.last_payment_date) - new Date(b.last_payment_date),
      );
    const attentionStores = [...zeroRevenue, ...withGap].slice(0, 5);
    document.getElementById("store-top-tiles").innerHTML = topStores
      .map((s) => renderStoreTile(s, s._i))
      .join("");
    document.getElementById("store-attention-tiles").innerHTML =
      attentionStores.length
        ? attentionStores.map((s) => renderStoreTile(s, s._i)).join("")
        : `<p style="color:var(--muted);font-size:13px;">Nothing needs attention right now.</p>`;
    window.toggleAllStores = function (showAll) {
      document.getElementById("stores-top-bottom").style.display = showAll
        ? "none"
        : "block";
      document.getElementById("stores-all-view").style.display = showAll
        ? "block"
        : "none";
    };

    // ---------------- Products: Top 5 / Bottom 5 / All: tap any product for its trend ----------------
    const sortedProducts = [...prodRank.data].sort(
      (a, b) => Number(b.total_revenue) - Number(a.total_revenue),
    );
    const topProducts = sortedProducts.slice(0, 5);
    const bottomProducts = sortedProducts.slice(-5).reverse();
    const productTile = (
      p,
    ) => `<div class="tile" data-prod="${sortedProducts.indexOf(p)}"><div class="rank">#${p.revenue_rank}</div><p class="name">${esc(p.item_name)}</p>
        <div class="revenue">${fmtCompact(p.total_revenue)}</div><div class="sub">${Number(p.units_sold).toLocaleString()} units</div></div>`;
    document.getElementById("product-top-tiles").innerHTML = topProducts
      .map(productTile)
      .join("");
    document.getElementById("product-bottom-tiles").innerHTML = bottomProducts
      .map(productTile)
      .join("");
    document.getElementById("product-all-rows").innerHTML = sortedProducts
      .map(
        (p, i) => `
        <tr data-prod="${i}" style="cursor:pointer;"><td>${esc(p.item_name)}</td><td class="num">${Number(p.units_sold).toLocaleString()}</td><td class="num">${fmt(p.total_revenue)}</td></tr>`,
      )
      .join("");
    window.toggleAllProducts = function (showAll) {
      document.getElementById("products-top-bottom").style.display = showAll
        ? "none"
        : "block";
      document.getElementById("products-all-view").style.display = showAll
        ? "block"
        : "none";
    };
    document.getElementById("panel-products").onclick = (e) => {
      const el = e.target.closest("[data-prod]");
      if (el) openProductModal(sortedProducts[Number(el.dataset.prod)]);
    };

    // Per-product history, grouped by the reporting period each upload covers
    const periodsOf = Object.create(null);
    for (const r of itemRows.data) {
      const byP =
        periodsOf[r.item_name] ||
        (periodsOf[r.item_name] = Object.create(null));
      const key = r.period_start + "|" + r.period_end;
      const p =
        byP[key] ||
        (byP[key] = {
          start: r.period_start,
          end: r.period_end,
          units: 0,
          sales: 0,
        });
      p.units += Number(r.quantity_sold);
      p.sales += Number(r.sales);
    }
    const itemEnds = itemRows.data
      .map((r) => r.period_end)
      .filter(Boolean)
      .sort();
    const itemAnchor = itemEnds.length ? itemEnds[itemEnds.length - 1] : null;
    const spanDaysOf = (s, e) =>
      Math.round((parseYmd(e) - parseYmd(s)) / 86400000) + 1;

    function productMonthly(name) {
      const lumps = [];
      for (const p of Object.values(periodsOf[name] || {})) {
        if (spanDaysOf(p.start, p.end) > 32)
          lumps.push({
            label: `${shortDate(parseYmd(p.start))} to ${shortDate(parseYmd(p.end))}`,
            days: spanDaysOf(p.start, p.end),
            units: p.units,
            sales: p.sales,
          });
      }
      // full months of the item report (zero-filled: a full month that doesn't list the product means none sold)
      const byMonth = Object.create(null);
      for (const r of D ? D.prodMonths : [])
        if (r.item_name === name && r.status === "complete")
          byMonth[monthKeyOf(r.month)] = r;
      const points = (D ? D.an.itemSeries : []).map((x) => ({
        key: x.month,
        label: monthName(x.month),
        units: Number((byMonth[x.month] || {}).units || 0),
        sales: Number((byMonth[x.month] || {}).revenue || 0),
      }));
      return { points, lumps };
    }

    function productAnalysisHtml(name, points) {
      const au = analyzeSeries(
          points.map((m) => ({ month: m.key, value: m.units })),
        ),
        ar = analyzeSeries(
          points.map((m) => ({ month: m.key, value: m.sales })),
        );
      if (!au.latest) return "";
      const chg = (a, f) =>
        a.mom
          ? `${f(a.mom.from.value)} → ${f(a.mom.to.value)} · ${a.mom.abs >= 0 ? "+" : "−"}${f(Math.abs(a.mom.abs))}${a.mom.pct != null ? ` (${pctText(a.mom.pct)})` : ""}`
          : null;
      const u = (n) => Number(n).toLocaleString();
      let h =
        `<p class="pulse-label" style="margin-top:12px;">${monthName(au.latest.month)} (latest full month)</p>` +
        kv(
          "Units / revenue",
          `${u(au.latest.value)} units · ${fmt(ar.latest.value)}`,
        );
      h += kv(
        `Vs ${monthName(addMonths(au.latest.month, -1))}`,
        au.mom
          ? `units ${chg(au, u)}<br>revenue ${chg(ar, fmt)}`
          : "no full previous month on file",
        !au.mom,
      );
      if (au.r3)
        h += kv(
          "Last 3 months",
          `${u(au.r3.current.sum)} units · ${fmt(ar.r3.current.sum)}`,
        );
      if (au.r6)
        h += kv(
          "Last 6 months",
          `${u(au.r6.current.sum)} units · ${fmt(ar.r6.current.sum)}`,
        );
      if (au.ytd && au.ytd.months >= 2)
        h += kv(
          `Year to date (since ${monthName(au.ytd.since)})`,
          `${u(au.ytd.value)} units · ${fmt(ar.ytd.value)}`,
        );
      if (au.latest.value === 0)
        h += kv("Situation", "No sales in the latest full month");
      return h;
    }

    function productWindow(name, days) {
      if (!itemAnchor) return null;
      const end = parseYmd(itemAnchor);
      const curEdge = new Date(end);
      curEdge.setDate(curEdge.getDate() - days);
      const prevEdge = new Date(curEdge);
      prevEdge.setDate(prevEdge.getDate() - days);
      const cur = { units: 0, sales: 0, n: 0 },
        prev = { units: 0, sales: 0, n: 0 };
      for (const p of Object.values(periodsOf[name] || {})) {
        const s = parseYmd(p.start),
          e = parseYmd(p.end);
        const bucket =
          s > curEdge && e <= end
            ? cur
            : s > prevEdge && e <= curEdge
              ? prev
              : null;
        if (bucket) {
          bucket.units += p.units;
          bucket.sales += p.sales;
          bucket.n++;
        }
      }
      const from = new Date(curEdge);
      from.setDate(from.getDate() + 1);
      const pFrom = new Date(prevEdge);
      pFrom.setDate(pFrom.getDate() + 1);
      return { cur, prev, from, to: end, pFrom, pTo: curEdge };
    }

    let currentProduct = null;
    const pmNote = (html) =>
      `<div class="trend-note" style="margin:12px 0 0;">${html}</div>`;
    const pctTxt = (cur, prev) =>
      prev > 0
        ? `${cur >= prev ? "+" : "−"}${Math.abs(((cur - prev) / prev) * 100).toFixed(0)}%`
        : null;

    function renderProductTrend(view) {
      document
        .querySelectorAll("#pm-seg .range-btn")
        .forEach((b) => b.classList.toggle("active", b.dataset.v === view));
      const body = document.getElementById("pm-body");
      const name = currentProduct.item_name;
      if (view === "month") {
        const { points, lumps } = productMonthly(name);
        const lumpText = lumps
          .map(
            (l) =>
              `<b>${l.label}</b> (${l.days} days): ${Number(l.units).toLocaleString()} units · ${fmt(l.sales)}`,
          )
          .join("<br>");
        if (points.length >= 2) {
          body.innerHTML =
            `<p class="pulse-label" style="margin-top:14px;">Units sold per month</p>${buildPulseSvg(
              points.map((m) => ({ label: m.label, value: m.units })),
              (v) => Number(v).toLocaleString(),
            )}` +
            `<p class="pulse-label" style="margin-top:8px;">Revenue per month</p>${buildPulseSvg(
              points.map((m) => ({ label: m.label, value: m.sales })),
              fmtCompact,
            )}` +
            productAnalysisHtml(name, points) +
            (lumpText
              ? pmNote(
                  `Not drawn (these cover more than one month at once):<br>${lumpText}`,
                )
              : "");
        } else {
          const one = points[0];
          body.innerHTML = pmNote(
            (one
              ? `Only one month on file so far: <b>${one.label}</b>: ${Number(one.units).toLocaleString()} units · ${fmt(one.sales)}.<br>`
              : "") +
              (lumpText
                ? `The Sales by Item report on file covers more than one month at once:<br>${lumpText}<br>`
                : "") +
              `That isn't enough for a month-by-month line yet. Pull Sales by Item <b>once per month</b> in Zoho and upload each one: the line draws itself once there are two months.`,
          );
        }
        return;
      }
      const days = Number(view);
      const w = productWindow(name, days);
      if (!w || w.cur.n === 0) {
        body.innerHTML = pmNote(
          `No complete reporting period falls inside the last ${days} days of data.`,
        );
        return;
      }
      const du = pctTxt(w.cur.units, w.prev.units),
        ds = pctTxt(w.cur.sales, w.prev.sales);
      body.innerHTML =
        `<div class="modal-row" style="margin-top:12px;"><span class="k">Units sold</span><span class="v">${Number(w.cur.units).toLocaleString()}${du ? ` <span class="pulse-sub">(${du} vs prior)</span>` : ""}</span></div>` +
        `<div class="modal-row"><span class="k">Revenue</span><span class="v">${fmt(w.cur.sales)}${ds ? ` <span class="pulse-sub">(${ds} vs prior)</span>` : ""}</span></div>` +
        pmNote(
          `${shortDate(w.from)} to ${shortDate(w.to)} (${days} days). ${w.prev.n ? `Compared with ${shortDate(w.pFrom)} to ${shortDate(w.pTo)}.` : `No earlier report on file to compare against yet.`} Whole reporting periods only: a report that straddles the edge of the window is left out rather than split.`,
        );
    }

    window.openProductModal = function (p) {
      currentProduct = p;
      const units = Number(p.units_sold),
        rev = Number(p.total_revenue);
      const totalRev = sortedProducts.reduce(
        (s, x) => s + Number(x.total_revenue),
        0,
      );
      const unitRank =
        1 + sortedProducts.filter((x) => Number(x.units_sold) > units).length;
      const skuOf = (
        itemRows.data.find((r) => r.item_name === p.item_name) || {}
      ).sku;
      gmOpen(
        `
          <div class="modal-rank">#${p.revenue_rank} of ${sortedProducts.length} by revenue · #${unitRank} by units${skuOf ? " · SKU " + esc(skuOf) : ""}</div>
          <h3>${esc(p.item_name)}</h3>
          <div class="modal-row"><span class="k">Units sold</span><span class="v">${units.toLocaleString()}</span></div>
          <div class="modal-row"><span class="k">Revenue</span><span class="v">${fmt(rev)}</span></div>
          <div class="modal-row"><span class="k">Avg price per unit</span><span class="v">${units > 0 ? fmt(rev / units) : "Not available"}</span></div>
          <div class="modal-row"><span class="k">Share of wholesale product revenue</span><span class="v">${totalRev > 0 ? ((rev / totalRev) * 100).toFixed(1) + "%" : "Not available"}</span></div>
          <div class="seg" id="pm-seg">
            <button type="button" class="range-btn active" data-v="month">Month by month</button>
            <button type="button" class="range-btn" data-v="90">Last 90 days</button>
            <button type="button" class="range-btn" data-v="180">Last 6 months</button>
          </div>
          <div id="pm-body"></div>
          <button type="button" class="modal-close" data-action="gmClose">Close</button>`,
        true,
      );
      document
        .querySelectorAll("#pm-seg .range-btn")
        .forEach((b) =>
          b.addEventListener("click", () => renderProductTrend(b.dataset.v)),
        );
      renderProductTrend("month");
    };

    // ---------------- Zip tiles: broad % + specific ancestry, combined into one readable line ----------------
    const demoByZip = Object.fromEntries(demo.data.map((d) => [d.zip, d]));
    const ancestryByZip = Object.create(null);
    for (const a of ancestry.data) {
      if (!ancestryByZip[a.zip]) ancestryByZip[a.zip] = [];
      ancestryByZip[a.zip].push(a);
    }
    document.getElementById("zip-tiles").innerHTML = zip.data
      .map((z) => {
        const d = demoByZip[z.zip];
        const groups = (ancestryByZip[z.zip] || []).slice(0, 3);
        const namesOnly = groups.map((g) => g.ancestry_group).join(", ");
        let line = "No demographic data on file";
        if (d && groups.length) {
          line = `${d.majority_group}: mainly ${namesOnly}`;
        } else if (d) {
          line = d.majority_group;
        } else if (groups.length) {
          line = `Mainly ${namesOnly}`;
        }
        return `<div class="tile-xl" data-zip="${esc(z.zip ?? "")}">
          <div class="rank">#${z.revenue_rank}</div>
          <p class="zipcode">${esc(z.zip || "Unassigned")}</p>
          <div class="revenue">${fmtCompact(z.total_revenue)}</div>
          <div class="demo">${esc(line || "No demographic data")}</div>
        </div>`;
      })
      .join("");

    window.showZipDrilldown = function (zipCode) {
      const storesInZip = storeData
        .map((s, i) => ({ ...s, _i: i }))
        .filter((s) => (s.zip ?? "") === zipCode)
        .sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue));
      document.getElementById("zip-drilldown-label").textContent =
        `Customers in ${zipCode}`;
      document.getElementById("zip-drilldown-stores").innerHTML =
        storesInZip.map((s) => renderStoreTile(s, s._i)).join("") ||
        `<p style="color:var(--muted);font-size:13px;">No customers on file for this zip yet.</p>`;
      document.getElementById("zips-grid-view").style.display = "none";
      document.getElementById("zips-drilldown-view").style.display = "block";
    };
    window.showZipGrid = function () {
      document.getElementById("zips-drilldown-view").style.display = "none";
      document.getElementById("zips-grid-view").style.display = "block";
    };

    // ---------------- Routes: drill down to stores on that route ----------------
    document.getElementById("route-tiles").innerHTML = route.data
      .map(
        (r) => `
        <div class="tile-xl" data-route="${esc(r.delivery_route ?? "")}">
          <p class="zipcode" style="font-size:16px;">${esc(r.delivery_route || "Unassigned")}</p>
          <div class="revenue">${fmtCompact(r.total_revenue)}</div>
          <div class="demo">${r.stores_on_route} customers</div>
        </div>`,
      )
      .join("");

    window.showRouteDrilldown = function (routeName) {
      const storesOnRoute = storeData
        .map((s, i) => ({ ...s, _i: i }))
        .filter((s) => (s.delivery_route ?? "") === routeName)
        .sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue));
      document.getElementById("route-drilldown-label").textContent = routeName;
      document.getElementById("route-drilldown-stores").innerHTML =
        storesOnRoute.map((s) => renderStoreTile(s, s._i)).join("") ||
        `<p style="color:var(--muted);font-size:13px;">No customers assigned to this route yet.</p>`;
      document.getElementById("routes-grid-view").style.display = "none";
      document.getElementById("routes-drilldown-view").style.display = "block";
    };
    window.showRouteGrid = function () {
      document.getElementById("routes-drilldown-view").style.display = "none";
      document.getElementById("routes-grid-view").style.display = "block";
    };

    // ---------------- Trends ----------------
    const monthLabel = (d) =>
      new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short" });
    const paymentDates = payMapped.data.map((p) => parseYmd(p.payment_date));
    const latestPaymentDate = paymentDates.length
      ? new Date(Math.max(...paymentDates))
      : new Date();

    document.getElementById("trend-note").textContent =
      "The 30 / 90 / 180-day numbers use exact payment dates. The monthly lines use calendar months: a hollow, dashed point means that month isn't finished yet. " +
      "Revenue and receivables can't show a trend until there is more than one report period.";

    function renderPulse(containerId, title, points, opts = {}) {
      const el = document.getElementById(containerId);
      if (points.length === 0) {
        el.innerHTML = `<div class="pulse-card"><p class="pulse-label">${title}</p><p style="color:var(--muted);font-size:13px;">No data yet.</p></div>`;
        return;
      }
      if (points.length === 1) {
        el.innerHTML = `<div class="pulse-card"><p class="pulse-label">${title}</p>
            <p class="pulse-number" style="font-size:19px;">${fmt(points[0].value)}</p>
            <p class="pulse-sub">${esc(points[0].label)}${opts.singleNote ? ": " + opts.singleNote : ""}</p></div>`;
        return;
      }
      const complete = points.filter((p) => !p.partial);
      const inProgress = points.find((p) => p.partial);
      let headline, sub;
      if (opts.kind === "snapshot") {
        const last = points[points.length - 1],
          prev = points[points.length - 2];
        const d = last.value - prev.value;
        headline = fmt(last.value);
        sub = `${d >= 0 ? "Up" : "Down"} ${fmt(Math.abs(d))} since ${prev.label} ${opts.sub || ""}`;
      } else if (complete.length >= 3) {
        const avg =
          (complete[complete.length - 1].value - complete[0].value) /
          (complete.length - 1);
        headline = `${avg >= 0 ? "+" : "−"}${fmt(Math.abs(avg))}/month`;
        sub = `${avg >= 0 ? "Up" : "Down"} on average across ${complete.length} full months`;
      } else {
        const last = complete[complete.length - 1];
        headline = last ? `${last.label}: ${fmt(last.value)}` : "Not available";
        sub = `${last ? "Latest full month. " : ""}A month-over-month trend needs at least 3 full months: you have ${complete.length}.`;
      }
      if (inProgress && opts.kind !== "snapshot")
        sub += ` ${inProgress.label} is still in progress (${fmt(inProgress.value)} so far, dashed).`;
      el.innerHTML = `<div class="pulse-card">
          <p class="pulse-label">${title}</p>
          <p class="pulse-number" style="font-size:19px;color:var(--dark);">${headline}</p>
          <p class="pulse-sub">${sub}</p>
          ${buildPulseSvg(points, fmtCompact)}
        </div>`;
    }

    renderPulse(
      "pulse-payments",
      "Cash Collected by Month",
      monthlyPay.data.map((m) => {
        const first = parseYmd(m.month);
        const monthEnd = new Date(first.getFullYear(), first.getMonth() + 1, 0);
        const partial = latestPaymentDate < monthEnd;
        return {
          label: partial
            ? `${monthLabel(m.month)} 1 to ${latestPaymentDate.getDate()}`
            : monthLabel(m.month),
          value: Number(m.collected),
          partial,
        };
      }),
    );

    // Exact trailing windows for Payments (the only data with a date on every row)
    window.setPaymentRange = function (days) {
      document
        .querySelectorAll(".range-btn[data-days]")
        .forEach((b) =>
          b.classList.toggle("active", Number(b.dataset.days) === days),
        );
      const cutoff = new Date(latestPaymentDate);
      cutoff.setDate(cutoff.getDate() - days);
      const prevCutoff = new Date(cutoff);
      prevCutoff.setDate(prevCutoff.getDate() - days);
      const winStart = new Date(cutoff);
      winStart.setDate(winStart.getDate() + 1);
      const prevStart = new Date(prevCutoff);
      prevStart.setDate(prevStart.getDate() + 1);

      let current = 0,
        prior = 0,
        priorBiggest = null;
      for (const p of payMapped.data) {
        const d = parseYmd(p.payment_date),
          amt = Number(p.amount);
        if (d > cutoff && d <= latestPaymentDate) current += amt;
        else if (d > prevCutoff && d <= cutoff) {
          prior += amt;
          if (!priorBiggest || amt > priorBiggest.amount)
            priorBiggest = { amount: amt, name: p.zoho_name };
        }
      }
      const hasPrior = prior > 0;
      const pctChange = hasPrior ? ((current - prior) / prior) * 100 : null;
      const lopsided = hasPrior && priorBiggest.amount / prior >= 0.4;

      document.getElementById("range-stats").innerHTML = `
          <div class="pulse-sub" style="margin-bottom:12px;">${shortDate(winStart)} to ${fmtDate(ymd(latestPaymentDate))} (${days} days)</div>
          <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:baseline;">
            <div><div class="pulse-number" style="font-size:24px;">${fmt(current)}</div><div class="pulse-sub">collected</div></div>
            <div><div class="pulse-number" style="font-size:18px;color:var(--muted);">${fmt(current / days)}</div><div class="pulse-sub">average per day</div></div>
            ${hasPrior ? `<div><div class="pulse-number" style="font-size:18px;color:var(--dark);">${pctChange >= 0 ? "+" : "−"}${Math.abs(pctChange).toFixed(0)}%</div><div class="pulse-sub">vs. the ${days} days before (${shortDate(prevStart)} to ${shortDate(cutoff)})</div></div>` : ""}
          </div>
          ${lopsided ? `<p class="pulse-sub" style="margin-top:10px;">Heads up: one payment: ${fmt(priorBiggest.amount)} from ${esc(priorBiggest.name)}: is ${Math.round((priorBiggest.amount / prior) * 100)}% of that earlier window, so the comparison is lopsided.</p>` : ""}
          <p class="pulse-sub" style="margin-top:10px;">The window ends on your most recent payment on file, not today's date.</p>`;
    };
    setPaymentRange(30);

    // ---- v14: everything the new screens need, then draw them
    D = {
      prospects: R.prospects.data,
      followups: R.followups.data,
      scenarios: R.scenarios.data,
      initiatives: R.initiatives.data,
      visitNotes: R.visitNotes.data,
      storeData,
      stores: stores.data,
      mappedRows: mappedRows.data,
      payments: payMapped.data,
      openBalances,
      balances: balancesAll.data,
      payLog: payLog.data,
      unresolved: unresolved.data,
      mappingAll: mappingAll.data,
      batches: batches.data,
      srcMonths: srcMonths.data,
      custMonths: custMonths.data,
      prodMonths: prodMonths.data,
      itemRows: itemRows.data,
      sortedProducts,
      monthlyPay: monthlyPay.data,
      latestPaymentDate,
      wholesale,
      direct,
      otherTotal: Number(o.total_revenue || 0),
    };
    if (epoch !== authEpoch || !authUserId) return;
    prepareHistory(D);
    renderStatusCard(D);
    renderTrends(D);
    renderReceivables(D);
    renderDataTab(D);
    renderImportHistory(D.batches);
    renderWorkspace(D);

    document.getElementById("status").style.display = "none";
    document.getElementById("content").style.display = "block";
  } catch (err) {
    if (epoch === authEpoch && authUserId) showLoadError(err);
  } finally {
    if (epoch === authEpoch) refresh.disabled = false;
  }
}
