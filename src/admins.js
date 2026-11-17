/** Admins as [name, telegramId] from the ADMINS env var (JSON {"name": id}). Unset means none, so submit fails loudly. */
export const admins = () => Object.entries(JSON.parse(process.env.ADMINS ?? '{}'));
/** Name of the admin with Telegram id `id`, or undefined if not an admin. */
export const adminName = (id) => admins().find(([, a]) => a === id)?.[0];
