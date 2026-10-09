# Report Sick Bot

A Telegram bot. Users DM it to request permission to report sick, or to send an MC/status. The bot sends each submission to the administrators listed in `config.json`.

## Setup

1. Deploy: run `vercel` in this folder.
2. In the Vercel dashboard, open Storage. Add **Upstash for Redis** and connect it to this project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Add these env vars in Vercel, then redeploy with `vercel --prod`:
   - `BOT_TOKEN`: the token from @BotFather.
   - `WEBHOOK_SECRET`: any random string (letters, digits, `_` and `-` only).
4. Point Telegram at the function:

   ```sh
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<app>.vercel.app/api/webhook&secret_token=<WEBHOOK_SECRET>"
   ```

## Administrators

Put the admins' numeric Telegram user IDs in `config.json`, e.g. `{ "admins": [123456789, 987654321] }`. Then commit and redeploy.

- To find a user ID, message @userinfobot.
- Each admin must press **Start** on the bot once. Telegram does not let a bot message a user who has never started it.
- If an admin can't be reached, the others still get the submission, and the Vercel logs show `admin <id>: ...`.

## Use

DM the bot `/start`. Send `/cancel` to abort. Unfinished forms expire after 1 hour.

## Test

Run `bun test`. All tests use dummy data and never touch the real Telegram or Upstash.

- `tests/unit.test.js`: date parsing.
- `tests/integration.test.js`: calls the handler directly, with `fetch` mocked to an in-memory fake.
- `tests/e2e.test.js`: posts over real HTTP to the webhook. Telegram and Upstash are replaced by a local dummy server.

CI (`.github/workflows/test.yml`) runs the tests with coverage and uploads the results to Codecov. Add the repo on codecov.io, then set the `CODECOV_TOKEN` repo secret.
