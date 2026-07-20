import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";

type RiskLevel = "low" | "medium" | "high" | "unknown";

export type LidarPerceptionObject = {
  id: string;
  label: string;
  category: string;
  x: number;
  y: number;
  z: number;
  width: number;
  length: number;
  height: number;
  yaw: number;
  risk: RiskLevel;
};

export type LidarPerceptionFrame = {
  time: number;
  objects: LidarPerceptionObject[];
};

export type LidarHistoryCloud = {
  points: Float32Array;
  /** Earlier sensor pose expressed in the current ego frame. */
  forward: number;
  left: number;
  headingDelta: number;
};

export type LidarBevProps = {
  sceneId: string;
  pointCloud: Float32Array | null;
  frame: LidarPerceptionFrame | null;
  /** Up to two earlier clouds transformed into the current ego frame. */
  history: LidarHistoryCloud[];
  status: "loading" | "unavailable" | "ready" | "error";
  errorMessage?: string | null;
};

const VIEW = { front: 72, rear: 12, side: 32, range: 60 };
const FALLBACK_EGO_TOP = 82;
const LIDAR_VIEW_CENTER_FORWARD = 8;
const objectColors: Record<RiskLevel, number> = {
  low: 0x62b7ae,
  medium: 0xf0b75c,
  high: 0xff5b92,
  unknown: 0x9aa6a8,
};

export function lidarToWorldGround(forward: number, left: number, poseForward = 0, poseLeft = 0, headingDelta = 0) {
  const worldForward = poseForward + Math.cos(headingDelta) * forward - Math.sin(headingDelta) * left;
  const worldLeft = poseLeft + Math.sin(headingDelta) * forward + Math.cos(headingDelta) * left;
  return { x: worldLeft, z: worldForward };
}

export function lidarPointToWorldGround(forward: number, left: number, poseForward = 0, poseLeft = 0, headingDelta = 0) {
  const ground = lidarToWorldGround(forward, left, poseForward, poseLeft, headingDelta);
  return { x: -ground.z, z: ground.x };
}

export function lidarYawToWorldRotation(yaw: number) {
  return yaw;
}

export function normalizeLidarIntensity(intensity: number) {
  return Math.min(1, Math.max(0, intensity / 255));
}

export function lidarScreenTopPercent(worldForward: number) {
  const halfHeight = (VIEW.front + VIEW.rear) / 2;
  return ((LIDAR_VIEW_CENTER_FORWARD + halfHeight - worldForward) / (halfHeight * 2)) * 100;
}

function makePointCloud(points: Float32Array, opacity: number, pose?: Omit<LidarHistoryCloud, "points">) {
  const geometry = new THREE.BufferGeometry();
  const count = Math.floor(points.length / 4);
  const positions = new Float32Array(count * 3);
  const intensities = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const source = index * 4;
    // Apply the history pose before the cockpit's clockwise point-cloud rotation.
    const forward = points[source];
    const left = points[source + 1];
    const ground = lidarPointToWorldGround(forward, left, pose?.forward, pose?.left, pose?.headingDelta);
    positions[index * 3] = ground.x;
    positions[index * 3 + 1] = points[source + 2] + 0.08;
    positions[index * 3 + 2] = ground.z;
    intensities[index] = normalizeLidarIntensity(points[source + 3]);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("intensity", new THREE.BufferAttribute(intensities, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { opacity: { value: opacity } },
    vertexShader: `
      attribute float intensity;
      varying float vIntensity;
      varying float vDistance;
      varying float vHeight;
      void main() {
        vIntensity = intensity;
        vDistance = length(position.xz);
        vHeight = position.y;
        gl_PointSize = 2.4;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      varying float vIntensity;
      varying float vDistance;
      varying float vHeight;
      void main() {
        float radialAlpha = 1.0 - smoothstep(8.0, 82.0, vDistance);
        float pointMask = 1.0 - smoothstep(0.35, 0.7, length(gl_PointCoord - 0.5));
        float heightMix = smoothstep(-1.0, 2.8, vHeight);
        float colorMix = clamp(0.12 + clamp(vIntensity, 0.0, 1.0) * 0.58 + heightMix * 0.24, 0.0, 1.0);
        vec3 color = mix(vec3(0.16, 0.65, 0.69), vec3(0.76, 0.92, 0.68), colorMix);
        float highPoint = smoothstep(2.4, 4.5, vHeight) * 0.18;
        color = mix(color, vec3(0.94, 0.98, 0.82), highPoint);
        gl_FragColor = vec4(color, opacity * radialAlpha * pointMask);
      }
    `,
  });
  return new THREE.Points(geometry, material);
}

type LidarObjectVisual = {
  group: THREE.Group;
  fill: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  footprint: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
};

function createObjectVisual(object: LidarPerceptionObject): LidarObjectVisual {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const color = objectColors[object.risk] ?? objectColors.unknown;
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.94 }),
  );
  const footprint = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide }),
  );
  footprint.position.y = 0.015;
  footprint.rotation.x = -Math.PI / 2;
  group.add(footprint, fill, edges);
  group.userData.lidarObjectId = object.id;
  return { group, fill, edges, footprint };
}

function updateObjectVisual(visual: LidarObjectVisual, object: LidarPerceptionObject) {
  const color = objectColors[object.risk] ?? objectColors.unknown;
  const height = Math.max(object.height, 0.2);
  const width = Math.max(object.width, 0.2);
  const length = Math.max(object.length, 0.2);
  const objectCenterHeight = Math.max(0, object.z) + height / 2;
  visual.fill.material.color.setHex(color);
  visual.edges.material.color.setHex(color);
  visual.footprint.material.color.setHex(color);
  visual.fill.scale.set(width, height, length);
  visual.edges.scale.set(width, height, length);
  visual.fill.position.y = objectCenterHeight;
  visual.edges.position.y = objectCenterHeight;
  visual.footprint.scale.set(width, length, 1);
  const ground = lidarToWorldGround(object.x, object.y);
  visual.group.position.set(ground.x, 0, ground.z);
  visual.group.rotation.y = lidarYawToWorldRotation(object.yaw);
}

function syncObjectLayer(group: THREE.Group, objects: LidarPerceptionObject[]) {
  const existing = new Map<string, LidarObjectVisual>();
  group.children.forEach((child) => {
    const visual = child.userData.lidarObjectVisual as LidarObjectVisual | undefined;
    if (visual) existing.set(child.userData.lidarObjectId as string, visual);
  });
  const activeIds = new Set<string>();
  objects.forEach((object) => {
    activeIds.add(object.id);
    const visual = existing.get(object.id) ?? createObjectVisual(object);
    updateObjectVisual(visual, object);
    if (!visual.group.parent) group.add(visual.group);
    visual.group.userData.lidarObjectVisual = visual;
  });
  [...existing.entries()]
    .filter(([id]) => !activeIds.has(id))
    .forEach(([, visual]) => {
      group.remove(visual.group);
      disposeObjectResources(visual.group);
    });
}

function addWorkbench(scene: THREE.Scene, group: THREE.Group) {
  scene.background = new THREE.Color(0x071113);

  const grid = new THREE.GridHelper(120, 12, 0x356768, 0x183638);
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.22;
    material.depthWrite = false;
  });
  group.add(grid);

  [10, 20, 30, 40, 50].forEach((radius) => {
    const points = Array.from({ length: 96 }, (_, index) => {
      const angle = (index / 96) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, 0.01, Math.sin(angle) * radius);
    });
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x4b8582, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    group.add(ring);
  });
}

function addEgo(scene: THREE.Group) {
  const group = new THREE.Group();
  const bodyGeometry = new THREE.BoxGeometry(1.4, .36, 4.05);
  const body = new THREE.Mesh(
    bodyGeometry,
    new THREE.MeshBasicMaterial({ color: 0xf6fbff, transparent: true, opacity: .96 }),
  );
  body.position.set(0, .24, 0);
  group.add(body);

  const cabinGeometry = new THREE.BoxGeometry(.94, .12, 1.36);
  const cabin = new THREE.Mesh(
    cabinGeometry,
    new THREE.MeshBasicMaterial({ color: 0x26364a, transparent: true, opacity: .92 }),
  );
  cabin.position.set(0, .5, -.18);
  group.add(cabin);

  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeometry), new THREE.LineBasicMaterial({ color: 0x7d93aa }));
  edge.position.copy(body.position);
  group.add(edge);
  scene.add(group);
}

function disposeObjectResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points || node instanceof THREE.Sprite) {
      if (node.geometry) geometries.add(node.geometry);
      const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
      nodeMaterials.forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
    material.dispose();
  });
}

function clearDynamicGroup(group: THREE.Group) {
  disposeObjectResources(group);
  group.clear();
}

function disposeScene(scene: THREE.Scene) {
  disposeObjectResources(scene);
  scene.clear();
}

function BasicBevFallback({ frame }: Pick<LidarBevProps, "frame">) {
  return (
    <div className="lidar-bev-fallback" role="img" aria-label="基础检测框鸟瞰图">
      <div className="lidar-bev-fallback-grid" />
      <span className="lidar-bev-fallback-ego" style={{ top: `${FALLBACK_EGO_TOP}%` }}>EGO</span>
      {frame?.objects.slice(0, 10).map((object) => (
        <span
          className="lidar-bev-fallback-object"
          key={object.id}
          style={{ left: `${50 - object.y * 1.25}%`, top: `${FALLBACK_EGO_TOP - object.x * .85}%` }}
        >
          {object.label}
        </span>
      ))}
    </div>
  );
}

type LidarBevRuntime = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  staticGroup: THREE.Group;
  dynamicGroup: THREE.Group;
  objectGroup: THREE.Group;
  resizeObserver: ResizeObserver;
};

export function LidarBev({ sceneId, pointCloud, frame, history, status, errorMessage }: LidarBevProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<LidarBevRuntime | null>(null);
  const failedSceneIdRef = useRef<string | null>(null);
  const sceneIdRef = useRef(sceneId);
  const previousDataRef = useRef<{
    sceneId: string;
    pointCloud: Float32Array | null;
    history: LidarHistoryCloud[];
    frame: LidarPerceptionFrame | null;
    webglUnavailable: boolean;
  } | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  sceneIdRef.current = sceneId;

  useEffect(() => {
    if (webglUnavailable || runtimeRef.current || failedSceneIdRef.current === sceneIdRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let resizeObserver: ResizeObserver | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 180);
      const staticGroup = new THREE.Group();
      const dynamicGroup = new THREE.Group();
      const objectGroup = new THREE.Group();
      camera.up.set(0, 0, 1);
      camera.position.set(0, 105, LIDAR_VIEW_CENTER_FORWARD);
      camera.lookAt(0, 0, LIDAR_VIEW_CENTER_FORWARD);
      scene.add(staticGroup, dynamicGroup, objectGroup);
      addWorkbench(scene, staticGroup);
      addEgo(staticGroup);

      const resize = (renderAfterResize: boolean) => {
        const parent = canvas.parentElement;
        const width = Math.max(parent?.clientWidth || 360, 320);
        const height = Math.max(parent?.clientHeight || 300, 260);
        const aspect = width / height;
        const halfHeight = (VIEW.front + VIEW.rear) / 2;
        camera.left = -halfHeight * aspect;
        camera.right = halfHeight * aspect;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.updateProjectionMatrix();
        renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer?.setSize(width, height, false);
        if (renderAfterResize) renderer?.render(scene as THREE.Scene, camera);
      };
      resizeObserver = new ResizeObserver(() => resize(true));
      runtimeRef.current = { renderer, scene, camera, staticGroup, dynamicGroup, objectGroup, resizeObserver };
      resizeObserver.observe(canvas.parentElement ?? canvas);
      resize(false);
      failedSceneIdRef.current = null;
    } catch {
      runtimeRef.current = null;
      resizeObserver?.disconnect();
      if (scene) disposeScene(scene);
      renderer?.dispose();
      failedSceneIdRef.current = sceneIdRef.current;
      setWebglUnavailable(true);
    }
  }, [webglUnavailable]);

  useEffect(() => () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.resizeObserver.disconnect();
    disposeScene(runtime.scene);
    runtime.renderer.dispose();
    runtimeRef.current = null;
  }, []);

  useEffect(() => {
    if (!webglUnavailable || failedSceneIdRef.current === sceneId) return;
    failedSceneIdRef.current = null;
    setWebglUnavailable(false);
  }, [sceneId, webglUnavailable]);

  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    clearDynamicGroup(runtime.dynamicGroup);
    clearDynamicGroup(runtime.objectGroup);
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [sceneId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const previous = previousDataRef.current;
    const cloudChanged = !previous
      || previous.sceneId !== sceneId
      || previous.pointCloud !== pointCloud
      || previous.history !== history
      || previous.webglUnavailable !== webglUnavailable;
    const objectsChanged = !previous
      || previous.sceneId !== sceneId
      || previous.frame !== frame
      || previous.webglUnavailable !== webglUnavailable;
    if (cloudChanged) {
      clearDynamicGroup(runtime.dynamicGroup);
      history.slice(-2).forEach((cloud, index) => runtime.dynamicGroup.add(makePointCloud(cloud.points, .12 + index * .1, cloud)));
      if (pointCloud) runtime.dynamicGroup.add(makePointCloud(pointCloud, .9));
    }
    if (objectsChanged) {
      syncObjectLayer(runtime.objectGroup, frame?.objects ?? []);
    }
    previousDataRef.current = { sceneId, pointCloud, history, frame, webglUnavailable };
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [frame, history, pointCloud, sceneId, webglUnavailable]);

  const message = status === "error"
    ? `LiDAR load failed${errorMessage ? `: ${errorMessage}` : ""}`
    : status === "unavailable"
      ? "该场景未提供 LiDAR 点云"
      : "LiDAR 点云加载中";
  const showStaleWarning = status === "error" && Boolean(pointCloud);
  const showBlockingState = !pointCloud;

  return (
    <div className="lidar-bev-shell" data-scene-id={sceneId}>
      <canvas ref={canvasRef} className="lidar-bev-canvas" data-testid="lidar-webgl-canvas" />
      {webglUnavailable && pointCloud && <BasicBevFallback frame={frame} />}
      {showBlockingState && <div className="lidar-bev-state lidar-bev-overlay">{message}</div>}
      {(webglUnavailable && pointCloud || showStaleWarning) && (
        <div className="lidar-bev-warnings">
          {webglUnavailable && pointCloud && <p className="lidar-bev-warning">WebGL 不可用，已切换到基础检测框视图</p>}
          {showStaleWarning && <p className="lidar-bev-warning lidar-bev-stale-warning">{message}</p>}
        </div>
      )}
    </div>
  );
}
