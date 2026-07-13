import { useRef } from "react";
import type { ReactNode, TransitionEvent } from "react";

export type ViewTransitionPhase = "site" | "entering" | "cockpit" | "exiting";

export type ViewTransitionStageProps = {
  phase: ViewTransitionPhase;
  site: ReactNode;
  cockpit: ReactNode;
  onTransitionComplete: (phase: ViewTransitionPhase) => void;
};

export function ViewTransitionStage({
  phase,
  site,
  cockpit,
  onTransitionComplete,
}: ViewTransitionStageProps) {
  const completedPhaseRef = useRef<ViewTransitionPhase | null>(null);

  const handleLayerTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") return;
    if (phase !== "entering" && phase !== "exiting") return;
    if (completedPhaseRef.current === phase) return;

    completedPhaseRef.current = phase;
    onTransitionComplete(phase);
  };

  const siteActive = phase === "site" || phase === "exiting";
  const cockpitActive = phase !== "site";

  const siteInteractive = phase === "site";
  const cockpitInteractive = phase === "cockpit";

  return (
    <div
      className={`view-transition-stage view-transition-stage--${phase}`}
      data-testid="view-transition-stage"
      data-view-transition-phase={phase}
    >
      <div
        className="view-transition-stage__layer view-transition-stage__layer--site"
        data-testid="view-layer-site"
        data-view-layer="site"
        data-active={siteActive}
        data-interactive={siteInteractive}
        aria-hidden={!siteInteractive}
        inert={!siteInteractive}
        onTransitionEnd={handleLayerTransitionEnd}
      >
        {site}
      </div>
      <div
        className="view-transition-stage__layer view-transition-stage__layer--cockpit"
        data-testid="view-layer-cockpit"
        data-view-layer="cockpit"
        data-active={cockpitActive}
        data-interactive={cockpitInteractive}
        aria-hidden={!cockpitInteractive}
        inert={!cockpitInteractive}
        onTransitionEnd={handleLayerTransitionEnd}
      >
        {cockpit}
      </div>
    </div>
  );
}
