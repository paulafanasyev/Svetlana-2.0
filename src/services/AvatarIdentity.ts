// Avatar Identity - Single master face with state overlays

export interface AvatarIdentity {
  id: string;
  name: string;
  masterImage: string;
  description: string;
}

export interface AvatarStateOverlay {
  state: string;
  overlay?: string; // CSS class or image overlay
  animation?: string;
  color?: string;
}

// Single master identity for Svetlana
export const SVETLANA_IDENTITY: AvatarIdentity = {
  id: 'svetlana-master',
  name: 'Светлана',
  masterImage: 'https://image.qwenlm.ai/generated-images/d8b8a3e6-3ce8-4a10-9263-3f2280c94260/_result.png',
  description: 'Единый образ Светланы с динамическими состояниями',
};

// State overlays - applied on top of master image
export const STATE_OVERLAYS: Record<string, AvatarStateOverlay> = {
  idle: {
    state: 'idle',
    overlay: 'opacity-100',
    animation: 'none',
  },
  listening: {
    state: 'listening',
    overlay: 'ring-4 ring-cyan-400 ring-opacity-50',
    animation: 'pulse',
    color: 'cyan',
  },
  thinking: {
    state: 'thinking',
    overlay: 'ring-4 ring-indigo-400 ring-opacity-50',
    animation: 'pulse',
    color: 'indigo',
  },
  speaking: {
    state: 'speaking',
    overlay: 'ring-4 ring-purple-400 ring-opacity-50',
    animation: 'talking',
    color: 'purple',
  },
  executing: {
    state: 'executing',
    overlay: 'ring-4 ring-orange-400 ring-opacity-50',
    animation: 'pulse',
    color: 'orange',
  },
  verifying: {
    state: 'verifying',
    overlay: 'ring-4 ring-yellow-400 ring-opacity-50',
    animation: 'pulse',
    color: 'yellow',
  },
  confirmation_required: {
    state: 'confirmation_required',
    overlay: 'ring-4 ring-red-400 ring-opacity-50',
    animation: 'pulse',
    color: 'red',
  },
  error: {
    state: 'error',
    overlay: 'ring-4 ring-red-500 ring-opacity-75',
    animation: 'shake',
    color: 'red',
  },
  success: {
    state: 'success',
    overlay: 'ring-4 ring-emerald-400 ring-opacity-50',
    animation: 'none',
    color: 'emerald',
  },
  happy: {
    state: 'happy',
    overlay: 'brightness-110',
    animation: 'none',
    color: 'yellow',
  },
  sad: {
    state: 'sad',
    overlay: 'brightness-90 saturate-75',
    animation: 'none',
    color: 'blue',
  },
};

// Emotion to state mapping
export const EMOTION_TO_STATE: Record<string, string> = {
  neutral: 'idle',
  happy: 'happy',
  sad: 'sad',
  laughing: 'happy',
  crying: 'sad',
  surprised: 'thinking',
  talking: 'speaking',
};

export function getAvatarStateOverlay(state: string): AvatarStateOverlay {
  return STATE_OVERLAYS[state] || STATE_OVERLAYS.idle;
}

export function getAvatarStateFromEmotion(emotion: string): string {
  return EMOTION_TO_STATE[emotion] || 'idle';
}
