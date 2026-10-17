"use strict";
// ---------------- Upload: check first, save only if everything passes ----------------
const REPORT_LABEL = {
  sales_customer: "Sales by Customer",
  sales_item: "Sales by Item",
  customer_balances: "Customer Balances",
  payments_received: "Payments Received",
  festival_sales: "Square festival report",
};
const TOTAL_KEY = {
  sales_customer: "sales",
  sales_item: "sales",
  customer_balances: "outstanding_balance",
  payments_received: "amount",
  festival_sales: "sales",
};
const toDbType = (t) => (t === "festival_square" ? "festival_sales" : t);
let uploadQueue = {};

// dryRun = true only asks the database "what would happen?"; false saves (all-or-nothing).
function callImport(pkg, dryRun) {
  return sb.rpc("import_report", {
    p_type: pkg.dbType,
    p_period_start: pkg.period.start || null,
    p_period_end: pkg.period.end || null,
    p_as_of: pkg.period.asOf || null,
    p_file_name: pkg.fileName || null,
    p_source_total: pkg.source ? pkg.source.amount : null,
    p_rows: pkg.rows,
    p_dry_run: dryRun,
  });
}

async function handleFiles(files) {
  if (files.length > 10) {
    showToast("Choose up to 10 PDFs at a time.");
    return;
  }
  const epoch = authEpoch;
  for (const file of Array.from(files)) {
    if (epoch !== authEpoch || !authUserId) return;
    const id = Math.random().toString(36).slice(2);
    const card = document.createElement("div");
    card.className = "upload-card";
    card.id = "uc-" + id;
    card.innerHTML = `<div class="uc-header"><span class="uc-title">${esc(file.name)}</span><span class="uc-badge warn">Reading…</span></div>`;
    document.getElementById("upload-results").prepend(card);
    try {
      const text = await extractTextFromPdf(file);
      if (epoch !== authEpoch || !authUserId) return;
      const type = detectType(text);
      const period = extractPeriod(text);
      let rows = [];
      if (type === "sales_customer") rows = parseSalesCustomer(text);
      else if (type === "sales_item") rows = parseSalesItem(text);
      else if (type === "customer_balances") rows = parseBalances(text);
      else if (type === "payments_received") rows = parsePayments(text);
      else if (type === "festival_square") {
        const r = parseFestivalSquare(text);
        rows = r.rows;
        Object.assign(period, r.period);
      }
      if (type === "unknown" || rows.length === 0) {
        card.innerHTML = `<div class="uc-header"><span class="uc-title">${esc(file.name)}</span><span class="uc-badge err">Not recognized</span></div>
            <div class="uc-note">I couldn't tell which report this is, or found no rows in it. Nothing was saved.</div>
            <div class="uc-actions"><button type="button" class="btn-dismiss" data-dismiss="${id}">Dismiss</button></div>`;
        continue;
      }
      uploadQueue[id] = {
        type,
        dbType: toDbType(type),
        period,
        rows,
        source: extractSourceTotal(type, text),
        fileName: file.name,
      };
      card.querySelector(".uc-badge").textContent = "Checking…";
      renderUploadCard(id, await callImport(uploadQueue[id], true));
    } catch (err) {
      card.innerHTML = `<div class="uc-header"><span class="uc-title">${esc(file.name)}</span><span class="uc-badge err">Failed</span></div><div class="uc-note">${esc(err.message)}</div>
          <div class="uc-actions"><button type="button" class="btn-dismiss" data-dismiss="${id}">Dismiss</button></div>`;
    }
  }
}

const chk = (ok, html) =>
  `<div class="chk ${ok ? "chk-ok" : "chk-bad"}"><span class="chk-mark">${ok ? "✓" : "✕"}</span><span>${html}</span></div>`;
const periodLabel = (p) =>
  p.start
    ? `${fmtDate(p.start)} to ${fmtDate(p.end)}`
    : p.asOf
      ? `as of ${fmtDate(p.asOf)}`
      : "dates not found";

function renderUploadCard(id, res) {
  const pkg = uploadQueue[id],
    card = document.getElementById("uc-" + id);
  if (!pkg || !card || pkg.saving) return;
  const label = REPORT_LABEL[pkg.dbType];
  const dismiss = `<button type="button" class="btn-dismiss" data-dismiss="${id}">Dismiss</button>`;
  if (res.error) {
    card.innerHTML = `<div class="uc-header"><span class="uc-title">${esc(pkg.fileName)}</span><span class="uc-badge err">Couldn't check</span></div>
        <div class="uc-note">${esc(res.error.message)} Nothing was saved.</div><div class="uc-actions">${dismiss}</div>`;
    return;
  }
  const r = res.data;
  const parsed = pkg.rows.reduce(
    (s, x) => s + Number(x[TOTAL_KEY[pkg.dbType]] || 0),
    0,
  );

  // Extra checks the report allows: counts it prints, and payment lines I couldn't read.
  const problems = [];
  if (r.reconcile_reason) problems.push(r.reconcile_reason);
  if (pkg.source && pkg.source.count != null) {
    const c = pkg.rows.reduce((s, x) => s + Number(x.invoice_count || 0), 0);
    if (c !== pkg.source.count)
      problems.push(
        `I counted ${c} invoices but the report says ${pkg.source.count}.`,
      );
  }
  if (pkg.source && pkg.source.qty != null) {
    const q = pkg.rows.reduce((s, x) => s + Number(x.quantity_sold || 0), 0);
    if (Math.abs(q - pkg.source.qty) > 0.005)
      problems.push(
        `I counted ${q.toLocaleString()} units but the report says ${Number(pkg.source.qty).toLocaleString()}.`,
      );
  }
  const unreadable = pkg.rows.unparsed || [];
  if (unreadable.length)
    problems.push(
      `${unreadable.length} payment line${unreadable.length === 1 ? "" : "s"} in the file couldn't be read.`,
    );

  let conflictOk;
  if (pkg.dbType === "payments_received")
    conflictOk = chk(
      !r.conflict_reason,
      r.conflict_reason
        ? esc(r.conflict_reason)
        : `${r.to_add} new payment${r.to_add === 1 ? "" : "s"} to add · ${r.skipped} already on file (skipped, not doubled)`,
    );
  else if (pkg.dbType === "customer_balances")
    conflictOk = chk(
      !r.conflict_reason,
      r.conflict_reason
        ? esc(r.conflict_reason)
        : `New date: becomes your current "Owed to you" (older balance reports stay in the history)`,
    );
  else
    conflictOk = chk(
      !r.conflict_reason,
      r.conflict_reason
        ? esc(r.conflict_reason)
        : `No overlap with anything already loaded: these numbers get added to your totals`,
    );

  const canImport = r.ok && problems.length === 0;
  pkg.approved = canImport;
  const checks =
    (problems.length
      ? problems.map((p) => chk(false, esc(p))).join("")
      : chk(true, `Adds up to the report's own total (${fmt(parsed)})`)) +
    conflictOk;

  const previewRows = pkg.rows.slice(0, 5);
  const cols = Object.keys(previewRows[0]);
  const preview = `<details class="uc-details"><summary>Show the first 5 rows I read</summary><table class="preview-table"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${previewRows.map((x) => `<tr>${cols.map((c) => `<td>${esc(["amount", "sales", "outstanding_balance"].includes(c) ? fmt(x[c]) : x[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
  const unreadableBox = unreadable.length
    ? `<details class="uc-details"><summary>Show the lines I couldn't read</summary><pre>${esc(unreadable.join("\n"))}</pre></details>`
    : "";
  const btnLabel =
    pkg.dbType === "payments_received"
      ? `Add ${r.to_add} new payment${r.to_add === 1 ? "" : "s"}`
      : `Add ${r.rows_in_file} rows`;

  card.innerHTML = `
      <div class="uc-header"><span class="uc-title">${esc(pkg.fileName)}</span><span class="uc-badge ${canImport ? "ok" : "err"}">${label}</span></div>
      <div class="uc-type">${periodLabel(pkg.period)} · ${r.rows_in_file} rows read</div>
      <div style="margin-top:8px;">${checks}</div>
      ${unreadableBox}${preview}
      <div class="uc-actions">
        <button type="button" class="btn-import" data-import="${id}" ${canImport ? "" : "disabled"}>${canImport ? btnLabel : "Can't import this one"}</button>
        ${dismiss}
      </div>
      ${canImport ? "" : `<div class="uc-note">Nothing was saved. ${r.conflict_reason || problems.length ? "Fix the issue above (or dismiss this) and try again." : ""}</div>`}`;
}

async function importRows(id) {
  const pkg = uploadQueue[id],
    card = document.getElementById("uc-" + id);
  if (!pkg || !card || pkg.saving || !pkg.approved) return;
  pkg.saving = true;
  const btn = card.querySelector(".btn-import");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  const { data, error } = await callImport(pkg, false); // the database re-checks everything and saves all-or-nothing
  if (error) {
    card.insertAdjacentHTML(
      "beforeend",
      `<div class="uc-note" style="color:var(--red);">Not saved: ${esc(error.message)}</div>`,
    );
    pkg.saving = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Retry import";
    }
    return;
  }
  delete uploadQueue[id];
  card.innerHTML = `<div class="uc-header"><span class="uc-title">${esc(pkg.fileName)}</span><span class="uc-badge ok">Imported ✓</span></div>
      <div class="uc-note">${esc(REPORT_LABEL[pkg.dbType])}: added ${data.added} row${data.added === 1 ? "" : "s"}${data.skipped ? `, skipped ${data.skipped} already on file` : ""}. Every number on the dashboard now includes it.</div>`;
  await reloadAfterWrite();
}

async function renderImportHistory(rows) {
  const el = document.getElementById("import-history");
  if (!el) return;
  let data = rows;
  if (!data) {
    const res = await sb
      .from("import_batches")
      .select("*")
      .order("imported_at", { ascending: false })
      .limit(300);
    if (res.error) {
      el.innerHTML = `<p class="pulse-sub">Couldn't load import history: ${esc(res.error.message)}</p>`;
      return;
    }
    data = res.data;
  }
  if (!data.length) {
    el.innerHTML = "";
    return;
  }
  const covers = (b) =>
    b.period_start
      ? `${fmtDate(b.period_start)} to ${fmtDate(b.period_end)}`
      : b.as_of_date
        ? `as of ${fmtDate(b.as_of_date)}`
        : "Not available";
  const when = (b) =>
    new Date(b.imported_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  el.innerHTML = `<h2 class="section-label" style="margin-top:28px;">Import history: what's in the database and where it came from</h2>
      <table class="preview-table hist"><thead><tr><th>#</th><th>Imported</th><th>Report</th><th>Covers</th><th class="num">Rows read / added</th><th class="num">Printed total</th><th class="num">Parsed total</th><th>Check</th></tr></thead><tbody>
      ${data
        .map(
          (
            b,
          ) => `<tr><td>${b.id}</td><td>${when(b)}<div class="pulse-sub">${b.imported_by_email ? esc(b.imported_by_email) : "initial load"}</div></td>
        <td>${esc(REPORT_LABEL[b.report_type] || b.report_type)}${b.file_name ? `<div class="pulse-sub">${esc(b.file_name)}</div>` : ""}</td>
        <td>${covers(b)}</td>
        <td class="num">${b.rows_in_file} / ${b.rows_added}${b.rows_skipped ? `<div class="pulse-sub">${b.rows_skipped} skipped</div>` : ""}${b.notes && b.imported_by_email ? `<div class="pulse-sub">${esc(b.notes)}</div>` : ""}</td>
        <td class="num">${b.source_total != null ? fmt(b.source_total) : "Not available"}</td><td class="num">${b.parsed_total != null ? fmt(b.parsed_total) : "Not available"}</td>
        <td>${b.reconciliation === "pass" ? "✓ matched" : "✕ mismatch"}</td></tr>`,
        )
        .join("")}
      </tbody></table>`;
}
