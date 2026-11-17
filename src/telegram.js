import { FOR_ADMIN } from './consts.js';

/**
 * Calls a Telegram Bot API method.
 *
 * @param {string} method API method, e.g. "sendMessage".
 * @param {object} body JSON parameters.
 * @return {Promise<*>} The `result` field.
 * @throws {Error} If Telegram answers ok: false.
 */
export async function tg(method, body) {
  const api = process.env.TELEGRAM_API ?? 'https://api.telegram.org'; // overridden only by e2e tests
  const r = await fetch(`${api}/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
/** Edits a sent message's text; `extra` holds further editMessageText parameters. */
export const edit = (chat_id, message_id, text, extra) => tg('editMessageText', { chat_id, message_id, text, ...extra });
/** Sends an admin a message tagged with FOR_ADMIN. */
export const toAdmin = (chat, text, extra) => send(chat, `${FOR_ADMIN} ${text}`, extra);
/** Sends a text message; `extra` holds further sendMessage parameters. */
export const send = (chat_id, text, extra) => tg('sendMessage', { chat_id, text, ...extra });
