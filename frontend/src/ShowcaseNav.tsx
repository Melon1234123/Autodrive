import { ArrowUpRight } from "lucide-react";
import GlassSurface from "./GlassSurface";

type ShowcaseNavProps = {
  hrefPrefix?: string;
};

const navItems = [
  { label: "项目定位", href: "#origin" },
  { label: "安全命题", href: "#context" },
  { label: "技术路线", href: "#route" },
  { label: "效果展示", href: "#demo" },
  { label: "产品体系", href: "#product" },
];

export default function ShowcaseNav({ hrefPrefix = "" }: ShowcaseNavProps) {
  return (
    <nav className="showcase-nav" aria-label="主导航">
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
        className="showcase-nav-glass"
      >
        <a className="brand" href={`${hrefPrefix}#home`}><span className="brand-mark"><img src="/driveguard-mark.png" alt="" aria-hidden="true" /></span><span>智驾卫士</span></a>
        <div className="nav-links">{navItems.map(({ label, href }) => <a href={`${hrefPrefix}${href}`} key={href}>{label}</a>)}</div>
        <a className="contact-link" href="mailto:23050824@hdu.edu.cn">联系我们 <ArrowUpRight size={15} /></a>
      </GlassSurface>
    </nav>
  );
}
