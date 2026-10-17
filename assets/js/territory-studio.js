"use strict";
const prospectStages = [
  ["identified", "Prospects"],
  ["contacted", "In conversation"],
  ["sampled", "Samples delivered"],
  ["first_order", "First order"],
  ["repeat_buyer", "Repeat buyer"],
  ["paused", "On hold"],
];
let studioView = "explore",
  selectedTerritoryCustomer = null,
  attentionOpen = false;
let activeScenario = null,
  scenarioInsertId = null;
const studioDate = (date) => (date ? fmtDate(date) : "No date set");
const stageLabel = (stage) =>
  prospectStages.find(([id]) => id === stage)?.[1] || stage;
const openProspects = (d = D) =>
  (d?.prospects || []).filter((p) => !p.archived);
function concentration(group) {
  const buyers = group.customers.filter((s) => Number(s.total_revenue) > 0);
  const highest = [...buyers].sort(
    (a, b) => Number(b.total_revenue) - Number(a.total_revenue),
  )[0];
  return {
    buyers: buyers.length,
    highest,
    share:
      group.revenue > 0 && highest
        ? (Number(highest.total_revenue) / group.revenue) * 100
        : null,
  };
}
function territorySignals(d) {
  const today = businessDay(),
    signals = [];
  for (const row of d.followups || [])
    if (!row.completed && row.due_on <= today) {
      const store = d.storeData.find((s) => s.store_name === row.store_name);
      signals.push({
        type: "followup",
        zip: store?.zip,
        customer: row.store_name,
        title: row.title,
        evidence: `Your follow-up was set for ${studioDate(row.due_on)}.`,
        id: row.id,
      });
    }
  for (const p of openProspects(d))
    if (p.follow_up_on && p.follow_up_on <= today && p.stage !== "paused")
      signals.push({
        type: "prospect",
        zip: p.zip,
        title: p.business_name,
        evidence: `${p.next_step || "Follow up"} · Set for ${studioDate(p.follow_up_on)}.`,
        id: p.id,
      });
  for (const p of d.payLog)
    if (!p.voided_at && p.paid_on <= p.as_of_date)
      signals.push({
        type: "payment",
        title: "Check a payment before collecting",
        evidence: `${fmt(p.amount)} dated ${studioDate(p.paid_on)} is on or before its ${studioDate(p.as_of_date)} balance snapshot. Check the Zoho record first.`,
      });
  const dates = d.balances
    .map((r) => r.as_of_date)
    .filter(Boolean)
    .sort();
  if (dates.length && daysSince(dates.at(-1)) > 14)
    signals.push({
      type: "report",
      title: "Refresh your balance report",
      evidence: `Latest snapshot: ${studioDate(dates.at(-1))}. It is ${daysSince(dates.at(-1))} days old. Outstanding does not mean overdue.`,
    });
  if (d.unresolved.length)
    signals.push({
      type: "matching",
      title: "Give unmatched sales a location",
      evidence: `${d.unresolved.length} customer names need confirmation. ${fmt(sumOf(d.unresolved, (r) => r.revenue))} in sales is affected.`,
    });
  return signals;
}
function setStudioView(view) {
  if (!["explore", "pipeline", "planner", "brief"].includes(view)) return;
  studioView = view;
  for (const button of document.querySelectorAll("[data-studio-view]")) {
    const active = button.dataset.studioView === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const section of document.querySelectorAll(".studio-view"))
    section.hidden = section.id !== "studio-" + view;
  if (view === "explore") requestAnimationFrame(() => refreshTerritoryMap());
  if (view === "brief" && D) renderOwnerBrief(D);
}
function renderTerritoryStudio(d) {
  const listed = sumOf(d.storeData, (s) => s.total_revenue),
    owed = sumOf(d.storeData, (s) => s.outstanding_balance);
  document.getElementById("territory-scorecard").innerHTML = [
    ["Listed-customer sales", fmt(listed), "Wholesale reports loaded"],
    [
      "Customers on file",
      String(d.storeData.length),
      `${new Set(d.storeData.map((s) => s.zip).filter(Boolean)).size} ZIP territories`,
    ],
    [
      "Listed-customer balances",
      fmt(owed),
      "Current snapshot, less logged payments",
    ],
    [
      "Prospects to develop",
      String(
        openProspects(d).filter(
          (p) => !["repeat_buyer", "paused"].includes(p.stage),
        ).length,
      ),
      "Recorded by the owners",
    ],
  ]
    .map(
      ([label, value, caption]) =>
        `<div><span>${label}</span><b>${value}</b><small>${caption}</small></div>`,
    )
    .join("");
  document.getElementById("attention-count").textContent = String(
    territorySignals(d).length,
  );
  renderFollowups(d);
  renderInitiatives(d);
  renderProspectBoard(d);
  renderSavedScenarios(d);
  renderOwnerBrief(d);
  renderExpansionResults();
  document.getElementById("pipeline-count").textContent = String(
    openProspects(d).length,
  );
  setStudioView(studioView);
}
function renderStudioTerritoryDetail() {
  const box = document.getElementById("territory-details"),
    d = territoryDataset;
  if (!d) return;
  if (attentionOpen) {
    const signals = territorySignals(d);
    box.innerHTML = `<div class="detail-topline"><span class="eyebrow">BACKED BY YOUR RECORDS</span><button class="btn-sm quiet" data-studio-back>Back to territory</button></div><h2 class="detail-title">What needs attention</h2><p class="studio-caption">Follow-up dates are your commitments. Balance flags use report dates, not invoice due dates.</p><div class="signal-list">${signals.map((s) => `<article><span class="signal-kind">${esc({ followup: "Your action", prospect: "Prospect follow-up", payment: "Payment review", report: "Report freshness", matching: "Customer matching" }[s.type])}</span><h3>${esc(s.title)}</h3><p>${esc(s.evidence)}</p>${s.customer ? `<button class="btn-sm quiet" data-studio-customer="${esc(s.customer)}">Prepare this visit ↗</button>` : s.type === "prospect" ? `<button class="btn-sm quiet" data-edit-prospect="${esc(s.id)}">Open prospect ↗</button>` : `<button class="btn-sm quiet" data-goto="${s.type === "payment" ? "receivables" : s.type === "report" ? "upload" : "data"}">Review records ↗</button>`}</article>`).join("") || '<div class="studio-empty"><b>No follow-ups or review flags today.</b><p>Choose a territory to explore your customer network.</p></div>'}</div>`;
    return;
  }
  if (selectedTerritoryCustomer) {
    const s = d.storeData.find(
      (s) => s.store_name === selectedTerritoryCustomer,
    );
    if (s) {
      renderTerritoryCustomer(s, d, box);
      return;
    }
    selectedTerritoryCustomer = null;
  }
  const g = territoryGroups.get(selectedZip);
  if (!g) {
    box.innerHTML =
      '<div class="studio-empty"><h2>Explore your footprint.</h2><p>Choose a ZIP on the map or in the list below. You can also explore an area where you have no customers yet.</p></div>';
    return;
  }
  const ranked = [...g.customers].sort(
      (a, b) => Number(b.total_revenue) - Number(a.total_revenue),
    ),
    c = concentration(g);
  const prospects = openProspects(d).filter((p) => p.zip === g.zip),
    isGeo = Object.hasOwn(neighborhoodContext.areas, g.zip);
  const metric = document.getElementById("map-metric").value;
  box.innerHTML = `<div class="detail-topline"><span class="eyebrow">TERRITORY PROFILE</span><span class="detail-badge">${isGeo ? "NYC ZIP area" : "Outside map coverage"}</span></div><h2>${esc(g.zip)}</h2><p class="nearby-areas">${esc((neighborhoodContext.areas[g.zip] || []).slice(0, 3).join(" / ") || "Neighborhood context unavailable")}</p><div class="detail-stats"><div><small>Sales</small><b>${fmt(g.revenue)}</b></div><div><small>Outstanding</small><b>${fmt(g.outstanding)}</b></div><div><small>Customers / buyers</small><b>${g.customers.length} / ${c.buyers}</b></div><div><small>Prospects</small><b>${prospects.length}</b></div></div>
    <div class="territory-insight"><span class="eyebrow">${metric === "prospects" ? "EXPANSION CONTEXT" : metric === "outstanding" ? "BEFORE YOU COLLECT" : "TERRITORY HEALTH"}</span><p>${metric === "prospects" ? `${prospects.length} prospects recorded in this ZIP. ${g.customers.length ? `You already have ${g.customers.length} customer relationships here.` : "No listed customers here yet. An empty area does not establish demand."}` : metric === "outstanding" ? "Balances reflect the latest imported snapshot and payments logged afterward. Check the snapshot date and any payment review flags before following up." : c.share === null ? "No sales are attributed to listed customers here in loaded reports. This does not establish that these stores are inactive." : `${esc(c.highest.store_name)} accounts for ${c.share.toFixed(1)}% of this ZIP’s listed-customer sales. ${c.buyers === 1 ? "All attributed revenue comes from one buyer." : `${c.buyers} customers have sales in the loaded reports.`}`}</p>${c.share !== null && metric === "revenue" ? `<div class="concentration-bar" role="img" aria-label="Largest buyer accounts for ${c.share.toFixed(1)} percent of this ZIP's sales"><i style="width:${c.share}%"></i></div>` : ""}</div>
    <div class="detail-list-heading"><h3>${metric === "prospects" ? "Prospects in this area" : "Your customers"}</h3><span>${metric === "prospects" ? prospects.length : ranked.length}</span></div><div class="territory-customers">${metric === "prospects" ? prospects.map((p) => `<button data-edit-prospect="${esc(p.id)}"><span>${esc(p.business_name)}<small>${esc(stageLabel(p.stage))}</small></span><span>↗</span></button>`).join("") || '<p class="empty-note">Add a business you’ve researched or visited to start developing this area.</p>' : ranked.map((s) => `<button data-studio-customer="${esc(s.store_name)}"><span>${esc(s.store_name)}<small>${esc(s.category || "Customer")} · ${Number(s.invoices) || 0} reported invoices</small></span><span>${fmt(s.total_revenue)}<small>${Number(s.outstanding_balance) > 0 ? `${fmt(s.outstanding_balance)} outstanding` : "No open balance"}</small></span></button>`).join("") || '<p class="empty-note">No listed customers in this ZIP. You can still record prospects and plan an expansion.</p>'}</div><div class="detail-action-row"><button class="btn-sm" data-studio-action="prospect" data-zip="${esc(g.zip)}">Add a prospect</button><button class="btn-sm quiet" data-plan-zip="${esc(g.zip)}">Plan this area ↗</button></div><p class="map-note">Buyers have sales in loaded reports; this is not a live activity measure. Neighborhood names are approximate nearby context. Square sales remain separate from the map.</p>`;
}
function renderTerritoryCustomer(s, d, box) {
  const raw = d.stores.find((r) => r.store_name === s.store_name) || {};
  const notes = (d.visitNotes || [])
    .filter((n) => n.store_name === s.store_name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 3);
  const actions = (d.followups || [])
    .filter((f) => f.store_name === s.store_name && !f.completed)
    .sort((a, b) => a.due_on.localeCompare(b.due_on));
  const rows = d.mappedRows.filter((r) => r.mapped_store === s.store_name),
    dates = rows
      .map((r) => r.period_end)
      .filter(Boolean)
      .sort();
  const balances = d.openBalances.filter(
      (r) => displayNameOf(r) === s.store_name,
    ),
    snapshot = balances
      .map((r) => r.as_of_date)
      .filter(Boolean)
      .sort()
      .at(-1);
  box.innerHTML = `<div class="detail-topline"><button class="btn-sm quiet" data-studio-back>← ZIP ${esc(s.zip || "Unassigned")}</button><span class="detail-badge">Visit preparation</span></div><h2 class="detail-title">${esc(s.store_name)}</h2><p class="nearby-areas">${esc(s.category || "Customer")} · ${esc(s.zip || "No ZIP")}</p><div class="detail-stats"><div><small>Reported sales</small><b>${fmt(s.total_revenue)}</b></div><div><small>Outstanding</small><b>${fmt(s.outstanding_balance)}</b></div></div><p class="studio-caption">${dates.length ? `Sales reporting through ${studioDate(dates.at(-1))}.` : "No attributed sales report."} ${snapshot ? `Balance snapshot ${studioDate(snapshot)}.` : "No open balance in the current snapshot."}</p>${raw.contact_name || raw.phone_email ? `<div class="customer-contact"><b>${esc(raw.contact_name || "Contact")}</b><p>${esc(raw.phone_email || "")}</p></div>` : ""}<div class="detail-action-row"><button class="btn-sm" data-visit-customer="${esc(s.store_name)}">Write a visit note</button><button class="btn-sm quiet" data-followup-customer="${esc(s.store_name)}">Set next action ↗</button></div>${Number(s.outstanding_balance) > 0 ? `<button class="btn-sm quiet" data-field-pay="${esc(s.store_name)}">Record a payment ↗</button>` : ""}<h3 class="detail-subheading">Before your next conversation</h3>${actions.length ? actions.map((f) => `<button class="action-summary" data-edit-followup="${esc(f.id)}"><b>${esc(f.title)}</b><small>${studioDate(f.due_on)} · ${esc(f.kind)}</small></button>`).join("") : '<p class="empty-note">No next action set. Record what you want to discuss or offer on the next visit.</p>'}<h3 class="detail-subheading">Recent visit notes</h3>${notes.map((n) => `<article class="visit-entry"><small>${studioDate(businessDay(new Date(n.created_at)))} · ${esc(n.recorded_by_email || "Owner")}</small><p>${esc(n.note)}</p>${typeof saleNoteSummary === "function" ? saleNoteSummary(n) : ""}</article>`).join("") || '<p class="empty-note">Your next visit note will appear here.</p>'}${raw.notes ? `<details class="studio-disclosure"><summary>Customer background</summary><p>${esc(raw.notes)}</p></details>` : ""}<details class="studio-disclosure"><summary>What can these reports tell us?</summary><p>Sales and invoice counts come from customer summary reports. They do not reveal individual order dates or which products this store bought. Product gaps and reorder alerts need invoice line items. Payments are collections, not order dates.</p></details>`;
}
function renderFollowups(d) {
  const rows = [...(d.followups || [])].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      a.due_on.localeCompare(b.due_on),
  );
  document.getElementById("territory-actions").innerHTML =
    rows
      .slice(0, 6)
      .map(
        (f) =>
          `<div class="followup-row ${f.completed ? "completed" : ""}"><button class="complete-toggle" data-toggle-followup="${esc(f.id)}" aria-label="${f.completed ? "Reopen" : "Complete"} ${esc(f.title)}" aria-pressed="${f.completed}">${f.completed ? "✓" : "○"}</button><button class="action-summary" data-edit-followup="${esc(f.id)}"><b>${esc(f.title)}</b><small>${esc(f.store_name)} · ${studioDate(f.due_on)}${f.completed ? " · Completed" : f.due_on < businessDay() ? " · Follow-up date passed" : ""}</small></button></div>`,
      )
      .join("") ||
    '<div class="studio-empty compact"><b>Give your next visit a purpose.</b><p>Set a customer action and a date. It will appear here and in the map’s attention panel.</p></div>';
}
function renderInitiatives(d) {
  document.getElementById("territory-initiatives").innerHTML =
    [...(d.initiatives || [])]
      .sort((a, b) => a.review_on.localeCompare(b.review_on))
      .slice(0, 5)
      .map(
        (p) =>
          `<button class="initiative-row" data-edit-initiative="${esc(p.id)}"><span class="detail-badge">${esc(p.zip)}</span><span><b>${esc(p.title)}${p.archived ? " (archived)" : ""}</b><small>${esc(p.status)} · Review ${studioDate(p.review_on)}</small></span><span>↗</span></button>`,
      )
      .join("") ||
    '<div class="studio-empty compact"><b>Turn an idea into a small experiment.</b><p>Choose an area, write what you want to try, define success, and record the result.</p></div>';
}
function renderProspectBoard(d = D) {
  if (!d) return;
  const all = openProspects(d),
    q = document.getElementById("pipeline-search").value.toLowerCase().trim(),
    archived = document.getElementById("pipeline-archived").checked;
  const rows = (d.prospects || []).filter(
    (p) =>
      (archived || !p.archived) &&
      [p.business_name, p.zip, p.category, p.contact].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
  );
  const buyers = all.filter((p) =>
    ["first_order", "repeat_buyer"].includes(p.stage),
  ).length;
  document.getElementById("pipeline-summary").innerHTML =
    `<span><b>${all.length}</b> recorded businesses</span><span><b>${all.filter((p) => p.stage === "sampled").length}</b> currently at samples</span><span><b>${buyers}</b> marked as buyers</span><span><b>${fmt(sumOf(all, (p) => p.sampling_cost))}</b> sample spending recorded</span>`;
  document.getElementById("prospect-board").innerHTML = prospectStages
    .map(([stage, label], i) => {
      const cards = rows.filter((p) => p.stage === stage);
      return `<section class="pipeline-column"><h3><span class="stage-dot stage-${i}"></span>${label}<small>${cards.length}</small></h3>${cards.map((p) => `<article class="prospect-card ${p.archived ? "archived" : ""}"><button class="prospect-name" data-edit-prospect="${esc(p.id)}">${esc(p.business_name)}</button><span class="prospect-location">${esc(p.zip)}${p.category ? ` · ${esc(p.category)}` : ""}${p.archived ? " · Archived" : ""}</span>${p.notes ? `<p>${esc(p.notes.slice(0, 140))}${p.notes.length > 140 ? "…" : ""}</p>` : ""}${p.next_step ? `<div class="prospect-next"><small>NEXT STEP</small><b>${esc(p.next_step)}</b>${p.follow_up_on ? `<span>${studioDate(p.follow_up_on)}</span>` : ""}</div>` : ""}<label class="sr-only" for="stage-${esc(p.id)}">Stage for ${esc(p.business_name)}</label><select id="stage-${esc(p.id)}" data-prospect-stage="${esc(p.id)}">${prospectStages.map(([id, name]) => `<option value="${id}"${p.stage === id ? " selected" : ""}>${name}</option>`).join("")}</select></article>`).join("") || `<div class="pipeline-empty">${i === 0 ? "Start with a business you’d like to supply." : "Relationships at this stage will appear here."}</div>`}</section>`;
    })
    .join("");
}
async function persistShared(table, payload, record, insertId) {
  const epoch = authEpoch;
  const result = record
    ? await sb
        .from(table)
        .update(payload)
        .eq("id", record.id)
        .eq("revision", record.revision)
        .select("id,revision")
    : await sb
        .from(table)
        .insert({ ...payload, id: insertId })
        .select("id,revision");
  if (epoch !== authEpoch)
    throw new Error("Your session changed. Sign in again before saving.");
  if (result.error)
    throw new Error(
      result.error.code === "23505"
        ? "A record with this identity already exists. Refresh the workspace and open the existing record."
        : result.error.message ||
          "Could not save. Your changes are still here.",
    );
  if (!result.data?.length)
    throw new Error(
      "This record changed in another session. Refresh the workspace before editing it again. Your text is still here.",
    );
  return result.data[0];
}
function sharedForm(title, body, record, table, getPayload) {
  const id = record?.id || crypto.randomUUID();
  gmOpen(
    `<div class="modal-rank">Shared owner workspace</div><h3>${esc(title)}</h3><form id="studio-edit-form">${body}<p class="studio-caption">Saved for both owners. An internet connection is required.</p><div class="pay-error" id="studio-form-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn-ghost" data-action="gmClose">Cancel</button><button type="submit" class="btn-solid" id="studio-form-save">Save</button></div></form>`,
    true,
  );
  document
    .getElementById("studio-edit-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.currentTarget,
        button = form.querySelector("#studio-form-save"),
        error = form.querySelector("#studio-form-error"),
        epoch = authEpoch;
      button.disabled = true;
      error.textContent = "";
      try {
        await persistShared(table, getPayload(new FormData(form)), record, id);
        if (epoch !== authEpoch) return;
        if (form.isConnected) gmClose();
        showToast("Saved for both owners.");
        await reloadAfterWrite();
      } catch (err) {
        if (epoch === authEpoch && error.isConnected) {
          error.textContent = err.message;
          button.disabled = false;
        }
      }
    });
}
const inputField = (label, name, value = "", attrs = "", full = false) =>
  `<label${full ? ' class="full-field"' : ""}>${label}<input name="${name}" value="${esc(value ?? "")}" ${attrs} /></label>`;
const textField = (label, name, value = "", max = 2000) =>
  `<label class="full-field">${label}<textarea name="${name}" rows="3" maxlength="${max}">${esc(value || "")}</textarea></label>`;
function openProspectForm(record = null, zip = selectedZip) {
  const p = record || {};
  sharedForm(
    record ? "Develop this relationship" : "Add a prospect",
    `<div class="form-grid">${inputField("Business name", "business_name", p.business_name, 'required maxlength="160"')}${inputField("ZIP", "zip", p.zip || (/^\d{5}$/.test(zip) ? zip : ""), 'required pattern="[0-9]{5}" inputmode="numeric" maxlength="5"')}${inputField("Business type", "category", p.category, 'maxlength="80" placeholder="Market, restaurant, bakery…"')}${inputField("Contact details", "contact", p.contact, 'maxlength="250"')}${inputField("Address, optional", "address", p.address, 'maxlength="300"', true)}<label>Relationship stage<select name="stage">${prospectStages.map(([id, label]) => `<option value="${id}"${(p.stage || "identified") === id ? " selected" : ""}>${label}</option>`).join("")}</select></label>${inputField("Sample spending to date ($)", "sampling_cost", p.sampling_cost ?? 0, 'type="number" min="0" max="999999999" step="0.01" required')}${textField("Conversation and product interests", "notes", p.notes)}${inputField("Next step", "next_step", p.next_step, 'maxlength="200"')}${inputField("Follow up on", "follow_up_on", p.follow_up_on, 'type="date"')}<label class="full-field">Link an existing customer, optional<select name="linked_store"><option value="">No customer linked</option>${D.stores.map((s) => `<option value="${esc(s.store_name)}"${p.linked_store === s.store_name ? " selected" : ""}>${esc(s.store_name)}</option>`).join("")}</select></label>${record ? `<label class="checkbox-field full-field"><input type="checkbox" name="archived"${p.archived ? " checked" : ""}/> Archive this prospect (can be restored)</label>` : ""}</div><p class="studio-caption">Record stages from actual conversations and orders. This does not add financial sales.</p>`,
    record,
    "territory_prospects",
    (f) => ({
      business_name: f.get("business_name").trim(),
      zip: f.get("zip").trim(),
      category: f.get("category").trim(),
      contact: f.get("contact").trim(),
      address: f.get("address").trim(),
      stage: f.get("stage"),
      sampling_cost: Number(f.get("sampling_cost")),
      notes: f.get("notes").trim(),
      next_step: f.get("next_step").trim(),
      follow_up_on: f.get("follow_up_on") || null,
      linked_store: f.get("linked_store") || null,
      archived: f.get("archived") === "on",
    }),
  );
}
function openFollowupForm(record = null, customer = "") {
  const f = record || {};
  sharedForm(
    record ? "Your customer action" : "Set your next customer action",
    `<div class="form-grid"><label class="full-field">Customer<select name="store_name" required><option value="">Choose a customer</option>${D.stores.map((s) => `<option value="${esc(s.store_name)}"${(f.store_name || customer) === s.store_name ? " selected" : ""}>${esc(s.store_name)}</option>`).join("")}</select></label>${inputField("What will you do?", "title", f.title, 'required maxlength="200" placeholder="Discuss a sample, check a balance, visit the store…"', true)}${inputField("Follow up on", "due_on", f.due_on || businessDay(), 'type="date" required')}<label>Purpose<select name="kind">${["visit", "product", "collection", "other"].map((k) => `<option${(f.kind || "visit") === k ? " selected" : ""}>${k}</option>`).join("")}</select></label>${textField("Preparation and outcome", "notes", f.notes)}<label class="checkbox-field full-field"><input type="checkbox" name="completed"${f.completed ? " checked" : ""}/> Completed</label></div>`,
    record,
    "customer_followups",
    (data) => ({
      store_name: data.get("store_name"),
      title: data.get("title").trim(),
      due_on: data.get("due_on"),
      kind: data.get("kind"),
      notes: data.get("notes").trim(),
      completed: data.get("completed") === "on",
    }),
  );
}
function openInitiativeForm(record = null) {
  const p = record || {};
  sharedForm(
    record ? "Review your territory project" : "Try a territory idea",
    `<div class="form-grid">${inputField("Project name", "title", p.title, 'required maxlength="160"')}${inputField("ZIP", "zip", p.zip || (/^\d{5}$/.test(selectedZip) ? selectedZip : ""), 'required pattern="[0-9]{5}" maxlength="5" inputmode="numeric"')}${textField("What will you try, and why?", "hypothesis", p.hypothesis)}${inputField("Start date", "starts_on", p.starts_on || businessDay(), 'type="date" required')}${inputField("Review date", "review_on", p.review_on, 'type="date" required')}${inputField("What would success look like?", "success_measure", p.success_measure, 'required maxlength="300" placeholder="For example, two stores place a first order"', true)}${textField("What happened?", "outcome", p.outcome)}<label>Status<select name="status">${["active", "complete", "paused"].map((k) => `<option${(p.status || "active") === k ? " selected" : ""}>${k}</option>`).join("")}</select></label></div><p class="studio-caption">Record observed outcomes. A change in sales alone does not prove this project caused it.</p>`,
    record,
    "territory_initiatives",
    (f) => {
      if (f.get("review_on") < f.get("starts_on"))
        throw new Error("Choose a review date on or after the start date.");
      return {
        title: f.get("title").trim(),
        zip: f.get("zip").trim(),
        hypothesis: f.get("hypothesis").trim(),
        starts_on: f.get("starts_on"),
        review_on: f.get("review_on"),
        success_measure: f.get("success_measure").trim(),
        outcome: f.get("outcome").trim(),
        status: f.get("status"),
      };
    },
  );
  document.querySelector('[name="hypothesis"]').required = true;
}
function calculateExpansion(p) {
  const keys = [
    "customers",
    "order_value",
    "orders_per_month",
    "margin_pct",
    "monthly_cost",
  ];
  if (
    keys.some(
      (k) =>
        p[k] === "" ||
        p[k] === null ||
        p[k] === undefined ||
        !Number.isFinite(Number(p[k])),
    )
  )
    return null;
  const [customers, value, frequency, margin, cost] = keys.map((k) =>
    Number(p[k]),
  );
  if (
    !Number.isInteger(customers) ||
    customers < 1 ||
    customers > 10000 ||
    value <= 0 ||
    value >= 1e9 ||
    frequency <= 0 ||
    frequency > 100 ||
    margin < 0 ||
    margin > 100 ||
    cost < 0 ||
    cost >= 1e9
  )
    return null;
  const revenue = customers * value * frequency,
    grossProfit = (revenue * margin) / 100,
    contribution = grossProfit - cost;
  const unitContribution = (value * frequency * margin) / 100;
  return {
    revenue,
    grossProfit,
    cost,
    contribution,
    breakEvenCustomers:
      unitContribution > 0 ? Math.ceil(cost / unitContribution) : null,
    cases: [0.8, 1, 1.2].map((factor) => ({
      factor,
      revenue: revenue * factor,
      contribution: grossProfit * factor - cost,
    })),
  };
}
function expansionInputs() {
  return Object.fromEntries(
    new FormData(document.getElementById("expansion-form")),
  );
}
function renderExpansionResults() {
  const r = calculateExpansion(expansionInputs()),
    box = document.getElementById("expansion-results");
  if (!r) {
    box.innerHTML =
      '<div class="planner-welcome"><span class="eyebrow">YOUR ASSUMPTIONS, MADE VISIBLE</span><div class="planner-art" aria-hidden="true"><i></i><i></i><i></i><span>↗</span></div><h2>Give your next move a clear picture.</h2><p>Enter the five business assumptions to see monthly sales, contribution, and the customer count needed to cover your extra costs.</p><small>Nothing here changes your reported financial figures.</small></div>';
    return;
  }
  box.innerHTML = `<div class="scenario-hero"><span class="eyebrow">ILLUSTRATIVE MONTHLY CONTRIBUTION</span><b class="${r.contribution < 0 ? "negative" : ""}">${fmt(r.contribution)}</b><p>After assumed product costs and your extra monthly operating costs.</p><div><span>Sales <strong>${fmt(r.revenue)}</strong></span><span>Gross profit <strong>${fmt(r.grossProfit)}</strong></span></div></div><div class="scenario-cases">${r.cases.map((c, i) => `<div><small>${["Smaller orders", "Your assumptions", "Larger orders"][i]}</small><b>${fmt(c.contribution)}</b><span>${["20% lower order value", "Entered order value", "20% higher order value"][i]}</span></div>`).join("")}</div><p class="studio-caption">Sensitivity changes only average order value. Customer count, frequency, margin, and extra monthly costs stay fixed. These are illustrations, not forecasts.</p><div class="break-even"><b>${r.breakEvenCustomers === null ? "No break-even at this margin" : `${r.breakEvenCustomers} customer${r.breakEvenCustomers === 1 ? "" : "s"} to cover extra costs`}</b><p>At your entered order value, frequency, and margin. This covers incremental monthly costs only.</p></div>`;
}
function renderSavedScenarios(d) {
  document.getElementById("saved-scenarios").innerHTML =
    (d.scenarios || [])
      .filter(
        (p) =>
          !p.archived ||
          document.getElementById("scenario-show-archived").checked,
      )
      .map((p) => {
        const r = calculateExpansion(p);
        return `<div class="saved-plan"><button data-load-scenario="${esc(p.id)}"><span><b>${esc(p.title)}${p.archived ? " (archived)" : ""}</b><small>${esc(p.zip || "All areas")} · ${p.customers} customers · ${studioDate(businessDay(new Date(p.updated_at)))}</small></span><span>${r ? fmt(r.contribution) : "Review inputs"}<small>Illustrative monthly contribution</small></span></button><button class="btn-sm quiet" data-archive-scenario="${esc(p.id)}">${p.archived ? "Restore" : "Archive"}</button></div>`;
      })
      .join("") ||
    '<p class="empty-note">Save a plan to return to it with your co-owner. Plans stay separate from reported sales.</p>';
}
function renderOwnerBrief(d) {
  const coverage = territoryCoverage(d),
    total = d.wholesale + d.direct,
    listed = sumOf(d.storeData, (s) => s.total_revenue),
    balances = sumOf(d.openBalances, (s) => s.outstanding_balance);
  const top = [...d.storeData]
      .sort((a, b) => Number(b.total_revenue) - Number(a.total_revenue))
      .slice(0, 5),
    dates = d.balances
      .map((b) => b.as_of_date)
      .filter(Boolean)
      .sort(),
    lastImport = d.batches
      .map((b) => b.imported_at)
      .filter(Boolean)
      .sort()
      .at(-1);
  document.getElementById("territory-owner-brief").innerHTML =
    `<header><div class="brief-brand">ANTARI<span>A TASTE OF ARMENIA</span></div><div>Owner business brief<small>Prepared ${studioDate(businessDay())}</small></div></header><div class="brief-intro"><span class="eyebrow">NEW YORK · DISTRIBUTION</span><h2>A view of the business,<br>grounded in your records.</h2><p>Prepared from the reports loaded into Antari. This is an internal management summary, not audited financial statements.</p></div><div class="brief-figures">${[
      ["Reported sales", total],
      ["Wholesale", d.wholesale],
      ["Square direct / festival", d.direct],
      ["Outstanding balances", balances],
    ]
      .map(
        ([label, value]) =>
          `<div><span>${label}</span><b>${fmt(value)}</b></div>`,
      )
      .join(
        "",
      )}</div><div class="brief-columns"><section><h3>Report coverage</h3><dl><dt>Wholesale</dt><dd>${esc(sourceSummary(d.srcMonths, "wholesale"))}</dd><dt>Square</dt><dd>${esc(sourceSummary(d.srcMonths, "festival"))}</dd><dt>Balance snapshot</dt><dd>${dates.length ? studioDate(dates.at(-1)) : "Not available"}</dd><dt>Latest import</dt><dd>${lastImport ? studioDate(businessDay(new Date(lastImport))) : "Not available"}</dd></dl></section><section><h3>Customer and territory coverage</h3><dl><dt>Listed customers</dt><dd>${d.storeData.length}</dd><dt>Listed-customer sales</dt><dd>${fmt(listed)}</dd><dt>Sales within map boundaries</dt><dd>${fmt(coverage.mappedSales)} (${coverage.percent === null ? "No sales" : coverage.percent.toFixed(1) + "% of wholesale"})</dd><dt>Other buyers</dt><dd>${fmt(d.otherTotal)}</dd></dl></section></div><section><h3>Largest listed customers</h3><table class="brief-table"><thead><tr><th>Customer</th><th>ZIP</th><th>Sales</th><th>Share of listed sales</th></tr></thead><tbody>${top.map((s) => `<tr><td>${esc(s.store_name)}</td><td>${esc(s.zip || "Unassigned")}</td><td>${fmt(s.total_revenue)}</td><td>${listed > 0 ? ((Number(s.total_revenue) / listed) * 100).toFixed(1) + "%" : "Not available"}</td></tr>`).join("")}</tbody></table></section><div class="brief-limitations"><h3>How to read these figures</h3><p>Square and Zoho are separate sales channels, as confirmed by the owners. They may cover different periods. Square item reports show gross sales before discounts, refunds, taxes, and fees. Item summaries are not added again to channel totals.</p><p>Outstanding balances use imported snapshots and subsequent manually logged payments. They are not necessarily overdue. ${d.payLog.some((p) => !p.voided_at && p.paid_on <= p.as_of_date) ? "A historical payment predates its snapshot and needs reconciliation; the outstanding figure remains subject to that review." : ""}</p><p>Other buyers includes sales not assigned to listed customers. Map coverage is incomplete. Product costs, expenses, invoice due dates, and customer-level product purchases are not available in these reports, so profit, net revenue, product opportunities, and reorder predictions are not presented as established facts. Saved expansion plans and visit sale drafts are excluded from all reported figures.</p></div><footer>Antari owner workspace · Sources: saved Zoho and Square reports, customer directory, and owner payment log.</footer>`;
}
function clearTerritoryStudio() {
  selectedTerritoryCustomer = null;
  attentionOpen = false;
  activeScenario = null;
  scenarioInsertId = null;
  studioView = "explore";
  document.getElementById("expansion-form").reset();
  document.getElementById("pipeline-search").value = "";
  document.getElementById("territory-search").value = "";
  document.getElementById("pipeline-archived").checked = false;
  document.getElementById("scenario-show-archived").checked = false;
  for (const id of [
    "territory-scorecard",
    "territory-actions",
    "territory-initiatives",
    "prospect-board",
    "pipeline-summary",
    "saved-scenarios",
    "territory-owner-brief",
    "expansion-results",
    "scenario-error",
  ])
    document.getElementById(id).replaceChildren();
  document.getElementById("pipeline-count").textContent = "0";
  document.getElementById("attention-count").textContent = "";
}
document.addEventListener("click", async (e) => {
  if (!D) return;
  const view = e.target.closest("[data-studio-view]");
  if (view) setStudioView(view.dataset.studioView);
  const lens = e.target.closest("[data-map-lens]");
  if (lens) {
    document.getElementById("map-metric").value = lens.dataset.mapLens;
    for (const b of document.querySelectorAll("[data-map-lens]")) {
      const on = b === lens;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
    document.getElementById("map-metric").dispatchEvent(new Event("change"));
  }
  if (e.target.closest("#map-attention")) {
    attentionOpen = true;
    selectedTerritoryCustomer = null;
    renderTerritoryDetail();
  }
  if (e.target.closest("[data-studio-back]")) {
    attentionOpen = false;
    selectedTerritoryCustomer = null;
    renderTerritoryDetail();
  }
  const customer = e.target.closest("[data-studio-customer]");
  if (customer) {
    const store = D.storeData.find(
      (s) => s.store_name === customer.dataset.studioCustomer,
    );
    if (store) selectTerritory(store.zip || "Unassigned");
    selectedTerritoryCustomer = customer.dataset.studioCustomer;
    attentionOpen = false;
    renderTerritoryDetail();
  }
  const note = e.target.closest("[data-visit-customer]");
  if (note) openVisitNotes(note.dataset.visitCustomer);
  const follow = e.target.closest("[data-followup-customer]");
  if (follow) openFollowupForm(null, follow.dataset.followupCustomer);
  const action = e.target.closest("[data-studio-action]");
  if (action) {
    const kind = action.dataset.studioAction;
    if (kind === "prospect")
      openProspectForm(null, action.dataset.zip || selectedZip);
    if (kind === "followup") openFollowupForm();
    if (kind === "initiative") openInitiativeForm();
  }
  const ep = e.target.closest("[data-edit-prospect]");
  if (ep)
    openProspectForm(D.prospects.find((p) => p.id === ep.dataset.editProspect));
  const ef = e.target.closest("[data-edit-followup]");
  if (ef)
    openFollowupForm(D.followups.find((p) => p.id === ef.dataset.editFollowup));
  const ei = e.target.closest("[data-edit-initiative]");
  if (ei)
    openInitiativeForm(
      D.initiatives.find((p) => p.id === ei.dataset.editInitiative),
    );
  const plan = e.target.closest("[data-plan-zip]");
  if (plan) {
    setStudioView("planner");
    document.querySelector('#expansion-form [name="zip"]').value =
      /^\d{5}$/.test(plan.dataset.planZip) ? plan.dataset.planZip : "";
    document.querySelector('#expansion-form [name="title"]').focus();
  }
  const load = e.target.closest("[data-load-scenario]");
  if (load) {
    const p = D.scenarios.find((p) => p.id === load.dataset.loadScenario);
    if (p) {
      activeScenario = p;
      scenarioInsertId = null;
      for (const [key, value] of Object.entries(p)) {
        const el = document
          .getElementById("expansion-form")
          .elements.namedItem(key);
        if (el) el.value = value ?? "";
      }
      renderExpansionResults();
      document.getElementById("scenario-save").textContent =
        "Update shared plan";
      document
        .getElementById("expansion-form")
        .scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  const toggle = e.target.closest("[data-toggle-followup]"),
    archive = e.target.closest("[data-archive-scenario]");
  if (toggle || archive) {
    const b = toggle || archive,
      epoch = authEpoch;
    b.disabled = true;
    try {
      const record = toggle
        ? D.followups.find((f) => f.id === b.dataset.toggleFollowup)
        : D.scenarios.find((p) => p.id === b.dataset.archiveScenario);
      await persistShared(
        toggle ? "customer_followups" : "territory_scenarios",
        toggle
          ? { completed: !record.completed }
          : { archived: !record.archived },
        record,
      );
      if (epoch !== authEpoch) return;
      if (archive && activeScenario?.id === record.id) resetScenario();
      await reloadAfterWrite();
      showToast(
        toggle
          ? "Action updated."
          : "Plan updated. Use Include archived to find archived plans.",
      );
    } catch (err) {
      if (epoch === authEpoch) {
        showToast(err.message);
        if (b.isConnected) b.disabled = false;
      }
    }
  }
});
document
  .getElementById("scenario-show-archived")
  .addEventListener("change", () => {
    if (D) renderSavedScenarios(D);
  });
document
  .getElementById("pipeline-search")
  .addEventListener("input", () => renderProspectBoard());
document
  .getElementById("pipeline-archived")
  .addEventListener("change", () => renderProspectBoard());
document
  .getElementById("prospect-board")
  .addEventListener("change", async (e) => {
    const select = e.target.closest("[data-prospect-stage]");
    if (!select || !D) return;
    const record = D.prospects.find(
        (p) => p.id === select.dataset.prospectStage,
      ),
      epoch = authEpoch;
    select.disabled = true;
    try {
      await persistShared(
        "territory_prospects",
        { stage: select.value },
        record,
      );
      if (epoch === authEpoch) await reloadAfterWrite();
    } catch (err) {
      if (epoch === authEpoch && select.isConnected) {
        select.value = record.stage;
        select.disabled = false;
        showToast(err.message);
      }
    }
  });
document
  .getElementById("territory-search")
  .addEventListener("input", () => renderZipPills());
document
  .getElementById("expansion-form")
  .addEventListener("input", renderExpansionResults);
function resetScenario() {
  activeScenario = null;
  scenarioInsertId = null;
  document.getElementById("expansion-form").reset();
  document.getElementById("scenario-error").textContent = "";
  document.getElementById("scenario-save").textContent = "Save shared plan";
  renderExpansionResults();
}
document
  .getElementById("scenario-reset")
  .addEventListener("click", resetScenario);
document
  .getElementById("expansion-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!D) return;
    const p = expansionInputs(),
      error = document.getElementById("scenario-error"),
      button = document.getElementById("scenario-save"),
      epoch = authEpoch;
    if (!calculateExpansion(p)) {
      error.textContent =
        "Enter valid business assumptions in every numeric field.";
      return;
    }
    button.disabled = true;
    error.textContent = "";
    scenarioInsertId ||= crypto.randomUUID();
    try {
      const saved = await persistShared(
        "territory_scenarios",
        {
          title: p.title.trim(),
          zip: p.zip || null,
          ...Object.fromEntries(
            [
              "customers",
              "order_value",
              "orders_per_month",
              "margin_pct",
              "monthly_cost",
            ].map((k) => [k, Number(p[k])]),
          ),
        },
        activeScenario,
        scenarioInsertId,
      );
      if (epoch !== authEpoch) return;
      await reloadAfterWrite();
      activeScenario = D.scenarios.find((s) => s.id === saved.id) || null;
      scenarioInsertId = null;
      button.textContent = "Update shared plan";
      showToast("Shared plan saved. Reported sales are unchanged.");
    } catch (err) {
      if (epoch === authEpoch) error.textContent = err.message;
    } finally {
      if (epoch === authEpoch) button.disabled = false;
    }
  });
document.getElementById("print-owner-brief").addEventListener("click", () => {
  document.body.classList.add("printing-owner-brief");
  window.print();
});
window.addEventListener("afterprint", () =>
  document.body.classList.remove("printing-owner-brief"),
);
