import { useEffect, useRef, useState } from "react";
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

export type LidarBevProps = {
  pointCloud: Float32Array | null;
  frame: LidarPerceptionFrame | null;
  /** Up to two earlier decoded frames. The caller owns temporal alignment. */
  history: Float32Array[];
  status: "loading" | "unavailable" | "ready" | "error";
};

const VIEW = { front: 72, rear: 12, side: 32, range: 60 };
const objectColors: Record<RiskLevel, number> = {
  low: 0x62b7ae,
  medium: 0xf0b75c,
  high: 0xff5b92,
  unknown: 0x9aa6a8,
};

function makePointCloud(points: Float32Array, opacity: number) {
  const geometry = new THREE.BufferGeometry();
  const count = Math.floor(points.length / 4);
  const positions = new Float32Array(count * 3);
  const intensities = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const source = index * 4;
    // Dataset coordinates are forward, left, up. Three's ground plane is X/Z.
    positions[index * 3] = points[source + 1];
    positions[index * 3 + 1] = points[source + 2] + 0.08;
    positions[index * 3 + 2] = points[source];
    intensities[index] = points[source + 3];
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
      void main() {
        vIntensity = intensity;
        vDistance = length(position.xz);
        gl_PointSize = 2.4;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      varying float vIntensity;
      varying float vDistance;
      void main() {
        float radialAlpha = 1.0 - smoothstep(8.0, 82.0, vDistance);
        float pointMask = 1.0 - smoothstep(0.35, 0.7, length(gl_PointCoord - 0.5));
        vec3 color = mix(vec3(0.18, 0.68, 0.74), vec3(0.78, 0.96, 0.70), clamp(vIntensity, 0.0, 1.0));
        gl_FragColor = vec4(color, opacity * radialAlpha * pointMask);
      }
    `,
  });
  return new THREE.Points(geometry, material);
}

function makeLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.font = "600 24px Inter, PingFang SC, sans-serif";
  const width = Math.ceil(context.measureText(text).width + 24);
  canvas.width = width;
  canvas.height = 38;
  context.font = "600 24px Inter, PingFang SC, sans-serif";
  context.fillStyle = "rgba(6, 18, 20, .78)";
  context.fillRect(0, 0, width, canvas.height);
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.strokeRect(.75, .75, width - 1.5, canvas.height - 1.5);
  context.fillStyle = "#efffff";
  context.fillText(text, 12, 26);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(width / 20, 1.9, 1);
  return sprite;
}

function addObjects(scene: THREE.Scene, objects: LidarPerceptionObject[]) {
  objects.forEach((object) => {
    const color = objectColors[object.risk] ?? objectColors.unknown;
    const group = new THREE.Group();
    const height = Math.max(object.height, 0.2);
    const geometry = new THREE.BoxGeometry(Math.max(object.width, 0.2), height, Math.max(object.length, 0.2));
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, depthWrite: false }),
    );
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.94 }));
    group.add(fill, edges);
    group.position.set(object.y, Math.max(0, object.z) + height / 2, object.x);
    group.rotation.y = -object.yaw;
    scene.add(group);

    const distance = Math.hypot(object.x, object.y);
    if (object.risk !== "low" || distance < 32) {
      const label = makeLabel(`${object.label}  ${Math.round(distance)}m`, `#${color.toString(16).padStart(6, "0")}`);
      if (label) {
        label.position.set(object.y, height + 1.6, object.x);
        scene.add(label);
      }
    }
  });
}

function addWorkbench(scene: THREE.Scene) {
  scene.background = new THREE.Color(0x071113);
  const grid = new THREE.GridHelper(80, 8, 0x31565a, 0x183438);
  grid.position.set(0, 0, 30);
  scene.add(grid);

  const ringPoints = Array.from({ length: 97 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * VIEW.range, 0.04, Math.sin(angle) * VIEW.range);
  });
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPoints), new THREE.LineDashedMaterial({ color: 0x467c78, dashSize: 1.6, gapSize: 1.2, transparent: true, opacity: .7 }));
  ring.computeLineDistances();
  scene.add(ring);

  const axes = new THREE.AxesHelper(8);
  axes.position.y = .08;
  scene.add(axes);
  [10, 20, 30, 40, 50, 60, 70].forEach((meters) => {
    const label = makeLabel(`${meters}m`, "#5d8985");
    if (label) {
      label.position.set(-VIEW.side + 2, .15, meters);
      scene.add(label);
    }
  });
}

function addEgo(scene: THREE.Scene) {
  const ego = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, .45, 4.55),
    new THREE.MeshBasicMaterial({ color: 0xff4f8d, transparent: true, opacity: .96 }),
  );
  ego.position.set(0, .25, 0);
  scene.add(ego);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(ego.geometry), new THREE.LineBasicMaterial({ color: 0xffd2e1 }));
  edge.position.copy(ego.position);
  scene.add(edge);
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points || node instanceof THREE.Sprite) {
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => {
        if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
        material.dispose();
      });
    }
  });
}

function BasicBevFallback({ frame }: Pick<LidarBevProps, "frame">) {
  return (
    <div className="lidar-bev-fallback" role="img" aria-label="基础检测框鸟瞰图">
      <div className="lidar-bev-fallback-grid" />
      <span className="lidar-bev-fallback-ego">EGO</span>
      {frame?.objects.slice(0, 10).map((object) => (
        <span
          className="lidar-bev-fallback-object"
          key={object.id}
          style={{ left: `${50 + object.y * 1.25}%`, bottom: `${18 + object.x * .85}%` }}
        >
          {object.label}
        </span>
      ))}
    </div>
  );
}

export function LidarBev({ pointCloud, frame, history, status }: LidarBevProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  useEffect(() => {
    if (!pointCloud || webglUnavailable) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 180);
    camera.position.set(0, 105, 30);
    camera.lookAt(0, 0, 30);
    addWorkbench(scene);
    history.slice(-2).forEach((points, index) => scene.add(makePointCloud(points, .12 + index * .1)));
    scene.add(makePointCloud(pointCloud, .9));
    if (frame) addObjects(scene, frame.objects);
    addEgo(scene);

    const resize = () => {
      const parent = canvas.parentElement;
      const width = Math.max(parent?.clientWidth ?? 360, 320);
      const height = Math.max(parent?.clientHeight ?? 300, 260);
      const aspect = width / height;
      const halfHeight = (VIEW.front + VIEW.rear) / 2;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas.parentElement ?? canvas);
    resize();
    return () => {
      observer.disconnect();
      disposeScene(scene);
      renderer.dispose();
    };
  }, [frame, history, pointCloud, webglUnavailable]);

  if (status === "loading") return <div className="lidar-bev-state">LiDAR 点云加载中</div>;
  if (status === "unavailable" || !pointCloud) return <div className="lidar-bev-state">该场景未提供 LiDAR 点云</div>;
  if (webglUnavailable) {
    return (
      <div className="lidar-bev-shell">
        <BasicBevFallback frame={frame} />
        <p className="lidar-bev-warning">WebGL 不可用，已切换到基础检测框视图</p>
      </div>
    );
  }
  return (
    <div className="lidar-bev-shell">
      <canvas ref={canvasRef} className="lidar-bev-canvas" data-testid="lidar-webgl-canvas" />
      <span className="lidar-bev-source">LiDAR · 原始点云</span>
      <span className="lidar-bev-axis lidar-bev-axis-x">横向 / m</span>
      <span className="lidar-bev-axis lidar-bev-axis-z">前向 / m</span>
    </div>
  );
}
