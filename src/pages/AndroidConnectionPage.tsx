import { Smartphone, ShieldCheck, AlertTriangle } from 'lucide-react';

export default function AndroidConnectionPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Smartphone className="w-10 h-10" />
            Android execution
          </h1>
          <p className="text-slate-300">Local phone execution only</p>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-7 h-7 text-green-400" />
            <h2 className="text-2xl font-bold text-white">Security boundary</h2>
          </div>
          <ul className="space-y-3 text-slate-300">
            <li>• Svetlana-2.0 operates on the user's phone.</li>
            <li>• Commands are accepted only from the verified/authorized user.</li>
            <li>• Remote control of the phone or Svetlana is prohibited.</li>
            <li>• No HTTP/WebSocket/MCP network transport is used for device control.</li>
            <li>• Hands executes through the local Android AccessibilityService bridge.</li>
            <li>• Sensitive operations remain subject to Policy and user confirmation.</li>
          </ul>
        </div>

        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-7 h-7 text-yellow-400" />
            <h2 className="text-2xl font-bold text-white">Runtime status</h2>
          </div>
          <p className="text-slate-300">
            The native Android AccessibilityService bridge is not yet proven in this web build.
            The page intentionally provides no remote connection controls. This prevents a
            browser, network peer, or external endpoint from becoming a control channel.
          </p>
          <p className="text-slate-400 mt-4 text-sm">
            Required proof remains: APK → AccessibilityService registered → onServiceConnected →
            local Hands action → real Android state change → independent verification.
          </p>
        </div>
      </div>
    </div>
  );
}
