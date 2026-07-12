import BorderGlow from "./BorderGlow";
import MotionHeadline from "./MotionHeadline";
import ShowcaseNav from "./ShowcaseNav";
import "./ContextCardsDemo.css";

type EvidenceCard = {
  id: string;
  title: string;
  titleLead: string;
  titleAccentPrefix: string;
  titleAccent: string;
  description: string;
  metrics: readonly string[];
  visual: "policy" | "risk" | "workflow";
};

const evidenceCards: readonly EvidenceCard[] = [
  {
    id: "policy",
    title: "从功能实现走向过程可信",
    titleLead: "从功能实现",
    titleAccentPrefix: "走向",
    titleAccent: "过程可信",
    description: "《智能汽车创新发展战略》提出到 2025 年基本形成体系；2023 年准入和上路通行试点通知明确 L3/L4 限定区域试点，2024 年车路云试点继续强化安全保障。",
    metrics: ["2020 战略发布", "2023 L3 / L4 试点", "2024 车路云试点"],
    visual: "policy",
  },
  {
    id: "risk",
    title: "规模放大长尾风险",
    titleLead: "规模放大",
    titleAccentPrefix: "",
    titleAccent: "长尾风险",
    description: "进入真实道路场景后，智能驾驶会面对更多道路参与者与环境组合。低概率失效需要被持续记录、定位与复盘。安全命题也从单点能力延伸到全过程证据。",
    metrics: ["58% L2及以上新车占比", "2025 约 3950 亿元", "2026 预计超 5000 亿元"],
    visual: "risk",
  },
  {
    id: "workflow",
    title: "把手工作坊压缩成证据闭环",
    titleLead: "把手工作坊",
    titleAccentPrefix: "压缩",
    titleAccent: "证据闭环",
    description: "视频、点云、地图与车辆状态需要在同一时间轴上对齐。风险对象、触发时刻与诊断结论应当能够回放核对。复盘结果再沉淀为可复用的优化证据。",
    metrics: ["3 个工作日 → 分钟级", "前 20% 高价值样本", "1–3 天迭代目标"],
    visual: "workflow",
  },
];

function PolicyVisual() {
  return (
    <div className="context-demo-visual context-demo-visual-policy" aria-hidden="true">
      <span className="context-demo-policy-dot context-demo-policy-dot-one" data-year="2020" data-summary="战略发布" />
      <span className="context-demo-policy-dot context-demo-policy-dot-two" data-year="2023" data-summary="准入试点" />
      <span className="context-demo-policy-dot context-demo-policy-dot-three" data-year="2024" data-summary="车路云试点" />
      <span className="context-demo-policy-dot context-demo-policy-dot-four" data-year="2025" data-summary="体系形成" />
      <span className="context-demo-policy-future-arrow" />
    </div>
  );
}

function RiskVisual() {
  return (
    <div className="context-demo-visual context-demo-visual-risk" aria-hidden="true">
      <span className="context-demo-risk-ring context-demo-risk-ring-one" />
      <span className="context-demo-risk-ring context-demo-risk-ring-two" />
      <span className="context-demo-risk-ring context-demo-risk-ring-three" />
      <strong>58%</strong>
      <small>L2及以上新车占比</small>
    </div>
  );
}

function WorkflowVisual() {
  return (
    <div className="context-demo-visual context-demo-visual-workflow" aria-hidden="true">
      <div className="context-demo-workflow-stage"><strong>3 天</strong><small>人工复盘</small></div>
      <span className="context-demo-workflow-arrow">
        <i className="context-demo-workflow-arrow-piece context-demo-workflow-arrow-piece-one" />
        <i className="context-demo-workflow-arrow-piece context-demo-workflow-arrow-piece-two" />
        <i className="context-demo-workflow-arrow-piece context-demo-workflow-arrow-piece-three" />
      </span>
      <div className="context-demo-workflow-stage context-demo-workflow-stage-active"><strong>分钟级</strong><small>智能诊断</small></div>
    </div>
  );
}

function CardVisual({ visual }: { visual: EvidenceCard["visual"] }) {
  if (visual === "policy") return <PolicyVisual />;
  if (visual === "risk") return <RiskVisual />;
  return <WorkflowVisual />;
}

export function ContextCardsSection({ embedded = false }: { embedded?: boolean }) {
  return (
    <section
      className={`context-cards-demo-section${embedded ? " context-cards-demo-embedded" : ""}`}
      data-motion-section
      data-terrain-preset="pain"
      id={embedded ? "context" : undefined}
      aria-labelledby="context-cards-demo-title"
    >
      <div className="content-width context-cards-demo-content">
        <div className="section-index" data-motion-index>02 / 安全命题</div>
        <div className="context-cards-demo-lead">
          <MotionHeadline
            as="h1"
            label="规模化上路之后，安全需要过程可信"
            lines={[<>规模化上路之后，</>, <><em>安全需要过程可信</em></>]}
          />
          <p data-motion-copy>
            <span>监管与规模化研发效率正在同时改变安全命题。</span>
            <span>系统不仅要识别目标，还要保留边界与安全响应证据。</span>
            <span>这些信息共同支撑测试复盘与持续优化。</span>
          </p>
        </div>

        <div className="context-demo-card-grid" data-motion-stagger role="group" aria-label="安全命题证据卡片">
          {evidenceCards.map((card) => (
            <BorderGlow
              as="article"
              className={`context-demo-card context-demo-card-${card.id}`}
              backgroundColor={card.id === "risk" ? "#d9f35b" : "rgba(16,46,39,.94)"}
              key={card.id}
            >
              <CardVisual visual={card.visual} />
              <div className="context-demo-card-copy">
                <h2 aria-label={card.title}>
                  <span>{card.titleLead}</span>
                  <span>{card.titleAccentPrefix}{card.titleAccentPrefix ? " " : ""}<em>{card.titleAccent}</em></span>
                </h2>
                <p>{card.description}</p>
                <div className="context-demo-card-metrics">
                  {card.metrics.map((metric) => <span key={metric}>{metric}</span>)}
                </div>
              </div>
            </BorderGlow>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ContextCardsDemo() {
  return (
    <main className="showcase context-cards-demo">
      <ShowcaseNav hrefPrefix="/" />
      <ContextCardsSection />
    </main>
  );
}
