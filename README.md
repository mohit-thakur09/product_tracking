# Warehouse picking service (3 hours)

## The situation

A warehouse sells items on an online marketplace. Every item is a single physical product with its own SKU, sitting on a shelf. When a buyer pays, an order arrives with one line per item. A picker walks the shelves with a handheld scanner, claims an order, and scans each item as they take it off the shelf.

Two things go wrong in real warehouses, and your service has to prevent both:

1. **Two pickers work the same order** and both walk to the same shelf.
2. **The wrong item goes to the wrong customer**: the picker takes the item for a different order, or something that is not on any order.

When an order is fully picked, the marketplace must be told, **exactly once**. The marketplace API is not reliable.

## What we give you

- **`schema.sql`**: the starting tables.
- **`seed.sql`**: products, orders and order lines to load into them. The same rows also come as CSV files (`products.csv`, `orders.csv`, `order_lines.csv`) if you'd rather load them another way.
- **`mock-marketplace.js`**: a single-file mock of the marketplace API (details below). It has no dependencies. Run it with `node mock-marketplace.js`, and it listens on `http://localhost:4000`.

## What you set up yourself

You run your own **Postgres** and **Redis**, and you package everything with **your own Docker setup**:

- A `docker-compose.yml` that starts Postgres, Redis, your API and your worker, and loads the schema and seed data on first start. Name the API service `api` and the worker service `worker`: we stop and restart the worker by name while testing.
- `docker compose up` must be the only command we need to run your submission. We will run the mock marketplace ourselves, outside your compose file.
- Read these settings from environment variables, with the defaults shown, because we change them when we test:

| Variable | Default | Why we change it |
|---|---|---|
| `MARKETPLACE_URL` | `http://host.docker.internal:4000` | To point your worker at our copy of the mock |
| `PICK_LOCK_TTL_SECONDS` | `900` | To test lock expiry without waiting 15 minutes |
| `PORT` | `3000` | Your API's port on the host |

On Linux, `host.docker.internal` needs `extra_hosts: ["host.docker.internal:host-gateway"]` on the worker service.

You may use any language and framework, and any Postgres and Redis versions. Use a Redis-backed job queue for the background work (BullMQ, Sidekiq, Celery, RQ, Asynq, or similar).

### Data

- `product(id, sku, barcode, title, shelf)`
- `orders(id, external_id, payment_status [PAID|UNPAID], status)`
- `order_line(id, order_id, product_id, picked_at, picked_by)`

Each order line is exactly one physical item. You may add columns, tables and indexes, but keep the tables and columns we give you, and keep the seed rows loading as they are. Include your changes as migrations, or as SQL that runs on first start.

## What to build

### 1. HTTP API

The caller identifies themselves with an `X-User-Id` header. You don't need to build authentication.

| Method and path | Behaviour |
|---|---|
| `POST /orders/:id/claim` | Gives the caller a pick lock on the order for `PICK_LOCK_TTL_SECONDS` (**15 minutes** by default). Claiming again when you already hold the lock renews it. |
| `POST /orders/:id/release` | Releases the caller's lock. |
| `POST /orders/:id/scan` `{ "code": "..." }` | The picker scanned something while working this order. |
| `GET /orders/:id` | The order, its lines, its lock, and its marketplace report status. |
| `POST /orders/:id/report/retry` | Asks for the marketplace report to be sent again after it gave up (see section 2). |

**Claim rules**
- An unpaid order cannot be claimed.
- A fully picked order cannot be claimed.
- If someone else holds an unexpired lock, refuse and say **who** holds it and **until when**.
- An expired lock can be taken over by anyone.

**Scan rules**

A scanned code matches a product by SKU or by barcode, ignoring case and surrounding whitespace.

Scanning a product is **not an error**, even when it's the wrong one. The scanner screen has to show the picker what happened, so return `200` with one of these results:

| Result | When |
|---|---|
| `PICKED` | The product is an unpicked line of this order. Mark it picked. |
| `ALREADY_PICKED` | The product is a line of this order that is already picked. Change nothing. |
| `WRONG_ITEM` | The product exists but is not on this order. If it is on **another open order**, name that order: the picker is holding someone else's item. |
| `NOT_FOUND` | No product matches the code. |

Return an error, not a result, when the caller doesn't hold an unexpired lock on the order, or the order doesn't exist. Every scan made while holding the lock renews the lock.

**Completing an order**

When the last line is picked:
- The order becomes `PICKED`.
- The lock is released.
- The marketplace must be told (section 2).

**Response shapes we test against**

We test submissions with a script, so these parts of each response must match exactly. Add any other fields you like.

- **Claim:** `200` on success. `409` when someone else holds the lock, with `heldBy` and `lockedUntil` in the body. Any `4xx` for the other refusals.
- **Scan:** `200` with `{ "result": "PICKED" | "ALREADY_PICKED" | "WRONG_ITEM" | "NOT_FOUND" }`. A `WRONG_ITEM` for a product on another open order also carries `"otherOrderId": <that order's id>`. Any `4xx` when the caller doesn't hold the lock.
- **`GET /orders/:id`:** includes `"status": "OPEN" | "PICKED"` and `"report": { "status": "NONE" | "PENDING" | "REPORTED" | "FAILED", "error": <string or null> }`.
  - `NONE`: the order isn't picked yet.
  - `PENDING`: it's picked and the report hasn't been accepted yet.
  - `REPORTED`: the marketplace has the report.
  - `FAILED`: the job gave up, and `error` says why.

### 2. Background job: report the pick to the marketplace

Send a report to the marketplace when an order is fully picked. It must not happen inside the HTTP request: the picker's scanner must answer quickly even when the marketplace is down.

```
POST ${MARKETPLACE_URL}/orders/:externalId/picked
{ "pickedAt": "...", "lines": ["<sku>", ...] }
```

The mock marketplace behaves like the real one (its settings are described at the top of `mock-marketplace.js`):

- It is sometimes slow and sometimes fails (`5xx`).
- `409` means it already has a report for that order.
- `400` means it will never accept this report.
- `200` means it accepted the report.

Requirements:

- **The marketplace must end up with exactly one accepted report per picked order**, however many times the job runs, whatever crashes or retries happen.
- Retry failures that are worth retrying, a bounded number of times, with backoff.
- When the job gives up, record why on the order, so `GET /orders/:id` can show it.
- `POST /orders/:id/report/retry` must actually send the report again after the job has given up.

## Deliverables (in priority order)

1. A Git repository (or zip) containing working code and your `docker-compose.yml`. Running `docker compose up` from the root must start everything with the seed data loaded. Before you submit, test this from a fresh clone with no volumes left over.
2. Tests for the parts you think matter most.
3. A short `NOTES.md` covering:
   - how to run your tests;
   - the decisions you made and why;
   - what you know is wrong or unfinished;
   - what you'd do next with another day.

We value a smaller thing that is correct and honest about its limits over a bigger thing that mostly works. If you run short of time, prioritise the lock and scan rules, then the job's exactly-once guarantee. Write down what you skipped.

You may use any tools, AI assistants included. Be ready to explain every line in a follow-up call.
