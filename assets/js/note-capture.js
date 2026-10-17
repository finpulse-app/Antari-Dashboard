"use strict";
// Deterministic extraction for common sales phrases. Unknown details remain blank.
// These records are field drafts, never an additional financial sales source.
function interpretVisitNote(text, stores = []) {
  const note = String(text || "").trim(),
    result = {
      kind: "note",
      product: "",
      quantity: null,
      quantity_unit: "",
      discount_pct: null,
      discount_reason: "",
      unit_price: null,
      sale_on: null,
      customer: null,
      warnings: [],
    };
  const lower = note.toLowerCase(),
    matches = stores.filter((s) =>
      new RegExp(
        `(?:^|[^a-z0-9])${s.store_name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`,
        "i",
      ).test(lower),
    );
  if (matches.length === 1) result.customer = matches[0].store_name;
  if (matches.length > 1)
    result.warnings.push(
      "More than one customer is mentioned. Choose the customer for this note.",
    );
  if (
    /\b(?:didn['’]?t|did not|never|haven['’]?t|not yet|plan to|planning to|will|want to|might|could|would|should|going to)\b[\s\S]{0,45}\b(?:sell|sold|deliver|delivered|supply|supplied)\b/i.test(
      note,
    )
  )
    return result;
  if (/\b(?:cancelled|canceled|refunded|returned|returning)\b/i.test(note)) {
    result.warnings.push(
      "A cancellation, return, or refund is mentioned. This stays a note rather than a sale draft.",
    );
    return result;
  }
  const quantities = [
    ...note.matchAll(
      /\b(?:sold|sell|delivered|supplied)\s+([\d,]+(?:\.\d+)?)\s*(units?|bottles?|cases?|packs?|boxes?|pieces?|pcs)\s+(?:of\s+)?(.+?)(?=\s+(?:to|at|for|with|including|which|on)\b|[,.;\n]|$)/gi,
    ),
  ];
  if (
    quantities.length !== 1 ||
    /\band\s+\d+\s*(?:units?|bottles?|cases?|packs?|boxes?)\b/i.test(note)
  ) {
    if (quantities.length > 1 || /\b(?:sold|delivered|supplied)\b/i.test(note))
      result.warnings.push(
        "Could not isolate one product and quantity. Keep this as a note or enter the sale details below.",
      );
    return result;
  }
  const match = quantities[0],
    quantity = Number(match[1].replace(/,/g, "")),
    product = match[3].trim();
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity >= 1e9 ||
    !product ||
    product.length > 160
  )
    return result;
  if (/\band\b|\bor\b/.test(product)) {
    result.warnings.push(
      "Multiple products may be mentioned. Enter one product per sale draft.",
    );
    return result;
  }
  result.kind = "sale_draft";
  result.quantity = quantity;
  result.product = product;
  result.quantity_unit = match[2].toLowerCase();
  const discounts = [
    ...note.matchAll(
      /\b(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:(?:first[ -]?(?:time|purchase|order)|introductory|new customer)\s+)?(?:discount|off)\b/gi,
    ),
    ...note.matchAll(
      /\bdiscount(?:\s+of)?\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/gi,
    ),
  ];
  const discountValues = [...new Set(discounts.map((m) => Number(m[1])))];
  if (
    discountValues.length === 1 &&
    discountValues[0] >= 0 &&
    discountValues[0] <= 100
  )
    result.discount_pct = discountValues[0];
  else if (
    discountValues.length > 1 ||
    discountValues.some((n) => n < 0 || n > 100)
  )
    result.warnings.push(
      "Discount is ambiguous. Enter the percentage explicitly.",
    );
  else if (/\b(?:no|without a?)\s+discount\b/i.test(note))
    result.discount_pct = 0;
  if (
    /\b(?:first[ -]?(?:time|purchase|order)|new customer|introductory)\b/i.test(
      note,
    )
  )
    result.discount_reason = "First purchase";
  if (
    discountValues.length &&
    /\b(?:next (?:time|order)|future|proposed|discussed|might offer|could offer|not applied|did not apply)\b/i.test(
      note,
    )
  ) {
    result.discount_pct = null;
    result.warnings.push(
      "The discount may be proposed, future, or not applied. Enter the actual discount if this sale had one.",
    );
  }
  const prices = [
    ...note.matchAll(
      /\bat\s*\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])\s*(?:each|per\s+(?:unit|bottle|case|pack|box|piece)|\/(?:unit|bottle|case|pack|box|piece))?/gi,
    ),
    ...note.matchAll(
      /\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])\s*(?:each|per\s+(?:unit|bottle|case|pack|box|piece))/gi,
    ),
  ];
  const priceValues = [
    ...new Set(prices.map((m) => Number(m[1].replace(/,/g, "")))),
  ];
  if (priceValues.length === 1) result.unit_price = priceValues[0];
  if (priceValues.length > 1)
    result.warnings.push(
      "More than one price is mentioned. Enter the unit price explicitly.",
    );
  // "for $100 total" is not a unit price.
  if (/\bfor\s*\$[\d.]+\s*(?:total|altogether|in total)\b/i.test(note))
    result.unit_price = null;
  const iso = note.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (
    iso &&
    !Number.isNaN(Date.parse(iso[1] + "T00:00:00Z")) &&
    new Date(iso[1] + "T00:00:00Z").toISOString().slice(0, 10) === iso[1]
  )
    result.sale_on = iso[1];
  else if (/\btoday\b/i.test(note)) result.sale_on = businessDay();
  if (result.unit_price === null)
    result.warnings.push(
      "No unit price identified. The quantity and discount can still be saved.",
    );
  return result;
}
function saleDraftAmounts(row) {
  if (
    row.quantity === null ||
    row.quantity === undefined ||
    row.unit_price === null ||
    row.unit_price === undefined ||
    row.discount_pct === null ||
    row.discount_pct === undefined
  )
    return null;
  const quantity = Number(row.quantity),
    price = Number(row.unit_price),
    discount = Number(row.discount_pct);
  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(price) ||
    !Number.isFinite(discount) ||
    quantity <= 0 ||
    price < 0 ||
    discount < 0 ||
    discount > 100
  )
    return null;
  const gross = cents(quantity * price) / 100,
    discountAmount = cents((gross * discount) / 100) / 100;
  return {
    gross,
    discount: discountAmount,
    afterDiscount: cents(gross - discountAmount) / 100,
  };
}
function saleNoteSummary(n) {
  if (n.activity_kind !== "sale_draft") return "";
  const a = saleDraftAmounts(n);
  return `<div class="sale-note-summary"><span>FIELD SALE DRAFT · EXCLUDED FROM REPORT TOTALS</span><b>${Number(n.quantity)} ${esc(n.quantity_unit || "units")} · ${esc(n.product)}</b><p>${n.discount_pct === null || n.discount_pct === undefined ? "Discount not specified" : `${Number(n.discount_pct)}% discount${n.discount_reason ? ` · ${esc(n.discount_reason)}` : ""}`}${n.unit_price !== null && n.unit_price !== undefined ? ` · ${fmt(n.unit_price)} per ${esc(n.quantity_unit || "unit")}` : " · Unit price missing"}${a ? `<br>${fmt(a.gross)} before discount · ${fmt(a.discount)} discount · ${fmt(a.afterDiscount)} after discount, before tax` : ""}</p></div>`;
}
function installVisitCapture() {
  const note = document.getElementById("visit-note"),
    store = document.getElementById("visit-store");
  if (!note) return;
  note.placeholder =
    "For example: Sold 100 bottles of juice at $2 each with a 10% first time discount.";
  note.insertAdjacentHTML(
    "afterend",
    `<div class="note-understanding" id="note-understanding" hidden></div><details id="note-sale-fields" class="studio-disclosure"><summary>Add or correct sale details</summary><div class="form-grid">${inputField("Product", "capture-product", "", 'maxlength="160"')}${inputField("Quantity", "capture-quantity", "", 'type="number" min="0.001" max="999999999" step="0.001"')}${inputField("Unit (bottles, cases…)", "capture-unit", "", 'maxlength="30"')}${inputField("Unit price ($), optional", "capture-price", "", 'type="number" min="0" max="999999999" step="0.01"')}${inputField("Discount (%), if stated", "capture-discount", "", 'type="number" min="0" max="100" step="0.01"')}${inputField("Discount reason", "capture-reason", "", 'maxlength="160"')}${inputField("Sale date, if stated", "capture-date", "", 'type="date"')}</div><p class="studio-caption">These details are an unposted field record. Zoho remains the financial sales source. Unknown prices and discounts stay blank.</p></details>`,
  );
  let manual = false;
  const fields = document.getElementById("note-sale-fields");
  fields.addEventListener("input", () => {
    manual = true;
    renderInterpretation();
  });
  function captureValues() {
    const get = (name) =>
      fields.querySelector(`[name="capture-${name}"]`).value;
    return {
      product: get("product").trim(),
      quantity: get("quantity") === "" ? null : Number(get("quantity")),
      quantity_unit: get("unit").trim(),
      unit_price: get("price") === "" ? null : Number(get("price")),
      discount_pct: get("discount") === "" ? null : Number(get("discount")),
      discount_reason: get("reason").trim(),
      sale_on: get("date") || null,
    };
  }
  function renderInterpretation() {
    const parsed = interpretVisitNote(note.value, D?.stores || []),
      box = document.getElementById("note-understanding");
    if (!manual) {
      for (const [key, value] of Object.entries({
        product: parsed.product,
        quantity: parsed.quantity,
        unit: parsed.quantity_unit,
        price: parsed.unit_price,
        discount: parsed.discount_pct,
        reason: parsed.discount_reason,
        date: parsed.sale_on,
      })) {
        fields.querySelector(`[name="capture-${key}"]`).value = value ?? "";
      }
      if (parsed.customer && !store.value) {
        store.value = parsed.customer;
        renderVisitHistory();
      }
    }
    const v = captureValues(),
      hasSale = v.product && v.quantity > 0;
    box.hidden = !note.value.trim();
    box.innerHTML = hasSale
      ? `<span class="eyebrow">${manual ? "YOUR SALE DETAILS" : "UNDERSTOOD FROM YOUR NOTE"}</span><b>${Number(v.quantity)} ${esc(v.quantity_unit || "units")} of ${esc(v.product)}</b><p>${v.discount_pct === null ? "Discount not specified" : `${v.discount_pct}% discount${v.discount_reason ? ` · ${esc(v.discount_reason)}` : ""}`}${v.unit_price === null ? " · Unit price missing" : ` · ${fmt(v.unit_price)} each`}</p>${saleDraftAmounts(v) ? `<strong>${fmt(saleDraftAmounts(v).afterDiscount)} after discount, before tax</strong>` : ""}<small>Saving to ${esc(store.value || "the customer you choose")}. Captured as a field sale draft, separate from imported revenue.</small>${parsed.customer && store.value && parsed.customer !== store.value ? '<p class="capture-warning">The customer mentioned in your note differs from the selected customer. Check the customer before saving.</p>' : ""}${parsed.warnings.length ? `<small>${parsed.warnings.map(esc).join(" ")}</small>` : ""}`
      : `<span class="eyebrow">VISIT NOTE</span><p>${parsed.warnings.length ? parsed.warnings.map(esc).join(" ") : "Your words will be saved with the customer. Common sales wording can also capture quantities, prices, and percentage discounts."}</p>`;
    document.getElementById("visit-save").textContent = hasSale
      ? "Save note & sale details"
      : "Save note";
  }
  note.addEventListener("input", renderInterpretation);
  store.addEventListener("change", renderInterpretation);
  fields.getCapture = () => {
    const v = captureValues();
    const hasAny =
      v.product ||
      v.quantity !== null ||
      v.unit_price !== null ||
      v.discount_pct !== null;
    if (!hasAny) return {};
    if (
      !v.product ||
      !Number.isFinite(v.quantity) ||
      v.quantity <= 0 ||
      v.quantity >= 1e9
    )
      throw new Error(
        "Enter a product and positive quantity in sale details, or clear those fields to save only the note.",
      );
    if (
      v.discount_pct !== null &&
      (!Number.isFinite(v.discount_pct) ||
        v.discount_pct < 0 ||
        v.discount_pct > 100)
    )
      throw new Error("Discount must be between 0 and 100 percent.");
    if (
      v.unit_price !== null &&
      (!Number.isFinite(v.unit_price) ||
        v.unit_price < 0 ||
        v.unit_price >= 1e9)
    )
      throw new Error("Enter a valid nonnegative unit price.");
    const detected = interpretVisitNote(note.value, D?.stores || []);
    if (detected.customer && store.value !== detected.customer)
      throw new Error(
        "The customer mentioned in your note differs from the selected customer. Choose the correct customer or edit the note.",
      );
    return { activity_kind: "sale_draft", ...v };
  };
}
