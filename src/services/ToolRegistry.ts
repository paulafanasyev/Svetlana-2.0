// Tool Registry - Tool abstraction layer
// Real tool implementations are in RealTools.ts and use PlatformHands via HandsManager
// This file only defines the contract and registry - NO stub implementations

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export interface ToolInputSchema { type:'object'; properties:Record<string,{type:string;description:string;required?:boolean;enum?:string[]}>; required?:string[]; }
export interface ToolResult { success:boolean; data?:any; error?:string; requiresConfirmation?:boolean; confirmationMessage?:string; observation?:any; verification?:{status:'PASS'|'FAIL'|'PENDING';confidence:number;details?:string}; requestId?:string; timestamp?:number; }
export interface Tool { id:string; name:string; description:string; inputSchema:ToolInputSchema; riskLevel:RiskLevel; category:'navigation'|'interaction'|'data'|'system'|'communication'; execute(params:Record<string,any>):Promise<ToolResult>; verify?(params:Record<string,any>,result:ToolResult):Promise<boolean>; isAvailable():Promise<boolean>; }
export interface ToolExecutionContext { platform:'android'|'ios'|'windows'|'macos'|'web'; permissions:string[]; environment:Record<string,any>; }
export interface StructuredToolCall { tool:string; arguments:Record<string,any>; requestId:string; timestamp:number; }

class ToolRegistry {
  private tools:Map<string,Tool>=new Map();
  private context:ToolExecutionContext={platform:'web',permissions:[],environment:{}};
  private executionLog:Array<{requestId:string;toolId:string;params:any;result:ToolResult;timestamp:number}>=[];
  registerTool(tool:Tool){this.tools.set(tool.id,tool)}
  unregisterTool(id:string){this.tools.delete(id)}
  getTool(id:string){return this.tools.get(id)}
  getAllTools(){return Array.from(this.tools.values())}
  getToolsByCategory(category:Tool['category']){return this.getAllTools().filter(t=>t.category===category)}
  getToolsByRiskLevel(riskLevel:RiskLevel){return this.getAllTools().filter(t=>t.riskLevel===riskLevel)}

  async executeTool(id:string,params:Record<string,any>):Promise<ToolResult>{
    const requestId=`exec_${Date.now()}_${Math.random().toString(36).substr(2,9)}`; const tool=this.tools.get(id);
    if(!tool)return this.record(requestId,id,params,{success:false,error:`Tool ${id} not found in registry`,requestId,timestamp:Date.now()});
    // Validate first so malformed requests are deterministic and do not require a device connection.
    const validation=this.validateInput(tool,params);
    if(!validation.valid)return this.record(requestId,id,params,{success:false,error:validation.error,requestId,timestamp:Date.now()});
    const available=await tool.isAvailable();
    if(!available)return this.record(requestId,id,params,{success:false,error:`Tool ${id} is not available. Ensure Android device is connected via Android Connection page.`,requestId,timestamp:Date.now()});
    if(tool.riskLevel==='critical'||tool.riskLevel==='high'){
      return this.record(requestId,id,params,{success:false,requiresConfirmation:true,confirmationMessage:this.getConfirmationMessage(tool,params),requestId,timestamp:Date.now()});
    }
    return this.executeValidated(tool,id,params,requestId);
  }

  private async executeValidated(tool:Tool,id:string,params:Record<string,any>,requestId:string):Promise<ToolResult>{
    try{
      const result=await tool.execute(params); result.requestId=requestId; result.timestamp=Date.now();
      if(tool.verify&&result.success){const verified=await tool.verify(params,result); result.verification={status:verified?'PASS':'FAIL',confidence:verified?1:0,details:verified?'Verified via observation':'Verification failed'}; if(!verified){result.success=false;result.error='Verification failed after execution';}}
      return this.record(requestId,id,params,result);
    }catch(error:any){return this.record(requestId,id,params,{success:false,error:error?.message||'Tool execution failed',requestId,timestamp:Date.now()});}
  }

  async executeWithConfirmation(id:string,params:Record<string,any>):Promise<ToolResult>{
    const requestId=`exec_${Date.now()}_${Math.random().toString(36).substr(2,9)}`; const tool=this.tools.get(id);
    if(!tool)return this.record(requestId,id,params,{success:false,error:`Tool ${id} not found`,requestId,timestamp:Date.now()});
    const validation=this.validateInput(tool,params);
    if(!validation.valid)return this.record(requestId,id,params,{success:false,error:validation.error,requestId,timestamp:Date.now()});
    if(tool.riskLevel!=='high'&&tool.riskLevel!=='critical')return this.executeValidated(tool,id,params,requestId);
    if(!(await tool.isAvailable()))return this.record(requestId,id,params,{success:false,error:`Tool ${id} not available`,requestId,timestamp:Date.now()});
    return this.executeValidated(tool,id,params,requestId);
  }

  private getConfirmationMessage(tool:Tool,params:Record<string,any>):string{const riskLabels:Record<RiskLevel,string>={low:'Low risk',medium:'Medium risk',high:'⚡ HIGH RISK',critical:'⚠️ CRITICAL'};return `${riskLabels[tool.riskLevel]}: ${tool.name}\n\nThis action will be performed on your Android device.\nParameters: ${JSON.stringify(params,null,2)}\n\nDo you confirm?`;}
  private validateInput(tool:Tool,params:Record<string,any>):{valid:boolean;error?:string}{const schema=tool.inputSchema;if(schema.required){for(const field of schema.required){if(!(field in params)||params[field]===undefined||params[field]===null)return{valid:false,error:`Missing required parameter: ${field}`};}}for(const[key,prop]of Object.entries(schema.properties)){if(key in params&&params[key]!==undefined&&params[key]!==null){const value=params[key];if(prop.type==='string'&&typeof value!=='string')return{valid:false,error:`Parameter ${key} must be a string`};if(prop.type==='number'&&typeof value!=='number')return{valid:false,error:`Parameter ${key} must be a number`};if(prop.type==='boolean'&&typeof value!=='boolean')return{valid:false,error:`Parameter ${key} must be a boolean`};if(prop.enum&&!prop.enum.includes(value))return{valid:false,error:`Parameter ${key} must be one of: ${prop.enum.join(', ')}`};}}return{valid:true};}
  private record(requestId:string,toolId:string,params:any,result:ToolResult){this.logExecution(requestId,toolId,params,result);return result;}
  private logExecution(requestId:string,toolId:string,params:any,result:ToolResult){this.executionLog.push({requestId,toolId,params,result,timestamp:Date.now()});if(this.executionLog.length>1000)this.executionLog.shift();}
  setContext(context:Partial<ToolExecutionContext>){this.context={...this.context,...context}}
  getContext(){return{...this.context}}
  getExecutionLog(limit:number=50){return this.executionLog.slice(-limit)}
  generateToolDescriptions():string{return this.getAllTools().map(tool=>{const params=Object.entries(tool.inputSchema.properties).map(([key,prop])=>`    - ${key}: ${prop.description}${prop.required?' (required)':''}`).join('\n');return `${tool.id}: ${tool.description}\n  Risk: ${tool.riskLevel}\n  Category: ${tool.category}\n  Parameters:\n${params}`}).join('\n\n')}
  generateFunctionCallingSchema():object[]{return this.getAllTools().map(tool=>({type:'function',function:{name:tool.id,description:tool.description,parameters:{type:'object',properties:tool.inputSchema.properties,required:tool.inputSchema.required}}}))}
}
export const toolRegistry=new ToolRegistry();
