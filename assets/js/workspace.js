"use strict";
const viewInfo = {
  overview: [
    "Business overview",
    "Sales, balances, and customers in one place.",
  ],
  stores: [
    "Your customers",
    "Find a customer, check their activity, or review a balance.",
  ],
  products: [
    "Product portfolio",
    "Sales and units for each product in your catalog.",
  ],
  receivables: [
    "Cash & collections",
    "A clear record of money owed and payments received.",
  ],
  trends: [
    "Business performance",
    "Compare sales and collections when complete reporting periods are available.",
  ],
  routes: ["Delivery routes", "Your customer network, organized for the road."],
  zips: [
    "Territory insights",
    "Explore your footprint. Prepare your next conversation. Plan your next move.",
  ],
  data: [
    "Data confidence",
    "Know where your numbers come from, and what needs review.",
  ],
  upload: [
    "Import workspace",
    "Bring your Zoho and Square reports together. Check first, then save.",
  ],
};
function navigateTo(view, updateHash = true) {
  if (view === "routes") view = "zips";
  if (!viewInfo[view]) view = "overview";
  document.body.dataset.view = view;
  document.body.classList.remove("search-open");
  document
    .getElementById("mobile-search-toggle")
    .setAttribute("aria-expanded", "false");
  if (updateHash) {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.toggle("active", p.id === "panel-" + view));
  document.getElementById("page-title").textContent = viewInfo[view][0];
  document.getElementById("page-description").textContent = viewInfo[view][1];
  document.getElementById("breadcrumb-view").textContent = document
    .querySelector(`.tab[data-tab="${view}"]`)
    .textContent.trim()
    .slice(1)
    .trim();
  document.title = `Antari: ${viewInfo[view][0]}`;
  document.body.classList.remove("nav-open");
  document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
  if (updateHash) history.replaceState(null, "", "#" + view);
  if (view === "zips" && typeof refreshTerritoryMap === "function")
    requestAnimationFrame(refreshTerritoryMap);
}
document
  .querySelectorAll(".tab")
  .forEach((tab) =>
    tab.addEventListener("click", () => navigateTo(tab.dataset.tab)),
  );
window.addEventListener("hashchange", () =>
  navigateTo(location.hash.slice(1), false),
);
navigateTo(location.hash.slice(1), false);
document.getElementById("menu-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("nav-open");
  document
    .getElementById("menu-toggle")
    .setAttribute("aria-expanded", String(open));
});
document.getElementById("sidebar-scrim").addEventListener("click", () => {
  document.body.classList.remove("nav-open");
  document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
});
document.getElementById("refresh-data").addEventListener("click", () => {
  if (authUserId) load();
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (D) document.getElementById("global-search").focus();
  }
  if (e.key === "Escape") {
    document.body.classList.remove("nav-open", "search-open");
    document
      .getElementById("menu-toggle")
      .setAttribute("aria-expanded", "false");
    document
      .getElementById("mobile-search-toggle")
      .setAttribute("aria-expanded", "false");
    document.getElementById("search-results").style.display = "none";
  }
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches(
      '[role="button"]:not(button),.sr-item,.src,.back-link,.tile,[data-prod]',
    )
  ) {
    e.preventDefault();
    e.target.click();
  }
});
document.getElementById("dropzone").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    document.getElementById("file-input").click();
  }
});
document.getElementById("zip-tiles").addEventListener("click", (e) => {
  const tile = e.target.closest("[data-zip]");
  if (tile) showZipDrilldown(tile.dataset.zip);
});
document.getElementById("route-tiles").addEventListener("click", (e) => {
  const tile = e.target.closest("[data-route]");
  if (tile) showRouteDrilldown(tile.dataset.route);
});
function showLoadError(error) {
  if (D) {
    const warning = document.getElementById("refresh-warning");
    warning.hidden = false;
    warning.textContent =
      "Refresh failed. Showing the last successful data. " +
      (error.message || "Try again.");
    document.getElementById("sync-status").classList.add("stale");
  } else {
    const status = document.getElementById("status");
    status.style.display = "block";
    const p = document.createElement("p");
    p.textContent =
      "Unable to load the workspace. " + (error.message || "Try again.");
    const button = document.createElement("button");
    button.className = "btn-solid";
    button.textContent = "Try again";
    button.addEventListener("click", () => load());
    status.replaceChildren(p, button);
  }
}
async function fetchAllRows(factory, orderKeys, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = factory();
    for (const column of orderKeys)
      query = query.order(column, { ascending: true, nullsFirst: false });
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message || "Database request failed.");
    if (!Array.isArray(data))
      throw new Error("The database returned an invalid response.");
    rows.push(...data);
    if (data.length < pageSize) return rows;
    if (rows.length >= 100000)
      throw new Error(
        "This dataset needs server-side aggregation before it can be loaded safely.",
      );
  }
}
function customerRows() {
  if (!D) return [];
  const q = document
    .getElementById("customer-filter")
    .value.trim()
    .toLowerCase();
  const rows = D.storeData.filter((s) =>
    [s.store_name, s.zip, s.delivery_route, s.category].some((v) =>
      String(v || "")
        .toLowerCase()
        .includes(q),
    ),
  );
  const sort = document.getElementById("customer-sort").value;
  return rows.sort(
    sort === "name"
      ? (a, b) => a.store_name.localeCompare(b.store_name)
      : (a, b) =>
          Number(
            b[sort === "outstanding" ? "outstanding_balance" : "total_revenue"],
          ) -
          Number(
            a[sort === "outstanding" ? "outstanding_balance" : "total_revenue"],
          ),
  );
}
function renderDirectory() {
  const rows = customerRows();
  document.getElementById("customer-directory").innerHTML =
    `<div class="table-scroll"><table class="tbl"><thead><tr><th>Customer</th><th>Territory / route</th><th class="num">Revenue</th><th class="num">Invoices</th><th class="num">Outstanding</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td><button class="table-link" data-customer="${esc(s.store_name)}">${esc(s.store_name)}</button><span class="customer-meta">${esc(s.category || "Customer")}</span></td><td>${esc(s.zip || "No ZIP")}<span class="customer-meta">${esc(s.delivery_route || "Unassigned")}</span></td><td class="num">${fmt(s.total_revenue)}</td><td class="num">${Number(s.invoices)}</td><td class="num ${Number(s.outstanding_balance) > 0 ? "red-text" : ""}">${fmt(s.outstanding_balance)}</td><td><button class="btn-sm quiet" data-customer="${esc(s.store_name)}">Details ↗</button></td></tr>`).join("") || '<tr><td colspan="6">No matching customers.</td></tr>'}</tbody></table></div><p class="directory-count">${rows.length} of ${D.storeData.length} customers · All loaded reporting periods</p>`;
}
document
  .getElementById("customer-filter")
  .addEventListener("input", renderDirectory);
document
  .getElementById("customer-sort")
  .addEventListener("change", renderDirectory);
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-customer]");
  if (b && D) {
    const s = D.storeData.find((s) => s.store_name === b.dataset.customer);
    if (s) openModal(s);
  }
});
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
document.getElementById("export-customers").addEventListener("click", () => {
  const rows = [
    [
      "Customer",
      "Category",
      "ZIP",
      "Route",
      "Revenue",
      "Invoices",
      "Outstanding",
    ],
    ...customerRows().map((s) => [
      s.store_name,
      s.category,
      s.zip,
      s.delivery_route,
      Number(s.total_revenue).toFixed(2),
      s.invoices,
      Number(s.outstanding_balance).toFixed(2),
    ]),
  ];
  const url = URL.createObjectURL(
    new Blob(
      ["\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `Antari-customers-${ymd(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function renderWorkspace(d) {
  document.getElementById("refresh-warning").hidden = true;
  const sync = document.getElementById("sync-status");
  sync.classList.remove("stale");
  sync.textContent =
    "Updated " +
    new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  document.getElementById("preview-banner").hidden = !isPreview;
  const total = d.wholesale + d.direct;
  const share = total > 0 ? (d.wholesale / total) * 100 : 0;
  const periods = (source) => sourceSummary(d.srcMonths, source);
  document.getElementById("channel-composition").innerHTML =
    `<div class="composition-inner"><div class="channel-ring"><svg viewBox="0 0 120 120" role="img" aria-label="Wholesale ${share.toFixed(1)} percent, festival ${(100 - share).toFixed(1)} percent of loaded revenue"><circle cx="60" cy="60" r="49" fill="none" stroke="#e7e9df" stroke-width="11"/><circle cx="60" cy="60" r="49" fill="none" stroke="#ba995e" stroke-width="11" pathLength="100" stroke-dasharray="${total > 0 ? 100 : 0} 100"/><circle cx="60" cy="60" r="49" fill="none" stroke="#31554a" stroke-width="11" pathLength="100" stroke-dasharray="${Math.max(0, Math.min(100, share))} 100"/></svg><div class="ring-label"><b>${fmtCompact(total)}</b><small>Reported sales</small></div></div><div class="channel-legend"><div class="legend-row"><i></i><span>Wholesale<small>${share.toFixed(1)}% of loaded revenue</small></span><b>${fmt(d.wholesale)}</b></div><div class="legend-row festival"><i></i><span>Direct / festival<small>${total > 0 ? (100 - share).toFixed(1) : "0.0"}% of loaded revenue</small></span><b>${fmt(d.direct)}</b></div></div></div><div class="composition-note">Wholesale: ${esc(periods("wholesale"))}. Festival: ${esc(periods("festival"))}.<br>Each channel includes its own loaded date coverage; these are not necessarily matching periods. Square item reports use gross sales, before discounts, refunds, taxes, and fees.</div>`;
  const owed = sumOf(d.openBalances, (x) => x.outstanding_balance);
  const navs = ["overview", "stores", "upload", "receivables", "data"];
  document.querySelectorAll(".kpi").forEach((card, i) => {
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.dataset.goto = navs[i];
    card.title = card.querySelector(".val").textContent;
  });
  document.getElementById("mobile-sales").textContent = fmtCompact(total);
  document.getElementById("mobile-owed").textContent = fmtCompact(owed);
  renderDailyBriefing(d);
  renderTerritoryStudio(d);
  renderDirectory();
  if (typeof renderTerritories === "function") renderTerritories(d);
  enhanceInteractions();
}
// Dynamic legacy components receive keyboard semantics and independent table scrolling.
function enhanceInteractions() {
  document
    .querySelectorAll(".tile,.tile-xl,.sr-item,.back-link,a.src,tr[data-prod]")
    .forEach((el) => {
      if (!el.matches("a[href],button")) {
        el.tabIndex = 0;
        el.setAttribute("role", "button");
      }
    });
  document.querySelectorAll("table").forEach((table) => {
    if (!table.parentElement.classList.contains("table-scroll")) {
      const wrap = document.createElement("div");
      wrap.className = "table-scroll";
      table.replaceWith(wrap);
      wrap.append(table);
    }
  });
}
let focusReturn = null;
const observer = new MutationObserver((records) => {
  for (const record of records) {
    const backdrop = record.target;
    if (record.type === "attributes" && backdrop.matches(".modal-backdrop")) {
      if (backdrop.classList.contains("open")) {
        focusReturn = document.activeElement;
        document.body.style.overflow = "hidden";
        document.body.classList.add("modal-visible");
        backdrop.querySelector(".modal").focus();
      } else if (!document.querySelector(".modal-backdrop.open")) {
        document.body.style.overflow = "";
        document.body.classList.remove("modal-visible");
        if (focusReturn?.isConnected) focusReturn.focus();
      }
    }
  }
  enhanceInteractions();
});
observer.observe(document.getElementById("content"), {
  childList: true,
  subtree: true,
});
document.querySelectorAll(".modal-backdrop").forEach((m) =>
  observer.observe(m, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  }),
);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const open = [...document.querySelectorAll(".modal-backdrop.open")].at(-1);
  if (!open) return;
  const items = [
    ...open.querySelectorAll(
      'button,input,textarea,select,a[href],[tabindex="0"]',
    ),
  ].filter((el) => !el.disabled && el.getClientRects().length);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0],
    last = items.at(-1);
  if (
    e.shiftKey &&
    (document.activeElement === first ||
      document.activeElement.matches(".modal"))
  ) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
// Register auth only after the last deferred module and all load helpers exist.
sb.auth.onAuthStateChange((event, session) => {
  if (
    ["INITIAL_SESSION", "SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(
      event,
    )
  ) {
    setTimeout(() => applySession(session).catch(showLoadError), 0);
  }
});

if (isPreview)
  applySession({ user: { id: "preview", email: "Design preview" } }).catch(
    showLoadError,
  );
else
  sb.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return applySession(data.session);
    })
    .catch((error) => {
      clearWorkspace();
      document.getElementById("auth-msg").textContent = error.message;
    });
document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]");
  if (action) {
    const name = action.dataset.action,
      value = action.dataset.value;
    const actions = {
      showZipGrid,
      showRouteGrid,
      closeModal,
      gmClose,
      toggleAllStores: () => toggleAllStores(value === "true"),
      toggleAllProducts: () => toggleAllProducts(value === "true"),
      setPaymentRange: () => setPaymentRange(Number(value)),
    };
    if (Object.hasOwn(actions, name)) actions[name]();
  }
  const dismiss = e.target.closest("[data-dismiss]");
  if (dismiss) {
    delete uploadQueue[dismiss.dataset.dismiss];
    document.getElementById("uc-" + dismiss.dataset.dismiss)?.remove();
  }
  const upload = e.target.closest("[data-import]");
  if (upload)
    importRows(upload.dataset.import).catch((error) =>
      showToast(error.message),
    );
});

async function reloadAfterWrite() {
  const epoch = authEpoch;
  if (loadInFlight) await loadInFlight.promise;
  if (epoch === authEpoch && authUserId) return load(epoch);
}
