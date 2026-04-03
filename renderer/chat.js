/* =========================================================
   chat.js — Chat UI, Claude API calls, event confirmation
   ========================================================= */

const API_KEY_STORAGE = 'weekplanner_api_key';
const MS_CLIENT_ID_STORAGE = 'weekplanner_ms_client_id';
const MAX_HISTORY = 20;

let conversationHistory = [];
let pendingEvents = null;
let isSending = false;

/* ---- DOM refs ------------------------------------------ */

const chatMessages  = document.getElementById('chat-messages');
const chatInput     = document.getElementById('chat-input');
const sendBtn       = document.getElementById('send-btn');
const pendingBar    = document.getElementById('pending-bar');
const pendingText   = document.getElementById('pending-text');
const pendingAdd    = document.getElementById('pending-add');
const pendingCancel = document.getElementById('pending-cancel');

/* ---- Settings modal ------------------------------------ */

const settingsBtn     = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose   = document.getElementById('settings-close');
const apiKeyInput     = document.getElementById('api-key-input');
const toggleKeyBtn    = document.getElementById('toggle-key');
const testKeyBtn      = document.getElementById('test-key-btn');
const saveKeyBtn      = document.getElementById('save-key-btn');
const testResult      = document.getElementById('test-result');

function getApiKey() {
  return localStorage.getItem(API_KEY_STORAGE) || '';
}

function saveApiKey(key) {
  localStorage.setItem(API_KEY_STORAGE, key);
}

settingsBtn.addEventListener('click', () => {
  apiKeyInput.value = getApiKey();
  testResult.textContent = '';
  testResult.className = 'test-result';
  msClientIdInput.value = getMsClientId();
  updateMsStatus();
  settingsOverlay.style.display = '';
});

settingsClose.addEventListener('click', () => {
  settingsOverlay.style.display = 'none';
});

settingsOverlay.addEventListener('click', e => {
  if (e.target === settingsOverlay) settingsOverlay.style.display = 'none';
});

toggleKeyBtn.addEventListener('click', () => {
  apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});

saveKeyBtn.addEventListener('click', () => {
  saveApiKey(apiKeyInput.value.trim());
  testResult.textContent = 'Key saved.';
  testResult.className = 'test-result success';
});

// ---- Microsoft Account settings ----

const msClientIdInput  = document.getElementById('ms-client-id');
const msLoginBtn       = document.getElementById('ms-login-btn');
const msLogoutBtn      = document.getElementById('ms-logout-btn');
const saveMsBtn        = document.getElementById('save-ms-btn');
const msStatus         = document.getElementById('ms-status');
const msSetupLink      = document.getElementById('ms-setup-link');

function getMsClientId() {
  return localStorage.getItem(MS_CLIENT_ID_STORAGE) || '';
}

function saveMsClientId(id) {
  localStorage.setItem(MS_CLIENT_ID_STORAGE, id);
}

async function updateMsStatus() {
  if (!window.electronAPI) return;
  const result = await window.electronAPI.msStatus();
  if (result.signedIn) {
    msStatus.textContent = 'Signed in to Microsoft.';
    msStatus.className = 'ms-status signed-in';
    msLoginBtn.style.display = 'none';
    msLogoutBtn.style.display = '';
  } else {
    msStatus.textContent = getMsClientId() ? 'Not signed in.' : 'Enter a Client ID first.';
    msStatus.className = 'ms-status signed-out';
    msLoginBtn.style.display = '';
    msLogoutBtn.style.display = 'none';
  }
}

saveMsBtn.addEventListener('click', () => {
  saveMsClientId(msClientIdInput.value.trim());
  msStatus.textContent = 'Client ID saved.';
  msStatus.className = 'ms-status signed-in';
  updateMsStatus();
});

msLoginBtn.addEventListener('click', async () => {
  const clientId = msClientIdInput.value.trim() || getMsClientId();
  if (!clientId) {
    msStatus.textContent = 'Please enter a Client ID first.';
    msStatus.className = 'ms-status error';
    return;
  }
  saveMsClientId(clientId);

  msStatus.textContent = 'Opening browser for sign-in...';
  msStatus.className = 'ms-status';
  msLoginBtn.disabled = true;

  const result = await window.electronAPI.msLogin(clientId);
  msLoginBtn.disabled = false;

  if (result.success) {
    msStatus.textContent = 'Signed in to Microsoft!';
    msStatus.className = 'ms-status signed-in';
    msLoginBtn.style.display = 'none';
    msLogoutBtn.style.display = '';
  } else {
    msStatus.textContent = 'Login failed: ' + result.error;
    msStatus.className = 'ms-status error';
  }
});

msLogoutBtn.addEventListener('click', async () => {
  await window.electronAPI.msLogout();
  updateMsStatus();
});

msSetupLink.addEventListener('click', (e) => {
  e.preventDefault();
  // Open link in default browser via window.open (renderer can't use shell directly)
  window.open('https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', '_blank');
});

testKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    testResult.textContent = 'Please enter an API key first.';
    testResult.className = 'test-result fail';
    return;
  }

  testResult.textContent = 'Testing...';
  testResult.className = 'test-result';

  if (!window.electronAPI) {
    testResult.textContent = 'Electron API not available (running in browser?).';
    testResult.className = 'test-result fail';
    return;
  }

  const result = await window.electronAPI.callClaude(key, [
    { role: 'user', content: 'Say "connected" and nothing else.' }
  ]);

  if (result.success) {
    testResult.textContent = 'Connection successful!';
    testResult.className = 'test-result success';
  } else {
    testResult.textContent = 'Failed: ' + result.error;
    testResult.className = 'test-result fail';
  }
});

/* ---- Chat UI helpers ----------------------------------- */

function addBubble(role, content) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  const inner = document.createElement('div');
  inner.className = 'bubble-content';
  inner.textContent = content;
  bubble.appendChild(inner);
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function addLoadingBubble() {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble assistant';
  bubble.id = 'loading-bubble';
  bubble.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

function removeLoadingBubble() {
  const el = document.getElementById('loading-bubble');
  if (el) el.remove();
}

/* ---- Send message -------------------------------------- */

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isSending) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    addBubble('error', 'Please set your Anthropic API key in Settings (gear icon) first.');
    return;
  }

  if (!window.electronAPI) {
    addBubble('error', 'Electron API not available. Make sure you\'re running the app with "npm start".');
    return;
  }

  // Add user message
  chatInput.value = '';
  chatInput.style.height = 'auto';
  addBubble('user', text);

  conversationHistory.push({ role: 'user', content: text });

  // Trim history to keep API calls reasonable
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory = conversationHistory.slice(-MAX_HISTORY);
  }

  isSending = true;
  sendBtn.disabled = true;
  addLoadingBubble();

  // Send week context so Claude knows "this week" vs "next week"
  const weekContext = window.plannerState.getWeekContext();
  const result = await window.electronAPI.callClaude(apiKey, conversationHistory, weekContext);

  removeLoadingBubble();
  isSending = false;
  sendBtn.disabled = false;

  if (!result.success) {
    addBubble('error', 'API error: ' + result.error);
    return;
  }

  const responseText = result.text;
  conversationHistory.push({ role: 'assistant', content: responseText });

  // Try to extract actions (add/remove)
  const actions = extractActionsFromResponse(responseText);
  const displayText = extractDisplayText(responseText);

  // Show the text portion of the response
  if (displayText) {
    addBubble('assistant', displayText);
  }

  if (actions) {
    const currentOffset = window.plannerState.weekOffset;

    // Handle removals immediately (no confirmation needed)
    if (actions.remove.length > 0) {
      const removeSpecs = validateRemoveSpecs(actions.remove, currentOffset);
      const removed = window.plannerState.removeEventsFromAI(removeSpecs);
      if (removed > 0) {
        addBubble('assistant', `Removed ${removed} event${removed !== 1 ? 's' : ''}.`);
      } else if (removeSpecs.length > 0) {
        addBubble('error', 'Could not find matching events to remove. Try being more specific.');
      }
    }

    // Handle adds with confirmation bar
    if (actions.add.length > 0) {
      const { valid, errors } = validateAddEvents(actions.add, currentOffset);

      if (errors.length > 0) {
        addBubble('error', 'Some events had issues: ' + errors.join('; '));
      }

      if (valid.length > 0) {
        pendingEvents = valid;
        const hasNextWeek = valid.some(e => e.weekOffset !== currentOffset);
        let label = `Add ${valid.length} event${valid.length !== 1 ? 's' : ''}`;
        if (hasNextWeek) label += ' (includes next week)';
        label += ' to your calendar?';
        pendingText.textContent = label;
        pendingBar.style.display = '';
      }
    }
  } else if (!displayText) {
    addBubble('assistant', responseText);
  }

  chatInput.focus();
}

/* ---- Pending events bar -------------------------------- */

pendingAdd.addEventListener('click', () => {
  if (pendingEvents) {
    window.plannerState.addEventsFromAI(pendingEvents);
    addBubble('assistant', `Added ${pendingEvents.length} event${pendingEvents.length !== 1 ? 's' : ''} to your calendar.`);
    pendingEvents = null;
    pendingBar.style.display = 'none';
  }
});

pendingCancel.addEventListener('click', () => {
  pendingEvents = null;
  pendingBar.style.display = 'none';
  addBubble('assistant', 'Events discarded. Let me know if you\'d like to try again.');
});

/* ---- Input handling ------------------------------------ */

sendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

/* ---- Voice Input (Local Whisper via Main Process) ----- */

const micBtn = document.getElementById('mic-btn');
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;

micBtn.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

async function startRecording() {
  if (!window.electronAPI) {
    addBubble('error', 'Electron API not available.');
    return;
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    addBubble('error', 'Microphone access denied. Please allow microphone access in your system settings.');
    return;
  }

  audioChunks = [];
  mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    // Stop the mic stream
    audioStream.getTracks().forEach(t => t.stop());

    if (audioChunks.length === 0) return;

    chatInput.placeholder = 'Transcribing...';
    micBtn.disabled = true;

    try {
      // Convert webm blob to PCM Float32 at 16kHz
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const arrayBuf = await blob.arrayBuffer();
      const audioCtx = new OfflineAudioContext(1, 1, 16000);
      const decoded = await audioCtx.decodeAudioData(arrayBuf);

      // Resample to 16kHz mono
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start(0);
      const resampled = await offlineCtx.startRendering();
      const pcm = resampled.getChannelData(0);

      // Send to main process for Whisper transcription
      const result = await window.electronAPI.transcribeAudio(Array.from(pcm));

      if (result.success && result.text) {
        chatInput.value = result.text;
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        // Auto-send
        sendMessage();
      } else if (result.success && !result.text) {
        addBubble('error', 'Could not understand the audio. Please try again.');
      } else {
        addBubble('error', 'Transcription error: ' + result.error);
      }
    } catch (e) {
      addBubble('error', 'Audio processing error: ' + e.message);
    }

    micBtn.disabled = false;
    chatInput.placeholder = 'Describe your meetings, hours, lunch plans...';
  };

  mediaRecorder.start(250); // collect data every 250ms
  isRecording = true;
  micBtn.classList.add('recording');
  chatInput.value = '';
  chatInput.placeholder = 'Listening... click mic to stop';
}

function stopRecording() {
  isRecording = false;
  micBtn.classList.remove('recording');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

/* ---- Push to Outlook ---------------------------------- */

document.getElementById('outlook-push-btn').addEventListener('click', async () => {
  if (!window.electronAPI) {
    addBubble('error', 'Electron API not available.');
    return;
  }

  const clientId = getMsClientId();
  if (!clientId) {
    addBubble('error', 'Please set your Microsoft Client ID in Settings and sign in first.');
    return;
  }

  const status = await window.electronAPI.msStatus();
  if (!status.signedIn) {
    addBubble('error', 'Please sign in to Microsoft in Settings first.');
    return;
  }

  const eventsWithDates = window.plannerState.getEventsWithDates();
  if (eventsWithDates.length === 0) {
    addBubble('error', 'No events to push. Add some events first.');
    return;
  }

  addBubble('assistant', `Pushing ${eventsWithDates.length} event${eventsWithDates.length !== 1 ? 's' : ''} to Outlook...`);

  const result = await window.electronAPI.pushToOutlook(eventsWithDates, clientId);

  if (result.success) {
    addBubble('assistant', `Done! Added ${result.count} event${result.count !== 1 ? 's' : ''} to your Outlook calendar.`);
  } else {
    addBubble('error', 'Outlook error: ' + result.error);
  }
});

/* ---- Import from Outlook ------------------------------ */

document.getElementById('outlook-import-btn').addEventListener('click', async () => {
  if (!window.electronAPI) {
    addBubble('error', 'Electron API not available.');
    return;
  }

  const clientId = getMsClientId();
  if (!clientId) {
    addBubble('error', 'Please set your Microsoft Client ID in Settings and sign in first.');
    return;
  }

  const status = await window.electronAPI.msStatus();
  if (!status.signedIn) {
    addBubble('error', 'Please sign in to Microsoft in Settings first.');
    return;
  }

  const currentOffset = window.plannerState.weekOffset;
  const range = window.plannerState.getDateRangeForWeek(currentOffset);

  addBubble('assistant', 'Reading your Outlook calendar for this week...');

  const result = await window.electronAPI.readOutlookCalendar(range.start, range.end, clientId);

  if (!result.success) {
    addBubble('error', 'Outlook error: ' + result.error);
    return;
  }

  if (result.events.length === 0) {
    addBubble('assistant', 'No events found in Outlook for this week.');
    return;
  }

  // Format the events as context and add to chat
  const DAYS = window.plannerState.DAYS_SHORT;
  let summary = `Found ${result.events.length} event${result.events.length !== 1 ? 's' : ''} in Outlook:\n\n`;
  result.events.forEach(ev => {
    const startDate = new Date(ev.start);
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][startDate.getDay()];
    const startTime = ev.start.split(' ')[1];
    const endTime = ev.end.split(' ')[1];
    summary += `- ${dayName}: ${ev.subject} (${startTime}–${endTime})`;
    if (ev.location) summary += ` @ ${ev.location}`;
    summary += '\n';
  });
  summary += '\nYou can tell me to use this as a template, e.g. "set up next week like this" or "same schedule but move the 2pm meeting to 3pm".';

  addBubble('assistant', summary);

  // Also inject into conversation history so Claude knows about it
  conversationHistory.push({
    role: 'assistant',
    content: `I read your Outlook calendar for this week. Here are the existing events:\n${summary}`
  });
});
