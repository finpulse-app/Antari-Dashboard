const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const root = __dirname + "/../";
function makeApp({ preview = true, transform } = {}) {
  let html = readFileSync(root + "index.html", "utf8").replace(
    /<script[\s\S]*?<\/script>/g,
    "",
  );
  if (preview)
    html = html.replace(
      '<html lang="en">',
      '<html lang="en" data-preview="true">',
    );
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const ctx = dom.getInternalVMContext();
  vm.runInContext(readFileSync(root + "tests/preview-data.js", "utf8"), ctx);
  // Map geometry is browser-tested; DOM tests cover data aggregation without a canvas.

  if (transform) transform(ctx);
  if (!preview)
    vm.runInContext(
      "window.supabase={createClient:()=>createPreviewClient()};",
      ctx,
    );
  for (const name of [
    "core",
    "analytics",
    "business-types",
    "allocations",
    "screens",
    "parsers",
    "imports",
    "app",
    "neighborhoods",
    "territories",
    "note-capture",
    "fieldwork",
    "territory-studio",
    "workspace",
  ]) {
    vm.runInContext(readFileSync(root + `assets/js/${name}.js`, "utf8"), ctx, {
      filename: name + ".js",
    });
    if (name === "territories")
      vm.runInContext(
        "renderTerritories=function(){}; refreshTerritoryMap=function(){};",
        ctx,
      );
  }
  return { dom, ctx, run: (code) => vm.runInContext(code, ctx) };
}
async function settled(app) {
  await app.run("loadInFlight?.promise");
  await new Promise((r) => setTimeout(r, 5));
}
test("every module parses and canonical entry has no CDN dependency", () => {
  for (const name of readdirSync(root + "assets/js"))
    new vm.Script(readFileSync(root + "assets/js/" + name, "utf8"));
  assert.doesNotMatch(
    readFileSync(root + "index.html", "utf8"),
    /cdn\.jsdelivr|signUp\(/,
  );
});
test("full dashboard loads all major screens, directory and report dialogs", async () => {
  const app = makeApp();
  try {
    await settled(app);
    assert.equal(app.run("D.stores.length"), 8);
    assert.match(
      app.dom.window.document.querySelector("#kpi-total").textContent,
      /48.9k/,
    );
    for (const view of [
      "stores",
      "products",
      "receivables",
      "trends",
      "zips",
      "data",
      "upload",
    ]) {
      app.run(`navigateTo('${view}')`);
      assert.ok(
        app.dom.window.document
          .querySelector("#panel-" + view)
          .classList.contains("active"),
      );
    }
    app.run("openModal(D.storeData[0])");
    assert.match(
      app.dom.window.document.querySelector("#modal-name").textContent,
      /Cedar/,
    );
    app.run("openMonthlyReport()");
    assert.ok(
      app.dom.window.document.querySelector("#gm-modal").textContent.length >
        100,
    );
    app.run("openProductModal(D.sortedProducts[0])");
    assert.match(
      app.dom.window.document.querySelector("#gm-modal").textContent,
      /Apricot/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("directory search, sort and CSV neutralize formula injection", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.dom.window.document.querySelector("#customer-filter").value = "queens";
    app.run("renderDirectory()");
    assert.match(
      app.dom.window.document.querySelector("#customer-directory").textContent,
      /Eastwood/,
    );
    assert.equal(app.run("customerRows().length"), 1);
    assert.equal(app.run('csvCell("=IMPORTXML(1)")'), '"\'=IMPORTXML(1)"');
    assert.equal(
      app.run("csvCell(" + JSON.stringify('a,b"c') + ")"),
      '"a,b""c"',
    );
  } finally {
    app.dom.window.close();
  }
});
test("complete-month comparisons do not invent values for missing months", () => {
  const app = makeApp();
  try {
    assert.equal(
      app.run(
        'analyzeSeries([{month:"2026-01",value:100},{month:"2026-03",value:150}]).mom',
      ),
      null,
    );
    assert.equal(
      app.run(
        'analyzeSeries([{month:"2026-01",value:100},{month:"2026-02",value:150}]).mom.pct',
      ),
      50,
    );
    assert.equal(
      app.run(
        'completeSeries([{source:"wholesale",status:"partial",month:"2026-01-01",revenue:100}],"wholesale","revenue").length',
      ),
      0,
    );
  } finally {
    app.dom.window.close();
  }
});
test("pagination loads more than the Supabase default row limit and propagates errors", async () => {
  const app = makeApp();
  try {
    assert.equal(
      await app.run(
        "fetchAllRows(()=>({order(){return this},range(a,b){return Promise.resolve({data:Array.from({length:1201},(_,i)=>i).slice(a,b+1)})}}),[],500).then(x=>x.length)",
      ),
      1201,
    );
    await assert.rejects(
      app.run(
        'fetchAllRows(()=>({range(){return Promise.resolve({error:{message:"network offline"}})}}),[])',
      ),
      /network offline/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("sign out clears cached business state and late loads cannot reveal content", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run("clearWorkspace()");
    assert.equal(app.run("D"), null);
    assert.equal(
      app.dom.window.document.querySelector("#content").style.display,
      "none",
    );
    assert.equal(app.run("storeData.length"), 0);
    assert.equal(app.run("Object.keys(uploadQueue).length"), 0);
  } finally {
    app.dom.window.close();
  }
});
test("preview client refuses every write", async () => {
  const app = makeApp();
  try {
    assert.match(
      (await app.run('sb.from("stores").insert({})')).error.message,
      /disabled/,
    );
    assert.match(
      (await app.run('sb.rpc("import_report",{})')).error.message,
      /disabled/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("database names render as text rather than executable HTML", async () => {
  const app = makeApp({
    transform: (ctx) =>
      vm.runInContext(
        'const baseline=createPreviewData; createPreviewData=()=>{const data=baseline();data.stores[0].store_name="<img src=x onerror=alert(1)>";data.v_store_ranking[0].store_name=data.stores[0].store_name;return data;};',
        ctx,
      ),
  });
  try {
    await settled(app);
    assert.equal(
      app.dom.window.document.querySelectorAll("#content img[onerror]").length,
      0,
    );
    assert.match(
      app.dom.window.document.querySelector("#customer-directory").textContent,
      /<img/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("PDF parser rejects missing totals and parses valid report fixture", () => {
  const app = makeApp();
  try {
    assert.equal(
      app.run('extractSourceTotal("sales_customer","No total here")'),
      null,
    );
    assert.equal(
      app.run(
        'parseSalesCustomer("Cedar Market 2 $120.00 $0.00\\nTOTAL 2 $120.00")[0].sales',
      ),
      120,
    );
  } finally {
    app.dom.window.close();
  }
});
test("an empty workspace shows empty states without manufacturing revenue or trends", async () => {
  const app = makeApp({
    transform: (ctx) => vm.runInContext("createPreviewData=()=>({});", ctx),
  });
  try {
    await settled(app);
    assert.ok(app.run("D"));
    assert.equal(app.run("D.wholesale"), 0);
    assert.equal(app.run("D.an.wA.mom"), null);
    assert.doesNotMatch(
      app.dom.window.document.querySelector("#status").textContent,
      /Unable to load/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("failed refresh preserves previous data with a visible stale warning", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run(
      'sb.from=()=>({select(){return this},order(){return this},range(){return Promise.resolve({error:{message:"offline"}})}})',
    );
    await app.run("load()");
    assert.equal(
      app.dom.window.document.querySelector("#refresh-warning").hidden,
      false,
    );
    assert.match(
      app.dom.window.document.querySelector("#refresh-warning").textContent,
      /last successful data/,
    );
    assert.equal(app.run("D.stores.length"), 8);
  } finally {
    app.dom.window.close();
  }
});
test("a pending request cannot repopulate the dashboard after sign out", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run(
      "const oldFrom=sb.from; let releases=[]; sb.from=name=>{const q=oldFrom(name);const oldRange=q.range;q.range=(a,b)=>new Promise(resolve=>{releases.push(()=>resolve(oldRange.call(q,a,b)));});return q;}; const pendingLoad=load(); clearWorkspace();",
    );
    app.run("releases.forEach(release=>release())");
    await app.run("pendingLoad");
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(app.run("D"), null);
    assert.equal(
      app.dom.window.document.querySelector("#content").style.display,
      "none",
    );
  } finally {
    app.dom.window.close();
  }
});
test("approved import previews remain importable and duplicate clicks cannot write twice", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run(
      `const card=document.createElement('div');card.id='uc-test';document.getElementById('upload-results').append(card);uploadQueue.test={dbType:'sales_customer',rows:[{zoho_name:'Sample',invoice_count:1,sales:100}],source:{amount:100,count:1},period:{start:'2020-01-01',end:'2020-01-31'},fileName:'Sample.pdf'};renderUploadCard('test',{data:{ok:true,rows_in_file:1,parsed_total:100,to_add:1,skipped:0}});`,
    );
    assert.equal(app.run("uploadQueue.test.approved"), true);
    assert.equal(app.run("uploadQueue.test.saving"), undefined);
    app.run(
      `let writes=0;callImport=async()=>{writes++;return {data:{added:1,skipped:0}}};`,
    );
    await Promise.all([
      app.run('importRows("test")'),
      app.run('importRows("test")'),
    ]);
    assert.equal(app.run("writes"), 1);
  } finally {
    app.dom.window.close();
  }
});
test("null routes and hostile route/ZIP strings never enter executable HTML", async () => {
  const app = makeApp({
    transform: (ctx) =>
      vm.runInContext(
        `const originalFixture=createPreviewData;createPreviewData=()=>{const d=originalFixture();d.v_route_summary[0].delivery_route=null;d.v_route_summary[1].delivery_route='<img src=x onerror=alert(1)>';d.v_zip_ranking[0].zip='<img src=x onerror=alert(1)>';return d;};`,
        ctx,
      ),
  });
  try {
    await settled(app);
    assert.ok(app.run("D"));
    assert.equal(
      app.dom.window.document.querySelectorAll("#content img[onerror]").length,
      0,
    );
    assert.match(
      app.dom.window.document.querySelector("#route-tiles").textContent,
      /Unassigned/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("a real PDF is extracted and parsed through the bundled patched PDF engine", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const lines = [
    "Sales by Customer",
    "From 01 Aug 2026 To 31 Aug 2026",
    "Cedar Market 2 $120.00 $0.00",
    "TOTAL 2 $120.00 $0.00",
  ];
  const stream =
    "BT /F1 12 Tf " +
    lines
      .map((text, i) => `1 0 0 1 40 ${750 - i * 30} Tm (${text}) Tj`)
      .join(" ") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n",
    offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const task = getDocument({
    data: new Uint8Array(Buffer.from(pdf)),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const app = makeApp();
  try {
    const document = await task.promise;
    const content = await (await document.getPage(1)).getTextContent();
    app.ctx.pdfItems = content.items;
    const text = app.run('linesFromItems(pdfItems).join("\\n")');
    app.ctx.pdfText = text;
    assert.equal(app.run("parseSalesCustomer(pdfText)[0].sales"), 120);
    assert.equal(
      app.run('extractSourceTotal("sales_customer",pdfText).amount'),
      120,
    );
    assert.equal(app.run("extractPeriod(pdfText).start"), "2026-08-01");
  } finally {
    await task.destroy();
    app.dom.window.close();
  }
});
test("payment dates use New York's business day when the owner travels", () => {
  const app = makeApp();
  try {
    assert.equal(
      app.run('businessDay(new Date("2026-10-18T01:00:00Z"))'),
      "2026-10-17",
    );
  } finally {
    app.dom.window.close();
  }
});
test("daily briefing puts payment uncertainty ahead of collection prompts", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const tasks = app.run(
      'buildDailyBriefing({...D,payLog:[{paid_on:"2026-09-01",as_of_date:"2026-09-30",amount:50}],unresolved:[{zoho_name:"Unknown customer",revenue:100}]})',
    );
    assert.equal(tasks[0].kind, "payment-review");
    assert.ok(tasks.some((t) => t.kind === "names"));
    assert.ok(!tasks.some((t) => t.kind === "collection"));
    assert.doesNotMatch(tasks.map((t) => t.title).join(" "), /overdue/i);
  } finally {
    app.dom.window.close();
  }
});
test("map coverage excludes Other buyers and customers without mapped boundaries", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const coverage = app.run(
      'territoryCoverage({storeData:[{zip:"11235",total_revenue:100},{zip:"99999",total_revenue:50},{zip:null,total_revenue:25}],wholesale:1000,otherTotal:825})',
    );
    assert.equal(coverage.mappedSales, 100);
    assert.equal(coverage.otherSales, 825);
    assert.equal(coverage.unplacedSales, 75);
    assert.equal(coverage.percent, 10);
  } finally {
    app.dom.window.close();
  }
});
test("field actions open payment selection and shared notes, with failed saves preserved", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run("openFieldPayment()");
    assert.match(
      app.dom.window.document.querySelector("#gm-modal").textContent,
      /Cedar Market/,
    );
    app.run('openVisitNotes("Cedar Market")');
    app.dom.window.document.querySelector("#visit-note").value =
      "Checked shelf stock.";
    app.dom.window.document.querySelector("#visit-save").click();
    await new Promise((r) => setTimeout(r, 5));
    assert.match(
      app.dom.window.document.querySelector("#visit-error").textContent,
      /disabled/,
    );
    assert.equal(
      app.dom.window.document.querySelector("#visit-note").value,
      "Checked shelf stock.",
    );
  } finally {
    app.dom.window.close();
  }
});
test("phone search toggles accessibly and navigation carries the active view", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.dom.window.document.querySelector("#mobile-search-toggle").click();
    assert.equal(
      app.dom.window.document
        .querySelector("#mobile-search-toggle")
        .getAttribute("aria-expanded"),
      "true",
    );
    app.run('navigateTo("stores")');
    assert.equal(app.dom.window.document.body.dataset.view, "stores");
    assert.equal(
      app.dom.window.document.body.classList.contains("search-open"),
      false,
    );
    assert.equal(
      app.dom.window.document.querySelectorAll(".mobile-actions button").length,
      5,
    );
  } finally {
    app.dom.window.close();
  }
});

test("expansion scenarios calculate contribution, sensitivity, and cost coverage without touching financial totals", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const before = app.run("D.wholesale+D.direct");
    const r = app.run(
      "calculateExpansion({customers:5,order_value:100,orders_per_month:2,margin_pct:30,monthly_cost:50})",
    );
    assert.equal(r.revenue, 1000);
    assert.equal(r.grossProfit, 300);
    assert.equal(r.contribution, 250);
    assert.equal(r.breakEvenCustomers, 1);
    assert.equal(r.cases[0].contribution, 190);
    assert.equal(r.cases[2].contribution, 310);
    assert.equal(
      app.run(
        'calculateExpansion({customers:"",order_value:100,orders_per_month:2,margin_pct:30,monthly_cost:50})',
      ),
      null,
    );
    assert.equal(
      app.run(
        "calculateExpansion({customers:2.5,order_value:100,orders_per_month:2,margin_pct:30,monthly_cost:50})",
      ),
      null,
    );
    assert.equal(
      app.run(
        "calculateExpansion({customers:5,order_value:100,orders_per_month:2,margin_pct:0,monthly_cost:50}).breakEvenCustomers",
      ),
      null,
    );
    assert.equal(app.run("D.wholesale+D.direct"), before);
  } finally {
    app.dom.window.close();
  }
});
test("territory workspace redirects old routes and keeps its four views navigable", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run('navigateTo("routes")');
    assert.equal(app.dom.window.document.body.dataset.view, "zips");
    assert.equal(
      app.dom.window.document.querySelectorAll('.tab[data-tab="routes"]')
        .length,
      0,
    );
    for (const view of ["pipeline", "planner", "brief", "explore"]) {
      app.dom.window.document
        .querySelector(`[data-studio-view="${view}"]`)
        .click();
      assert.equal(
        app.dom.window.document.querySelector(`#studio-${view}`).hidden,
        false,
      );
      assert.equal(
        app.dom.window.document.querySelectorAll(".studio-view:not([hidden])")
          .length,
        1,
      );
    }
    assert.match(
      app.dom.window.document.querySelector("#territory-owner-brief")
        .textContent,
      /Other buyers|Map coverage is incomplete/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("pipeline stages are owner records and hostile text stays inert", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run(
      'D.prospects=[{id:"a",business_name:"<img src=x onerror=alert(1)>",zip:"11235",stage:"sampled",notes:"<script>boom</script>",next_step:"Call the buyer",sampling_cost:25,archived:false,revision:1}];renderProspectBoard(D)',
    );
    assert.equal(
      app.dom.window.document.querySelectorAll(
        "#prospect-board img,#prospect-board script",
      ).length,
      0,
    );
    assert.match(
      app.dom.window.document.querySelector("#pipeline-summary").textContent,
      /\$25.00/,
    );
    assert.equal(
      app.dom.window.document.querySelector('[data-prospect-stage="a"]').value,
      "sampled",
    );
    app.run("openProspectForm(D.prospects[0])");
    assert.equal(
      app.dom.window.document.querySelector('[name="business_name"]').value,
      "<img src=x onerror=alert(1)>",
    );
  } finally {
    app.dom.window.close();
  }
});
test("stale edits fail visibly instead of overwriting another owner's changes", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run(
      "sb.from=()=>({update:()=>({eq(){return this},select:async()=>({data:[],error:null})})})",
    );
    await assert.rejects(
      () =>
        app.run(
          'persistShared("territory_prospects",{stage:"sampled"},{id:"a",revision:1})',
        ),
      /changed in another session/,
    );
  } finally {
    app.dom.window.close();
  }
});
test("attention signals distinguish owner commitments from inferred order activity", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const signals = app.run(
      'territorySignals({...D,payLog:[],balances:[],unresolved:[],followups:[{id:"f",store_name:D.storeData[0].store_name,title:"Discuss samples",due_on:businessDay(),completed:false}],prospects:[]})',
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].type, "followup");
    assert.match(signals[0].evidence, /set for/);
    assert.doesNotMatch(signals[0].evidence, /last order|overdue invoice/i);
  } finally {
    app.dom.window.close();
  }
});
test("visit wording captures units, juice, first purchase discount, and price", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const r = app.run(
      'interpretVisitNote("Sold 100 units of juice to Cedar Market, which includes a 10% first time discount at $2 each",D.stores)',
    );
    assert.equal(r.kind, "sale_draft");
    assert.equal(r.quantity, 100);
    assert.equal(r.product, "juice");
    assert.equal(r.discount_pct, 10);
    assert.equal(r.discount_reason, "First purchase");
    assert.equal(r.unit_price, 2);
    assert.equal(r.customer, "Cedar Market");
    const money = app.run(
      "saleDraftAmounts({quantity:100,unit_price:2,discount_pct:10})",
    );
    assert.equal(money.gross, 200);
    assert.equal(money.discount, 20);
    assert.equal(money.afterDiscount, 180);
  } finally {
    app.dom.window.close();
  }
});
test("unknown prices or discounts stay unknown, and plans, negation, multiple products and total prices are not posted as sales", async () => {
  const app = makeApp();
  try {
    await settled(app);
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 bottles of juice with a 10% discount").unit_price',
      ),
      null,
    );
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 bottles of juice at $2 each").discount_pct',
      ),
      null,
    );
    assert.equal(
      app.run(
        "saleDraftAmounts({quantity:100,unit_price:null,discount_pct:10})",
      ),
      null,
    );
    for (const text of [
      "Will sell 100 bottles of juice with 10% discount",
      "Did not sell 100 bottles of juice",
      "Sold 100 bottles of juice and 20 cases of tea",
    ]) {
      app.ctx.wording = text;
      assert.equal(app.run("interpretVisitNote(wording).kind"), "note");
    }
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 bottles of juice for $100 total").unit_price',
      ),
      null,
    );
  } finally {
    app.dom.window.close();
  }
});
test("typing a sale note immediately builds structured details, retains missing prices, and refuses a customer mismatch", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run('openVisitNotes("Cedar Market")');
    const note = app.dom.window.document.querySelector("#visit-note");
    note.value = "Sold 100 bottles of juice with a 10% first time discount";
    note.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    const capture = app.run(
      'document.getElementById("note-sale-fields").getCapture()',
    );
    assert.equal(capture.activity_kind, "sale_draft");
    assert.equal(capture.quantity, 100);
    assert.equal(capture.discount_pct, 10);
    assert.equal(capture.unit_price, null);
    assert.match(
      app.dom.window.document.querySelector("#note-understanding").textContent,
      /Unit price missing/,
    );
    note.value =
      "Sold 100 bottles of juice to Ararat Bakery with a 10% discount";
    note.dispatchEvent(new app.dom.window.Event("input", { bubbles: true }));
    assert.throws(
      () => app.run('document.getElementById("note-sale-fields").getCapture()'),
      /differs from the selected customer/,
    );
  } finally {
    app.dom.window.close();
  }
});

test("ZIP concentration uses listed buyers only and prospects never add financial sales", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const g = app.run(
      'territoryStats({storeData:[{store_name:"A",zip:"11235",total_revenue:300,outstanding_balance:20,invoices:2},{store_name:"B",zip:"11235",total_revenue:100,outstanding_balance:0,invoices:1},{store_name:"C",zip:"11235",total_revenue:0,outstanding_balance:0,invoices:0}],prospects:[{zip:"11235",stage:"sampled",archived:false},{zip:"11235",stage:"paused",archived:false}]}).get("11235")',
    );
    assert.equal(g.revenue, 400);
    assert.equal(g.prospects, 1);
    app.ctx.testGroup = g;
    const c = app.run("concentration(testGroup)");
    assert.equal(c.buyers, 2);
    assert.equal(c.share, 75);
  } finally {
    app.dom.window.close();
  }
});
test("sale drafts never affect a report-based owner brief and signout clears scenario inputs", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const before = app.run("D.wholesale+D.direct");
    app.run(
      'D.visitNotes=[{activity_kind:"sale_draft",quantity:100,product:"juice",unit_price:2,discount_pct:10}];renderOwnerBrief(D)',
    );
    assert.equal(app.run("D.wholesale+D.direct"), before);
    assert.match(
      app.dom.window.document.querySelector("#territory-owner-brief")
        .textContent,
      /visit sale drafts are excluded/,
    );
    app.dom.window.document.querySelector(
      '#expansion-form [name="title"]',
    ).value = "Private plan";
    app.run("clearWorkspace()");
    assert.equal(
      app.dom.window.document.querySelector('#expansion-form [name="title"]')
        .value,
      "",
    );
    assert.equal(
      app.dom.window.document.querySelector("#territory-owner-brief")
        .textContent,
      "",
    );
  } finally {
    app.dom.window.close();
  }
});

test("conditional discounts, refunds, and imprecise unit prices remain unasserted", async () => {
  const app = makeApp();
  try {
    await settled(app);
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 bottles of juice. Discussed a 10% discount for next order.").discount_pct',
      ),
      null,
    );
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 bottles of juice at $2.999 each").unit_price',
      ),
      null,
    );
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 bottles of juice but returned the order").kind',
      ),
      "note",
    );
    assert.equal(
      app.run(
        'interpretVisitNote("Sold 100 cases of juice at $1,000 each with a 10% discount").unit_price',
      ),
      1000,
    );
  } finally {
    app.dom.window.close();
  }
});

test("provisional revenue splits keep source invoice counts once and label location counts as unassigned", async () => {
  const app = makeApp();
  try {
    await settled(app);
    assert.equal(
      app.run(
        "sourceInvoiceTotal([{id:1,is_allocated:true,invoice_count:null,source_invoice_count:2},{id:1,is_allocated:true,invoice_count:null,source_invoice_count:2},{id:1,is_allocated:true,invoice_count:null,source_invoice_count:2},{id:2,invoice_count:3}])",
      ),
      5,
    );
    assert.equal(
      app.run(
        "invoiceDescription({has_estimated_sales:true,invoices:null},false)",
      ),
      "Unassigned by location",
    );
    app.run(
      'D.saleAllocations=[{source_sale_id:1,store_name:D.stores[0].store_name,allocated_sales:100,notes:"Owner estimate",is_active:true},{source_sale_id:1,store_name:D.stores[1].store_name,allocated_sales:100,notes:"Owner estimate",is_active:true}];renderSalesAllocationPanel(D)',
    );
    const text =
      app.dom.window.document.querySelector("#sales-allocations").textContent;
    assert.match(text, /PROVISIONAL OWNER ESTIMATE/);
    assert.match(text, /\$200.00 divided across 2/);
    assert.match(text, /Disable split/);
    assert.match(text, /Payments and balances are unchanged/);
  } finally {
    app.dom.window.close();
  }
});
test("an active split cannot be silently overwritten by an ordinary name mapping", async () => {
  const app = makeApp();
  try {
    await settled(app);
    app.run("D.mappedRows[0].is_allocated=true");
    const message = await app.run(
      'saveMapping([{zoho_name:D.mappedRows[0].zoho_name,mapped_store:"Other"}])',
    );
    assert.match(message.message, /Disable.*provisional sales split/);
  } finally {
    app.dom.window.close();
  }
});

test("business type filters synchronize map and directory and preserve overall financial totals", async () => {
  const app = makeApp();
  try {
    await settled(app);
    const total = app.run("D.wholesale+D.direct");
    const select = app.dom.window.document.querySelector(
      "#customer-business-type",
    );
    select.value = "restaurant";
    select.dispatchEvent(new app.dom.window.Event("change", { bubbles: true }));
    assert.equal(
      app.dom.window.document.querySelector("#map-business-type").value,
      "restaurant",
    );
    assert.equal(app.run("customerRows().length"), 1);
    assert.equal(app.run("customerRows()[0].category"), "Restaurant");
    assert.equal(
      app.run("[...territoryStats(D).values()].flatMap(g=>g.customers).length"),
      1,
    );
    assert.equal(
      app.dom.window.document.querySelector("#stores-top-bottom").hidden,
      true,
    );
    assert.match(
      app.dom.window.document.querySelector("#business-filter-status")
        .textContent,
      /Restaurants.*1 matching customers/,
    );
    assert.equal(app.run("D.wholesale+D.direct"), total);
    select.value = "";
    select.dispatchEvent(new app.dom.window.Event("change", { bubbles: true }));
    assert.equal(app.run("customerRows().length"), 8);
    assert.equal(
      app.dom.window.document.querySelector("#stores-top-bottom").hidden,
      false,
    );
  } finally {
    app.dom.window.close();
  }
});
test("business category options group grocery aliases and signout clears the shared selection", async () => {
  const app = makeApp();
  try {
    await settled(app);
    assert.equal(app.run('businessTypeKey("Groceries")'), "market");
    assert.equal(app.run('businessTypeKey("Bakeries")'), "bakery");
    const select = app.dom.window.document.querySelector("#map-business-type");
    select.value = "bakery";
    select.dispatchEvent(new app.dom.window.Event("change", { bubbles: true }));
    assert.equal(app.run("customerRows().length"), 2);
    assert.match(
      app.dom.window.document.querySelector("#business-filter-status")
        .textContent,
      /Bakeries/,
    );
    app.run("clearWorkspace()");
    assert.equal(app.run("activeBusinessType"), "");
    assert.equal(
      app.dom.window.document.querySelector("#business-filter-status").hidden,
      true,
    );
  } finally {
    app.dom.window.close();
  }
});
