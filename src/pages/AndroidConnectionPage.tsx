// Android Connection Page - Connect to real Android device
import { useState, useEffect } from 'react';
import { handsManager } from '../services/HandsManager';
import type { ConnectionStatus } from '../services/PlatformHands';
import { Smartphone, Wifi, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

export default function AndroidConnectionPage() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [endpoint, setEndpoint] = useState('ws://localhost:8080');
  const [transport, setTransport] = useState<'websocket' | 'http'>('websocket');
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = handsManager.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    // Load saved config
    const saved = localStorage.getItem('svetlana_android_config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        setEndpoint(config.endpoint || 'ws://localhost:8080');
        setTransport(config.transport || 'websocket');
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    }

    return unsubscribe;
  }, []);

  const handleConnect = async () => {
    setError(null);
    try {
      await handsManager.connect({
        transport,
        endpoint,
        timeout: 10000,
        reconnect: true,
      });

      // Save config
      localStorage.setItem('svetlana_android_config', JSON.stringify({
        transport,
        endpoint,
      }));

      // Get device info
      const hands = handsManager.getHands();
      if (hands) {
        const info = await hands.getDeviceInfo();
        setDeviceInfo(info);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    }
  };

  const handleDisconnect = async () => {
    await handsManager.disconnect();
    setDeviceInfo(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Smartphone className="w-10 h-10" />
            Android Connection
          </h1>
          <p className="text-slate-300">
            Connect to your Android device for real device control
          </p>
        </div>

        {/* Connection Status */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">Status</h2>
            <div className="flex items-center gap-2">
              {status === 'connected' && (
                <>
                  <CheckCircle className="w-6 h-6 text-green-500" />
                  <span className="text-green-500 font-bold">Connected</span>
                </>
              )}
              {status === 'connecting' && (
                <>
                  <RefreshCw className="w-6 h-6 text-blue-500 animate-spin" />
                  <span className="text-blue-500 font-bold">Connecting...</span>
                </>
              )}
              {status === 'disconnected' && (
                <>
                  <WifiOff className="w-6 h-6 text-slate-500" />
                  <span className="text-slate-500 font-bold">Disconnected</span>
                </>
              )}
              {status === 'error' && (
                <>
                  <XCircle className="w-6 h-6 text-red-500" />
                  <span className="text-red-500 font-bold">Error</span>
                </>
              )}
            </div>
          </div>

          {deviceInfo && (
            <div className="mt-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
              <h3 className="text-sm font-medium text-slate-400 mb-2">Device Info</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-400">Platform:</span>
                  <span className="text-white ml-2">{deviceInfo.platform}</span>
                </div>
                <div>
                  <span className="text-slate-400">Model:</span>
                  <span className="text-white ml-2">{deviceInfo.model}</span>
                </div>
                <div>
                  <span className="text-slate-400">OS Version:</span>
                  <span className="text-white ml-2">{deviceInfo.osVersion}</span>
                </div>
                <div>
                  <span className="text-slate-400">Screen:</span>
                  <span className="text-white ml-2">
                    {deviceInfo.screenWidth}x{deviceInfo.screenHeight}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Connection Settings */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Connection Settings</h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Transport
              </label>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value as any)}
                disabled={status === 'connected' || status === 'connecting'}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
              >
                <option value="websocket">WebSocket (Recommended)</option>
                <option value="http">HTTP</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Endpoint
              </label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                disabled={status === 'connected' || status === 'connecting'}
                placeholder={transport === 'websocket' ? 'ws://localhost:8080' : 'http://localhost:8080'}
                className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
              />
              <p className="text-xs text-slate-400 mt-1">
                {transport === 'websocket' 
                  ? 'WebSocket endpoint for real-time communication'
                  : 'HTTP endpoint for REST API communication'}
              </p>
            </div>

            {error && (
              <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-red-400 font-medium">Connection Error</p>
                    <p className="text-red-300 text-sm mt-1">{error}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              {status === 'connected' ? (
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
                >
                  <WifiOff className="w-5 h-5" />
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={status === 'connecting' || !endpoint}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                >
                  {status === 'connecting' ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <Wifi className="w-5 h-5" />
                      Connect
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">Setup Instructions</h2>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                1
              </span>
              <div>
                <p className="text-white font-medium">Install Svetlana-App on Android</p>
                <p className="text-slate-400 text-sm mt-1">
                  Download and install the Svetlana-App APK on your Android device
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                2
              </span>
              <div>
                <p className="text-white font-medium">Grant Permissions</p>
                <p className="text-slate-400 text-sm mt-1">
                  Grant Accessibility and Overlay permissions in Android settings
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                3
              </span>
              <div>
                <p className="text-white font-medium">Start MCP Server</p>
                <p className="text-slate-400 text-sm mt-1">
                  Open Svetlana-App and start the MCP server (default port: 8080)
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                4
              </span>
              <div>
                <p className="text-white font-medium">Connect from Web</p>
                <p className="text-slate-400 text-sm mt-1">
                  Enter the endpoint (ws://YOUR_IP:8080) and click Connect
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
            <p className="text-yellow-300 text-sm">
              <strong>Note:</strong> Both devices must be on the same network. 
              For remote connections, use port forwarding or a tunnel service.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
