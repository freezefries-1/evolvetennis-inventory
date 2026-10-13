# Evolve Tennis System: data, backup and recovery

## Where the data lives today

The Evolve Tennis System is a single web page (`design/msv-inventory.html`, published as
`index.html` on GitHub Pages). It has **no server and no shared database yet**. All business
records are saved in the browser's `localStorage` on the device where they were entered:

| Key | Contents |
| --- | --- |
| `msv-inventory-v2` | Every business record: products, variants, stock movements, suppliers, purchases, customers, sales, returns, stock counts, expenses, other income, settings, users and roles, notifications and the activity log |
| `msv-inventory-v2:rev` | A revision number, increased on every save. Used to stop an out-of-date tab overwriting newer data |
| `ets-session` (sessionStorage) | The signed-in user for that browser tab. Cleared when the tab closes or the user signs out |
| `msv-period` (sessionStorage) | The reporting period chosen on the Dashboard and Reports |

What this means in practice:

- Data is **not shared between devices or browsers**. Two people need to use the same browser
  profile on the same computer to see the same data.
- Clearing the browser's site data, using a private window, or losing the device **loses the data**.
- Browsers allow roughly 5 MB per site. Settings → System Health shows how much is used.

## Backing up now

1. Sign in as an admin and open **Settings → Import & Export**.
2. Select **Export System Data**. This downloads one JSON file with all business data, settings,
   roles, the activity log and the user list (names, emails, roles, statuses). **Passwords and
   recovery codes are never included.**
3. Keep the file somewhere safe (for example a shared drive). Weekly is a sensible minimum; daily
   when trading is busy.

Individual CSV exports (inventory snapshot, sales, purchases, stock movements and more) are in the
**Export Centre** on the same page. They are useful for spreadsheets and accountants, but the JSON
file is the complete backup.

## Recovering

- **Restore from an export** (Settings → Import & Export → System data) replaces the business data
  in this browser with the file's contents. The users and roles already in this browser are kept,
  so nobody is locked out.
- The import is checked first: the file must come from Export System Data and contain products,
  variants, stock movements, sales and purchases.
- Older exports are upgraded automatically through the same migrations the app runs on load.

## Data integrity safeguards

- Stock only changes through stock movements. Each movement has a permanent ID
  (`MOV-YYYY-NNNNNN`), stores the previous and new quantity, and can never be edited. Settings →
  System Health checks every SKU's stored quantity against its ledger and flags differences
  without changing anything.
- Stock-changing actions (completing sales, receiving purchases, returns, reversals, adjustments,
  stock counts) check their status first, so the same action cannot post stock twice. Adjustments
  also carry a one-time token.
- Every save checks the revision number first. If another tab saved newer data, the save stops,
  the latest data is loaded, and the user is asked to redo the change. Stock checks then run
  against the latest figures, so two tabs cannot oversell the same units.
- Passwords are stored only as salted PBKDF2-SHA256 hashes (150,000 rounds).

## Limits of browser-only security

Permissions are checked on every page and every action, including addresses typed directly into
the browser. But because the whole app and its data run inside the browser, someone with access
to the device and the browser's developer tools could read or change the stored data. This is
acceptable for a single trusted device. It is **not** a substitute for server-side security.

## Next step: a hosted database (recommended before several people rely on it)

Moving to a hosted Postgres database such as **Supabase** removes the limits above:

- **Shared data** for every user and device.
- **Supabase Auth** for sign-in, password reset by email, and session expiry, replacing the
  in-browser accounts.
- **Row Level Security** policies so staff without the financials permission cannot read expenses,
  other income or cost and profit columns, enforced by the database.
- **Atomic stock changes**: a database function (`post_movement`) that locks the variant row
  (`SELECT … FOR UPDATE`), checks stock, inserts the movement and updates the quantity in one
  transaction. Unique constraints on references (`sale_no`, `purchase_no`, `movement_ref`) and an
  idempotency key on stock-changing requests prevent duplicates.
- **Backups**: daily backups on paid plans and point-in-time recovery, instead of manual exports.
  The JSON export remains useful as a portable copy.
- **Keys**: only the public `anon` key goes in the web page. The `service_role` key stays on the
  server and is never shipped to the browser.

The app is ready for this move. All reads and writes go through one `Store` object, every record
already has a permanent ID, and the JSON export maps directly to tables. Suggested tables and
indexes:

| Table | Key columns | Indexes |
| --- | --- | --- |
| `products` | `id`, `name`, `brand`, `category_id`, `status` | `name`, `status` |
| `variants` | `id`, `product_id`, `sku` (unique), `qty`, `cost`, `price`, `reorder` | `sku` unique, `product_id` |
| `stock_movements` | `id`, `ref` (unique), `variant_id`, `type`, `change`, `prev_qty`, `new_qty`, `date`, links | `ref` unique, `(variant_id, seq)`, `date`, `type` |
| `sales`, `sale_lines` | `no` (unique), `customer_id`, `status`, `completed_date` | `no` unique, `customer_id`, `status`, `completed_date` |
| `purchases`, `purchase_lines` | `no` (unique), `supplier_id`, `status`, `received_date` | `no` unique, `supplier_id`, `status` |
| `customers`, `suppliers` | `id`, `name` | `lower(name)` |
| `returns`, `supplier_returns` | `no` (unique), links to sale/purchase lines | `no` unique |
| `expenses`, `other_income` | `no` (unique), `date`, `type`, `category`, `status` | `no` unique, `date` |
| `audit_log` | `at`, `user_id`, `action`, `entity`, `ref` | `at`, `user_id` |
