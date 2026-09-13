import type { ChatMessage, AIResponse, StructuredToolCall } from './AIGateway';
type ToolDeclaration={type:'function';function:{name:string;description:string;parameters:Record<string,any>}};
const OPENAI_COMPATIBLE:Record<string,string>={openai:'https://api.openai.com/v1/chat/completions',groq:'https://api.groq.com/openai/v1/chat/completions',openrouter:'https://openrouter.ai/api/v1/chat/completions',deepseek:'https://api.deepseek.com/v1/chat/completions'};
export async function nativeToolCall(provider:{id:string;name:string;endpoint:string;apiKey?:string;model:string},messages:ChatMessage[],tools:object[],options?:{temperature?:number;max_tokens?:number}):Promise<AIResponse>{
 const t=tools as ToolDeclaration[];
 if(provider.id==='google')return googleInteractions(provider,messages,t,options);
 if(provider.id==='anthropic')return anthropic(provider,messages,t,options);
 if(provider.id==='ollama')return ollama(provider,messages,t,options);
 const url=OPENAI_COMPATIBLE[provider.id]||(provider.id==='mistral'?`${provider.endpoint}/chat/completions`:provider.id==='lmstudio'?`${provider.endpoint}/v1/chat/completions`:undefined);
 if(!url)throw new Error(`Provider ${provider.id} has no native tool-calling adapter`);
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(provider.id==='lmstudio'?{}:{Authorization:`Bearer ${provider.apiKey}`})},body:JSON.stringify({model:provider.model,messages,tools:t,tool_choice:'auto',temperature:options?.temperature??0.1,max_tokens:options?.max_tokens??2048})});
 const d=await readJson(r,provider.name),m=d.choices?.[0]?.message||{};
 return{content:m.content||'',provider:provider.name,model:provider.model,toolCalls:(m.tool_calls||[]).map((c:any)=>normalize(c.function?.name,c.function?.arguments,c.id)),usage:d.usage};
}
async function googleInteractions(p:any,m:ChatMessage[],t:ToolDeclaration[],o?:any){
 const base=(p.endpoint||'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
 const input=m.map(x=>({type:x.role==='assistant'?'model_output':'user_input',content:[{type:'text',text:x.content}]}));
 const tools=t.map(x=>({type:'function',name:x.function.name,description:x.function.description,parameters:x.function.parameters}));
 const body={model:p.model,store:false,input,tools,generation_config:{temperature:o?.temperature??0.1,max_output_tokens:o?.max_tokens??2048,tool_choice:{mode:'any'}}};
 const r=await fetch(`${base}/interactions`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':p.apiKey},body:JSON.stringify(body)});
 const d=await readJson(r,p.name); const steps=d.steps||[];
 const calls=steps.filter((s:any)=>s.type==='function_call').map((s:any)=>normalize(s.name,s.arguments,s.id));
 const text=steps.filter((s:any)=>s.type==='text'||s.type==='model_output').map((s:any)=>typeof s.text==='string'?s.text:s.content?.map((c:any)=>c.text||'').join('')||'').join('');
 return{content:text,provider:p.name,model:p.model,toolCalls:calls,usage:d.usage?{prompt_tokens:d.usage.input_tokens||0,completion_tokens:d.usage.output_tokens||0,total_tokens:(d.usage.input_tokens||0)+(d.usage.output_tokens||0)}:undefined};
}
async function anthropic(p:any,m:ChatMessage[],t:ToolDeclaration[],o?:any){const s=m.find(x=>x.role==='system'),messages=m.filter(x=>x.role!=='system');const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':p.apiKey,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:p.model,max_tokens:o?.max_tokens??2048,system:s?.content,messages,tools:t.map(x=>({name:x.function.name,description:x.function.description,input_schema:x.function.parameters})),tool_choice:{type:'auto'},temperature:o?.temperature??0.1})});const d=await readJson(r,p.name);return{content:d.content?.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('')||'',provider:p.name,model:p.model,toolCalls:(d.content||[]).filter((x:any)=>x.type==='tool_use').map((x:any)=>normalize(x.name,x.input,x.id)),usage:d.usage?{prompt_tokens:d.usage.input_tokens,completion_tokens:d.usage.output_tokens,total_tokens:(d.usage.input_tokens||0)+(d.usage.output_tokens||0)}:undefined};}
async function ollama(p:any,m:ChatMessage[],t:ToolDeclaration[],o?:any){const r=await fetch(`${p.endpoint}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:p.model,messages:m,tools:t,stream:false,options:{temperature:o?.temperature??0.1}})});const d=await readJson(r,p.name);return{content:d.message?.content||'',provider:p.name,model:p.model,toolCalls:(d.message?.tool_calls||[]).map((c:any)=>normalize(c.function?.name,c.function?.arguments,c.id))};}
function normalize(name:string,args:any,id?:string):StructuredToolCall{let a=args;if(typeof a==='string'){try{a=JSON.parse(a);}catch{throw new Error(`Invalid tool arguments for ${name}`);}}if(!a||typeof a!=='object'||Array.isArray(a))throw new Error(`Tool ${name} returned invalid arguments`);return{tool:name,arguments:a,requestId:id||`llm_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,timestamp:Date.now()};}
async function readJson(r:Response,name:string){const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(`${name} API error: ${d.error?.message||d.error?.type||r.statusText||r.status}`);return d;}
