export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type RiskTelemetryFrame = {
  time: number;
  speedKmh: number;
  brake: number;
  throttle: number;
  steering: number;
};

export type RiskPerceptionObject = {
  label: string;
  risk: RiskLevel;
};

export type RiskPerceptionFrame = {
  time: number;
  objects: RiskPerceptionObject[];
};

export type RiskEvent = {
  id: string;
  startTime: number;
  endTime: number;
  /** Timestamp used when returning the replay to this event. */
  seekTime: number;
  risk: Exclude<RiskLevel, "low" | "unknown">;
  title: string;
  summary: string;
  peakObjectCount: number;
};

const levelScore: Record<RiskLevel, number> = { unknown: 0, low: 0, medium: 2, high: 3 };

function nearest<T extends { time: number }>(items: T[], time: number) {
  return items.reduce<T | null>((closest, item) => {
    if (!closest || Math.abs(item.time - time) < Math.abs(closest.time - time)) return item;
    return closest;
  }, null);
}

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function frameRisk(telemetry: RiskTelemetryFrame | null, perception: RiskPerceptionFrame | null): RiskLevel {
  const objectRisk = perception?.objects.reduce<RiskLevel>(
    (top, object) => (levelScore[object.risk] > levelScore[top] ? object.risk : top),
    "low",
  ) ?? "low";
  if (objectRisk === "high" || (telemetry?.brake ?? 0) > 0.4 && (telemetry?.throttle ?? 0) > 0.2) return "high";
  if (objectRisk === "medium" || (Math.abs(telemetry?.steering ?? 0) > 0.45 && (telemetry?.speedKmh ?? 0) > 35)) return "medium";
  return "low";
}

/**
 * Turns per-frame telemetry and perception annotations into replayable risk episodes.
 * Brief low-risk gaps (for example an annotation drop between adjacent frames) are
 * merged, while very short isolated detections are omitted from the event history.
 */
export function deriveRiskEvents(
  telemetry: RiskTelemetryFrame[],
  perception: RiskPerceptionFrame[],
): RiskEvent[] {
  const samples = telemetry.map((frame) => {
    const perceptionFrame = nearest(perception, frame.time);
    return { time: frame.time, risk: frameRisk(frame, perceptionFrame), perception: perceptionFrame };
  });

  const raw: Array<{ start: number; end: number; samples: typeof samples }> = [];
  let active: typeof raw[number] | null = null;
  const mergeGapSeconds = 0.75;

  for (const sample of samples) {
    if (levelScore[sample.risk] > 0) {
      if (!active || sample.time - active.end > mergeGapSeconds) {
        active = { start: sample.time, end: sample.time, samples: [sample] };
        raw.push(active);
      } else {
        active.end = sample.time;
        active.samples.push(sample);
      }
    }
  }

  return raw
    .filter((event) => event.end - event.start >= 0.25 || event.samples.length >= 2)
    .map((event, index) => {
      const peak = event.samples.reduce((current, sample) =>
        levelScore[sample.risk] > levelScore[current.risk] ? sample : current,
      );
      const peakRisk = peak.risk as RiskEvent["risk"];
      const allObjects = event.samples.flatMap((sample) => sample.perception?.objects ?? []);
      const relevant = allObjects.filter((object) => object.risk === peakRisk);
      const labelCounts = relevant.reduce<Record<string, number>>((counts, object) => {
        counts[object.label] = (counts[object.label] ?? 0) + 1;
        return counts;
      }, {});
      const primaryLabel = Object.entries(labelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "周边目标";
      const peakObjectCount = Math.max(...event.samples.map((sample) =>
        sample.perception?.objects.filter((object) => object.risk === peakRisk).length ?? 0,
      ));
      const title = peakRisk === "high" ? "高危目标接近" : "中危交通参与者";
      const duration = Math.max(0.1, event.end - event.start);

      return {
        id: `risk-${index}-${event.start.toFixed(2)}`,
        startTime: event.start,
        endTime: event.end,
        seekTime: peak.time,
        risk: peakRisk,
        title,
        summary: `${primaryLabel} 风险持续 ${duration.toFixed(1)} 秒，峰值 ${peakObjectCount} 个${peakRisk === "high" ? "高危" : "中危"}目标。`,
        peakObjectCount,
      };
    })
    .sort((a, b) => a.seekTime - b.seekTime)
    .map((event) => ({ ...event, summary: `${formatTime(event.startTime)} · ${event.summary}` }));
}
