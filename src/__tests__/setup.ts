// Общая подготовка тестов: в тестах нет окна подтверждения, поэтому шлюз действий одобряет всё,
// кроме тестов безопасности, которые сбрасывают шлюз (resetActionGate) и проверяют отказы.
import { beforeEach } from 'vitest';
import { resetActionGate, setActionConfirmer } from '../services/security/ActionGate';

beforeEach(() => {
  resetActionGate();
  setActionConfirmer(async () => true);
});
