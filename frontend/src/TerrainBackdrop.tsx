import { useEffect, useId, useRef, useState } from "react";
import * as THREE from "three";
import {
  TERRAIN_TRANSITION_MS,
  interpolateTerrainTarget,
  resolveTerrainTarget,
  type ShowcaseTerrainPreset,
  type TerrainRiskLevel,
  type TerrainTarget,
  type TerrainView,
} from "./terrain-presets";
import { TERRAIN_FRAGMENT_SHADER, TERRAIN_VERTEX_SHADER } from "./terrain-shader";
import "./TerrainBackdrop.css";

type TerrainBackdropProps = {
  view: TerrainView;
  preset: ShowcaseTerrainPreset;
  risk: TerrainRiskLevel;
};

type TerrainUniforms = {
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
  uSpeed: { value: number };
  uContourDensity: { value: number };
  uLineStrength: { value: number };
  uOpacity: { value: number };
  uColor0: { value: THREE.Color };
  uColor1: { value: THREE.Color };
  uColor2: { value: THREE.Color };
  uColor3: { value: THREE.Color };
  uLineColor: { value: THREE.Color };
};

type TerrainSubmitResult = "blocked" | "throttled" | "submitted" | "failed";

const FRAME_INTERVAL_MS = 1000 / 30;
const smoothstep = (value: number) => value * value * (3 - 2 * value);
const setColor = (color: THREE.Color, rgb: readonly [number, number, number]) => color.setRGB(rgb[0], rgb[1], rgb[2]);

function applyTarget(uniforms: TerrainUniforms, target: TerrainTarget, simulationMs: number) {
  uniforms.uTime.value = simulationMs / 1000;
  uniforms.uSpeed.value = target.speed;
  uniforms.uContourDensity.value = target.contourDensity;
  uniforms.uLineStrength.value = target.lineStrength;
  uniforms.uOpacity.value = target.opacity;
  setColor(uniforms.uColor0.value, target.colors[0]);
  setColor(uniforms.uColor1.value, target.colors[1]);
  setColor(uniforms.uColor2.value, target.colors[2]);
  setColor(uniforms.uColor3.value, target.colors[3]);
  setColor(uniforms.uLineColor.value, target.lineColor);
}

export default function TerrainBackdrop({ view, preset, risk }: TerrainBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const initialTargetRef = useRef<TerrainTarget>(resolveTerrainTarget(view, preset, risk));
  const currentTargetRef = useRef<TerrainTarget>(initialTargetRef.current);
  const transitionRef = useRef({ from: initialTargetRef.current, to: initialTargetRef.current, startedAt: 0 });
  const simulationMsRef = useRef(0);
  const drawStaticRef = useRef<(() => void) | null>(null);
  const [fallback, setFallback] = useState(false);
  const instanceId = useId().replace(/:/g, "-");

  useEffect(() => {
    transitionRef.current = {
      from: currentTargetRef.current,
      to: resolveTerrainTarget(view, preset, risk),
      startedAt: simulationMsRef.current,
    };
    drawStaticRef.current?.();
  }, [preset, risk, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer | null = null;
    let geometry: THREE.PlaneGeometry | null = null;
    let material: THREE.ShaderMaterial | null = null;
    let shaderProbeTarget: THREE.WebGLRenderTarget | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.OrthographicCamera | null = null;
    let uniforms: TerrainUniforms | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let motion: MediaQueryList | null = null;
    let frameId: number | null = null;
    let staticTimerId: number | null = null;
    let shaderFailed = false;
    let disposed = false;
    let reduced = false;
    let lastTick = performance.now();
    let lastSubmit = Number.NEGATIVE_INFINITY;

    const resize = () => {
      if (disposed || !uniforms) return;
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, width <= 680 ? 1 : 1.25));
      renderer?.setSize(width, height, false);
      uniforms.uResolution.value.set(width, height);
    };

    const disposeShaderProbe = () => {
      const target = shaderProbeTarget;
      shaderProbeTarget = null;
      target?.dispose();
    };

    const teardown = (forceContextLoss: boolean) => {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      if (staticTimerId !== null) window.clearTimeout(staticTimerId);
      staticTimerId = null;
      drawStaticRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      motion?.removeEventListener("change", handleMotion);
      canvas.removeEventListener("webglcontextlost", handleContextLoss);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      disposeShaderProbe();
      geometry?.dispose();
      material?.dispose();
      renderer?.dispose();
      if (forceContextLoss) renderer?.forceContextLoss();
    };

    const fallbackToStatic = (error: unknown, forceContextLoss: boolean) => {
      if (disposed) return;
      if (import.meta.env.DEV) console.warn("Terrain backdrop fell back to a static image", error);
      teardown(forceContextLoss);
      setFallback(true);
    };

    const submit = (now: number): Exclude<TerrainSubmitResult, "failed"> => {
      if (disposed || document.hidden || !renderer || !scene || !camera || !uniforms) return "blocked";
      const transition = transitionRef.current;
      const progress = Math.min(1, Math.max(0, (simulationMsRef.current - transition.startedAt) / TERRAIN_TRANSITION_MS));
      currentTargetRef.current = interpolateTerrainTarget(transition.from, transition.to, smoothstep(progress));
      const invisible = transition.to.opacity === 0 && currentTargetRef.current.opacity < 0.001;
      if (invisible) return "blocked";
      if (now - lastSubmit < FRAME_INTERVAL_MS) return "throttled";
      applyTarget(uniforms, currentTargetRef.current, simulationMsRef.current);
      renderer.render(scene, camera);
      if (shaderFailed) throw new Error("Terrain shader compilation failed");
      lastSubmit = now;
      return "submitted";
    };

    const submitSafely = (now: number): TerrainSubmitResult => {
      try {
        return submit(now);
      } catch (error) {
        fallbackToStatic(error, true);
        return "failed";
      }
    };

    const probeShader = () => {
      if (!renderer || !scene || !camera) return;
      const target = new THREE.WebGLRenderTarget(1, 1);
      shaderProbeTarget = target;
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        try {
          renderer.setRenderTarget(null);
        } finally {
          disposeShaderProbe();
        }
      }
      if (shaderFailed) throw new Error("Terrain shader compilation failed");
    };

    function scheduleStaticSubmit() {
      if (disposed || !reduced || document.hidden || staticTimerId !== null) return;
      const elapsed = performance.now() - lastSubmit;
      const delay = Math.max(FRAME_INTERVAL_MS - elapsed, 0);
      staticTimerId = window.setTimeout(() => {
        staticTimerId = null;
        if (disposed || !reduced) return;
        if (submitSafely(performance.now()) === "throttled") scheduleStaticSubmit();
      }, delay);
    }

    function tick(now: number) {
      if (disposed) return;
      const delta = document.hidden ? 0 : Math.min(Math.max(now - lastTick, 0), 100);
      lastTick = now;
      simulationMsRef.current += delta;
      if (submitSafely(now) === "failed") return;
      if (!disposed) frameId = requestAnimationFrame(tick);
    }

    function handleVisibility() {
      if (disposed) return;
      lastTick = performance.now();
      if (document.hidden) {
        if (staticTimerId !== null) window.clearTimeout(staticTimerId);
        staticTimerId = null;
      } else if (reduced) drawStaticRef.current?.();
    }

    function handleMotion(event: MediaQueryListEvent) {
      if (disposed) return;
      reduced = event.matches;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      if (staticTimerId !== null) window.clearTimeout(staticTimerId);
      staticTimerId = null;
      if (reduced) drawStaticRef.current?.();
      else {
        lastTick = performance.now();
        frameId = requestAnimationFrame(tick);
      }
    }

    function handleContextLoss(event: Event) {
      event.preventDefault();
      fallbackToStatic(new Error("WebGL context lost"), false);
    }

    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
      renderer.setClearColor(0x000000, 0);
      renderer.debug.onShaderError = () => { shaderFailed = true; };
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      geometry = new THREE.PlaneGeometry(2, 2);
      uniforms = {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSpeed: { value: initialTargetRef.current.speed },
        uContourDensity: { value: initialTargetRef.current.contourDensity },
        uLineStrength: { value: initialTargetRef.current.lineStrength },
        uOpacity: { value: initialTargetRef.current.opacity },
        uColor0: { value: new THREE.Color() },
        uColor1: { value: new THREE.Color() },
        uColor2: { value: new THREE.Color() },
        uColor3: { value: new THREE.Color() },
        uLineColor: { value: new THREE.Color() },
      };
      material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms,
        vertexShader: TERRAIN_VERTEX_SHADER,
        fragmentShader: TERRAIN_FRAGMENT_SHADER,
      });
      scene.add(new THREE.Mesh(geometry, material));
      renderer.compile(scene, camera);
      probeShader();
      motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduced = motion.matches;
      resize();

      drawStaticRef.current = () => {
        if (!reduced || disposed) return;
        currentTargetRef.current = transitionRef.current.to;
        transitionRef.current = {
          from: currentTargetRef.current,
          to: currentTargetRef.current,
          startedAt: simulationMsRef.current,
        };
        if (submitSafely(performance.now()) === "throttled") scheduleStaticSubmit();
      };

      const initialNow = performance.now();
      lastTick = initialNow;
      if (submitSafely(initialNow) === "failed") return () => teardown(false);
      resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
      resizeObserver?.observe(document.documentElement);
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", handleVisibility);
      motion.addEventListener("change", handleMotion);
      canvas.addEventListener("webglcontextlost", handleContextLoss);
      if (!reduced) frameId = requestAnimationFrame(tick);
    } catch (error) {
      fallbackToStatic(error, true);
    }

    return () => teardown(!canvas.isConnected);
  }, []);

  const hidden = view === "showcase" && preset === "hidden";
  return (
    <div
      aria-hidden="true"
      className={`terrain-backdrop${fallback ? " terrain-backdrop--fallback" : ""}${hidden ? " terrain-backdrop--hidden" : ""}`}
      data-instance-id={instanceId}
      data-preset={preset}
      data-state={fallback ? "fallback" : "webgl"}
      data-testid="terrain-backdrop"
      data-view={view}
      style={{ pointerEvents: "none" }}
    >
      <canvas ref={canvasRef} data-testid="terrain-backdrop-canvas" />
    </div>
  );
}
