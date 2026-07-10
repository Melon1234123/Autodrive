import { describe, expect, it, vi } from "vitest";
import { decodePointCloud, findNearestLidarFrame, LidarFrameCache } from "./lidar";

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
});
