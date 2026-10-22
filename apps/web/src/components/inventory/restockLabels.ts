import type { RestockRequest, RestockStatus } from "../../types";

// Shared by the branch tab and the warehouse page so both sides read a request the same way.
export const RESTOCK_STATUS: Record<RestockStatus, { label: string; tone: string; hint: string }> = {
  DRAFT: { label: "ร่าง", tone: "is-out", hint: "ยังไม่ได้ส่งให้คลังกลาง" },
  SUBMITTED: { label: "รอคลังจัดของ", tone: "is-low", hint: "คลังกลางได้รับคำขอแล้ว" },
  PICKING: { label: "กำลังจัดของ", tone: "is-low", hint: "คลังกลางกำลังจัดของ" },
  IN_TRANSIT: { label: "กำลังส่ง", tone: "is-low", hint: "ของออกจากคลังแล้ว รอสาขากดรับ" },
  PARTIAL: { label: "ได้บางส่วน", tone: "is-low", hint: "รับของไปแล้วบางส่วน ที่เหลือรอส่ง" },
  RECEIVED: { label: "รับครบแล้ว", tone: "is-ok", hint: "สาขารับของครบแล้ว" },
  CANCELLED: { label: "ยกเลิก", tone: "is-out", hint: "ยกเลิกแล้ว" }
};

const fmt = (v: number) => v.toLocaleString("th-TH", { maximumFractionDigits: 3 });

/** "น้ำมัน 10W-40 ขอ 8 · ส่งแล้ว 5 · รับแล้ว 4 ลิตร" per line. */
export function restockLineSummary(request: RestockRequest) {
  return request.items.map((item) => {
    const parts = [`ขอ ${fmt(item.requestedQty)}`];
    if (item.shippedQty > 0) parts.push(`ส่งแล้ว ${fmt(item.shippedQty)}`);
    if (item.receivedQty > 0) parts.push(`รับแล้ว ${fmt(item.receivedQty)}`);
    return `${item.ingredient?.name ?? `#${item.ingredientId}`} ${parts.join(" · ")}${item.ingredient?.unit ? ` ${item.ingredient.unit}` : ""}`;
  }).join(" | ");
}
