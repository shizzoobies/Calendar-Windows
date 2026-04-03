# Week Planner — AI Calendar Assistant for Windows

A desktop app that lets you plan your work week by just talking about it. Describe your meetings, lunch plans, and hours in plain English — or speak into the mic — and AI turns it into calendar events you can export to Outlook, Apple Calendar, or Google Calendar.

Built with Electron, powered by Claude.

## Features
- **Natural language input** — "I have standup at 9am Monday through Friday and lunch with Sarah at noon Wednesday"
- **Voice input** — click the mic and speak, transcribed locally with Whisper (works offline)
- **Smart week awareness** — understands "today", "tomorrow", "next week"
- **Add, edit, remove via chat** — "cancel the Thursday meeting" or "move lunch to 1pm"
- **Tentative/free status** — available time and professional development auto-marked as tentative
- **ICS export** — one-click download, import into any calendar app
- **Outlook integration** — push events directly via Microsoft Graph API

---

## Quick Start

1. Download the installer from [Releases](https://github.com/shizzoobies/Calendar-Windows/releases)
2. Run **Week Planner Setup 1.0.0.exe** and install
3. Open Week Planner from your desktop or Start Menu
4. Click the **gear icon** (top right) and enter your Anthropic API key (see below)
5. Start chatting!

> **Note:** Windows SmartScreen may warn about an unsigned app. Click **"More info"** then **"Run anyway"** to proceed. This is normal for apps that aren't code-signed.

---

## Getting Your Anthropic API Key

The app uses Claude (by Anthropic) to understand your schedule. You need your own API key — here's how to get one:

### Step 1: Create an Anthropic account

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Click **"Sign up"**
3. Enter your email address and create a password (or sign in with Google)
4. Verify your email if prompted

### Step 2: Add billing

Anthropic requires a payment method on file to use the API. Usage is pay-as-you-go and very affordable — planning a full week of events typically costs less than $0.01.

1. Once logged in, click **"Settings"** in the left sidebar
2. Click **"Billing"**
3. Click **"Add payment method"**
4. Enter your credit card information
5. You can set a monthly spending limit (even $5/month is more than enough for personal use)

### Step 3: Create an API key

1. Click **"API Keys"** in the left sidebar
2. Click **"Create Key"**
3. Give it a name like **"Week Planner"**
4. Click **"Create Key"**
5. **Copy the key immediately** — it starts with `sk-ant-` and you won't be able to see it again after you close the dialog

### Step 4: Enter the key in Week Planner

1. Open Week Planner
2. Click the **gear icon** in the top-right corner
3. Paste your API key into the **"Anthropic API Key"** field
4. Click **"Test Connection"** to verify it works
5. Click **"Save"**

That's it! Your key is stored locally on your computer and is only sent directly to Anthropic's servers.

### How much does it cost?

The app uses Claude Sonnet, which costs about **$3 per million input tokens** and **$15 per million output tokens**. In practical terms:

- Planning a full week of events: **less than $0.01**
- A month of daily use: **roughly $0.10 - $0.30**
- The voice input (Whisper) is completely free — it runs locally on your machine

---

## How to Use

### Chat with AI
Type (or speak) naturally in the chat panel on the left:

- *"I have standup at 9am Monday through Friday"*
- *"Lunch with Sarah at noon on Wednesday at Cafe Roma"*
- *"Block 2-4pm Tuesday and Thursday for professional development"*
- *"Cancel the Wednesday lunch"*
- *"Move standup to 9:30"*

The AI will parse your input and show a confirmation bar. Click **"Add All"** to add the events to your calendar.

### Voice Input
1. Click the **microphone button** (between the text box and send button)
2. Speak your schedule — the button turns red while recording
3. Click the mic button again to stop
4. Your speech is transcribed locally and auto-sent to the AI

The first time you use voice input, it downloads a small AI model (~75MB). After that, voice works completely offline.

### Manual Editing
- Click any **event chip** in the day grid to edit it
- Click the **X** on a chip to delete it
- Use the form at the bottom to add events manually

### Week Navigation
- Use the **arrow buttons** to move between weeks
- Click **"This week"** to jump back to the current week
- Events are tracked per-week — you can plan multiple weeks ahead

### Export
Click **"Download ICS"** to save a calendar file. Then import it:

- **Outlook (desktop):** File > Open & Export > Import/Export > Import an iCalendar file
- **Outlook (web):** Calendar > Add calendar > Upload from file
- **Apple Calendar:** Double-click the .ics file
- **Google Calendar:** Settings > Import & Export > Import

### Smart Status
The AI automatically sets the right availability status:
- **Busy** — meetings, calls, firm commitments
- **Tentative** — available time, professional development, focus blocks, optional meetings
- **Free** — lunch, personal time

---

## Outlook Direct Push (Optional)

If you want to push events directly to your Outlook calendar without exporting an ICS file, you'll need a Microsoft Azure app registration. This is optional — the ICS export works without it.

### Azure Setup

1. Go to [Azure Portal — App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Sign in with your Microsoft account
3. Click **"New registration"**
4. Fill in:
   - **Name:** `Week Planner`
   - **Supported account types:** "Accounts in any organizational directory and personal Microsoft accounts"
   - **Redirect URI:** Select **Web**, enter `http://localhost:48923/auth/callback`
5. Click **"Register"**
6. Copy the **Application (client) ID** from the overview page
7. Go to **"API permissions"** > **"Add a permission"** > **"Microsoft Graph"** > **"Delegated permissions"**
8. Add `Calendars.ReadWrite` and `User.Read`
9. Click **"Grant admin consent"** if available (or consent on first login)

Then in Week Planner:
1. Open Settings (gear icon)
2. Paste the Client ID in the **"Microsoft App Client ID"** field
3. Click **Save**, then **"Sign in to Microsoft"**

---

## Build from Source

Requires [Node.js](https://nodejs.org/) (v18+).

```bash
git clone https://github.com/shizzoobies/Calendar-Windows.git
cd Calendar-Windows
npm install
npm start          # run in dev mode
npm run build      # build Windows installer (outputs to dist/)
```

### Web Version

A standalone web version is included in the `web/` folder:

```bash
cd web
npm install
npm start          # runs at http://localhost:3000
```

---

## Project Structure

```
main.js              Electron main process (API calls, IPC, save dialog)
preload.js           Secure bridge between main and renderer
renderer/
  index.html         Two-panel app layout (chat + planner)
  style.css          All styling
  planner.js         Week grid, event CRUD, ICS generation
  chat.js            Chat UI, API calls, voice input, Outlook integration
  ai-events.js       JSON extraction and validation from AI responses
web/                 Standalone web version (Node.js + Express)
```

---

## License

MIT

---

Built by [K & A Designs](https://kandadesigners.com) — powered by Claude AI
