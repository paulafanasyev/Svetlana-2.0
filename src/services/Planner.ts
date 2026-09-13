// Planner Module - LLM-native task decomposition.
import { planWithNativeToolCalling, toolCallsToPlanSteps } from './NativeToolCalling';

export interface Task { id:string; description:string; steps:TaskStep[]; status:'pending'|'planning'|'executing'|'completed'|'failed'; createdAt:number; completedAt?:number; }
export interface TaskStep { id:string; action:string; target?:string; parameters?:Record<string,any>; status:'pending'|'executing'|'completed'|'failed'; result?:any; error?:string; llmRequestId?:string; }
export interface PlanRequest { goal:string; context?:{currentApp?:string;screenState?:any;previousActions?:string[]}; providerId?:string; }

class Planner {
 private tasks=new Map<string,Task>();
 async createPlan(request:PlanRequest):Promise<Task>{
  const taskId=`task_${Date.now()}`;
  const response=await planWithNativeToolCalling(request.goal,request.context,request.providerId);
  const steps=toolCallsToPlanSteps(response);
  if(steps.length===0)throw new Error('Planner LLM returned no tool calls for executable goal');
  const task:Task={id:taskId,description:request.goal,steps,status:'planning',createdAt:Date.now()};
  this.tasks.set(taskId,task); return task;
 }
 getTask(id:string){return this.tasks.get(id);}
 getAllTasks(){return Array.from(this.tasks.values());}
 updateStepStatus(taskId:string,stepId:string,status:TaskStep['status'],result?:any,error?:string){const task=this.tasks.get(taskId);if(!task)return;const step=task.steps.find(s=>s.id===stepId);if(!step)return;step.status=status;if(result!==undefined)step.result=result;if(error)step.error=error;const allCompleted=task.steps.every(s=>s.status==='completed'),anyFailed=task.steps.some(s=>s.status==='failed');if(allCompleted){task.status='completed';task.completedAt=Date.now();}else if(anyFailed)task.status='failed';else task.status='executing';}
 removeTask(id:string){this.tasks.delete(id);}
}
export const planner=new Planner();
