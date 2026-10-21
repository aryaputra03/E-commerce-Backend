ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','paid','shipped','completed','cancelled','failed'));

ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending','paid','failed','cancelled'));