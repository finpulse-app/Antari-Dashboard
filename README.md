# Antari owner workspace

An owners-only dashboard for Antari's distribution business. Static frontend on GitHub Pages; authenticated business data and transactional report imports in Supabase.

## Local development

Use Node 24 and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
pnpm preview
```

The real app is `http://127.0.0.1:4173/index.html`. Sign in with an existing owner account. Database access requires membership in `public.owner_access`, independently of the browser UI. Never place service-role or secret keys in frontend files. The configured publishable key is intentionally public.

For a **fictional, read-only design preview**, run `node scripts/build.mjs --preview`, then open `/preview.html`. This fixture is excluded from production builds. Its numbers and customer names are not Antari business data.

## Deployment

1. In repository **Settings → Pages**, select **GitHub Actions** as the build source. This is required: the root source files depend on vendored assets generated into `dist/`.
2. Merge the reviewed change into `main`. The workflow runs tests and builds the production artifact before publishing.
3. Verify the main site URL while signed out (login required), then verify owner login, customer detail, ZIP map, and a report dry run.
4. Old `dashboard-v*.html` bookmarks redirect to the canonical `index.html`. Historical source remains in Git history.

No Supabase migrations run automatically from CI. The applied database changes are recorded in `database/` in this order: `owner-hardening.sql`, `remove-redundant-indexes.sql`, `import-actor.sql`, `private-payment-locking.sql`. These describe the migrations already applied to the connected Antari project; do not rerun them blindly. `functions-before.sql` is an audit baseline, not an automatic rollback script. `verify-payment-integrity.sql` is a rollback-only validation script.

## Structure

- `assets/js/core.js`: configuration, formatting, modal helpers, lazy PDF library.
- `assets/js/analytics.js`: complete-month analytics and comparison functions.
- `assets/js/screens.js`: detail dialogs, owner authentication, receivables, customer matching, reports.
- `assets/js/parsers.js`: PDF text extraction and report parsers.
- `assets/js/imports.js`: staged report checks, previews, transactional imports, import history.
- `assets/js/app.js`: query orchestration and legacy report rendering.
- `assets/js/workspace.js`: responsive navigation, directory, exports, accessibility, error states.
- `assets/js/territories.js`: ZIP map, metrics, customer drilldowns.

## Data meaning

“Reported sales” combines loaded wholesale reports with Square item gross sales. Channel coverage can differ. It is not profit, net cash, or a verified accounting statement. Payments are collections, not order dates. Aggregate multi-month reports cannot be split into invented monthly sales; only complete single-month coverage is used in comparisons.

Dashboard-recorded payments adjust a particular balance snapshot. They do not write back to Zoho and do not independently establish invoice-level overdue status. New payments must be dated after the snapshot and no later than the current New York business date. Historical questionable records are flagged for owner review, not silently altered.

## Map attribution

Boundaries are from [NYC Open Data: ZIP Code Tabulation Areas](https://data.cityofnewyork.us/City-Government/ZIP-Code-Tabulation-Areas/35j5-n34v), retrieved October 17, 2026. Coordinates are rounded to five decimal places. ZCTAs approximate postal ZIP codes; they are not precise USPS delivery boundaries. Geometry is bundled locally. Business details are joined in the authenticated browser, with no remote basemap or customer-data transmission to a map provider. ZIPs outside this boundary set remain accessible through the territory list.

See `docs/AUDIT.md` for findings, validation, outstanding items, and the implementation roadmap.
