import MotionHeadline from "./MotionHeadline";
import ShowcaseArchiveDeck, { type ShowcaseArchiveItem } from "./ShowcaseArchiveDeck";
import "./PositioningSection.css";

const positioningItems: ShowcaseArchiveItem[] = [
  { id: 1, title: "证据链诊断", meta: "VIDEO · LIDAR · MAP", description: "同步视频、点云、地图和车辆状态，定位风险对象与触发时刻。" },
  { id: 2, title: "多智能体协同", meta: "ORCHESTRATION", description: "由编排 Agent 调度感知、决策和数据生成任务，串联跨层根因。" },
  { id: 3, title: "非侵入式接入", meta: "PROTOCOL", description: "通过算法结构描述协议接入多源数据，避免触碰核心代码和权重。" },
  { id: 4, title: "诊断即训练", meta: "RLHF DATA LOOP", description: "把失效逻辑沉淀为推理对与高价值样本，反哺后续优化。" },
];

export default function PositioningSection() {
  return (
    <section className="intro-section positioning-section" data-motion-section data-terrain-preset="positioning" id="origin">
      <div className="content-width">
        <div className="position-copy positioning-copy-single">
          <div className="section-index" data-motion-index>01 / PROJECT POSITIONING</div>
          <MotionHeadline
            as="h2"
            label="一套面向研发测试的可解释性诊断与优化系统"
            lines={[<>一套面向研发测试的</>, <><em>可解释性诊断与优化系统</em></>]}
          />
          <p data-motion-copy>智驾卫士面向智能驾驶研发、测试验证和事故复盘场景，把视频、感知、地图、点云和诊断结论组织成同一条证据链，让系统不仅能指出风险，也能解释风险从哪里来。</p>
        </div>
        <ShowcaseArchiveDeck ariaLabel="项目定位四项能力" className="positioning-archive-deck" items={positioningItems} />
      </div>
    </section>
  );
}
