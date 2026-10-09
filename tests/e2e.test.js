// Real HTTP all the way: webhook served by node:http (Vercel-style req/res),
// Telegram + Upstash replaced by a dummy HTTP server.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import handler from '../api/webhook.js';
import { ENV, MC_FLOW, SICK_FLOW, doc, fakeBackend } from './fake.js';

let b, upstream, app, webhookUrl;

beforeAll(async () => {
  b = fakeBackend();
  upstream = Bun.serve({ port: 0, fetch: async (req) => Response.json(b.respond(req.url, await req.json())) });
  Object.assign(process.env, ENV, {
    TELEGRAM_API: `http://localhost:${upstream.port}`,
    KV_REST_API_URL: `http://localhost:${upstream.port}/redis`,
  });

  // Minimal Vercel shim: JSON body on req.body, res.status().
  app = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    req.body = JSON.parse(raw);
    res.status = (c) => ((res.statusCode = c), res);
    await handler(req, res);
  });
  await new Promise((r) => app.listen(0, r));
  webhookUrl = `http://localhost:${app.address().port}/api/webhook`;
});

afterAll(() => {
  upstream.stop(true);
  app.close();
  delete process.env.TELEGRAM_API;
});

const post = (update, secret = ENV.WEBHOOK_SECRET) => fetch(webhookUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
  body: JSON.stringify(update),
});

test('rejects requests without the secret', async () => {
  expect((await post(SICK_FLOW[0], 'nope')).status).toBe(401);
});

test('sick request reaches the group over HTTP', async () => {
  for (const u of SICK_FLOW) expect((await post(u)).status).toBe(200);
  expect(b.toGroup().at(-1).text).toContain('REQUEST TO REPORT SICK');
  expect(b.toUser().at(-1)).toContain('Submitted');
});

test('MC with PDF reaches the group over HTTP', async () => {
  for (const u of [...MC_FLOW, doc('application/pdf')]) expect((await post(u)).status).toBe(200);
  const [summary, file] = b.toGroup().slice(-2);
  expect(summary.text).toContain('MC / STATUS');
  expect(file.method).toBe('copyMessage');
  expect(b.store.size).toBe(0);
});
