# benzPOS / Big B Coffee POS

เว็บแอพ POS ออนไลน์สำหรับใช้แทน POS รายปี: หน้าขาย + ยิงบาร์โค้ด + รับออเดอร์ + ชำระเงิน + ใบเสร็จ + สินค้า/สต็อก 4 สาขา + รายงานยอดขาย + สมาชิก/แต้ม + โปรโมชันซ้อนหลายแบบ + รับของเข้าสต็อก + integration outbox สำหรับ RD/e-Tax, Line OA, และ Lineman

## สแตก
- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express + TypeScript
- Storage: SQLite (`apps/api/data/pos.db`) ผ่าน `better-sqlite3` + WAL mode

## เริ่มใช้งาน
1) ติดตั้ง dependencies ที่รากโปรเจกต์
```bash
npm install
```

2) เปิด 2 เทอร์มินัล แล้วรัน dev server
```bash
npm run dev --workspace apps/api
```
```bash
npm run dev --workspace apps/web
```

- Web: http://localhost:5173
- API: http://localhost:5175/api

## ตั้งค่าเพิ่มเติม (ถ้าต้องการ)
- เปลี่ยน API URL ได้ด้วยตัวแปร `VITE_API_URL`
- ค่าเริ่มต้นฝั่งเว็บอยู่ที่ `apps/web/.env` เป็น `VITE_API_URL=http://localhost:5175/api`
- Endpoint สมาชิก: `GET /api/customers`, `POST /api/customers`
- Endpoint สาขา: `GET /api/branches`
- Endpoint รับของเข้า: `GET /api/purchases`, `POST /api/purchases`
- Endpoint integration admin: `GET /api/integrations/status`, `GET /api/integrations/events`
- POSPOS sync: `POST /api/migration/sync`

## โครงสร้างข้อมูล
- API เก็บข้อมูลไว้ที่ `apps/api/data/pos.db`
- Auto-backup เก็บไว้ที่ `apps/api/data/backups/`
- แนวทาง UI อยู่ที่ `DESIGN.md`
- Second brain / Obsidian vault อยู่ที่ `secondbrain/` ให้เปิดโฟลเดอร์นี้ใน Obsidian แล้วเริ่มจาก `00-Start-Here.md`

## สำรองฐานข้อมูล
- ระบบสร้าง backup ตอน API start และทุก 60 นาทีตามค่าเริ่มต้น
- สร้าง backup เองได้ด้วย `npm run backup --workspace apps/api`
- ตรวจ Phase 1.3 infra ได้ด้วย `npm run phase13:check --workspace apps/api` หลังเปิด API server แล้ว
- ตั้งค่าได้ด้วย `DB_BACKUP_ENABLED`, `DB_BACKUP_INTERVAL_MINUTES`, `DB_BACKUP_RETENTION_COUNT`, `DB_BACKUP_ON_STARTUP`, `DB_BACKUP_DIR`

## Integration env
- RD/e-Tax: `RD_TAX_ENDPOINT`, `RD_TAX_CLIENT_ID`, `RD_TAX_CLIENT_SECRET`
- Line OA: `LINE_OA_CHANNEL_ACCESS_TOKEN`
- Lineman: `LINEMAN_API_ENDPOINT`, `LINEMAN_API_KEY`
- ตอนนี้ระบบสร้าง/ดู/Retry งานใน outbox แล้ว แต่ยังไม่ยิง provider จริง

## รูปแบบ CSV ที่รองรับ
- สินค้า: `sku`, `barcode`, `name`, `category`, `price`, `cost`, `stock`, `reorder`, `unit`
- ลูกค้า: `name`, `phone`, `points`
- ประวัติขาย: `receipt`, `date`, `product`, `qty`, `unit_price`, `total`, `discount`, `payment`
