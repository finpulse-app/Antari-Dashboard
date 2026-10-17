"use strict";
let territoryMap,
  territoryLayer,
  territoryLabels,
  boundaryData,
  selectedZip = null,
  territoryDataset;
const territoryGroups = new Map();
const territoryLabelMarkers = new Map();
const contextLabelMarkers = [];
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
        prospects: 0,
      });
    const group = groups.get(zip);
    group.customers.push(customer);
    group.revenue += Number(customer.total_revenue);
    group.outstanding += Number(customer.outstanding_balance);
    group.invoices += Number(customer.invoices);
  }
  for (const p of (d.prospects || []).filter(
    (p) => !p.archived && p.stage !== "paused" && p.stage !== "repeat_buyer",
  )) {
    if (!groups.has(p.zip))
      groups.set(p.zip, {
        zip: p.zip,
        customers: [],
        revenue: 0,
        outstanding: 0,
        invoices: 0,
        prospects: 0,
      });
    groups.get(p.zip).prospects++;
  }
  return groups;
}
function metricValue(group) {
  const metric = document.getElementById("map-metric").value;
  return metric === "customers"
    ? group.customers.length
    : Number(group[metric] || 0);
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
    fillOpacity: group && metricValue(group) > 0 ? 0.95 : 0.65,
  };
}
async function renderTerritories(d) {
  territoryDataset = d;
  territoryGroups.clear();
  for (const [zip, group] of territoryStats(d)) territoryGroups.set(zip, group);
  const groups = [...territoryGroups.values()].sort(
    (a, b) => b.revenue - a.revenue,
  );
  if (!territoryGroups.has(selectedZip)) {
    if (selectedZip && Object.hasOwn(neighborhoodContext.areas, selectedZip))
      territoryGroups.set(selectedZip, {
        zip: selectedZip,
        customers: [],
        revenue: 0,
        outstanding: 0,
        invoices: 0,
        prospects: 0,
      });
    else selectedZip = groups[0]?.zip || null;
  }
  renderZipPills();
  renderTerritoryDetail();
  const coverage = territoryCoverage(d);
  document.getElementById("map-coverage").innerHTML =
    `<div class="coverage-icon" aria-hidden="true">◎</div><div><strong>${coverage.percent === null ? "No wholesale sales loaded" : `${coverage.percent.toFixed(1)}% of wholesale sales is placed on the map`}</strong><p>${fmt(coverage.mappedSales)} is assigned to listed customers within these boundaries. ${fmt(coverage.otherSales)} is under Other buyers${coverage.unplacedSales ? `; ${fmt(coverage.unplacedSales)} belongs to listed customers outside mapped ZIPs` : ""}. Square sales are separate.${provisionalSalesCaption(d) ? `<br><b>${esc(provisionalSalesCaption(d))}</b>` : ""}</p></div><button class="btn-sm quiet" data-goto="data">Improve coverage ↗</button>`;
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
    territoryMap.on("zoomend moveend", updateMapLabels);
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
    contextLabelMarkers.length = 0;
    for (const place of [
      { name: "BROOKLYN", lat: 40.672, lng: -73.956, boroughLabel: true },
      { name: "QUEENS", lat: 40.733, lng: -73.827, boroughLabel: true },
      ...neighborhoodContext.points,
    ]) {
      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className:
            "map-context-label" + (place.boroughLabel ? " borough" : ""),
          html: `<span>${esc(place.name)}</span>`,
          iconSize: [160, 25],
          iconAnchor: [80, 12],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(territoryLabels);
      contextLabelMarkers.push({ marker, boroughLabel: place.boroughLabel });
    }
    territoryLayer = L.geoJSON(boundaryData, {
      style: territoryStyle,
      onEachFeature: (feature, layer) => {
        const zip = feature.properties.zcta5,
          group = territoryGroups.get(zip);
        layer.on("click", () => selectTerritory(zip));
        layer.bindTooltip(
          () => {
            const tip = document.createElement("div"),
              current = territoryGroups.get(zip),
              metric = document.getElementById("map-metric").value;
            const value = current ? metricValue(current) : 0;
            tip.textContent = `${zip} · ${{ revenue: "Listed sales", outstanding: "Listed balances", customers: "Customers", prospects: "Prospects to develop" }[metric]}: ${["revenue", "outstanding"].includes(metric) ? fmt(value) : value}`;
            return tip;
          },
          { sticky: true },
        );
        layer.on("mouseover", () =>
          layer.setStyle({ weight: 3, color: "#a3844a" }),
        );
        layer.on("mouseout", () => territoryLayer.resetStyle(layer));
        if (group) {
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
      {
        if (territoryGroups.has(layer.feature.properties.zcta5))
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
  if (!territoryLayer) return;
  if (!territoryMap._antariFitted) {
    fitTerritories();
    territoryMap._antariFitted = true;
  } else updateMapLabels();
}
function selectTerritory(zip) {
  if (!territoryGroups.has(zip))
    territoryGroups.set(zip, {
      zip,
      customers: [],
      revenue: 0,
      outstanding: 0,
      invoices: 0,
      prospects: 0,
    });
  selectedZip = zip;
  selectedTerritoryCustomer = null;
  attentionOpen = false;
  renderTerritoryDetail();
  renderZipPills();
  if (territoryLayer) territoryLayer.setStyle(territoryStyle);
  updateMapLabels();
}
function renderZipPills() {
  const q = (document.getElementById("territory-search")?.value || "")
    .trim()
    .toLowerCase();
  const zips = q
    ? [
        ...new Set([
          ...territoryGroups.keys(),
          ...Object.keys(neighborhoodContext.areas),
        ]),
      ]
    : [...territoryGroups.keys()].filter((zip) => {
        const g = territoryGroups.get(zip);
        return g.customers.length || g.prospects || zip === selectedZip;
      });
  document.getElementById("territory-zip-list").innerHTML =
    zips
      .filter(
        (zip) =>
          !q ||
          zip.toLowerCase().includes(q) ||
          (neighborhoodContext.areas[zip] || [])
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort()
      .slice(0, 35)
      .map(
        (zip) =>
          `<button class="zip-pill ${zip === selectedZip ? "selected" : ""}" data-territory="${esc(zip)}" aria-pressed="${zip === selectedZip}">${esc(zip)}<small>${territoryGroups.get(zip)?.customers.length || 0}</small></button>`,
      )
      .join("") ||
    '<p class="empty-note">No matching NYC ZIP areas or listed customer ZIPs.</p>';
}
function renderTerritoryDetail() {
  if (typeof renderStudioTerritoryDetail === "function")
    renderStudioTerritoryDetail();
}
document.getElementById("territory-zip-list").addEventListener("click", (e) => {
  const button = e.target.closest("[data-territory]");
  if (button) selectTerritory(button.dataset.territory);
});
document.getElementById("map-metric").addEventListener("change", () => {
  if (territoryLayer) territoryLayer.setStyle(territoryStyle);
  document.getElementById("map-legend-text").textContent =
    "Lower → Higher " +
    {
      revenue: "sales",
      outstanding: "balances",
      customers: "customer count",
      prospects: "prospect count",
    }[document.getElementById("map-metric").value];
  selectedTerritoryCustomer = null;
  attentionOpen = false;
  renderTerritoryDetail();
  updateMapLabels();
});
document.getElementById("map-fit").addEventListener("click", fitTerritories);

function updateMapLabels() {
  if (!territoryMap) return;
  const occupied = [];
  for (const [zip, marker] of territoryLabelMarkers)
    if (territoryMap.getZoom() >= 12.2 || zip === selectedZip) {
      const point = territoryMap.latLngToContainerPoint(marker.getLatLng());
      occupied.push({ x: point.x, y: point.y, w: 70, h: 34 });
    }
  for (const item of contextLabelMarkers) {
    const el = item.marker.getElement();
    if (!el) continue;
    const point = territoryMap.latLngToContainerPoint(item.marker.getLatLng());
    const zoom = territoryMap.getZoom();
    const show =
      (item.boroughLabel ? zoom < 12.2 : zoom >= 11.6) &&
      territoryMap.getBounds().contains(item.marker.getLatLng()) &&
      !occupied.some(
        (p) =>
          Math.abs(p.x - point.x) < (p.w + 150) / 2 &&
          Math.abs(p.y - point.y) < (p.h + 26) / 2,
      );
    el.style.display = show ? "" : "none";
    if (show) occupied.push({ x: point.x, y: point.y, w: 150, h: 26 });
  }

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
  contextLabelMarkers.length = 0;
  document.getElementById("map-coverage").replaceChildren();
  territoryMap?.remove();
  territoryMap = null;
  territoryLayer = null;
  territoryLabels = null;
  document.getElementById("territory-details").replaceChildren();
  document.getElementById("territory-zip-list").replaceChildren();
}
