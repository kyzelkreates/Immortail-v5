// IMMORTAIL™ AI Layer v4
// Multi-provider: OpenAI · Ollama (local) · OpenRouter (open-source models)
// Priority: user-selected provider → fallback chain → built-in dog responses
// AI cannot modify state. Output: text only.

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
const PROVIDERS = {

  openai: {
    label:    'OpenAI (GPT-4o mini)',
    keyLabel: 'OpenAI API Key',
    keyHint:  'sk-…',
    models:   ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    default:  'gpt-4o-mini',
    async call({ model, messages, signal }) {
      const key = _keys.openai;
      if (!key) throw new Error('No OpenAI key');
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: model || this.default, messages, max_tokens: 140, temperature: 0.88, presence_penalty: 0.3, frequency_penalty: 0.45 }),
        signal
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}`);
      const d = await res.json();
      return d?.choices?.[0]?.message?.content?.trim();
    }
  },

  ollama: {
    label:    'Ollama (Local)',
    keyLabel: 'Ollama Base URL',
    keyHint:  'http://localhost:11434',
    models:   ['llama3', 'llama3.2', 'mistral', 'gemma3', 'phi3', 'qwen2.5', 'deepseek-r1'],
    default:  'llama3',
    async call({ model, messages, signal }) {
      const base = (_keys.ollama || 'http://localhost:11434').replace(/\/$/, '');
      // Convert to Ollama chat format
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:    model || this.default,
          messages,
          stream:   false,
          options:  { temperature: 0.88, num_predict: 140 }
        }),
        signal
      });
      if (!res.ok) throw new Error(`Ollama ${res.status} — is Ollama running?`);
      const d = await res.json();
      return d?.message?.content?.trim();
    }
  },

  openrouter: {
    label:    'OpenRouter (Open Source)',
    keyLabel: 'OpenRouter API Key',
    keyHint:  'sk-or-…',
    models:   [
      'mistralai/mistral-7b-instruct',
      'meta-llama/llama-3-8b-instruct',
      'meta-llama/llama-3-70b-instruct',
      'google/gemma-3-27b-it',
      'microsoft/phi-3-mini-128k-instruct',
      'nousresearch/nous-hermes-2-mixtral-8x7b-dpo',
      'openchat/openchat-7b',
      'gryphe/mythomax-l2-13b'
    ],
    default: 'mistralai/mistral-7b-instruct',
    async call({ model, messages, signal }) {
      const key = _keys.openrouter;
      if (!key) throw new Error('No OpenRouter key');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'IMMORTAIL'
        },
        body: JSON.stringify({ model: model || this.default, messages, max_tokens: 140, temperature: 0.88 }),
        signal
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
      const d = await res.json();
      return d?.choices?.[0]?.message?.content?.trim();
    }
  },

  groq: {
    label:    'Groq (Fast Open Source)',
    keyLabel: 'Groq API Key',
    keyHint:  'gsk_…',
    models:   ['llama3-8b-8192', 'llama3-70b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    default:  'llama3-8b-8192',
    async call({ model, messages, signal }) {
      const key = _keys.groq;
      if (!key) throw new Error('No Groq key');
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: model || this.default, messages, max_tokens: 140, temperature: 0.88 }),
        signal
      });
      if (!res.ok) throw new Error(`Groq ${res.status}`);
      const d = await res.json();
      return d?.choices?.[0]?.message?.content?.trim();
    }
  }
};

// Fallback chain order when primary fails
const FALLBACK_CHAIN = ['openai', 'groq', 'openrouter', 'ollama'];

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
let _keys = {
  openai:      null,
  ollama:      null,  // stores base URL, not a key
  openrouter:  null,
  groq:        null
};
let _selectedProvider = 'openai';
let _selectedModel    = null;   // null = use provider default
let _busy             = false;

const CONTEXT_LIMIT = 18;
const TIMEOUT_MS    = 16_000;

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK DOG RESPONSES
// ═══════════════════════════════════════════════════════════════════════════
const FALLBACKS = {
  idle:    ['*tilts head and watches you curiously*', '*sniffs the air and wags tail slowly*', '*blinks and rests chin on paws*', '*lets out a soft sigh and looks up at you*'],
  happy:   ['*spins around and barks happily!*', '*jumps up and licks your face*', '*tail going absolutely wild right now*', '*does a little happy zoom around the room*'],
  sad:     ['*whimpers softly and nuzzles close*', '*lets out a small whine*', '*ears down, tail low, big sad eyes*', '*curls up quietly nearby*'],
  excited: ['*ZOOMS across the room barking!*', '*bounces up and down, can barely contain it!*', '*spins in circles!*', '*grabs favourite toy and presents it proudly!*']
};

function getFallback(expression = 'idle') {
  const pool = FALLBACKS[expression] || FALLBACKS.idle;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT BUILDERS
// ═══════════════════════════════════════════════════════════════════════════
function buildSystem(state) {
  const moodDesc = {
    idle:    'calm and relaxed — gentle, attentive, curious',
    happy:   'joyful and affectionate — warm, enthusiastic, loving',
    sad:     'tired and low — quiet, subdued, seeking comfort',
    excited: 'bursting with energy — playful, bouncy, enthusiastic'
  };
  const bondDesc = state.bond > 75 ? 'You love your owner deeply and show it constantly.'
                 : state.bond > 40 ? 'You like your owner and are generally happy with them.'
                 :                   'You are still warming up to your owner.';
  return `You are ${state.name || 'Rex'}, a loyal AI dog companion. You think and respond like a dog.

State: expression=${state.expression} (${moodDesc[state.expression] || 'calm'}), energy=${Math.round(state.energy)}/100${state.energy < 25 ? ' (exhausted)' : ''}, bond=${Math.round(state.bond)}/100.
${bondDesc}

Rules:
- Stay in character as a DOG always. Never mention AI or technology.
- Keep replies SHORT — 1 to 3 sentences max.
- Use dog actions sparingly: *wags tail*, *tilts head*, *perks ears*.
- Reflect your current expression in every response.
- If energy < 20, sound genuinely exhausted.`;
}

function buildMessages(userMsg, state, memories) {
  const msgs = [{ role: 'system', content: buildSystem(state) }];
  if (memories?.length) {
    const ctx = memories.slice(-CONTEXT_LIMIT)
      .map(m => `${m.role === 'user' ? 'Owner' : (state.name || 'Rex')}: ${m.content}`)
      .join('\n');
    msgs.push({ role: 'system', content: `Recent conversation:\n${ctx}` });
  }
  msgs.push({ role: 'user', content: userMsg });
  return msgs;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE ASK — tries selected provider, falls back down the chain
// ═══════════════════════════════════════════════════════════════════════════
async function ask(userMsg, state, memories) {
  if (_busy) return null;

  // Check if any provider is configured
  const hasAny = _keys.openai || _keys.openrouter || _keys.groq || _selectedProvider === 'ollama';
  if (!hasAny) return getFallback(state?.expression);

  _busy = true;
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const messages   = buildMessages(userMsg, state, memories);

  // Build attempt order: selected first, then fallbacks
  const order = [_selectedProvider, ...FALLBACK_CHAIN.filter(p => p !== _selectedProvider)];

  let lastErr = null;
  for (const provId of order) {
    const prov = PROVIDERS[provId];
    if (!prov) continue;

    // Skip providers with no credentials (except ollama which uses a URL)
    if (provId !== 'ollama' && !_keys[provId]) continue;

    try {
      const model  = provId === _selectedProvider ? _selectedModel : null;
      const result = await prov.call({ model, messages, signal: controller.signal });
      clearTimeout(timer);
      _busy = false;
      if (result) return result;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') break; // timeout — don't try more
      console.warn(`[AI] ${provId} failed:`, e.message, '— trying next provider');
    }
  }

  clearTimeout(timer);
  _busy = false;
  if (lastErr) console.error('[AI] All providers failed:', lastErr.message);
  return getFallback(state?.expression);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG API
// ═══════════════════════════════════════════════════════════════════════════
function setKey(provider, value) {
  if (PROVIDERS[provider]) {
    _keys[provider] = value?.trim() || null;
  }
}

function setProvider(provider, model) {
  if (PROVIDERS[provider]) {
    _selectedProvider = provider;
    _selectedModel    = model || null;
  }
}

function getProvider()  { return _selectedProvider; }
function getModel()     { return _selectedModel || PROVIDERS[_selectedProvider]?.default; }
function isBusy()       { return _busy; }
function getProviders() { return PROVIDERS; }

// Legacy compat
function setApiKey(key) { setKey('openai', key); }

// ── Persist config to localStorage ────────────────────────────────────────
function saveConfig() {
  try {
    localStorage.setItem('immortail_ai_config', JSON.stringify({
      provider: _selectedProvider,
      model:    _selectedModel,
      keys:     _keys
    }));
  } catch(e) {}
}

function loadConfig() {
  try {
    const raw = localStorage.getItem('immortail_ai_config');
    if (!raw) {
      // Legacy: migrate old single key
      const oldKey = localStorage.getItem('immortail_api_key');
      if (oldKey) { _keys.openai = oldKey; }
      return;
    }
    const cfg = JSON.parse(raw);
    if (cfg.provider && PROVIDERS[cfg.provider]) _selectedProvider = cfg.provider;
    if (cfg.model)   _selectedModel = cfg.model;
    if (cfg.keys)    Object.assign(_keys, cfg.keys);
  } catch(e) {}
}

// Check if Ollama is reachable
async function pingOllama(baseUrl) {
  const url = (baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, models: [] };
    const d = await res.json();
    return { ok: true, models: (d.models || []).map(m => m.name) };
  } catch (e) {
    return { ok: false, models: [], error: e.message };
  }
}

loadConfig(); // run on script load

window.AI = {
  ask, getFallback, isBusy,
  setKey, setProvider, saveConfig, loadConfig,
  getProvider, getModel, getProviders,
  setApiKey, // legacy
  pingOllama
};
