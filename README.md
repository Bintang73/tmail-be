# Temporary Email Backend

Backend inbound-only untuk temporary email. Sistem menerima SMTP via Haraka, memvalidasi catch-all domain, menyimpan metadata inbox di Redis dengan TTL 1 hari, dan menyimpan detail body email ke file system.

## Fitur

- SMTP inbound-only dengan Haraka.
- Catch-all untuk `thvuinin.my.id` dan semua subdomainnya.
- Custom domain tanpa registrasi, valid otomatis jika MX mengarah ke `mx.thvuinin.my.id`.
- Redis hot storage per inbox dengan TTL 86400 detik.
- File cold storage di `emails/YYYY-MM-DD/{uuid}.json`.
- Express API `/api/v1`.
- Rate limit API, validasi email input, limit 50 email per inbox per hari.
- Worker cleanup file email lebih dari 1 hari.
- WebSocket update inbox saat email masuk.
- Admin API untuk tambah/hapus domain aktif dan hapus pesan.

## Setup

```bash
cp .env.example .env
bun install
```

Set `ADMIN_TOKEN` di `.env`. Semua endpoint admin dan delete memakai header:

```txt
X-Admin-Token: change-me-admin-token
```

Pastikan Redis aktif:

```bash
redis-server
```

Jalankan semua service development:

```bash
bun dev
```

Command ini menjalankan Redis jika `redis-server` tersedia. Jika tidak, command akan mencoba menjalankan Docker container `redis:7-alpine`. Setelah itu API, worker cleanup, dan Haraka ikut dijalankan. Port Haraka dibaca dari `HARAKA_SMTP_PORT` di `.env`.

Jika muncul pesan Redis belum tersedia dan Docker juga tidak siap, install Redis dulu:

```bash
brew install redis
```

Setelah itu cukup jalankan lagi:

```bash
bun dev
```

Jalankan API saja:

```bash
bun start
```

Jalankan worker cleanup saja:

```bash
bun run worker:cleanup
```

Jalankan Haraka saja:

```bash
bun run haraka:start
```

Untuk mengubah port Haraka tanpa edit config:

```env
HARAKA_SMTP_PORT=2525
```

`bun dev` dan `bun run haraka:start` akan menulis ulang `haraka/config/smtp.ini` dari env sebelum Haraka dijalankan.

Untuk production SMTP port 25, set:

```env
HARAKA_SMTP_PORT=25
```

Lalu jalankan Haraka lewat service manager dengan permission yang sesuai.

## Haraka Config

Plugin aktif didefinisikan di `haraka/config/plugins`:

```txt
validate_rcpt
save_email
```

Host MX custom domain harus mengarah ke:

```txt
mx.thvuinin.my.id
```

Contoh DNS:

```txt
example.com.  MX 10 mx.thvuinin.my.id.
*.example.com. MX 10 mx.thvuinin.my.id.
```

## API

Base URL: `/api/v1`

```http
GET /api/v1/generate
```

Response:

```json
{ "email": "abc123@thvuinin.my.id", "domain": "thvuinin.my.id" }
```

Generate memakai domain public tertentu:

```http
GET /api/v1/generate?domain=example.com
```

```http
GET /api/v1/inbox?email=abc123@thvuinin.my.id
```

Response:

```json
{ "email": "abc123@thvuinin.my.id", "messages": [] }
```

```http
GET /api/v1/messages/:id
```

Response: detail email dari file storage.

```http
DELETE /api/v1/messages/:id
X-Admin-Token: change-me-admin-token
```

Hapus satu pesan dari Redis inbox dan file storage.

```http
DELETE /api/v1/inbox?email=abc123@thvuinin.my.id
X-Admin-Token: change-me-admin-token
```

Hapus semua pesan yang ada di inbox email tersebut.

```http
GET /api/v1/domains
```

Menampilkan domain public aktif yang boleh dipakai untuk generate email.

```http
GET /api/v1/domains/status?domain=example.com
```

atau:

```http
GET /api/v1/domains/example.com/status
```

Cek apakah domain aktif untuk inbound. Domain dianggap aktif jika salah satu kondisi ini benar:

- domain adalah `BASE_DOMAIN` atau subdomainnya
- domain terdaftar aktif di admin registry
- MX domain mengarah ke `mx.thvuinin.my.id`

Response:

```json
{
  "domain": "example.com",
  "active": true,
  "registered": false,
  "visibility": null,
  "built_in": false,
  "mx_valid": true,
  "mx_records": [
    { "exchange": "mx.thvuinin.my.id", "priority": 10 }
  ],
  "required_mx": "mx.thvuinin.my.id",
  "active_reason": "mx_points_to_required_host",
  "created_at": null,
  "updated_at": null
}
```

```http
GET /api/v1/health
```

Response:

```json
{ "api": "ok", "redis": "ok", "smtp": "ok" }
```

## Admin Domain API

List semua domain aktif, termasuk private:

```http
GET /api/v1/admin/domains
X-Admin-Token: change-me-admin-token
```

Cek status domain dengan detail registry:

```http
GET /api/v1/admin/domains/example.com/status
X-Admin-Token: change-me-admin-token
```

Tambah domain public:

```http
POST /api/v1/admin/domains
X-Admin-Token: change-me-admin-token
Content-Type: application/json

{
  "domain": "example.com",
  "visibility": "public"
}
```

Tambah domain private:

```http
POST /api/v1/admin/domains
X-Admin-Token: change-me-admin-token
Content-Type: application/json

{
  "domain": "internal-example.com",
  "visibility": "private"
}
```

`public` berarti domain tampil di `GET /api/v1/domains` dan bisa dipakai di `/generate?domain=...`.
`private` berarti domain aktif untuk inbound, tetapi tidak ditampilkan ke user public dan tidak bisa dipilih untuk generate public.

Secara default API tambah domain memverifikasi MX harus mengarah ke `mx.thvuinin.my.id`. Untuk development lokal bisa override:

```json
{
  "domain": "example.test",
  "visibility": "private",
  "verify_mx": false
}
```

Hapus domain dari daftar aktif:

```http
DELETE /api/v1/admin/domains/example.com
X-Admin-Token: change-me-admin-token
```

Hapus semua pesan untuk domain tertentu:

```http
DELETE /api/v1/admin/domains/example.com/messages
X-Admin-Token: change-me-admin-token
```

Catatan: domain yang tidak diregistrasikan tetap bisa diterima otomatis jika MX domain tersebut mengarah ke `mx.thvuinin.my.id`. Registry domain admin dipakai untuk mengatur domain aktif public/private dan menu operasional.

## WebSocket

Connect ke:

```txt
ws://localhost:3000/ws?email=abc123@thvuinin.my.id
```

Saat email masuk, server mengirim event:

```json
{
  "type": "message",
  "email": "abc123@thvuinin.my.id",
  "message": {
    "id": "uuid",
    "from": "sender@example.com",
    "subject": "Hello",
    "timestamp": 1710000000000
  }
}
```

## Catatan Skala

Redis menyimpan list inbox pendek dan TTL sehingga lookup cepat. Body email tidak diload massal ke RAM karena detail disimpan per file berdasarkan tanggal. Untuk jutaan email, jalankan beberapa instance Haraka/API, gunakan Redis terkelola/cluster, shared filesystem/object storage kompatibel, dan log rotation.
