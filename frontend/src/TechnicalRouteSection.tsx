import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import SplitText from "./SplitText";
import "./TechnicalRouteSection.css";

type RouteNote = {
  id: 1 | 2 | 3 | 4;
  title: string;
  description: string;
  rotation: string;
};

const routeNotes: readonly RouteNote[] = [
  {
    id: 1,
    title: "协议接入",
    description: "通过标准化算法结构描述协议定义模型拓扑与数据接口，在不触碰源码和模型权重的前提下，接入传感器、隐层特征、执行轨迹与环境上下文。",
    rotation: "-4deg",
  },
  {
    id: 2,
    title: "感知诊断",
    description: "通过几何原型空间计算高维特征与标准语义原型的测地距离，量化类别混淆、语义漂移与置信度异常，定位感知层的错误来源。",
    rotation: "5deg",
  },
  {
    id: 3,
    title: "决策审计",
    description: "采用结构化思维链将隐晦的神经推理显性化为可追溯逻辑序列，并依托行业安全知识库校验前置条件与物理约束，定位决策链中的逻辑断裂。",
    rotation: "-3deg",
  },
  {
    id: 4,
    title: "RLHF 闭环",
    description: "诊断 Agent 按错误严重度、复现频率和逻辑复杂度筛选高价值样本，自动修复失效推理链，生成带根因标签的正确/错误推理对训练包。",
    rotation: "4deg",
  },
];

const pathPoints: Record<RouteNote["id"], { x: string; y: string }> = {
  1: { x: "82%", y: "8%" },
  2: { x: "18%", y: "30%" },
  3: { x: "82%", y: "54%" },
  4: { x: "18%", y: "68%" },
};

export default function TechnicalRouteSection() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [activeId, setActiveId] = useState<RouteNote["id"]>(2);
  const [animationCycle, setAnimationCycle] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (typeof IntersectionObserver === "undefined") {
      setAnimationCycle(1);
      return;
    }

    const root = section.closest<HTMLElement>(".showcase");
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setAnimationCycle((cycle) => cycle + 1);
      }
    }, { root, threshold: 0.35 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const numericId = Number(event.key);
    if (Number.isInteger(numericId) && numericId >= 1 && numericId <= 4) {
      event.preventDefault();
      setActiveId(numericId as RouteNote["id"]);
      return;
    }

    const delta = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (!delta) return;
    event.preventDefault();
    setActiveId((current) => ((current - 1 + delta + routeNotes.length) % routeNotes.length + 1) as RouteNote["id"]);
  };

  return (
    <section
      data-motion-section
      data-terrain-preset="route"
      id="route"
      aria-label="03 技术路线"
      className={`pain-section route-section technical-route-demo technical-route-demo--glass${animationCycle > 0 ? " is-visible" : ""}`}
      ref={sectionRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="technical-route-demo__shell">
        <header className="technical-route-demo__header">
          <div className="technical-route-demo__index" data-motion-index>03 / 技术路线</div>
          <SplitText tag="h1" ariaLabel="把故障诊断拆成四个可审计环节">
            <span className="technical-route-demo__title-line">把故障诊断拆成四个</span>
            <span className="technical-route-demo__title-line technical-route-demo__title-line--accent">可审计环节</span>
          </SplitText>
          <p data-motion-copy>技术路线不是简单展示结果，而是把数据如何进入、偏差如何量化、决策如何解释、修复数据如何生成全部结构化。</p>
        </header>

        <div className="technical-route-demo__board" role="group" aria-label="技术路线四个环节">
          <svg className="technical-route-demo__path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="technical-route-demo__path-desktop" d="M82 8 C65 14 34 20 18 30 S48 46 82 54 S46 60 18 68" />
            <path className="technical-route-demo__path-short" d="M82 8 C65 12 34 17 18 25 S48 38 82 46 S46 57 18 65" />
            <path className="technical-route-demo__path-mobile" d="M50 8 C50 16 50 24 50 30 S50 46 50 54 S50 66 50 76" />
          </svg>
          {routeNotes.map((note) => {
            const point = pathPoints[note.id];
            const style = {
              "--note-x": point.x,
              "--note-y": point.y,
              "--note-rotation": note.rotation,
              "--drop-delay": `${(note.id - 1) * 240}ms`,
            } as CSSProperties;
            const active = note.id === activeId;

            return (
              <button
                className={`technical-route-note${active ? " is-active" : ""}`}
                key={`${note.id}-${animationCycle}`}
                type="button"
                aria-pressed={active}
                aria-label={note.title}
                data-route-note={note.id}
                style={style}
                onClick={() => setActiveId(note.id)}
              >
                <span className="technical-route-note__pin" aria-hidden="true" />
                <span className="technical-route-note__paper">
                  <span className="technical-route-note__number">{String(note.id).padStart(2, "0")}</span>
                  <strong>{note.title}</strong>
                  <span className="technical-route-note__description">{note.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
