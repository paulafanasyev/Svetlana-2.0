import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export type AvatarEmotion = 'neutral' | 'happy' | 'sad' | 'laughing' | 'crying' | 'surprised' | 'talking';
type MouthShape = 'closed' | 'soft' | 'open' | 'wide' | 'round' | 'smile' | 'frown';

interface AnimatedAvatarFaceProps {
  src: string;
  emotion: AvatarEmotion;
  talking: boolean;
  speechText?: string;
  reducedMotion?: boolean;
}

/** A lightweight face rig over Svetlana's existing portrait; no WebGL or large runtime required. */
export default function AnimatedAvatarFace({
  src,
  emotion,
  talking,
  speechText = '',
  reducedMotion = false,
}: AnimatedAvatarFaceProps) {
  const [blinking, setBlinking] = useState(false);
  const [mouth, setMouth] = useState<MouthShape>('smile');

  // Natural occasional blinks. Respect the operating-system "reduce motion" preference.
  useEffect(() => {
    if (reducedMotion) {
      setBlinking(false);
      return;
    }

    let blinkTimer: ReturnType<typeof setTimeout>;
    let reopenTimer: ReturnType<typeof setTimeout>;
    let disposed = false;
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (disposed) return;
        setBlinking(true);
        reopenTimer = setTimeout(() => {
          if (disposed) return;
          setBlinking(false);
          // A small chance of a quick double-blink looks more natural than a metronome.
          if (Math.random() < 0.16) {
            reopenTimer = setTimeout(() => {
              if (disposed) return;
              setBlinking(true);
              reopenTimer = setTimeout(() => {
                if (disposed) return;
                setBlinking(false);
                scheduleBlink();
              }, 105);
            }, 125);
          } else {
            scheduleBlink();
          }
        }, 115);
      }, 1900 + Math.random() * 2500);
    };
    scheduleBlink();
    return () => {
      disposed = true;
      clearTimeout(blinkTimer);
      clearTimeout(reopenTimer);
    };
  }, [reducedMotion]);

  // Drive mouth poses from the text being spoken. This works with browser and native TTS;
  // native speech engines do not consistently expose phoneme events, so timing is approximate.
  useEffect(() => {
    if (!talking) {
      setMouth(restingMouth(emotion));
      return;
    }
    if (reducedMotion) {
      setMouth('soft');
      return;
    }

    const chars = Array.from((speechText || 'говорю').toLowerCase());
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const char = chars[index % chars.length] ?? '';
      setMouth(shapeForCharacter(char));
      index += 1;
      const pause = /[.,!?;:…\n]/.test(char) ? 210 : /\s/.test(char) ? 105 : 88;
      timer = setTimeout(tick, pause);
    };
    tick();
    return () => clearTimeout(timer);
  }, [talking, speechText, emotion, reducedMotion]);

  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="animated-avatar-face" data-emotion={emotion} data-talking={talking ? 'true' : 'false'}>
      <motion.div
        className="absolute inset-0"
        animate={reducedMotion ? {} : talking
          ? { y: [0, -1, 0], rotate: [0, -0.12, 0, 0.12, 0], scale: [1, 1.004, 1] }
          : { y: [0, -1.2, 0], rotate: [0, -0.16, 0, 0.16, 0], scale: [1, 1.002, 1] }}
        transition={reducedMotion ? { duration: 0 } : { duration: talking ? 1.25 : 4.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <img
          src={src}
          alt="Светлана"
          draggable={false}
          className="h-full w-full select-none object-cover"
        />

        {/* Animated eyelids are placed over the illustrated portrait's eye line. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[50%] transition-opacity duration-75"
          style={{
            left: '27.5%', top: '37.5%', width: '19%', height: '9%',
            opacity: blinking ? 1 : 0,
            background: 'linear-gradient(180deg, #f8c69f 0%, #efae83 70%, #cf8d6a 100%)',
            borderBottom: '1px solid rgba(111, 63, 44, .52)',
            boxShadow: '0 2px 2px rgba(96, 54, 37, .14)',
            transform: 'rotate(-4deg)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[50%] transition-opacity duration-75"
          style={{
            left: '49.5%', top: '36.5%', width: '19.5%', height: '9%',
            opacity: blinking ? 1 : 0,
            background: 'linear-gradient(180deg, #f8c69f 0%, #efae83 70%, #cf8d6a 100%)',
            borderBottom: '1px solid rgba(111, 63, 44, .52)',
            boxShadow: '0 2px 2px rgba(96, 54, 37, .14)',
            transform: 'rotate(3deg)',
          }}
        />

        {/* Soft mask hides the original fixed smile while the rig draws a changing mouth shape. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[50%]"
          style={{
            left: '38.5%', top: '52.5%', width: '23%', height: '13%',
            background: 'radial-gradient(ellipse at 50% 43%, rgba(245, 181, 140, .99) 0%, rgba(241, 174, 133, .94) 64%, rgba(241, 174, 133, 0) 100%)',
            filter: 'blur(1.1px)',
            opacity: .98,
          }}
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 100 80"
          preserveAspectRatio="none"
          className="pointer-events-none absolute overflow-visible"
          style={{ left: '39.5%', top: '53%', width: '21%', height: '11.5%' }}
          data-testid="avatar-mouth"
          data-mouth-shape={talking ? mouth : restingMouth(emotion)}
        >
          <defs>
            <linearGradient id="sv-mouth-lip" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d77c7b" />
              <stop offset="100%" stopColor="#a94755" />
            </linearGradient>
          </defs>
          {mouth === 'closed' && (
            <path d="M12 39 Q50 62 88 39 Q50 52 12 39" fill="none" stroke="url(#sv-mouth-lip)" strokeWidth="5.5" strokeLinecap="round" />
          )}
          {mouth === 'smile' && (
            <>
              <path d="M10 30 Q50 62 90 30 Q82 66 50 68 Q18 66 10 30Z" fill="#a74754" />
              <path d="M17 34 Q50 52 83 34 L77 45 Q50 57 23 45Z" fill="#fff0dd" />
              <path d="M24 48 Q50 61 76 48 Q63 70 50 68 Q37 70 24 48Z" fill="#c65d70" />
            </>
          )}
          {mouth === 'frown' && (
            <path d="M13 56 Q50 29 87 56" fill="none" stroke="url(#sv-mouth-lip)" strokeWidth="6" strokeLinecap="round" />
          )}
          {mouth === 'round' && (
            <>
              <ellipse cx="50" cy="43" rx="19" ry="27" fill="#b85765" />
              <ellipse cx="50" cy="43" rx="13" ry="21" fill="#672b38" />
              <ellipse cx="50" cy="58" rx="7" ry="4" fill="#cf6977" opacity=".7" />
            </>
          )}
          {mouth === 'open' && (
            <>
              <path d="M12 30 Q50 59 88 30 Q84 72 50 74 Q16 72 12 30Z" fill="#a34453" />
              <path d="M20 35 Q50 53 80 35 L75 47 Q50 59 25 47Z" fill="#fff0df" />
              <path d="M28 58 Q50 65 72 58 Q62 74 50 73 Q38 74 28 58Z" fill="#bd5168" />
            </>
          )}
          {mouth === 'wide' && (
            <>
              <path d="M10 33 Q50 66 90 33 Q80 70 50 72 Q20 70 10 33Z" fill="#9f3c4c" />
              <path d="M17 36 Q50 53 83 36 L78 47 Q50 60 22 47Z" fill="#fff4e3" />
              <path d="M29 58 Q50 63 71 58 Q62 72 50 72 Q38 72 29 58Z" fill="#c55269" />
            </>
          )}
          {mouth === 'soft' && (
            <path d="M17 38 Q50 57 83 38 Q50 49 17 38Z" fill="#b75563" stroke="#d17a7d" strokeWidth="2.2" strokeLinejoin="round" />
          )}
        </svg>
      </motion.div>
    </div>
  );
}

function restingMouth(emotion: AvatarEmotion): MouthShape {
  switch (emotion) {
    case 'happy': return 'smile';
    case 'sad':
    case 'crying': return 'frown';
    case 'laughing': return 'wide';
    case 'surprised': return 'round';
    case 'talking': return 'soft';
    default: return 'closed';
  }
}

function shapeForCharacter(char: string): MouthShape {
  if (!char || /[\s.,!?;:…\n]/.test(char)) return 'closed';
  if (/[бпм]/.test(char)) return 'closed';
  if (/[оёую]/.test(char)) return 'round';
  if (/[а]/.test(char)) return 'open';
  if (/[яэыие]/.test(char)) return 'wide';
  if (/[фв]/.test(char)) return 'soft';
  return 'open';
}
