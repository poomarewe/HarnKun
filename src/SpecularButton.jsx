import { useEffect, useRef } from 'react';

// The ReactBits Specular Button shader, hosted directly on WebGL2 so the
// landing page does not need a second rendering library at startup.
// https://reactbits.dev/components/specular-button
const EFFECT_PADDING = 20;

const vertexShader = `#version 300 es
in vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `#version 300 es
precision highp float;

uniform vec2 uCenter;
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uAngle;
uniform float uPx;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform float uShineSize;
uniform float uShineFade;
uniform float uThickness;
uniform float uBaseWidth;

out vec4 fragColor;

float sdRoundedRect(vec2 point, vec2 bounds, float radius) {
  vec2 distance = abs(point) - bounds + radius;
  return length(max(distance, 0.0)) + min(max(distance.x, distance.y), 0.0) - radius;
}

float gaussianLine(float distance, float sigma) {
  float normalized = distance / (sigma + 1e-6);
  float curve = mix(1.0, 1.6, smoothstep(0.0, 1.5, normalized));
  return exp(-curve * normalized * normalized);
}

void main() {
  vec2 point = gl_FragCoord.xy - uCenter;
  float distance = sdRoundedRect(point, uHalfSize, uRadius);
  vec2 light = vec2(cos(uAngle), sin(uAngle));
  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(distance))) * 0.45;
  vec2 normal = normalize(point / (uHalfSize * uHalfSize) + 1e-6);
  float phi = acos(clamp(abs(dot(normal, light)), 0.0, 1.0));
  float rim = 1.0 - smoothstep(
    uShineSize - uShineFade,
    uShineSize + uShineFade + 1e-4,
    phi
  );
  float line = gaussianLine(distance, uThickness);
  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(distance));
  float highlight = line * rim * edgeClamp * uIntensity;
  vec3 color = uBaseColor * base + uLineColor * highlight;
  float alpha = clamp(base + highlight, 0.0, 1.0);
  fragColor = vec4(color, alpha);
}
`;

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Could not compile the Specular Button shader:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const hexToRgb = (hex) => {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
};

export default function SpecularButton({
  children = 'Get Started',
  size = 'lg',
  radius = 18,
  tint = '#635985',
  tintOpacity = 0.42,
  blur = 14,
  textColor = '#ffffff',
  lineColor = '#ffffff',
  baseColor = '#443C68',
  intensity = 1.35,
  shineSize = 12,
  shineFade = 42,
  thickness = 1.2,
  speed = 0.32,
  followMouse = true,
  proximity = 250,
  autoAnimate = true,
  disabled = false,
  className = '',
  type = 'button',
  ...buttonProps
}) {
  const buttonRef = useRef(null);
  const canvasRef = useRef(null);
  const propsRef = useRef({});

  propsRef.current = {
    radius,
    lineColor,
    baseColor,
    intensity,
    shineSize,
    shineFade,
    thickness,
    speed,
    followMouse,
    proximity,
    autoAnimate,
  };

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    if (reducedMotion.matches || coarsePointer.matches || window.innerWidth <= 699) {
      return undefined;
    }

    let disposeRenderer = () => {};
    let idleHandle = 0;
    let delayHandle = 0;
    let isDisposed = false;

    const initialize = () => {
      if (isDisposed) return;
      const button = buttonRef.current;
      const canvas = canvasRef.current;
      const gl = canvas?.getContext('webgl2', {
        alpha: true,
        antialias: true,
        depth: false,
        premultipliedAlpha: false,
        powerPreference: 'low-power',
      });
      if (!button || !canvas || !gl) return;

      const compiledVertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
      const compiledFragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
      if (!compiledVertexShader || !compiledFragmentShader) return;

      const program = gl.createProgram();
      gl.attachShader(program, compiledVertexShader);
      gl.attachShader(program, compiledFragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(compiledVertexShader);
      gl.deleteShader(compiledFragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Could not link the Specular Button shader:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return;
      }

      const vertices = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const uniforms = {
        center: gl.getUniformLocation(program, 'uCenter'),
        halfSize: gl.getUniformLocation(program, 'uHalfSize'),
        radius: gl.getUniformLocation(program, 'uRadius'),
        angle: gl.getUniformLocation(program, 'uAngle'),
        pixelRatio: gl.getUniformLocation(program, 'uPx'),
        lineColor: gl.getUniformLocation(program, 'uLineColor'),
        baseColor: gl.getUniformLocation(program, 'uBaseColor'),
        intensity: gl.getUniformLocation(program, 'uIntensity'),
        shineSize: gl.getUniformLocation(program, 'uShineSize'),
        shineFade: gl.getUniformLocation(program, 'uShineFade'),
        thickness: gl.getUniformLocation(program, 'uThickness'),
        baseWidth: gl.getUniformLocation(program, 'uBaseWidth'),
      };
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const dimensions = { width: 1, height: 1 };
      const resize = () => {
        const rect = button.getBoundingClientRect();
        dimensions.width = rect.width;
        dimensions.height = rect.height;
        canvas.width = Math.max(
          1,
          Math.round((rect.width + EFFECT_PADDING * 2) * pixelRatio),
        );
        canvas.height = Math.max(
          1,
          Math.round((rect.height + EFFECT_PADDING * 2) * pixelRatio),
        );
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(
          uniforms.center,
          (EFFECT_PADDING + rect.width / 2) * pixelRatio,
          (EFFECT_PADDING + rect.height / 2) * pixelRatio,
        );
        gl.uniform2f(
          uniforms.halfSize,
          (rect.width / 2) * pixelRatio,
          (rect.height / 2) * pixelRatio,
        );
      };
      const resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(button);
      resize();

      let pointerAngle = null;
      let proximityAmount = 0;
      const handlePointerMove = (event) => {
        const rect = button.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
        const deltaY = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
        const distance = Math.hypot(deltaX, deltaY);

        if (distance === 0) {
          const normalizedX = (event.clientX - centerX) / (rect.width / 2);
          const normalizedY = (centerY - event.clientY) / (rect.height / 2);
          pointerAngle = Math.atan2(2 / rect.height, -2 / rect.width)
            + normalizedX * 0.3
            + normalizedY * 0.15;
        } else {
          pointerAngle = Math.atan2(centerY - event.clientY, event.clientX - centerX);
        }
        const amount = Math.max(
          0,
          1 - distance / Math.max(propsRef.current.proximity, 1),
        );
        proximityAmount = amount * amount * (3 - 2 * amount);
      };
      window.addEventListener('pointermove', handlePointerMove);

      const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      let angle = 2.4;
      let idleAngle = 2.4;
      let brightness = 0;
      let previousTime = performance.now();
      let animationFrame = 0;
      let isRunning = false;

      const render = (time) => {
        if (!isRunning) return;
        const delta = Math.min((time - previousTime) / 1000, 0.05);
        previousTime = time;
        const values = propsRef.current;
        const reducedMotion = motionPreference.matches;

        if (!reducedMotion) idleAngle += values.speed * delta;
        const followsPointer = values.followMouse
          && pointerAngle !== null
          && (!values.autoAnimate || proximityAmount > 0);
        const targetAngle = followsPointer ? pointerAngle : idleAngle;
        const difference = ((targetAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        angle += difference * (1 - Math.exp(-delta * 7));
        const brightnessTarget = reducedMotion
          ? 0.82
          : values.autoAnimate
            ? 1
            : proximityAmount;
        brightness += (brightnessTarget - brightness) * (1 - Math.exp(-delta * 8));

        const lineRgb = hexToRgb(values.lineColor);
        const baseRgb = hexToRgb(values.baseColor);
        gl.uniform1f(uniforms.angle, angle);
        gl.uniform1f(
          uniforms.radius,
          Math.min(
            values.radius,
            Math.min(dimensions.width, dimensions.height) / 2,
          ) * pixelRatio,
        );
        gl.uniform1f(uniforms.pixelRatio, pixelRatio);
        gl.uniform3f(uniforms.lineColor, ...lineRgb);
        gl.uniform3f(uniforms.baseColor, ...baseRgb);
        gl.uniform1f(uniforms.intensity, values.intensity * brightness);
        gl.uniform1f(uniforms.shineSize, (values.shineSize * Math.PI) / 180);
        gl.uniform1f(uniforms.shineFade, (values.shineFade * Math.PI) / 180);
        gl.uniform1f(uniforms.thickness, values.thickness * pixelRatio);
        gl.uniform1f(uniforms.baseWidth, pixelRatio);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        if (!reducedMotion) {
          animationFrame = window.requestAnimationFrame(render);
        } else {
          isRunning = false;
        }
      };
      const stop = () => {
        isRunning = false;
        window.cancelAnimationFrame(animationFrame);
      };
      const start = () => {
        stop();
        if (document.hidden) return;
        isRunning = true;
        previousTime = performance.now();
        animationFrame = window.requestAnimationFrame(render);
      };

      document.addEventListener('visibilitychange', start);
      motionPreference.addEventListener?.('change', start);
      start();

      disposeRenderer = () => {
        stop();
        resizeObserver.disconnect();
        window.removeEventListener('pointermove', handlePointerMove);
        document.removeEventListener('visibilitychange', start);
        motionPreference.removeEventListener?.('change', start);
        gl.deleteBuffer(vertices);
        gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      };
    };

    // Let the first title entrance and the main background claim the initial
    // frame budget. The button remains fully usable with its CSS border.
    delayHandle = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idleHandle = window.requestIdleCallback(initialize, { timeout: 1000 });
      } else {
        initialize();
      }
    }, 900);

    return () => {
      isDisposed = true;
      window.clearTimeout(delayHandle);
      if ('cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
      disposeRenderer();
    };
  }, []);

  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      className={`specular-button specular-button--${size}${className ? ` ${className}` : ''}`}
      style={{
        '--sb-radius': `${radius}px`,
        '--sb-tint': tint,
        '--sb-tint-opacity': tintOpacity,
        '--sb-blur': `${blur}px`,
        '--sb-text-color': textColor,
      }}
      {...buttonProps}
    >
      <canvas ref={canvasRef} className="specular-button__effect" aria-hidden="true" />
      <span className="specular-button__label">{children}</span>
    </button>
  );
}
