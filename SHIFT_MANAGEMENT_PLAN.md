# Shift Management Improvement Plan

Updated: 2026-04-28

## Goal

ยกระบบเปิด-ปิดกะให้ใกล้เคียง POS production ระดับสากล: คุม cash drawer, ตรวจยอดตาม payment method, ปิดกะพร้อม variance, และพิมพ์ Z Report ได้ทันที

## Implemented Now

- เปิดกะพร้อมบันทึกเงินต้นกะ
- Quick preset เงินต้นกะ + numpad สำหรับจอ touch
- ปิดกะด้วยการนับธนบัตร/เหรียญตาม denomination
- คำนวณเงินจริง, เงินสดที่ควรมี, และส่วนต่างแบบ live
- Backend endpoint สำหรับ shift summary:
  - `GET /api/shifts/:id/summary`
  - `POST /api/shifts/:id/close` คืน `summary` พร้อม `shift`
- Summary แยก payment method: Cash, QR, Card, E-Wallet
- Closed shift modal พร้อมยอดขาย, จำนวนบิล, average ticket, cash variance
- Print-ready Z Report 80mm สำหรับปิดกะ
- หลัง checkout จะ refresh กะ เพื่อให้ยอดบน TopBar ขยับทันที

## Next Upgrade

- Persist cash denomination counts และ closing note ลง database
- เพิ่ม Cash Movement: paid in, paid out, safe drop, cash pickup
- Blind close mode: แคชเชียร์เห็นเฉพาะช่องนับเงิน ผู้จัดการเห็น expected cash
- Permission rules: cashier เปิด/ปิดกะตัวเอง, manager/admin force close ได้
- Audit trail ทุก action ของกะ
- Reconciliation screen สำหรับ manager ตรวจหลายสาขา
- Export Z Report เป็น PDF/CSV
- Custom print template สำหรับ thermal printer จริง

## Operational Checklist

- ก่อนเริ่มขาย: login, เลือกสาขา, เปิดกะ, ใส่เงินต้นกะ
- ระหว่างขาย: ทุก checkout ต้องมี `shiftId`
- ก่อนปิดร้าน: นับเงินสดตาม denomination, ตรวจ payment breakdown, ใส่ note ถ้ามีส่วนต่าง
- หลังปิดกะ: พิมพ์ Z Report, เซ็นชื่อ, เก็บคู่กับเงินสด/หลักฐานโอน

## Known Data Risk

ล่าสุด Neon/Postgres มี `orders = 37` แต่ `order_items = 0`; รายงาน top items, profit, stock deduction และ kitchen queue จะยังไม่สมบูรณ์จนกว่าจะซ่อม import/order item creation.
