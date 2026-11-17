import { handle } from '../src/flow.js';

// re-exported for tests
export { today, parseDateTime } from '../src/dates.js';
export { invalid } from '../src/validate.js';

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).end();
  try {
    await handle(req.body);
  } catch (e) {
    console.error(e); // always 200, or Telegram retries the update forever
  }
  res.status(200).end();
}
