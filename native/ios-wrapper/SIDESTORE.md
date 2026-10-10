# ติดตั้ง BBPOSWrapper แบบฟรีผ่าน SideStore (ไม่ต้องจ่าย $99/ปี)

ปกติแอปที่เซ็นด้วย Apple ID ฟรีจะ**หมดอายุทุก 7 วัน** ต้องเสียบ Mac กด Run ใหม่
SideStore แก้ปัญหานี้: มันเป็นแอปโอเพนซอร์สที่เซ็นแอปด้วย Apple ID ของเราเอง แล้ว
**ต่ออายุให้อัตโนมัติบนตัว iPad เอง** — ใช้คอมพิวเตอร์แค่ครั้งแรกครั้งเดียว

ข้อจำกัดที่ยังเหลือ (กติกาของ Apple ไม่ใช่ของ SideStore):

- Apple ID ฟรี 1 บัญชี ลงแอปพร้อมกันได้ 3 แอป (SideStore + BBPOSWrapper = 2 ยังเหลือ 1)
- ต้องเปิด VPN ของ SideStore (LocalDevVPN) ตอนติดตั้ง/ต่ออายุแอป
- นานๆ ครั้ง Apple อาจ revoke ใบรับรอง → แค่เปิด SideStore กด Refresh ใหม่ ข้อมูลไม่หาย

> เอกสารทางการ (อังกฤษ): https://docs.sidestore.io — ถ้าขั้นตอนบนจอไม่ตรงกับคู่มือนี้
> ให้ยึดตามหน้าจอ/เอกสารทางการ เพราะ SideStore อัปเดตวิธีติดตั้งเรื่อยๆ

---

## สิ่งที่ต้องมี

- Mac ที่มี Xcode (เครื่องเดิมที่ build แอปครอบ) + สาย USB ต่อ iPad
- Apple ID (ใช้ตัวเดียวกับที่ตั้ง Signing ใน Xcode ได้เลย)
- iPad เปิด **Developer Mode** ไว้แล้ว (Settings ▸ Privacy & Security ▸ Developer Mode —
  ถ้าเคย Run จาก Xcode สำเร็จ แปลว่าเปิดอยู่แล้ว)

---

## Part 1 — สร้างไฟล์ .ipa จาก Xcode (ทำครั้งเดียว ใช้บัญชีฟรีได้)

บัญชีฟรีใช้เมนู Distribute ปกติไม่ได้ ให้ทำแบบนี้แทน (SideStore จะเซ็นใหม่ให้เองอยู่แล้ว):

1. เปิด `BBPOSWrapper.xcodeproj` ▸ เลือก destination เป็น **Any iOS Device (arm64)**
2. เมนู **Product ▸ Archive** รอ build เสร็จ หน้าต่าง Organizer จะเด้งขึ้นมา
3. คลิกขวาที่ archive ▸ **Show in Finder** ▸ คลิกขวาไฟล์ .xcarchive ▸ **Show Package Contents**
4. เข้าโฟลเดอร์ `Products/Applications/` จะเจอ `BBPOSWrapper.app`
5. สร้างโฟลเดอร์ใหม่ชื่อ `Payload` (สะกดตามนี้เป๊ะ) แล้วก๊อป `BBPOSWrapper.app` เข้าไป
6. คลิกขวาโฟลเดอร์ `Payload` ▸ **Compress** ได้ `Payload.zip` ▸ เปลี่ยนชื่อเป็น `BBPOSWrapper.ipa`
7. ส่งไฟล์ .ipa เข้า iPad — AirDrop ไปเก็บในแอป **Files** ง่ายสุด

> อย่าลืมเช็คก่อน Archive ว่า `AppConfig.posURL` ใน `BBPOSWrapperApp.swift` ชี้ URL ร้านจริงแล้ว

---

## Part 2 — ติดตั้ง SideStore ลง iPad (ทำครั้งเดียว)

ทำตามเอกสารทางการ 2 หน้านี้ (ขั้นตอนโดยย่อด้านล่าง):

- เตรียมเครื่องมือ: https://docs.sidestore.io/docs/installation/prerequisites
- ติดตั้ง: https://docs.sidestore.io/docs/installation/install

ขั้นตอนโดยย่อ:

1. บน Mac ดาวน์โหลดโปรแกรมตัวติดตั้งของ SideStore (**iloader**) ตามหน้า prerequisites
2. เสียบ iPad กับ Mac ▸ ถ้า iPad ถามให้กด **Trust** แล้วใส่รหัสผ่านเครื่อง
3. เปิด iloader ▸ ล็อกอิน Apple ID ▸ เลือก iPad ▸ กด **Install SideStore (Stable)**
4. บน iPad: Settings ▸ General ▸ **VPN & Device Management** ▸ กด Trust developer
   ที่เป็นชื่อ Apple ID ของเรา
5. ติดตั้งแอป **LocalDevVPN** จาก App Store ▸ เปิดใช้ ▸ กด Allow VPN Configuration
   (VPN ตัวนี้วิ่งในเครื่องเอง ไม่ได้ส่งข้อมูลออกไปไหน — ต้องเปิดทุกครั้งที่จะลง/ต่ออายุแอป)
6. เปิดแอป SideStore ▸ ล็อกอิน Apple ID ตามที่มันถาม

---

## Part 3 — ลง BBPOSWrapper ผ่าน SideStore

1. เปิด **LocalDevVPN** ให้ต่ออยู่
2. เปิด SideStore ▸ แท็บ **My Apps** ▸ กด **+** ▸ เลือกไฟล์ `BBPOSWrapper.ipa` ในแอป Files
3. รอเซ็น+ติดตั้งเสร็จ ไอคอนแอปจะขึ้นหน้าโฮม
4. เสียบเครื่องพิมพ์ Star เข้า iPad ▸ เปิดแอป ▸ ลองขายแล้วกด **รับเงินและพิมพ์ใบเสร็จ**
   ครั้งแรกถ้ามี popup ขอใช้อุปกรณ์เสริม (MFi) ให้กดอนุญาต

> ถ้าเคยลงแอปตัวเดียวกันผ่าน Xcode ค้างไว้ แล้วตัวนั้นเปิดไม่ขึ้น ให้ลบทิ้งแล้วใช้ตัวที่ลงผ่าน
> SideStore แทน (ใบรับรองฟรีมีได้ทีละใบ ตัวเก่าอาจโดนแทนที่)

---

## Part 4 — การดูแล (สำคัญ: กันบิลพิมพ์ไม่ได้กลางร้าน)

- แอปมีอายุรอบละ 7 วัน SideStore จะต่ออายุให้เองเมื่อ LocalDevVPN เปิดอยู่
  **นิสัยที่แนะนำ: เปิดแอป SideStore สัปดาห์ละครั้ง** (เช่นทุกเช้าวันจันทร์) แล้วดูว่า
  My Apps ขึ้นวันหมดอายุใหม่เป็น 7 วัน
- ถ้าแอปหมดอายุ (กดแล้วไม่เปิด): เปิด LocalDevVPN ▸ เปิด SideStore ▸ กด **Refresh**
  ข้อมูลร้านไม่หายเพราะอยู่บนเว็บ/เซิร์ฟเวอร์ทั้งหมด
- Pairing file อาจหมดอายุถ้าอัปเดต iPadOS หรือรีเซ็ตเครื่อง → ทำใหม่ตาม
  https://docs.sidestore.io/docs/advanced/pairing-file
- อัปเดตเว็บ POS ไม่ต้องยุ่งกับแอปเลย (แอปเป็นแค่กรอบครอบเว็บ) — ต้อง build .ipa ใหม่
  เฉพาะตอนแก้โค้ด Swift ในโฟลเดอร์นี้เท่านั้น แล้วลงทับผ่าน SideStore แบบ Part 3

## แก้ปัญหาเบื้องต้น

| อาการ | ทางแก้ |
|---|---|
| แอปกดแล้วเด้งออก/ไม่เปิด | แอปหมดอายุ → Refresh ใน SideStore |
| SideStore ติดตั้งแอปไม่ได้ | เช็คว่า LocalDevVPN ต่ออยู่ / pairing file ยังไม่หมดอายุ |
| ลงแอปแล้วขึ้น Untrusted | Settings ▸ General ▸ VPN & Device Management ▸ Trust |
| พิมพ์ไม่ออกแต่แอปปกติ | เช็คสาย USB, กระดาษ, ไฟเครื่องพิมพ์ แล้วปิด-เปิดแอปใหม่ |
| ขึ้นเตือนใบรับรองโดนยกเลิก (revoked) | เปิด SideStore กด Refresh ใหม่ — เป็นเรื่องปกติที่เกิดนานๆ ครั้ง |

## อ้างอิง

- SideStore Docs: https://docs.sidestore.io
- FAQ (ข้อจำกัดบัญชีฟรี 3 แอป): https://docs.sidestore.io/docs/faq
- Troubleshooting: https://docs.sidestore.io/docs/troubleshooting
