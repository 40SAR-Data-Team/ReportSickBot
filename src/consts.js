/** Selectable ranks, lowest to highest. */
export const RANKS =['REC', 'PTE', 'LCP', 'CPL', 'CFC', '3SG', '2SG', '2LT', 'LTA'];
/** Request type key -> menu label. */
export const TYPES = {
  sick: 'Request Permission to Report Sick',
  appt: 'Request Permission to attend upcoming Medical Appointment',
  mc: 'Send MC / Status from the Doctor / MO',
};
/** Pledge a soldier acknowledges before reporting sick. */
export const ACK = "I will wait for my commander's approval before I report sick";
/** Pledge a soldier acknowledges before going for an appointment. */
export const PLEDGE = "I will seek my commander's approval before heading for my Medical Appointment";
/** Lifetime of a submission and its grant window. */
export const WEEK = 604800; // seconds
/** TTL of a soldier's grant hash key, in seconds. Only a janitor: each grant's own `until` does the real expiry. */
export const GRANT_KEY_TTL = 365 * 86400;
/** Button actions on a submission's admin copy; each is checked against the buttons still offered. */
export const SUB_ACTIONS = ['approve', 'reject', 'seen', 'batsys'];
/** Every admin button action: SUB_ACTIONS plus the reject prompt's Skip and Cancel. */
export const ADMIN_ACTIONS = [...SUB_ACTIONS, 'rejskip', 'rejcancel'];
/** Link-step button for an MC that belongs to no request. */
export const UNLINKED = '📄 Not for any request above';
/** Telegram send option: parse the text as HTML. */
export const HTML = { parse_mode: 'HTML' };
/** HTML link to the FormSG report-sick form. */
export const FORM = '(<a href="https://go.gov.sg/medicalforms-40sar">40 SAR Report Sick Form</a>)';
export const EG = '6ad8500b1d0ae72f026cfa75'; // example FormSG Response ID

export const FOR_ADMIN = '[For Admin]'; // prefix on everything the bot sends to admins
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
/** Telegram reply_parameters for `message_id`; falsy if none. Sends anyway if the target is gone. */
export const replyTo = (message_id) => message_id && { message_id, allow_sending_without_reply: true };
