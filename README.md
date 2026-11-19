# Report Sick Bot

A Telegram bot for a military unit. Soldiers DM it to request permission to report sick or attend a medical appointment, or to send an MC / status. Each submission goes to the administrators listed in the `ADMINS` env var, who approve, reject or acknowledge it with inline buttons.

Stack: Bun (tests) · one Vercel serverless function · Upstash Redis over REST · Telegram Bot API. No build step, no runtime dependencies.

## Architecture

Telegram POSTs every update to `api/webhook.js`. The function keeps nothing in memory between requests; all state is in Redis.

| File | Responsibility |
|---|---|
| `api/webhook.js` | Entry point. Checks the secret header, calls `handle`, always answers 200. |
| `src/flow.js` | `handle(update)`: routes an update to admin code or the soldier's form. Start here when tracing a bug. |
| `src/form.js` | Questions (`QUESTIONS`), step order per workflow (`FLOWS`), button-answered steps (`BUTTON_STEPS`), summary text (`details`). |
| `src/validate.js` | `invalid(step, text, state)`: returns an error message for a bad answer, else null. |
| `src/submissions.js` | Sends a submission to admins; applies their button taps (approve, reject, acknowledge, BatSys); manages grants. |
| `src/admin.js` | Admin decisions, the reject-reason prompt, `/overview`. |
| `src/admins.js` | Parses the `ADMINS` env var. |
| `src/consts.js` | Ranks, request types, pledge text, TTLs, button actions. |
| `src/dates.js` | Singapore-time helpers and the `DD/MM/YYYY [HHMM]` parser. |
| `src/telegram.js` | `tg`, `send`, `edit`, `toAdmin`: thin Bot API wrappers. |
| `src/store.js` | `redis`, `json`, `hash`, `put`, `hput`: thin Upstash REST wrappers. |

### Workflows

Each workflow is a list of steps in `FLOWS` (`src/form.js`):

- `sick`: condition, onset, body, clinic, time, ack, review
- `appt`: purpose, when, venue, shot, pledge, review
- `mc`: formsg, link, reason, start, end, file, review

Before the first step the bot asks for rank and name (or "Continue as PTE Tan?" if `profile:<chat>` exists). The `review` step shows all answers with **Submit** / **Start over**. `/start` restarts the form at any step, `/cancel` aborts it.

### Lifecycle of a submission

1. Soldier submits. A `sub:<id>` record is stored and a `[For Admin]` message with buttons goes to every admin.
2. An admin taps a button. The first decision wins (atomic claim in Redis). Every admin's copy and the soldier's summary are edited, and the soldier gets a reply message.
   - sick / appt: **Approve** or **Reject** (reject asks for an optional reason), then **Added to BatSys?**
   - mc: **Acknowledge**, then **Added to BatSys?** (admins only; the soldier is not told)
3. An approval creates a *grant* in `grant:<chat>`. The soldier can attach one MC to it via the **Send MC / Status** button or the link step in `/start`. A sick grant lasts 7 days; an appointment grant lasts until 7 days after the appointment. An MC can also be sent with no request.
4. Admins can send `/overview` for today's (Singapore time) counts, pending items and statuses. It shows names only, no medical details.

### Redis keys

| Key | Holds | TTL |
|---|---|---|
| `form:<chat>` | Form in progress | 1 hour |
| `profile:<chat>` | Remembered rank and name | none |
| `sub:<id>` | A submission and its claimed outcomes | 7 days |
| `day:<DD/MM/YYYY>` | Hash of the day's submissions, for `/overview` | n/a |
| `grant:<chat>` | Approved requests awaiting an MC | `GRANT_KEY_TTL`; each grant's `until` does the real expiry |
| `submit:<chat>` | Double-tap lock on Submit | 30 s |
| `rej:<chat>` | Admin's pending reject prompt | n/a |

## Local development

```sh
bun test
```

Nothing to install. Tests use dummy data and never touch real Telegram or Upstash:

- `tests/unit.test.js`: date parsing, answer validation.
- `tests/integration.test.js`: calls `handle` directly with `fetch` mocked to the in-memory fake in `tests/fake.js`. Add new behaviour tests here.
- `tests/e2e.test.js`: real HTTP to the webhook, with Telegram and Upstash replaced by a local dummy server (`TELEGRAM_API` overrides the API base).

CI (`.github/workflows/test.yml`) runs `bun test` on every push and pull request.

Use `bun`, not `npm` / `npx`.

## Deployment

1. Run `vercel` in this folder.
2. Vercel dashboard → Storage → add **Upstash for Redis** and connect it. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Set these env vars, then run `vercel --prod`:

   | Var | Value |
   |---|---|
   | `BOT_TOKEN` | From @BotFather |
   | `WEBHOOK_SECRET` | Random string, letters, digits, `_`, `-` only |
   | `ADMINS` | JSON `{"Name":telegramId}`, see below |

4. Point Telegram at the function:

   ```sh
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<app>.vercel.app/api/webhook&secret_token=<WEBHOOK_SECRET>"
   ```

5. Optional, once: show the command menu.

   ```sh
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setMyCommands" -H "content-type: application/json" \
     -d '{"commands":[{"command":"start","description":"New request or MC"},{"command":"cancel","description":"Cancel the current form"},{"command":"overview","description":"Admins: today'"'"'s overview"}]}'
   ```

Env vars only take effect after a redeploy.

### Managing admins

`ADMINS` maps display names to Telegram user IDs, e.g. `{"Joen":123456789}`. Names are only labels. IDs are personal data, so keep the list out of git: store it in an untracked `config.json` (`{ "admins": { ... } }`, already in `.gitignore`) and push it to Vercel:

```sh
vercel env rm ADMINS production   # only if it already exists
bun -e "console.log(JSON.stringify(require('./config.json').admins))" | vercel env add ADMINS production
vercel --prod
```

- Find a user's ID by having them message @userinfobot.
- Each admin must press **Start** on the bot once; Telegram forbids bots messaging users who never started them.
- If one admin is unreachable, the others still receive the submission and the Vercel logs show `admin <name> <id>: ...`.

## Common changes

- **Reword a question:** edit `QUESTIONS` in `src/form.js`.
- **Add or reorder a step:** add it to `QUESTIONS` and the right list in `FLOWS`; add to `BUTTON_STEPS` if answered by a button; add a rule in `invalid` (`src/validate.js`) if the answer needs checking; add to `details` if admins should see it. Update the tests.
- **Add a rank:** edit `RANKS` in `src/consts.js`. The keyboard in `QUESTIONS.rank` is three per row; check the layout.
- **Change an expiry:** `WEEK` and `GRANT_KEY_TTL` in `src/consts.js`; the form's `3600` in `src/flow.js`. Admin buttons stop working after `WEEK`.

## Conventions and gotchas

- **Always answer 200 from the webhook.** Any other status makes Telegram retry the same update forever. Catch and log.
- **No new infrastructure.** Redis hashes and `SET ... NX` locks cover the double-tap guard and "first decision wins". Don't add a database or queue.
- **Admin messages start with `[For Admin]`.** Send them with `toAdmin`, not `send`.
- **No personal data in git.** Never commit tokens, `.env*`, `config.json`, real names or Telegram IDs. Tests use dummy data only.
- **Telegram limits.** Messages cap at 4096 characters (answers are capped at 500 to stay under it). Bots can't edit or delete messages older than 48 hours.
- **Edited messages are ignored.** To change an answer the soldier taps Start over.
- `ponytail:` comments mark deliberate shortcuts. Read them before "fixing" the code.
- Commits: imperative subject, at most 50 chars (`Add LTA rank`). Template: `git config commit.template .gitmessage`. Don't merge on red CI.
- The codebase is deliberately small. Match the existing style, document functions with a short JSDoc, and avoid abstractions for single-use code.

## Troubleshooting

| Symptom | Check |
|---|---|
| Anything wrong | `GET https://<app>.vercel.app/api/health` → `{ok, redis, webhook, admins}`; 503 names the failing part, Vercel logs `health <part>: ...` give the reason. Point an uptime monitor (e.g. UptimeRobot, 5 min) at it. |
| Bot silent | `https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo` → `last_error_message`; then Vercel function logs. A 401 means `WEBHOOK_SECRET` differs from the one given to `setWebhook`. |
| Admin gets nothing | Vercel logs `admin <name> <id>: ...`. Usually they never pressed Start, or the ID is wrong. |
| `redis: ...` errors | `KV_REST_API_URL` / `KV_REST_API_TOKEN` in the Vercel project. |
| Soldier stuck in a form | They send `/start` (restart) or `/cancel`. Forms expire after 1 hour anyway. |
| Works in tests, not live | Redeploy; env vars only apply to new deployments. |
| "This request already has an MC / Status, or it has expired" | One MC per request, and grants expire; see Lifecycle step 3. |
