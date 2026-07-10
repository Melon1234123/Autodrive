import { describe, expect, it } from "vitest";
import { resolveLidarSource, resolveReplayTime } from "./App";

describe("cockpit replay integration", () => {
  it("clears the current lidar index when the selected scene has no lidarIndexFile", () => {
    expect(resolveLidarSource({})).toBeNull();
  });

  it("uses the same event peak time for video seeking and lidar lookup", () => {
    expect(resolveReplayTime({ seekTime: 12.5 })).toBe(12.5);
  });
});
