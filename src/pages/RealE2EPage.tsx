import { useState } from 'react';
import { runRealE2ETest_OpenTelegram, runAllRealE2ETests, type RealE2EResult } from '../services/RealE2ETest';
import { handsManager } from '../services/HandsManager';
import { Play, CheckCircle, XCircle, Loader, AlertCircle } from 'lucide-react';

export default function RealE2EPage() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RealE2EResult[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  const checkConnection = async () => {
    setConnectionStatus('checking');
    const connected = await handsManager.isConnected();
    setConnectionStatus(connected ? 'connected' : 'disconnected');
  };

  const runOpenTelegramTest = async () => {
    setRunning(true);
    setResults([]);
    
    try {
      const result = await runRealE2ETest_OpenTelegram();
      setResults([result]);
    } catch (error: any) {
      console.error('E2E test error:', error);
    } finally {
      setRunning(false);
    }
  };

  const runAllTests = async () => {
    setRunning(true);
    setResults([]);
    
    try {
      const results = await runAllRealE2ETests();
      setResults(results);
    } catch (error: any) {
      console.error('E2E tests error:', error);
    } finally {
      setRunning(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running':
        return <Loader className="w-5 h-5 text-blue-500 animate-spin" />;
      default:
        return <div className="w-5 h-5 rounded-full border-2 border-gray-300" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Real E2E Tests
          </h1>
          <p className="text-slate-300">
            Real execution tests on Android device (NOT PROVEN without real device)
          </p>
        </div>

        {/* Connection Status */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">Android Connection</h2>
            <button
              onClick={checkConnection}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              Check Connection
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            {connectionStatus === 'connected' && (
              <>
                <CheckCircle className="w-6 h-6 text-green-500" />
                <span className="text-green-500 font-bold">Connected to Android device</span>
              </>
            )}
            {connectionStatus === 'disconnected' && (
              <>
                <XCircle className="w-6 h-6 text-red-500" />
                <span className="text-red-500 font-bold">Not connected</span>
              </>
            )}
            {connectionStatus === 'checking' && (
              <>
                <Loader className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-blue-500 font-bold">Checking...</span>
              </>
            )}
          </div>
        </div>

        {/* Warning */}
        <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-yellow-400 font-bold mb-2">NOT PROVEN</h3>
              <p className="text-yellow-300 text-sm">
                These tests require a real Android device with Svetlana-App installed and MCP Server running.
                Without real device, tests will fail at connection step.
              </p>
            </div>
          </div>
        </div>

        {/* Test Buttons */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Run Tests</h2>
          
          <div className="flex gap-4">
            <button
              onClick={runOpenTelegramTest}
              disabled={running || connectionStatus !== 'connected'}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              {running ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Test: Open Telegram
                </>
              )}
            </button>

            <button
              onClick={runAllTests}
              disabled={running || connectionStatus !== 'connected'}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 text-white rounded-lg font-medium transition-colors"
            >
              {running ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Run All Tests
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
            <h2 className="text-2xl font-bold text-white mb-4">Test Results</h2>
            
            {results.map((result, idx) => (
              <div key={idx} className="mb-6 last:mb-0">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xl font-bold text-white">{result.scenario}</h3>
                  <div className="flex items-center gap-2">
                    {result.success ? (
                      <>
                        <CheckCircle className="w-6 h-6 text-green-500" />
                        <span className="text-green-500 font-bold">PASSED</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-6 h-6 text-red-500" />
                        <span className="text-red-500 font-bold">FAILED</span>
                      </>
                    )}
                  </div>
                </div>

                {result.duration && (
                  <p className="text-slate-400 text-sm mb-3">
                    Duration: {result.duration}ms
                  </p>
                )}

                <div className="space-y-2">
                  {result.steps.map((step, stepIdx) => (
                    <div
                      key={stepIdx}
                      className={`p-3 rounded-lg border ${
                        step.status === 'passed'
                          ? 'bg-green-900/20 border-green-700'
                          : step.status === 'failed'
                          ? 'bg-red-900/20 border-red-700'
                          : step.status === 'running'
                          ? 'bg-blue-900/20 border-blue-700'
                          : 'bg-slate-900/50 border-slate-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {getStatusIcon(step.status)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-slate-400 text-sm">Step {step.step}</span>
                            <span className="text-white font-medium">{step.action}</span>
                          </div>
                          {step.error && (
                            <p className="text-red-400 text-sm mt-1">{step.error}</p>
                          )}
                          {step.data && (
                            <pre className="text-slate-400 text-xs mt-2 overflow-x-auto">
                              {JSON.stringify(step.data, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
