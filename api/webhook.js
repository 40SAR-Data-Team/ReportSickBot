import { createHash, timingSafeEqual } from 'node:crypto';
import { handle } from '../src/flow.js';

// Constant-time compare: `!==` stops at the first differing character, so response timing could in theory
// tell an attacker how much of a guessed secret was right. timingSafeEqual needs equal-length inputs, so both
// sides are hashed first, which also keeps the secret's length from leaking.
const digest = (s) => createHash('sha256').update(String(s ?? '')).digest();
const secretMatches = (got, want) => timingSafeEqual(digest(got), digest(want));

export default async function handler(req, res) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !secretMatches(req.headers['x-telegram-bot-api-secret-token'], secret)) return res.status(401).end();
  try {
    await handle(req.body);
  } catch (e) {
    console.error(e); // always 200, or Telegram retries the update forever
  }
  res.status(200).end();
}
