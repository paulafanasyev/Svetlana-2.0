// Android Connection Page - Connect to the real Android execution plane
import { useState, useEffect } from 'react';
import { handsManager } from '../services/HandsManager';
import type { ConnectionStatus } from '../services/PlatformHands';
import { Smartphone, Wifi, WifiOff, RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765';

export default function AndroidConnectionPage() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [transport, setTransport] = useState<'websocket' | 'http'>('http');
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);

  useEffect(() => {
    const unsubscribe = handsManager.onStatusChange(setStatus);
    const saved = localStorage.getItem('svetlana_android_config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        setEndpoint(config.endpoint || DEFAULT_ENDPOINT);
        setTransport(config.transport || 'http');
      } catch (e) { console.error('Failed to load config:', e); }
    }
    return unsubscribe;
  }, []);

  const handleConnect = async () => {
    setError(null);
    try {
      await handsManager.connect({ transport, endpoint, timeout: 10000, reconnect: true });
      localStorage.setItem('svetlana_android_config', JSON.stringify({ transport, endpoint }));
      const hands = handsManager.getHands();
      if (hands) setDeviceInfo(await hands.getDeviceInfo());
    } catch (err: any) { setError(err.message || 'Failed to connect'); }
  };

  const handleDisconnect = async () => { await handsManager.disconnect(); setDeviceInfo(null); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3"><Smartphone className="w-10 h-10" />Android Connection</h1>
          <p className="text-slate-300">Connect to the real Android execution plane on this device</p>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-white">Status</h2>
            <div className="flex items-center gap-2">
              {status === 'connected' && <><CheckCircle className="w-6 h-6 text-green-500" /><span className="text-green-500 font-bold">Connected</span></>}
              {status === 'connecting' && <><RefreshCw className="w-6 h-6 text-blue-500 animate-spin" /><span className="text-blue-500 font-bold">Connecting...</span></>}
              {status === 'disconnected' && <><WifiOff className="w-6 h-6 text-slate-500" /><span className="text-slate-500 font-bold">Disconnected</span></>}
              {status === 'error' && <><XCircle className="w-6 h-6 text-red-500" /><span className="text-red-500 font-bold">Error</span></>}
            </div>
          </div>
          {deviceInfo && <div className="mt-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700"><h3 className="text-sm font-medium text-slate-400 mb-2">Device Info</h3><div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-slate-400">Platform:</span><span className="text-white ml-2">{deviceInfo.platform}</span></div><div><span className="text-slate-400">Model:</span><span className="text-white ml-2">{deviceInfo.model}</span></div><div><span className="text-slate-400">OS Version:</span><span className="text-white ml-2">{deviceInfo.osVersion}</span></div><div><span className="text-slate-400">Screen:</span><span className="text-white ml-2">{deviceInfo.screenWidth}x{deviceInfo.screenHeight}</span></div></div></div>}
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Connection Settings</h2>
          <div className="space-y-4">
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Transport</label><select value={transport} onChange={(e) => setTransport(e.target.value as any)} disabled={status === 'connected' || status === 'connecting'} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"><option value="http">HTTP — local Android execution</option><option value="websocket">WebSocket</option></select></div>
            <div><label className="block text-sm font-medium text-slate-300 mb-2">Endpoint</label><input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={status === 'connected' || status === 'connecting'} className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white" /><p className="text-xs text-slate-400 mt-1">Svetlana-App exposes the real execution API on loopback port 8765.</p></div>
            {error && <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg"><div className="flex items-start gap-2"><AlertCircle className="w-5 h-5 text-red-400" /><div><p className="text-red-400 font-medium">Connection Error</p><p className="text-red-300 text-sm mt-1">{error}</p></div></div></div>}
            {status === 'connected' ? <button onClick={handleDisconnect} className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-medium"><WifiOff className="w-5 h-5" />Disconnect</button> : <button onClick={handleConnect} disabled={status === 'connecting' || !endpoint} className="flex items-center gap-2 px-6 py-3 bg-purple-600 disabled:bg-slate-600 text-white rounded-lg font-medium">{status === 'connecting' ? <><RefreshCw className="w-5 h-5 animate-spin" />Connecting...</> : <><Wifi className="w-5 h-5" />Connect</>}</button>}
          </div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
          <h2 className="text-2xl font-bold text-white mb-4">Android setup</h2>
          <ol className="space-y-3 text-slate-300"><li>1. Install Svetlana-App.</li><li>2. Open Android Accessibility settings and enable Svetlana.</li><li>3. Keep Svetlana-App running; its loopback execution server starts automatically.</li><li>4. On the same Android device open this Control Plane and connect to http://127.0.0.1:8765.</li></ol>
          <div className="mt-6 p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg"><p className="text-yellow-300 text-sm"><strong>Runtime evidence rule:</strong> Connected means the HTTP health check succeeded. An action is considered successful only after Android returns success and the verification layer observes the expected state.</p></div>
        </div>
      </div>
    </div>
  );
}
