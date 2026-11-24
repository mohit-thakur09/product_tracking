const express = require('express');
const config = require('./config');
const orderService = require('./orderService');

const { ApiError } = orderService;

const app = express();
app.use(express.json());

function getOrderId(req) {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new ApiError(400, 'invalid order id');
  return orderId;
}

function getUserId(req) {
  const userId = (req.get('X-User-Id') || '').trim();
  if (!userId) throw new ApiError(400, 'X-User-Id header is required');
  return userId;
}

app.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await orderService.getOrder(getOrderId(req));
    res.json(order);
  } catch (err) {
    next(err);
  }
});

app.post('/orders/:id/claim', async (req, res, next) => {
  try {
    const result = await orderService.claimOrder(getOrderId(req), getUserId(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/orders/:id/release', async (req, res, next) => {
  try {
    const result = await orderService.releaseOrder(getOrderId(req), getUserId(req));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post('/orders/:id/scan', async (req, res, next) => {
  try {
    const orderId = getOrderId(req);
    const userId = getUserId(req);
    const code = req.body ? req.body.code : undefined;
    if (typeof code !== 'string') throw new ApiError(400, 'code is required');

    const result = await orderService.scanItem(orderId, userId, code);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, ...err.data });
  }
  console.error(err);
  res.status(500).json({ error: 'something went wrong' });
});


app.listen(config.port, () => {
  console.log(`api running on port ${config.port}`);
});

