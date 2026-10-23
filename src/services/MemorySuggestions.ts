/**
 * Small local-only heuristic for reviewable memory suggestions.
 * This does not call a model or persist anything. Users must explicitly approve
 * each candidate before PersonalWorkspaceStore writes it.
 */
import { redactSecrets } from './security/Redact';

const MAX_CANDIDATE_LENGTH = 220;
const SENSITIVE_CONTEXT = /diagnos|medication|лекарств|диагноз|болезн|симптом|лечени|терапи|беременност|религи|вероисповедан|политическ|сексуальн|кредитн|банковск|паспорт|социальн\s+страхован/i;
const SECRET_CONTEXT = /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|client[_ -]?secret)\s*[:=]|\bBearer\s+\S{12,})/i;

const STABLE_PREFERENCE_PATTERNS: RegExp[] = [
  /^(?:я предпочитаю|я обычно предпочитаю|мне удобнее|мне нравится|мне важно|предпочитаю)\s+[^.!?\n]{5,190}[.!?]?$/i,
  /^(?:пожалуйста[, ]+)?(?:всегда\s+)?(?:отвечай|пиши|показывай)\s+(?:мне\s+)?[^.!?\n]{5,190}[.!?]?$/i,
  /^(?:my preference is|i prefer|please always|always respond|please respond)\s+[^.!?\n]{5,190}[.!?]?$/i,
];

function normalize(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Return stable-looking preference statements found in a single user message.
 * Candidates are bounded, deduplicated, and deliberately exclude likely sensitive
 * contexts or content that looks like it contains credentials/contact data.
 */
export function suggestMemoryCandidates(message: string, existingMemories: string[] = []): string[] {
  if (typeof message !== 'string') return [];
  const normalized = normalize(message);
  if (!normalized || normalized.length > MAX_CANDIDATE_LENGTH || /[\x60{}<>]/.test(normalized)) return [];
  if (SECRET_CONTEXT.test(normalized) || SENSITIVE_CONTEXT.test(normalized)) return [];

  const candidate = STABLE_PREFERENCE_PATTERNS.some(pattern => pattern.test(normalized))
    ? redactSecrets(normalized).trim()
    : '';
  if (!candidate || candidate.length > MAX_CANDIDATE_LENGTH) return [];

  const key = candidate.toLocaleLowerCase();
  if (existingMemories.some(item => normalize(item).toLocaleLowerCase() === key)) return [];
  return [candidate];
}
