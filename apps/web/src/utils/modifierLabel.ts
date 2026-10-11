/** Drink options of an order line as one readable string: "เย็น · แก้วเย็น · หวาน 50% · +ไซรัป". */
export function describeModifiers(modifiers: Array<{ name?: string; value?: string }> | undefined | null) {
  return (modifiers ?? []).map((m) => {
    const value = modifierLabel(String(m.value ?? ""));
    if (m.name === "Sweetness") return `หวาน ${value}`;
    if (m.name === "Add-on") return `+${value}`;
    return value;
  }).filter(Boolean).join(" · ");
}

export function modifierLabel(value: string) {
  return ({ Hot: "ร้อน", Iced: "เย็น", Frappe: "ปั่น" } as Record<string,string>)[value] ?? value;
}
