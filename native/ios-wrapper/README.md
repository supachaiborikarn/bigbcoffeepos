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

## ขั้นตอนติดตั้ง (ครั้งแรก)

### 1. สร้างโปรเจกต์ Xcode
`File ▸ New ▸ Project ▸ iOS ▸ App`
- Interface: **SwiftUI**, Language: **Swift**, Minimum Deployments: **iOS 15.0**
- ตั้งชื่อ `BBPOSWrapper`

### 2. ใส่ไฟล์ Swift เข้าโปรเจกต์
ลากไฟล์ในโฟลเดอร์ `BBPOSWrapper/` นี้เข้า Xcode (เลือก *Copy items if needed*):
- `BBPOSWrapperApp.swift`  — จุดเริ่มแอป + ตั้งค่า URL
- `POSWebView.swift`       — WKWebView + รับ message พิมพ์
- `ReceiptRenderer.swift`  — เรนเดอร์ HTML ใบเสร็จ → รูปภาพ
- `StarPrintService.swift` — ค้นหา Star (USB) + สั่งพิมพ์

แล้วลบ `ContentView.swift` ที่ Xcode สร้างให้ตอนแรกทิ้ง (เพราะมี `ContentView` อยู่ใน `POSWebView.swift` แล้ว)

### 3. เพิ่ม StarXpand SDK (Swift Package Manager)
`File ▸ Add Package Dependencies…` แล้วใส่ URL:
```
https://github.com/star-micronics/StarXpand-SDK-iOS
```
กด **Add Package** เลือก library `StarIO10`

### 4. ตั้งค่า Info.plist
เปิดแท็บ **Info** ของ target แล้วเพิ่มคีย์ (อ้างอิงไฟล์ `BBPOSWrapper/Info.plist` ในโฟลเดอร์นี้):
- **Supported external accessory protocols** (`UISupportedExternalAccessoryProtocols`)
  → Item 0 = `jp.star-m.starpro`  ← **สำคัญที่สุด** ถ้าขาดคีย์นี้จะคุยกับ Star ไม่ได้

### 5. ตั้ง URL ของ POS
ใน `BBPOSWrapperApp.swift` แก้ `AppConfig.posURL` ให้เป็น URL จริงของร้าน
(ค่าเริ่มต้นคือ `https://bigbcoffeepos-web.vercel.app` — เปลี่ยนให้ตรงของคุณ)

### 6. ตั้ง Signing
แท็บ **Signing & Capabilities** ▸ เลือก **Team** (Apple ID / Developer account) ของคุณ

### 7. Build & Run
เสียบ iPad เข้า Mac ▸ เลือกอุปกรณ์เป็น iPad ▸ กด **Run (⌘R)**
ครั้งแรกต้องไปเชื่อใจ developer ที่ iPad: `Settings ▸ General ▸ VPN & Device Management`

### 8. ทดสอบพิมพ์
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
- โค้ด Swift นี้เป็น **สตาร์ทเตอร์** เขียนตามเอกสาร StarXpand SDK แต่ยัง**ไม่ได้คอมไพล์/ทดสอบบนเครื่องจริง** ชื่อเมธอดบางตัวของ SDK อาจต่างเล็กน้อยตามเวอร์ชัน — Xcode autocomplete จะช่วยชี้จุดที่ต้องปรับ
- **ความกว้างกระดาษ**: ตั้งไว้ที่ 58mm (384 dots) ถ้าใช้ม้วน 80mm เปลี่ยน `widthMm` เป็น 80 (576 dots) — ฝั่งเว็บส่ง `widthMm: 58` มาใน `nativePrinter.ts` ปรับได้ที่นั่น
- **หลายสำเนา** (บ่อน้ำมัน 3 ใบ): ตอนนี้ HTML รวมทุกสำเนาไว้แล้ว และโค้ดวนพิมพ์ตาม `copies` — ถ้าอยากให้ตัดกระดาษระหว่างใบให้ปรับที่ `StarPrintService.printImage`
- **รายงานปิดกะ (Z-report) และสติกเกอร์บาร์โค้ด** ยังใช้ `window.print()` เดิม (ยังไม่ได้ต่อเข้า bridge นี้) ถ้าต้องการให้พิมพ์เข้า Star ด้วย บอกได้ จะต่อเพิ่มให้แบบเดียวกัน
- ถ้าพิมพ์ออกมาจาง/เล็ก/ใหญ่ไป ปรับที่ `ReceiptRenderer` (ความกว้าง snapshot) หรือ CSS ใบเสร็จที่ `apps/web/src/components/ReceiptPrinter.tsx`

## อ้างอิง
- StarXpand SDK for iOS: https://github.com/star-micronics/StarXpand-SDK-iOS
- เอกสาร SDK: https://www.star-m.jp/starxpandsdk-oml.html
