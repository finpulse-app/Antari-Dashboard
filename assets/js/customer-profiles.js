"use strict";
function customerProfileHtml(store, d = D) {
  const p = (d.customerProfiles || []).find(
    (p) => p.store_name === store.store_name,
  );
  const raw = d.stores.find((s) => s.store_name === store.store_name) || {};
  const interests = [
    ...new Set(
      [
        p?.interests,
        ...(d.visitNotes || [])
          .filter((n) => n.store_name === store.store_name)
          .map((n) => n.crm_capture?.interest),
      ].filter(Boolean),
    ),
  ];
  return `<section class="customer-profile"><div class="card-heading"><h3>Location details</h3><button class="btn-sm quiet" data-edit-customer-profile="${esc(store.store_name)}">Edit profile ↗</button></div>${p?.address ? `<p>${esc(p.address)}<small>${p.address_confirmed ? "Address confirmed by an owner" : "Address awaiting owner confirmation"}</small></p>` : '<p class="empty-note">Add an address and contact details to complete this location.</p>'}${raw.contact_name ? `<p><b>${esc(raw.contact_name)}</b></p>` : ""}${p?.phone || p?.email ? `<p>${esc([p.phone, p.email].filter(Boolean).join(" · "))}</p>` : raw.phone_email ? `<p>${esc(raw.phone_email)}</p>` : ""}${p?.preferred_contact ? `<small>Preferred contact: ${esc({ phone: "Phone", text: "Text message", email: "Email", in_person: "In person" }[p.preferred_contact])}</small>` : ""}${interests.length ? `<p><b>Product interests</b><br>${interests.map(esc).join(" · ")}</p>` : ""}${p ? `<details class="studio-disclosure"><summary>Location identity & source links</summary><p class="profile-identity">Location ID: ${esc(p.id)}</p><p>${p.zoho_contact_id ? `Zoho Inventory contact: ${esc(p.zoho_contact_id)}<br>Organization: ${esc(p.zoho_organization_id)}` : "Zoho Inventory contact not linked."}<br>${p.square_customer_id ? `Square customer: ${esc(p.square_customer_id)}` : "Square customer not linked."}</p><p>External IDs are owner supplied until verified by an account connection. These links do not change historical name mappings or provisional sales.</p></details>` : ""}</section>`;
}
function openCustomerProfile(name) {
  if (!D) return;
  const raw = D.stores.find((s) => s.store_name === name);
  if (!raw) return;
  const profile =
    (D.customerProfiles || []).find((p) => p.store_name === name) || {};
  closeModal();
  gmOpen(
    `<div class="modal-rank">SHARED LOCATION PROFILE</div><h3>${esc(name)}</h3><form id="customer-profile-form"><div class="form-grid">${inputField("Business type", "category", raw.category, 'maxlength="80" list="profile-category-list"')}${inputField("ZIP", "zip", raw.zip, 'required pattern="[0-9]{5}" maxlength="5" inputmode="numeric"')}<datalist id="profile-category-list">${["Market", "Restaurant", "Bakery", "Deli"].map((s) => `<option value="${s}">`).join("")}</datalist>${inputField("Street address, city & state", "address", profile.address, 'maxlength="300"', true)}<label class="checkbox-field full-field"><input type="checkbox" name="address_confirmed"${profile.address_confirmed ? " checked" : ""}/> Address confirmed with the customer</label>${inputField("Contact person", "contact_name", raw.contact_name, 'maxlength="200"')}${inputField("Phone", "phone", profile.phone, 'type="tel" maxlength="80"')}${inputField("Email", "email", profile.email, 'type="email" maxlength="200"')}<label>Preferred contact<select name="preferred_contact">${[
      ["", "Not specified"],
      ["phone", "Phone"],
      ["text", "Text message"],
      ["email", "Email"],
      ["in_person", "In person"],
    ]
      .map(
        ([v, label]) =>
          `<option value="${v}"${profile.preferred_contact === v ? " selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label>${textField("Product interests", "interests", profile.interests, 1000)}</div>${raw.phone_email ? `<p class="studio-caption">Existing contact on file: ${esc(raw.phone_email)}. It is preserved if both new contact fields are blank.</p>` : ""}<details class="studio-disclosure"><summary>Link source customer IDs, optional</summary><p class="studio-caption">Use the actual contact ID from Zoho Inventory, with its organization ID. Do not enter an invoice number. This stores a reference; it does not connect accounts or remap historical sales.</p><div class="form-grid">${inputField("Zoho organization ID", "zoho_organization_id", profile.zoho_organization_id, 'maxlength="100"')}${inputField("Zoho Inventory contact ID", "zoho_contact_id", profile.zoho_contact_id, 'maxlength="100"')}${inputField("Square customer ID", "square_customer_id", profile.square_customer_id, 'maxlength="200"', true)}</div></details><p class="studio-caption">Location identity stays fixed. Changes are shared with both owners.</p><p id="profile-error" class="pay-error" role="alert"></p><div class="modal-actions"><button class="btn-ghost" type="button" data-action="gmClose">Cancel</button><button class="btn-solid" type="submit">Save profile</button></div></form>`,
    true,
  );
  const form = document.getElementById("customer-profile-form"),
    address = form.elements.address,
    confirmed = form.elements.address_confirmed;
  address.addEventListener("input", () => {
    confirmed.checked = false;
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = document.getElementById("profile-error"),
      button = form.querySelector('[type="submit"]'),
      epoch = authEpoch;
    const data = Object.fromEntries(new FormData(form));
    data.address_confirmed = confirmed.checked;
    if (data.zoho_contact_id && !data.zoho_organization_id) {
      error.textContent = "Enter the Zoho organization ID with the contact ID.";
      return;
    }
    button.disabled = true;
    error.textContent = "";
    try {
      const result = await sb.rpc("save_customer_profile", {
        p_store: name,
        p_expected_revision: profile.revision || 0,
        p_data: data,
      });
      if (result.error) throw result.error;
      if (epoch !== authEpoch) return;
      if (form.isConnected) gmClose();
      showToast("Location profile saved for both owners.");
      await reloadAfterWrite();
    } catch (err) {
      if (epoch === authEpoch && error.isConnected) {
        error.textContent = err.message;
        button.disabled = false;
      }
    }
  });
}
function unitPricingHtml(name) {
  const row = (D?.productPricing || []).find((p) => p.item_name === name);
  if (!row)
    return `<div class="unit-pricing"><span class="eyebrow">CURRENT REFERENCE PRICING</span><p class="studio-caption">No unit cost and market price confirmed for this product.</p><button class="btn-sm quiet" data-edit-pricing="${esc(name)}">Add unit pricing ↗</button></div>`;
  const spread =
    Math.round((Number(row.wholesale_price) - Number(row.unit_cost)) * 100) /
    100;
  return `<div class="unit-pricing"><span class="eyebrow">CURRENT REFERENCE PRICING</span><div class="pricing-figures"><span>Unit cost<b>${fmt(row.unit_cost)}</b></span><span>Market price<b>${fmt(row.wholesale_price)}</b></span><span>Unit spread<b>${fmt(spread)}</b></span></div><p>${((spread / Number(row.wholesale_price)) * 100).toFixed(2)}% of selling price before discounts and other expenses. Per individual jar or bottle.</p><p class="studio-caption">Owner supplied reference pricing. Not applied retrospectively to historical sales or reported as business profit.${row.notes ? ` ${esc(row.notes)}` : ""}</p><button class="btn-sm quiet" data-edit-pricing="${esc(name)}">Edit reference pricing ↗</button></div>`;
}
function openPricingEditor(name) {
  const row =
    (D?.productPricing || []).find((p) => p.item_name === name) || null;
  const sku = D?.itemRows.find((p) => p.item_name === name)?.sku || "";
  sharedForm(
    name,
    `<span class="eyebrow">CURRENT REFERENCE PRICING</span><div class="form-grid">${inputField("Cost per individual jar / bottle ($)", "unit_cost", row?.unit_cost, 'type="number" min="0" max="999999999" step="0.01" required')}${inputField("Wholesale market price per unit ($)", "wholesale_price", row?.wholesale_price, 'type="number" min="0.01" max="999999999" step="0.01" required')}${textField("Pricing notes & exclusions", "notes", row?.notes, 1000)}</div><p class="studio-caption">This is a current pricing reference. Historical profitability requires the costs and discounts that applied when each sale occurred.</p>`,
    row,
    "product_unit_pricing",
    (f) => ({
      item_name: name,
      sku,
      unit_cost: Number(f.get("unit_cost")),
      wholesale_price: Number(f.get("wholesale_price")),
      unit_basis: "individual",
      notes: f.get("notes").trim(),
    }),
  );
}
function openUnitPricing() {
  if (!D) return;
  gmOpen(
    `<div class="modal-rank">PRODUCT ECONOMICS</div><h3>Reference unit pricing</h3><p class="studio-caption">Current cost and wholesale price per individual jar or bottle. Missing costs stay unknown. These figures do not rewrite sales reports.</p><div class="pricing-list">${D.sortedProducts
      .map((p) => {
        const price = (D.productPricing || []).find(
          (r) => r.item_name === p.item_name,
        );
        return `<button data-edit-pricing="${esc(p.item_name)}"><span>${esc(p.item_name)}</span><b>${price ? `${fmt(price.unit_cost)} cost · ${fmt(price.wholesale_price)} market` : "Add pricing ↗"}</b></button>`;
      })
      .join(
        "",
      )}</div><button class="modal-close" data-action="gmClose">Close</button>`,
    true,
  );
}
document.addEventListener("click", (e) => {
  const customer = e.target.closest("[data-edit-customer-profile]");
  if (customer) openCustomerProfile(customer.dataset.editCustomerProfile);
  const pricing = e.target.closest("[data-edit-pricing]");
  if (pricing && D) openPricingEditor(pricing.dataset.editPricing);
  if (e.target.closest("[data-unit-pricing]")) openUnitPricing();
});
