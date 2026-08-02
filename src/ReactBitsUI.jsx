import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
} from 'react';

// These primitives adapt the interaction patterns from ReactBits:
// Star Border, Glare Hover, Spotlight Card, and Click Spark.
// https://reactbits.dev/

export const BitsButton = forwardRef(function BitsButton(
  {
    className = '',
    onPointerMove,
    style,
    ...props
  },
  ref,
) {
  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`);
    onPointerMove?.(event);
  };

  return (
    <button
      ref={ref}
      className={`bits-button ${className}`.trim()}
      onPointerMove={handlePointerMove}
      style={style}
      {...props}
    />
  );
});

export const BitsSurface = forwardRef(function BitsSurface(
  {
    as: Component = 'div',
    className = '',
    spotlightColor = 'rgba(99, 89, 133, 0.24)',
    onPointerMove,
    style,
    ...props
  },
  ref,
) {
  const handlePointerMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty('--mouse-x', `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty('--mouse-y', `${event.clientY - rect.top}px`);
    onPointerMove?.(event);
  };

  return (
    <Component
      ref={ref}
      className={`bits-surface ${className}`.trim()}
      onPointerMove={handlePointerMove}
      style={{ '--spotlight-color': spotlightColor, ...style }}
      {...props}
    />
  );
});

export function ClickSpark({
  as: Component = 'div',
  className = '',
  sparkColor = '#635985',
  sparkSize = 8,
  sparkRadius = 22,
  sparkCount = 8,
  duration = 420,
  children,
  onClick,
  ...props
}) {
  const canvasRef = useRef(null);
  const sparksRef = useRef([]);
  const animationRef = useRef(0);
  const reducedMotionRef = useRef(false);

  const draw = useCallback((timestamp) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    sparksRef.current = sparksRef.current.filter((spark) => {
      const elapsed = timestamp - spark.startedAt;
      if (elapsed >= duration) return false;
      const progress = elapsed / duration;
      const eased = progress * (2 - progress);
      const distance = eased * sparkRadius;
      const lineLength = sparkSize * (1 - eased);
      const startX = spark.x + distance * Math.cos(spark.angle);
      const startY = spark.y + distance * Math.sin(spark.angle);
      const endX = spark.x + (distance + lineLength) * Math.cos(spark.angle);
      const endY = spark.y + (distance + lineLength) * Math.sin(spark.angle);

      context.strokeStyle = sparkColor;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
      context.stroke();
      return true;
    });

    if (sparksRef.current.length > 0) {
      animationRef.current = window.requestAnimationFrame(draw);
    } else {
      animationRef.current = 0;
    }
  }, [duration, sparkColor, sparkRadius, sparkSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => {
      reducedMotionRef.current = reducedMotion.matches;
    };
    const resizeCanvas = () => {
      const rect = parent.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.getContext('2d').setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    syncMotion();
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(parent);
    reducedMotion.addEventListener?.('change', syncMotion);

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener?.('change', syncMotion);
      window.cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || reducedMotionRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const now = performance.now();
    sparksRef.current.push(...Array.from({ length: sparkCount }, (_, index) => ({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      angle: (Math.PI * 2 * index) / sparkCount,
      startedAt: now,
    })));
    if (!animationRef.current) {
      animationRef.current = window.requestAnimationFrame(draw);
    }
  };

  return (
    <Component className={`click-spark ${className}`.trim()} onClick={handleClick} {...props}>
      {children}
      <canvas ref={canvasRef} className="click-spark-canvas" aria-hidden="true" />
    </Component>
  );
}
