export interface LidarFrameIndex {
  time: number;
  timestampUs: number;
  file: string;
  pointCount: number;
}

export interface LidarIndex {
  version: number;
  pointFormat: "xyzI-f32-le";
  frames: LidarFrameIndex[];
}

export async function loadLidarIndex(url: string, signal?: AbortSignal): Promise<LidarIndex> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Unable to load LiDAR index: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<LidarIndex>;
}

export function decodePointCloud(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength % (Float32Array.BYTES_PER_ELEMENT * 4) !== 0) {
    throw new Error("Invalid xyzI point cloud buffer");
  }
  return new Float32Array(buffer);
}

export function findNearestLidarFrame(index: LidarIndex, time: number): LidarFrameIndex | null {
  return index.frames.reduce<LidarFrameIndex | null>(
    (best, frame) =>
      !best || Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best,
    null,
  );
}

/** Caches decoded point clouds by URL, retaining the six most recently used frames. */
export class LidarFrameCache {
  #entries = new Map<string, Float32Array>();

  constructor(
    private readonly maxEntries = 6,
    private readonly fetchFrame: typeof fetch = fetch,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("LiDAR cache capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  get(url: string): Float32Array | undefined {
    const pointCloud = this.#entries.get(url);
    if (!pointCloud) return undefined;

    this.#entries.delete(url);
    this.#entries.set(url, pointCloud);
    return pointCloud;
  }

  async load(url: string, signal?: AbortSignal): Promise<Float32Array> {
    const cached = this.get(url);
    if (cached) return cached;

    const response = await this.fetchFrame(url, { signal });
    if (!response.ok) {
      throw new Error(`Unable to load LiDAR frame: ${response.status} ${response.statusText}`);
    }

    const pointCloud = decodePointCloud(await response.arrayBuffer());
    this.#entries.set(url, pointCloud);
    while (this.#entries.size > this.maxEntries) {
      this.#entries.delete(this.#entries.keys().next().value!);
    }
    return pointCloud;
  }
}
