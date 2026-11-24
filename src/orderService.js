const db = require('./db');
const config = require('./config');
const queries = require('./queries');

class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function getLockEndTime() {
  return new Date(Date.now() + config.lockTtlSecs * 1000);
}

function isLockActive(order) {
  return order.locked_by && order.locked_until && new Date(order.locked_until) > new Date();
}

async function getOrder(orderId) {
  const orderResult = await db.query(queries.getOrderById, [orderId]);
  const order = orderResult.rows[0];
  if (!order) throw new ApiError(404, 'order not found');

  const linesResult = await db.query(queries.getOrderLines, [orderId]);

  let lock = null;
  if (isLockActive(order)) {
    lock = { heldBy: order.locked_by, lockedUntil: order.locked_until };
  }

  return {
    id: order.id,
    externalId: order.external_id,
    paymentStatus: order.payment_status,
    status: order.status,
    lines: linesResult.rows.map((line) => ({
      id: line.id,
      sku: line.sku,
      barcode: line.barcode,
      title: line.title,
      shelf: line.shelf,
      pickedAt: line.picked_at,
      pickedBy: line.picked_by,
    })),
    lock: lock,
    report: {
      status: order.report_status,
      error: order.report_error,
    },
  };
}

async function claimOrder(orderId, userId) {
  const result = await db.query(queries.claimOrder, [orderId, userId, getLockEndTime()]);
  const claimed = result.rows[0];
  if (claimed) {
    return { orderId: orderId, heldBy: claimed.locked_by, lockedUntil: claimed.locked_until };
  }

  const orderResult = await db.query(queries.getOrderById, [orderId]);
  const order = orderResult.rows[0];
  if (!order) throw new ApiError(404, 'order not found');
  if (order.payment_status !== 'PAID') throw new ApiError(422, 'order is not paid');
  if (order.status !== 'OPEN') throw new ApiError(422, 'order is already picked');

  throw new ApiError(409, 'order is locked by another picker', {
    heldBy: order.locked_by,
    lockedUntil: order.locked_until,
  });
}

async function releaseOrder(orderId, userId) {
  const result = await db.query(queries.releaseOrder, [orderId, userId]);
  if (result.rows[0]) return { orderId: orderId, released: true };

  const orderResult = await db.query(queries.getOrderById, [orderId]);
  if (!orderResult.rows[0]) throw new ApiError(404, 'order not found');
  throw new ApiError(409, 'you do not hold the lock on this order');
}

async function scanItem(orderId, userId, code) {
  const scannedCode = code.trim().toLowerCase();
  if (!scannedCode) throw new ApiError(400, 'code is required');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(queries.getOrderByIdForUpdate, [orderId]);
    const order = orderResult.rows[0];
    if (!order) throw new ApiError(404, 'order not found');
    if (order.locked_by !== userId || !isLockActive(order)) {
      throw new ApiError(403, 'you do not hold the lock on this order');
    }

    let response;

    const productResult = await client.query(queries.findProductByCode, [scannedCode]);
    const product = productResult.rows[0];

    if (!product) {
      response = { result: 'NOT_FOUND' };
    } else {
      const lineResult = await client.query(queries.findLineByProductId, [product.id]);
      const line = lineResult.rows[0];

      if (line && line.order_id === order.id) {
        if (line.picked_at) {
          response = { result: 'ALREADY_PICKED' };
        } else {
          await client.query(queries.markLinePicked, [line.id, userId]);
          response = { result: 'PICKED' };
        }
      } else {
        response = { result: 'WRONG_ITEM' };
        if (line) {
          const otherOrderResult = await client.query(queries.getOrderById, [line.order_id]);
          if (otherOrderResult.rows[0].status === 'OPEN') {
            response.otherOrderId = line.order_id;
          }
        }
      }
    }

    const countResult = await client.query(queries.countLinesLeft, [order.id]);
    const linesLeft = Number(countResult.rows[0].total);

    if (response.result === 'PICKED' && linesLeft === 0) {
      await client.query(queries.markOrderPicked, [order.id]);
    } else {
      await client.query(queries.extendLock, [order.id, getLockEndTime()]);
    }

    await client.query('COMMIT');

    response.linesLeft = linesLeft;
    return response;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ApiError, getOrder, claimOrder, releaseOrder, scanItem };
