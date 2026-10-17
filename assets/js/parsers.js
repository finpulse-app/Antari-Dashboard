"use strict";
// ---------------- PDF parsing ----------------
function money(s) {
  return parseFloat(String(s).replace(/[,$]/g, ""));
}
const MONTHS = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};
function parseDateLong(d) {
  const m = d.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  return m ? `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}` : null;
}
// Same clean-up the database applies to customer names: curly quotes become ', odd spaces collapse.
function cleanName(s) {
  return String(s == null ? "" : s)
    .replace(/[\u2018\u2019\u0060\u00B4]/g, "'")
    .replace(/[\s\u00A0]+/g, " ")
    .trim();
}

function detectType(text) {
  if (/Sales by Customer/i.test(text)) return "sales_customer";
  if (/Sales by Item/i.test(text)) return "sales_item";
  if (/Customer Balance Summary/i.test(text)) return "customer_balances";
  if (/Payments Received/i.test(text)) return "payments_received";
  if (/Sales Report/i.test(text) && /ITEM SALES/i.test(text))
    return "festival_square";
  return "unknown";
}

function extractPeriod(text) {
  const m = text.match(
    /From\s+(\d{1,2}\s+\w{3}\s+\d{4})\s+To\s+(\d{1,2}\s+\w{3}\s+\d{4})/i,
  );
  if (m) return { start: parseDateLong(m[1]), end: parseDateLong(m[2]) };
  const asOf = text.match(/As of\s+(\d{1,2}\s+\w{3}\s+\d{4})/i);
  if (asOf) return { asOf: parseDateLong(asOf[1]) };
  return {};
}

function parseSalesCustomer(text) {
  const rows = [];
  const re = /^(.+?)\s+(\d+)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})$/;
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^TOTAL\b/i.test(line) || /^Name\s+Invoice/i.test(line)) continue;
    const m = line.match(re);
    if (m)
      rows.push({
        zoho_name: cleanName(m[1]),
        invoice_count: parseInt(m[2]),
        sales: money(m[3]),
      });
  }
  return rows;
}
function parseSalesItem(text) {
  const rows = [];
  const re =
    /^(.+?)\s+(\S+)\s+([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})$/;
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^TOTAL\b/i.test(line) || /^Item Name/i.test(line)) continue;
    const m = line.match(re);
    if (m)
      rows.push({
        item_name: cleanName(m[1]),
        sku: m[2],
        quantity_sold: money(m[3]),
        sales: money(m[4]),
      });
  }
  return rows;
}
function parseBalances(text) {
  const rows = [];
  const re =
    /^(.+?)\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+Dr\s+\$([\d,]+\.\d{2})\s+Dr$/;
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^TOTAL\b/i.test(line) || /^Customer Name/i.test(line)) continue;
    const m = line.match(re);
    if (m)
      rows.push({
        zoho_name: cleanName(m[1]),
        outstanding_balance: money(m[4]),
      });
  }
  return rows;
}
// A payment row may carry a free-text note between the payment mode and the invoice number.
function parsePayments(text) {
  const rows = [];
  rows.unparsed = [];
  const re =
    /^\d+\s+(\d{1,2}\s+\w{3}\s+\d{4})\s+Paid\s+(.+?)\s+(Check|Cash|Bank Transfer|Bank Remittance|Credit Card|Debit Card|Wire Transfer|ACH|Zelle|Venmo|PayPal)\s+(?:.*?\s)?(INV-\d+)\s+(?:.*?\s)?\$([\d,]+\.\d{2})/;
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^Payment Number/i.test(line)) continue;
    const m = line.match(re);
    if (m)
      rows.push({
        payment_date: parseDateLong(m[1]),
        zoho_name: cleanName(m[2]),
        payment_mode: m[3],
        invoice_number: m[4],
        amount: money(m[5]),
      });
    else if (/^\d+\s+\d{1,2}\s+\w{3}\s+\d{4}\s+Paid\b/.test(line))
      rows.unparsed.push(line); // looks like a payment but couldn't be read
  }
  return rows;
}
function parseFestivalSquare(text) {
  const rows = [];
  let inItems = false;
  const re = /^(.+?)\s+×\s+(\d+)\s+\$([\d,]+\.\d{2})$/;
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    if (/^ITEM SALES/i.test(line)) {
      inItems = true;
      continue;
    }
    if (!inItems) continue;
    if (/^©/.test(line)) break;
    if (/^Regular\s+×/i.test(line)) continue;
    const m = line.match(re);
    if (m)
      rows.push({
        item_name: cleanName(m[1]),
        quantity_sold: parseInt(m[2]),
        sales: money(m[3]),
      });
  }
  const pm = text.match(
    /(\w{3})\s+(\d{1,2}),\s+(\d{4}).*?-\s*(\w{3})\s+(\d{1,2}),\s+(\d{4})/,
  );
  let period = {};
  if (pm)
    period = {
      start: `${pm[3]}-${MONTHS[pm[1]]}-${pm[2].padStart(2, "0")}`,
      end: `${pm[6]}-${MONTHS[pm[4]]}-${pm[5].padStart(2, "0")}`,
    };
  return { rows, period };
}

// The report's own printed total: what the rows we read must add up to.
function extractSourceTotal(type, text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const find = (re) => {
    for (const l of lines) {
      const m = l.match(re);
      if (m) return m;
    }
    return null;
  };
  let m;
  if (type === "sales_customer") {
    m = find(/^TOTAL\s+(\d+)\s+\$([\d,]+\.\d{2})/);
    return m ? { amount: money(m[2]), count: parseInt(m[1]) } : null;
  }
  if (type === "sales_item") {
    m = find(/^TOTAL\s+([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/);
    return m ? { amount: money(m[2]), qty: money(m[1]) } : null;
  }
  if (type === "customer_balances" || type === "payments_received") {
    m = find(/^TOTAL\s+\$([\d,]+\.\d{2})/);
    return m ? { amount: money(m[1]) } : null;
  }
  if (type === "festival_square") {
    m = find(/^Gross Sales\s+\$([\d,]+\.\d{2})/);
    if (!m) return null;
    let qty = null,
      inCat = false;
    for (const l of lines) {
      if (/^CATEGORY SALES/i.test(l)) {
        inCat = true;
        continue;
      }
      if (/^ITEM SALES/i.test(l)) break;
      const c = inCat && l.match(/^(.+?)\s+×\s+(\d+)\s+\$/);
      if (c) qty = (qty || 0) + parseInt(c[2]);
    }
    return { amount: money(m[1]), qty };
  }
  return null;
}

// Turns one PDF page's text pieces into lines of text. When a table cell wraps onto a second line
// (e.g. "Brighton" / "Gourmet Deli"), the extra piece sits just below its row, in the same column,
// with no dollar amount on it: so it is folded back into that row instead of being lost.
function linesFromItems(items) {
  const byY = Object.create(null);
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    (byY[y] = byY[y] || []).push({
      x: it.transform[4],
      y,
      w: it.width || 0,
      str: it.str,
    });
  }
  const ys = Object.keys(byY)
    .map(Number)
    .sort((a, b) => b - a); // top of the page first
  const hasAmount = (y) => byY[y].some((p) => /\$[\d,]+\.\d{2}/.test(p.str)); // a data row has a money amount on it
  const rows = [];
  let current = null,
    lastY = null;
  for (const y of ys) {
    const parts = byY[y];
    if (hasAmount(y)) {
      current = { parts: [...parts] };
      lastY = y;
      rows.push(current);
      continue;
    }
    const wrapped =
      current &&
      lastY - y <= 15 &&
      parts.every((p) => current.parts.some((q) => Math.abs(q.x - p.x) < 3));
    if (wrapped) {
      current.parts.push(...parts);
      lastY = y;
    } else {
      rows.push({ parts: [...parts] });
      current = null;
    }
  }
  const byX = (a, b) => (Math.abs(a.x - b.x) < 2 ? b.y - a.y : a.x - b.x); // same column: upper piece first
  // Join the pieces: add a space only where there is a real gap on the page. Pieces that touch
  // (e.g. a font's joined "ff" in "Coffee", split into "Co" + "ff" + "ee") are glued back together.
  const joinParts = (parts) => {
    let out = "",
      prev = null;
    for (const p of parts) {
      if (prev) {
        const touching =
          Math.abs(p.y - prev.y) < 1 &&
          p.x - (prev.x + prev.w) < 1.2 &&
          !/\s$/.test(prev.str) &&
          !/^\s/.test(p.str);
        if (!touching) out += " ";
      }
      out += p.str;
      prev = p;
    }
    return out.replace(/\s+/g, " ").trim();
  };
  return rows.map((r) => joinParts(r.parts.sort(byX)));
}

async function extractTextFromPdf(file) {
  if (!/\.pdf$/i.test(file.name) || file.size > 20 * 1024 * 1024)
    throw new Error("Choose a PDF no larger than 20 MB.");
  const pdfjsLib = await getPdfLibrary();
  const task = pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
    stopAtErrors: true,
    cMapUrl: new URL("vendor/pdf/cmaps/", document.baseURI).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("vendor/pdf/standard_fonts/", document.baseURI)
      .href,
    wasmUrl: new URL("vendor/pdf/wasm/", document.baseURI).href,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 150)
      throw new Error("Reports must contain 150 pages or fewer.");
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i),
        content = await page.getTextContent();
      text += linesFromItems(content.items).join("\n") + "\n";
      page.cleanup();
    }
    return text;
  } finally {
    await task.destroy();
  }
}
