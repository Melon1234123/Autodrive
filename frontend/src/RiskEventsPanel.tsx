import { AlertTriangle, Clock3, History, RotateCcw } from "lucide-react";
import type { RiskEvent } from "./risk-events";

type RiskEventsPanelProps = {
  events: RiskEvent[];
  currentTime: number;
  onSeek: (time: number, event: RiskEvent) => void;
};

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = time - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function RiskEventsPanel({ events, currentTime, onSeek }: RiskEventsPanelProps) {
  return (
    <section className="risk-events-panel" aria-label="历史风险事件">
      <div className="panel-title">
        <History size={18} aria-hidden="true" />
        <span>历史风险事件</span>
        <strong>{events.length} 条</strong>
      </div>
      <p className="risk-events-hint">事件结束后自动归档；点击即可回到风险峰值帧，并同步视频、感知与轨迹视图。</p>
      <div className="risk-events-list">
        {events.length === 0 ? (
          <div className="risk-events-empty">播放中，等待首个风险事件归档。</div>
        ) : events.map((event) => {
          const active = currentTime >= event.startTime && currentTime <= event.endTime;
          return (
            <button
              className={`risk-event risk-event-${event.risk} ${active ? "is-active" : ""}`}
              key={event.id}
              type="button"
              onClick={() => onSeek(event.seekTime, event)}
              aria-current={active ? "true" : undefined}
            >
              <span className="risk-event-icon"><AlertTriangle size={16} aria-hidden="true" /></span>
              <span className="risk-event-copy">
                <strong>{event.title}</strong>
                <span>{event.summary}</span>
              </span>
              <span className="risk-event-time"><Clock3 size={13} aria-hidden="true" />{formatTime(event.seekTime)}</span>
              <RotateCcw className="risk-event-replay" size={15} aria-label="回放事件" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
