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

/** Returns the latest recorded scan that the video timeline has reached. */
export function findLidarFrameIndexAtOrBefore(index: LidarIndex, time: number): number {
  if (index.frames.length === 0) return -1;
  const firstAfterTime = index.frames.findIndex((frame) => frame.time > time);
  return firstAfterTime === -1 ? index.frames.length - 1 : Math.max(0, firstAfterTime - 1);
}

export function findLidarFrameAtOrBefore(index: LidarIndex, time: number): LidarFrameIndex | null {
  const frameIndex = findLidarFrameIndexAtOrBefore(index, time);
  return frameIndex < 0 ? null : index.frames[frameIndex];
}

export function selectLidarFrameWindow(
  index: LidarIndex,
  targetIndex: number,
  historyCount: number,
  lookaheadCount: number,
): LidarFrameIndex[] {
  if (targetIndex < 0 || targetIndex >= index.frames.length) return [];
  const start = Math.max(0, targetIndex - historyCount);
  const end = Math.min(index.frames.length, targetIndex + lookaheadCount + 1);
  return index.frames.slice(start, end);
}

/** Keeps decoded scans in their recorded order when the video time advances faster than loading. */
export class LidarFrameSequencer {
  #presentedIndex = -1;
  #targetIndex: number | null = null;

  reset(): void {
    this.#presentedIndex = -1;
    this.#targetIndex = null;
  }

  setTarget(index: number): void {
    this.#targetIndex = index;
  }

  next(): number | null {
    if (this.#targetIndex === null) return null;
    if (this.#targetIndex < this.#presentedIndex) {
      return this.#targetIndex;
    }
    return this.#presentedIndex < this.#targetIndex ? this.#presentedIndex + 1 : null;
  }

  markPresented(index: number): void {
    if (this.next() !== index) {
      throw new Error("LiDAR frame is not the next eligible frame");
    }
    this.#presentedIndex = index;
  }
}

export type LidarRequestTicket = { generation: number; sequence: number };

export class LidarRequestGate {
  #generation = 0;
  #issued = 0;
  #committed = 0;

  reset(): number {
    this.#generation += 1;
    this.#issued = 0;
    this.#committed = 0;
    return this.#generation;
  }

  issue(): LidarRequestTicket {
    return { generation: this.#generation, sequence: ++this.#issued };
  }

  accept(ticket: LidarRequestTicket): boolean {
    if (ticket.generation !== this.#generation || ticket.sequence <= this.#committed) {
      return false;
    }
    this.#committed = ticket.sequence;
    return true;
  }

  isLatest(ticket: LidarRequestTicket): boolean {
    return ticket.generation === this.#generation && ticket.sequence === this.#issued;
  }
}

export type LidarRequestCommitResult<T> =
  | { status: "accepted"; value: T }
  | { status: "rejected"; reason: unknown }
  | { status: "stale" };

export function resolveLidarRequestCommit<T>(
  gate: LidarRequestGate,
  ticket: LidarRequestTicket,
  result: PromiseSettledResult<T> | undefined,
): LidarRequestCommitResult<T> {
  if (!result || result.status === "rejected") {
    if (!gate.isLatest(ticket)) return { status: "stale" };
    return {
      status: "rejected",
      reason: result?.status === "rejected" ? result.reason : new Error("LiDAR current frame result missing"),
    };
  }
  return gate.accept(ticket)
    ? { status: "accepted", value: result.value }
    : { status: "stale" };
}

/** Caches decoded point clouds by URL, retaining the six most recently used frames. */
export class LidarFrameCache {
  #entries = new Map<string, Float32Array>();
  #pending = new Map<string, Promise<Float32Array>>();
  #generation = 0;

  constructor(
    private readonly maxEntries = 6,
    // Calling an unbound Window.fetch through an object method throws
    // "Illegal invocation" in browsers, so retain a bound wrapper.
    private readonly fetchFrame: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("LiDAR cache capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#generation += 1;
    this.#entries.clear();
    this.#pending.clear();
  }

  get(url: string): Float32Array | undefined {
    const pointCloud = this.#entries.get(url);
    if (!pointCloud) return undefined;

    this.#entries.delete(url);
    this.#entries.set(url, pointCloud);
    return pointCloud;
  }

  load(url: string, signal?: AbortSignal): Promise<Float32Array> {
    const cached = this.get(url);
    if (cached) return Promise.resolve(cached);

    const existing = this.#pending.get(url);
    if (existing) return existing;

    const generation = this.#generation;
    let pending!: Promise<Float32Array>;
    pending = this.fetchFrame(url, { signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load LiDAR frame: ${response.status} ${response.statusText}`);
        }

        const pointCloud = decodePointCloud(await response.arrayBuffer());
        if (generation === this.#generation) {
          this.#entries.set(url, pointCloud);
          while (this.#entries.size > this.maxEntries) {
            this.#entries.delete(this.#entries.keys().next().value!);
          }
        }
        return pointCloud;
      })
      .finally(() => {
        if (this.#pending.get(url) === pending) {
          this.#pending.delete(url);
        }
      });
    this.#pending.set(url, pending);
    return pending;
  }
}
