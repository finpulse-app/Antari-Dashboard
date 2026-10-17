"use strict";
let territoryMap,
  territoryLayer,
  territoryLabels,
  boundaryData,
  selectedZip = null,
  territoryDataset;
const territoryGroups = new Map();
const territoryLabelMarkers = new Map();
function territoryStats(d) {
  const groups = new Map();
  for (const customer of d.storeData) {
    const zip = customer.zip || "Unassigned";
    if (!groups.has(zip))
      groups.set(zip, {
        zip,
        customers: [],
        revenue: 0,
        outstanding: 0,
        invoices: 0,
      });
    const group = groups.get(zip);
    group.customers.push(customer);
    group.revenue += Number(customer.total_revenue);
    group.outstanding += Number(customer.outstanding_balance);
    group.invoices += Number(customer.invoices);
  }
  return groups;
}
function metricValue(group) {
  const metric = document.getElementById("map-metric").value;
  return metric === "customers" ? group.customers.length : group[metric];
}
function territoryColor(group) {
  if (!group) return "#e0e4d9";
  const max = Math.max(1, ...[...territoryGroups.values()].map(metricValue));
  const t = Math.max(0, Math.min(1, metricValue(group) / max));
  const start = [181, 198, 169],
    end = [36, 78, 63];
  return `rgb(${start.map((v, i) => Math.round(v + (end[i] - v) * t)).join(",")})`;
}
function territoryStyle(feature) {
  const zip = feature.properties.zcta5,
    group = territoryGroups.get(zip);
  return {
    color: zip === selectedZip ? "#b58a40" : group ? "#fcfcf5" : "#c9d0c3",
    weight: zip === selectedZip ? 3 : group ? 1.5 : 0.6,
    fillColor: territoryColor(group),
    fillOpacity: group?.customers.length ? 0.95 : 0.65,
  };
}
async function renderTerritories(d) {
  territoryDataset = d;
  territoryGroups.clear();
  for (const [zip, group] of territoryStats(d)) territoryGroups.set(zip, group);
  const groups = [...territoryGroups.values()].sort(
    (a, b) => b.revenue - a.revenue,
  );
  if (!territoryGroups.has(selectedZip)) selectedZip = groups[0]?.zip || null;
  renderZipPills();
  renderTerritoryDetail();
  if (!territoryMap) {
    territoryMap = L.map("territory-map", {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false,
      minZoom: 9,
      maxZoom: 16,
      zoomSnap: 0.25,
    });
    territoryMap.setView([40.66, -73.93], 11);
    L.control
      .attribution({ prefix: false })
      .addTo(territoryMap)
      .addAttribution(
        'Boundaries: <a href="https://data.cityofnewyork.us/City-Government/ZIP-Code-Tabulation-Areas/35j5-n34v">NYC Open Data</a>',
      );
    // No remote basemap: geographic context comes from bundled public boundary geometry.
    territoryLabels = L.layerGroup().addTo(territoryMap);
    territoryMap.on("zoomend", updateMapLabels);
  }
  try {
    if (!boundaryData) {
      const response = await fetch("assets/nyc-zcta.geojson");
      if (!response.ok) throw Error("Boundary data unavailable");
      boundaryData = await response.json();
    }
    if (territoryDataset !== d) return;
    if (territoryLayer) territoryLayer.remove();
    territoryLabels.clearLayers();
    territoryLabelMarkers.clear();
    territoryLayer = L.geoJSON(boundaryData, {
      style: territoryStyle,
      onEachFeature: (feature, layer) => {
        const zip = feature.properties.zcta5,
          group = territoryGroups.get(zip);
        if (group) {
          const tip = document.createElement("div");
          tip.textContent = `${zip} · ${group.customers.length} customers · ${fmt(group.revenue)}`;
          layer.bindTooltip(tip, { sticky: true });
          layer.on("click", () => selectTerritory(zip));
          layer.on("mouseover", () =>
            layer.setStyle({ weight: 3, color: "#a3844a" }),
          );
          layer.on("mouseout", () => territoryLayer.resetStyle(layer));
          const lat = Number(feature.properties.centlat),
            lng = Number(feature.properties.centlon);
          const marker = L.marker([lat, lng], {
            icon: L.divIcon({
              className: "territory-label",
              html: `<span>${esc(zip)}</span>`,
              iconSize: [55, 22],
              iconAnchor: [27, 11],
            }),
            interactive: false,
            keyboard: false,
          }).addTo(territoryLabels);
          territoryLabelMarkers.set(zip, marker);
        }
      },
    }).addTo(territoryMap);
    territoryLayer.eachLayer((layer) => {
      if (territoryGroups.has(layer.feature.properties.zcta5)) {
        layer.bringToFront();
        const el = layer.getElement();
        if (el) {
          el.setAttribute("tabindex", "0");
          el.setAttribute("role", "button");
          el.setAttribute(
            "aria-label",
            `ZIP ${layer.feature.properties.zcta5}`,
          );
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectTerritory(layer.feature.properties.zcta5);
            }
          });
        }
      }
    });
    if (document.getElementById("panel-zips").classList.contains("active"))
      refreshTerritoryMap();
  } catch (error) {
    document
      .getElementById("territory-map")
      .setAttribute("aria-label", error.message);
    document
      .getElementById("territory-details")
      .insertAdjacentHTML(
        "beforeend",
        '<p class="empty-note">The map could not load. Use the ZIP buttons below to explore all territories.</p>',
      );
  }
}
function fitTerritories() {
  if (!territoryLayer) return;
  const layers = territoryLayer
    .getLayers()
    .filter((layer) => territoryGroups.has(layer.feature.properties.zcta5));
  if (layers.length)
    territoryMap.fitBounds(L.featureGroup(layers).getBounds(), {
      padding: [35, 35],
      maxZoom: 12,
      animate: false,
    });
  updateMapLabels();
}
function refreshTerritoryMap() {
  if (!territoryMap) return;
  territoryMap.invalidateSize();
  fitTerritories();
}
function selectTerritory(zip) {
  selectedZip = zip;
  renderTerritoryDetail();
  renderZipPills();
  if (territoryLayer) territoryLayer.setStyle(territoryStyle);
  updateMapLabels();
}
function renderZipPills() {
  document.getElementById("territory-zip-list").innerHTML = [
    ...territoryGroups.values(),
  ]
    .sort((a, b) => a.zip.localeCompare(b.zip))
    .map(
      (group) =>
        `<button class="zip-pill ${group.zip === selectedZip ? "selected" : ""}" data-territory="${esc(group.zip)}" aria-pressed="${group.zip === selectedZip}">${esc(group.zip)}<small>${group.customers.length}</small></button>`,
    )
    .join("");
}
function renderTerritoryDetail() {
  const group = territoryGroups.get(selectedZip),
    box = document.getElementById("territory-details");
  if (!group) {
    box.innerHTML =
      '<span class="eyebrow">YOUR TERRITORIES</span><h2>Start with a customer.</h2><p class="empty-note">Add customers with ZIP codes to see your distribution footprint.</p>';
    return;
  }
  const ranked = [...group.customers].sort(
    (a, b) => Number(b.total_revenue) - Number(a.total_revenue),
  );
  const total = sumOf(territoryDataset.storeData, (s) => s.total_revenue),
    active = ranked.filter((s) => Number(s.total_revenue) > 0),
    routes = new Set(ranked.map((s) => s.delivery_route).filter(Boolean));
  const highest = ranked[0],
    share = total > 0 ? (group.revenue / total) * 100 : 0;
  box.innerHTML = `<span class="eyebrow">TERRITORY PROFILE</span><h2>${esc(group.zip)}</h2><p class="territory-summary">${group.customers.length} customer${group.customers.length === 1 ? "" : "s"} · ${routes.size} delivery route${routes.size === 1 ? "" : "s"}</p><div class="territory-metrics"><div><small>Wholesale revenue</small><b>${fmt(group.revenue)}</b></div><div><small>Outstanding balance</small><b class="red-text">${fmt(group.outstanding)}</b></div></div><div class="territory-insight"><span class="eyebrow">WHAT TO KNOW</span><p>${share.toFixed(1)}% of listed-customer revenue comes from this territory. ${active.length} of ${ranked.length} customers have purchases in loaded reports.${highest && Number(highest.total_revenue) > 0 ? ` ${esc(highest.store_name)} leads with ${fmt(highest.total_revenue)}.` : ""}</p></div><div class="territory-customers">${ranked.map((s) => `<button data-customer="${esc(s.store_name)}"><span>${esc(s.store_name)}<small>${esc(s.delivery_route || "Unassigned route")}</small></span><span>${fmt(s.total_revenue)}<small>${Number(s.outstanding_balance) > 0 ? `${fmt(s.outstanding_balance)} owed` : "No open balance"}</small></span></button>`).join("")}</div><button class="btn-sm quiet" data-goto="receivables">Open collections workspace ↗</button>`;
}
document.getElementById("territory-zip-list").addEventListener("click", (e) => {
  const button = e.target.closest("[data-territory]");
  if (button) selectTerritory(button.dataset.territory);
});
document.getElementById("map-metric").addEventListener("change", () => {
  if (territoryLayer) territoryLayer.setStyle(territoryStyle);
  updateMapLabels();
});
document.getElementById("map-fit").addEventListener("click", fitTerritories);

function updateMapLabels() {
  if (!territoryMap) return;
  for (const [zip, marker] of territoryLabelMarkers) {
    const element = marker.getElement();
    if (element)
      element.style.display =
        territoryMap.getZoom() >= 12.2 || zip === selectedZip ? "" : "none";
  }
}

function clearTerritories() {
  territoryDataset = null;
  selectedZip = null;
  territoryGroups.clear();
  territoryLabelMarkers.clear();
  territoryMap?.remove();
  territoryMap = null;
  territoryLayer = null;
  territoryLabels = null;
  document.getElementById("territory-details").replaceChildren();
  document.getElementById("territory-zip-list").replaceChildren();
}
