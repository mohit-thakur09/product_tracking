#!/usr/bin/env node
// Mock marketplace for the warehouse picking task.
// Node 18+, no dependencies:  node mock-marketplace.js
//
// The endpoint your worker calls:
//
//   POST /orders/:externalId/picked
//   body: { "pickedAt": "<ISO time>", "lines": ["<sku>", ...] }
//
//   200  accepted
//   409  the marketplace already has a report for this order
//   400  the marketplace will never accept this report
//   503  temporary failure, try again later
//
// Like the real marketplace, it is unreliable: some requests fail with 503,
// and some take a long time to answer even though they succeed.
//
// Settings (environment variables, all optional):
//   PORT        port to listen on                       default 4000
//   FAIL_RATE   share of requests answered 503          default 0.2
//   SLOW_RATE   share of accepted reports answered late default 0.1
//   SLOW_MS     how late a slow answer is               default 8000
//   BROKEN_IDS  comma-separated external ids it refuses with 400
//                                                       default MKT-BROKEN
//   SEED        integer; makes the random failures repeatable
//
// Test helpers (used by the people testing your submission; you may use them too):
//   GET  /_reports  what was received, per external id
//   POST /_reset    forget everything received
//   POST /_config   change settings at runtime, e.g.
//                   { "failRate": 0, "slowRate": 0, "slowMs": 8000, "brokenIds": [] }

'use strict';

const http = require('node:http');

const config = {
  port: Number(process.env.PORT || 4000),
  failRate: Number(process.env.FAIL_RATE ?? 0.2),
  slowRate: Number(process.env.SLOW_RATE ?? 0.1),
  slowMs: Number(process.env.SLOW_MS ?? 8000),
  brokenIds: (process.env.BROKEN_IDS ?? 'MKT-BROKEN').split(',').map((s) => s.trim()).filter(Boolean),
};

function makeRandom(seed) {
  if (seed === undefined || seed === '') return Math.random;
  let a = Number(seed) >>> 0;
  return function mulberry32() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(process.env.SEED);

// externalId -> { requests, accepted, duplicates, refused, unavailable, firstAcceptedAt, report }
let reports = {};

function entry(externalId) {
  if (!reports[externalId]) {
    reports[externalId] = {
      requests: 0, accepted: 0, duplicates: 0, refused: 0, unavailable: 0,
      firstAcceptedAt: null, report: null,
    };
  }
  return reports[externalId];
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({ ok: true, value: {} });
      try { resolve({ ok: true, value: JSON.parse(raw) }); } catch { resolve({ ok: false }); }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

async function handlePicked(req, res, externalId) {
  const e = entry(externalId);
  e.requests += 1;
  const body = await readJson(req);
  const valid = body.ok
    && typeof body.value.pickedAt === 'string'
    && !Number.isNaN(Date.parse(body.value.pickedAt))
    && Array.isArray(body.value.lines)
    && body.value.lines.length > 0
    && body.value.lines.every((s) => typeof s === 'string');

  if (!valid) {
    e.refused += 1;
    log('400', externalId, 'invalid body');
    return send(res, 400, { error: 'invalid body: expected { pickedAt: ISO string, lines: [sku, ...] }' });
  }
  if (config.brokenIds.includes(externalId)) {
    e.refused += 1;
    log('400', externalId, 'unknown order');
    return send(res, 400, { error: 'unknown order' });
  }
  if (random() < config.failRate) {
    e.unavailable += 1;
    log('503', externalId);
    return send(res, 503, { error: 'service unavailable, try again later' });
  }
  if (e.accepted > 0) {
    e.duplicates += 1;
    log('409', externalId, 'already reported');
    return send(res, 409, { error: 'already reported', firstAcceptedAt: e.firstAcceptedAt });
  }

  // Recorded before answering: a slow answer is still a success on our side.
  e.accepted = 1;
  e.firstAcceptedAt = new Date().toISOString();
  e.report = body.value;
  if (random() < config.slowRate) {
    log('200', externalId, `accepted, answering after ${config.slowMs} ms`);
    await sleep(config.slowMs);
  } else {
    log('200', externalId, 'accepted');
  }
  if (!res.destroyed) send(res, 200, { status: 'accepted' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const picked = url.pathname.match(/^\/orders\/([^/]+)\/picked$/);
  try {
    if (req.method === 'POST' && picked) return await handlePicked(req, res, decodeURIComponent(picked[1]));
    if (req.method === 'GET' && url.pathname === '/_reports') return send(res, 200, { config, reports });
    if (req.method === 'POST' && url.pathname === '/_reset') {
      reports = {};
      log('reset');
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/_config') {
      const body = await readJson(req);
      if (!body.ok) return send(res, 400, { error: 'invalid JSON' });
      const v = body.value;
      if (v.failRate !== undefined) config.failRate = Number(v.failRate);
      if (v.slowRate !== undefined) config.slowRate = Number(v.slowRate);
      if (v.slowMs !== undefined) config.slowMs = Number(v.slowMs);
      if (Array.isArray(v.brokenIds)) config.brokenIds = v.brokenIds.map(String);
      log('config', JSON.stringify(config));
      return send(res, 200, { config });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    log('500', err);
    if (!res.headersSent) send(res, 500, { error: 'mock crashed' });
  }
});

server.listen(config.port, () => {
  log(`mock marketplace on http://localhost:${config.port}`, JSON.stringify(config));
});
