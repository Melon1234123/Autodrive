import { describe, expect, it } from "vitest";
import { loadOptionalLidarIndex, resolveLidarSource, resolveReplayTime } from "./App";

describe("cockpit replay integration", () => {
  it("clears the current lidar index when the selected scene has no lidarIndexFile", () => {
    expect(resolveLidarSource({})).toBeNull();
  });

  it("uses the same event peak time for video seeking and lidar lookup", () => {
    expect(resolveReplayTime({ seekTime: 12.5 })).toBe(12.5);
  });

  it("contains a rejected optional LiDAR index load", async () => {
    const result = await loadOptionalLidarIndex(
      "/scenes/default/lidar/index.json",
      undefined,
      async () => Promise.reject(new Error("index HTTP 500")),
    );

    expect(result).toEqual({ index: null, errorMessage: "index HTTP 500" });
  });
});
