import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "vendor/pdf"), { recursive: true });
for (const name of ["assets", "index.html"])
  await cp(path.join(root, name), path.join(dist, name), { recursive: true });
for (const name of await readdir(root))
  if (/^(dashboard-v\d+|index-2)\.html$/.test(name))
    await cp(path.join(root, name), path.join(dist, name));
await cp(
  path.join(root, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"),
  path.join(dist, "vendor/supabase.js"),
);
for (const name of ["pdf.mjs", "pdf.worker.mjs"])
  await cp(
    path.join(root, "node_modules/pdfjs-dist/build", name),
    path.join(dist, "vendor/pdf", name),
  );
await cp(
  path.join(root, "node_modules/pdfjs-dist/cmaps"),
  path.join(dist, "vendor/pdf/cmaps"),
  { recursive: true },
);
await cp(
  path.join(root, "node_modules/pdfjs-dist/standard_fonts"),
  path.join(dist, "vendor/pdf/standard_fonts"),
  { recursive: true },
);
await cp(
  path.join(root, "node_modules/pdfjs-dist/wasm"),
  path.join(dist, "vendor/pdf/wasm"),
  { recursive: true },
);
await cp(
  path.join(root, "node_modules/pdfjs-dist/LICENSE"),
  path.join(dist, "vendor/pdf/LICENSE"),
);
await cp(
  path.join(root, "node_modules/@supabase/supabase-js/LICENSE"),
  path.join(dist, "vendor/SUPABASE-LICENSE"),
);
// Design preview is built locally and explicitly uses synthetic data; excluded from production artifact.
if (process.argv.includes("--preview")) {
  const { readFile } = await import("node:fs/promises");
  let html = await readFile(path.join(root, "index.html"), "utf8");
  html = html
    .replace('<html lang="en">', '<html lang="en" data-preview="true">')
    .replace(
      '<script src="assets/js/core.js"',
      '<script src="preview-data.js" defer></script><script src="assets/js/core.js"',
    );
  await writeFile(path.join(dist, "preview.html"), html);
  await cp(
    path.join(root, "tests/preview-data.js"),
    path.join(dist, "preview-data.js"),
  );
}
console.log(`Built ${dist}`);
await cp(
  path.join(root, "node_modules/leaflet/dist"),
  path.join(dist, "vendor/leaflet"),
  { recursive: true },
);
await cp(
  path.join(root, "node_modules/leaflet/LICENSE"),
  path.join(dist, "vendor/leaflet/LICENSE"),
);

// Every document references the exact asset contents shipped with this build.
// This prevents stale cached scripts from being mixed with a newer page.
const entries = [
  "index.html",
  ...(process.argv.includes("--preview") ? ["preview.html"] : []),
];
for (const entry of entries) {
  const target = path.join(dist, entry);
  let html = await readFile(target, "utf8");
  const assetPattern =
    /(src|href)="((?:assets|vendor)\/[^"?]+|preview-data\.js)"/g;
  const assets = [
    ...new Set([...html.matchAll(assetPattern)].map((match) => match[2])),
  ];
  const versions = new Map(
    await Promise.all(
      assets.map(async (asset) => [
        asset,
        createHash("sha256")
          .update(await readFile(path.join(dist, asset)))
          .digest("hex")
          .slice(0, 12),
      ]),
    ),
  );
  html = html.replace(
    assetPattern,
    (_, attribute, asset) => `${attribute}="${asset}?v=${versions.get(asset)}"`,
  );
  await writeFile(target, html);
}
