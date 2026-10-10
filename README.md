# evolvetennis-inventory

Inventory management for MSV Southeast Asia (Evolve Tennis).

- `index.html` — the website home page. Built from `design/msv-inventory.html`; after changing that file, run `./scripts/build-site.sh` to update it.
- `design/msv-inventory.html` — the app (single self-contained file)
  - **Phase 2 (live):** products, variants and SKUs, stock levels, inventory value, reorder levels, manual stock adjustments, stock movement history, product categories
  - **Phase 3 (live):** suppliers, purchases with multiple items and additional costs, Draft → Ordered → Received statuses, automatic stock-in on receipt (once only), purchase reversal, purchase history on supplier and variant pages
  - **Phase 4 (live):** customers, sales with multiple items, line and order discounts, shipping/other charges, Draft → Confirmed → Completed statuses, payment status, automatic stock-out on completion (once only), cost snapshots and gross profit, sale reversal, customer and SKU sales history, live dashboard and reports
  - **Phase 5 (live):** unified stock movement ledger with permanent movement IDs, movement detail pages, read-only history (corrections are new movements), customer returns (partial, condition-based restocking, reversal), supplier returns, improved stock adjustments (increase / decrease / set exact with required reason and notes), stock count reconciliation, audit trail, ledger integrity check, CSV export, inventory movements report and net sales after returns
  - **Phase 6 (live):** dashboard and reports driven by real data, with a shared reporting period (today to last year, or a custom range) remembered for the session and comparisons with the previous equivalent period. Reports cover overview and business snapshot, sales (gross, returns, net), gross profit and margin, product performance and best sellers, inventory value, low stock, slow-moving and never-sold stock, customers, markets (countries) with drill-down, purchases and suppliers, returns, and an opening-to-closing stock movement report. Every report table sorts and exports to CSV with the current filters
  - Report rules: completed sales and completed returns only, received purchases only (at the exchange rate stored when received), cost of goods from each sale's stored cost snapshot, inventory at current stock × current cost price. Gross profit is product revenue (net sales without shipping and other charges) minus cost of goods sold
  - Money in other currencies is converted to SGD with exchange rates you enter in Settings (not live rates); each completed sale keeps its own rate
- `tests/phase2.spec.js` to `tests/phase6.spec.js` — browser tests for each phase's checklist (`node tests/phase6.spec.js`, needs Playwright)
- `tests/phase2.spec.js`, `tests/phase3.spec.js`, `tests/phase4.spec.js`tests/phase2.spec.js`, `tests/phase3.spec.js`, `tests/phase4.spec.js`, `tests/phase5.spec.js` — browser tests for each phase's checklist (`node tests/phase5.spec.js`, needs Playwright)
- `design/DESIGN_GUIDE.md` — rules for every HTML design in this project
- `design/reference/` — the approved reference prototype and the design system it uses
