import type { PanelExtensionContext } from "@foxglove/extension";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type TelemetryFrame = {
  time?: number;
  speedKmh?: number;
  brake?: number;
  throttle?: number;
  steering?: number;
  accel?: number;
  scene?: string;
};

type DiagnosisResult = {
  riskLevel: "low" | "medium" | "high" | "unknown";
  thought: string;
  conclusion: string;
  mode?: "model" | "fallback";
  model?: string | null;
};

const riskText = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  unknown: "未知",
};

function formatNumber(value: unknown, digits = 1): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function Panel({ context }: { context: PanelExtensionContext }): JSX.Element {
  const [telemetry, setTelemetry] = useState<TelemetryFrame | undefined>();
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | undefined>();
  const [status, setStatus] = useState("等待播放");
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    context.subscribe([{ topic: "/autodrive/telemetry" }]);
    context.watch("currentFrame");
    context.onRender = (renderState, done) => {
      const event = renderState.currentFrame?.find((messageEvent) => messageEvent.topic === "/autodrive/telemetry");
      if (event?.message) {
        setTelemetry(event.message as TelemetryFrame);
        setStatus("已接收 telemetry");
      }
      done();
    };
    return () => {
      context.onRender = undefined;
      context.unsubscribeAll();
    };
  }, [context]);

  const risk = useMemo(() => {
    if (diagnosis?.riskLevel) {
      return diagnosis.riskLevel;
    }
    if (!telemetry) {
      return "unknown";
    }
    if ((telemetry.brake ?? 0) > 0.4 && (telemetry.throttle ?? 0) > 0.2) {
      return "high";
    }
    if ((telemetry.speedKmh ?? 0) > 30 && telemetry.scene?.includes("行人")) {
      return "high";
    }
    if (Math.abs(telemetry.steering ?? 0) > 0.5 && (telemetry.speedKmh ?? 0) > 40) {
      return "medium";
    }
    return "low";
  }, [diagnosis, telemetry]);

  const diagnose = () => {
    if (!telemetry) {
      setError("当前没有 telemetry frame");
      return;
    }
    setStatus("诊断中");
    setError(undefined);
    const socket = new WebSocket("ws://localhost:8080/ws");
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "diagnose", frame: telemetry }));
    };
    socket.onmessage = (event) => {
      try {
        setDiagnosis(JSON.parse(event.data) as DiagnosisResult);
        setStatus("诊断完成");
      } catch {
        setError("后端返回不是合法 JSON");
      } finally {
        socket.close();
      }
    };
    socket.onerror = () => {
      setStatus("诊断失败");
      setError("无法连接 ws://localhost:8080/ws");
    };
  };

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Autodrive Foxglove Panel</div>
          <div style={styles.title}>智驾诊断</div>
        </div>
        <div style={{ ...styles.risk, ...riskStyle(risk) }}>{riskText[risk]}</div>
      </div>

      <div style={styles.grid}>
        <Metric label="车速" value={`${formatNumber(telemetry?.speedKmh)} km/h`} />
        <Metric label="刹车" value={formatNumber(telemetry?.brake, 2)} />
        <Metric label="油门" value={formatNumber(telemetry?.throttle, 2)} />
        <Metric label="转向" value={formatNumber(telemetry?.steering, 2)} />
      </div>

      <div style={styles.box}>
        <div style={styles.label}>场景</div>
        <div style={styles.text}>{telemetry?.scene ?? "播放 .mcap 后订阅 /autodrive/telemetry"}</div>
      </div>

      <button style={styles.button} onClick={diagnose}>
        全域诊断
      </button>

      <div style={styles.box}>
        <div style={styles.label}>状态</div>
        <div style={styles.text}>{status}</div>
        {error && <div style={styles.error}>{error}</div>}
      </div>

      <div style={styles.box}>
        <div style={styles.label}>分析</div>
        <div style={styles.text}>{diagnosis?.thought ?? "等待诊断结果"}</div>
      </div>

      <div style={styles.box}>
        <div style={styles.label}>结论</div>
        <div style={styles.text}>{diagnosis?.conclusion ?? "等待诊断结果"}</div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={styles.metric}>
      <div style={styles.label}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function riskStyle(risk: string): React.CSSProperties {
  if (risk === "high") {
    return { background: "#df5148", color: "#fff8ef" };
  }
  if (risk === "medium") {
    return { background: "#f4cf5a", color: "#11130f" };
  }
  if (risk === "low") {
    return { background: "#89d987", color: "#11130f" };
  }
  return { background: "#c9cdbb", color: "#11130f" };
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: "100%",
    padding: 12,
    color: "#eef5e8",
    background: "#0d110d",
    fontFamily: "Inter, system-ui, sans-serif",
    overflow: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },
  kicker: {
    color: "#9ac7b0",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 4,
    fontSize: 21,
    fontWeight: 900,
  },
  risk: {
    minWidth: 78,
    padding: "7px 10px",
    borderRadius: 6,
    textAlign: "center",
    fontSize: 13,
    fontWeight: 900,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
    marginBottom: 10,
  },
  metric: {
    minHeight: 62,
    padding: 10,
    border: "1px solid rgba(220, 246, 205, 0.12)",
    borderRadius: 8,
    background: "rgba(246, 248, 229, 0.045)",
  },
  label: {
    color: "#aebcad",
    fontSize: 12,
    fontWeight: 800,
  },
  metricValue: {
    marginTop: 7,
    fontSize: 18,
    fontWeight: 900,
  },
  box: {
    marginBottom: 10,
    padding: 10,
    border: "1px solid rgba(220, 246, 205, 0.1)",
    borderRadius: 8,
    background: "rgba(5, 7, 5, 0.46)",
  },
  text: {
    marginTop: 7,
    fontSize: 13,
    lineHeight: 1.5,
  },
  button: {
    width: "100%",
    minHeight: 42,
    marginBottom: 10,
    border: 0,
    borderRadius: 8,
    color: "#10120e",
    background: "#c8f05f",
    fontWeight: 900,
    cursor: "pointer",
  },
  error: {
    marginTop: 7,
    color: "#ffe0d2",
  },
};

export function initPanel(context: PanelExtensionContext): () => void {
  const root = createRoot(context.panelElement);
  root.render(<Panel context={context} />);
  return () => {
    root.unmount();
  };
}
