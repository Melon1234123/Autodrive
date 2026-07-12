import { describe, expect, it } from "vitest";
import {
  compactRoutePoints,
  hasUsableRoute,
  ROUTE_COMPACTION_EPSILON_METERS,
  routeTangentAndNormal,
  routeDistance,
  selectMapGeometry,
} from "./map-geometry";

describe("tactical map geometry selection", () => {
  it("measures cumulative route distance", () => {
    expect(routeDistance([
      { forward: 0, left: 0 },
      { forward: 3, left: 4 },
      { forward: 6, left: 8 },
    ])).toBe(10);
  });

  it("rejects many coincident ego poses", () => {
    const points = Array.from({ length: 30 }, () => ({ forward: 0, left: 0 }));

    expect(hasUsableRoute(points, 2)).toBe(false);
  });

  it("compacts a duplicate start without losing the route endpoints", () => {
    const start = { forward: 0, left: 0 };
    const end = { forward: 8, left: 1 };

    expect(compactRoutePoints([start, start, end])).toEqual([start, end]);
  });

  it("compacts a near-stationary tail while preserving its final endpoint and turn", () => {
    const points = [
      { forward: 0, left: 0 },
      { forward: 3, left: 0 },
      { forward: 5, left: 2 },
      { forward: 5.0004, left: 2 },
      { forward: 5.0008, left: 2 },
    ];
    const compacted = compactRoutePoints(points);

    expect(compacted).toEqual([points[0], points[1], points.at(-1)]);
    expect(compacted.every((point, index) => index === 0 || Math.hypot(
      point.forward - compacted[index - 1].forward,
      point.left - compacted[index - 1].left,
    ) > ROUTE_COMPACTION_EPSILON_METERS)).toBe(true);
  });

  it("preserves turns and endpoint revisits instead of globally deduplicating", () => {
    const points = [
      { forward: 0, left: 0 },
      { forward: 4, left: 0 },
      { forward: 4, left: 3 },
      { forward: 0, left: 0 },
    ];

    expect(compactRoutePoints(points)).toEqual(points);
  });

  it("evaluates route usability after compacting stationary jitter", () => {
    const jitter = Array.from({ length: 3_000 }, (_, index) => ({
      forward: index % 2 === 0 ? 0 : ROUTE_COMPACTION_EPSILON_METERS * 0.8,
      left: 0,
    }));
    expect(routeDistance(jitter)).toBeGreaterThan(2);
    expect(hasUsableRoute(jitter, 2)).toBe(false);

    const geometry = selectMapGeometry(
      jitter,
      [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }],
      [],
    );
    expect(geometry.source).toBe("planned-path");
  });

  it("rejects 2.1cm stationary oscillation even when raw distance exceeds 2m", () => {
    const oscillating = Array.from({ length: 101 }, (_, index) => ({
      forward: index % 2 === 0 ? 0 : 0.021,
      left: 0,
    }));
    expect(routeDistance(oscillating)).toBeCloseTo(2.1);
    expect(hasUsableRoute(oscillating, 2)).toBe(false);

    const geometry = selectMapGeometry(
      oscillating,
      [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }],
      [],
    );
    expect(geometry.source).toBe("planned-path");
  });

  it("retains slow monotonic 2.1cm steps once their accumulated travel exceeds 2m", () => {
    const slowTravel = Array.from({ length: 101 }, (_, index) => ({
      forward: index * 0.021,
      left: 0,
    }));
    const compacted = compactRoutePoints(slowTravel);

    expect(compacted[0]).toEqual(slowTravel[0]);
    expect(compacted.at(-1)).toEqual(slowTravel.at(-1));
    expect(routeDistance(compacted)).toBeCloseTo(2.1);
    expect(hasUsableRoute(slowTravel, 2)).toBe(true);
  });

  it("uses a nonzero one-sided tangent for an A-B-A reversal", () => {
    const orientation = routeTangentAndNormal([
      { forward: 0, left: 0 },
      { forward: 1, left: 0 },
      { forward: 0, left: 0 },
    ], 1);

    expect(Math.hypot(orientation.tangent.forward, orientation.tangent.left)).toBeCloseTo(1);
    expect(Math.hypot(orientation.normal.forward, orientation.normal.left)).toBeCloseTo(1);
  });

  it("requires two spatially distinct points and the requested distance", () => {
    expect(hasUsableRoute([{ forward: 0, left: 0 }], 2)).toBe(false);
    expect(hasUsableRoute([
      { forward: 0, left: 0 },
      { forward: 1.99, left: 0 },
    ], 2)).toBe(false);
    expect(hasUsableRoute([
      { forward: 0, left: 0 },
      { forward: 2, left: 0 },
    ], 2)).toBe(true);
  });

  it("prefers a spatially usable measured ego route", () => {
    const egoRoute = [{ forward: -3, left: 0 }, { forward: 6, left: 1 }];

    const geometry = selectMapGeometry(
      egoRoute,
      [{ x: 0, y: 0, z: 0 }, { x: 40, y: 3, z: 0 }],
      [{ id: "ego", points: [{ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }] }],
    );

    expect(geometry.source).toBe("ego-route");
    expect(geometry.road).toEqual(egoRoute);
    expect(geometry.plannedPath.at(-1)).toEqual({ forward: 40, left: 3 });
    expect(geometry.lanes[0].points.at(-1)).toEqual({ forward: 50, left: 0 });
  });

  it("returns a compacted measured road without adjacent near-duplicates", () => {
    const start = { forward: 0, left: 0 };
    const end = { forward: 8, left: 1 };
    const geometry = selectMapGeometry([start, start, end], [], []);

    expect(geometry.source).toBe("ego-route");
    expect(geometry.road).toEqual([start, end]);
  });

  it("uses plannedPath when the ego route is stationary", () => {
    const geometry = selectMapGeometry(
      [{ forward: 0, left: 0 }, { forward: 0, left: 0 }],
      [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 40, y: 3, z: 0 }],
      [],
    );

    expect(geometry.source).toBe("planned-path");
    expect(geometry.road).toEqual([
      { forward: 0, left: 0 },
      { forward: 40, left: 3 },
    ]);
  });

  it("uses the ego lane center when measured and planned routes are unusable", () => {
    const geometry = selectMapGeometry(
      [],
      [{ x: 0, y: 0, z: 0 }],
      [
        { id: "left", points: [{ x: 0, y: 3.6, z: 0 }, { x: 40, y: 3.6, z: 0 }] },
        { id: "ego", points: [{ x: -12, y: 0, z: 0 }, { x: -12, y: 0, z: 0 }, { x: 76, y: 1, z: 0 }] },
      ],
    );

    expect(geometry.source).toBe("lane-center");
    expect(geometry.road).toEqual([
      { forward: -12, left: 0 },
      { forward: 76, left: 1 },
    ]);
  });

  it("uses a straight corridor only when all measured and generated paths are unusable", () => {
    const geometry = selectMapGeometry([], [], []);

    expect(geometry.source).toBe("fallback");
    expect(geometry.road).toEqual([
      { forward: -12, left: 0 },
      { forward: 76, left: 0 },
    ]);
  });
});
