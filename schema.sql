-- Starting schema for the warehouse picking task.
-- You may add columns, tables and indexes. Keep these tables and columns.

CREATE TABLE product (
  id      integer PRIMARY KEY,
  sku     text NOT NULL UNIQUE,
  barcode text NOT NULL UNIQUE,
  title   text NOT NULL,
  shelf   text NOT NULL
);

CREATE TABLE orders (
  id             integer PRIMARY KEY,
  external_id    text NOT NULL UNIQUE,  -- the marketplace's id for the order
  payment_status text NOT NULL CHECK (payment_status IN ('PAID', 'UNPAID')),
  status         text NOT NULL DEFAULT 'OPEN',  -- OPEN, then PICKED when every line is picked
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One line is one physical item, so a product is on at most one line.
CREATE TABLE order_line (
  id         integer PRIMARY KEY,
  order_id   integer NOT NULL REFERENCES orders (id),
  product_id integer NOT NULL UNIQUE REFERENCES product (id),
  picked_at  timestamptz,
  picked_by  text
);

CREATE INDEX order_line_order_id_idx ON order_line (order_id);
