import type { AIResponse, ChatMessage } from './AIGateway';
import { toolRegistry } from './ToolRegistry';
import { nativeToolCall } from './NativeToolCallingGateway';

export async function planWithNativeToolCalling(goal:string,context?:any,providerId?:string):Promise<AIResponse>{
 const tools=toolRegistry.generateFunctionCallingSchema();
 const messages:ChatMessage[]=[
  {role:'system',content:'You are Svetlana Planner. Convert the user goal into one or more executable tool calls. Use only declared tools. Never claim that a tool was executed.'},
  {role:'user',content:JSON.stringify({goal,context:context||{}})}
 ];
 const provider=providerId?undefined:undefined;
 if(providerId){throw new Error('Explicit provider selection must be resolved by the AI provider manager before native planning.');}
 const active=(await import('./AIGateway')).aiGateway.getActiveProvider();
 if(!active)throw new Error('No AI provider configured for native planning');
 return nativeToolCall(active,messages,tools,{temperature:0.1,max_tokens:2048});
}

export function toolCallsToPlanSteps(response:AIResponse){return(response.toolCalls||[]).map((call,index)=>({id:`step_${index+1}`,action:call.tool,parameters:call.arguments,status:'pending' as const,llmRequestId:call.requestId}));}
