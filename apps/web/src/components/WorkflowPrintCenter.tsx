import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";

type WorkflowType = "ใบอนุญาต" | "ใบแจ้งหนี้" | "สิ่งแวดล้อม";
type WorkflowStatus = "ร่าง" | "เตรียมเอกสาร" | "ยื่นคำขอ" | "รอผล" | "เสร็จสิ้น";

type WorkflowItem = {
  id: string;
  title: string;
  type: WorkflowType;
  office: string;
  dueDate: string;
  status: WorkflowStatus;
  owner: string;
  notes: string;
};

type NewWorkflowForm = {
  title: string;
  type: WorkflowType;
  office: string;
  dueDate: string;
  owner: string;
  notes: string;
};

type InvoiceForm = {
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  period: string;
  station: string;
  payer: string;
  rentFee: number;
  electricityFee: number;
  commonFee: number;
  previousMeterReading: string;
  currentMeterReading: string;
  vatRate: number;
  note: string;
};

type EnvReportForm = {
  reportNo: string;
  issueDate: string;
  month: string;
  station: string;
  pH: number;
  bod: number;
  cod: number;
  tss: number;
  preparedBy: string;
  note: string;
};

const workflowSteps: WorkflowStatus[] = ["ร่าง", "เตรียมเอกสาร", "ยื่นคำขอ", "รอผล", "เสร็จสิ้น"];

const initialWorkflowItems: WorkflowItem[] = [
  {
    id: "WF-001",
    title: "ต่ออายุใบอนุญาตค้าปลีกน้ำมัน",
    type: "ใบอนุญาต",
    office: "สำนักงานพลังงานจังหวัด",
    dueDate: "2026-03-05",
    status: "เตรียมเอกสาร",
    owner: "คุณนิดา",
    notes: "เตรียมสำเนาใบอนุญาตเดิมและหนังสือรับรองบริษัท"
  },
  {
    id: "WF-002",
    title: "บิลค่าเช่าพื้นที่เดือนกุมภาพันธ์ 2569",
    type: "ใบแจ้งหนี้",
    office: "ฝ่ายบัญชีเจ้าของพื้นที่",
    dueDate: "2026-02-10",
    status: "ยื่นคำขอ",
    owner: "คุณกรณ์",
    notes: "รอใบเสร็จฉบับจริงหลังโอนชำระ"
  },
  {
    id: "WF-003",
    title: "รายงานคุณภาพน้ำทิ้งประจำเดือน",
    type: "สิ่งแวดล้อม",
    office: "กรมควบคุมมลพิษ",
    dueDate: "2026-02-28",
    status: "ร่าง",
    owner: "คุณเมย์",
    notes: "อัปเดตผล BOD/COD จากห้องแล็บล่าสุด"
  }
];

function getDateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDateLabel(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

function toMoney(value: number) {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function sanitizeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function openPrintWindow(title: string, bodyHtml: string) {
  const docTitle = sanitizeHtml(title);
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>${docTitle}</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap");
    @page { margin: 16mm; }
    body {
      margin: 0;
      font-family: "Kanit", "Tahoma", "Sarabun", sans-serif;
      color: #182b3d;
      background: #f0f2f5;
      font-size: 12pt;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      padding: 28px;
    }
    .paper {
      max-width: 760px;
      margin: 0 auto;
      border: 1px solid #cedbe7;
      border-radius: 12px;
      padding: 18px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px dashed #b7c8d8;
      padding-bottom: 12px;
      margin-bottom: 12px;
    }
    h1 {
      margin: 0;
      font-size: 18pt;
      color: #102940;
    }
    .muted { color: #4c6379; font-size: 10pt; }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 12px;
      margin-bottom: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    th, td {
      border: 1px solid #cad8e5;
      padding: 8px;
      text-align: left;
    }
    th { background: #edf4fb; }
    .sum {
      margin-top: 12px;
      margin-left: auto;
      width: 320px;
    }
    .sum p {
      display: flex;
      justify-content: space-between;
      margin: 4px 0;
    }
    .sum .total {
      border-top: 1px solid #a8bfd2;
      margin-top: 8px;
      padding-top: 8px;
      font-weight: 700;
      font-size: 13pt;
    }
    .note {
      margin-top: 12px;
      background: #fef7de;
      border: 1px solid #f4e0a4;
      padding: 8px 10px;
      border-radius: 8px;
      color: #6e4c08;
      font-size: 10pt;
    }
    .meter-block {
      margin-top: 12px;
      border: 1px solid #d5e2ee;
      border-radius: 10px;
      padding: 10px;
      background: #f5f9fe;
    }
    .meter-title {
      margin: 0;
      color: #0f2a43;
      font-size: 13pt;
      font-weight: 700;
    }
    .meter-grid {
      margin-top: 8px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .meter-card {
      border: 1px solid #d1deeb;
      border-radius: 8px;
      background: #fff;
      padding: 8px;
    }
    .meter-label {
      margin: 0;
      color: #1f3b56;
      font-weight: 700;
      font-size: 11pt;
    }
    .meter-image {
      margin-top: 8px;
      max-width: 100%;
      max-height: 340px;
      border-radius: 8px;
      border: 1px solid #c9d7e4;
      display: block;
    }
    .invoice-card {
      max-width: 800px;
      margin: 0 auto;
      background: #fff;
      padding: 32px;
      border-top: 8px solid #0056b3;
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
    }
    .header-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .header-left h1 {
      margin: 0;
      font-size: 29px;
      color: #0056b3;
      line-height: 1.1;
    }
    .header-left p {
      margin: 8px 0 0;
      font-size: 13px;
      color: #5f6c79;
    }
    .header-right {
      text-align: right;
      font-size: 14px;
      color: #5f6c79;
    }
    .header-right p {
      margin: 0 0 4px;
    }
    .customer-info {
      background: #f8f9fa;
      border-left: 4px solid #0056b3;
      padding: 12px 14px;
      border-radius: 5px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .customer-info p {
      margin: 2px 0;
    }
    .meter-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 20px;
    }
    .meter-box {
      border: 1px solid #dee2e6;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .meter-box h4 {
      margin: 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #eceff3;
      color: #4b5563;
      font-size: 16px;
      font-weight: 500;
    }
    .meter-img {
      width: 100%;
      height: 180px;
      margin: 10px 0;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid #dbe2ea;
      background: #eef2f6;
    }
    .reading-value {
      font-size: 17px;
      font-weight: 500;
      color: #0056b3;
      margin: 4px 0 0;
    }
    .bill-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
    }
    .bill-table th,
    .bill-table td {
      border: 1px solid #d4dce4;
      padding: 9px 10px;
      text-align: left;
    }
    .bill-table th {
      background: #f2f6fb;
      font-weight: 500;
      color: #374151;
    }
    .bill-table td:last-child,
    .bill-table th:last-child {
      text-align: right;
    }
    .summary-table {
      margin-top: 12px;
      margin-left: auto;
      width: min(360px, 100%);
      font-size: 14px;
    }
    .summary-table p {
      display: flex;
      justify-content: space-between;
      margin: 4px 0;
    }
    .summary-table .grand {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #ced8e2;
      font-size: 17px;
      font-weight: 600;
      color: #0056b3;
    }
    .note-box {
      margin-top: 14px;
      border: 1px solid #fde2a8;
      background: #fff8e3;
      color: #7a5a12;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 13px;
    }
    .signature-grid {
      margin-top: 38px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 50px;
    }
    .signature-box {
      text-align: center;
      font-size: 13px;
      color: #374151;
    }
    .signature-line {
      border-bottom: 1px solid #4b5563;
      margin: 0 auto 10px;
      width: 90%;
      height: 22px;
    }
    .signature-box p {
      margin: 3px 0;
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const frameDoc = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDoc || !frameWindow) {
    frame.remove();
    return false;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const doPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      window.setTimeout(() => {
        frame.remove();
      }, 1000);
    }
  };

  if (frameDoc.readyState === "complete") {
    window.setTimeout(doPrint, 60);
  } else {
    frame.onload = () => {
      window.setTimeout(doPrint, 60);
    };
  }

  return true;
}

function getInitialWorkflowForm(): NewWorkflowForm {
  return {
    title: "",
    type: "ใบอนุญาต",
    office: "",
    dueDate: getDateAfterDays(14),
    owner: "",
    notes: ""
  };
}

function getInitialInvoiceForm(): InvoiceForm {
  return {
    invoiceNo: `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: getDateAfterDays(7),
    period: "กุมภาพันธ์ 2569",
    station: "สถานีบริการน้ำมัน บางนา",
    payer: "บริษัท เอ็นเนอร์ยี่รีเทล จำกัด",
    rentFee: 75000,
    electricityFee: 101235,
    commonFee: 8500,
    previousMeterReading: "20890",
    currentMeterReading: "21350",
    vatRate: 7,
    note: "กรุณาชำระภายในกำหนด หากเลยกำหนดจะมีค่าปรับรายวัน"
  };
}

function getInitialEnvForm(): EnvReportForm {
  return {
    reportNo: `ENV-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`,
    issueDate: new Date().toISOString().slice(0, 10),
    month: "มกราคม 2569",
    station: "สถานีบริการน้ำมัน บางนา",
    pH: 7.1,
    bod: 16,
    cod: 82,
    tss: 27,
    preparedBy: "ฝ่ายสิ่งแวดล้อม",
    note: "ผลการตรวจอยู่ในเกณฑ์มาตรฐาน ไม่มีเหตุผิดปกติ"
  };
}

export default function WorkflowPrintCenter() {
  const [workflowItems, setWorkflowItems] = useState<WorkflowItem[]>(initialWorkflowItems);
  const [workflowForm, setWorkflowForm] = useState<NewWorkflowForm>(() => getInitialWorkflowForm());
  const [invoiceForm, setInvoiceForm] = useState<InvoiceForm>(() => getInitialInvoiceForm());
  const [envForm, setEnvForm] = useState<EnvReportForm>(() => getInitialEnvForm());
  const [previousMeterPhotoDataUrl, setPreviousMeterPhotoDataUrl] = useState("");
  const [previousMeterPhotoName, setPreviousMeterPhotoName] = useState("");
  const [currentMeterPhotoDataUrl, setCurrentMeterPhotoDataUrl] = useState("");
  const [currentMeterPhotoName, setCurrentMeterPhotoName] = useState("");
  const [meterPhotoError, setMeterPhotoError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const groupedItems = useMemo(
    () =>
      workflowSteps.map((step) => ({
        step,
        items: workflowItems.filter((item) => item.status === step)
      })),
    [workflowItems]
  );

  const invoiceSummary = useMemo(() => {
    const subtotal = invoiceForm.rentFee + invoiceForm.electricityFee + invoiceForm.commonFee;
    const vat = subtotal * (invoiceForm.vatRate / 100);
    const total = subtotal + vat;
    return { subtotal, vat, total };
  }, [invoiceForm]);

  const meterUsage = useMemo(() => {
    const previous = Number(invoiceForm.previousMeterReading);
    const current = Number(invoiceForm.currentMeterReading);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
    return current - previous;
  }, [invoiceForm.previousMeterReading, invoiceForm.currentMeterReading]);

  const handleCreateWorkflow = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = workflowForm.title.trim();
    const office = workflowForm.office.trim();
    const owner = workflowForm.owner.trim();
    if (!title || !office || !owner || !workflowForm.dueDate) return;

    const nextItem: WorkflowItem = {
      id: `WF-${Date.now()}`,
      title,
      type: workflowForm.type,
      office,
      dueDate: workflowForm.dueDate,
      status: "ร่าง",
      owner,
      notes: workflowForm.notes.trim()
    };

    setWorkflowItems((prev) => [nextItem, ...prev]);
    setWorkflowForm(getInitialWorkflowForm());
    setMessage(`สร้างงาน "${title}" แล้ว`);
  };

  const moveWorkflowStatus = (id: string, direction: "back" | "next") => {
    setWorkflowItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const index = workflowSteps.indexOf(item.status);
        const nextIndex = direction === "next" ? index + 1 : index - 1;
        if (nextIndex < 0 || nextIndex >= workflowSteps.length) return item;
        return { ...item, status: workflowSteps[nextIndex] };
      })
    );
  };

  const handleMeterPhotoChange = (target: "previous" | "current", event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      if (target === "previous") {
        setPreviousMeterPhotoDataUrl("");
        setPreviousMeterPhotoName("");
      } else {
        setCurrentMeterPhotoDataUrl("");
        setCurrentMeterPhotoName("");
      }
      setMeterPhotoError("ยังแนบรูปมิเตอร์ไม่ครบ (ต้องมีเดือนก่อนและเดือนนี้)");
      return;
    }

    if (!file.type.startsWith("image/")) {
      if (target === "previous") {
        setPreviousMeterPhotoDataUrl("");
        setPreviousMeterPhotoName("");
      } else {
        setCurrentMeterPhotoDataUrl("");
        setCurrentMeterPhotoName("");
      }
      setMeterPhotoError("กรุณาแนบไฟล์รูปภาพเท่านั้น (JPG, PNG, HEIC)");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setMeterPhotoError("ไม่สามารถอ่านไฟล์รูปภาพได้");
        return;
      }
      if (target === "previous") {
        setPreviousMeterPhotoDataUrl(reader.result);
        setPreviousMeterPhotoName(file.name);
      } else {
        setCurrentMeterPhotoDataUrl(reader.result);
        setCurrentMeterPhotoName(file.name);
      }
      setMeterPhotoError(null);
      setMessage(`แนบรูปมิเตอร์${target === "previous" ? "เดือนก่อน" : "เดือนนี้"}เรียบร้อย`);
    };
    reader.onerror = () => {
      if (target === "previous") {
        setPreviousMeterPhotoDataUrl("");
        setPreviousMeterPhotoName("");
      } else {
        setCurrentMeterPhotoDataUrl("");
        setCurrentMeterPhotoName("");
      }
      setMeterPhotoError("เกิดข้อผิดพลาดระหว่างอ่านไฟล์รูปภาพ");
    };
    reader.readAsDataURL(file);
  };

  const printInvoice = () => {
    if (invoiceForm.electricityFee > 0 && (!previousMeterPhotoDataUrl || !currentMeterPhotoDataUrl)) {
      setMeterPhotoError("ต้องแนบรูปมิเตอร์ 2 รูป (เดือนก่อน + เดือนนี้) ก่อนพิมพ์ใบวางบิลค่าไฟ");
      setMessage(null);
      return;
    }

    const meterSection =
      invoiceForm.electricityFee > 0
        ? `
        <section class="meter-container">
          <section class="meter-box">
            <h4>มิเตอร์เดือนก่อน</h4>
            <img class="meter-img" src="${sanitizeHtml(previousMeterPhotoDataUrl)}" alt="รูปมิเตอร์เดือนก่อน" />
            <p class="muted">ไฟล์: ${sanitizeHtml(previousMeterPhotoName || "ไม่ระบุ")}</p>
            <p class="reading-value">${sanitizeHtml(invoiceForm.previousMeterReading || "-")} kWh</p>
          </section>
          <section class="meter-box">
            <h4>มิเตอร์เดือนนี้</h4>
            <img class="meter-img" src="${sanitizeHtml(currentMeterPhotoDataUrl)}" alt="รูปมิเตอร์เดือนนี้" />
            <p class="muted">ไฟล์: ${sanitizeHtml(currentMeterPhotoName || "ไม่ระบุ")}</p>
            <p class="reading-value">${sanitizeHtml(invoiceForm.currentMeterReading || "-")} kWh</p>
          </section>
        </section>`
        : "";

    const body = `
      <main class="invoice-card">
        <header class="header-grid">
          <div class="header-left">
            <h1>ใบวางบิลค่าไฟฟ้า</h1>
            <p>Electricity Billing Statement</p>
          </div>
          <div class="header-right">
            <p>เลขที่เอกสาร: <strong>${sanitizeHtml(invoiceForm.invoiceNo)}</strong></p>
            <p>วันที่ออกเอกสาร: ${sanitizeHtml(toDateLabel(invoiceForm.issueDate))}</p>
            <p>ครบกำหนดชำระ: ${sanitizeHtml(toDateLabel(invoiceForm.dueDate))}</p>
            <p>รอบบิล: ${sanitizeHtml(invoiceForm.period)}</p>
          </div>
        </header>
        <section class="customer-info">
          <p>ผู้ถูกเรียกเก็บเงิน: <strong>${sanitizeHtml(invoiceForm.payer)}</strong></p>
          <p>สถานีบริการ: <strong>${sanitizeHtml(invoiceForm.station)}</strong></p>
          <p>ภาษีมูลค่าเพิ่ม: <strong>${sanitizeHtml(String(invoiceForm.vatRate))}%</strong></p>
          <p>หน่วยไฟฟ้าที่ใช้ (จากมิเตอร์): <strong>${sanitizeHtml(
            meterUsage !== null ? String(meterUsage) : "-"
          )} kWh</strong></p>
        </section>
        ${meterSection}
        <table class="bill-table">
          <thead>
            <tr><th>รายการ</th><th>จำนวนเงิน</th></tr>
          </thead>
          <tbody>
            <tr><td>ค่าเช่า</td><td>${sanitizeHtml(toMoney(invoiceForm.rentFee))}</td></tr>
            <tr><td>ค่าไฟฟ้า</td><td>${sanitizeHtml(toMoney(invoiceForm.electricityFee))}</td></tr>
            <tr><td>ค่าส่วนกลาง</td><td>${sanitizeHtml(toMoney(invoiceForm.commonFee))}</td></tr>
          </tbody>
        </table>
        <section class="summary-table">
          <p><span>ยอดก่อนภาษี</span><strong>${sanitizeHtml(toMoney(invoiceSummary.subtotal))}</strong></p>
          <p><span>ภาษีมูลค่าเพิ่ม</span><strong>${sanitizeHtml(toMoney(invoiceSummary.vat))}</strong></p>
          <p class="grand"><span>ยอดรวมสุทธิ</span><strong>${sanitizeHtml(toMoney(invoiceSummary.total))}</strong></p>
        </section>
        <section class="note-box">หมายเหตุ: ${sanitizeHtml(invoiceForm.note)}</section>
        <section class="signature-grid">
          <div class="signature-box">
            <div class="signature-line"></div>
            <p>ผู้รับใบวางบิล</p>
            <p>วันที่ ____ / ____ / ______</p>
          </div>
          <div class="signature-box">
            <div class="signature-line"></div>
            <p>ผู้จัดทำ</p>
            <p>วันที่ ____ / ____ / ______</p>
          </div>
        </section>
      </main>`;

    if (openPrintWindow("ใบวางบิลค่าไฟฟ้า", body)) {
      setMeterPhotoError(null);
      setMessage("เปิดหน้าพิมพ์ใบวางบิลแล้ว");
    } else {
      setMessage("ไม่สามารถเปิดหน้าพิมพ์ได้ กรุณาลองใหม่อีกครั้ง");
    }
  };

  const printEnvReport = () => {
    const body = `
      <main class="paper">
        <header class="header">
          <div>
            <h1>รายงานสิ่งแวดล้อม</h1>
            <div class="muted">รายงานคุณภาพน้ำทิ้งประจำเดือน</div>
          </div>
          <div class="muted">
            <div>เลขที่รายงาน: ${sanitizeHtml(envForm.reportNo)}</div>
            <div>วันที่รายงาน: ${sanitizeHtml(toDateLabel(envForm.issueDate))}</div>
            <div>ประจำเดือน: ${sanitizeHtml(envForm.month)}</div>
          </div>
        </header>
        <section class="meta">
          <div>สถานีบริการ: <strong>${sanitizeHtml(envForm.station)}</strong></div>
          <div>ผู้จัดทำรายงาน: <strong>${sanitizeHtml(envForm.preparedBy)}</strong></div>
          <div>ค่า pH: <strong>${sanitizeHtml(envForm.pH.toFixed(1))}</strong></div>
          <div>ค่า BOD (mg/L): <strong>${sanitizeHtml(envForm.bod.toFixed(2))}</strong></div>
          <div>ค่า COD (mg/L): <strong>${sanitizeHtml(envForm.cod.toFixed(2))}</strong></div>
          <div>ค่า TSS (mg/L): <strong>${sanitizeHtml(envForm.tss.toFixed(2))}</strong></div>
        </section>
        <table>
          <thead>
            <tr><th>ตัวชี้วัด</th><th>ผลตรวจ</th><th>เกณฑ์อ้างอิง</th></tr>
          </thead>
          <tbody>
            <tr><td>pH</td><td>${sanitizeHtml(envForm.pH.toFixed(1))}</td><td>5.5 - 9.0</td></tr>
            <tr><td>BOD</td><td>${sanitizeHtml(envForm.bod.toFixed(2))} mg/L</td><td>ไม่เกิน 20 mg/L</td></tr>
            <tr><td>COD</td><td>${sanitizeHtml(envForm.cod.toFixed(2))} mg/L</td><td>ไม่เกิน 120 mg/L</td></tr>
            <tr><td>TSS</td><td>${sanitizeHtml(envForm.tss.toFixed(2))} mg/L</td><td>ไม่เกิน 50 mg/L</td></tr>
          </tbody>
        </table>
        <section class="note">หมายเหตุ: ${sanitizeHtml(envForm.note)}</section>
      </main>`;

    if (openPrintWindow("รายงานสิ่งแวดล้อม", body)) {
      setMessage("เปิดหน้าพิมพ์รายงานสิ่งแวดล้อมแล้ว");
    } else {
      setMessage("ไม่สามารถเปิดหน้าพิมพ์ได้ กรุณาลองใหม่อีกครั้ง");
    }
  };

  return (
    <section className="gs-workflow-panel">
      <div className="gs-workflow-head">
        <div>
          <h2 className="gs-section-title">เริ่มงานเอกสารและพิมพ์จากระบบ</h2>
          <p className="gs-section-subtitle">
            ครอบคลุมตั้งแต่สร้างงานยื่นคำขอ, ติดตามขั้นตอน, จัดทำใบวางบิล และรายงานสิ่งแวดล้อม
          </p>
        </div>
        {message ? <p className="gs-workflow-message">{message}</p> : null}
      </div>

      <div className="gs-workflow-grid">
        <article className="gs-workflow-card">
          <h3 className="gs-workflow-title">1) สร้างงานเอกสารตั้งแต่เริ่มยื่น</h3>
          <form className="gs-workflow-form" onSubmit={handleCreateWorkflow}>
            <label>
              <span>ชื่องาน</span>
              <input
                value={workflowForm.title}
                onChange={(event) => setWorkflowForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="เช่น ต่ออายุใบอนุญาตค้าปลีกน้ำมัน"
                required
              />
            </label>
            <label>
              <span>ประเภทงาน</span>
              <select
                value={workflowForm.type}
                onChange={(event) =>
                  setWorkflowForm((prev) => ({ ...prev, type: event.target.value as WorkflowType }))
                }
              >
                <option value="ใบอนุญาต">ใบอนุญาต</option>
                <option value="ใบแจ้งหนี้">ใบแจ้งหนี้</option>
                <option value="สิ่งแวดล้อม">สิ่งแวดล้อม</option>
              </select>
            </label>
            <label>
              <span>หน่วยงาน/ปลายทาง</span>
              <input
                value={workflowForm.office}
                onChange={(event) => setWorkflowForm((prev) => ({ ...prev, office: event.target.value }))}
                placeholder="เช่น สำนักงานพลังงานจังหวัด"
                required
              />
            </label>
            <label>
              <span>ผู้รับผิดชอบ</span>
              <input
                value={workflowForm.owner}
                onChange={(event) => setWorkflowForm((prev) => ({ ...prev, owner: event.target.value }))}
                placeholder="เช่น คุณนิดา"
                required
              />
            </label>
            <label>
              <span>ครบกำหนด</span>
              <input
                type="date"
                value={workflowForm.dueDate}
                onChange={(event) => setWorkflowForm((prev) => ({ ...prev, dueDate: event.target.value }))}
                required
              />
            </label>
            <label className="gs-col-span-2">
              <span>โน้ต/รายการเอกสารที่ต้องแนบ</span>
              <textarea
                rows={3}
                value={workflowForm.notes}
                onChange={(event) => setWorkflowForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="ระบุรายการที่ต้องเตรียมก่อนยื่น"
              />
            </label>
            <button type="submit" className="gs-btn-primary gs-col-span-2">
              สร้างงานใหม่
            </button>
          </form>
        </article>

        <article className="gs-workflow-card">
          <h3 className="gs-workflow-title">2) ติดตามขั้นตอนการยื่นคำขอ</h3>
          <div className="gs-kanban">
            {groupedItems.map((column) => (
              <div key={column.step} className="gs-kanban-col">
                <p className="gs-kanban-step">
                  {column.step} <span>{column.items.length}</span>
                </p>
                <div className="gs-kanban-list">
                  {column.items.map((item) => (
                    <article key={item.id} className="gs-kanban-item">
                      <p className="gs-kanban-item-title">{item.title}</p>
                      <p className="gs-kanban-meta">
                        {item.type} • ครบกำหนด {toDateLabel(item.dueDate)}
                      </p>
                      <p className="gs-kanban-meta">ปลายทาง: {item.office}</p>
                      <p className="gs-kanban-meta">ผู้รับผิดชอบ: {item.owner}</p>
                      {item.notes ? <p className="gs-kanban-note">{item.notes}</p> : null}
                      <div className="gs-kanban-actions">
                        <button
                          type="button"
                          className="gs-btn-secondary"
                          onClick={() => moveWorkflowStatus(item.id, "back")}
                          disabled={item.status === workflowSteps[0]}
                        >
                          ย้อนกลับ
                        </button>
                        <button
                          type="button"
                          className="gs-btn-primary"
                          onClick={() => moveWorkflowStatus(item.id, "next")}
                          disabled={item.status === workflowSteps[workflowSteps.length - 1]}
                        >
                          ขั้นตอนถัดไป
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="gs-docmaker-grid">
        <article className="gs-workflow-card">
          <h3 className="gs-workflow-title">3) จัดทำใบวางบิล และพิมพ์</h3>
          <form className="gs-workflow-form" onSubmit={(event) => event.preventDefault()}>
            <label>
              <span>เลขที่ใบวางบิล</span>
              <input
                value={invoiceForm.invoiceNo}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, invoiceNo: event.target.value }))}
              />
            </label>
            <label>
              <span>รอบบิล</span>
              <input
                value={invoiceForm.period}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, period: event.target.value }))}
              />
            </label>
            <label>
              <span>วันที่ออกเอกสาร</span>
              <input
                type="date"
                value={invoiceForm.issueDate}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, issueDate: event.target.value }))}
              />
            </label>
            <label>
              <span>ครบกำหนดชำระ</span>
              <input
                type="date"
                value={invoiceForm.dueDate}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, dueDate: event.target.value }))}
              />
            </label>
            <label className="gs-col-span-2">
              <span>ผู้ถูกเรียกเก็บเงิน</span>
              <input
                value={invoiceForm.payer}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, payer: event.target.value }))}
              />
            </label>
            <label>
              <span>ค่าเช่า</span>
              <input
                type="number"
                min={0}
                value={invoiceForm.rentFee}
                onChange={(event) =>
                  setInvoiceForm((prev) => ({ ...prev, rentFee: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              <span>ค่าไฟฟ้า</span>
              <input
                type="number"
                min={0}
                value={invoiceForm.electricityFee}
                onChange={(event) =>
                  setInvoiceForm((prev) => ({ ...prev, electricityFee: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              <span>ค่าส่วนกลาง</span>
              <input
                type="number"
                min={0}
                value={invoiceForm.commonFee}
                onChange={(event) =>
                  setInvoiceForm((prev) => ({ ...prev, commonFee: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label>
              <span>เลขมิเตอร์เดือนก่อน (kWh)</span>
              <input
                value={invoiceForm.previousMeterReading}
                onChange={(event) =>
                  setInvoiceForm((prev) => ({ ...prev, previousMeterReading: event.target.value }))
                }
                placeholder="เช่น 20890"
              />
            </label>
            <label>
              <span>เลขมิเตอร์เดือนนี้ (kWh)</span>
              <input
                value={invoiceForm.currentMeterReading}
                onChange={(event) =>
                  setInvoiceForm((prev) => ({ ...prev, currentMeterReading: event.target.value }))
                }
                placeholder="เช่น 21350"
              />
            </label>
            <label>
              <span>VAT (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                value={invoiceForm.vatRate}
                onChange={(event) =>
                  setInvoiceForm((prev) => ({ ...prev, vatRate: Number(event.target.value) || 0 }))
                }
              />
            </label>
            <label className="gs-col-span-2">
              <span>รูปถ่ายมิเตอร์เดือนก่อน {invoiceForm.electricityFee > 0 ? "*" : ""}</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => handleMeterPhotoChange("previous", event)}
              />
            </label>
            <label className="gs-col-span-2">
              <span>รูปถ่ายมิเตอร์เดือนนี้ {invoiceForm.electricityFee > 0 ? "*" : ""}</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => handleMeterPhotoChange("current", event)}
              />
            </label>
            {previousMeterPhotoDataUrl || currentMeterPhotoDataUrl ? (
              <div className="gs-meter-preview-grid gs-col-span-2">
                {previousMeterPhotoDataUrl ? (
                  <div className="gs-meter-preview">
                    <img src={previousMeterPhotoDataUrl} alt="พรีวิวมิเตอร์เดือนก่อน" />
                    <div>
                      <p className="gs-meter-meta">รูปเดือนก่อน: {previousMeterPhotoName}</p>
                      <p className="gs-meter-meta">
                        เลขมิเตอร์เดือนก่อน: {invoiceForm.previousMeterReading || "-"} kWh
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="gs-meter-preview gs-meter-preview--empty">
                    <p className="gs-meter-meta">ยังไม่แนบรูปมิเตอร์เดือนก่อน</p>
                  </div>
                )}
                {currentMeterPhotoDataUrl ? (
                  <div className="gs-meter-preview">
                    <img src={currentMeterPhotoDataUrl} alt="พรีวิวมิเตอร์เดือนนี้" />
                    <div>
                      <p className="gs-meter-meta">รูปเดือนนี้: {currentMeterPhotoName}</p>
                      <p className="gs-meter-meta">
                        เลขมิเตอร์เดือนนี้: {invoiceForm.currentMeterReading || "-"} kWh
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="gs-meter-preview gs-meter-preview--empty">
                    <p className="gs-meter-meta">ยังไม่แนบรูปมิเตอร์เดือนนี้</p>
                  </div>
                )}
              </div>
            ) : null}
            {meterPhotoError ? <p className="gs-meter-error gs-col-span-2">{meterPhotoError}</p> : null}
            <label className="gs-col-span-2">
              <span>หมายเหตุ</span>
              <textarea
                rows={2}
                value={invoiceForm.note}
                onChange={(event) => setInvoiceForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
          </form>
          <div className="gs-docmaker-summary">
            <p>
              ยอดก่อนภาษี: <strong>{toMoney(invoiceSummary.subtotal)}</strong>
            </p>
            <p>
              ภาษีมูลค่าเพิ่ม: <strong>{toMoney(invoiceSummary.vat)}</strong>
            </p>
            <p>
              ยอดรวมสุทธิ: <strong>{toMoney(invoiceSummary.total)}</strong>
            </p>
            <p>
              หน่วยไฟที่ใช้ (จากมิเตอร์): <strong>{meterUsage !== null ? `${meterUsage} kWh` : "-"}</strong>
            </p>
          </div>
          {invoiceForm.electricityFee > 0 ? (
            <p className="gs-meter-required">
              ต้องแนบรูปมิเตอร์ไฟฟ้า 2 รูป (เดือนก่อน + เดือนนี้) ก่อนพิมพ์ใบวางบิล
            </p>
          ) : null}
          <button type="button" className="gs-btn-primary" onClick={printInvoice}>
            พิมพ์ใบวางบิล
          </button>
        </article>

        <article className="gs-workflow-card">
          <h3 className="gs-workflow-title">4) จัดทำรายงานสิ่งแวดล้อม และพิมพ์</h3>
          <form className="gs-workflow-form" onSubmit={(event) => event.preventDefault()}>
            <label>
              <span>เลขที่รายงาน</span>
              <input
                value={envForm.reportNo}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, reportNo: event.target.value }))}
              />
            </label>
            <label>
              <span>ประจำเดือน</span>
              <input
                value={envForm.month}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, month: event.target.value }))}
              />
            </label>
            <label>
              <span>วันที่รายงาน</span>
              <input
                type="date"
                value={envForm.issueDate}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, issueDate: event.target.value }))}
              />
            </label>
            <label>
              <span>สถานีบริการ</span>
              <input
                value={envForm.station}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, station: event.target.value }))}
              />
            </label>
            <label>
              <span>ค่า pH</span>
              <input
                type="number"
                step="0.1"
                value={envForm.pH}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, pH: Number(event.target.value) || 0 }))}
              />
            </label>
            <label>
              <span>ค่า BOD (mg/L)</span>
              <input
                type="number"
                step="0.01"
                value={envForm.bod}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, bod: Number(event.target.value) || 0 }))}
              />
            </label>
            <label>
              <span>ค่า COD (mg/L)</span>
              <input
                type="number"
                step="0.01"
                value={envForm.cod}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, cod: Number(event.target.value) || 0 }))}
              />
            </label>
            <label>
              <span>ค่า TSS (mg/L)</span>
              <input
                type="number"
                step="0.01"
                value={envForm.tss}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, tss: Number(event.target.value) || 0 }))}
              />
            </label>
            <label>
              <span>ผู้จัดทำรายงาน</span>
              <input
                value={envForm.preparedBy}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, preparedBy: event.target.value }))}
              />
            </label>
            <label className="gs-col-span-2">
              <span>หมายเหตุ</span>
              <textarea
                rows={2}
                value={envForm.note}
                onChange={(event) => setEnvForm((prev) => ({ ...prev, note: event.target.value }))}
              />
            </label>
          </form>
          <button type="button" className="gs-btn-primary" onClick={printEnvReport}>
            พิมพ์รายงานสิ่งแวดล้อม
          </button>
        </article>
      </div>
    </section>
  );
}
