#!/bin/bash
# เปิด Big B Coffee POS บน Mac แบบ "พิมพ์อัตโนมัติ" (ไม่มีหน้าต่างให้กดพิมพ์)
#
# --kiosk-printing : Chrome สั่งพิมพ์ไปที่เครื่องพิมพ์ Default ของ macOS ทันที
# --user-data-dir  : ใช้โปรไฟล์ Chrome แยกสำหรับ POS เพื่อให้ flag มีผลเสมอ
#                    แม้ Chrome ปกติจะเปิดอยู่แล้ว (ล็อกอิน POS ครั้งแรกครั้งเดียว)
# --app            : เปิดเป็นหน้าต่างแอป ไม่มีแถบที่อยู่/แท็บ
#
# วิธีใช้: ดับเบิลคลิกไฟล์นี้ (ครั้งแรกถ้า macOS ถาม ให้คลิกขวา > Open)
# ดูขั้นตอนตั้งค่าเครื่องพิมพ์ที่ docs/PRINTING_MAC.md

URL="${BBPOS_URL:-https://bigcoffeepos-web.vercel.app/pos}"
PROFILE="$HOME/Library/Application Support/BigBPOS-Chrome"

if [ ! -d "/Applications/Google Chrome.app" ]; then
  osascript -e 'display alert "ไม่พบ Google Chrome" message "ติดตั้ง Google Chrome ก่อนใช้งานโหมดพิมพ์อัตโนมัติ"'
  exit 1
fi

open -na "Google Chrome" --args \
  --user-data-dir="$PROFILE" \
  --kiosk-printing \
  --no-first-run \
  --app="$URL"
