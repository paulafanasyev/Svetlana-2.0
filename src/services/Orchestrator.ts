// Orchestrator - Central coordination for all agent modules

import { planner, type Task, type TaskStep } from './Planner';
import { memory } from './Memory';
import { verification } from './Verification';
import { toolRegistry } from './ToolRegistry';
import { capabilityRouter } from './CapabilityRouter';
import { policyEngine, type PolicyContext } from './PolicyEngine';
import { observationManager } from './ObservationLayer';
import { avatarStateMachine } from './AvatarStateMachine';

export type AgentState = 'idle'|'understanding'|'planning'|'observing'|'grounding'|'policy'|'acting'|'verifying'|'reflecting'|'complete'|'error';
export interface AgentEvent { type:string; state:AgentState; detail:string; timestamp:number; data?:any; }
export interface OrchestratorConfig { maxRetries:number; enableVerification:boolean; enableReflection:boolean; enableMemory:boolean; }

class Orchestrator {
  private state:AgentState='idle'; private currentTask:Task|null=null; private eventLog:AgentEvent[]=[];
  private config:OrchestratorConfig={maxRetries:3,enableVerification:true,enableReflection:true,enableMemory:true};
  private listeners:((event:AgentEvent)=>void)[]=[];
  constructor(){this.loadConfig();}
  private loadConfig(){try{const stored=localStorage.getItem('svetlana_orchestrator_config');if(stored)this.config={...this.config,...JSON.parse(stored)};}catch(e){console.error('Failed to load orchestrator config:',e);}}
  private saveConfig(){localStorage.setItem('svetlana_orchestrator_config',JSON.stringify(this.config));}
  on(listener:(event:AgentEvent)=>void){this.listeners.push(listener);return()=>{this.listeners=this.listeners.filter(l=>l!==listener);};}
  private emit(event:Omit<AgentEvent,'timestamp'>){const fullEvent={...event,timestamp:Date.now()};this.eventLog.push(fullEvent);if(this.eventLog.length>1000)this.eventLog.shift();this.listeners.forEach(l=>l(fullEvent));}

  async execute(goal:string,context?:any):Promise<{success:boolean;result?:any;error?:string}>{
    try{
      this.setState('understanding'); this.emit({type:'understand',state:'understanding',detail:`Parsing goal: "${goal}"`,data:{goal}});
      if(this.config.enableMemory){memory.addMessage('user',goal);memory.addToShortTerm({type:'action',content:`User request: ${goal}`,importance:0.8});}
      await this.delay(500); this.setState('planning'); this.emit({type:'plan',state:'planning',detail:'Decomposing task into steps'});
      const task=await planner.createPlan({goal,context}); this.currentTask=task;
      this.emit({type:'plan_complete',state:'planning',detail:`Created plan with ${task.steps.length} steps`,data:{task}}); await this.delay(500);
      for(const step of task.steps){const result=await this.executeStep(step,context);if(!result.success){this.setState('error');this.emit({type:'error',state:'error',detail:`Step failed: ${step.action}`,data:{error:result.error}});return{success:false,error:result.error};}}
      this.setState('complete');this.emit({type:'complete',state:'complete',detail:'Task completed successfully'});
      if(this.config.enableMemory){memory.addMessage('assistant',`Task completed: ${goal}`);memory.addToLongTerm({type:'action',content:`Completed: ${goal}`,importance:0.6});}
      return{success:true,result:task};
    }catch(error:any){this.setState('error');this.emit({type:'error',state:'error',detail:error.message,data:{error:error.message}});return{success:false,error:error.message};}
  }

  private async executeStep(step:TaskStep,context?:any):Promise<{success:boolean;error?:string}>{
    this.setState('observing');avatarStateMachine.setExecuting();this.emit({type:'observe',state:'observing',detail:`Observing before action: ${step.action}`,data:{step}});
    const observationResult=await observationManager.observe();const preState=observationResult.state;
    this.emit({type:'observe_result',state:'observing',detail:`Observation: ${observationResult.success?'SUCCESS':'FAILED'}`,data:{observation:observationResult}});
    this.setState('grounding');this.emit({type:'ground',state:'grounding',detail:`Grounding to target: ${step.target||'N/A'}`});
    if(step.target){const groundedElement=await observationManager.findElementByText(step.target);this.emit({type:'ground_result',state:'grounding',detail:groundedElement?`Found: ${groundedElement.text}`:'Not found',data:{element:groundedElement}});}
    this.setState('policy');avatarStateMachine.setVerifying();
    const route=await capabilityRouter.resolve({action:step.action,parameters:step.parameters||{}});
    this.emit({type:'route',state:'policy',detail:route.success?`Routed ${step.action} -> ${route.tool!.id}`:`Routing failed: ${route.error}`,data:{route:{success:route.success,tool:route.tool?.id,backend:route.backend,candidates:route.candidates,error:route.error}}});
    if(!route.success||!route.tool)return{success:false,error:route.error||`No tool available for ${step.action}`};
    const tool=route.tool;const policyContext:PolicyContext={platform:observationManager.getContext().platform,currentApp:preState?.currentApp,environment:context||{}};
    const policyResult=await policyEngine.evaluate(tool,policyContext);this.emit({type:'policy',state:'policy',detail:`Policy: ${policyResult.decision} - ${policyResult.reason}`,data:{policy:policyResult}});
    if(policyResult.decision==='deny'){avatarStateMachine.setError();this.emit({type:'policy_blocked',state:'policy',detail:`Action blocked: ${policyResult.reason}`});return{success:false,error:policyResult.reason};}
    if(policyResult.decision==='require_confirmation'){avatarStateMachine.setConfirmationRequired();this.emit({type:'policy_confirmation',state:'policy',detail:policyResult.confirmationMessage||'Confirmation required'});return{success:false,error:'Requires user confirmation'};}
    this.setState('acting');avatarStateMachine.setExecuting();this.emit({type:'act',state:'acting',detail:`Executing tool: ${tool.name}`,data:{tool:tool.id,params:step.parameters}});
    const actionResult=await toolRegistry.executeTool(tool.id,step.parameters||{});
    this.emit({type:'act_result',state:'acting',detail:`Result: ${actionResult.success?'SUCCESS':'FAILED'}`,data:{result:actionResult}});
    if(!actionResult.success){avatarStateMachine.setError();planner.updateStepStatus(this.currentTask!.id,step.id,'failed',undefined,actionResult.error);return{success:false,error:actionResult.error};}
    // Policy quota is consumed only after the tool has actually succeeded.
    policyEngine.recordSuccessfulExecution(tool.id);

    if(this.config.enableVerification){
      this.setState('verifying');avatarStateMachine.setVerifying();this.emit({type:'verify',state:'verifying',detail:'Verifying action result'});
      const postObservation=await observationManager.observe();const postState=postObservation.state;
      let stateChanged=true;
      if(preState&&postState){const comparison=observationManager.compareStates(preState,postState);stateChanged=comparison.changed;this.emit({type:'verify_compare',state:'verifying',detail:`State changed: ${comparison.changed}`,data:{comparison}});}
      const verificationResult=await verification.verify({action:step.action,expectedState:{success:true},actualState:actionResult});
      this.emit({type:'verify_result',state:'verifying',detail:`Verification: ${verificationResult.success?'PASS':'FAIL'}`,data:{verification:verificationResult}});
      // A successful tool execution is the primary contract. If both observations exist,
      // require an actual state change as an independent check.
      if(!verificationResult.success||((preState&&postState)&&!stateChanged)){
        for(let retry=0;retry<this.config.maxRetries;retry++){
          this.emit({type:'retry',state:'verifying',detail:`Retry ${retry+1}/${this.config.maxRetries}`});
          await new Promise(resolve=>setTimeout(resolve,1000*Math.pow(2,retry)));
          const retryResult=await toolRegistry.executeTool(tool.id,step.parameters||{});
          if(!retryResult.success)continue;
          policyEngine.recordSuccessfulExecution(tool.id);
          const retryObservation=await observationManager.observe();
          const retryChanged=!preState||!retryObservation.state||observationManager.compareStates(preState,retryObservation.state).changed;
          if(retryChanged){avatarStateMachine.setSuccess();planner.updateStepStatus(this.currentTask!.id,step.id,'completed',retryResult);return{success:true};}
        }
        avatarStateMachine.setError();planner.updateStepStatus(this.currentTask!.id,step.id,'failed',undefined,'Independent verification failed after retries');return{success:false,error:'Independent verification failed after retries'};
      }
    }
    if(this.config.enableReflection){this.setState('reflecting');this.emit({type:'reflect',state:'reflecting',detail:'Reflecting on action outcome'});if(this.config.enableMemory)memory.addToLongTerm({type:'action',content:`Executed: ${tool.name} with params: ${JSON.stringify(step.parameters)}`,importance:0.6});}
    avatarStateMachine.setSuccess();planner.updateStepStatus(this.currentTask!.id,step.id,'completed',actionResult);return{success:true};
  }

  private setState(state:AgentState){this.state=state;}
  private delay(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}
  getState(){return this.state;} getCurrentTask(){return this.currentTask;} getEventLog(limit=50){return this.eventLog.slice(-limit);} getConfig(){return{...this.config};}
  updateConfig(updates:Partial<OrchestratorConfig>){this.config={...this.config,...updates};this.saveConfig();}
  reset(){this.state='idle';this.currentTask=null;}
  getStats(){return{state:this.state,totalEvents:this.eventLog.length,currentTask:this.currentTask?.id,memoryStats:memory.getStats(),verificationSuccessRate:verification.getSuccessRate()};}
}
export const orchestrator=new Orchestrator();
