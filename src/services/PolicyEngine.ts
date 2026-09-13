// Policy Engine - Real risk assessment and permission checking

import type { Tool, RiskLevel } from './ToolRegistry';

export type PolicyDecision = 'allow' | 'deny' | 'require_confirmation';

export interface PolicyContext { userId?: string; sessionId?: string; platform: string; currentApp?: string; userConfirmed?: boolean; environment: Record<string, any>; }
export interface PolicyResult { decision: PolicyDecision; reason: string; riskLevel: RiskLevel; requiresConfirmation: boolean; confirmationMessage?: string; auditLog: { timestamp: number; tool: string; decision: PolicyDecision; reason: string; }; }
export interface PolicyRule { id: string; name: string; description: string; enabled: boolean; priority: number; applies(tool: Tool, context: PolicyContext): boolean; evaluate(tool: Tool, context: PolicyContext): PolicyResult; }

class PolicyEngine {
  private rules: PolicyRule[] = [];
  private auditLog: PolicyResult['auditLog'][] = [];
  private blockedTools = new Set<string>();
  private allowedTools = new Set<string>();
  private maxDailyExecutions = new Map<string, number>();
  private dailyExecutionCount = new Map<string, number>();

  constructor() { this.initializeDefaultRules(); this.loadFromStorage(); }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem('svetlana_policy');
      if (stored) {
        const data = JSON.parse(stored);
        if (data.blockedTools) this.blockedTools = new Set(data.blockedTools);
        if (data.allowedTools) this.allowedTools = new Set(data.allowedTools);
        if (data.maxDailyExecutions) this.maxDailyExecutions = new Map(Object.entries(data.maxDailyExecutions));
      }
    } catch (e) { console.error('Failed to load policy:', e); }
  }

  private saveToStorage() {
    try { localStorage.setItem('svetlana_policy', JSON.stringify({ blockedTools: Array.from(this.blockedTools), allowedTools: Array.from(this.allowedTools), maxDailyExecutions: Object.fromEntries(this.maxDailyExecutions) })); }
    catch (e) { console.error('Failed to save policy:', e); }
  }

  private initializeDefaultRules() {
    this.rules.push({ id:'blocked_tools', name:'Blocked Tools', description:'Block explicitly blocked tools', enabled:true, priority:100, applies:tool=>this.blockedTools.has(tool.id), evaluate:tool=>({ decision:'deny', reason:`Tool ${tool.name} is blocked by policy`, riskLevel:tool.riskLevel, requiresConfirmation:false, auditLog:{timestamp:Date.now(),tool:tool.id,decision:'deny',reason:'Blocked by policy'} }) });
    this.rules.push({ id:'critical_confirmation', name:'Critical Risk Confirmation', description:'Critical actions require confirmation', enabled:true, priority:90, applies:tool=>tool.riskLevel==='critical', evaluate:(tool,context)=>({ decision:context.userConfirmed?'allow':'require_confirmation', reason:context.userConfirmed?'Critical action confirmed by user':'Critical action requires user confirmation', riskLevel:'critical', requiresConfirmation:!context.userConfirmed, confirmationMessage:`⚠️ CRITICAL ACTION: ${tool.name}\n\nThis action cannot be undone. Are you sure you want to proceed?`, auditLog:{timestamp:Date.now(),tool:tool.id,decision:context.userConfirmed?'allow':'require_confirmation',reason:context.userConfirmed?'User confirmed':'Requires confirmation'} }) });
    this.rules.push({ id:'high_risk_confirmation', name:'High Risk Confirmation', description:'High-risk actions require confirmation', enabled:true, priority:80, applies:tool=>tool.riskLevel==='high', evaluate:(tool,context)=>({ decision:context.userConfirmed?'allow':'require_confirmation', reason:context.userConfirmed?'High-risk action confirmed by user':'High-risk action requires user confirmation', riskLevel:'high', requiresConfirmation:!context.userConfirmed, confirmationMessage:`⚡ HIGH RISK: ${tool.name}\n\nThis action may have significant consequences. Continue?`, auditLog:{timestamp:Date.now(),tool:tool.id,decision:context.userConfirmed?'allow':'require_confirmation',reason:context.userConfirmed?'User confirmed':'Requires confirmation'} }) });
    this.rules.push({
      id:'daily_limits', name:'Daily Execution Limits', description:'Enforce daily execution limits for tools', enabled:true, priority:70,
      applies:tool=>this.maxDailyExecutions.has(tool.id),
      evaluate:tool=>{
        const max=this.maxDailyExecutions.get(tool.id) ?? Infinity;
        const count=this.dailyExecutionCount.get(tool.id) ?? 0;
        if(count>=max) return {decision:'deny',reason:`Daily execution limit reached for ${tool.name} (${count}/${max})`,riskLevel:tool.riskLevel,requiresConfirmation:false,auditLog:{timestamp:Date.now(),tool:tool.id,decision:'deny',reason:`Daily limit exceeded: ${count}/${max}`}};
        return {decision:'allow',reason:`Within daily limit (${count}/${max})`,riskLevel:tool.riskLevel,requiresConfirmation:false,auditLog:{timestamp:Date.now(),tool:tool.id,decision:'allow',reason:`Within limit: ${count}/${max}`}};
      }
    });
    this.rules.push({ id:'platform_restrictions', name:'Platform Restrictions', description:'Restrict tools based on current platform', enabled:true, priority:60, applies:(tool,context)=>{ const androidOnly=['tap_element','type_text','capture_screen','send_message']; return androidOnly.includes(tool.id)&&context.platform!=='android'; }, evaluate:(tool,context)=>({decision:'deny',reason:`Tool ${tool.name} requires Android platform, current: ${context.platform}`,riskLevel:tool.riskLevel,requiresConfirmation:false,auditLog:{timestamp:Date.now(),tool:tool.id,decision:'deny',reason:`Platform mismatch: requires android, got ${context.platform}`}}) });
    this.rules.push({ id:'default_allow', name:'Default Allow', description:'Allow low and medium risk tools by default', enabled:true, priority:0, applies:tool=>tool.riskLevel==='low'||tool.riskLevel==='medium', evaluate:tool=>({decision:'allow',reason:`Low/medium risk action allowed: ${tool.name}`,riskLevel:tool.riskLevel,requiresConfirmation:false,auditLog:{timestamp:Date.now(),tool:tool.id,decision:'allow',reason:'Default allow for low/medium risk'}}) });
  }

  async evaluate(tool: Tool, context: PolicyContext): Promise<PolicyResult> {
    const sortedRules=[...this.rules].filter(r=>r.enabled).sort((a,b)=>b.priority-a.priority);
    for(const rule of sortedRules){
      if(!rule.applies(tool,context)) continue;
      const result=rule.evaluate(tool,context);
      this.auditLog.push(result.auditLog);
      if(this.auditLog.length>1000) this.auditLog.shift();
      return result;
    }
    return {decision:'deny',reason:'No policy rule matched - default deny',riskLevel:tool.riskLevel,requiresConfirmation:false,auditLog:{timestamp:Date.now(),tool:tool.id,decision:'deny',reason:'No matching rule'}};
  }

  // Record only after the tool execution has actually succeeded.
  recordSuccessfulExecution(toolId: string) { this.dailyExecutionCount.set(toolId,(this.dailyExecutionCount.get(toolId)||0)+1); }
  blockTool(toolId:string){this.blockedTools.add(toolId);this.saveToStorage();}
  unblockTool(toolId:string){this.blockedTools.delete(toolId);this.saveToStorage();}
  isToolBlocked(toolId:string){return this.blockedTools.has(toolId);}
  setDailyLimit(toolId:string,limit:number){this.maxDailyExecutions.set(toolId,limit);this.saveToStorage();}
  getDailyLimit(toolId:string){return this.maxDailyExecutions.get(toolId);}
  getDailyExecutionCount(toolId:string){return this.dailyExecutionCount.get(toolId)||0;}
  resetDailyCounts(){this.dailyExecutionCount.clear();}
  getAuditLog(limit=50){return this.auditLog.slice(-limit);}
  clearAuditLog(){this.auditLog=[];}
  getRules(){return [...this.rules];}
  enableRule(ruleId:string){const rule=this.rules.find(r=>r.id===ruleId);if(rule)rule.enabled=true;}
  disableRule(ruleId:string){const rule=this.rules.find(r=>r.id===ruleId);if(rule)rule.enabled=false;}
  getStats(){return {totalRules:this.rules.length,enabledRules:this.rules.filter(r=>r.enabled).length,blockedTools:this.blockedTools.size,auditLogSize:this.auditLog.length,dailyLimits:this.maxDailyExecutions.size};}
}

export const policyEngine = new PolicyEngine();
