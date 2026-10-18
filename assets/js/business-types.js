"use strict";
let activeBusinessType = "";
const businessTypeLabels = {
  market: "Groceries & markets",
  restaurant: "Restaurants",
  bakery: "Bakeries",
  deli: "Delis",
  uncategorized: "Uncategorized",
};
function businessTypeKey(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!key) return "uncategorized";
  if (
    [
      "market",
      "markets",
      "grocery",
      "groceries",
      "grocery store",
      "grocery stores",
      "supermarket",
      "groceries & markets",
    ].includes(key)
  )
    return "market";
  if (["restaurant", "restaurants"].includes(key)) return "restaurant";
  if (["bakery", "bakeries"].includes(key)) return "bakery";
  if (["deli", "delis"].includes(key)) return "deli";
  return key;
}
function matchesBusinessType(row) {
  return (
    !activeBusinessType || businessTypeKey(row.category) === activeBusinessType
  );
}
function businessTypeOptions(d) {
  const types = new Map();
  for (const row of [
    ...d.storeData,
    ...(d.prospects || []).filter((p) => !p.archived),
  ]) {
    const key = businessTypeKey(row.category);
    types.set(key, businessTypeLabels[key] || String(row.category).trim());
  }
  return [...types].sort((a, b) => a[1].localeCompare(b[1]));
}
function renderBusinessTypeControls(d) {
  const options = businessTypeOptions(d);
  if (
    activeBusinessType &&
    !options.some(([key]) => key === activeBusinessType)
  )
    activeBusinessType = "";
  for (const select of document.querySelectorAll(
    "[data-business-type-filter]",
  )) {
    select.innerHTML =
      '<option value="">All business types</option>' +
      options
        .map(
          ([key, label]) =>
            `<option value="${esc(key)}">${esc(label)}</option>`,
        )
        .join("");
    select.value = activeBusinessType;
  }
  const summary = document.getElementById("business-filter-status");
  if (summary) {
    summary.hidden = !activeBusinessType;
    summary.textContent = activeBusinessType
      ? `${options.find(([key]) => key === activeBusinessType)?.[1]} · ${d.storeData.filter(matchesBusinessType).length} matching customers. This filter also applies to the customer directory. The owner brief includes all business types.`
      : "";
  }
}
function clearBusinessTypeFilter() {
  activeBusinessType = "";
  for (const select of document.querySelectorAll(
    "[data-business-type-filter]",
  )) {
    select.innerHTML = '<option value="">All business types</option>';
    select.value = "";
  }
  const status = document.getElementById("business-filter-status");
  if (status) {
    status.textContent = "";
    status.hidden = true;
  }
}
function setBusinessTypeFilter(value, zip = null) {
  if (!D) return;
  activeBusinessType = value;
  selectedZip = zip;
  selectedTerritoryCustomer = null;
  attentionOpen = false;
  renderBusinessTypeControls(D);
  renderDirectory();
  renderTerritoryStudio(D);
  if (territoryMap && !zip) territoryMap._antariFitted = false;
  renderTerritories(D);
}
document.addEventListener("change", (e) => {
  if (!e.target.matches("[data-business-type-filter]")) return;
  setBusinessTypeFilter(e.target.value);
});
