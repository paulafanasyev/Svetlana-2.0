import { describe, it, expect } from 'vitest';
// @ts-ignore — node-модули доступны в тестах (environment: node)
import { readFileSync } from 'node:fs';
// @ts-ignore
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(p), 'utf8');

describe('avatar shows when Svetlana listens and talks', () => {
  const avatar = read('src/components/Avatar.tsx');
  const face = read('src/components/AnimatedAvatarFace.tsx');
  const page = read('src/pages/AvatarPage.tsx');

  it('indicators come from props, not from frozen state', () => {
    expect(avatar).not.toMatch(/const \[isTalking\] = useState/);
    expect(avatar).not.toMatch(/const \[isListening\] = useState/);
    expect(avatar).toContain('talking = false, listening = false');
    expect(avatar).toContain('data-testid="avatar-listening"');
    expect(avatar).toContain('<AnimatedAvatarFace');
    expect(avatar).toContain('talking={isTalking}');
    expect(face).toContain('data-testid="animated-avatar-face"');
    expect(face).toContain('data-testid="avatar-mouth"');
    expect(avatar).toContain('role="status" data-testid="avatar-state"');
  });

  it('microphone state is reported to the page and cleared on leave', () => {
    expect(avatar).toContain('onListeningChange?: (listening: boolean) => void');
    expect(avatar).toContain('useEffect(() => { onListeningRef.current?.(isListening); }, [isListening]);');
    expect(avatar).toContain('onListeningRef.current?.(false); }, []);');
  });

  it('chat page wires microphone and speech to the avatar', () => {
    expect(page).toContain('const [listening, setListening] = useState(false);');
    expect(page).toContain('talking={isSpeaking} listening={listening}');
    expect(page).toContain('speechText={speechText}');
    expect(page).toContain('<VoiceControl onCommand={handleVoiceCommand} onListeningChange={setListening} />');
  });
});
