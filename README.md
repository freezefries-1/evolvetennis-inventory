# evolvetennis-inventory

Inventory management for MSV Southeast Asia (Evolve Tennis).

- `index.html` — the website home page. Built from `design/msv-inventory.html`; after changing that file, run `./scripts/build-site.sh` to update it.
- `design/msv-inventory.html` — the app (single self-contained file)
  - **Phase 2 (live):** products, variants and SKUs, stock levels, inventory value, reorder levels, manual stock adjustments, stock movement history, product categories
  - **Phase 3 (live):** suppliers, purchases with multiple items and additional costs, Draft → Ordered → Received statuses, automatic stock-in on receipt (once only), purchase reversal, purchase history on supplier and variant pages
  - **Phase 4 (live):** customers, sales with multiple items, line and order discounts, shipping/other charges, Draft → Confirmed → Completed statuses, payment status, automatic stock-out on completion (once only), cost snapshots and gross profit, sale reversal, customer and SKU sales history, live dashboard and reports
  - Money in other currencies is converted to SGD with exchange rates you enter in Settings (not live rates); each completed sale keeps its own rate
  - Data is saved in the browser (`localStorage`, key `msv-inventory-v2`) through a small `Store` layer that a server can replace later
- `tests/phase2.spec.js`, `tests/phase3.spec.js`, `tests/phase4.spec.js` — browser tests for each phase's checklist (`node tests/phase4.spec.js`, needs Playwright)
- `design/DESIGN_GUIDE.md` — rules for every HTML design in this project
- `design/reference/` — the approved reference prototype and the design system it uses
