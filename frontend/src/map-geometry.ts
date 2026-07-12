export type EgoPoint = { forward: number; left: number };
export type Point3 = { x: number; y: number; z: number };
export type MapLane = { id: string; points: Point3[] };

export type MapGeometry = {
  source: "ego-route" | "planned-path" | "lane-center" | "fallback";
  road: EgoPoint[];
  plannedPath: EgoPoint[];
  lanes: Array<{ id: string; points: EgoPoint[] }>;
};

const MINIMUM_ROUTE_DISTANCE_METERS = 2;
export const ROUTE_COMPACTION_EPSILON_METERS = 0.05;
const FALLBACK_CORRIDOR: EgoPoint[] = [
  { forward: -12, left: 0 },
  { forward: 76, left: 0 },
];

export function routeDistance(points: readonly EgoPoint[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += Math.hypot(
      points[index].forward - points[index - 1].forward,
      points[index].left - points[index - 1].left,
    );
  }
  return distance;
}

function pointDistance(first: EgoPoint, second: EgoPoint): number {
  return Math.hypot(
    second.forward - first.forward,
    second.left - first.left,
  );
}

export type RouteTangentAndNormal = {
  tangent: EgoPoint;
  normal: EgoPoint;
};

export function routeTangentAndNormal(
  points: readonly EgoPoint[],
  index: number,
): RouteTangentAndNormal {
  const current = points[index];
  if (!current) {
    return {
      tangent: { forward: 1, left: 0 },
      normal: { forward: 0, left: 1 },
    };
  }

  let previous: EgoPoint | undefined;
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    if (pointDistance(current, points[candidateIndex]) > ROUTE_COMPACTION_EPSILON_METERS) {
      previous = points[candidateIndex];
      break;
    }
  }

  let next: EgoPoint | undefined;
  for (let candidateIndex = index + 1; candidateIndex < points.length; candidateIndex += 1) {
    if (pointDistance(current, points[candidateIndex]) > ROUTE_COMPACTION_EPSILON_METERS) {
      next = points[candidateIndex];
      break;
    }
  }

  const candidates = [
    previous && next
      ? { forward: next.forward - previous.forward, left: next.left - previous.left }
      : null,
    next
      ? { forward: next.forward - current.forward, left: next.left - current.left }
      : null,
    previous
      ? { forward: current.forward - previous.forward, left: current.left - previous.left }
      : null,
  ];
  const direction = candidates.find((candidate) => (
    candidate && Math.hypot(candidate.forward, candidate.left) > ROUTE_COMPACTION_EPSILON_METERS
  )) ?? { forward: 1, left: 0 };
  const length = Math.hypot(direction.forward, direction.left);
  const tangent = {
    forward: direction.forward / length,
    left: direction.left / length,
  };

  return {
    tangent,
    normal: { forward: -tangent.left, left: tangent.forward },
  };
}

export function compactRoutePoints(points: readonly EgoPoint[]): EgoPoint[] {
  if (points.length === 0) {
    return [];
  }

  const compacted = [{ ...points[0] }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (pointDistance(compacted[compacted.length - 1], point) > ROUTE_COMPACTION_EPSILON_METERS) {
      compacted.push({ ...point });
    }
  }

  if (points.length === 1) {
    return compacted;
  }

  const endpoint = { ...points[points.length - 1] };
  if (pointDistance(compacted[compacted.length - 1], endpoint) > ROUTE_COMPACTION_EPSILON_METERS) {
    compacted.push(endpoint);
    return compacted;
  }

  compacted[compacted.length - 1] = endpoint;
  while (
    compacted.length > 1 &&
    pointDistance(compacted[compacted.length - 2], compacted[compacted.length - 1]) <= ROUTE_COMPACTION_EPSILON_METERS
  ) {
    compacted.splice(compacted.length - 2, 1);
  }
  return compacted;
}

function isUsableCompactedRoute(points: readonly EgoPoint[], minimumDistance: number): boolean {
  return points.length >= 2 && routeDistance(points) >= minimumDistance;
}

export function hasUsableRoute(points: readonly EgoPoint[], minimumDistance: number): boolean {
  return isUsableCompactedRoute(compactRoutePoints(points), minimumDistance);
}

function toEgoPoint(point: Point3): EgoPoint {
  return { forward: point.x, left: point.y };
}

export function selectMapGeometry(
  egoRoute: readonly EgoPoint[],
  plannedPath: readonly Point3[],
  lanes: readonly MapLane[],
): MapGeometry {
  const compactedEgoRoute = compactRoutePoints(egoRoute);
  const convertedPlannedPath = plannedPath.map(toEgoPoint);
  const compactedPlannedPath = compactRoutePoints(convertedPlannedPath);
  const convertedLanes = lanes.map((lane) => ({
    id: lane.id,
    points: lane.points.map(toEgoPoint),
  }));

  if (isUsableCompactedRoute(compactedEgoRoute, MINIMUM_ROUTE_DISTANCE_METERS)) {
    return {
      source: "ego-route",
      road: compactedEgoRoute,
      plannedPath: convertedPlannedPath,
      lanes: convertedLanes,
    };
  }

  if (isUsableCompactedRoute(compactedPlannedPath, MINIMUM_ROUTE_DISTANCE_METERS)) {
    return {
      source: "planned-path",
      road: compactedPlannedPath,
      plannedPath: convertedPlannedPath,
      lanes: convertedLanes,
    };
  }

  const egoLane = convertedLanes.find((lane) => lane.id === "ego");
  const compactedEgoLane = compactRoutePoints(egoLane?.points ?? []);
  if (isUsableCompactedRoute(compactedEgoLane, MINIMUM_ROUTE_DISTANCE_METERS)) {
    return {
      source: "lane-center",
      road: compactedEgoLane,
      plannedPath: convertedPlannedPath,
      lanes: convertedLanes,
    };
  }

  return {
    source: "fallback",
    road: FALLBACK_CORRIDOR.map((point) => ({ ...point })),
    plannedPath: convertedPlannedPath,
    lanes: convertedLanes,
  };
}
