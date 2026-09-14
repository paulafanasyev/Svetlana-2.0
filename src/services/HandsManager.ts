// Local-only Hands manager.
// Remote HTTP/WebSocket control is deliberately unavailable.
import type { PlatformHands, PlatformHandsConfig, ConnectionStatus } from './PlatformHands';

const LOCAL_ONLY_ERROR =
  'Remote Android control is disabled. Svetlana-2.0 executes only through the local Android AccessibilityService bridge on the phone.';

export class HandsManager {
  private hands: PlatformHands | null = null;
  private config: PlatformHandsConfig | null = null;
  private status: ConnectionStatus = 'disconnected';
  private listeners: ((status: ConnectionStatus) => void)[] = [];

  async connect(config: PlatformHandsConfig): Promise<void> {
    this.config = config;
    this.setStatus('error');
    this.hands = null;
    throw new Error(LOCAL_ONLY_ERROR);
  }

  async disconnect(): Promise<void> {
    if (this.hands) await this.hands.disconnect();
    this.hands = null;
    this.setStatus('disconnected');
  }

  getHands(): PlatformHands | null { return this.hands; }
  getStatus(): ConnectionStatus { return this.status; }
  getConfig(): PlatformHandsConfig | null { return this.config; }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.listeners.forEach(listener => listener(status));
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  async isConnected(): Promise<boolean> {
    return this.hands ? await this.hands.isConnected() : false;
  }
}

export const handsManager = new HandsManager();
