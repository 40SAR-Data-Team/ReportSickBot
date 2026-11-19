/** Prefix on everything the bot sends to admins. */
export const FOR_ADMIN = '[For Admin]';
/** Admins as [name, telegramId] from the ADMINS env var (JSON {"name": id}). Unset means none, so submit fails loudly. */
export const admins = () => Object.entries(JSON.parse(process.env.ADMINS ?? '{}'));
/** Name of the admin with Telegram id `id`, or undefined if not an admin. */
export const adminName = (id) => admins().find(([, a]) => a === id)?.[0];

/**
 * Calls a Telegram Bot API method.
 *
 * @param {string} method API method, e.g. "sendMessage".
 * @param {object} body JSON parameters.
 * @return {Promise<*>} The `result` field.
 * @throws {Error} If Telegram answers ok: false.
 */
export async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
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
