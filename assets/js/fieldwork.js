"use strict";
function buildDailyBriefing(d) {
  const tasks = [];
  const suspect = d.payLog.filter(
    (p) => !p.voided_at && p.paid_on <= p.as_of_date,
  );
  if (suspect.length)
    tasks.push({
      kind: "payment-review",
      view: "receivables",
      title: "Check a payment against the balance report",
      detail: `${suspect.length} recorded payment${suspect.length === 1 ? " is" : "s are"} dated on or before its snapshot. Check Zoho before following up on the balance.`,
      action: "Review payment log",
      value: fmt(sumOf(suspect, (p) => p.amount)),
    });
  const dueActions = (d.followups || []).filter(
    (f) => !f.completed && f.due_on <= businessDay(),
  );
  if (dueActions.length)
    tasks.push({
      kind: "followups",
      view: "zips",
      title: "Follow through on your customer actions",
      detail: `${dueActions.length} customer action${dueActions.length === 1 ? " is" : "s are"} due on or before today. These dates were set by the owners.`,
      action: "Review next actions",
      value: String(dueActions.length),
    });
  if (d.unresolved.length) {
    const amount = sumOf(d.unresolved, (r) => r.revenue);
    tasks.push({
      kind: "names",
      view: "data",
      title:
        d.unresolved.length === 1
          ? `Confirm ${d.unresolved[0].zoho_name}`
          : "Confirm customer names",
      detail: `${fmt(amount)} of sales across ${d.unresolved.length} name${d.unresolved.length === 1 ? "" : "s"} still needs a confirmed customer. Rankings and map coverage depend on this.`,
      action: "Review customer names",
      value: String(d.unresolved.length),
    });
  }
  const snapshots = d.balances
      .map((b) => b.as_of_date)
      .filter(Boolean)
      .sort(),
    latest = snapshots.at(-1),
    age = latest ? daysSince(latest) : null;
  if (!latest || age > 14)
    tasks.push({
      kind: "balance-report",
      view: "upload",
      title: latest ? "Update the balance report" : "Load a balance report",
      detail: latest
        ? `Your latest snapshot is ${fmtDate(latest)}, ${age} days ago. Upload a fresh Zoho Customer Balance Summary before planning collections.`
        : "Upload a Zoho Customer Balance Summary to see what customers owe.",
      action: "Import balance report",
      value: latest ? `${age}d` : "New",
    });
  const provisional = d.mappingAll.filter((m) =>
    /provisional owner decision/i.test(m.notes || ""),
  );
  if (provisional.length)
    tasks.push({
      kind: "provisional",
      view: "data",
      title: "Confirm provisional customer matches",
      detail: `${provisional.length} customer match${provisional.length === 1 ? " is" : "es are"} based on a provisional decision. Confirm future reports that use a generic name.`,
      action: "Review assumptions",
      value: String(provisional.length),
    });
  if (!suspect.length && d.openBalances.length) {
    const largest = [...d.openBalances].sort(
      (a, b) => Number(b.outstanding_balance) - Number(a.outstanding_balance),
    )[0];
    tasks.push({
      kind: "collection",
      view: "receivables",
      title: `Review the balance for ${displayNameOf(largest)}`,
      detail: `${fmt(largest.outstanding_balance)} remains against the ${fmtDate(largest.as_of_date)} snapshot. This is an outstanding balance; invoice due dates are not available.`,
      action: "Open customer balance",
      value: fmt(largest.outstanding_balance),
      customer: displayNameOf(largest),
    });
  }
  if (d.srcMonths.some((r) => r.status === "block"))
    tasks.push({
      kind: "monthly-reports",
      view: "upload",
      title: "Build useful monthly comparisons",
      detail:
        "Sales are loaded as multi-month totals. Separate monthly reports are needed for reliable month-to-month comparisons. Existing overlapping reports must be reconciled before replacement.",
      action: "Review reporting coverage",
      value: "Reports",
    });
  return tasks;
}
function renderDailyBriefing(d) {
  const dates = d.mappedRows
    .map((r) => r.period_end)
    .filter(Boolean)
    .sort();
  const snapshots = d.balances
    .map((b) => b.as_of_date)
    .filter(Boolean)
    .sort();
  const imports = d.batches
    .map((b) => b.imported_at)
    .filter(Boolean)
    .sort();
  document.getElementById("owner-actions").innerHTML =
    `<div class="report-fact"><span>Wholesale through</span><b>${dates.length ? fmtDate(dates.at(-1)) : "No report"}</b></div><div class="report-fact"><span>Balance snapshot</span><b>${snapshots.length ? fmtDate(snapshots.at(-1)) : "No report"}</b></div><div class="report-fact"><span>Last import</span><b>${imports.length ? esc(new Date(imports.at(-1)).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })) : "None"}</b></div><p class="report-caption">Refreshing the page reloads saved reports. It does not fetch new transactions from Zoho or Square.</p><button class="btn-sm quiet" data-goto="upload">Import new reports ↗</button>`;

  const tasks = buildDailyBriefing(d),
    shown = tasks.slice(0, 3);
  document.getElementById("briefing-date").textContent =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }).format(new Date());
  document.getElementById("daily-priorities").innerHTML =
    shown
      .map(
        (t, i) =>
          `<article class="priority-card"><span class="priority-number">${String(i + 1).padStart(2, "0")}</span><span class="priority-value">${esc(t.value)}</span><h3>${esc(t.title)}</h3><p>${esc(t.detail)}</p><button class="btn-sm" data-priority="${esc(t.kind)}" data-priority-view="${t.view}"${t.customer ? ` data-priority-customer="${esc(t.customer)}"` : ""}>${esc(t.action)} ↗</button></article>`,
      )
      .join("") ||
    '<div class="briefing-clear"><b>No urgent issues found in loaded reports.</b><p>Use Customers to review activity or add a visit note.</p><button class="btn-sm" data-goto="stores">Open customers ↗</button></div>';
  document.getElementById("briefing-basis").textContent =
    `Based on your loaded reports and current snapshot, not a live feed.${tasks.length > 3 ? ` Showing the first 3 of ${tasks.length} suggested actions.` : ""}`;
}
function openFieldPayment() {
  if (!D) return;
  const groups = new Map();
  for (const r of D.openBalances) {
    const name = displayNameOf(r);
    groups.set(name, (groups.get(name) || 0) + Number(r.outstanding_balance));
  }
  gmOpen(
    `<div class="modal-rank">Record a payment</div><h3>Choose the customer</h3><p class="pulse-sub">Check the balance with the customer, then record the amount received. This updates Antari; record it in Zoho too.</p><div class="field-customer-list">${
      [...groups]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([name, total]) =>
            `<button class="field-customer" data-field-pay="${esc(name)}"><span>${esc(name)}</span><b>${fmt(total)}</b></button>`,
        )
        .join("") ||
      '<p class="empty-note">No outstanding balances in the current snapshot.</p>'
    }</div><button class="modal-close" data-action="gmClose">Close</button>`,
  );
}
function openVisitNotes(selected = "") {
  if (!D) return;
  const visitId = crypto.randomUUID();
  const stores = [...D.stores].sort((a, b) =>
    a.store_name.localeCompare(b.store_name),
  );
  gmOpen(
    `<div class="modal-rank">Shared owner notes</div><h3>Record a customer visit</h3><label class="field-label" for="visit-store">Customer</label><select id="visit-store" class="field-input"><option value="">Choose a customer</option>${stores.map((s) => `<option value="${esc(s.store_name)}"${s.store_name === selected ? " selected" : ""}>${esc(s.store_name)}</option>`).join("")}</select><label class="field-label" for="visit-note">Visit note</label><textarea class="field-input" id="visit-note" maxlength="2000" rows="4" placeholder="What did you discuss? What needs a follow-up?"></textarea><p class="pulse-sub">Visible to both owners. Notes are saved with your account and time. An internet connection is required.</p><div id="visit-error" class="pay-error" role="alert"></div><div class="modal-actions"><button class="btn-ghost" data-action="gmClose">Cancel</button><button class="btn-solid" id="visit-save">Save note</button></div><div id="visit-history"></div>`,
  );
  document
    .getElementById("visit-store")
    .addEventListener("change", renderVisitHistory);
  renderVisitHistory();
  installVisitCapture();
  installVisitActions();
  document.getElementById("visit-save").addEventListener("click", async () => {
    const store = document.getElementById("visit-store").value,
      note = document.getElementById("visit-note").value.trim(),
      error = document.getElementById("visit-error"),
      button = document.getElementById("visit-save");
    if (!store || !note) {
      error.textContent = "Choose a customer and write a note.";
      return;
    }
    const epoch = authEpoch;
    button.disabled = true;
    error.textContent = "";
    try {
      const capture =
        document.getElementById("note-sale-fields")?.getCapture?.() || {};
      const crm =
        document.getElementById("note-action-fields")?.getCapture?.() || {};
      const result = await sb.rpc("save_visit_capture", {
        p_id: visitId,
        p_store: store,
        p_note: note,
        p_sale: capture,
        p_crm: crm,
      });
      if (result.error) throw result.error;
      if (epoch !== authEpoch) return;
      if (button.isConnected) gmClose();
      showToast(
        crm.followup_on
          ? "Visit note and follow-up saved for both owners."
          : "Visit note saved for both owners.",
      );
      await reloadAfterWrite();
    } catch (err) {
      if (epoch === authEpoch && error.isConnected) {
        error.textContent =
          err.message || "Could not save. Your note is still here; try again.";
        button.disabled = false;
      }
    }
  });
}
function renderVisitHistory() {
  const name = document.getElementById("visit-store").value;
  const notes = (D?.visitNotes || [])
    .filter((n) => n.store_name === name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 8);
  document.getElementById("visit-history").innerHTML = name
    ? `<h4>Recent notes</h4>${notes.map((n) => `<article class="visit-entry"><small>${esc(n.recorded_by_email || "Owner")} · ${esc(new Date(n.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</small><p>${esc(n.note)}</p>${saleNoteSummary(n)}${visitActionsHtml(n)}</article>`).join("") || '<p class="empty-note">No visit notes for this customer yet.</p>'}`
    : "";
}
document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-field]");
  if (action && D) {
    const kind = action.dataset.field;
    if (kind === "payment") openFieldPayment();
    else if (kind === "note") openVisitNotes();
    else if (kind === "customers") {
      navigateTo("stores");
      document.getElementById("customer-filter").focus();
    } else if (kind === "more") {
      document.body.classList.toggle("nav-open");
      document
        .getElementById("menu-toggle")
        .setAttribute(
          "aria-expanded",
          String(document.body.classList.contains("nav-open")),
        );
    }
  }
  const pay = e.target.closest("[data-field-pay]");
  if (pay && D) openPaymentModal(pay.dataset.fieldPay);
  const priority = e.target.closest("[data-priority]");
  if (priority && D) {
    navigateTo(priority.dataset.priorityView);
    if (priority.dataset.priority === "followups") {
      setStudioView("explore");
      attentionOpen = true;
      selectedTerritoryCustomer = null;
      renderTerritoryDetail();
      return;
    }
    if (priority.dataset.priorityCustomer) {
      openPaymentModal(priority.dataset.priorityCustomer);
      return;
    }
    const target =
      priority.dataset.priority === "payment-review"
        ? document.getElementById("rc-log")
        : priority.dataset.priority === "names"
          ? document.getElementById("map-unresolved")
          : null;
    if (target) {
      target.tabIndex = -1;
      target.focus();
      target.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }
});
document
  .getElementById("mobile-search-toggle")
  .addEventListener("click", () => {
    const open = document.body.classList.toggle("search-open");
    document
      .getElementById("mobile-search-toggle")
      .setAttribute("aria-expanded", String(open));
    if (open) document.getElementById("global-search").focus();
  });
document
  .getElementById("modal-visit-note")
  ?.addEventListener("click", () =>
    openVisitNotes(document.getElementById("modal-name").textContent),
  );
function territoryCoverage(d) {
  const isMapped = (s) =>
    Boolean(s.zip) && Object.hasOwn(neighborhoodContext.areas, s.zip);
  const mappedSales = sumOf(
      d.storeData.filter(isMapped),
      (s) => s.total_revenue,
    ),
    unplacedSales = sumOf(
      d.storeData.filter((s) => !isMapped(s)),
      (s) => s.total_revenue,
    );
  return {
    mappedSales,
    unplacedSales,
    otherSales: Number(d.otherTotal || 0),
    wholesale: Number(d.wholesale || 0),
    percent: d.wholesale > 0 ? (mappedSales / d.wholesale) * 100 : null,
    unplacedCustomers: d.storeData.filter((s) => !isMapped(s)).length,
  };
}
