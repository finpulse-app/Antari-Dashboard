# Daily briefing, phone shortcuts and map context

October 17, 2026

The owner overview now ranks up to three actionable priorities from loaded data. Questionable pre-snapshot payments come before collection prompts. Customer identity decisions, stale balance reports, provisional aliases and incomplete monthly history produce specific next steps. An empty task list does not invent urgency. Report dates remain visible beside source totals.

Phone layouts replace the repeated five-card grid with compact sales/balance buttons. A fixed shortcut bar provides Home, Customers, Payment, Visit note and More. Search opens on demand, and input sizing avoids automatic iPhone zoom. Existing customer details also provide visit notes.

Visit notes are shared by both authorized owners and append-only. The database stamps the author and time, limits note length and requires a real customer. Unrelated accounts cannot read or add notes. Online saves are required; failed saves retain the form text for retry. No offline financial queue was added.

The ZIP map states the amount and percentage of wholesale sales represented by mapped listed customers. Other buyers, listed customers outside the boundary set and Square sales are identified separately. Borough labels appear when zoomed out; collision-aware neighborhood labels appear when zoomed in. Nearby neighborhood names are geographic context rather than exact ZIP equivalence.

Neighborhood names and representative points derive from [NYC DCP's 2020 Neighborhood Tabulation Areas](https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-/9nt8-h7nd), retrieved October 17, 2026. The bundled `neighborhoods.js` contains public geography only. No customer details are sent to a map provider.

Validation: 20 automated checks passed, including briefing priorities, map coverage arithmetic, failed-note preservation, mobile search semantics, existing authentication/analytics/import checks, and PDF extraction. Database rollback tests confirmed owner attribution, append-only privileges and isolation from unrelated accounts. Browser checks used live data for the phone briefing, note dialog and ZIP map. No fabricated visit notes were retained in production.

The owner confirmed Square and Zoho sales are separate sources. Historical imports created before this audit still require reconciliation against original reports; this release does not claim every PDF variant is certified.
