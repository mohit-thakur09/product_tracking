ALTER TABLE orders ADD COLUMN locked_by text;
ALTER TABLE orders ADD COLUMN locked_until timestamptz;
ALTER TABLE orders ADD COLUMN report_status text NOT NULL DEFAULT 'NONE';
ALTER TABLE orders ADD COLUMN report_error text;
