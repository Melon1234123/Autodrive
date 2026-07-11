import { useState, type CSSProperties } from "react";
import numeral1 from "./assets/archive-numerals/1.png";
import numeral2 from "./assets/archive-numerals/2.png";
import numeral3 from "./assets/archive-numerals/3.png";
import numeral4 from "./assets/archive-numerals/4.png";
import "./ShowcaseArchiveDeck.css";

export type ArchiveCardId = 1 | 2 | 3 | 4;

export type ShowcaseArchiveItem = {
  id: ArchiveCardId;
  title: string;
  meta: string;
  description: string;
};

type ShowcaseArchiveDeckProps = {
  ariaLabel: string;
  items: readonly ShowcaseArchiveItem[];
  className?: string;
  defaultActiveId?: ArchiveCardId;
};

type CardStyle = CSSProperties & {
  "--archive-card-bg": string;
  "--archive-card-fg": string;
};

const palette: Record<ArchiveCardId, { background: string; foreground: string }> = {
  1: { background: "#DCECDF", foreground: "#101A18" },
  2: { background: "#3F6F63", foreground: "#F1F7F3" },
  3: { background: "#AACBBB", foreground: "#101A18" },
  4: { background: "#173F38", foreground: "#F1F7F3" },
};

const numeralMasks: Record<ArchiveCardId, string> = {
  1: numeral1,
  2: numeral2,
  3: numeral3,
  4: numeral4,
};

export default function ShowcaseArchiveDeck({
  ariaLabel,
  items,
  className = "",
  defaultActiveId = 2,
}: ShowcaseArchiveDeckProps) {
  const [activeId, setActiveId] = useState<ArchiveCardId>(defaultActiveId);

  return (
    <div className={`archive-deck ${className}`.trim()} role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.id === activeId;
        const colors = palette[item.id];
        const style: CardStyle = {
          "--archive-card-bg": colors.background,
          "--archive-card-fg": colors.foreground,
        };

        return (
          <button
            aria-label={item.title}
            aria-pressed={active}
            className={`archive-card${active ? " is-active" : ""}`}
            data-archive-id={item.id}
            key={item.id}
            onClick={() => setActiveId(item.id)}
            style={style}
            type="button"
          >
            <span className="archive-card-cluster">
              <span className="archive-number-box" aria-hidden="true">
                <span
                  className="archive-number-mask"
                  style={{ WebkitMaskImage: `url(${numeralMasks[item.id]})`, maskImage: `url(${numeralMasks[item.id]})` }}
                />
                <span className="archive-number-fallback">{item.id}</span>
              </span>
              <span className="archive-card-title">{item.title}</span>
              <span className="archive-card-meta">{item.meta}</span>
              <span className="archive-card-description">{item.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
