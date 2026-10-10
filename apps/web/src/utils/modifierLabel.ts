export function modifierLabel(value: string) {
  return ({ Hot: "ร้อน", Iced: "เย็น", Frappe: "ปั่น" } as Record<string,string>)[value] ?? value;
}
