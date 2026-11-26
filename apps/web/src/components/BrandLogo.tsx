import logoUrl from "../assets/big-b-coffee-logo.png";
// CALTEX Havoline, supplied by the shop (oil-change bays are Havoline service points).
// Black-and-white: thermal printers print no colour, so the yellow letters print as outlines.
import oilServiceReceiptLogo from "../assets/oil-service-receipt-logo.png";
import type { CSSProperties } from "react";

type BrandLogoProps = {
  className?: string;
  style?: CSSProperties;
};

export { logoUrl };

// Logo printed at the top of receipts, per business.
const RECEIPT_LOGOS: Record<string, string> = { oil_service: oilServiceReceiptLogo };

export function receiptLogoFor(branchType?: string | null): string {
  return (branchType && RECEIPT_LOGOS[branchType]) || logoUrl;
}

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
