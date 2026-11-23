import { decide, finishReject, overview } from './admin.js';
import { ADMIN_ACTIONS, WEEK, replyTo } from './consts.js';
import { expand, today } from './dates.js';
import { BUTTON_STEPS, FLOWS, TYPES, UNLINKED, ask, blank, question } from './form.js';
import { hput, json, put, redis } from './store.js';
import { grants, linkTo, log, submit } from './submissions.js';
import { adminName, edit, send, tg } from './telegram.js';
import { invalid } from './validate.js';

/**
 * Handles one Telegram update: admin commands and buttons, otherwise the soldier's form.
 * Each answer advances the form saved in Redis; the last one submits to the admins.
 *
 * @param {object} update Telegram update.
 */
export async function handle(update) {
  const cb = update.callback_query;
  const msg = update.message ?? cb?.message;
  if (msg?.chat.type !== 'private') return;
  const chat = msg.chat.id;
  const key = `form:${chat}`;
  let text = update.message?.text?.trim();
  const admin = adminName((update.message ?? cb).from.id);
  // admin taps are answered by decide, after their claim is stored; soldier taps right away
  if (ADMIN_ACTIONS.includes(cb?.data?.split(':')[0])) return decide(cb, admin);
  if (cb) await tg('answerCallbackQuery', { callback_query_id: cb.id });
  // /overview is in everyone's command menu; only admins get it
  if (text === '/overview') return admin ? overview(chat) : send(chat, 'Only admins can use /overview. Send /start to make a request.');
  if (admin && text && !text.startsWith('/') && await finishReject(chat, admin, text)) return;

  if (text === '/start' || text === '/cancel') {
    await redis('DEL', key, `rej:${chat}`);
    if (text === '/cancel') return send(chat, 'Cancelled. Send /start to begin again.');
  }

  let s = await json('GET', key);
  // "Send MC / Status" under an approval: a fresh MC form already linked to that request
  const mcforId = cb?.data?.startsWith('mcfor:') && cb.data.slice(6);
  const mcfor = mcforId && (await grants(chat)).find(([id]) => id === mcforId);
  if (mcforId && !mcfor) {
    return send(chat, 'This request already has an MC / Status, or it has expired.');
  }
  const fresh = !s;
  if (mcfor) s = { step: 'formsg', type: 'mc', ...linkTo(mcfor) };
  else if (!s) s = await blank(chat);
  // Every message in the form (both sides) is tracked, then deleted on submit.
  s.ids ??= [];
  if (update.message) s.ids.push(update.message.message_id);
  const save = () => put(key, s, 3600);
  const reply = async (step, prefix) => { s.ids.push((await ask(chat, step, prefix, s)).message_id); return save(); };
  if (mcfor) return reply('formsg', `For: ${s.grant.label}`);
  if (fresh) return cb ? undefined : reply(s.step); // tap on a submitted / expired form: ignore
  if (cb?.data === 'today' && s.step === 'start') text = today();

  let value, picked;
  if (BUTTON_STEPS.has(s.step)) {
    const [step, v] = cb?.data?.split(':') ?? [];
    if (step !== s.step) return cb ? undefined : reply(s.step, 'Please tap one of the buttons.'); // stale tap: ignore
    // forged callback data (e.g. rank:GEN, type:hack): only buttons this question offers count
    if (!question(step, s)[1].flat().some((k) => k.callback_data === cb.data)) return;
    picked = step === 'link' && s.grants.find(([id]) => id === v);
    value = v;
    await edit(chat, cb.message.message_id, `${cb.message.text}\n\n✔ ${buttonLabel(step, v, picked)}`);
    if (step === 'review' && v === 'no') {
      // new form, but keep the old messages so the submit cleanup removes them too
      s = { ...(await blank(chat)), ids: s.ids };
      return reply(s.step);
    }
  } else if (cb && !text) {
    return; // stale tap on an old keyboard
  } else if (s.step === 'file' || s.step === 'shot') {
    const m = update.message;
    const mime = m.document?.mime_type ?? ''; // a PDF only for 'file'
    if (!(m.photo || mime.startsWith('image/') || (s.step === 'file' && mime === 'application/pdf'))) return reply(s.step, s.step === 'file' ? 'Please send a photo or a PDF.' : 'Please send an image.');
    value = m.message_id;
    s.caption = m.caption;
  } else {
    if (['onset', 'when', 'start', 'end'].includes(s.step)) text = expand(text);
    const err = invalid(s.step, text, s);
    // ponytail: a 2nd bad Response ID skips the question instead of blocking the MC
    if (err && (s.step !== 'formsg' || (s.strikes = (s.strikes ?? 0) + 1) < 2)) return reply(s.step, err);
    value = err ? '' : s.step === 'time' ? `${today()} ${text}` : text;
  }

  s[s.step] = value;
  const flow = ['rank', 'name', 'type', ...(FLOWS[s.type] ?? [])];
  let next = flow[flow.indexOf(s.step) + 1]; // profile isn't in the flow, so "Change" goes to rank
  let prefix;
  if (s.step === 'profile' && value === 'yes') next = 'type';
  if (s.step === 'link' && value === 'none') delete s.link;
  else if (s.step === 'link') {
    Object.assign(s, linkTo(picked));
    prefix = `For: ${s.grant.label}`;
  }
  if (next === 'link' && s.link) next = 'reason'; // already linked via the approval's button
  if (next === 'link') {
    // Some soldiers report sick without the app, so an MC needs no prior request:
    // none open -> unlinked, any open -> soldier picks one or "not for any".
    const open = await grants(chat);
    if (open.length) s.grants = open;
    else next = 'reason';
  }
  if (next) {
    s.step = next;
    return reply(next, prefix);
  }

  // Last step done. A double tap on Submit would otherwise send twice; released below, or expires in 30s.
  if (!(await redis('SET', `submit:${chat}`, 1, 'NX', 'EX', 30))) return;
  try {
    const sub = await submit(chat, s, update.message?.from ?? cb.from);
    if (sub) return await complete(chat, key, s, sub);
  } catch (e) {
    console.error('submit:', e);
  }
  // Not committed: the form stays at review, so Submit again retries (admins may get a duplicate, never nothing).
  await redis('DEL', `submit:${chat}`);
  s.ids.push((await send(chat, 'Failed to send to your commanders. Please try again.')).message_id);
  return save();
}

/**
 * Records a sent submission, then deletes the form. Every step before that DEL is safe to redo,
 * so a failure anywhere earlier is retried by the soldier; only cosmetic cleanup comes after it.
 */
async function complete(chat, key, s, sub) {
  const sent = await send(chat, `${sub.text}\n\nSubmitted ✅`, { reply_parameters: replyTo(s.grant?.summary) });
  sub.summary = sent.message_id;
  await hput(`sub:${sub.id}`, 'data', sub, WEEK);
  await log(sub, {});
  await put(`profile:${chat}`, { rank: s.rank, name: s.name });
  if (s.link) {
    // one MC per request; mark the request's /overview row so it leaves "Awaiting MC"
    await redis('HDEL', `grant:${chat}`, s.link);
    const row = await redis('HGET', `day:${s.grant.day}`, s.link);
    if (row) await redis('HSET', `day:${s.grant.day}`, s.link, JSON.stringify({ ...JSON.parse(row), mc: true }));
  }
  await redis('DEL', key, `submit:${chat}`); // commit: no retry after this
  try {
    // Telegram can't delete messages older than 48h; those just stay.
    for (let i = 0; i < s.ids.length; i += 100) {
      await tg('deleteMessages', { chat_id: chat, message_ids: s.ids.slice(i, i + 100) });
    }
  } catch (e) {
    console.error('cleanup:', e);
  }
}

/** Label echoed under a tapped button. */
const buttonLabel = (step, v, picked) => ({
  type: TYPES[v], ack: 'Acknowledged', pledge: 'Acknowledged', profile: v === 'yes' ? 'Yes' : 'Change',
  link: picked ? picked[1].label : UNLINKED, review: v === 'yes' ? 'Submit' : 'Start over',
}[step] ?? v);
