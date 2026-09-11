// Hands Manager - Manages connection to real Android device
import type { PlatformHands, PlatformHandsConfig, ConnectionStatus } from './PlatformHands';
import { WebSocketHands } from './WebSocketHands';
import { HTTPHands } from './HTTPHands';

export class HandsManager {
  private hands: PlatformHands | null = null;
  private config: PlatformHandsConfig | null = null;
  private status: ConnectionStatus = 'disconnected';
  private listeners: ((status: ConnectionStatus) => void)[] = [];

  async connect(config: PlatformHandsConfig): Promise<void> {
    this.config = config;
    this.setStatus('connecting');

    try {
      if (config.transport === 'websocket') {
        this.hands = new WebSocketHands(config);
      } else if (config.transport === 'http') {
        this.hands = new HTTPHands(config);
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      await this.hands.connect();
      this.setStatus('connected');
      console.log('[HandsManager] Connected to Android device');
    } catch (error) {
      this.setStatus('error');
      this.hands = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.hands) {
      await this.hands.disconnect();
      this.hands = null;
      this.setStatus('disconnected');
    }
  }

  getHands(): PlatformHands | null {
    return this.hands;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getConfig(): PlatformHandsConfig | null {
    return this.config;
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.listeners.forEach(listener => listener(status));
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  async isConnected(): Promise<boolean> {
    if (!this.hands) return false;
    return await this.hands.isConnected();
  }
}

// Global singleton
export const handsManager = new HandsManager();
