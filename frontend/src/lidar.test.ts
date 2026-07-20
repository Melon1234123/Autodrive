import { describe, expect, it, vi } from "vitest";
import {
  decodePointCloud,
  findLidarFrameAtOrBefore,
  findLidarFrameIndexAtOrBefore,
  findNearestLidarFrame,
  LidarFrameCache,
  LidarFrameSequencer,
  LidarRequestGate,
  resolveLidarRequestCommit,
  selectLidarFrameWindow,
} from "./lidar";

describe("LiDAR data helpers", () => {
  it("selects the nearest lidar keyframe", () => {
    expect(
      findNearestLidarFrame(
        {
          version: 1,
          pointFormat: "xyzI-f32-le",
          frames: [
            { time: 0, timestampUs: 0, file: "a.bin", pointCount: 1 },
            { time: 0.5, timestampUs: 500000, file: "b.bin", pointCount: 1 },
          ],
        },
        0.31,
      )?.file,
    ).toBe("b.bin");
  });

  it("holds the recorded scan until the next timestamp", () => {
    const index = {
      version: 1,
      pointFormat: "xyzI-f32-le" as const,
      frames: [
        { time: 0, timestampUs: 0, file: "0.bin", pointCount: 1 },
        { time: 0.1, timestampUs: 100_000, file: "1.bin", pointCount: 1 },
        { time: 0.2, timestampUs: 200_000, file: "2.bin", pointCount: 1 },
        { time: 0.3, timestampUs: 300_000, file: "3.bin", pointCount: 1 },
      ],
    };

    expect(findLidarFrameIndexAtOrBefore(index, -1)).toBe(0);
    expect(findLidarFrameAtOrBefore(index, 0.199)?.file).toBe("1.bin");
    expect(findLidarFrameAtOrBefore(index, 0.2)?.file).toBe("2.bin");
    expect(findLidarFrameIndexAtOrBefore(index, 99)).toBe(3);
  });

  it("selects a bounded history and future preload window", () => {
    const index = {
      version: 1,
      pointFormat: "xyzI-f32-le" as const,
      frames: [
        { time: 0, timestampUs: 0, file: "0.bin", pointCount: 1 },
        { time: 0.1, timestampUs: 100_000, file: "1.bin", pointCount: 1 },
        { time: 0.2, timestampUs: 200_000, file: "2.bin", pointCount: 1 },
        { time: 0.3, timestampUs: 300_000, file: "3.bin", pointCount: 1 },
      ],
    };

    expect(selectLidarFrameWindow(index, 2, 1, 10).map((frame) => frame.file)).toEqual([
      "1.bin", "2.bin", "3.bin",
    ]);
  });

  it("queues intermediate recorded scans before a later playback target", () => {
    const sequence = new LidarFrameSequencer();

    sequence.setTarget(0);
    expect(sequence.next()).toBe(0);
    sequence.markPresented(0);
    sequence.setTarget(3);
    expect(sequence.next()).toBe(1);
    sequence.markPresented(1);
    expect(sequence.next()).toBe(2);
    sequence.markPresented(2);
    expect(sequence.next()).toBe(3);
  });

  it("decodes four float32 values per point", () => {
    const bytes = new Float32Array([1, 2, 3, 0.5]).buffer;
    expect([...decodePointCloud(bytes)]).toEqual([1, 2, 3, 0.5]);
  });

  it("rejects buffers that do not contain complete xyzI points", () => {
    expect(() => decodePointCloud(new ArrayBuffer(12))).toThrow("Invalid xyzI point cloud buffer");
  });

  it("keeps only the two most recently used decoded frames", async () => {
    const fetchFrame = vi.fn(async (url: string) => {
      const point = Number(url.replace("frame-", ""));
      return new Response(new Float32Array([point, 0, 0, 1]).buffer);
    });
    const cache = new LidarFrameCache(2, fetchFrame as unknown as typeof fetch);

    await cache.load("frame-1");
    await cache.load("frame-2");
    cache.get("frame-1");
    await cache.load("frame-3");

    expect(cache.get("frame-1")).toBeDefined();
    expect(cache.get("frame-2")).toBeUndefined();
    expect(cache.get("frame-3")).toBeDefined();
    expect(fetchFrame).toHaveBeenCalledTimes(3);
  });

  it("deduplicates concurrent frame loads", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchFrame = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const cache = new LidarFrameCache(6, fetchFrame as unknown as typeof fetch);

    const first = cache.load("same.bin");
    const second = cache.load("same.bin");

    expect(fetchFrame).toHaveBeenCalledTimes(1);
    resolveFetch(new Response(new Float32Array([1, 2, 3, 0.5]).buffer));
    const [firstCloud, secondCloud] = await Promise.all([first, second]);
    expect(firstCloud).toBe(secondCloud);
  });

  it("allows retry after an in-flight load fails", async () => {
    const fetchFrame = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(new Float32Array([1, 0, 0, 1]).buffer));
    const cache = new LidarFrameCache(6, fetchFrame as unknown as typeof fetch);

    await expect(cache.load("retry.bin")).rejects.toThrow("network");
    await expect(cache.load("retry.bin")).resolves.toBeInstanceOf(Float32Array);
    expect(fetchFrame).toHaveBeenCalledTimes(2);
  });

  it("accepts completed requests in issue order without allowing regression", () => {
    const gate = new LidarRequestGate();
    gate.reset();
    const first = gate.issue();
    const second = gate.issue();

    expect(gate.accept(first)).toBe(true);
    expect(gate.accept(second)).toBe(true);
    expect(gate.accept(first)).toBe(false);

    const oldGeneration = gate.issue();
    gate.reset();
    expect(gate.accept(oldGeneration)).toBe(false);
  });

  it("does not let a newer failed request suppress an older successful completion", () => {
    const gate = new LidarRequestGate();
    gate.reset();
    const first = gate.issue();
    const second = gate.issue();
    const failure = new Error("network");

    expect(resolveLidarRequestCommit(gate, second, { status: "rejected", reason: failure })).toEqual({
      status: "rejected",
      reason: failure,
    });

    const cloud = new Float32Array([1, 0, 0, 1]);
    expect(resolveLidarRequestCommit(gate, first, { status: "fulfilled", value: cloud })).toEqual({
      status: "accepted",
      value: cloud,
    });

    const third = gate.issue();
    const fourth = gate.issue();
    expect(resolveLidarRequestCommit(gate, fourth, { status: "fulfilled", value: cloud }).status).toBe("accepted");
    expect(resolveLidarRequestCommit(gate, third, { status: "rejected", reason: failure })).toEqual({
      status: "stale",
    });
  });

  it("does not repopulate completed cache entries after clear", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchFrame = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const cache = new LidarFrameCache(6, fetchFrame as unknown as typeof fetch);

    const pending = cache.load("old-scene.bin");
    cache.clear();
    resolveFetch(new Response(new Float32Array([1, 0, 0, 1]).buffer));
    await pending;

    expect(cache.get("old-scene.bin")).toBeUndefined();
  });
});
