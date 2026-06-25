# Big B Coffee POS — แอป iOS ครอบ (พิมพ์ Star ทาง USB)

แอปนี้เป็น **WKWebView บาง ๆ** ที่ครอบเว็บ POS เดิมไว้ เพื่อแก้ปัญหาเดียวคือ
**สั่งพิมพ์ใบเสร็จเข้าเครื่อง Star TSP143IIIU ที่เสียบ USB กับ iPad** ซึ่ง Safari ทำไม่ได้
(Safari เห็นแต่ปริ้นเตอร์ AirPrint และ Star ตัวนี้ไม่รองรับ AirPrint)

วิธีทำงาน: เว็บ POS เรียก
`window.webkit.messageHandlers.starPrint.postMessage({ html, widthMm, copies, baseUrl, billId })`
(โค้ดอยู่ที่ `apps/web/src/utils/nativePrinter.ts`) แอปนี้รับ HTML ใบเสร็จมา
เรนเดอร์เป็นรูปภาพแล้วพิมพ์เข้า Star ผ่าน **StarXpand SDK** — วิธีนี้ภาษาไทยออกครบเสมอ
เพราะใช้ฟอนต์จากเว็บ ไม่พึ่งฟอนต์ในเครื่องพิมพ์

> ถ้าไม่ได้อยู่ในแอปครอบนี้ (เปิดผ่าน Safari ปกติ) เว็บจะ fallback ไปพิมพ์แบบเดิมอัตโนมัติ ไม่พัง

---

## สิ่งที่ต้องมี

- **Mac** + **Xcode 15 ขึ้นไป**
- **บัญชี Apple Developer** ($99/ปี) — จำเป็นถ้าจะลงแบบถาวร/ขึ้น TestFlight; ถ้าแค่ทดสอบ sideload 7 วันใช้ Apple ID ฟรีได้
- **iPad** (iOS 15+) และสาย/อะแดปเตอร์ที่ต่อ Star เข้า iPad ได้ (ตัวเดียวกับที่ POSPOS ใช้)
- **Star TSP143IIIU** (USB)

---

## ขั้นตอนติดตั้งบน iPad

### 1. เปิดโปรเจกต์

เปิดไฟล์ `BBPOSWrapper.xcodeproj` ด้วย Xcode

โปรเจกต์ตั้งค่า SwiftUI, iOS 15, iPad และไฟล์ Swift ไว้แล้ว

### 2. รอให้ StarIO10 ดาวน์โหลด

Xcode จะดาวน์โหลด StarXpand SDK 2.12.1 ผ่าน Swift Package Manager อัตโนมัติ

ไฟล์ `Info.plist` มี protocol `jp.star-m.starpro` สำหรับ USB ไว้แล้ว

### 3. ตรวจ URL ของ POS
ใน `BBPOSWrapperApp.swift` แก้ `AppConfig.posURL` ให้เป็น URL จริงของร้าน
(ค่าเริ่มต้นคือ `https://bigbcoffeepos-web.vercel.app` — เปลี่ยนให้ตรงของคุณ)

### 4. ตั้ง Signing
แท็บ **Signing & Capabilities** ▸ เลือก **Team** (Apple ID / Developer account) ของคุณ

### 5. Build & Run
เสียบ iPad เข้า Mac ▸ เลือกอุปกรณ์เป็น iPad ▸ กด **Run (⌘R)**
ครั้งแรกต้องไปเชื่อใจ developer ที่ iPad: `Settings ▸ General ▸ VPN & Device Management`

### 6. ทดสอบพิมพ์
เสียบ Star เข้า iPad ▸ เปิดแอป ▸ ขายของแล้วกด **รับเงินและพิมพ์ใบเสร็จ**
ครั้งแรกอาจมี popup ขออนุญาตใช้อุปกรณ์เสริม (MFi) ให้กดอนุญาต

---

## เรื่อง MFi (ถ้าจะขึ้น App Store)
ถ้าจะส่งแอปขึ้น App Store ที่คุยกับปริ้นเตอร์ Star ผ่าน MFi ต้องผ่าน
**Apple MFi program** ก่อน (ฟรี แต่ต้องลงทะเบียนกับ Star/Apple):
https://star-m.jp/eng/products/s_print/apple_app_mfi.html
**ถ้าใช้เองในร้าน** (sideload / Ad Hoc / TestFlight ภายใน) **ไม่ต้อง**ผ่านขั้นตอนนี้

---

## ข้อควรรู้ / สิ่งที่ควรปรับต่อบนเครื่องจริง
- โปรเจกต์นี้ build ผ่านบน Xcode 26.5 และ iOS Simulator 26.5 โดยใช้ StarIO10 2.12.1 แล้ว แต่ยังต้องทดสอบ USB บน iPad กับเครื่องจริง
- **ความกว้างกระดาษ**: ตั้งไว้ที่ 58mm (384 dots) ถ้าใช้ม้วน 80mm เปลี่ยน `widthMm` เป็น 80 (576 dots) — ฝั่งเว็บส่ง `widthMm: 58` มาใน `nativePrinter.ts` ปรับได้ที่นั่น
- **หลายสำเนา** (บ่อน้ำมัน 3 ใบ): HTML รวมทุกสำเนาไว้ในภาพเดียวและตัดกระดาษหลังใบสุดท้าย ถ้าต้องการตัดระหว่างใบต้องแยก HTML ของแต่ละสำเนาก่อนส่งเข้าแอป
- **รายงานปิดกะ (Z-report) และสติกเกอร์บาร์โค้ด** ยังใช้ `window.print()` เดิม (ยังไม่ได้ต่อเข้า bridge นี้) ถ้าต้องการให้พิมพ์เข้า Star ด้วย บอกได้ จะต่อเพิ่มให้แบบเดียวกัน
- ถ้าพิมพ์ออกมาจาง/เล็ก/ใหญ่ไป ปรับที่ `ReceiptRenderer` (ความกว้าง snapshot) หรือ CSS ใบเสร็จที่ `apps/web/src/components/ReceiptPrinter.tsx`

## อ้างอิง
- StarXpand SDK for iOS: https://github.com/star-micronics/StarXpand-SDK-iOS
- เอกสาร SDK: https://www.star-m.jp/starxpandsdk-oml.html
