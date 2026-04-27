type DocumentDetail = {
  id: string;
  title: string;
  category: string;
  refNumber: string;
  expiryDate: string;
  alertThresholdDays: number;
  fileUrl: string;
  fileName: string;
  isRecurring: boolean;
  recurrenceIntervalMonths: number;
  owner: string;
  lastUpdatedAt: string;
  notes: string;
};

type AuditLogItem = {
  id: string;
  action: "Created" | "Updated" | "Replaced File";
  changedBy: string;
  changedAt: string;
  summary: string;
};

type RecurringPeriodItem = {
  id: string;
  label: string;
  dueDate: string;
  status: "completed" | "pending" | "overdue";
  hasFile: boolean;
};

type HealthStatus = "Normal" | "Warning" | "Critical";

const DAY_MS = 1000 * 60 * 60 * 24;

const mockDocument: DocumentDetail = {
  id: "DOC-UTIL-2026-01",
  title: "บิลค่าไฟฟ้า - เดือนมกราคม 2569",
  category: "สาธารณูปโภค",
  refNumber: "ELEC-2026-01",
  expiryDate: "2026-02-24",
  alertThresholdDays: 7,
  fileUrl: "https://example.com/storage/electricity-jan-2026.pdf",
  fileName: "electricity-jan-2026.pdf",
  isRecurring: true,
  recurrenceIntervalMonths: 1,
  owner: "ผู้จัดการสาขา - บางนา",
  lastUpdatedAt: "2026-02-10T15:35:00Z",
  notes:
    "เอกสารค่าไฟฟ้ารายเดือน ต้องชำระก่อนวันครบกำหนดเพื่อหลีกเลี่ยงค่าปรับ โดยทีมบัญชีจะตรวจสอบยอดก่อนอนุมัติจ่ายทุกครั้ง"
};

const mockAuditLogs: AuditLogItem[] = [
  {
    id: "AUD-01",
    action: "Created",
    changedBy: "Nisa K.",
    changedAt: "2026-02-01T09:10:00Z",
    summary: "สร้างรายการบิลค่าไฟฟ้าแบบวนรอบสำหรับเดือนมกราคม 2569"
  },
  {
    id: "AUD-02",
    action: "Replaced File",
    changedBy: "Nisa K.",
    changedAt: "2026-02-05T16:22:00Z",
    summary: "อัปโหลดไฟล์ PDF ฉบับแก้ไขจากผู้ให้บริการไฟฟ้า"
  },
  {
    id: "AUD-03",
    action: "Updated",
    changedBy: "Korn T.",
    changedAt: "2026-02-10T15:35:00Z",
    summary: "ปรับวันแจ้งเตือนล่วงหน้าจาก 5 วันเป็น 7 วัน"
  }
];

const mockRecurringTimeline: RecurringPeriodItem[] = [
  { id: "R-2025-12", label: "ธ.ค. 2568", dueDate: "2026-01-24", status: "completed", hasFile: true },
  { id: "R-2026-01", label: "ม.ค. 2569", dueDate: "2026-02-24", status: "pending", hasFile: true },
  { id: "R-2026-02", label: "ก.พ. 2569", dueDate: "2026-03-24", status: "pending", hasFile: false }
];

function toUtcDate(dateLike: string | Date) {
  const date = new Date(dateLike);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function getDaysLeft(expiryDate: string, today = new Date()) {
  return Math.floor((toUtcDate(expiryDate) - toUtcDate(today)) / DAY_MS);
}

function checkDocumentStatus(doc: Pick<DocumentDetail, "expiryDate" | "alertThresholdDays">): HealthStatus {
  const threshold = Math.max(0, doc.alertThresholdDays);
  const daysLeft = getDaysLeft(doc.expiryDate);

  if (daysLeft < 0) return "Critical";

  const criticalWindow = threshold > 0 ? Math.max(1, Math.ceil(threshold * 0.3)) : 0;
  if (daysLeft <= criticalWindow) return "Critical";
  if (daysLeft <= threshold) return "Warning";
  return "Normal";
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(dateString: string) {
  return new Date(dateString).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const statusToneClass: Record<HealthStatus, string> = {
  Normal: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  Warning: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
  Critical: "bg-red-100 text-red-700 ring-1 ring-red-200"
};

const recurringToneClass: Record<RecurringPeriodItem["status"], string> = {
  completed: "bg-emerald-100 text-emerald-700",
  pending: "bg-amber-100 text-amber-700",
  overdue: "bg-red-100 text-red-700"
};

function getHealthStatusLabel(status: HealthStatus) {
  if (status === "Critical") return "วิกฤต";
  if (status === "Warning") return "เฝ้าระวัง";
  return "ปกติ";
}

function getAuditActionLabel(action: AuditLogItem["action"]) {
  if (action === "Created") return "สร้างรายการ";
  if (action === "Updated") return "อัปเดตข้อมูล";
  return "แทนที่ไฟล์";
}

function getRecurringStatusLabel(status: RecurringPeriodItem["status"]) {
  if (status === "completed") return "เสร็จสิ้น";
  if (status === "pending") return "รอดำเนินการ";
  return "เกินกำหนด";
}

export default function DocumentDetailPage() {
  const documentStatus = checkDocumentStatus(mockDocument);
  const daysLeft = getDaysLeft(mockDocument.expiryDate);

  return (
    <main className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-stone-100 p-6 md:p-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <button
                type="button"
                className="inline-flex items-center text-sm font-semibold text-stone-600 transition hover:text-stone-900"
              >
                ← กลับหน้าแดชบอร์ด
              </button>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
                รายละเอียดเอกสาร
              </p>
              <h1 className="mt-2 text-2xl font-black text-stone-900 md:text-3xl">{mockDocument.title}</h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${statusToneClass[documentStatus]}`}
              >
                {getHealthStatusLabel(documentStatus)}
              </span>
              <button
                type="button"
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
              >
                แก้ไขเอกสาร
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-lg font-extrabold text-stone-900">ข้อมูลเอกสาร</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">หมวดหมู่</dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">{mockDocument.category}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  เลขอ้างอิง
                </dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">{mockDocument.refNumber}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  วันหมดอายุ
                </dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">{formatDate(mockDocument.expiryDate)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">คงเหลือ</dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">
                  {daysLeft < 0 ? `หมดอายุแล้ว ${Math.abs(daysLeft)} วัน` : `${daysLeft} วัน`}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  แจ้งเตือนล่วงหน้า
                </dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">
                  {mockDocument.alertThresholdDays} วัน
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  ผู้รับผิดชอบ
                </dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">{mockDocument.owner}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">เอกสารวนรอบ</dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">
                  {mockDocument.isRecurring
                    ? `ใช่ (ทุก ${mockDocument.recurrenceIntervalMonths} เดือน)`
                    : "ไม่ใช่"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                  อัปเดตล่าสุด
                </dt>
                <dd className="mt-1 text-sm font-semibold text-stone-800">
                  {formatDateTime(mockDocument.lastUpdatedAt)}
                </dd>
              </div>
            </dl>
            <div className="mt-5 rounded-xl bg-stone-50 p-4 text-sm leading-relaxed text-stone-700">
              {mockDocument.notes}
            </div>
          </article>

          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-lg font-extrabold text-stone-900">ไฟล์เอกสารแนบ</h2>
            <div className="mt-4 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-4">
              <p className="text-sm font-semibold text-stone-800">{mockDocument.fileName}</p>
              <p className="mt-1 text-xs text-stone-500">ไฟล์ประเภท PDF</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={mockDocument.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
                >
                  เปิดไฟล์
                </a>
                <button
                  type="button"
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
                >
                  แทนที่ไฟล์
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
              กติกาการแจ้งเตือน: เมื่อจำนวนวันที่เหลือน้อยกว่าหรือเท่ากับค่าการแจ้งเตือนล่วงหน้า
              ระบบจะส่ง LINE อัตโนมัติ และเปลี่ยนสถานะเอกสารเป็นเฝ้าระวังหรือวิกฤต
            </div>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-lg font-extrabold text-stone-900">ประวัติการเปลี่ยนแปลง</h2>
            <ul className="mt-4 space-y-3">
              {mockAuditLogs.map((log) => (
                <li key={log.id} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-stone-800">{getAuditActionLabel(log.action)}</p>
                    <p className="text-xs text-stone-500">{formatDateTime(log.changedAt)}</p>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-stone-600">โดย: {log.changedBy}</p>
                  <p className="mt-2 text-sm text-stone-700">{log.summary}</p>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-stone-200">
            <h2 className="text-lg font-extrabold text-stone-900">ไทม์ไลน์งานวนรอบ</h2>
            {mockDocument.isRecurring ? (
              <>
                <ul className="mt-4 space-y-3">
                  {mockRecurringTimeline.map((period) => (
                    <li
                      key={period.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
                    >
                      <div>
                        <p className="text-sm font-bold text-stone-800">{period.label}</p>
                        <p className="text-xs text-stone-600">ครบกำหนด: {formatDate(period.dueDate)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${recurringToneClass[period.status]}`}
                        >
                          {getRecurringStatusLabel(period.status)}
                        </span>
                        <span className="text-xs font-semibold text-stone-600">
                          {period.hasFile ? "อัปโหลดไฟล์แล้ว" : "รออัปโหลดไฟล์"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 rounded-xl bg-blue-50 p-4 text-xs leading-relaxed text-blue-900 ring-1 ring-blue-200">
                  กลยุทธ์เอกสารวนรอบ: เมื่อปิดงานของเดือนปัจจุบันและอัปโหลดไฟล์ครบแล้ว
                  ระบบจะสร้างรายการเดือนถัดไปแบบอัตโนมัติในสถานะ{" "}
                  <strong>รอดำเนินการ</strong> และยังไม่แนบไฟล์
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm text-stone-600">เอกสารนี้ไม่ใช่งานวนรอบ</p>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
