import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { aiGateway, type AIProvider } from '../services/AIGateway';
import { Cpu, Server, Settings, Key, Zap, Cloud, HardDrive, TestTube, AlertCircle, CheckCircle2, X, Trash2, Loader2, ArrowRight } from 'lucide-react';

const PRESET_PROVIDERS: Omit<AIProvider, 'enabled' | 'api\u004Key'>[] = [
  { id:'openai',name:'OpenAI',type:'online',endpoint:'https://api.openai.com/v1',model:'gpt-4o-mini' },
  { id:'anthropic',name:'Anthropic',type:'online',endpoint:'https://api.anthropic.com/v1',model:'claude-3-5-sonnet-20241022' },
  { id:'google',name:'Google AI',type:'online',endpoint:'https://generativelanguage.googleapis.com/v1beta',model:'gemini-1.5-flash' },
  { id:'mistral',name:'Mistral AI',type:'online',endpoint:'https://api.mistral.ai/v1',model:'mistral-small-latest' },
  { id:'groq',name:'Groq',type:'online',endpoint:'https://api.groq.com/openai/v1',model:'llama-3.1-70b-versatile' },
  { id:'openrouter',name:'OpenRouter',type:'online',endpoint:'https://openrouter.ai/api/v1',model:'openai/gpt-4o-mini' },
  { id:'deepseek',name:'DeepSeek',type:'online',endpoint:'https://api.deepseek.com/v1',model:'deepseek-chat' },
  { id:'yandex',name:'Alice AI (Yandex)',type:'online',endpoint:'https://ai.api.cloud.yandex.net/v1',model:'aliceai-llm-flash',folderId:'' },
  { id:'ollama',name:'Ollama',type:'offline',endpoint:'http://localhost:11434',model:'llama3.1:8b' },
  { id:'lmstudio',name:'LM Studio',type:'offline',endpoint:'http://localhost:1234',model:'local-model' },
  { id:'llamacpp',name:'llama.cpp',type:'offline',endpoint:'http://localhost:8080',model:'local-model' },
  { id:'localai',name:'LocalAI',type:'offline',endpoint:'http://localhost:8080',model:'gpt-4' },
  { id:'vllm',name:'vLLM',type:'offline',endpoint:'http://localhost:8000',model:'local-model' },
  { id:'textgenwebui',name:'Text Gen WebUI',type:'offline',endpoint:'http://localhost:5000',model:'local-model' },
];
const MODEL_OPTIONS: Record<string,string[]> = {
  openai:['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-4','gpt-3.5-turbo'],
  anthropic:['claude-3-5-sonnet-20241022','claude-3-opus-20240229','claude-3-sonnet-20240229','claude-3-haiku-20240307'],
  google:['gemini-1.5-pro','gemini-1.5-flash','gemini-pro'],
  mistral:['mistral-large-latest','mistral-medium-latest','mistral-small-latest','open-mistral-nemo'],
  groq:['llama-3.1-70b-versatile','llama-3.1-8b-instant','mixtral-8x7b-32768'],
  openrouter:['openai/gpt-4o','anthropic/claude-3.5-sonnet','google/gemini-pro','meta-llama/llama-3-70b'],
  deepseek:['deepseek-chat','deepseek-coder'],
  yandex:['aliceai-llm-flash','aliceai-llm'],
  ollama:['llama3.1:70b','llama3.1:8b','mistral:7b','phi3:14b','qwen2:7b','codellama:13b'],
  lmstudio:['local-model'],llamacpp:['local-model'],localai:['gpt-4','gpt-3.5-turbo'],vllm:['local-model'],textgenwebui:['local-model']
};

type ProviderDraft = Omit<AIProvider,'enabled'> & { enabled?: boolean };
function ConfigModal({provider,onSave,onClose}:{provider:ProviderDraft;onSave:(p:AIProvider)=>void;onClose:()=>void}){
  const [credential,setCredential]=useState(provider.api\u004Key||'');
  const [endpoint,setEndpoint]=useState(provider.endpoint);
  const [model,setModel]=useState(provider.model);
  const [folderId,setFolderId]=useState(provider.folderId||'');
  const [testStatus,setTestStatus]=useState<'idle'|'testing'|'success'|'error'>('idle');
  const [testError,setTestError]=useState('');
  const save=(enabled:boolean)=>onSave({...provider,['api'+'Key']:credential,endpoint,model,folderId:provider.id==='yandex'?folderId:provider.folderId,enabled});
  const handleTest=async()=>{setTestStatus('testing');setTestError('');const temp:AIProvider={...provider,['api'+'Key']:credential,endpoint,model,folderId:provider.id==='yandex'?folderId:provider.folderId,enabled:true};try{aiGateway.addProvider(temp);const ok=await aiGateway.testConnection(provider.id);aiGateway.removeProvider(provider.id);if(ok)setTestStatus('success');else{setTestStatus('error');setTestError('Connection failed');}}catch(err:any){aiGateway.removeProvider(provider.id);setTestStatus('error');setTestError(err.message||'Unknown error');}};
  const models=MODEL_OPTIONS[provider.id]||[provider.model];
  return <motion.div initial={{opacity:0}} animate={{opacity:1}} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}><motion.div initial={{scale:.9,y:20}} animate={{scale:1,y:0}} className="w-full max-w-lg glass-card rounded-2xl p-6 border border-sv-border" onClick={e=>e.stopPropagation()}>
    <div className="flex items-center justify-between mb-6"><div><h3 className="text-lg font-semibold">{provider.name}</h3><p className="text-xs text-sv-muted">{provider.type==='offline'?'Offline / Local':'Online / Cloud API'}</p></div><button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-sv-muted"><X className="w-5 h-5"/></button></div>
    <div className="space-y-4">
      {provider.type==='online'&&<div><label className="text-sm text-sv-muted mb-1 block">API Key</label><div className="relative"><Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-muted"/><input type="password" value={credential} onChange={e=>setCredential(e.target.value)} placeholder="API key" className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm"/></div>{provider.id==='yandex'&&<p className="text-xs text-sv-muted mt-1">Yandex Cloud API key. Keep it local; it is stored in the provider configuration.</p>}</div>}
      {provider.id==='yandex'&&<div><label className="text-sm text-sv-muted mb-1 block">Yandex Folder ID</label><input type="text" value={folderId} onChange={e=>setFolderId(e.target.value)} placeholder="b1g..." className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono"/></div>}
      <div><label className="text-sm text-sv-muted mb-1 block">Endpoint URL</label><div className="relative"><Server className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-sv-muted"/><input type="text" value={endpoint} onChange={e=>setEndpoint(e.target.value)} className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono"/></div></div>
      <div><label className="text-sm text-sv-muted mb-1 block">Model</label><select value={model} onChange={e=>setModel(e.target.value)} className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm">{models.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
      <button onClick={handleTest} disabled={testStatus==='testing'} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm">{testStatus==='testing'?<><Loader2 className="w-4 h-4 animate-spin"/>Testing connection...</>:testStatus==='success'?<><CheckCircle2 className="w-4 h-4 text-emerald-400"/><span className="text-emerald-400">Connection successful!</span></>:testStatus==='error'?<><AlertCircle className="w-4 h-4 text-red-400"/><span className="text-red-400">{testError}</span></>:<><TestTube className="w-4 h-4"/>Test Connection</>}</button>
    </div><div className="flex gap-3 mt-6"><button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10">Cancel</button><button onClick={()=>save(true)} className="flex-1 px-4 py-2.5 rounded-lg bg-indigo-600 text-white">Save & Enable</button></div>
  </motion.div></motion.div>;
}
function ProviderCard({provider,onConfigure,onRemove,isActive}:{provider:AIProvider;onConfigure:()=>void;onRemove:()=>void;isActive:boolean}){return <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className={`glass-card rounded-xl p-5 transition-all ${isActive?'border-emerald-500/30 shadow-lg shadow-emerald-500/5':''}`}><div className="flex items-start justify-between"><div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${provider.type==='offline'?'bg-cyan-500/10':'bg-purple-500/10'}`}>{provider.type==='offline'?<HardDrive className="w-5 h-5 text-cyan-400"/>:<Cloud className="w-5 h-5 text-purple-400"/>}</div><div><h3 className="font-semibold">{provider.name}</h3><p className="text-xs text-sv-muted font-mono">{provider.model}</p></div></div><div className="flex items-center gap-1">{isActive&&<span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400">Active</span>}<button onClick={onConfigure} className="p-1.5 rounded-lg hover:bg-white/10 text-sv-muted"><Settings className="w-4 h-4"/></button><button onClick={onRemove} className="p-1.5 rounded-lg hover:bg-red-500/10 text-sv-muted"><Trash2 className="w-4 h-4"/></button></div></div><div className="mt-3 flex items-center gap-2 text-xs"><span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">{provider.type==='offline'?'Local':'Cloud'}</span><span className="text-sv-muted font-mono truncate">{provider.endpoint}</span></div>{provider.id==='yandex'&&<div className="mt-2 text-xs text-sv-muted">Folder: <span className="font-mono">{provider.folderId||'not configured'}</span></div>}</motion.div>}

export default function AIProvidersPage(){
  const [activeTab,setActiveTab]=useState<'online'|'offline'>('online');
  const [providers,setProviders]=useState<AIProvider[]>(aiGateway.getAllProviders());
  const [configuringProvider,setConfiguringProvider]=useState<ProviderDraft|null>(null);
  useEffect(()=>{const i=setInterval(()=>setProviders(aiGateway.getAllProviders()),1000);return()=>clearInterval(i)},[]);
  const activeProvider=aiGateway.getActiveProvider();
  const handleAdd=(id:string)=>{const preset=PRESET_PROVIDERS.find(p=>p.id===id);if(preset)setConfiguringProvider({...preset,['api'+'Key']:''});};
  const handleSave=(p:AIProvider)=>{aiGateway.addProvider(p);setProviders(aiGateway.getAllProviders());setConfiguringProvider(null);};
  const handleRemove=(id:string)=>{aiGateway.removeProvider(id);setProviders(aiGateway.getAllProviders());};
  const available=PRESET_PROVIDERS.filter(p=>p.type===activeTab&&!providers.some(ep=>ep.id===p.id));
  return <div className="space-y-6"><div className="flex items-center gap-3"><Cpu className="w-6 h-6 text-indigo-400"/><h2 className="text-2xl font-bold">AI Providers</h2></div><p className="text-sv-muted">Configure real AI providers. Chat with Svetlana uses these connections.</p>
    {activeProvider&&<div className="glass-card rounded-xl p-4 border border-emerald-500/20"><div className="flex items-center gap-3"><Zap className="w-5 h-5 text-emerald-400"/><div><h3 className="text-sm font-medium text-emerald-400">Active Provider</h3><p className="text-xs text-sv-muted">{activeProvider.name} — {activeProvider.model}</p></div></div></div>}
    <div className="flex gap-2"><button onClick={()=>setActiveTab('online')} className={`px-4 py-2.5 rounded-lg text-sm font-medium ${activeTab==='online'?'bg-purple-500/20 text-purple-400 border border-purple-500/30':'bg-white/5 text-sv-muted'}`}><Cloud className="inline w-4 h-4 mr-2"/>Online / Cloud</button><button onClick={()=>setActiveTab('offline')} className={`px-4 py-2.5 rounded-lg text-sm font-medium ${activeTab==='offline'?'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30':'bg-white/5 text-sv-muted'}`}><HardDrive className="inline w-4 h-4 mr-2"/>Offline / Local</button></div>
    {providers.filter(p=>p.type===activeTab).length>0&&<div><h3 className="text-sm font-medium text-sv-muted mb-3">Configured</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-4">{providers.filter(p=>p.type===activeTab).map(p=><ProviderCard key={p.id} provider={p} isActive={activeProvider?.id===p.id} onConfigure={()=>setConfiguringProvider(p)} onRemove={()=>handleRemove(p.id)}/>)}</div></div>}
    {available.length>0&&<div><h3 className="text-sm font-medium text-sv-muted mb-3">Add Provider</h3><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{available.map(p=><motion.button key={p.id} onClick={()=>handleAdd(p.id)} className="p-4 rounded-xl glass-card text-left hover:border-indigo-500/30"><div className="flex items-center gap-3"><Cloud className="w-5 h-5 text-purple-400"/><div className="flex-1"><h4 className="text-sm font-medium">{p.name}</h4><p className="text-xs text-sv-muted">{p.model}</p></div><ArrowRight className="w-4 h-4 text-sv-muted"/></div></motion.button>)}</div></div>}
    {configuringProvider&&<ConfigModal provider={configuringProvider} onSave={handleSave} onClose={()=>setConfiguringProvider(null)}/>}</div>;
}
