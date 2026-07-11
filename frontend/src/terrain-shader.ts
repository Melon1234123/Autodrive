export const TERRAIN_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const TERRAIN_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uContourDensity;
  uniform float uLineStrength;
  uniform float uOpacity;
  uniform vec3 uColor0;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uLineColor;

  float random(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 curve = local * local * (3.0 - 2.0 * local);
    float a = random(cell);
    float b = random(cell + vec2(1.0, 0.0));
    float c = random(cell + vec2(0.0, 1.0));
    float d = random(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
  }

  float fbm(vec2 point) {
    float value = 0.0;
    float amplitude = 0.52;
    mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);
    for (int octave = 0; octave < 5; octave++) {
      value += amplitude * noise(point);
      point = rotation * point * 2.03 + vec2(17.2, 9.4);
      amplitude *= 0.49;
    }
    return value;
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    vec2 point = (vUv - 0.5) * vec2(aspect, 1.0);
    float drift = uTime * uSpeed;
    vec2 warp = vec2(
      fbm(point * 1.45 + vec2(drift * 0.13, -drift * 0.09)),
      fbm(point * 1.35 + vec2(8.7 - drift * 0.08, 4.1 + drift * 0.11))
    ) - 0.5;
    float height = clamp(fbm(point * 2.05 + warp * 1.55 + vec2(drift * 0.08, -drift * 0.05)), 0.0, 1.0);
    vec3 lower = mix(uColor0, uColor1, smoothstep(0.08, 0.38, height));
    vec3 upper = mix(uColor2, uColor3, smoothstep(0.62, 0.94, height));
    vec3 color = mix(lower, upper, smoothstep(0.38, 0.68, height));
    float contourPosition = fract(height * uContourDensity);
    float contourDistance = min(contourPosition, 1.0 - contourPosition);
    float contour = 1.0 - smoothstep(0.006, 0.028, contourDistance);
    color = mix(color, uLineColor, contour * uLineStrength);
    gl_FragColor = vec4(color, uOpacity);
  }
`;
