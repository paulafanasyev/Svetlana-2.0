// Hands Manager - Manages connection to real Android device
import type { PlatformHands, PlatformHandsConfig, ConnectionStatus } from './PlatformHands';
import { WebSocketHands } from './WebSocketHands';
import { HTTPHands } from './HTTPHands';

/** WebSocket-транспорт не защищён шифрованием и не проверяет собеседника: только для отладки на этом же компьютере. */
const LOOPBACK_WS_RE = /^wss?:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?(\/[A-Za-z0-9._~-]*)*$/;

/**
 * Отладочный WebSocket доступен ТОЛЬКО в сборке для разработки (vite dev / тесты). В боевой сборке
 * (сайт и Windows) управление телефоном идёт только через защищённый HTTP-мост v2
 * (шифрование, подпись, защита от повтора).
 */
export function debugTransportAllowed(): boolean {
  const meta = import.meta as unknown as { env?: { DEV?: boolean } };
  return meta.env?.DEV === true;
}

export class HandsManager {
  private hands: PlatformHands | null = null;
  private config: PlatformHandsConfig | null = null;
  private status: ConnectionStatus = 'disconnected';
  private listeners: ((status: ConnectionStatus) => void)[] = [];
  /** Номер попытки подключения: результат старой попытки (или после отключения) ничего не меняет. */
  private gen = 0;

  async connect(config: PlatformHandsConfig): Promise<void> {
    const gen = ++this.gen;
    const prev = this.hands;
    this.hands = null;
    if (prev) { try { await prev.disconnect(); } catch { /* старое подключение уже не нужно */ } }
    if (gen !== this.gen) throw new Error('Подключение отменено: начато новое подключение или телефон отключили.');
    // Код подключения в памяти не храним дольше, чем нужно для рукопожатия.
    this.config = { ...config, token: undefined };
    this.setStatus('connecting');
    let hands: PlatformHands | null = null;

    try {
      if (config.transport === 'websocket') {
        if (!debugTransportAllowed()) {
          throw new Error('Отладочное подключение WebSocket отключено. Для телефона выберите защищённое подключение HTTP.');
        }
        if (!LOOPBACK_WS_RE.test(config.endpoint.trim())) {
          throw new Error('WebSocket доступен только для отладки на этом компьютере. Для телефона выберите защищённое подключение HTTP.');
        }
        hands = new WebSocketHands(config);
      } else if (config.transport === 'http') {
        hands = new HTTPHands(config);
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      await hands.connect();
      if (gen !== this.gen) {
        // Пока шло рукопожатие, начали другое подключение или нажали «Отключить».
        try { await hands.disconnect(); } catch { /* noop */ }
        throw new Error('Подключение отменено: начато новое подключение или телефон отключили.');
      }
      this.hands = hands;
      this.setStatus('connected');
      console.log('[HandsManager] Connected to Android device');
    } catch (error) {
      if (gen === this.gen) {
        this.setStatus('error');
        this.hands = null;
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.gen++; // начатое подключение больше ничего не запишет
    const hands = this.hands;
    this.hands = null;
    if (hands) await hands.disconnect();
    if (this.status !== 'disconnected') this.setStatus('disconnected');
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
