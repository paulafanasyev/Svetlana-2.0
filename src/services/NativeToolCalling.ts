import { aiGateway, type ChatMessage, type AIResponse } from './AIGateway';
import { toolRegistry } from './ToolRegistry';

export async function planWithNativeToolCalling(goal:string, context?:any, providerId?:string):Promise<AIResponse>{
  const tools=toolRegistry.generateFunctionCallingSchema();
  const messages:ChatMessage[]=[
    {role:'system',content:'You are Svetlana Planner. Convert the user goal into one or more executable tool calls. Use only declared tools. Never claim that a tool was executed. Return tool calls when an action is required.'},
    {role:'user',content:JSON.stringify({goal,context:context||{}})}
  ];
  return aiGateway.chatWithTools(messages,tools,{temperature:0.1,max_tokens:2048},providerId);
}

export function toolCallsToPlanSteps(response:AIResponse){
  return (response.toolCalls||[]).map((call,index)=>({id:`step_${index+1}`,action:call.tool,parameters:call.arguments,status:'pending' as const,llmRequestId:call.requestId}));
}
