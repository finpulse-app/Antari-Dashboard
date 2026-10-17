import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
