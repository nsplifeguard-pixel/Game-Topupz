# GAME TOPUP — Price Checker

เว็บแอปสำหรับ **ค้นหาและเช็คราคาเกม/สินค้าดิจิทัลเท่านั้น** โดยดึง catalog จาก Over Topup มาคำนวณราคาขายตาม margin และแสดงข้อมูลให้ตรวจสอบง่าย ระบบนี้ **ไม่มีการเติมเกม ไม่มีตะกร้า ไม่มี Checkout ไม่มี Order และไม่มีการชำระเงิน**

## Run locally

```bash
pnpm install
pnpm check
pnpm dev
```

เซิร์ฟเวอร์ใช้ `PORT` (default `3000`) และ bind ที่ `0.0.0.0` ตาม WebDev runtime

## Environment Variables

คัดลอกไฟล์ตัวอย่างก่อนเริ่มพัฒนา:

```bash
cp .env.example .env
```

ตัวแปรที่ต้องตั้งค่า:

| ตัวแปร | จำเป็น | รายละเอียด |
|---|---:|---|
| `DATABASE_URL` | ใช่สำหรับ Admin/catalog | MySQL connection string เช่น `mysql://user:password@host:3306/gametopup?ssl=true` |
| `INITIAL_ADMIN_PASSWORD` | ใช่สำหรับสร้าง Admin ครั้งแรก | รหัสผ่านเริ่มต้นของ username `admin` ใช้ครั้งแรกเท่านั้น และต้องเปลี่ยนหลังล็อกอิน |
| `NODE_ENV` | ไม่ | ใช้ `development` ตอนพัฒนา และ `production` ตอน deploy |
| `PORT` | ไม่ | พอร์ตของ Express; ค่าเริ่มต้นคือ `3000` |
| `MANUS_ADDON_PREVIEW_PUBLIC_ORIGIN` | ไม่ | URL HTTPS สาธารณะของ Preview; เมื่อมีค่าจะเปิดใช้ cookie แบบ `Secure; SameSite=None` |

### ตัวอย่าง local MySQL

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://gametopup_user:strong-db-password@127.0.0.1:3306/gametopup
INITIAL_ADMIN_PASSWORD=change-this-to-a-long-random-password
```

หลังตั้งค่าแล้วให้เริ่มระบบด้วย `pnpm dev` ระบบจะสร้างตารางที่ยังไม่มีให้แบบ idempotent และสร้างผู้ใช้ `admin` เมื่อยังไม่มีบัญชีนี้อยู่ หากมีบัญชี `admin` แล้ว การเปลี่ยน `INITIAL_ADMIN_PASSWORD` จะไม่เขียนทับรหัสผ่านเดิม

> อย่า commit ไฟล์ `.env` หรือส่งค่า `DATABASE_URL`/`INITIAL_ADMIN_PASSWORD` ผ่านแชต ควรตั้งผ่าน Secret/Environment Variables ของ hosting และใช้รหัสผ่านแบบสุ่มยาวอย่างน้อย 16 ตัวอักษร

## Database

- `DATABASE_URL` ใช้ managed MySQL ของโปรเจกต์
- `pnpm db:push` ใช้ generate + migrate ผ่าน Drizzle เมื่อทำงานใน environment ที่มี credentials
- runtime เรียก `ensureSchema()` แบบ idempotent เพื่อรองรับการ bootstrap/published instance
- catalog หลักอยู่ที่ `drizzle/schema.ts` และ migration ใน `drizzle/`

## Admin

- route: `/admin/login`
- username เริ่มต้น: `admin`
- initial password มาจาก secret `INITIAL_ADMIN_PASSWORD` เท่านั้น ไม่เก็บใน source และ login ครั้งแรกบังคับเปลี่ยนรหัสผ่าน
- Admin ใช้จัดการ catalog, margin, ราคา, price history, Sync และ settings ของ price checker
- session token ถูก hash ใน `admin_sessions`; password ใช้ Node `crypto.scrypt`; mutation ที่ใช้ cookie session ตรวจ CSRF

## Sync และราคา

- source URL default: `https://www.overtopup.com/th`
- crawler ค้นพบ category/game/product จาก internal links แบบ dynamic, normalize URL และ parse metadata/DOM fallback
- `POST /api/admin/sync` เริ่ม sync; `GET /api/admin/sync-status` ดู progress/logs
- `POST /api/scheduled/sync` เตรียมไว้สำหรับ scheduled callback หลัง publish
- default margin `20%`; selling price คำนวณ server-side และ source price ส่งเฉพาะ Admin endpoints
- price history บันทึกเมื่อ source หรือ selling price เปลี่ยน; สินค้าที่หายจาก source เปลี่ยนเป็น `OUT_OF_STOCK` โดยไม่ลบ
- Public API แสดงเฉพาะชื่อสินค้า รายละเอียด รูป เกม ประเภท และราคาขาย ไม่แสดงต้นทุนหรือข้อมูล Admin
- ระบบเปรียบเทียบราคาเก็บข้อเสนอใน `product_offers`; Admin เพิ่มราคา/URL ของแต่ละร้านผ่าน `POST /api/admin/products/:id/offers` และหน้า “ดูราคา” แสดงร้านที่ถูกที่สุดก่อน

## Image / content rights

ระบบใช้รูปภาพและข้อมูลสินค้าจาก URL สาธารณะต้นทางเพื่อการแสดงราคาเท่านั้น ควรตรวจสอบ ToS, robots, ลิขสิทธิ์ และสิทธิ์การใช้รูปภาพก่อนเปิดให้บริการเชิงพาณิชย์จริง หากต้นทางไม่พร้อมใช้งาน ระบบคงข้อมูลล่าสุดและแสดง fallback แทนการลบข้อมูล

## Routes

- Price checker: `/`, `/games`, `/games/:slug`
- Admin: `/admin/login`, `/admin`, `/admin/games`, `/admin/products`, `/admin/categories`, `/admin/pricing`, `/admin/sync`, `/admin/price-history`, `/admin/settings`, `/admin/account`
- Price alert: ตั้งเป้าหมายราคาได้จากโมดัล “ดูราคา” และเก็บไว้ใน browser local storage ของผู้ใช้
- Route manifest: `client/public/manus-routes.json`
