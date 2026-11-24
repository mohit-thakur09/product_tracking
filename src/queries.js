module.exports = {
  getOrderById: 'SELECT * FROM orders WHERE id = $1',

  getOrderByIdForUpdate: 'SELECT * FROM orders WHERE id = $1 FOR UPDATE',

  getOrderLines: `
    SELECT order_line.id, product.sku, product.barcode, product.title, product.shelf,
           order_line.picked_at, order_line.picked_by
    FROM order_line
    JOIN product ON product.id = order_line.product_id
    WHERE order_line.order_id = $1
    ORDER BY order_line.id`,

  claimOrder: `
    UPDATE orders SET locked_by = $2, locked_until = $3
    WHERE id = $1
      AND payment_status = 'PAID'
      AND status = 'OPEN'
      AND (locked_by IS NULL OR locked_until < now() OR locked_by = $2)
    RETURNING *`,

  releaseOrder: `
    UPDATE orders SET locked_by = NULL, locked_until = NULL
    WHERE id = $1 AND locked_by = $2 AND locked_until > now()
    RETURNING *`,

  findProductByCode: 'SELECT * FROM product WHERE lower(sku) = $1 OR lower(barcode) = $1',

  findLineByProductId: 'SELECT * FROM order_line WHERE product_id = $1',

  markLinePicked: 'UPDATE order_line SET picked_at = now(), picked_by = $2 WHERE id = $1',

  countLinesLeft: 'SELECT count(*) AS total FROM order_line WHERE order_id = $1 AND picked_at IS NULL',

  markOrderPicked: `
    UPDATE orders
    SET status = 'PICKED', locked_by = NULL, locked_until = NULL, report_status = 'PENDING'
    WHERE id = $1`,

  extendLock: 'UPDATE orders SET locked_until = $2 WHERE id = $1',
};
