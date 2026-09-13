// Real AI Gateway - connects to actual LLM providers

import { nativeToolCall } from './NativeToolCallingGateway';

export interface AIProvider {
  id: string;
  name: string;
  type: 'online' | 'offline';
  endpoint: string;
  api\u004Key?: string;
  model: string;
  folderId?: string;
  enabled: boolean;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }
export interface AIResponse { content: string; provider: string; model: string; toolCalls?: StructuredToolCall[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; }; }
export interface StructuredToolCall { tool: string; arguments: Record<string, any>; requestId: string; timestamp: number; }

class AIGateway {
  private providers: Map<string, AIProvider> = new Map();
  private activeProvider: string | null = null;
  constructor() { this.loadFromStorage(); }
  private loadFromStorage() {
    const stored = localStorage.getItem('svetlana_ai_providers');
    if (!stored) return;
    try { JSON.parse(stored).forEach((p: AIProvider) => { this.providers.set(p.id, p); if (p.enabled && !this.activeProvider) this.activeProvider = p.id; }); }
    catch (e) { console.error('Failed to load AI providers:', e); }
  }
  private saveToStorage() { localStorage.setItem('svetlana_ai_providers', JSON.stringify(Array.from(this.providers.values()))); }
  addProvider(provider: AIProvider) { this.providers.set(provider.id, provider); if (provider.enabled) this.activeProvider = provider.id; this.saveToStorage(); }
  removeProvider(id: string) { this.providers.delete(id); if (this.activeProvider === id) { this.activeProvider = null; for (const [pid, p] of this.providers) if (p.enabled) { this.activeProvider = pid; break; } } this.saveToStorage(); }
  updateProvider(id: string, updates: Partial<AIProvider>) { const provider = this.providers.get(id); if (provider) { Object.assign(provider, updates); if (updates.enabled) this.activeProvider = id; this.saveToStorage(); } }
  getProvider(id: string): AIProvider | undefined { return this.providers.get(id); }
  getAllProviders(): AIProvider[] { return Array.from(this.providers.values()); }
  getActiveProvider(): AIProvider | undefined { return this.activeProvider ? this.providers.get(this.activeProvider) : undefined; }
  setActiveProvider(id: string) { const provider = this.providers.get(id); if (provider && provider.enabled) { this.activeProvider = id; this.saveToStorage(); } }

  async chat(messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }, providerId?: string): Promise<AIResponse> {
    const provider = providerId ? this.providers.get(providerId) : this.getActiveProvider();
    if (!provider) throw new Error('No AI provider configured');
    try { return await this.callProvider(provider, messages, options); }
    catch (error) {
      if (!providerId && this.providers.size > 1) for (const fallback of this.getFallbackProviders(provider.id)) {
        try { return await this.callProvider(fallback, messages, options); } catch (fallbackError) { console.error(`Fallback ${fallback.name} failed:`, fallbackError); }
      }
      throw error;
    }
  }

  private async callProvider(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    switch (provider.id) {
      case 'openai': return this.callOpenAI(provider, messages, options);
      case 'anthropic': return this.callAnthropic(provider, messages, options);
      case 'google': return this.callGoogle(provider, messages, options);
      case 'mistral': return this.callMistral(provider, messages, options);
      case 'groq': return this.callGroq(provider, messages, options);
      case 'openrouter': return this.callOpenRouter(provider, messages, options);
      case 'deepseek': return this.callDeepSeek(provider, messages, options);
      case 'yandex': return this.callYandex(provider, messages, options);
      case 'ollama': return this.callOllama(provider, messages, options);
      case 'lmstudio': return this.callLMStudio(provider, messages, options);
      default: throw new Error(`Provider ${provider.id} not implemented`);
    }
  }

  private getFallbackProviders(excludeId: string): AIProvider[] {
    const order = ['openai', 'anthropic', 'groq', 'openrouter', 'deepseek', 'yandex', 'ollama'];
    return order.filter(id => id !== excludeId && this.providers.has(id)).map(id => this.providers.get(id)!).filter(p => p.enabled);
  }

  private async callOpenAI(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${provider.api\u004Key}`}, body:JSON.stringify({model:provider.model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096}) });
    if (!response.ok) { const error=await response.json(); throw new Error(`OpenAI API error: ${error.error?.message||response.statusText}`); }
    const data=await response.json(); return {content:data.choices[0].message.content,provider:provider.name,model:provider.model,usage:data.usage};
  }
  private async callAnthropic(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const systemMessage=messages.find(m=>m.role==='system'); const chatMessages=messages.filter(m=>m.role!=='system');
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':provider.api\u004Key!,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:provider.model,max_tokens:options?.max_tokens??4096,system:systemMessage?.content,messages:chatMessages,temperature:options?.temperature??0.7})});
    if(!response.ok){const error=await response.json();throw new Error(`Anthropic API error: ${error.error?.message||response.statusText}`);} const data=await response.json(); return {content:data.content[0].text,provider:provider.name,model:provider.model,usage:data.usage};
  }
  private async callGroq(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${provider.api\u004Key}`},body:JSON.stringify({model:provider.model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096})}); if(!response.ok){const error=await response.json();throw new Error(`Groq API error: ${error.error?.message||response.statusText}`);} const data=await response.json(); return {content:data.choices[0].message.content,provider:provider.name,model:provider.model,usage:data.usage};
  }
  private async callOpenRouter(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${provider.api\u004Key}`},body:JSON.stringify({model:provider.model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096})}); if(!response.ok){const error=await response.json();throw new Error(`OpenRouter API error: ${error.error?.message||response.statusText}`);} const data=await response.json(); return {content:data.choices[0].message.content,provider:provider.name,model:provider.model,usage:data.usage};
  }
  private async callDeepSeek(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    const response=await fetch('https://api.deepseek.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${provider.api\u004Key}`},body:JSON.stringify({model:provider.model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096})}); if(!response.ok){const error=await response.json();throw new Error(`DeepSeek API error: ${error.error?.message||response.statusText}`);} const data=await response.json(); return {content:data.choices[0].message.content,provider:provider.name,model:provider.model,usage:data.usage};
  }
  private async callYandex(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> {
    if(!provider.api\u004Key) throw new Error('Yandex API key is required');
    if(!provider.folderId && !provider.model.startsWith('gpt://')) throw new Error('Yandex folder ID is required');
    const endpoint=(provider.endpoint||'https://ai.api.cloud.yandex.net/v1').replace(/\/$/,'');
    const model=provider.model.startsWith('gpt://')?provider.model:`gpt://${provider.folderId}/${provider.model||'aliceai-llm-flash'}`;
    const response=await fetch(`${endpoint}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Api-Key ${provider.api\u004Key}`},body:JSON.stringify({model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096})});
    if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(`Yandex API error: ${error.error?.message||response.statusText}`);} const data=await response.json(); return {content:data.choices?.[0]?.message?.content||'',provider:provider.name,model,usage:data.usage};
  }
  private async callOllama(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> { const response=await fetch(`${provider.endpoint}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:provider.model,messages,stream:false,options:{temperature:options?.temperature??0.7}})}); if(!response.ok)throw new Error(`Ollama API error: ${response.statusText}`); const data=await response.json(); return {content:data.message.content,provider:provider.name,model:provider.model}; }
  private async callGoogle(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> { const systemMessage=messages.find(m=>m.role==='system'); const chatMessages=messages.filter(m=>m.role!=='system'); const contents=chatMessages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})); const response=await fetch(`${provider.endpoint}/models/${provider.model}:generateContent?key=${provider.api\u004Key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents,systemInstruction:systemMessage?{parts:[{text:systemMessage.content}]}:undefined,generationConfig:{temperature:options?.temperature??0.7,maxOutputTokens:options?.max_tokens}})}); if(!response.ok){const error=await response.json();throw new Error(`Google API error: ${error.error?.message||response.statusText}`);} const data=await response.json(); return {content:data.candidates[0].content.parts[0].text,provider:provider.name,model:provider.model,usage:data.usageMetadata?{prompt_tokens:data.usageMetadata.promptTokenCount,completion_tokens:data.usageMetadata.candidatesTokenCount,total_tokens:data.usageMetadata.totalTokenCount}:undefined}; }
  private async callMistral(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> { const response=await fetch(`${provider.endpoint}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${provider.api\u004Key}`},body:JSON.stringify({model:provider.model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096})}); if(!response.ok){const error=await response.json();throw new Error(`Mistral API error: ${error.message||response.statusText}`);} const data=await response.json(); return {content:data.choices[0].message.content,provider:provider.name,model:provider.model,usage:data.usage}; }
  private async callLMStudio(provider: AIProvider, messages: ChatMessage[], options?: any): Promise<AIResponse> { const response=await fetch(`${provider.endpoint}/v1/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:provider.model,messages,temperature:options?.temperature??0.7,max_tokens:options?.max_tokens??4096})}); if(!response.ok)throw new Error(`LM Studio API error: ${response.status} ${response.statusText}`); const data=await response.json(); return {content:data.choices[0].message.content,provider:provider.name,model:provider.model,usage:data.usage}; }

  async testConnection(providerId: string): Promise<boolean> { const provider=this.providers.get(providerId); if(!provider)return false; try{await this.chat([{role:'user',content:'Hello'}],undefined,providerId);return true;}catch(error){console.error(`Connection test failed for ${providerId}:`,error);return false;} }

  async chatWithTools(messages: ChatMessage[], tools: object[], options?: {temperature?:number;max_tokens?:number}, providerId?: string): Promise<AIResponse> {
    const provider=providerId?this.providers.get(providerId):this.getActiveProvider(); if(!provider)throw new Error('No AI provider configured');
    const nativeProviders=new Set(['openai','anthropic','google','mistral','groq','openrouter','deepseek','yandex','ollama','lmstudio']);
    if(nativeProviders.has(provider.id)) return nativeToolCall(provider,messages,tools,options);
    const response=await this.chat(messages,options,providerId); return {...response,toolCalls:this.extractToolCalls(response.content)};
  }
  private extractToolCalls(content: string): StructuredToolCall[] { const toolCalls:StructuredToolCall[]=[]; const jsonMatches=content.match(/```json\s*([\s\S]*?)\s*```/g); if(jsonMatches)for(const match of jsonMatches){try{const json=JSON.parse(match.replace(/```json\s*|\s*```/g,'')); if(json.tool&&json.arguments)toolCalls.push({tool:json.tool,arguments:json.arguments,requestId:`tc_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,timestamp:Date.now()});}catch{/* ignore invalid JSON */}} return toolCalls; }
}

export const aiGateway=new AIGateway();
