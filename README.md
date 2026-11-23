# Report Sick Bot — User Guide

A Telegram bot for 40 SAR soldiers. Use it to ask permission to report sick, to ask permission to attend a medical appointment, or to send your MC / status to your commanders.

> Developers: see the [Developer Guide](docs/DeveloperGuide.md).

---

## Why this bot exists

Without the bot, soldiers ask for permission through calls, texts and group chats. Requests get lost, commanders miss them, and nobody has a clear record of who is sick today.

The bot fixes this:

- **One place to ask.** Every request follows the same short set of questions.
- **Every admin sees it at once.** You don't need to chase one person.
- **One clear answer.** The first admin to respond decides, and the bot tells you right away.
- **Your MC is linked to your request.** Admins can see which approval it belongs to.

## Features

| Feature | What it means for you |
|---|---|
| Three request types | Report sick, medical appointment, or send MC / status |
| Remembers you | After your first request, tap **✅ Yes** to keep your rank and name |
| Step-by-step questions | One question at a time, with buttons where possible |
| Checks your answers | Wrong dates or formats are caught before you submit |
| Review before sending | You check every answer, then submit or start over |
| Clean chat | After you submit, the questions are cleared and only one summary stays |
| Instant outcome | You get a message when your request is approved, rejected or acknowledged |
| One-tap MC | After approval, tap **📄 Send MC / Status** to send your MC for that request |

## Getting started

1. Open Telegram and search for the bot. Your unit will give you its name.
2. Tap **Start**.
3. Answer the questions.

The bot only works in a private chat. It ignores messages in group chats.

---

## How to use it

### 1. Tell the bot who you are

- **First time:** tap your **Rank**, then type your **Name**.
- **After that:** the bot asks *"Continue as PTE Tan?"* Tap **✅ Yes**, or tap **Change** to enter a new rank and name.

### 2. Choose what you need

The bot asks *"How may I help you?"* Tap one option:

- **Request Permission to Report Sick**
- **Request Permission to attend upcoming Medical Appointment**
- **Send MC / Status from the Doctor / MO**

### 3a. Report sick

| Step | What to give |
|---|---|
| Symptoms | What you feel, how bad it is, any fever. Example: `Fever 38.5, sore throat, cough` |
| Since when | The date your symptoms started, as `DDMMYY` |
| Side of body | Tap **Left**, **Right**, **Both** or **NA** |
| Clinic | The clinic you will visit |
| Visit time | 24-hour time, as `HHMM`. Example: `0830` |
| Pledge | Tap **✅ I acknowledge**. You agree to wait for approval before you report sick. |

### 3b. Medical appointment

| Step | What to give |
|---|---|
| Reason | Example: `Eczema review` |
| Date and time | As `DDMMYY HHMM`. Example: `251226 0930` |
| Clinic | The clinic of your appointment |
| Screenshot | One image of your appointment |
| Pledge | Tap **✅ I acknowledge**. You agree to get approval before you go. |

### 3c. Send MC / status

| Step | What to give |
|---|---|
| FormSG Response ID | Complete the [40 SAR Report Sick Form](https://go.gov.sg/medicalforms-40sar). Then paste the Response ID it gives you (24 characters, for example `6ad8500b1d0ae72f026cfa75`). |
| Which request | Asked only if you have an approved request waiting for an MC. Tap it, or tap **📄 Not for any request above**. |
| Reason / status | The status or MC reason the doctor gave |
| Start date | Tap **Today**, or type `DDMMYY` |
| End date | As `DDMMYY` |
| Document | One photo or PDF of your MC / memo |

### 4. Review and submit

The bot shows all your answers.

- Tap **✅ Submit** to send them.
- Tap **🔄 Start over** to begin again.

After you submit, the bot clears the questions and keeps one **Submitted ✅** summary.

### 5. Get your answer

| You receive | Meaning | What to do next |
|---|---|---|
| ✅ Approved by *name* | You may go | After your visit, tap **📄 Send MC / Status** |
| ❌ Rejected by *name* | You may not go. A reason may be shown. | Send `/start` to make a new request |
| 👍 Acknowledged by *name* | Your MC / status was received | Nothing |

When a report-sick request is approved, the bot also reminds you to complete the FormSG form after you see the doctor.

---

## How to type dates and times

| Type | Format | Example | Means |
|---|---|---|---|
| Date | `DDMMYY` | `251226` | 25/12/2026 |
| Date and time | `DDMMYY HHMM` | `251226 0930` | 25/12/2026, 9:30 am |
| Time | `HHMM` (24-hour) | `1415` | 2:15 pm |

The bot checks these rules:

- Symptoms cannot start in the future.
- Dates must be within one year of today.
- An appointment cannot be in the past.
- An MC's end date cannot be before its start date.

If an answer is wrong, the bot explains why and asks again.

## Commands

| Command | What it does |
|---|---|
| `/start` | Start a new request, or restart the current one |
| `/cancel` | Stop the current request |

## FAQ

**I made a mistake.**
Before you submit, tap **🔄 Start over** or send `/start`. Editing a message you already sent does not change your answer. After you submit, send a new request.

**The bot is not replying.**
Send `/start`. An unfinished request expires after 1 hour.

**The "Send MC / Status" button stopped working.**
Each approval accepts one MC. The button expires 7 days after a report-sick approval, or 7 days after your appointment. Send `/start` and choose **Send MC / Status from the Doctor / MO** instead.

**My FormSG Response ID is not accepted.**
Copy the full 24-character ID from the FormSG confirmation page. If it is rejected a second time, the bot skips that question so you can continue.

**Can I use the bot in a group chat?**
No. Use a private chat with the bot.

## Privacy

- Your request details are kept for 7 days. After that, they are deleted.
- Your rank and name are saved so you don't need to type them every time.
- Only your unit's admins see your requests.

## Support

For problems with a request, contact your unit admin or commander.
Maintained by the **40SAR Data Team**.
