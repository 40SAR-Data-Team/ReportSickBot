const RANKS =['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA'];
const TYPES = {
  sick: 'Request Permission to Report Sick',
  appt: 'Request Permission to attend upcoming Medical Appointment',
  mc: 'Send MC / Status from the Doctor / MO',
};
const ACK = "I will wait for my commander's approval before I report sick";
const PLEDGE = "I will seek my commander's approval before heading for my Medical Appointment";
const WEEK = 604800; // seconds

const FOR_ADMIN = '[For Admin]'; // prefix on everything the bot sends to admins
const btn = (text, data) => ({ text, callback_data: data });
/** Today's date in Singapore as DD/MM/YYYY. */
const today = () => new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Singapore' });
/** Redis HGETALL's flat [k1, v1, k2, v2, ...] as [[k1, v1], ...]. */
const pairs = (flat) => Array.from({ length: (flat?.length ?? 0) / 2 }, (_, i) => flat.slice(2 * i, 2 * i + 2));

// step -> [question, inline keyboard?], or a function of the form state returning that
const QUESTIONS = {
  profile: (s) => [`Continue as ${s.rank} ${s.name}?`, [[btn('✅ Yes', 'profile:yes'), btn('Change', 'profile:no')]]],
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
  link: (s) => ['Which request is this MC / Status for?', s.grants.map(([id, g]) => [btn(g.label, `link:${id}`)])],
  reason: ['What new status are you given / What is your reason for MC?'],
  start: () => ['Start Date of MC / Status? (DD/MM/YYYY)', [[btn(`Today (${today()})`, 'today')]]],
  end: ['End Date of MC / Status? (DD/MM/YYYY)'],
  file: ['Attach your MC / Memo. (one photo or PDF)'],
};
// rank -> name -> type, then the chosen type's steps; after the last step, submit.
const FLOWS = {
  sick: ['condition', 'clinic', 'time', 'ack'],
  appt: ['purpose', 'when', 'venue', 'shot', 'pledge'],
  mc: ['link', 'reason', 'start', 'end', 'file'],
};
const BUTTON_STEPS = new Set(['profile', 'rank', 'type', 'ack', 'pledge', 'link']);

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
/** A Redis read whose value is JSON; null if missing. */
const json = async (...cmd) => JSON.parse((await redis(...cmd)) ?? 'null');
/** A Redis hash as an object. */
const hash = async (key) => Object.fromEntries(pairs(await redis('HGETALL', key)));

function ask(chat, step, prefix, s) {
  const q = QUESTIONS[step];
  const [text, keyboard] = typeof q === 'function' ? q(s) : q;
  return tg('sendMessage', {
    chat_id: chat,
    text: prefix ? `${prefix}\n\n${text}` : text,
    reply_markup: keyboard && { inline_keyboard: keyboard },
  });
}

// ADMINS env var: JSON {"name": telegramId}. Unset means no admins, so the submit fails loudly.
const admins = () => Object.entries(JSON.parse(process.env.ADMINS ?? '{}'));
const adminName = (id) => admins().find(([, a]) => a === id)?.[0];

/** Approved sick / appointment requests of this soldier that have no MC / Status yet, as [[subId, grant]]. */
async function grants(chat) {
  return pairs(await redis('HGETALL', `grant:${chat}`)).map(([id, g]) => [id, JSON.parse(g)]).filter(([, g]) => g.until > Date.now());
}
const linkTo = ([id, g]) => ({ link: id, grant: g, rank: g.rank, name: g.name });

/** Outcome lines of a submission, from its claimed fields. */
function outcome(f) {
  const d = f.decided && JSON.parse(f.decided);
  return [
    d && (d.v === 'approved' ? `✅ ${d.by} has approved` : `❌ Rejected by ${d.by}${d.reason ? `\nReason: ${d.reason}` : ''}`),
    f.seen && `👍 Acknowledged by ${f.seen}`,
    f.batsys && `✅ Added to BatSys by ${f.batsys}`,
  ].filter(Boolean);
}

/** Admin buttons still open on a submission. */
function buttons(sub, f) {
  if (sub.type === 'mc') return [!f.seen && btn('👍 Acknowledge', `seen:${sub.id}`), !f.batsys && btn('Added to BatSys?', `batsys:${sub.id}`)].filter(Boolean);
  return f.decided ? [] : [btn('✅ Approve', `approve:${sub.id}`), btn('❌ Reject', `reject:${sub.id}`)];
}

/** Sends the summary (and attached file) to every admin; returns the submission, or null if no admin received it. */
async function submit(chat, s, from) {
  const who = `${s.rank} ${s.name}`;
  const lines = {
    sick: ['🤒 REQUEST TO REPORT SICK', who, `Medical Condition: ${s.condition}`, `Clinic: ${s.clinic}`, `Time: ${s.time}`, `✅ ${ACK}`],
    appt: ['🏥 REQUEST TO ATTEND MEDICAL APPOINTMENT', who, `Reason: ${s.purpose}`, `Time: ${s.when}`, `Clinic: ${s.venue}`, `✅ ${PLEDGE}`],
    mc: ['📄 MC / STATUS', who, `For: ${s.grant?.label}`, `Reason / Status: ${s.reason}`, `From ${s.start} to ${s.end}`],
  }[s.type];
  lines.push(`Sent by: ${from.username ? `@${from.username}` : `user id ${from.id}`}`);
  const kind = { sick: 'sick request', appt: `medical appointment ${s.when}`, mc: `MC ${s.start} to ${s.end}` }[s.type];
  const sub = { id: crypto.randomUUID(), user: chat, type: s.type, text: lines.join('\n'), label: `${who}, ${kind}`, kind, rank: s.rank, name: s.name, when: s.when };
  const file = s.file ?? s.shot;
  const list = admins();
  const results = await Promise.allSettled(list.map(async ([, admin]) => {
    // an MC threads under that admin's copy of the request it is for
    const parent = s.grant?.msgs.find(([c]) => c === admin);
    const sent = await tg('sendMessage', {
      chat_id: admin,
      text: `${FOR_ADMIN} ${sub.text}`,
      reply_markup: { inline_keyboard: [buttons(sub, {})] },
      reply_parameters: parent && { message_id: parent[1], allow_sending_without_reply: true },
    });
    if (file) {
      const caption = s.caption ? `${FOR_ADMIN} ${s.caption}` : FOR_ADMIN;
      await tg('copyMessage', { chat_id: admin, from_chat_id: chat, message_id: file, caption, reply_parameters: { message_id: sent.message_id } });
    }
    return [admin, sent.message_id];
  }));
  // An admin who never pressed Start on the bot can't be messaged; log it so they can be told.
  results.forEach((r, i) => r.status === 'rejected' && console.error(`admin ${list[i].join(' ')}:`, r.reason));
  sub.msgs = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  return sub.msgs.length ? sub : null;
}

/** Records a submission and its claimed fields in its day's /overview list. Label only, no medical details. */
async function log(sub, f) {
  const d = f.decided && JSON.parse(f.decided);
  const row = { at: sub.at, type: sub.type, label: sub.label, decided: d && { v: d.v, by: d.by }, seen: f.seen, batsys: f.batsys };
  await redis('HSET', `day:${sub.day}`, sub.id, JSON.stringify(row));
  // outlives the 7-day sub, so a late tap still updates an existing day list
  await redis('EXPIRE', `day:${sub.day}`, WEEK + 86400);
}

const SECTIONS = [['sick', '🤒 Report sick'], ['appt', '🏥 Medical appointment'], ['mc', '📄 MC / Status']];
const ICONS = { approved: '✅', rejected: '❌', seen: '👍', wait: '⏳' };

/** Sends an admin today's counts, who is still waiting, and each submission's status. */
async function overview(chat) {
  const day = today();
  const rows = pairs(await redis('HGETALL', `day:${day}`)).map(([, v]) => JSON.parse(v)).sort((a, b) => a.at.localeCompare(b.at));
  // ponytail: rows logged before reject/acknowledge existed carry `by`; drop this once they expire (8 days)
  rows.forEach((r) => r.by && (r.type === 'mc' ? (r.batsys ??= r.by) : (r.decided ??= { v: 'approved', by: r.by })));
  const state = (r) => (r.type === 'mc' ? r.seen && 'seen' : r.decided?.v) || 'wait';
  const status = (r) => (r.type === 'mc'
    ? [r.seen ? `👍 acknowledged by ${r.seen}` : '⏳ not yet acknowledged', r.batsys && `✅ BatSys by ${r.batsys}`].filter(Boolean).join(' · ')
    : r.decided ? `${ICONS[r.decided.v]} ${r.decided.v} by ${r.decided.by}` : '⏳ waiting');
  const list = (title, rs, more) => `${title}\n${rs.map((r) => `${r.at} ${r.label}${more ? ` – ${more(r)}` : ''}`).join('\n') || 'None'}`;
  const counts = SECTIONS.map(([type, title]) => {
    const rs = rows.filter((r) => r.type === type);
    const tally = Object.entries(ICONS).map(([k, icon]) => [rs.filter((r) => state(r) === k).length, icon]).filter(([n]) => n);
    return `${title}: ${rs.length}${tally.length ? ` (${tally.map(([n, icon]) => `${n} ${icon}`).join(', ')})` : ''}`;
  });
  const parts = [
    counts.join('\n'),
    list('⏳ Waiting', rows.filter((r) => state(r) === 'wait')),
    list('📄 Awaiting MC', rows.filter((r) => r.decided?.v === 'approved' && !r.mc)),
    ...SECTIONS.map(([type, title]) => list(title, rows.filter((r) => r.type === type), status)),
  ];
  return tg('sendMessage', { chat_id: chat, text: `${FOR_ADMIN} Overview for ${day}\n\n${parts.join('\n\n')}` });
}

/**
 * First tap wins: claims `field` on the submission, then refreshes every admin copy and the soldier's summary,
 * and replies `notify` to the soldier (a new message push-notifies; edits don't). Returns the sub, or null if taken / expired.
 */
async function apply(id, field, value, notify, markup) {
  const key = `sub:${id}`;
  // HSETNX is atomic: a second tap, or two admins tapping at once, gets 0.
  if (!(await redis('HGET', key, 'data')) || !(await redis('HSETNX', key, field, value))) return null;
  const f = await hash(key);
  const sub = JSON.parse(f.data);
  const body = `${sub.text}\n\n${outcome(f).join('\n')}`;
  const open = buttons(sub, f);
  const reply_markup = open.length ? { inline_keyboard: [open] } : undefined; // omitted: keyboard removed
  const results = await Promise.allSettled([
    ...sub.msgs.map(([chat_id, message_id]) => tg('editMessageText', { chat_id, message_id, text: `${FOR_ADMIN} ${body}`, reply_markup })),
    tg('editMessageText', { chat_id: sub.user, message_id: sub.summary, text: body }),
    tg('sendMessage', { chat_id: sub.user, text: notify, reply_to_message_id: sub.summary, reply_markup: markup }),
    log(sub, f),
  ]);
  results.forEach((r) => r.status === 'rejected' && console.error('apply:', r.reason));
  return sub;
}

/** Lets the soldier chain an MC / Status to this approved request. */
async function grant(sub) {
  // an appointment's MC comes after the appointment, so keep it open until a week past it
  const from = sub.type === 'appt' ? Math.max(Date.now(), +parseDateTime(sub.when, true)) : Date.now();
  const g = {
    rank: sub.rank, name: sub.name, summary: sub.summary, msgs: sub.msgs, day: sub.day, until: from + WEEK * 1000,
    label: `${sub.type === 'appt' ? '🏥' : '🤒'} ${sub.day.slice(0, 5)} ${sub.at} ${sub.kind}`,
  };
  await redis('HSET', `grant:${sub.user}`, sub.id, JSON.stringify(g));
  // ponytail: fixed 1-year key TTL, expired fields are filtered by `until`; per-field HEXPIRE if it grows
  await redis('EXPIRE', `grant:${sub.user}`, 31536000);
}

/** Admin tapped Reject: ask for an optional reason; their next text (or Skip) finishes it. */
async function askReason(chat, id, copy) {
  const f = await hash(`sub:${id}`);
  if (!f.data || f.decided) return;
  const prompt = await tg('sendMessage', {
    chat_id: chat,
    text: `${FOR_ADMIN} Reason for rejecting ${JSON.parse(f.data).label}? Type it, or tap Skip.`,
    reply_parameters: { message_id: copy, allow_sending_without_reply: true },
    reply_markup: { inline_keyboard: [[btn('Skip', `rejskip:${id}`), btn('Cancel', `rejcancel:${id}`)]] },
  });
  await redis('SET', `rej:${chat}`, JSON.stringify({ id, prompt: prompt.message_id }), 'EX', 600);
}

/** Finishes this admin's pending reject. Returns false if none is pending (or `id` is not the pending one). */
async function finishReject(chat, name, reason, id) {
  const p = await json('GET', `rej:${chat}`);
  if (!p || (id && p.id !== id)) return false;
  if (reason?.length > 500) {
    await tg('sendMessage', { chat_id: chat, text: `${FOR_ADMIN} Too long, please keep it under 500 characters.` });
    return true;
  }
  await redis('DEL', `rej:${chat}`);
  const notify = `❌ ${name} has rejected your request.${reason ? `\nReason: ${reason}` : ''}\n\nSend /start to submit a new request.`;
  const sub = await apply(p.id, 'decided', JSON.stringify({ v: 'rejected', by: name, reason }), notify);
  const d = !sub && await json('HGET', `sub:${p.id}`, 'decided');
  const text = sub ? '✔ Rejection sent' : d ? `Already ${d.v} by ${d.by}` : 'This request has expired.';
  await tg('editMessageText', { chat_id: chat, message_id: p.prompt, text: `${FOR_ADMIN} ${text}` });
  return true;
}

/** Admin tapped a button on a submission (or on a reject prompt). */
async function decide(cb, name) {
  if (!name) return;
  const [action, id] = cb.data.split(':');
  const chat = cb.message.chat.id;
  if (action === 'reject') return askReason(chat, id, cb.message.message_id);
  if (action === 'rejskip') return finishReject(chat, name, null, id);
  if (action === 'rejcancel') {
    if ((await json('GET', `rej:${chat}`))?.id === id) await redis('DEL', `rej:${chat}`);
    return tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: `${FOR_ADMIN} Rejection cancelled.` });
  }
  if (action === 'approve') {
    const notify = `✅ ${name} has approved\n\nAfter your visit, tap below to send your MC / Status.`;
    const sub = await apply(id, 'decided', JSON.stringify({ v: 'approved', by: name }), notify,
      { inline_keyboard: [[btn('📄 Send MC / Status', `mcfor:${id}`)]] });
    return sub && grant(sub);
  }
  return apply(id, action, name, action === 'seen' ? `👍 Acknowledged by ${name}` : `✅ Added to BatSys by ${name}`);
}

async function handle(update) {
  const cb = update.callback_query;
  const msg = update.message ?? cb?.message;
  if (msg?.chat.type !== 'private') return;
  const chat = msg.chat.id;
  const key = `form:${chat}`;
  let text = update.message?.text?.trim();
  const admin = adminName((update.message ?? cb).from.id);
  if (cb) await tg('answerCallbackQuery', { callback_query_id: cb.id });
  if (/^(approve|reject|rejskip|rejcancel|seen|batsys):/.test(cb?.data)) return decide(cb, admin);
  if (admin && text === '/overview') return overview(chat);
  if (admin && text && !text.startsWith('/') && await finishReject(chat, admin, text)) return;

  if (text === '/start' || text === '/cancel') {
    await redis('DEL', key, `rej:${chat}`);
    if (text === '/cancel') return tg('sendMessage', { chat_id: chat, text: 'Cancelled. Send /start to begin again.' });
  }

  let s = await json('GET', key);
  // "Send MC / Status" under an approval: a fresh MC form already linked to that request
  const mcforId = cb?.data?.startsWith('mcfor:') && cb.data.slice(6);
  const mcfor = mcforId && (await grants(chat)).find(([id]) => id === mcforId);
  if (mcforId && !mcfor) {
    return tg('sendMessage', { chat_id: chat, text: 'This request already has an MC / Status, or it has expired.' });
  }
  const fresh = !s;
  if (mcfor) s = { step: 'reason', type: 'mc', ...linkTo(mcfor) };
  else if (!s) {
    const profile = await json('GET', `profile:${chat}`);
    s = profile ? { step: 'profile', ...profile } : { step: 'rank' };
  }
  // Every message in the form (both sides) is tracked, then deleted on submit.
  s.ids ??= [];
  if (update.message) s.ids.push(update.message.message_id);
  const save = () => redis('SET', key, JSON.stringify(s), 'EX', 3600);
  const reply = async (step, prefix) => { s.ids.push((await ask(chat, step, prefix, s)).message_id); return save(); };
  if (mcfor) return reply('reason', `For: ${s.grant.label}`);
  if (fresh) return reply(s.step);
  if (cb?.data === 'today' && s.step === 'start') text = today();

  let value;
  if (BUTTON_STEPS.has(s.step)) {
    const [step, v] = cb?.data?.split(':') ?? [];
    if (step !== s.step) return cb ? undefined : reply(s.step, 'Please tap one of the buttons.'); // stale tap: ignore
    const picked = step === 'link' && s.grants.find(([id]) => id === v);
    if (step === 'link' && !picked) return;
    value = v;
    const label = { type: TYPES[v], ack: 'Acknowledged', pledge: 'Acknowledged', profile: v === 'yes' ? 'Yes' : 'Change', link: picked && picked[1].label }[step] ?? v;
    await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: `${cb.message.text}\n\n✔ ${label}` });
  } else if (cb && !text) {
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
  let next = flow[flow.indexOf(s.step) + 1]; // profile isn't in the flow, so "Change" goes to rank
  let prefix;
  if (s.step === 'profile' && value === 'yes') next = 'type';
  if (s.step === 'link') {
    Object.assign(s, linkTo(s.grants.find(([id]) => id === value)));
    prefix = `For: ${s.grant.label}`;
  }
  if (next === 'link') {
    // An MC / Status must follow an approved request: none -> blocked, one -> linked, several -> soldier picks.
    const open = await grants(chat);
    if (!open.length) {
      s.step = 'type';
      return reply('type', 'You have no approved sick / appointment request waiting for an MC / Status. '
        + 'Please request permission first, or contact your commander directly.');
    }
    if (open.length === 1) {
      Object.assign(s, linkTo(open[0]));
      next = 'reason';
      prefix = `For: ${s.grant.label}`;
    } else s.grants = open;
  }
  if (next) {
    s.step = next;
    return reply(next, prefix);
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
  const sent = await tg('sendMessage', {
    chat_id: chat,
    text: `${sub.text}\n\nSubmitted ✅`,
    reply_parameters: s.grant && { message_id: s.grant.summary, allow_sending_without_reply: true },
  });
  sub.summary = sent.message_id;
  sub.day = today();
  sub.at = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' });
  // ponytail: buttons go dead after 7 days, raise EXPIRE if admins act later
  await redis('HSET', `sub:${sub.id}`, 'data', JSON.stringify(sub));
  await redis('EXPIRE', `sub:${sub.id}`, WEEK);
  await log(sub, {});
  await redis('SET', `profile:${chat}`, JSON.stringify({ rank: s.rank, name: s.name }));
  if (s.link) {
    // one MC per request; mark the request's /overview row so it leaves "Awaiting MC"
    await redis('HDEL', `grant:${chat}`, s.link);
    const row = await redis('HGET', `day:${s.grant.day}`, s.link);
    if (row) await redis('HSET', `day:${s.grant.day}`, s.link, JSON.stringify({ ...JSON.parse(row), mc: true }));
  }
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
