import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { orchestrator, type AgentEvent, type AgentState } from '../services/Orchestrator';
import { memory } from '../services/Memory';
import { verification } from '../services/Verification';
import {
  Workflow, Play, Pause, RotateCcw, Activity, Brain,
  Eye, Target, Shield, Zap, CheckCircle2, AlertCircle,
  Settings, BarChart3, Clock
} from 'lucide-react';

const STATE_CONFIG: Record<AgentState, { label: string; color: string; icon: any }> = {
  idle: { label: 'Idle', color: 'text-gray-400', icon: Pause },
  understanding: { label: 'Understanding', color: 'text-blue-400', icon: Brain },
  planning: { label: 'Planning', color: 'text-indigo-400', icon: Target },
  observing: { label: 'Observing', color: 'text-cyan-400', icon: Eye },
  grounding: { label: 'Grounding', color: 'text-teal-400', icon: Target },
  policy: { label: 'Policy Check', color: 'text-yellow-400', icon: Shield },
  acting: { label: 'Acting', color: 'text-orange-400', icon: Zap },
  verifying: { label: 'Verifying', color: 'text-purple-400', icon: CheckCircle2 },
  reflecting: { label: 'Reflecting', color: 'text-pink-400', icon: Brain },
  complete: { label: 'Complete', color: 'text-emerald-400', icon: CheckCircle2 },
  error: { label: 'Error', color: 'text-red-400', icon: AlertCircle },
};

export default function OrchestratorPage() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [currentState, setCurrentState] = useState<AgentState>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [goal, setGoal] = useState('');
  const [stats, setStats] = useState(orchestrator.getStats());

  useEffect(() => {
    const unsubscribe = orchestrator.on((event) => {
      setEvents(prev => [...prev.slice(-99), event]);
      setCurrentState(event.state);
    });

    const interval = setInterval(() => {
      setStats(orchestrator.getStats());
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const handleExecute = async () => {
    if (!goal.trim() || isRunning) return;

    setIsRunning(true);
    setEvents([]);
    orchestrator.reset();

    await orchestrator.execute(goal);

    setIsRunning(false);
  };

  const handleReset = () => {
    orchestrator.reset();
    setEvents([]);
    setCurrentState('idle');
    setGoal('');
  };

  const stateConfig = STATE_CONFIG[currentState];
  const StateIcon = stateConfig.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Workflow className="w-6 h-6 text-indigo-400" />
        <h2 className="text-2xl font-bold">Orchestrator</h2>
      </div>
      <p className="text-sv-muted">Real-time agent coordination and execution pipeline</p>

      {/* Current State */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`glass-card rounded-xl p-6 border ${
          currentState === 'error' ? 'border-red-500/30' :
          currentState === 'complete' ? 'border-emerald-500/30' :
          'border-indigo-500/30'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.div
              animate={currentState !== 'idle' && currentState !== 'complete' ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 1, repeat: Infinity }}
              className={`p-4 rounded-xl ${
                currentState === 'error' ? 'bg-red-500/20' :
                currentState === 'complete' ? 'bg-emerald-500/20' :
                'bg-indigo-500/20'
              }`}
            >
              <StateIcon className={`w-8 h-8 ${stateConfig.color}`} />
            </motion.div>
            <div>
              <h3 className={`text-xl font-bold ${stateConfig.color}`}>{stateConfig.label}</h3>
              <p className="text-sm text-sv-muted">Current agent state</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-sv-muted">Verification Success Rate</p>
            <p className="text-2xl font-bold text-emerald-400">{(stats.verificationSuccessRate * 100).toFixed(0)}%</p>
          </div>
        </div>
      </motion.div>

      {/* Execution Control */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Play className="w-5 h-5 text-emerald-400" />
          Execute Task
        </h3>
        <div className="flex gap-3">
          <input
            value={goal}
            onChange={e => setGoal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleExecute()}
            placeholder="Enter a goal (e.g., 'Open Settings and enable dark mode')"
            className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50"
            disabled={isRunning}
          />
          <button
            onClick={handleExecute}
            disabled={!goal.trim() || isRunning}
            className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-2"
          >
            {isRunning ? (
              <>
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                  <Activity className="w-4 h-4" />
                </motion.div>
                Running...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Execute
              </>
            )}
          </button>
          <button
            onClick={handleReset}
            className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {['Open Settings', 'Send message "Hello"', 'Take screenshot', 'Search for weather'].map(example => (
            <button
              key={example}
              onClick={() => setGoal(example)}
              disabled={isRunning}
              className="px-3 py-1 text-xs rounded-full bg-white/5 border border-white/10 text-sv-muted hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Pipeline Visualization */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-cyan-400" />
          Pipeline Stages
        </h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(STATE_CONFIG).map(([state, config]) => {
            const Icon = config.icon;
            const isActive = currentState === state;
            return (
              <motion.div
                key={state}
                animate={isActive ? { scale: 1.05 } : { scale: 1 }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                  isActive
                    ? `${config.color} bg-white/10 border-current`
                    : 'text-sv-muted bg-white/5 border-white/10'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{config.label}</span>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Event Log */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-purple-400" />
          Event Log
        </h3>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          <AnimatePresence>
            {events.slice().reverse().map((event, i) => {
              const config = STATE_CONFIG[event.state];
              const Icon = config.icon;
              return (
                <motion.div
                  key={event.timestamp}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/5"
                >
                  <Icon className={`w-4 h-4 mt-0.5 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                      <span className="text-xs text-sv-muted">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-sv-text mt-0.5">{event.detail}</p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
          {events.length === 0 && (
            <p className="text-sm text-sv-muted text-center py-8">No events yet. Execute a task to see the pipeline in action.</p>
          )}
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h4 className="text-sm font-medium">Total Events</h4>
          </div>
          <p className="text-2xl font-bold text-indigo-400">{stats.totalEvents}</p>
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <Brain className="w-5 h-5 text-purple-400" />
            <h4 className="text-sm font-medium">Memory Items</h4>
          </div>
          <p className="text-2xl font-bold text-purple-400">{stats.memoryStats.longTermCount}</p>
        </div>
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h4 className="text-sm font-medium">Verification Rate</h4>
          </div>
          <p className="text-2xl font-bold text-emerald-400">{(stats.verificationSuccessRate * 100).toFixed(0)}%</p>
        </div>
      </div>

      {/* Configuration */}
      <div className="glass-card rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Settings className="w-5 h-5 text-sv-muted" />
          Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-sv-muted mb-2 block">Max Retries</label>
            <input
              type="number"
              value={orchestrator.getConfig().maxRetries}
              onChange={e => orchestrator.updateConfig({ maxRetries: parseInt(e.target.value) })}
              min={1}
              max={10}
              className="w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={orchestrator.getConfig().enableVerification}
                onChange={e => orchestrator.updateConfig({ enableVerification: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Enable Verification</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={orchestrator.getConfig().enableReflection}
                onChange={e => orchestrator.updateConfig({ enableReflection: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Enable Reflection</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={orchestrator.getConfig().enableMemory}
                onChange={e => orchestrator.updateConfig({ enableMemory: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Enable Memory</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
