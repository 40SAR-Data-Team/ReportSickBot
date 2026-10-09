const RANKS =['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA'];
const TYPES = { sick: 'Request Permission to Report Sick', mc: 'Send MC / Status from the Doctor / MO' };
const ACK = "I will wait for my commander's permission before reporting sick";

const btn = (text, data) => ({ text, callback_data: data });

// step -> [question, inline keyboard?]
const QUESTIONS = {
  rank: ['Select your rank (most of you are PTEs):',
    [0, 3, 6].map((i) => RANKS.slice(i, i + 3).map((r) => btn(r, `rank:${r}`)))],
  name: ['Enter your name:'],
  type: ['What would you like to do?', [[btn(TYPES.sick, 'type:sick')], [btn(TYPES.mc, 'type:mc')]]],
  condition: ['Medical condition:'],
  clinic: ['Clinic:'],
  time: ['Time (DD/MM/YYYY HHMM, e.g. 10/10/2026 0830):'],
  ack: [`${ACK}.`, [[btn('✅ I acknowledge', 'ack:yes')]]],
  reason: ['Reason for MC / Description of new Status:'],
  start: ['Start Date of MC/Status (DD/MM/YYYY):'],
  end: ['End Date of MC/Status (DD/MM/YYYY):'],
  file: ['Attach your MC / Status / Memo here (one photo or PDF):'],
};
const NEXT = { rank: 'name', name: 'type', condition: 'clinic', clinic: 'time', time: 'ack', reason: 'start', start: 'end', end: 'file' };
const BUTTON_STEPS = new Set(['rank', 'type', 'ack']);

/** Parses "DD/MM/YYYY" (or "DD/MM/YYYY HHMM" if withTime); returns a Date or null if invalid. */
export function parseDateTime(text, withTime) {
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{2}):?(\d{2}))?$/);
  if (!m || withTime !== (m[4] !== undefined)) return null;
  const [d, mo, y, h = 0, mi = 0] = m.slice(1).map((v) => (v === undefined ? undefined : +v));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const valid = date.getUTCDate() === d && date.getUTCMonth() === mo - 1 && h < 24 && mi < 60;
  return valid ? date : null;
}

async function tg(method, body) {
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

async function redis(...cmd) {
  const r = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(`redis: ${j.error}`);
  return j.result;
}

function ask(chat, step, prefix) {
  const [q, keyboard] = QUESTIONS[step];
  return tg('sendMessage', {
    chat_id: chat,
    text: prefix ? `${prefix}\n\n${q}` : q,
    reply_markup: keyboard && { inline_keyboard: keyboard },
  });
}

// ADMINS env var: JSON {"name": telegramId}. Unset means no admins, so the submit fails loudly.
const admins = () => Object.entries(JSON.parse(process.env.ADMINS ?? '{}'));

/** Sends the summary (and MC file) to every admin; returns how many admins received it. */
async function submit(chat, s, from) {
  const lines = s.type === 'sick'
    ? ['🤒 REQUEST TO REPORT SICK', `${s.rank} ${s.name}`, `Medical Condition: ${s.condition}`,
      `Clinic: ${s.clinic}`, `Time: ${s.time}`, `✅ ${ACK}`]
    : ['📄 MC / STATUS', `${s.rank} ${s.name}`, `Reason / Status: ${s.reason}`, `From ${s.start} to ${s.end}`];
  lines.push(`Sent by: ${from.username ? `@${from.username}` : `user id ${from.id}`}`);
  const text = lines.join('\n');
  const id = crypto.randomUUID();
  const button = s.type === 'sick' ? btn('✅ Approve', `approve:${id}`) : btn('Added to BatSys?', `batsys:${id}`);
  const list = admins();
  const results = await Promise.allSettled(list.map(async ([, admin]) => {
    const sent = await tg('sendMessage', { chat_id: admin, text, reply_markup: { inline_keyboard: [[button]] } });
    if (s.type === 'mc') {
      await tg('copyMessage', { chat_id: admin, from_chat_id: chat, message_id: s.file, reply_parameters: { message_id: sent.message_id } });
    }
    return [admin, sent.message_id];
  }));
  // An admin who never pressed Start on the bot can't be messaged; log it so they can be told.
  results.forEach((r, i) => r.status === 'rejected' && console.error(`admin ${list[i].join(' ')}:`, r.reason));
  const msgs = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  // ponytail: buttons go dead after 30 days, raise EX if admins act later
  if (msgs.length) await redis('SET', `sub:${id}`, JSON.stringify({ user: chat, type: s.type, text, msgs }), 'EX', 2592000);
  return msgs.length;
}

/** Admin tapped Approve / Added to BatSys: mark every admin's copy done, tell the soldier if approved. */
async function act(cb) {
  const name = admins().find(([, id]) => id === cb.from.id)?.[0];
  if (!name) return;
  // GETDEL is atomic: a second tap, or two admins tapping at once, gets null.
  const sub = JSON.parse((await redis('GETDEL', `sub:${cb.data.split(':')[1]}`)) ?? 'null');
  if (!sub) return;
  const text = `${sub.text}\n\n${sub.type === 'sick' ? `✅ ${name} has approved` : `✅ Added to BatSys by ${name}`}`;
  const results = await Promise.allSettled([
    ...sub.msgs.map(([chat_id, message_id]) => tg('editMessageText', { chat_id, message_id, text })),
    ...(sub.type === 'sick' ? [tg('sendMessage', { chat_id: sub.user, text })] : []),
  ]);
  results.forEach((r) => r.status === 'rejected' && console.error('act:', r.reason));
}

async function handle(update) {
  const cb = update.callback_query;
  const msg = update.message ?? cb?.message;
  if (msg?.chat.type !== 'private') return;
  const chat = msg.chat.id;
  const key = `form:${chat}`;
  const text = update.message?.text?.trim();
  if (cb) await tg('answerCallbackQuery', { callback_query_id: cb.id });
  if (/^(approve|batsys):/.test(cb?.data)) return act(cb);

  if (text === '/start' || text === '/cancel') {
    await redis('DEL', key);
    if (text === '/cancel') return tg('sendMessage', { chat_id: chat, text: 'Cancelled. Send /start to begin again.' });
  }

  const s = JSON.parse((await redis('GET', key)) ?? 'null');
  if (!s) {
    await redis('SET', key, JSON.stringify({ step: 'rank' }), 'EX', 3600);
    return ask(chat, 'rank');
  }

  let value;
  if (BUTTON_STEPS.has(s.step)) {
    const [step, v] = cb?.data?.split(':') ?? [];
    if (step !== s.step) return cb ? undefined : ask(chat, s.step, 'Please tap one of the buttons.'); // stale tap: ignore
    value = v;
    const label = step === 'type' ? TYPES[v] : step === 'ack' ? 'Acknowledged' : v;
    await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: `${cb.message.text}\n\n✔ ${label}` });
  } else if (cb) {
    return; // stale tap on an old keyboard
  } else if (s.step === 'file') {
    const m = update.message;
    const ok = m.photo || /^(application\/pdf|image\/)/.test(m.document?.mime_type ?? '');
    if (!ok) return ask(chat, 'file', 'Please send a photo or a PDF.');
    value = m.message_id;
  } else {
    if (!text) return ask(chat, s.step, 'Please type your answer.');
    // keeps the admin summary under Telegram's 4096-char message limit
    if (text.length > 500) return ask(chat, s.step, 'Too long, please keep it under 500 characters.');
    if (s.step === 'time' && !parseDateTime(text, true)) return ask(chat, 'time', 'Invalid date/time.');
    if ((s.step === 'start' || s.step === 'end') && !parseDateTime(text, false)) return ask(chat, s.step, 'Invalid date.');
    if (s.step === 'end' && parseDateTime(text, false) < parseDateTime(s.start, false)) {
      return ask(chat, 'end', 'End date cannot be before the start date.');
    }
    value = text;
  }

  s[s.step] = value;
  const next = s.step === 'type' ? (value === 'sick' ? 'condition' : 'reason') : NEXT[s.step];
  if (next) {
    s.step = next;
    await redis('SET', key, JSON.stringify(s), 'EX', 3600);
    return ask(chat, next);
  }

  // Last step done. State is not advanced, so on failure the user can just retry the last step.
  if (!(await submit(chat, s, update.message?.from ?? cb.from))) {
    return tg('sendMessage', { chat_id: chat, text: 'Failed to send to your commanders. Please try again.' });
  }
  await redis('DEL', key);
  return tg('sendMessage', { chat_id: chat, text: 'Submitted ✅ Send /start to submit another.' });
}

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
