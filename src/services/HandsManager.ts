// Hands Manager - Manages connection to real Android device
import type { PlatformHands, PlatformHandsConfig, ConnectionStatus } from './PlatformHands';
import { WebSocketHands } from './WebSocketHands';
import { HTTPHands } from './HTTPHands';

/** WebSocket-транспорт не защищён шифрованием: только для отладки на этом же компьютере. */
const LOOPBACK_WS_RE = /^wss?:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9._~-]*)*$/;

export class HandsManager {
  private hands: PlatformHands | null = null;
  private config: PlatformHandsConfig | null = null;
  private status: ConnectionStatus = 'disconnected';
  private listeners: ((status: ConnectionStatus) => void)[] = [];

  async connect(config: PlatformHandsConfig): Promise<void> {
    // Код подключения в памяти не храним дольше, чем нужно для рукопожатия.
    this.config = { ...config, token: undefined };
    this.setStatus('connecting');

    try {
      if (config.transport === 'websocket') {
        if (!LOOPBACK_WS_RE.test(config.endpoint.trim())) {
          throw new Error('WebSocket доступен только для отладки на этом компьютере. Для телефона выберите защищённое подключение HTTP.');
        }
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
