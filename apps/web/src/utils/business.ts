import { Coffee, Wrench } from "lucide-react";

export function businessProfile(type?: string) {
  return type === "oil_service"
    ? { type: "oil_service", title: "บ่อถ่ายน้ำมัน", brand: "Service Studio", saleTitle: "สินค้าและบริการ", orderTitle: "รายการงานบริการ", catalogTitle: "สินค้า / อะไหล่", icon: Wrench, queue: false }
    : { type: "coffee", title: "ร้านกาแฟ", brand: "Big B Coffee", saleTitle: "รับออเดอร์", orderTitle: "ออเดอร์", catalogTitle: "เมนู / วัตถุดิบ", icon: Coffee, queue: true };
}

export const roleLabels: Record<string, string> = { admin: "ผู้ดูแลระบบ", manager: "ผู้จัดการสาขา", cashier: "พนักงานขาย" };
