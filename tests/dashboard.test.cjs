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
  vm.runInContext(
    "var renderTerritories=function(){}; var refreshTerritoryMap=function(){};",
    ctx,
  );
  if (transform) transform(ctx);
  if (!preview)
    vm.runInContext(
      "window.supabase={createClient:()=>createPreviewClient()};",
      ctx,
    );
  for (const name of [
    "core",
    "analytics",
    "screens",
    "parsers",
    "imports",
    "app",
    "workspace",
  ])
    vm.runInContext(readFileSync(root + `assets/js/${name}.js`, "utf8"), ctx, {
      filename: name + ".js",
    });
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
      "routes",
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
