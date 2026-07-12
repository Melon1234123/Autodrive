import { useState, type CSSProperties, type KeyboardEvent } from "react";
import MotionHeadline from "./MotionHeadline";
import "./PositioningOrbitDemo.css";

type OrbitItem = {
  id: 1 | 2 | 3 | 4;
  title: string;
  description: string;
};

const orbitItems: readonly OrbitItem[] = [
  { id: 1, title: "证据链诊断", description: "同步视频、点云、地图、车辆状态与感知结果，按时间轴对齐风险对象、触发时刻和关键证据，帮助研发人员从异常现象追溯到具体失效链路。" },
  { id: 2, title: "多智能体协同", description: "由编排 Agent 调度感知、决策、轨迹分析和数据生成任务，串联跨模块证据，形成从问题定位到结果复核的协同诊断流程。" },
  { id: 3, title: "非侵入式接入", description: "通过算法结构描述协议接入视频、传感器、轨迹、目标和环境上下文，不触碰核心代码与模型权重，兼顾数据主权和跨架构适配。" },
  { id: 4, title: "诊断即训练", description: "把诊断 Agent 发现的失效逻辑反向生成正确/错误推理对和高价值复盘样本，沉淀为可交付训练数据，支持后续模型与策略迭代。" },
];

const ORBIT_ROW_STEP = 184;
const ORBIT_ROW_TOP = 364;
const ORBIT_RADIUS = 950;
const ORBIT_CENTER_X = -420;
const ORBIT_CENTER_Y = 436;
const ORBIT_ANCHOR_SIZE = 16;

function orbitAnchorLeft(index: number, rowCenterOffset: number) {
  const anchorCenterY = ORBIT_ROW_TOP + index * ORBIT_ROW_STEP + rowCenterOffset;
  const yOffset = anchorCenterY - ORBIT_CENTER_Y;
  const pointX = ORBIT_CENTER_X + Math.sqrt(Math.max(0, ORBIT_RADIUS ** 2 - yOffset ** 2));
  return pointX - ORBIT_ANCHOR_SIZE / 2;
}

function orbitItemAngle(index: number, rowCenterOffset: number) {
  const anchorCenterY = ORBIT_ROW_TOP + index * ORBIT_ROW_STEP + rowCenterOffset;
  const yOffset = anchorCenterY - ORBIT_CENTER_Y;
  const xOffset = Math.sqrt(Math.max(0, ORBIT_RADIUS ** 2 - yOffset ** 2));
  return (Math.atan2(yOffset, xOffset) * 180) / Math.PI;
}

type PositioningOrbitProps = {
  standalone?: boolean;
};

export default function PositioningOrbit({ standalone = false }: PositioningOrbitProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const rowCenterOffset = standalone ? 72 : 80;
  const orbitAngle = orbitItemAngle(0, rowCenterOffset) - orbitItemAngle(activeIndex, rowCenterOffset);
  const worldStyle = {
    "--orbit-angle": `${orbitAngle}deg`,
    "--orbit-counter-angle": `${-orbitAngle}deg`,
  } as CSSProperties;
  const visibleStart = Math.min(Math.max(activeIndex - 1, 0), orbitItems.length - 3);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    const numericIndex = Number(event.key) - 1;
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < orbitItems.length) {
      event.preventDefault();
      setActiveIndex(numericIndex);
      return;
    }

    const delta = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
    if (!delta) return;

    event.preventDefault();
    setActiveIndex((currentIndex) => (currentIndex + delta + orbitItems.length) % orbitItems.length);
  };

  return (
    <div
      className={`positioning-orbit-demo-canvas${standalone ? "" : " positioning-orbit-embedded-canvas"}`}
      role="region"
      aria-label="一套面向研发测试的可解释性诊断与优化系统"
      aria-keyshortcuts="1 2 3 4 ArrowUp ArrowDown ArrowLeft ArrowRight"
      onKeyDown={handleKeyDown}
    >
      <div className="positioning-orbit-fixed-copy">
        {standalone ? (
          <p className="positioning-orbit-kicker">PROJECT POSITIONING</p>
        ) : (
          <div className="section-index" data-motion-index>01 / 项目定位</div>
        )}
        <MotionHeadline
          as={standalone ? "h1" : "h2"}
          label="一套面向研发测试的可解释性诊断与优化系统"
          lines={[<>一套面向研发测试的</>, <><em>可解释性诊断与优化系统</em></>]}
        />
        <p data-motion-copy>智驾卫士面向智能驾驶研发、测试验证和事故复盘场景，把视频、感知、地图、点云和诊断结论组织成同一条证据链。</p>
        </div>

      <div className="positioning-orbit-world" data-motion-stagger>
        <div className="positioning-orbit-rotation-layer" style={worldStyle}>
          <svg className="positioning-orbit-giant-ring" viewBox="0 0 1924 1924" aria-hidden="true">
            <circle className="positioning-orbit-ring-line positioning-orbit-ring-outer" cx="962" cy="962" r="961" />
            <circle className="positioning-orbit-ring-line positioning-orbit-ring-fine" cx="962" cy="962" r="950" transform="rotate(18 962 962)" />
            <circle className="positioning-orbit-ring-line positioning-orbit-ring-heavy" cx="962" cy="962" r="924" transform="rotate(-14 962 962)" />
            <circle className="positioning-orbit-ring-line positioning-orbit-ring-inner" cx="962" cy="962" r="866" transform="rotate(28 962 962)" />
          </svg>
          {orbitItems.map((item, index) => {
            const distance = Math.abs(index - activeIndex);
            const isVisible = index >= visibleStart && index < visibleStart + 3;

            return (
              <div
                className={`positioning-orbit-bound-row positioning-orbit-distance-${distance} ${isVisible ? "is-visible" : "is-hidden"}`}
                key={item.id}
                aria-hidden={!isVisible}
                style={{
                  top: `${ORBIT_ROW_TOP + index * ORBIT_ROW_STEP}px`,
                  "--orbit-anchor-left": `${orbitAnchorLeft(index, rowCenterOffset)}px`,
                } as CSSProperties}
              >
                <div className="positioning-orbit-row-content">
                  <span className={`positioning-orbit-anchor${index === activeIndex ? " is-active" : ""}`} aria-hidden="true" />
                  <span className="positioning-orbit-connector" aria-hidden="true" />
                  <button
                    type="button"
                    className={`positioning-orbit-card${index === activeIndex ? " is-active" : ""}`}
                    aria-pressed={index === activeIndex}
                    tabIndex={isVisible ? 0 : -1}
                    onClick={() => setActiveIndex(index)}
                  >
                    <span className="positioning-orbit-card-number">{String(item.id).padStart(2, "0")}</span>
                    <span className="positioning-orbit-card-copy">
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
