# Antari territory workspace

This release puts territory decisions into four focused areas: Explore the map, Grow your network, Plan an expansion, and Owner brief. Laptop is the primary layout. Smaller screens stack the same tools and keep the existing field shortcuts.

## What owners can do

- Explore listed-customer sales, outstanding balances, customer counts, and owner-recorded prospects by ZIP.
- Select any boundary area, including areas without listed customers. Search by ZIP or nearby neighborhood. Existing route URLs redirect to territory insights; the route data is retained.
- Open a customer beside the map, see report dates and recent notes, record a visit, set a dated next action, or record a payment through the existing payment workflow.
- Track prospects through conversations, samples, first orders, repeat buyers, and holds. Capture interests, contact details, sample spending, and follow-up dates. Link to an existing customer without creating duplicate financial sales. Archive and restore prospects.
- Create territory projects with a hypothesis, success measure, review date, and owner-recorded outcome. Changes in sales are not presented as proof of causation.
- Explore expansion scenarios using explicit assumptions: customer count, order value, frequency, gross margin, and extra monthly operating costs. View monthly contribution and sensitivity to order value. Save, edit, archive, and restore shared plans. These are illustrations, not forecasts; general overhead, financing, taxes, and working capital are excluded.
- Print an owner brief that includes channels, reporting coverage, balances, customer concentration, geographic coverage, and data limitations. It is an internal management summary, not audited financial statements.

## Write once, capture useful details

Common sale wording in visit notes is parsed as the owner types. For example:

> Sold 100 bottles of juice at $2 each with a 10% first time discount.

This captures product, quantity, unit, unit price, percentage discount, and first purchase reason. The note displays $200 before discount, a $20 discount, and $180 after discount before tax in its saved details. One save records the original words and structured details together. If price is absent, it remains unknown. Unknown discounts remain unknown rather than being assumed zero. Explicit customer names can select an unselected customer; a mismatch with an already selected customer requires correction. ISO dates and “today” can populate the sale date; otherwise it stays unknown.

This is deterministic recognition of common sales phrasing, not a general-purpose language model. Plans, negation, multiple products, refunds, cancellations, and ambiguous prices are not automatically treated as a valid single sale. Manual correction is available. It does not create invoices, reduce stock, alter receivables, or call Zoho/Square. Structured field sale drafts remain excluded from imported financial totals, avoiding double counting when Zoho reports arrive. Broader prose understanding and reconciliation to invoice line items remain future work.

## Access and integrity

Migration `antari_territory_workspace_and_visit_capture` adds four owner-only tables and structured columns on append-only visit notes. Both existing owners share records. New tables have SELECT/INSERT/UPDATE policies restricted through `is_owner()`, with no anonymous grants or DELETE privilege. Triggers stamp authors and timestamps, preserve original creators, and increment revisions. Frontend edits include the expected revision, so stale edits cannot overwrite a co-owner's changes. Prospect identity is unique by normalized business name and ZIP. New form IDs remain stable across retries. Financial report tables and existing payment safeguards are retained.

Rollback verification exercises both owners, stranger isolation, anonymous privileges, forged actor stamping, revision conflict, duplicate identity, invalid discounts, missing sale products, and the fact that sale drafts do not change channel totals. Test data is rolled back.

## Data limits

- Current customer matching covers only part of wholesale sales geographically. Other buyers and outside-boundary amounts remain visible.
- There is no reliable customer-to-product or exact order-date relationship in the loaded summary reports. Product gaps, reorder timing, and territory profit are not fabricated.
- Customer concentration is calculated within listed-customer sales, with the denominator identified.
- Balance flags distinguish report age and payment uncertainty from overdue invoices.
- NYC ZCTA geometry and neighborhood references are bundled; no customer coordinates are sent to a map provider. Neighborhood names are approximate nearby context.
- PDF parsing and duplicate protections retain the prior release's scope. This release does not certify all original report exports.

## Validation

31 automated checks cover dashboard loading, auth/session cleanup, imports, parsing, expansion arithmetic, sensitivity, pipeline escaping, stale edit protection, attention evidence, typed note extraction, unknown values, customer mismatches, concentration, and financial isolation. Browser QA checks real owner data on laptop and narrow screens. Supabase security advisor found no new warnings; the previously documented compromised-password protection setting remains disabled.

Returning-owner startup now registers authentication listeners only after the final deferred module has loaded. This fixes an observed race in which an initial session could call dashboard loading before its helper functions existed. Leaflet panes are isolated below app dialogs.
