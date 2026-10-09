const RANKS =['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA'];
const TYPES = {
  sick: 'Request Permission to Report Sick',
  appt: 'Request Permission to attend upcoming Medical Appointment',
  mc: 'Send MC / Status from the Doctor / MO',
};
const ACK = "I will wait for my commander's approval before I report sick";
const PLEDGE = "I will seek my commander's approval before heading for my Medical Appointment";

const FOR_ADMIN = '[For Admin]'; // prefix on everything the bot sends to admins
const btn = (text, data) => ({ text, callback_data: data });
/** Today's date in Singapore as DD/MM/YYYY. */
const today = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' });

// step -> [question, inline keyboard?]
const QUESTIONS = {
  rank: ['What is your Rank?',
    [0, 3, 6].map((i) => RANKS.slice(i, i + 3).map((r) => btn(r, `rank:${r}`)))],
  name: ['What is your Name?'],
  type: ['How may I help you?', Object.entries(TYPES).map(([k, t]) => [btn(t, `type:${k}`)])],
  condition: ['What symptoms are you experiencing?'],
  clinic: ['Which clinic will you visit?'],
  time: ['What time will you visit the doctor? (24h format, e.g. 0830)'],
  ack: [`${ACK}.`, [[btn('✅ I acknowledge', 'ack:yes')]]],
  purpose: ['Reason for Medical Appointment? (e.g Eczema, Spine Surgery)'],
  when: ['When is your Medical Appointment? (DD/MM/YYYY HHMM)'],
  venue: ['Which clinic is your Medical Appointment?'],
  shot: ['Attach a screenshot / image of your Medical Appointment.'],
  pledge: [`${PLEDGE}.`, [[btn('✅ I acknowledge', 'pledge:yes')]]],
  reason: ['What new status are you given / What is your reason for MC?'],
  start: ['Start Date of MC / Status? (DD/MM/YYYY)'],
  end: ['End Date of MC / Status? (DD/MM/YYYY)'],
  file: ['Attach your MC / Memo. (one photo or PDF)'],
};
// rank -> name -> type, then the chosen type's steps; after the last step, submit.
const FLOWS = {
  sick: ['condition', 'clinic', 'time', 'ack'],
  appt: ['purpose', 'when', 'venue', 'shot', 'pledge'],
  mc: ['reason', 'start', 'end', 'file'],
};
const BUTTON_STEPS = new Set(['rank', 'type', 'ack', 'pledge']);

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

/** Sends the summary (and attached file) to every admin; returns the submission, or null if no admin received it. */
async function submit(chat, s, from) {
  const who = `${s.rank} ${s.name}`;
  const lines = {
    sick: ['🤒 REQUEST TO REPORT SICK', who, `Medical Condition: ${s.condition}`, `Clinic: ${s.clinic}`, `Time: ${s.time}`, `✅ ${ACK}`],
    appt: ['🏥 REQUEST TO ATTEND MEDICAL APPOINTMENT', who, `Reason: ${s.purpose}`, `Time: ${s.when}`, `Clinic: ${s.venue}`, `✅ ${PLEDGE}`],
    mc: ['📄 MC / STATUS', who, `Reason / Status: ${s.reason}`, `From ${s.start} to ${s.end}`],
  }[s.type];
  lines.push(`Sent by: ${from.username ? `@${from.username}` : `user id ${from.id}`}`);
  const text = lines.join('\n');
  const id = crypto.randomUUID();
  const button = s.type === 'mc' ? btn('Added to BatSys?', `batsys:${id}`) : btn('✅ Approve', `approve:${id}`);
  const file = s.file ?? s.shot;
  const list = admins();
  const results = await Promise.allSettled(list.map(async ([, admin]) => {
    const sent = await tg('sendMessage', { chat_id: admin, text: `${FOR_ADMIN} ${text}`, reply_markup: { inline_keyboard: [[button]] } });
    if (file) {
      const caption = s.caption ? `${FOR_ADMIN} ${s.caption}` : FOR_ADMIN;
      await tg('copyMessage', { chat_id: admin, from_chat_id: chat, message_id: file, caption, reply_parameters: { message_id: sent.message_id } });
    }
    return [admin, sent.message_id];
  }));
  // An admin who never pressed Start on the bot can't be messaged; log it so they can be told.
  results.forEach((r, i) => r.status === 'rejected' && console.error(`admin ${list[i].join(' ')}:`, r.reason));
  const msgs = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const label = `${who}, ${{ sick: 'sick request', appt: `medical appointment ${s.when}`, mc: `MC ${s.start} to ${s.end}` }[s.type]}`;
  return msgs.length ? { id, user: chat, type: s.type, text, label, msgs } : null;
}

/** Records a submission (and who acted on it) in its day's /overview list. Label only, no medical details. */
async function log({ id, day, at, type, label }, by) {
  await redis('HSET', `day:${day}`, id, JSON.stringify({ at, type, label, by }));
  // outlives the 7-day sub, so a late tap still updates an existing day list
  await redis('EXPIRE', `day:${day}`, 691200);
}

const SECTIONS = [['sick', '🤒 Report sick', 'approved'], ['appt', '🏥 Medical appointment', 'approved'], ['mc', '📄 MC / Status', 'added to BatSys']];

/** Sends an admin today's submissions and whether each has been acted on. */
async function overview(chat) {
  const day = today();
  const rows = ((await redis('HGETALL', `day:${day}`)) ?? []).filter((_, i) => i % 2).map((v) => JSON.parse(v))
    .sort((a, b) => a.at.localeCompare(b.at));
  const parts = SECTIONS.map(([type, title, verb]) => {
    const lines = rows.filter((r) => r.type === type)
      .map((r) => `${r.at} ${r.label} – ${r.by ? `✅ ${verb} by ${r.by}` : `⏳ not yet ${verb}`}`);
    return `${title}\n${lines.join('\n') || 'None'}`;
  });
  return tg('sendMessage', { chat_id: chat, text: `${FOR_ADMIN} Overview for ${day}\n\n${parts.join('\n\n')}` });
}

/** Admin tapped Approve / Added to BatSys: shrink every admin's summary to one line, swap the soldier's summary for the outcome. */
async function act(cb) {
  const name = admins().find(([, id]) => id === cb.from.id)?.[0];
  if (!name) return;
  // GETDEL is atomic: a second tap, or two admins tapping at once, gets null.
  const sub = JSON.parse((await redis('GETDEL', `sub:${cb.data.split(':')[1]}`)) ?? 'null');
  if (!sub) return;
  // ponytail: `?? rank+name line` only for subs stored before labels existed; drop after 7 days
  const done = `${FOR_ADMIN} ✅ ${sub.label ?? sub.text.split('\n')[1]} ${sub.type === 'mc' ? 'added to BatSys' : 'approved'} by ${name}`;
  const outcome = sub.type === 'mc' ? `✅ Added to BatSys by ${name}` : `✅ ${name} has approved`;
  const results = await Promise.allSettled([
    ...sub.msgs.map(([chat_id, message_id]) => tg('editMessageText', { chat_id, message_id, text: done })),
    tg('sendMessage', { chat_id: sub.user, text: `${sub.text}\n\n${outcome}` }),
    // the outcome message replaces the soldier's summary (fails after 48h, then both stay)
    ...(sub.summary ? [tg('deleteMessage', { chat_id: sub.user, message_id: sub.summary })] : []),
    ...(sub.day ? [log(sub, name)] : []),
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
  if (text === '/overview' && admins().some(([, id]) => id === update.message.from.id)) return overview(chat);

  if (text === '/start' || text === '/cancel') {
    await redis('DEL', key);
    if (text === '/cancel') return tg('sendMessage', { chat_id: chat, text: 'Cancelled. Send /start to begin again.' });
  }

  let s = JSON.parse((await redis('GET', key)) ?? 'null');
  const fresh = !s;
  s ??= { step: 'rank' };
  // Every message in the form (both sides) is tracked, then deleted on submit.
  s.ids ??= [];
  if (update.message) s.ids.push(update.message.message_id);
  const save = () => redis('SET', key, JSON.stringify(s), 'EX', 3600);
  const reply = async (step, prefix) => { s.ids.push((await ask(chat, step, prefix)).message_id); return save(); };
  if (fresh) return reply('rank');

  let value;
  if (BUTTON_STEPS.has(s.step)) {
    const [step, v] = cb?.data?.split(':') ?? [];
    if (step !== s.step) return cb ? undefined : reply(s.step, 'Please tap one of the buttons.'); // stale tap: ignore
    value = v;
    const label = step === 'type' ? TYPES[v] : step === 'ack' || step === 'pledge' ? 'Acknowledged' : v;
    await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: `${cb.message.text}\n\n✔ ${label}` });
  } else if (cb) {
    return; // stale tap on an old keyboard
  } else if (s.step === 'file' || s.step === 'shot') {
    const m = update.message;
    const mime = m.document?.mime_type ?? '';
    const ok = m.photo || mime.startsWith('image/') || (s.step === 'file' && mime === 'application/pdf');
    if (!ok) return reply(s.step, s.step === 'file' ? 'Please send a photo or a PDF.' : 'Please send an image.');
    value = m.message_id;
    s.caption = m.caption;
  } else {
    if (!text) return reply(s.step, 'Please type your answer.');
    // keeps the admin summary under Telegram's 4096-char message limit
    if (text.length > 500) return reply(s.step, 'Too long, please keep it under 500 characters.');
    if (s.step === 'time' && !parseDateTime(`${today()} ${text}`, true)) return reply('time', 'Invalid time.');
    if (s.step === 'when' && !parseDateTime(text, true)) return reply('when', 'Invalid date/time.');
    if ((s.step === 'start' || s.step === 'end') && !parseDateTime(text, false)) return reply(s.step, 'Invalid date.');
    if (s.step === 'end' && parseDateTime(text, false) < parseDateTime(s.start, false)) {
      return reply('end', 'End date cannot be before the start date.');
    }
    value = s.step === 'time' ? `${today()} ${text}` : text;
  }

  s[s.step] = value;
  const flow = ['rank', 'name', 'type', ...(FLOWS[s.type] ?? [])];
  const next = flow[flow.indexOf(s.step) + 1];
  if (next) {
    s.step = next;
    return reply(next);
  }

  // Last step done. State is not advanced, so on failure the user can just retry the last step.
  const sub = await submit(chat, s, update.message?.from ?? cb.from);
  if (!sub) {
    s.ids.push((await tg('sendMessage', { chat_id: chat, text: 'Failed to send to your commanders. Please try again.' })).message_id);
    return save();
  }
  await redis('DEL', key);
  try {
    // Telegram can't delete messages older than 48h; those just stay.
    for (let i = 0; i < s.ids.length; i += 100) {
      await tg('deleteMessages', { chat_id: chat, message_ids: s.ids.slice(i, i + 100) });
    }
  } catch (e) {
    console.error('cleanup:', e);
  }
  const sent = await tg('sendMessage', { chat_id: chat, text: `${sub.text}\n\nSubmitted ✅ Send /start to submit another.` });
  sub.summary = sent.message_id;
  sub.day = today();
  sub.at = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' });
  // ponytail: buttons go dead after 7 days, raise EX if admins act later
  await redis('SET', `sub:${sub.id}`, JSON.stringify(sub), 'EX', 604800);
  await log(sub);
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
