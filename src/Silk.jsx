import { useEffect, useRef } from 'react';

// The original ReactBits Silk fragment shader, hosted on a lightweight
// fullscreen WebGL canvas to avoid loading a full 3D renderer at startup.
// https://reactbits.dev/backgrounds/silk
const vertexShader = `
  attribute vec2 position;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;

  uniform vec2 uResolution;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uSpeed;
  uniform float uScale;
  uniform float uRotation;
  uniform float uNoiseIntensity;

  const float e = 2.71828182845904523536;

  float noise(vec2 texCoord) {
    float G = e;
    vec2 r = G * sin(G * texCoord);
    return fract(r.x * r.y * (1.0 + texCoord.x));
  }

  vec2 rotateUvs(vec2 uv, float angle) {
    float cosine = cos(angle);
    float sine = sin(angle);
    return mat2(cosine, -sine, sine, cosine) * uv;
  }

  void main() {
    float randomValue = noise(gl_FragCoord.xy);
    vec2 viewportUv = gl_FragCoord.xy / uResolution;
    vec2 uv = rotateUvs(viewportUv * uScale, uRotation);
    vec2 texturePoint = uv * uScale;
    float timeOffset = uSpeed * uTime;

    texturePoint.y += 0.03 * sin(8.0 * texturePoint.x - timeOffset);

    float pattern = 0.6 +
      0.4 * sin(
        5.0 * (
          texturePoint.x + texturePoint.y +
          cos(3.0 * texturePoint.x + 5.0 * texturePoint.y) +
          0.02 * timeOffset
        ) +
        sin(20.0 * (texturePoint.x + texturePoint.y - 0.1 * timeOffset))
      );

    vec4 color = vec4(uColor, 1.0) * pattern
      - randomValue / 15.0 * uNoiseIntensity;
    gl_FragColor = vec4(color.rgb, 1.0);
  }
`;

const hexToRgb = (hex) => {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
};

const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Could not compile the Silk shader:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

export default function Silk({
  speed = 5,
  scale = 1,
  color = '#443C68',
  noiseIntensity = 1.5,
  rotation = 0,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return undefined;

    const compiledVertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShader);
    const compiledFragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    if (!compiledVertexShader || !compiledFragmentShader) return undefined;

    const program = gl.createProgram();
    gl.attachShader(program, compiledVertexShader);
    gl.attachShader(program, compiledFragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(compiledVertexShader);
    gl.deleteShader(compiledFragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Could not link the Silk shader:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return undefined;
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

    const resolutionLocation = gl.getUniformLocation(program, 'uResolution');
    const timeLocation = gl.getUniformLocation(program, 'uTime');
    const colorLocation = gl.getUniformLocation(program, 'uColor');
    const speedLocation = gl.getUniformLocation(program, 'uSpeed');
    const scaleLocation = gl.getUniformLocation(program, 'uScale');
    const rotationLocation = gl.getUniformLocation(program, 'uRotation');
    const noiseLocation = gl.getUniformLocation(program, 'uNoiseIntensity');
    const rgb = hexToRgb(color);
    gl.uniform3f(colorLocation, rgb[0], rgb[1], rgb[2]);
    gl.uniform1f(speedLocation, speed);
    gl.uniform1f(scaleLocation, scale);
    gl.uniform1f(rotationLocation, rotation);
    gl.uniform1f(noiseLocation, noiseIntensity);

    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    let startedAt = performance.now();
    let elapsedBeforePause = 0;
    let isRunning = false;

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
      const maxPixels = 1_600_000;
      const bounds = canvas.parentElement?.getBoundingClientRect();
      const cssWidth = bounds?.width || canvas.clientWidth || window.innerWidth;
      const cssHeight = bounds?.height || canvas.clientHeight || window.innerHeight;
      const desiredWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
      const desiredHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
      const resolutionScale = Math.min(
        1,
        Math.sqrt(maxPixels / (desiredWidth * desiredHeight)),
      );
      const width = Math.max(1, Math.round(desiredWidth * resolutionScale));
      const height = Math.max(1, Math.round(desiredHeight * resolutionScale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolutionLocation, width, height);
    };

    const draw = (timestamp, staticFrame = false) => {
      resize();
      const elapsed = staticFrame
        ? 1.8
        : elapsedBeforePause + (timestamp - startedAt) / 1000;
      gl.uniform1f(timeLocation, elapsed * 0.1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const render = (timestamp) => {
      if (!isRunning) return;
      draw(timestamp);
      animationFrame = window.requestAnimationFrame(render);
    };
    const stop = () => {
      if (!isRunning) return;
      elapsedBeforePause += (performance.now() - startedAt) / 1000;
      isRunning = false;
      window.cancelAnimationFrame(animationFrame);
    };
    const start = () => {
      stop();
      if (document.hidden || motionPreference.matches) {
        draw(performance.now(), true);
        return;
      }
      startedAt = performance.now();
      draw(startedAt);
      isRunning = true;
      animationFrame = window.requestAnimationFrame(render);
    };
    const handleResize = () => {
      resize();
      if (!isRunning) draw(performance.now(), motionPreference.matches);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas.parentElement || canvas);
    resize();
    start();
    window.addEventListener('resize', handleResize);
    document.addEventListener('visibilitychange', start);
    motionPreference.addEventListener?.('change', start);

    return () => {
      stop();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', start);
      motionPreference.removeEventListener?.('change', start);
      resizeObserver.disconnect();
      gl.deleteBuffer(vertices);
      gl.deleteProgram(program);
    };
  }, [color, noiseIntensity, rotation, scale, speed]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
}
