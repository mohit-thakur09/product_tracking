# Notes

### How to run

Run "docker compose up" from the project folder. This starts DB, The API runs on port 3000 by default.

### How it works

The API is written in Node.js with Express, and it talks to DB

When a picker calls claim, the API updates the order only if it is paid, still open, and not locked by someone else (or the lock has expired, or the picker already holds it). This is done in one update query, so two pickers cannot get the same order at the same time. If the update does not happen, the API checks why and returns 404 if the order does not exist, 422 if it is unpaid or already picked, and 409 with "heldBy" and "lockedUntil" if another picker holds the lock. Release removes the lock only if the caller holds it.

When a picker scans a code, the API first checks that the caller holds a lock on the order that has not expired. The code is trimmed and compared in lower case against the SKU and the barcode. If the product is on this order and not picked yet, the line is marked picked and the result is "PICKED". If it is already picked, the result is "ALREADY_PICKED". If the product belongs to a different order, the result is "WRONG_ITEM", and if that other order is still open its id is returned as "otherOrderId". If no product matches, the result is "NOT_FOUND". Every scan renews the lock. The scan runs inside a transaction that locks the order row, so two scans on the same order cannot mix up.

When the last line is picked, the order status becomes "PICKED", the lock is removed, and "report_statu" becomes "PENDING". "GET /orders/:id" returns the order with its lines, the lock (or null), and the report status.

### What is not done yet

The background job that sends the report to the marketplace is not done. The plan is to use Redis with BullMQ. When an order becomes "PICKED", a job is added to the queue. The worker sends the report, retries 5xx errors and timeouts with backoff, treats 409 as already reported, and marks the report as "FAILED" with the error on a 400 or after the last retry. Because of this, the Redis and worker services are not in "docker-compose.yml" yet.

There are no automated tests yet. I checked the endpoints by hand with the seed data. I will add tests for the claim and scan rules first when I have more time.

Right now the database code uses plain SQL. I plan to move it to an ORM (like Prisma or Sequelize) later, so the queries and the table changes are easier to manage.

### What I would do next

With another day I would first add the Redis and BullMQ worker for the marketplace report, with the retry endpoint. After that I would write tests for the lock, scan and report rules, and then move the database code to an ORM with proper migrations.
