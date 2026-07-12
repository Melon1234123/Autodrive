import { ArrowLeft, ArrowUpRight } from "lucide-react";
import GlassSurface from "../GlassSurface";

type CockpitNavProps = {
  onReturnSite: () => void;
  onContact: () => void;
};

export function CockpitNav({ onReturnSite, onContact }: CockpitNavProps) {
  return (
    <nav className="cockpit-nav" aria-label="驾驶舱导航">
      <GlassSurface
        width="100%"
        height="100%"
        borderRadius={14}
        borderWidth={0.12}
        brightness={70}
        opacity={0.86}
        blur={9}
        displace={0.35}
        backgroundOpacity={0.16}
        saturation={1.65}
        distortionScale={-120}
        redOffset={3}
        greenOffset={12}
        blueOffset={22}
        mixBlendMode="screen"
        className="cockpit-nav__glass"
      >
        <div className="cockpit-brand" aria-label="智驾卫士">
          <span className="brand-mark"><img src="/driveguard-mark.png" alt="" aria-hidden="true" /></span>
          <span>智驾卫士</span>
          <small>诊断驾驶舱</small>
        </div>
        <div className="cockpit-nav__actions">
          <button type="button" onClick={onReturnSite}><ArrowLeft size={15} aria-hidden="true" />返回官网</button>
          <button type="button" onClick={onContact}>联系我们<ArrowUpRight size={15} aria-hidden="true" /></button>
        </div>
      </GlassSurface>
    </nav>
  );
}
