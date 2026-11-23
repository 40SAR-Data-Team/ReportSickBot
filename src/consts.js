/** Timezone of every date and time the bot shows, stores or checks. */
export const TZ = 'Asia/Singapore';
/** The unit's FormSG report-sick form: its link and the name soldiers see. */
export const FORMSG = { url: 'https://go.gov.sg/medicalforms-40sar', name: '40 SAR Report Sick Form' };
/** Lifetime of a submission and its grant window. */
export const WEEK = 604800; // seconds
/** Button actions on a submission's admin copy; each is checked against the buttons still offered. */
export const SUB_ACTIONS = ['approve', 'reject', 'seen', 'batsys'];
/** Every admin button action: SUB_ACTIONS plus the reject prompt's Skip and Cancel. */
export const ADMIN_ACTIONS = [...SUB_ACTIONS, 'rejskip', 'rejcancel'];
/** Telegram send option: parse the text as HTML. */
export const HTML = { parse_mode: 'HTML' };
/**
 * Builds an inline keyboard button.
 *
 * @param {string} text Label shown on the button.
 * @param {string} data Callback data sent back when tapped.
 * @return {{text: string, callback_data: string}}
 */
export const btn = (text, data) => ({ text, callback_data: data });
/** "RANK Name" of a form or submission. */
export const who = (s) => `${s.rank} ${s.name}`;
/** Runs `tasks` in parallel and logs failures instead of throwing, so one failed side effect can't stop the others. */
export const settle = async (tasks) => (await Promise.allSettled(tasks)).forEach((r) => r.status === 'rejected' && console.error(r.reason));
/** Telegram reply_parameters for `message_id`; falsy if none. Sends anyway if the target is gone. */
export const replyTo = (message_id) => message_id && { message_id, allow_sending_without_reply: true };
