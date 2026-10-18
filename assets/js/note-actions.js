"use strict";
function interpretVisitActions(text, today = businessDay()) {
  const note = String(text || "").trim(),
    result = { capture: {}, warnings: [] };
  const allowed = (match) =>
    !/(?:\b(?:not|never|don['’]?t|didn['’]?t|did not|might|could|would|plan to|planning to|will|if)\b)[^.;\n]{0,40}$/i.test(
      note.slice(Math.max(0, match.index - 70), match.index),
    );
  const interest = note.match(
    /\b(?:liked|interested in|asked about|requested samples of)\s+(.+?)(?=[,.;\n]|\s+(?:and\s+)?(?:offered|follow[ -]?up|call|sold|delivered)\b|$)/i,
  );
  if (interest && allowed(interest) && interest[1].trim().length <= 500)
    result.capture.interest = interest[1].trim();
  const sample = note.match(
    /\b(?:delivered|dropped off|left|gave)\s+(?:(?:some|the|free)\s+)?samples\b/i,
  );
  if (sample && allowed(sample)) result.capture.samples_delivered = true;
  const offers = [
    ...note.matchAll(
      /\b(?:offered|offering|offer)\s+(?:a\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)(?:\s+(?:first[ -]?(?:time|purchase|order)\s+)?discount)?/gi,
    ),
  ].filter(allowed);
  const percentages = [...new Set(offers.map((m) => Number(m[1])))];
  if (
    percentages.length === 1 &&
    percentages[0] >= 0 &&
    percentages[0] <= 100
  ) {
    result.capture.offer_pct = percentages[0];
    result.capture.offer_reason = /\bfirst[ -]?(?:time|purchase|order)\b/i.test(
      note,
    )
      ? "First purchase"
      : "Owner-recorded offer";
  } else if (percentages.length)
    result.warnings.push(
      "The discount offer is ambiguous. Enter it explicitly if you want to record one.",
    );
  const followups = [
    ...note.matchAll(
      /\b(?:follow[ -]?up|call(?: back)?|check back|visit again)\s+(?:(?:on|by)\s+)?(20\d{2}-\d{2}-\d{2}|today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,
    ),
  ].filter(
    (match) =>
      !/(?:\b(?:not|never|don['’]?t|didn['’]?t|did not|might|could|if)\b)[^.;\n]{0,40}$/i.test(
        note.slice(Math.max(0, match.index - 70), match.index),
      ),
  );
  const dates = [];
  for (const m of followups) {
    const phrase = m[1].toLowerCase(),
      base = new Date(today + "T00:00:00Z");
    let date;
    if (/^20/.test(phrase)) {
      const parsed = new Date(phrase + "T00:00:00Z");
      if (
        !Number.isNaN(+parsed) &&
        parsed.toISOString().slice(0, 10) === phrase
      )
        date = phrase;
    } else {
      let offset = 0;
      if (phrase === "tomorrow") offset = 1;
      else if (phrase !== "today") {
        const weekdays = [
            "sunday",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
          ],
          day = weekdays.indexOf(phrase.replace(/^next\s+/, ""));
        offset = (day - base.getUTCDay() + 7) % 7;
        if (phrase.startsWith("next ") && offset === 0) offset = 7;
      }
      base.setUTCDate(base.getUTCDate() + offset);
      date = base.toISOString().slice(0, 10);
    }
    if (date) dates.push(date);
  }
  const distinctDates = [...new Set(dates)];
  if (distinctDates.length === 1) {
    result.capture.followup_on = distinctDates[0];
    result.capture.followup_title = result.capture.interest
      ? `Follow up about ${result.capture.interest}`.slice(0, 200)
      : "Follow up after customer visit";
  } else if (distinctDates.length > 1)
    result.warnings.push(
      "More than one follow-up date is mentioned. Choose one date for this note.",
    );
  else if (
    /\b(?:follow[ -]?up|call back|check back|visit again)\b/i.test(note) &&
    !/(?:do not|don['’]?t|never)\s+(?:follow[ -]?up|call back|check back|visit again)/i.test(
      note,
    )
  )
    result.warnings.push(
      "No clear follow-up date was identified. Add a date below to create a task.",
    );
  return result;
}
function visitActionsSummary(capture) {
  const c = capture || {},
    parts = [];
  if (c.interest) parts.push(`Product interest: ${c.interest}`);
  if (c.samples_delivered) parts.push("Samples delivered");
  if (c.offer_pct !== undefined && c.offer_pct !== null)
    parts.push(
      `${Number(c.offer_pct)}% discount offer${c.offer_reason ? ` (${c.offer_reason})` : ""}; not a posted sale discount`,
    );
  if (c.followup_on)
    parts.push(
      `${c.followup_title || "Follow up"} on ${fmtDate(c.followup_on)}`,
    );
  return parts;
}
function visitActionsHtml(note) {
  const parts = visitActionsSummary(note.crm_capture);
  return parts.length
    ? `<div class="visit-actions-summary"><span class="eyebrow">CAPTURED FROM THIS VISIT</span>${parts.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`
    : "";
}
function installVisitActions() {
  const note = document.getElementById("visit-note");
  if (!note) return;
  document
    .getElementById("note-sale-fields")
    .insertAdjacentHTML(
      "afterend",
      `<section class="note-crm-capture"><div id="visit-action-preview" class="note-understanding" hidden></div><details class="studio-disclosure" id="note-action-fields"><summary>Add or correct interests, offers & follow-up</summary><div class="form-grid">${inputField("Product interest", "crm-interest", "", 'maxlength="500"', true)}${inputField("Discount offered (%), not applied to a sale", "crm-offer", "", 'type="number" min="0" max="100" step="0.01"')}${inputField("Offer reason", "crm-reason", "", 'maxlength="160"')}<label class="checkbox-field full-field"><input type="checkbox" name="crm-samples"/> Samples delivered</label>${inputField("Follow up on", "crm-date", "", 'type="date"')}${inputField("Follow-up action", "crm-title", "", 'maxlength="200"')}</div></details></section>`,
    );
  const fields = document.getElementById("note-action-fields");
  let manual = false;
  const value = (name) => fields.querySelector(`[name="crm-${name}"]`);
  function getCapture() {
    const c = {},
      interest = value("interest").value.trim(),
      offer = value("offer").value,
      reason = value("reason").value.trim(),
      due = value("date").value,
      title = value("title").value.trim();
    if (interest) c.interest = interest;
    if (offer !== "") c.offer_pct = Number(offer);
    if (reason) c.offer_reason = reason;
    if (value("samples").checked) c.samples_delivered = true;
    if (due) {
      c.followup_on = due;
      c.followup_title = title || "Follow up after customer visit";
    } else if (title) throw Error("Choose a follow-up date for this action.");
    if (
      c.offer_pct !== undefined &&
      (!Number.isFinite(c.offer_pct) || c.offer_pct < 0 || c.offer_pct > 100)
    )
      throw Error("Offer percentage must be between 0 and 100.");
    return c;
  }
  function render() {
    const parsed = interpretVisitActions(note.value),
      box = document.getElementById("visit-action-preview");
    if (!manual) {
      value("interest").value = parsed.capture.interest || "";
      value("offer").value = parsed.capture.offer_pct ?? "";
      value("reason").value = parsed.capture.offer_reason || "";
      value("samples").checked = Boolean(parsed.capture.samples_delivered);
      value("date").value = parsed.capture.followup_on || "";
      value("title").value = parsed.capture.followup_title || "";
    }
    try {
      const capture = getCapture(),
        parts = visitActionsSummary(capture);
      box.hidden = !parts.length && !parsed.warnings.length;
      box.innerHTML = `<span class="eyebrow">${manual ? "YOUR VISIT UPDATES" : "ALSO UNDERSTOOD FROM YOUR NOTE"}</span>${parts.map((p) => `<p>${esc(p)}</p>`).join("")}${capture.followup_on ? "<small>Saving this note also creates one shared follow-up action.</small>" : ""}${parsed.warnings.map((w) => `<small>${esc(w)}</small>`).join("")}`;
    } catch (e) {
      box.hidden = false;
      box.textContent = e.message;
    }
  }
  note.addEventListener("input", render);
  fields.addEventListener("input", () => {
    manual = true;
    render();
  });
  fields.getCapture = getCapture;
}
