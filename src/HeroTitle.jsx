import {
  useEffect,
  useMemo,
  useRef,
} from 'react';

// A Thai-safe composition of the ReactBits Split Text, Shiny Text, and
// Text Pressure interaction patterns.
// https://reactbits.dev/text-animations/split-text
// https://reactbits.dev/text-animations/shiny-text
// https://reactbits.dev/text-animations/text-pressure

const BASE_COLOR = [99, 89, 133];
const SHINE_COLOR = [255, 255, 255];

const mixColor = (from, to, amount) => (
  `rgb(${from.map((channel, index) => Math.round(
    channel + (to[index] - channel) * amount,
  )).join(' ')})`
);

export default function HeroTitle({ text }) {
  const containerRef = useRef(null);
  const characterRefs = useRef([]);
  const characters = useMemo(() => [...text], [text]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const pointer = { x: 0, y: 0 };
    const easedPointer = { x: 0, y: 0 };
    let animationFrame = 0;
    let isRunning = false;
    let animationStartedAt = performance.now();
    let elapsedBeforePause = 0;

    const centerPointer = () => {
      const rect = container.getBoundingClientRect();
      pointer.x = rect.left + rect.width / 2;
      pointer.y = rect.top + rect.height / 2;
      easedPointer.x = pointer.x;
      easedPointer.y = pointer.y;
    };
    const handlePointerMove = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const handleTouchMove = (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      pointer.x = touch.clientX;
      pointer.y = touch.clientY;
    };

    const paintStaticFrame = () => {
      characterRefs.current.forEach((character) => {
        if (!character) return;
        character.style.fontWeight = '800';
        character.style.transform = 'scaleX(1)';
        character.style.color = mixColor(BASE_COLOR, SHINE_COLOR, 0.35);
      });
    };

    const render = (timestamp) => {
      if (!isRunning) return;
      const rect = container.getBoundingClientRect();
      const maxDistance = Math.max(rect.width * 0.62, 1);
      const elapsed = elapsedBeforePause + (timestamp - animationStartedAt);
      const shineCycle = elapsed % 4200;
      const shineProgress = Math.min(1, shineCycle / 2500);
      const shineCenter = shineCycle <= 2500
        ? -0.24 + shineProgress * 1.48
        : 1.4;

      easedPointer.x += (pointer.x - easedPointer.x) / 13;
      easedPointer.y += (pointer.y - easedPointer.y) / 13;

      const characterRects = characterRefs.current.map((character) => (
        character?.getBoundingClientRect() || null
      ));
      const updates = characterRects.map((characterRect, index) => {
        if (!characterRect || !characters[index].trim()) return null;
        const characterCenterX = characterRect.left + characterRect.width / 2;
        const characterCenterY = characterRect.top + characterRect.height / 2;
        const pointerDistance = Math.hypot(
          easedPointer.x - characterCenterX,
          easedPointer.y - characterCenterY,
        );
        const pressure = Math.max(0, 1 - pointerDistance / maxDistance);
        const smoothPressure = pressure * pressure * (3 - 2 * pressure);
        const characterPosition = rect.width > 0
          ? (characterCenterX - rect.left) / rect.width
          : 0.5;
        const shineDistance = Math.abs(characterPosition - shineCenter);
        const shine = Math.exp(-Math.pow(shineDistance / 0.16, 2));
        return {
          weight: `${Math.round((480 + smoothPressure * 420) / 20) * 20}`,
          transform: `scaleX(${(0.88 + smoothPressure * 0.24).toFixed(3)})`,
          color: mixColor(BASE_COLOR, SHINE_COLOR, 0.12 + shine * 0.88),
        };
      });

      characterRefs.current.forEach((character, index) => {
        const update = updates[index];
        if (!character || !update) return;
        if (character.style.fontWeight !== update.weight) {
          character.style.fontWeight = update.weight;
        }
        if (character.style.transform !== update.transform) {
          character.style.transform = update.transform;
        }
        if (character.style.color !== update.color) {
          character.style.color = update.color;
        }
      });

      animationFrame = window.requestAnimationFrame(render);
    };

    const stop = () => {
      if (!isRunning) return;
      elapsedBeforePause += performance.now() - animationStartedAt;
      isRunning = false;
      window.cancelAnimationFrame(animationFrame);
    };
    const start = () => {
      stop();
      if (document.hidden || motionPreference.matches || coarsePointer.matches) {
        paintStaticFrame();
        return;
      }
      animationStartedAt = performance.now();
      isRunning = true;
      animationFrame = window.requestAnimationFrame(render);
    };
    const syncAnimation = () => start();

    centerPointer();
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('resize', centerPointer);
    document.addEventListener('visibilitychange', syncAnimation);
    motionPreference.addEventListener?.('change', syncAnimation);
    coarsePointer.addEventListener?.('change', syncAnimation);
    start();

    return () => {
      stop();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('resize', centerPointer);
      document.removeEventListener('visibilitychange', syncAnimation);
      motionPreference.removeEventListener?.('change', syncAnimation);
      coarsePointer.removeEventListener?.('change', syncAnimation);
    };
  }, [characters]);

  return (
    <h1 className="animated-title react-bits-title" aria-label={text}>
      <span
        ref={containerRef}
        className="pressure-shine-title"
        aria-hidden="true"
      >
        {characters.map((character, index) => (
          <span
            className={character.trim() ? 'pressure-shine-character' : 'pressure-shine-space'}
            key={`${character}-${index}`}
            ref={(element) => {
              characterRefs.current[index] = element;
            }}
          >
            {character === ' ' ? '\u00A0' : character}
          </span>
        ))}
      </span>
    </h1>
  );
}
