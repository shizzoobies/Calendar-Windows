const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

let mainWindow;
let whisperPipeline = null; // lazy-loaded Whisper model

// ---- Microsoft Graph Auth State ----
let msalTokenCache = null; // { accessToken, expiresAt }

const GRAPH_SCOPES = ['Calendars.ReadWrite', 'User.Read'];
const REDIRECT_PORT = 48923;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Week Planner',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

// ---- IPC: Call Claude API ----

const SYSTEM_PROMPT = `You are a weekly schedule assistant. The user will describe events in natural language. Your job is to parse their description into structured calendar events, and also help them remove events.

The user is currently viewing a specific week in the planner. A "context" message will tell you which week they're viewing and what events already exist. Use this to understand "this week" vs "next week" references and to find events when the user asks to remove something.

ALWAYS respond with TWO parts:
1. A brief, friendly acknowledgment of what you understood (1-2 sentences).
2. A JSON code block with an "actions" object.

The JSON format:

\`\`\`json
{
  "add": [
    {"title": "Event Name", "day": 0, "start": "09:00", "end": "10:00", "loc": "", "notes": "", "week": "this"}
  ],
  "remove": [
    {"title": "Event Name", "day": 0, "start": "09:00", "week": "this"}
  ]
}
\`\`\`

**Add** array — each object has:
- "title": string (event name)
- "day": number 0-4 where 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday
- "start": string "HH:MM" 24-hour format
- "end": string "HH:MM" 24-hour format
- "loc": string (location, empty string if not mentioned)
- "notes": string (extra details, empty string if none)
- "week": "this" or "next" (which week to add to, relative to the week the user is currently viewing)
- "busyStatus": "busy", "tentative", or "free" (default "busy"). Use "tentative" for: available time blocks, professional development, flexible time, optional meetings, focus/heads-down time, or anything the user describes as flexible or optional. Use "free" for lunch breaks or personal time.

**Remove** array — to identify which event(s) to delete, include enough fields to match:
- "title": string (partial match is fine — e.g. "standup" matches "Team Standup")
- "day": number 0-4 (optional — omit to match all days)
- "start": string "HH:MM" (optional — omit to match any time)
- "week": "this" or "next"

Omit "add" or "remove" if not needed (e.g. only removing, only adding).

Rules:
- "9am" → "09:00". "Noon" → "12:00". "5pm" → "17:00".
- If no end time given, default to 1 hour after start.
- If an event spans multiple days (e.g., "Monday through Friday"), create separate objects for each day.
- "Next week" means week: "next". "This week" or no week mention means week: "this".
- Only use days 0-4 (Monday-Friday). If weekend days are mentioned, note this limitation.
- Keep titles concise and professional.
- When the user says "remove", "cancel", "delete", or "drop" an event, use the remove array.
- When removing recurring items (e.g. "remove all standups"), include a remove entry for each matching day.

Example — adding events for next week:

Got it! I've set up your next week schedule.

\`\`\`json
{
  "add": [
    {"title": "Team Standup", "day": 0, "start": "09:00", "end": "09:30", "loc": "", "notes": "", "week": "next"},
    {"title": "Team Standup", "day": 1, "start": "09:00", "end": "09:30", "loc": "", "notes": "", "week": "next"}
  ]
}
\`\`\`

Example — removing an event:

Done! I've removed the Wednesday lunch.

\`\`\`json
{
  "remove": [
    {"title": "Lunch", "day": 2, "week": "this"}
  ]
}
\`\`\`

If the user's message is conversational (greeting, question, not describing events or removals), respond naturally without a JSON block.`;

ipcMain.handle('call-claude', async (event, { apiKey, messages, weekContext }) => {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    let system = SYSTEM_PROMPT;
    if (weekContext) {
      system += `\n\nCurrent context:\n${weekContext}`;
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: system,
      messages: messages,
    });
    return { success: true, text: response.content[0].text };
  } catch (err) {
    return { success: false, error: err.message || 'Unknown error calling Claude API' };
  }
});

// ---- IPC: Save ICS file ----

ipcMain.handle('save-ics', async (event, { icsContent }) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Calendar',
      defaultPath: 'my-week.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, icsContent, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false, canceled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- Microsoft Graph OAuth2 with PKCE ----
// Uses authorization code flow with PKCE (no client secret needed)

function base64URLEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePKCE() {
  const verifier = base64URLEncode(crypto.randomBytes(32));
  const challenge = base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function startLocalServer(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (error) {
          res.end('<html><body><h2>Login failed</h2><p>You can close this window.</p></body></html>');
          server.close();
          reject(new Error(url.searchParams.get('error_description') || error));
        } else if (state !== expectedState) {
          res.end('<html><body><h2>Invalid state</h2><p>You can close this window.</p></body></html>');
          server.close();
          reject(new Error('OAuth state mismatch'));
        } else {
          res.end('<html><body><h2>Login successful!</h2><p>You can close this window and return to Week Planner.</p></body></html>');
          server.close();
          resolve(code);
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      // Server started, waiting for callback
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Login timed out. Please try again.'));
    }, 120000);
  });
}

async function exchangeCodeForToken(clientId, code, pkceVerifier) {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const body = new URLSearchParams({
    client_id: clientId,
    scope: GRAPH_SCOPES.join(' '),
    code: code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    code_verifier: pkceVerifier,
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - 60000, // 1 min buffer
  };
}

async function refreshAccessToken(clientId, refreshToken) {
  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  const body = new URLSearchParams({
    client_id: clientId,
    scope: GRAPH_SCOPES.join(' '),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in * 1000) - 60000,
  };
}

async function getValidToken(clientId) {
  if (!msalTokenCache) {
    throw new Error('Not signed in to Microsoft. Please sign in first.');
  }
  if (Date.now() < msalTokenCache.expiresAt) {
    return msalTokenCache.accessToken;
  }
  // Token expired, try refresh
  if (msalTokenCache.refreshToken) {
    msalTokenCache = await refreshAccessToken(clientId, msalTokenCache.refreshToken);
    return msalTokenCache.accessToken;
  }
  throw new Error('Session expired. Please sign in to Microsoft again.');
}

// ---- IPC: Microsoft Login ----

ipcMain.handle('ms-login', async (event, { clientId }) => {
  try {
    const pkce = generatePKCE();
    const state = base64URLEncode(crypto.randomBytes(16));

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(GRAPH_SCOPES.join(' ') + ' offline_access')}` +
      `&state=${state}` +
      `&code_challenge=${pkce.challenge}` +
      `&code_challenge_method=S256`;

    // Start local server to receive callback, then open browser
    const codePromise = startLocalServer(state);
    shell.openExternal(authUrl);

    const code = await codePromise;
    msalTokenCache = await exchangeCodeForToken(clientId, code, pkce.verifier);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Microsoft login failed' };
  }
});

ipcMain.handle('ms-logout', async () => {
  msalTokenCache = null;
  return { success: true };
});

ipcMain.handle('ms-status', async () => {
  return { signedIn: msalTokenCache !== null && Date.now() < (msalTokenCache.expiresAt + 60000) };
});

// ---- IPC: Push events to Outlook via Microsoft Graph ----

ipcMain.handle('push-to-outlook', async (event, { events: eventsToAdd, clientId }) => {
  try {
    const token = await getValidToken(clientId);
    let added = 0;

    for (const ev of eventsToAdd) {
      // Build ISO datetime strings
      const startDT = `${ev.dateStr}T${ev.start}:00`;
      const endDT = `${ev.dateStr}T${ev.end}:00`;

      // Map busyStatus
      let showAs = 'busy';
      if (ev.busyStatus === 'tentative') showAs = 'tentative';
      else if (ev.busyStatus === 'free') showAs = 'free';

      const graphEvent = {
        subject: ev.title,
        start: { dateTime: startDT, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end: { dateTime: endDT, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        showAs: showAs,
        isReminderOn: true,
        reminderMinutesBeforeStart: 15,
      };

      if (ev.loc) graphEvent.location = { displayName: ev.loc };
      if (ev.notes) graphEvent.body = { contentType: 'text', content: ev.notes };

      const resp = await fetch('https://graph.microsoft.com/v1.0/me/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(graphEvent),
      });

      if (resp.ok) {
        added++;
      } else {
        const errData = await resp.json().catch(() => ({}));
        console.error('Graph API error:', resp.status, errData);
      }
    }

    return { success: true, count: added };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- IPC: Read events from Outlook via Microsoft Graph ----

ipcMain.handle('read-outlook-calendar', async (event, { startDate, endDate, clientId }) => {
  try {
    const token = await getValidToken(clientId);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Parse the date strings (M/D/YYYY format) to ISO
    const parseDate = (str) => {
      const parts = str.match(/(\d+)\/(\d+)\/(\d+)/);
      if (!parts) return str;
      const [, m, d, y] = parts;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00`;
    };

    const startISO = parseDate(startDate);
    const endISO = parseDate(endDate);

    const url = `https://graph.microsoft.com/v1.0/me/calendarview` +
      `?startdatetime=${encodeURIComponent(startISO)}` +
      `&enddatetime=${encodeURIComponent(endISO)}` +
      `&$select=subject,start,end,location,bodyPreview,isAllDay,showAs,seriesMasterId` +
      `&$orderby=start/dateTime` +
      `&$top=50` +
      `&Prefer=outlook.timezone="${tz}"`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Graph API error: ${resp.status}`);
    }

    const data = await resp.json();
    const events = (data.value || []).map(item => ({
      subject: item.subject,
      start: item.start.dateTime.slice(0, 16).replace('T', ' '),
      end: item.end.dateTime.slice(0, 16).replace('T', ' '),
      location: item.location?.displayName || '',
      body: (item.bodyPreview || '').slice(0, 200),
      isRecurring: !!item.seriesMasterId,
      showAs: item.showAs || 'busy',
    }));

    return { success: true, events };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ---- IPC: Local Whisper Transcription ----

async function getWhisperPipeline() {
  if (!whisperPipeline) {
    const { pipeline } = await import('@xenova/transformers');
    // First call downloads ~75MB model, cached in ~/.cache/huggingface
    whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      quantized: true,
    });
  }
  return whisperPipeline;
}

ipcMain.handle('transcribe-audio', async (event, { audioBuffer }) => {
  try {
    const transcriber = await getWhisperPipeline();

    // audioBuffer is a Float32Array of PCM samples at 16kHz
    const float32 = new Float32Array(audioBuffer);
    const result = await transcriber(float32, {
      sampling_rate: 16000,
      language: 'english',
    });

    const text = (result.text || '').trim();
    return { success: true, text };
  } catch (err) {
    return { success: false, error: err.message || 'Transcription failed' };
  }
});

ipcMain.handle('whisper-status', async () => {
  return { loaded: whisperPipeline !== null };
});
