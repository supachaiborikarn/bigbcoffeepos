import logoUrl from "../assets/big-b-coffee-logo.png";
import type { CSSProperties } from "react";

type BrandLogoProps = {
  className?: string;
  style?: CSSProperties;
};

export { logoUrl };

export default function BrandLogo({ className, style }: BrandLogoProps) {
  return (
    <img
      className={className}
      style={style}
      src={logoUrl}
      alt="Big B Coffee"
      loading="eager"
      decoding="async"
    />
  );
}
