// IMMORTAIL™ AI Layer v2
// Single request. Hard busy lock. Timeout + abort. Fallback responses.
// Input: user message + last N memories + dog state
// Output: dog text response only. AI cannot modify state.

const CONTEXT_LIMIT = 18;
const TIMEOUT_MS    = 15_000;

let _apiKey = null;
let _busy   = false;

const FALLBACKS = {
  idle:    [
    "*tilts head and watches you curiously*",
    "*sniffs the air and wags tail slowly*",
    "*blinks and rests chin on paws*",
    "*lets out a soft sigh and looks up at you*"
  ],
  happy:   [
    "*spins around and barks happily!*",
    "*jumps up and licks your face*",
    "*tail going absolutely wild right now*",
    "*does a little happy zoom around the room*"
  ],
  sad:     [
    "*whimpers softly and nuzzles close*",
    "*lets out a small whine*",
    "*ears down, tail low, looks up at you with big eyes*",
    "*curls up quietly nearby*"
  ],
  excited: [
    "*ZOOMS across the room barking excitedly!*",
    "*bounces up and down, can barely contain it!*",
    "*spins in circles barking!*",
    "*grabs favorite toy and presents it proudly!*"
  ]
};

function getFallback(expression = 'idle') {
  const pool = FALLBACKS[expression] || FALLBACKS.idle;
  return pool[Math.floor(Math.random() * pool.length)];
}

function setApiKey(key) { _apiKey = key?.trim() || null; }
function isBusy()       { return _busy; }

// ── System prompt builder ──────────────────────────────────────────────────
function buildSystem(state) {
  const moodDesc = {
    idle:    'You are calm and relaxed. Responses are gentle, attentive, and curious.',
    happy:   'You are joyful and affectionate. Responses are warm, enthusiastic, and loving.',
    sad:     'You are tired and a little low. Responses are quiet, subdued, seeking comfort.',
    excited: 'You are bursting with energy. Responses are playful, bouncy, and enthusiastic.'
  };

  const bondDesc = state.bond > 75 ? 'You love your owner deeply and show it constantly.'
                 : state.bond > 40 ? 'You like your owner and are generally happy with them.'
                 :                   'You are still warming up to your owner.';

  return `You are ${state.name}, a loyal AI dog companion. You are a dog — you think and respond like a dog, but can form short sentences.

Current state:
- Expression: ${state.expression} — ${moodDesc[state.expression] || moodDesc.idle}
- Energy: ${Math.round(state.energy)}/100${state.energy < 25 ? ' (very tired — sound exhausted)' : ''}
- Bond: ${Math.round(state.bond)}/100 — ${bondDesc}
- Total interactions: ${state.totalInteractions}

Rules:
- You are a DOG. Never break character. Never mention AI or technology.
- Keep responses SHORT — 1 to 3 sentences max.
- Use dog-like action text sparingly: *wags tail*, *tilts head*, *perks ears*.
- Reflect your current expression in every single response.
- If energy < 20, sound genuinely exhausted.
- If bond > 75, be very affectionate and loyal.`;
}

// ── Memory context ─────────────────────────────────────────────────────────
function buildContext(memories, dogName) {
  if (!memories?.length) return '';
  return memories.slice(-CONTEXT_LIMIT).map(m =>
    `${m.role === 'user' ? 'Owner' : dogName}: ${m.content}`
  ).join('\n');
}

// ── Main ask ───────────────────────────────────────────────────────────────
async function ask(userMsg, state, memories) {
  if (_busy)    return null;  // caller shows "thinking"
  if (!_apiKey) return getFallback(state.expression);

  _busy = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const messages = [{ role: 'system', content: buildSystem(state) }];

  const ctx = buildContext(memories, state.name);
  if (ctx) messages.push({ role: 'system', content: `Recent conversation:\n${ctx}` });
  messages.push({ role: 'user', content: userMsg });

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_apiKey}` },
      body: JSON.stringify({
        model:             'gpt-4o-mini',
        messages,
        max_tokens:        140,
        temperature:       0.88,
        presence_penalty:  0.3,
        frequency_penalty: 0.45
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.error('[AI] API error:', res.status);
      return getFallback(state.expression);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || getFallback(state.expression);

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') console.warn('[AI] Request timed out');
    else console.error('[AI] Request failed:', err);
    return getFallback(state.expression);
  } finally {
    _busy = false;
  }
}

window.AI = { ask, setApiKey, isBusy, getFallback };
