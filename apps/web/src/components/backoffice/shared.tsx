import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";

// Building blocks for the back-office page (/parity). Each section loads its own
// data so one slow or failed request only affects that section, with a retry.

export const money = (v: number) => `฿${(Number(v) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const thaiDate = (iso: string | null | undefined, withTime = true) => iso
  ? new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) })
  : "-";
export const todayBangkok = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

const RETRY_DELAYS = [600, 1500, 3500];

/** Load data for one section; retries network failures with backoff before showing an error. */
export function useSectionData<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useRef(0);

  const reload = useCallback(async () => {
    const id = ++run.current;
    setLoading(true);
    setError(null);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const next = await loadRef.current();
        if (id === run.current) { setData(next); setLoading(false); }
        return;
      } catch (err) {
        const message = (err as Error).message || "โหลดข้อมูลไม่สำเร็จ";
        // only network-level failures are worth retrying; a server "no" is final
        const transient = err instanceof TypeError || /failed to fetch|network|load failed/i.test(message);
        if (!transient || attempt >= RETRY_DELAYS.length) {
          if (id === run.current) { setError(message); setLoading(false); }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAYS[attempt]));
        if (id !== run.current) return;
      }
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, error, loading, reload, setData };
}

export function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="panel bo-section">
    <div className="panel__header">
      <div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {actions}
    </div>
    <div className="panel__body">{children}</div>
  </section>;
}

/** Loading / error-with-retry / content for one section. */
export function SectionState<T>({ state, empty, children }: { state: { data: T | null; error: string | null; loading: boolean; reload: () => void }; empty?: string; children: (data: T) => ReactNode }) {
  if (state.error) return <div className="bo-error" role="alert"><span>โหลดข้อมูลไม่สำเร็จ: {state.error}</span><button type="button" className="btn btn--ghost" onClick={() => state.reload()}><RefreshCw size={14} /> ลองใหม่</button></div>;
  if (state.data === null) return <div className="bo-loading" aria-busy="true"><span /><span /><span /></div>;
  if (empty && Array.isArray(state.data) && state.data.length === 0) return <p className="stk-hint">{empty}</p>;
  return <>{children(state.data)}</>;
}

export type PickerOption = { id: number; label: string; sub?: string; keywords?: string };

/** Type-to-search picker for long lists (products, orders) instead of a 1,000-row dropdown. */
export function SearchPicker({ options, value, onChange, placeholder, label, emptyText = "ไม่พบรายการ" }: {
  options: PickerOption[]; value: number | null; onChange: (id: number | null) => void; placeholder: string; label: string; emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const selected = options.find((o) => o.id === value) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => `${o.label} ${o.sub ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q)) : options;
    return list.slice(0, 30);
  }, [options, query]);
  useEffect(() => { setCursor(0); }, [query]);
  const listId = useMemo(() => `picker-${Math.random().toString(36).slice(2, 8)}`, []);

  const choose = (o: PickerOption) => { onChange(o.id); setQuery(""); setOpen(false); };
  return <div className="bo-picker">
    <label className="studio-search">
      <Search size={16} aria-hidden />
      <input
        role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        value={open ? query : selected ? `${selected.label}${selected.sub ? ` · ${selected.sub}` : ""}` : query}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, matches.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter" && matches[cursor]) { e.preventDefault(); choose(matches[cursor]); }
          else if (e.key === "Escape") setOpen(false);
        }}
      />
    </label>
    {open && <div className="bo-picker__list" id={listId} role="listbox">
      {matches.length ? matches.map((o, i) => <button type="button" role="option" aria-selected={i === cursor} key={o.id} className={i === cursor ? "is-active" : ""}
        onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setCursor(i)} onClick={() => choose(o)}>
        <strong>{o.label}</strong>{o.sub && <small>{o.sub}</small>}
      </button>) : <p className="stk-hint" style={{ padding: 12 }}>{emptyText}</p>}
    </div>}
  </div>;
}

export function Field({ label, hint, error, children, wide }: { label: string; hint?: string; error?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`stk-field${wide ? " bo-wide" : ""}`}>
    <span>{label}</span>
    {children}
    {error ? <small className="negative" role="alert">{error}</small> : hint ? <small>{hint}</small> : null}
  </label>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ISSUED: ["ออกแล้ว", "is-ok"], VOID: ["ยกเลิก", "is-out"], DRAFT: ["ร่าง", "is-low"], PAID: ["ชำระแล้ว", "is-ok"],
    ACCEPTED: ["แปลงเป็นใบแจ้งหนี้แล้ว", "is-ok"], IN_TRANSIT: ["ระหว่างส่ง", "is-low"], RECEIVED: ["รับแล้ว", "is-ok"], CANCELLED: ["ยกเลิก", "is-out"]
  };
  const [text, tone] = map[status] ?? [status, "is-low"];
  return <span className={`stk-badge ${tone}`}>{text}</span>;
}
