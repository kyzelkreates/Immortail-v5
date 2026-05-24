// IMMORTAIL™ AI v6
// 11 providers — all config in IndexedDB, auto-fallback chain
// Default: Ollama (local, no key needed) → Groq (free) → OpenRouter (free) → rest

const PROVIDERS = {

  ollama: {
    label:'Ollama', sublabel:'Local · No internet · Free',
    tier:'local', keyLabel:'Server URL', keyHint:'http://localhost:11434',
    models:['llama3','llama3.2','llama3.1','mistral','gemma3','phi3','phi4',
            'qwen2.5','deepseek-r1','llava','codellama','orca-mini'],
    default:'llama3',
    async call({model,messages,signal}){
      const base=(_keys.ollama||'http://localhost:11434').replace(/\/$/,'');
      const res=await fetch(`${base}/api/chat`,{
        method:'POST',signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:model||this.default,messages,stream:false,
          options:{temperature:0.88,num_predict:150}})
      });
      if(!res.ok) throw new Error(`Ollama ${res.status} — is Ollama running at ${base}?`);
      return (await res.json())?.message?.content?.trim();
    }
  },

  groq: {
    label:'Groq', sublabel:'Fast · Free tier',
    tier:'free', keyLabel:'API Key', keyHint:'gsk_…',
    link:'https://console.groq.com/keys',
    models:['llama3-8b-8192','llama3-70b-8192','llama-3.1-8b-instant',
            'llama-3.3-70b-versatile','mixtral-8x7b-32768','gemma2-9b-it'],
    default:'llama3-8b-8192',
    async call({model,messages,signal}){
      _req('groq');
      return _oai('https://api.groq.com/openai/v1/chat/completions',
        _keys.groq,model||this.default,messages,signal);
    }
  },

  openrouter: {
    label:'OpenRouter', sublabel:'200+ models · Free tier',
    tier:'free', keyLabel:'API Key', keyHint:'sk-or-…',
    link:'https://openrouter.ai/keys',
    models:['mistralai/mistral-7b-instruct:free','meta-llama/llama-3-8b-instruct:free',
            'google/gemma-3-27b-it:free','deepseek/deepseek-r1:free',
            'microsoft/phi-3-mini-128k-instruct:free','openchat/openchat-7b:free',
            'qwen/qwen-2-7b-instruct:free','meta-llama/llama-3-70b-instruct',
            'mistralai/mixtral-8x7b-instruct','gryphe/mythomax-l2-13b'],
    default:'mistralai/mistral-7b-instruct:free',
    async call({model,messages,signal}){
      _req('openrouter');
      const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
        method:'POST',signal,
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${_keys.openrouter}`,
          'HTTP-Referer':location.origin,'X-Title':'IMMORTAIL'},
        body:JSON.stringify({model:model||this.default,messages,max_tokens:150,temperature:0.88})
      });
      if(!res.ok) throw new Error(`OpenRouter ${res.status}`);
      return (await res.json())?.choices?.[0]?.message?.content?.trim();
    }
  },

  openai: {
    label:'OpenAI', sublabel:'GPT-4o · Paid',
    tier:'paid', keyLabel:'API Key', keyHint:'sk-…',
    link:'https://platform.openai.com/api-keys',
    models:['gpt-4o-mini','gpt-4o','gpt-4-turbo','gpt-3.5-turbo'],
    default:'gpt-4o-mini',
    async call({model,messages,signal}){
      _req('openai');
      return _oai('https://api.openai.com/v1/chat/completions',
        _keys.openai,model||this.default,messages,signal);
    }
  },

  gemini: {
    label:'Google Gemini', sublabel:'Free tier available',
    tier:'free', keyLabel:'API Key', keyHint:'AIza…',
    link:'https://aistudio.google.com/app/apikey',
    models:['gemini-1.5-flash','gemini-1.5-pro','gemini-pro'],
    default:'gemini-1.5-flash',
    async call({model,messages,signal}){
      _req('gemini');
      const m=model||this.default;
      const sys=messages.find(x=>x.role==='system')?.content||'';
      const contents=messages.filter(x=>x.role!=='system')
        .map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]}));
      const res=await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${_keys.gemini}`,
        {method:'POST',signal,headers:{'Content-Type':'application/json'},
         body:JSON.stringify({contents,systemInstruction:{parts:[{text:sys}]},
           generationConfig:{maxOutputTokens:150,temperature:0.88}})});
      if(!res.ok) throw new Error(`Gemini ${res.status}`);
      return (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    }
  },

  mistral: {
    label:'Mistral AI', sublabel:'Free tier available',
    tier:'free', keyLabel:'API Key', keyHint:'mis-…',
    link:'https://console.mistral.ai/api-keys',
    models:['mistral-small-latest','open-mistral-7b','open-mixtral-8x7b','mistral-large-latest'],
    default:'mistral-small-latest',
    async call({model,messages,signal}){
      _req('mistral');
      return _oai('https://api.mistral.ai/v1/chat/completions',
        _keys.mistral,model||this.default,messages,signal);
    }
  },

  anthropic: {
    label:'Anthropic Claude', sublabel:'Paid',
    tier:'paid', keyLabel:'API Key', keyHint:'sk-ant-…',
    link:'https://console.anthropic.com/keys',
    models:['claude-3-haiku-20240307','claude-3-5-sonnet-20241022',
            'claude-3-sonnet-20240229','claude-3-opus-20240229'],
    default:'claude-3-haiku-20240307',
    async call({model,messages,signal}){
      _req('anthropic');
      const sys=messages.find(x=>x.role==='system')?.content||'';
      const msgs=messages.filter(x=>x.role!=='system');
      const res=await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',signal,
        headers:{'Content-Type':'application/json','x-api-key':_keys.anthropic,
          'anthropic-version':'2023-06-01'},
        body:JSON.stringify({model:model||this.default,max_tokens:150,system:sys,messages:msgs})
      });
      if(!res.ok) throw new Error(`Anthropic ${res.status}`);
      return (await res.json())?.content?.[0]?.text?.trim();
    }
  },

  together: {
    label:'Together AI', sublabel:'Cheap open source',
    tier:'paid', keyLabel:'API Key', keyHint:'tog-…',
    link:'https://api.together.xyz/settings/api-keys',
    models:['meta-llama/Llama-3-8b-chat-hf','meta-llama/Llama-3-70b-chat-hf',
            'mistralai/Mixtral-8x7B-Instruct-v0.1','Qwen/Qwen2-72B-Instruct'],
    default:'meta-llama/Llama-3-8b-chat-hf',
    async call({model,messages,signal}){
      _req('together');
      return _oai('https://api.together.xyz/v1/chat/completions',
        _keys.together,model||this.default,messages,signal);
    }
  },

  cohere: {
    label:'Cohere', sublabel:'Free tier available',
    tier:'free', keyLabel:'API Key', keyHint:'co-…',
    link:'https://dashboard.cohere.com/api-keys',
    models:['command-r','command-r-plus','command-light'],
    default:'command-r',
    async call({model,messages,signal}){
      _req('cohere');
      const sys=messages.find(x=>x.role==='system')?.content||'';
      const chat=messages.filter(x=>x.role!=='system');
      const last=chat.pop();
      const res=await fetch('https://api.cohere.ai/v1/chat',{
        method:'POST',signal,
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${_keys.cohere}`},
        body:JSON.stringify({model:model||this.default,preamble:sys,
          chat_history:chat.map(m=>({role:m.role==='user'?'USER':'CHATBOT',message:m.content})),
          message:last?.content||'',max_tokens:150,temperature:0.88})
      });
      if(!res.ok) throw new Error(`Cohere ${res.status}`);
      return (await res.json())?.text?.trim();
    }
  },

  huggingface: {
    label:'HuggingFace', sublabel:'Free serverless inference',
    tier:'free', keyLabel:'API Key', keyHint:'hf_…',
    link:'https://huggingface.co/settings/tokens',
    models:['mistralai/Mistral-7B-Instruct-v0.3','meta-llama/Meta-Llama-3-8B-Instruct',
            'google/gemma-2-2b-it','HuggingFaceH4/zephyr-7b-beta','tiiuae/falcon-7b-instruct'],
    default:'mistralai/Mistral-7B-Instruct-v0.3',
    async call({model,messages,signal}){
      _req('huggingface');
      const m=model||this.default;
      return _oai(`https://api-inference.huggingface.co/models/${m}/v1/chat/completions`,
        _keys.huggingface,m,messages,signal);
    }
  },

  perplexity: {
    label:'Perplexity', sublabel:'Paid',
    tier:'paid', keyLabel:'API Key', keyHint:'pplx-…',
    link:'https://www.perplexity.ai/settings/api',
    models:['llama-3.1-sonar-small-128k-chat','llama-3.1-sonar-large-128k-chat',
            'llama-3.1-8b-instruct','llama-3.1-70b-instruct'],
    default:'llama-3.1-sonar-small-128k-chat',
    async call({model,messages,signal}){
      _req('perplexity');
      return _oai('https://api.perplexity.ai/chat/completions',
        _keys.perplexity,model||this.default,messages,signal);
    }
  }
};

// ── Shared helpers ─────────────────────────────────────────────────────────
async function _oai(url,key,model,messages,signal){
  const res=await fetch(url,{method:'POST',signal,
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
    body:JSON.stringify({model,messages,max_tokens:150,temperature:0.88})});
  if(!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json())?.choices?.[0]?.message?.content?.trim();
}
function _req(p){ if(!_keys[p]) throw new Error(`No ${p} key`); }

// ── State ──────────────────────────────────────────────────────────────────
// Default key slots for all providers
let _keys = Object.fromEntries(Object.keys(PROVIDERS).map(k=>[k,null]));
_keys.ollama = 'http://localhost:11434'; // default Ollama URL, not a secret

// Fallback chain — local first, then free, then paid
const FALLBACK_CHAIN = ['ollama','groq','openrouter','mistral','gemini','huggingface',
                        'openai','anthropic','together','cohere','perplexity'];
const TIMEOUT_MS     = 18_000;
const CONTEXT_LIMIT  = 20;

let _selectedProvider = 'ollama';
let _selectedModel    = null;
let _busy             = false;
let _configLoaded     = false;

// ── Dog persona ────────────────────────────────────────────────────────────
const FALLBACKS = {
  idle:    ['*tilts head and watches you curiously*','*sniffs the air, tail swaying slowly*',
            '*blinks and rests chin on paws*','*lets out a soft sigh and looks up at you*'],
  happy:   ['*spins around and barks happily!*','*jumps up and licks your face*',
            '*tail going absolutely wild!*','*does a happy zoom around the room*'],
  sad:     ['*whimpers softly and nuzzles close*','*lets out a small whine*',
            '*ears down, tail low, big sad eyes*','*curls up quietly nearby*'],
  excited: ['*ZOOMS barking!*','*bounces, barely containable!*',
            '*spins in circles!*','*grabs toy and shows off!*']
};
function getFallback(expr='idle'){
  const p=FALLBACKS[expr]||FALLBACKS.idle;
  return p[Math.floor(Math.random()*p.length)];
}

function buildSystem(state){
  const moods={idle:'calm and relaxed',happy:'joyful and affectionate',
    sad:'tired and low energy',excited:'bursting with energy and playful'};
  const bond=state.bond>75?'You adore your owner completely.':
    state.bond>40?'You like your owner and are warming up.':
    'You are still getting to know your owner.';
  return `You are ${state.name||'Rex'}, a loyal AI dog companion. Think and respond EXACTLY like a dog.
Mood: ${state.expression} (${moods[state.expression]||'calm'}). Energy: ${Math.round(state.energy)}/100${state.energy<20?' — EXHAUSTED':''}.
Bond: ${Math.round(state.bond)}/100. ${bond}
Rules: Stay in character as a DOG always. Never mention AI. Replies 1-3 sentences max. Use *dog actions* occasionally.`;
}

function buildMessages(userMsg,state,memories){
  const msgs=[{role:'system',content:buildSystem(state)}];
  if(memories?.length){
    const ctx=memories.slice(-CONTEXT_LIMIT)
      .map(m=>`${m.role==='user'?'Owner':(state.name||'Rex')}: ${m.content}`).join('\n');
    msgs.push({role:'system',content:`Recent conversation:\n${ctx}`});
  }
  msgs.push({role:'user',content:userMsg});
  return msgs;
}

// ── Ask — primary then fallback chain ─────────────────────────────────────
async function ask(userMsg,state,memories){
  if(_busy) return null;
  if(!_configLoaded) await loadConfig();
  const hasAny=Object.entries(_keys).some(([k,v])=>k==='ollama'?true:!!v)||_selectedProvider==='ollama';
  if(!hasAny) return getFallback(state?.expression);

  _busy=true;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),TIMEOUT_MS);
  const messages=buildMessages(userMsg,state,memories);
  const order=[_selectedProvider,...FALLBACK_CHAIN.filter(p=>p!==_selectedProvider)];

  for(const id of order){
    const prov=PROVIDERS[id];
    if(!prov) continue;
    if(id!=='ollama'&&!_keys[id]) continue;
    try{
      const model=id===_selectedProvider?_selectedModel:null;
      const result=await prov.call({model,messages,signal:ctrl.signal});
      clearTimeout(timer); _busy=false;
      if(result) return result;
    }catch(e){
      if(e.name==='AbortError') break;
      console.warn(`[AI] ${id} failed:`,e.message);
    }
  }
  clearTimeout(timer); _busy=false;
  return getFallback(state?.expression);
}

// ── Config ─────────────────────────────────────────────────────────────────
function setKey(provider,value){ if(PROVIDERS[provider]) _keys[provider]=value?.trim()||null; }
function setProvider(provider,model){ if(PROVIDERS[provider]){ _selectedProvider=provider; _selectedModel=model||null; } }

async function saveConfig(){
  await window.Storage?.saveAIConfig?.({provider:_selectedProvider,model:_selectedModel,keys:_keys});
}

async function loadConfig(){
  _configLoaded=true;
  try{
    const cfg=await window.Storage?.loadAIConfig?.();
    if(!cfg){ _migrateLegacy(); return; }
    if(cfg.provider&&PROVIDERS[cfg.provider]) _selectedProvider=cfg.provider;
    if(cfg.model) _selectedModel=cfg.model;
    if(cfg.keys) Object.assign(_keys,cfg.keys);
  }catch(e){ console.warn('[AI] Config load:',e.message); }
}

function _migrateLegacy(){
  try{
    const raw=localStorage.getItem('immortail_ai_config');
    if(raw){
      const cfg=JSON.parse(raw);
      if(cfg.provider&&PROVIDERS[cfg.provider]) _selectedProvider=cfg.provider;
      if(cfg.model) _selectedModel=cfg.model;
      if(cfg.keys) Object.assign(_keys,cfg.keys);
      saveConfig().then(()=>{ localStorage.removeItem('immortail_ai_config'); localStorage.removeItem('immortail_api_key'); });
    }
  }catch(_){}
}

async function pingOllama(baseUrl){
  const url=(baseUrl||'http://localhost:11434').replace(/\/$/,'');
  try{
    const res=await fetch(`${url}/api/tags`,{signal:AbortSignal.timeout(3000)});
    if(!res.ok) return {ok:false,models:[]};
    const d=await res.json();
    return {ok:true,models:(d.models||[]).map(m=>m.name)};
  }catch(e){ return {ok:false,models:[],error:e.message}; }
}

function getProvider(){ return _selectedProvider; }
function getModel(){ return _selectedModel||PROVIDERS[_selectedProvider]?.default; }
function isBusy(){ return _busy; }
function getProviders(){ return PROVIDERS; }
function setApiKey(key){ setKey('openai',key); } // legacy

window.AI={ask,getFallback,isBusy,setKey,setProvider,saveConfig,loadConfig,
  getProvider,getModel,getProviders,pingOllama,setApiKey};
