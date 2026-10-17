"use strict";
function invoiceDescription(customer, includeWord = true) {
  if (customer.has_estimated_sales || customer.invoice_count_unknown)
    return "Unassigned by location";
  const n = Number(customer.invoices || 0);
  return includeWord ? `${n} invoice${n === 1 ? "" : "s"}` : String(n);
}
function sourceInvoiceTotal(rows) {
  const sources = new Map();
  for (const row of rows)
    sources.set(row.id ?? row.zoho_name, {
      count: row.source_invoice_count ?? row.invoice_count,
    });
  return sumOf([...sources.values()], (r) => r.count);
}
function provisionalSalesCaption(d) {
  const active = (d?.saleAllocations || []).filter((a) => a.is_active);
  return active.length
    ? `${fmt(sumOf(active, (a) => a.allocated_sales))} of sales is provisionally allocated by owner estimate. The actual location is unconfirmed; invoice counts, payments, and balances are not divided.`
    : "";
}
function salesEstimateHtml(customer) {
  return customer.has_estimated_sales
    ? '<p class="allocation-notice"><b>Includes an owner estimate.</b> Sales include a provisional location split. The original report is retained; invoice counts are unassigned by location. <button class="btn-sm quiet" data-goto="data">Review allocation ↗</button></p>'
    : "";
}
function renderSalesAllocationPanel(d) {
  const box = document.getElementById("sales-allocations");
  if (!box) return;
  const groups = new Map();
  for (const row of d.saleAllocations || []) {
    if (!groups.has(row.source_sale_id)) groups.set(row.source_sale_id, []);
    groups.get(row.source_sale_id).push(row);
  }
  box.innerHTML = [...groups]
    .map(([sourceId, rows]) => {
      const active = rows.some((r) => r.is_active),
        source = d.mappedRows.find((r) => r.id === sourceId);
      return `<section class="pulse-card sec"><div class="card-heading"><div><span class="eyebrow">${active ? "PROVISIONAL OWNER ESTIMATE" : "DISABLED ALLOCATION"}</span><h2>${esc(source?.zoho_name || "Customer sales split")}</h2></div><button class="btn-sm" data-toggle-sales-split="${sourceId}" data-activate="${!active}">${active ? "Disable split" : "Restore split"}</button></div><p class="pulse-sub">${fmt(sumOf(rows, (r) => r.allocated_sales))} divided across ${rows.length} locations${source ? ` · ${fmtDate(source.period_start)} to ${fmtDate(source.period_end)}` : ""}. Original imported sales are retained. Future reports are not automatically split.</p><table class="tbl"><thead><tr><th>Location</th><th class="num">${active ? "Provisional sales" : "Saved allocation"}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.store_name)}</td><td class="num">${fmt(r.allocated_sales)}</td></tr>`).join("")}</tbody></table><p class="pulse-sub">The source report’s invoice count is not assigned to individual locations. Payments and balances are unchanged. ${active ? "This estimate affects customer rankings and the map." : "This split is disabled; the original customer mapping is in use."}</p><details class="studio-disclosure"><summary>Owner decision and source</summary><p>${esc(rows[0].notes)}</p></details><p class="pay-error" role="alert" data-split-error="${sourceId}"></p></section>`;
    })
    .join("");
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-toggle-sales-split]");
  if (!button || !D) return;
  const sourceId = Number(button.dataset.toggleSalesSplit),
    active = button.dataset.activate === "true",
    epoch = authEpoch;
  const error = document.querySelector(`[data-split-error="${sourceId}"]`);
  button.disabled = true;
  error.textContent = "";
  try {
    const result = await sb
      .from("sales_customer_allocations")
      .update({ is_active: active })
      .eq("source_sale_id", sourceId)
      .select("source_sale_id");
    if (result.error) throw result.error;
    if (epoch !== authEpoch) return;
    if (!result.data?.length)
      throw new Error(
        "No allocation changed. Refresh the workspace and try again.",
      );
    await reloadAfterWrite();
    showToast(
      active
        ? "Provisional split restored."
        : "Split disabled. Original customer mapping restored.",
    );
  } catch (err) {
    if (epoch === authEpoch && error.isConnected) {
      error.textContent = err.message || "Could not change the allocation.";
      button.disabled = false;
    }
  }
});
