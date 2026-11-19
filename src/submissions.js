import { WEEK, btn, replyTo, who } from './consts.js';
import { parseDateTime, today } from './dates.js';
import { details } from './form.js';
import { hash, hput, pairs, redis } from './store.js';
import { FOR_ADMIN, admins, edit, send, tg, toAdmin } from './telegram.js';

/**
 * Lists a soldier's open grants: approved requests still awaiting an MC / Status.
 *
 * @param {number} chat Soldier's chat id.
 * @return {Promise<Array<[string, object]>>} [[subId, grant]] pairs not yet expired.
 */
export async function grants(chat) {
  return Object.entries(await hash(`grant:${chat}`)).map(([id, g]) => [id, JSON.parse(g)]).filter(([, g]) => g.until > Date.now());
}
/** Form state fields that link an MC to the grant `[id, g]`. */
export const linkTo = ([id, g]) => ({ link: id, grant: g, rank: g.rank, name: g.name });

/**
 * Outcome lines of a submission, from its claimed fields (`decided` parsed to {v, by, reason?}) or an /overview row.
 * The soldier's copy leaves out the BatSys tick.
 */
export function outcome(f, soldier) {
  const d = f.decided;
  return [
    d && (d.v === 'approved' ? `✅ Approved by ${d.by}` : `❌ Rejected by ${d.by}${d.reason ? `\nReason: ${d.reason}` : ''}`),
    f.seen && `👍 Acknowledged by ${f.seen}`,
    !soldier && f.batsys && `✅ Added to BatSys by ${f.batsys}`,
  ].filter(Boolean);
}

/** Admin buttons still open on a submission. */
export function buttons(sub, f) {
  const batsys = f.batsys ? [] : [btn('Added to BatSys?', `batsys:${sub.id}`)];
  if (sub.type === 'mc') return f.seen ? batsys : [btn('👍 Acknowledge', `seen:${sub.id}`)];
  if (!f.decided) return [btn('✅ Approve', `approve:${sub.id}`), btn('❌ Reject', `reject:${sub.id}`)];
  return f.decided.v === 'approved' ? batsys : [];
}

/**
 * Sends the summary (and attached file) to every admin.
 *
 * @param {number} chat Soldier's chat id.
 * @param {object} s Completed form state.
 * @param {object} from Telegram user who sent the form.
 * @return {Promise<object|null>} The submission with `msgs` [adminChat, messageId], or null if no admin received it.
 * @throws {Error} If Redis fails; nothing is committed, so the caller lets the soldier retry.
 */
export async function submit(chat, s, from) {
  const lines = details(s);
  lines.push(`Sent by: ${from.username ? `@${from.username}` : `user id ${from.id}`}`);
  const kind = { sick: 'sick request', appt: `medical appointment ${s.when}`, mc: `MC ${s.start} to ${s.end}` }[s.type];
  const sub = {
    id: crypto.randomUUID(), user: chat, type: s.type, text: lines.join('\n'), label: `${who(s)}, ${kind}`, kind, rank: s.rank, name: s.name, when: s.when,
    day: today(), at: new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' }), msgs: [],
  };
  // saved before any admin sees a button, so no button ever points at a missing submission
  // ponytail: buttons go dead after 7 days, raise WEEK if admins act later
  await hput(`sub:${sub.id}`, 'data', sub, WEEK);
  const file = s.file ?? s.shot;
  const list = admins();
  const results = await Promise.allSettled(list.map(async ([, admin]) => {
    // an MC threads under that admin's copy of the request it is for
    const parent = s.grant?.msgs.find(([c]) => c === admin);
    const sent = await toAdmin(admin, sub.text, {
      reply_markup: { inline_keyboard: [buttons(sub, {})] },
      reply_parameters: replyTo(parent?.[1]),
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

/**
 * Records a submission in its day's /overview list. Label only, no medical details.
 *
 * @param {object} sub Submission.
 * @param {object} f Its claimed fields (decided, seen, batsys).
 */
export async function log(sub, f) {
  const d = f.decided; // the reject reason stays out of the day list
  const row = { at: sub.at, type: sub.type, label: sub.label, decided: d && { v: d.v, by: d.by }, seen: f.seen, batsys: f.batsys };
  // outlives the 7-day sub, so a late tap still updates an existing day list
  await hput(`day:${sub.day}`, sub.id, row, WEEK + 86400);
}

// Runs inside Redis as one atomic command: no other client can act between the existence check,
// the claim and the read-back, so the state returned is exactly the state this claim produced.
// The existence check stops HSETNX from recreating an expired submission as a TTL-less key.
const CLAIM = `if redis.call('HEXISTS', KEYS[1], 'data') == 0 then return nil end
local won = redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])
return {won, redis.call('HGETALL', KEYS[1])}`;

/**
 * First tap wins: atomically claims `field` on the submission, in one round trip.
 *
 * @param {string} id Submission id.
 * @param {string} field Field to claim: decided, seen or batsys.
 * @param {string} value Value to store, usually the admin's name.
 * @return {Promise<?{won: boolean, sub: object, f: object}>} Null if expired; else the stored state right after the claim.
 */
export async function claim(id, field, value) {
  const r = await redis('EVAL', CLAIM, 1, `sub:${id}`, field, value);
  if (!r) return null;
  const f = pairs(r[1]);
  f.decided &&= JSON.parse(f.decided);
  return { won: r[0] === 1, sub: JSON.parse(f.data), f };
}

/**
 * Tasks that show a won claim: every admin copy, the /overview row and, with `notify`, the soldier's summary plus
 * a new message (a new message push-notifies; edits don't). No `notify`: the soldier's chat is left alone.
 * Returned unawaited so the caller runs them in one parallel batch with its own tasks.
 *
 * @param {{sub: object, f: object}} c A won claim.
 * @param {string=} notify Message for the soldier.
 * @param {object=} markup reply_markup for `notify`.
 * @param {Function=} after Runs once `notify` is sent, to keep a follow-up message below it.
 * @return {Array<Promise>}
 */
export function broadcast({ sub, f }, notify, markup, after) {
  const body = `${sub.text}\n\n${outcome(f).join('\n')}`;
  const open = buttons(sub, f);
  const reply_markup = open.length ? { inline_keyboard: [open] } : undefined; // omitted: keyboard removed
  return [
    ...sub.msgs.map(([chat_id, message_id]) => edit(chat_id, message_id, `${FOR_ADMIN} ${body}`, { reply_markup })),
    log(sub, f),
    ...(notify ? [
      edit(sub.user, sub.summary, `${sub.text}\n\n${outcome(f, true).join('\n')}`),
      send(sub.user, notify, { reply_to_message_id: sub.summary, reply_markup: markup }).then(after),
    ] : []),
  ];
}

/**
 * Opens a grant so the soldier can chain an MC / Status to this approved request.
 *
 * @param {object} sub Approved submission.
 */
export async function grant(sub) {
  // an appointment's MC comes after the appointment, so keep it open until a week past it
  const from = sub.type === 'appt' ? Math.max(Date.now(), +parseDateTime(sub.when, true) - 8 * 3600e3) : Date.now();
  const g = {
    rank: sub.rank, name: sub.name, summary: sub.summary, msgs: sub.msgs, day: sub.day, until: from + WEEK * 1000,
    label: `${sub.type === 'appt' ? '🏥' : '🤒'} ${sub.day.slice(0, 5)} ${sub.at} ${sub.kind}`,
  };
  // ponytail: fixed 1-year key TTL as a janitor, expired fields are filtered by `until`; per-field HEXPIRE if it grows
  await hput(`grant:${sub.user}`, sub.id, g, 365 * 86400);
}
