import { useState } from 'react';
import { runE2EScenario, type E2EScenario } from '../services/E2EScenario';
import { CheckCircle, XCircle, Loader, Play } from 'lucide-react';

export default function E2ETestPage() {
  const [scenario, setScenario] = useState<E2EScenario | null>(null);
  const [running, setRunning] = useState(false);

  const handleRunScenario = async () => {
    setRunning(true);
    setScenario(null);
    
    try {
      const result = await runE2EScenario();
      setScenario(result);
    } catch (error) {
      console.error('E2E scenario failed:', error);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            E2E Test Scenarios
          </h1>
          <p className="text-slate-300">
            End-to-end testing of the complete agent pipeline
          </p>
        </div>

        {/* Run Button */}
        <div className="mb-8">
          <button
            onClick={handleRunScenario}
            disabled={running}
            className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white rounded-lg font-medium transition-colors"
          >
            {running ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Running Scenario...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Run E2E Scenario
              </>
            )}
          </button>
        </div>

        {/* Scenario Results */}
        {scenario && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">
                  {scenario.name}
                </h2>
                <p className="text-slate-400">{scenario.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {scenario.status === 'passed' && (
                  <>
                    <CheckCircle className="w-8 h-8 text-green-500" />
                    <span className="text-green-500 font-bold text-xl">PASSED</span>
                  </>
                )}
                {scenario.status === 'failed' && (
                  <>
                    <XCircle className="w-8 h-8 text-red-500" />
                    <span className="text-red-500 font-bold text-xl">FAILED</span>
                  </>
                )}
                {scenario.status === 'running' && (
                  <>
                    <Loader className="w-8 h-8 text-blue-500 animate-spin" />
                    <span className="text-blue-500 font-bold text-xl">RUNNING</span>
                  </>
                )}
              </div>
            </div>

            {/* User Input */}
            <div className="mb-6 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
              <h3 className="text-sm font-medium text-slate-400 mb-2">User Input</h3>
              <p className="text-white text-lg">"{scenario.userInput}"</p>
            </div>

            {/* Expected Flow */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-3">Expected Flow</h3>
              <div className="space-y-2">
                {scenario.expectedFlow.map((step, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 bg-slate-900/30 rounded">
                    <span className="text-slate-500 text-sm w-6">{i + 1}.</span>
                    <span className="text-slate-300">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actual Flow */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-3">Actual Execution</h3>
              <div className="space-y-2">
                {scenario.actualFlow.map((step, i) => (
                  <div 
                    key={i} 
                    className={`flex items-start gap-3 p-3 rounded border ${
                      step.includes('ERROR') 
                        ? 'bg-red-900/20 border-red-700' 
                        : step.includes('PASS')
                        ? 'bg-green-900/20 border-green-700'
                        : 'bg-slate-900/30 border-slate-700'
                    }`}
                  >
                    <span className="text-slate-500 text-sm font-mono min-w-[2rem]">
                      {step.match(/^\d+/)?.[0] || '•'}
                    </span>
                    <span className={`font-mono text-sm ${
                      step.includes('ERROR') ? 'text-red-400' : 'text-slate-300'
                    }`}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Error Details */}
            {scenario.error && (
              <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
                <h3 className="text-red-400 font-semibold mb-2">Error Details</h3>
                <p className="text-red-300 font-mono text-sm">{scenario.error}</p>
              </div>
            )}

            {/* Metadata */}
            {scenario.timestamp && (
              <div className="mt-6 pt-6 border-t border-slate-700">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Scenario ID:</span>
                    <span className="text-white ml-2 font-mono">{scenario.id}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Timestamp:</span>
                    <span className="text-white ml-2 font-mono">
                      {new Date(scenario.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Info Panel */}
        {!scenario && !running && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
            <h3 className="text-xl font-semibold text-white mb-4">What is this?</h3>
            <p className="text-slate-300 mb-4">
              This E2E test demonstrates the complete agent pipeline:
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">1.</span>
                <div>
                  <p className="text-white font-medium">User Request</p>
                  <p className="text-slate-400 text-sm">Natural language command from user</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">2.</span>
                <div>
                  <p className="text-white font-medium">LLM Analysis</p>
                  <p className="text-slate-400 text-sm">AI Gateway processes request and creates plan</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">3.</span>
                <div>
                  <p className="text-white font-medium">Tool Selection</p>
                  <p className="text-slate-400 text-sm">Tool Registry selects appropriate tools</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">4.</span>
                <div>
                  <p className="text-white font-medium">Policy Check</p>
                  <p className="text-slate-400 text-sm">Policy Engine validates permissions</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">5.</span>
                <div>
                  <p className="text-white font-medium">Execution</p>
                  <p className="text-slate-400 text-sm">Android Hands (mock) performs actions</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">6.</span>
                <div>
                  <p className="text-white font-medium">Observation</p>
                  <p className="text-slate-400 text-sm">Observation Layer captures state changes</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-purple-400 font-bold">7.</span>
                <div>
                  <p className="text-white font-medium">Verification</p>
                  <p className="text-slate-400 text-sm">Verification Layer confirms success</p>
                </div>
              </div>
            </div>
            <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
              <p className="text-yellow-300 text-sm">
                <strong>Note:</strong> This uses Mock Android Hands for demonstration. 
                In production, this would connect to real Android AccessibilityService via MCP/WebSocket.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
