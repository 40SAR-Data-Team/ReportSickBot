import { HTML, SUB_ACTIONS, btn, replyTo } from './consts.js';
import { today } from './dates.js';
import { EG, FORM } from './form.js';
import { hash, json, put, redis } from './store.js';
import { apply, buttons, grant, outcome } from './submissions.js';
import { FOR_ADMIN, edit, send, toAdmin } from './telegram.js';

/** [type, heading] of each overview section. */
const SECTIONS = [['sick', '🤒 Report sick'], ['appt', '🏥 Medical appointment'], ['mc', '📄 MC / Status']];
/** Status -> icon shown in overview counts and rows. */
const ICONS = { approved: '✅', rejected: '❌', seen: '👍', wait: '⏳' };

/** Sends an admin today's counts, who is still waiting, and each submission's status. */
export async function overview(chat) {
  const day = today();
  const rows = Object.values(await hash(`day:${day}`)).map((v) => JSON.parse(v)).sort((a, b) => a.at.localeCompare(b.at));
  const state = (r) => (r.type === 'mc' ? r.seen && 'seen' : r.decided?.v) || 'wait';
  const status = (r) => outcome(r).join(' · ') || (r.type === 'mc' ? '⏳ not yet acknowledged' : '⏳ waiting');
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
  return toAdmin(chat, `Overview for ${day}\n\n${parts.join('\n\n')}`);
}

/**
 * Asks the admin for an optional reject reason. Their next text (or Skip) finishes it.
 *
 * @param {number} chat Admin's chat id.
 * @param {string} id Submission id.
 * @param {number} copy Message id of the admin's copy, replied to.
 */
async function askReason(chat, id, copy) {
  const f = await hash(`sub:${id}`);
  if (!f.data || f.decided) return;
  const prompt = await toAdmin(chat, `Reason for rejecting ${JSON.parse(f.data).label}? Type it, or tap Skip.`, {
    reply_parameters: replyTo(copy),
    reply_markup: { inline_keyboard: [[btn('Skip', `rejskip:${id}`), btn('Cancel', `rejcancel:${id}`)]] },
  });
  await put(`rej:${chat}`, { id, prompt: prompt.message_id }, 600);
}

/**
 * Finishes this admin's pending reject.
 *
 * @param {number} chat Admin's chat id.
 * @param {string} name Admin's name.
 * @param {?string} reason Typed reason, or null to skip.
 * @param {string=} id If given, only finishes the reject for this submission.
 * @return {Promise<boolean>} False if none is pending (or `id` is not the pending one).
 */
export async function finishReject(chat, name, reason, id) {
  const p = await json('GET', `rej:${chat}`);
  if (!p || (id && p.id !== id)) return false;
  if (reason?.length > 500) {
    await toAdmin(chat, 'Too long, please keep it under 500 characters.');
    return true;
  }
  await redis('DEL', `rej:${chat}`);
  const notify = `❌ ${name} has rejected your request.${reason ? `\nReason: ${reason}` : ''}\n\nSend /start to submit a new request.`;
  const sub = await apply(p.id, 'decided', JSON.stringify({ v: 'rejected', by: name, reason }), notify);
  const d = !sub && await json('HGET', `sub:${p.id}`, 'decided');
  const text = sub ? '✔ Rejection sent' : d ? `Already ${d.v} by ${d.by}` : 'This request has expired.';
  await edit(chat, p.prompt, `${FOR_ADMIN} ${text}`);
  return true;
}

/**
 * Handles an admin button tap on a submission or a reject prompt.
 *
 * @param {object} cb Telegram callback_query.
 * @param {?string} name Admin's name; no-op if not an admin.
 */
export async function decide(cb, name) {
  if (!name) return;
  const [action, id] = cb.data.split(':');
  const chat = cb.message.chat.id;
  const f = SUB_ACTIONS.includes(action) && await hash(`sub:${id}`);
  if (f?.data) { // expired: apply / askReason say so
    const sub = JSON.parse(f.data);
    f.decided &&= JSON.parse(f.decided);
    if (sub.user === chat) return toAdmin(chat, 'You cannot act on your own request. Another admin must.');
    if (!buttons(sub, f).some((b) => b.callback_data === cb.data)) return; // stale / replayed tap
  }
  if (action === 'reject') return askReason(chat, id, cb.message.message_id);
  if (action === 'rejskip') return finishReject(chat, name, null, id);
  if (action === 'rejcancel') {
    if ((await json('GET', `rej:${chat}`))?.id === id) await redis('DEL', `rej:${chat}`);
    return edit(chat, cb.message.message_id, `${FOR_ADMIN} Rejection cancelled.`);
  }
  if (action === 'approve') {
    const notify = `✅ Approved by ${name}\n\nAfter your visit, tap below to send your MC / Status.`;
    const sub = await apply(id, 'decided', JSON.stringify({ v: 'approved', by: name }), notify,
      { inline_keyboard: [[btn('📄 Send MC / Status', `mcfor:${id}`)]] });
    if (sub?.type === 'sick') await send(sub.user, `Reminder: After visiting the doctor, complete the ${FORM}, and keep the FormSG's Response ID e.g. ${EG}`, HTML);
    return sub && grant(sub);
  }
  return apply(id, action, name, action === 'seen' && `👍 Acknowledged by ${name}`);
}
