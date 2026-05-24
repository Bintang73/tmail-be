# Temporary Email Backend

Backend inbound-only untuk temporary email. Sistem menerima SMTP via Haraka, memvalidasi catch-all domain, menaruh raw email ke spool lokal, memproses email lewat Redis Stream worker, menyimpan metadata inbox di Redis dengan TTL 1 hari, dan menyimpan detail body email ke file system.

## Fitur

- SMTP inbound-only dengan Haraka.
- Catch-all untuk `thvuinin.my.id` dan semua subdomainnya.
- Custom domain tanpa registrasi, valid otomatis jika MX mengarah ke `mx.thvuinin.my.id`.
- Redis Stream queue untuk memisahkan SMTP accept path dari parsing/storage email.
- Redis hot storage per inbox dengan TTL 86400 detik.
- Spool raw email lokal di `spool/emails/YYYY-MM-DD/HH/*.eml`.
- File cold storage sharded di `emails/YYYY-MM-DD/aa/bb/{uuid}.json`.
- Express API `/api/v1`.
- Rate limit API, validasi email input, limit 50 email per inbox per hari.
- Worker email queue untuk parse raw email async.
- Worker cleanup file email lebih dari 1 hari.
- WebSocket update inbox saat email masuk.
- Admin API untuk tambah/hapus domain aktif dan hapus pesan.
- Deteksi OTP otomatis dengan regex lokal, fallback OpenAI opsional, dan Redis template learning agar tidak hit AI terus-menerus untuk pola email yang sama.

## Setup

```bash
cp .env.example .env
bun install
```

Set `ADMIN_TOKEN` di `.env`. Semua endpoint admin dan delete memakai header:

```txt
X-Admin-Token: change-me-admin-token
```

## Cloudflare Tunnel

Cloudflare Tunnel bisa dipakai untuk Express API dan WebSocket saja:

```txt
https://api.example.com -> http://127.0.0.1:3000
wss://api.example.com/ws -> ws://127.0.0.1:3000/ws
```

Redis tetap lokal, dan Haraka SMTP tetap harus menerima email lewat MX/port 25 langsung ke VPS. Jangan arahkan SMTP melalui Cloudflare Tunnel.
API memakai `TRUST_PROXY=1` supaya Express membaca IP client dari proxy/tunnel dan `express-rate-limit` tidak error saat menerima header `X-Forwarded-For`. Jika API benar-benar diekspos langsung tanpa reverse proxy, set `TRUST_PROXY=0`.

Untuk development cepat tanpa named tunnel, install `cloudflared`, lalu set di `.env`:

```env
CLOUDFLARE_TUNNEL_ENABLED=true
CLOUDFLARE_TUNNEL_MODE=quick
CLOUDFLARE_TUNNEL_URL=http://127.0.0.1:3000
TRUST_PROXY=1
```

Setelah itu:

```bash
bun dev
```

`bun dev` akan menjalankan API, workers, Haraka, Redis dev, dan `cloudflared tunnel --url http://127.0.0.1:3000`.

Untuk named tunnel production, pakai salah satu opsi berikut.

Token tunnel:

```env
CLOUDFLARE_TUNNEL_ENABLED=true
CLOUDFLARE_TUNNEL_TOKEN=token-dari-cloudflare
```

Config file tunnel:

```env
CLOUDFLARE_TUNNEL_ENABLED=true
CLOUDFLARE_TUNNEL_CONFIG=./cloudflared/config.yml
CLOUDFLARE_TUNNEL_NAME=tmail-api
```

Contoh config tersedia di `cloudflared/config.yml.example`. Copy dulu:

```bash
cp cloudflared/config.yml.example cloudflared/config.yml
```

Isi `cloudflared/config.yml`:

```yaml
tunnel: tmail-api
credentials-file: ./cloudflared/tmail-api.json

ingress:
  - hostname: api.thvuinin.my.id
    service: http://127.0.0.1:3000
  - service: http_status:404
```

DNS Cloudflare:

```txt
api.thvuinin.my.id  -> tunnel route
mx.thvuinin.my.id   -> A VPS_IP, DNS only
thvuinin.my.id      -> MX 10 mx.thvuinin.my.id
```

Pastikan Redis aktif:

```bash
redis-server --requirepass d0535500cb173f97
```

Konfigurasi Redis default:

```env
REDIS_PASSWORD=d0535500cb173f97
REDIS_URL=redis://:d0535500cb173f97@127.0.0.1:6379
```

## OTP Detection

Setiap detail message dari `GET /api/v1/messages/:id` otomatis ditambah:

```json
{
  "is_otp": true,
  "otp": "123456"
}
```

Jika email bukan OTP, response tetap memakai field yang sama:

```json
{
  "is_otp": false,
  "otp": null
}
```

Alur deteksi OTP:

- Regex lokal dijalankan lebih dulu.
- Redis exact template cache dipakai untuk pola email yang sama persis.
- Redis fallback template cache dipakai untuk sender dan subject pattern yang sama walaupun body berubah.
- Learned extraction rule menyimpan konteks sebelum/sesudah kode agar OTP baru bisa diambil tanpa OpenAI.
- OpenAI hanya dipanggil kalau email ambigu, cache belum ada, dan `OTP_AI_ENABLED=true`.
- Hasil OpenAI disimpan ke Redis sebagai template OTP/non-OTP untuk menghemat token pada email berikutnya.

Konfigurasi:

```env
OPENAI_API_KEY=sk-proj-your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
OTP_AI_ENABLED=true
OTP_TEMPLATE_CACHE_TTL_SECONDS=2592000
OTP_AI_MAX_BODY_CHARS=3000
OTP_AI_DAILY_LIMIT=500
```

Catatan:

- Simpan API key asli hanya di `.env` atau deployment secrets, jangan commit key asli ke repo.
- Set `OTP_AI_ENABLED=false` untuk mode full lokal tanpa OpenAI.
- `OTP_AI_DAILY_LIMIT=0` berarti tidak ada batas harian.

Jalankan semua service development:

```bash
bun dev
```

Command ini menjalankan Redis jika `redis-server` tersedia. Jika tidak, command akan mencoba menjalankan Docker container `redis:7-alpine`. Setelah itu API, worker cleanup, dan Haraka ikut dijalankan. Port Haraka dibaca dari `HARAKA_SMTP_PORT` di `.env`.
Redis dev akan dijalankan dengan `requirepass` dari `REDIS_PASSWORD`.

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

Jalankan worker email queue saja:

```bash
bun run worker:email
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

## Podman

### Podman Compose

Cara paling mudah menjalankan semua service di VPS:

```bash
apt update
apt install -y podman podman-compose
```

Pastikan `.env` untuk container memakai host Redis `redis`, bukan `127.0.0.1`:

```env
REDIS_PASSWORD=ganti-password-kuat
REDIS_URL=redis://:ganti-password-kuat@redis:6379

EMAIL_STORAGE_DIR=/app/emails
EMAIL_SPOOL_DIR=/app/spool/emails

HARAKA_SMTP_HOST=0.0.0.0
HARAKA_SMTP_PORT=25
```

Build dan jalankan semua service:

```bash
podman-compose up -d --build
```

Service yang dijalankan:

- `tmail-redis`
- `tmail-api`
- `tmail-email-worker`
- `tmail-cleanup`
- `tmail-haraka`

Cek status dan log:

```bash
podman-compose ps
podman-compose logs -f
```

Test API dari VPS:

```bash
curl http://127.0.0.1:3000/api/v1/health
```

Stop semua:

```bash
podman-compose down
```

API hanya dibind ke `127.0.0.1:3000`, jadi cocok dipakai bersama Cloudflare Tunnel di host. SMTP Haraka dibind ke host port `25`.

### Manual Podman

Build image aplikasi:

```bash
podman build -t tmail-be:latest -f Containerfile .
```

Buat network dan volume lokal:

```bash
podman network create tmail-net
podman volume create tmail-redis
podman volume create tmail-emails
podman volume create tmail-spool
```

Buat env khusus container, misalnya `.env.podman`:

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=1

BASE_DOMAIN=thvuinin.my.id
REQUIRED_MX_HOST=mx.thvuinin.my.id

REDIS_PASSWORD=ganti-password-kuat
REDIS_URL=redis://:ganti-password-kuat@redis:6379

HARAKA_SMTP_HOST=0.0.0.0
HARAKA_SMTP_PORT=2525
HARAKA_SMTP_NODES=0

EMAIL_STORAGE_DIR=/app/emails
EMAIL_SPOOL_DIR=/app/spool/emails
EMAIL_TTL_SECONDS=86400
INBOX_MAX_MESSAGES=20
INBOX_DAILY_LIMIT=50
EMAIL_QUEUE_STREAM=email_queue
EMAIL_QUEUE_GROUP=email_processors
EMAIL_QUEUE_BATCH_SIZE=10
EMAIL_QUEUE_MAXLEN=100000
DOMAIN_MX_CACHE_TTL_SECONDS=3600

API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=120
ADMIN_TOKEN=ganti-token-admin-kuat

OPENAI_API_KEY=sk-proj-your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
OTP_AI_ENABLED=true
OTP_TEMPLATE_CACHE_TTL_SECONDS=2592000
OTP_AI_MAX_BODY_CHARS=3000
OTP_AI_DAILY_LIMIT=500

WS_ENABLED=true
```

Jalankan Redis:

```bash
podman run -d \
  --name tmail-redis \
  --network tmail-net \
  -v tmail-redis:/data \
  redis:7-alpine \
  redis-server --appendonly yes --requirepass ganti-password-kuat
```

Jalankan API:

```bash
podman run -d \
  --name tmail-api \
  --network tmail-net \
  --env-file .env.podman \
  -p 3000:3000 \
  -v tmail-emails:/app/emails \
  tmail-be:latest \
  bun src/app.js
```

Jalankan worker email queue:

```bash
podman run -d \
  --name tmail-email-worker \
  --network tmail-net \
  --env-file .env.podman \
  -v tmail-emails:/app/emails \
  -v tmail-spool:/app/spool \
  tmail-be:latest \
  bun src/workers/emailQueue.js
```

Jalankan worker cleanup:

```bash
podman run -d \
  --name tmail-cleanup \
  --network tmail-net \
  --env-file .env.podman \
  -v tmail-emails:/app/emails \
  tmail-be:latest \
  bun src/workers/cleanup.js
```

Jalankan Haraka SMTP. Untuk test lokal gunakan port `2525`:

```bash
podman run -d \
  --name tmail-haraka \
  --network tmail-net \
  --env-file .env.podman \
  -p 2525:2525 \
  -v tmail-spool:/app/spool \
  tmail-be:latest \
  bun src/harakaStart.js
```

Cek log:

```bash
podman logs -f tmail-haraka
podman logs -f tmail-email-worker
```

Test API:

```bash
curl http://127.0.0.1:3000/api/v1/health
curl http://127.0.0.1:3000/api/v1/generate
```

Untuk production SMTP port `25`, ada dua opsi.

Opsi pertama, jalankan container Haraka dengan port `25`:

```bash
podman rm -f tmail-haraka
sed -i 's/HARAKA_SMTP_PORT=2525/HARAKA_SMTP_PORT=25/' .env.podman

sudo podman run -d \
  --name tmail-haraka \
  --network tmail-net \
  --env-file .env.podman \
  -p 25:25 \
  -v tmail-spool:/app/spool \
  tmail-be:latest \
  bun src/harakaStart.js
```

Opsi kedua, Haraka tetap listen `2525`, lalu redirect port host `25` ke `2525` memakai firewall. Ini membuat proses aplikasi tidak perlu bind langsung ke privileged port. Aturan firewall berbeda per distro, jadi sesuaikan dengan `nftables`, `iptables`, atau firewall panel VPS.

Stop semua service:

```bash
podman rm -f tmail-haraka tmail-cleanup tmail-email-worker tmail-api tmail-redis
```

Catatan Podman:

- Semua container harus berada di network `tmail-net`.
- `tmail-spool` harus dipakai bersama oleh Haraka dan email worker.
- `tmail-emails` harus dipakai bersama oleh API, email worker, dan cleanup worker.
- Jangan expose Redis ke internet.
- Untuk jutaan email/hari di satu VPS, batasi ukuran email di `haraka/config/connection.ini`, misalnya `[max] bytes=1048576`.
- Rootless Podman biasanya tidak bisa bind port `25` langsung; gunakan rootful Podman atau redirect firewall.

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

Dokumentasi Swagger/OpenAPI tersedia di:

```http
GET /api/v1/swagger
```

Endpoint ini menampilkan Swagger UI dan bisa dibuka dari browser saat API berjalan, misalnya:

```txt
http://127.0.0.1:3000/api/v1/swagger
```

Jika API dipublish lewat domain atau Cloudflare Tunnel, buka URL yang sama di host online:

```txt
https://api.example.com/api/v1/swagger
```

OpenAPI JSON mentah tersedia di:

```http
GET /api/v1/swagger.json
```

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

Response: detail email dari file storage. Field lama tetap ada, ditambah `is_otp` dan `otp`.

```json
{
  "id": "d2fb0b7c-7a8d-4fb0-bc37-4e0f95f67d3b",
  "from": "Service <no-reply@example.com>",
  "to": ["abc123@thvuinin.my.id"],
  "subject": "Your verification code",
  "text": "Use code 123456 to login.",
  "html": "",
  "raw": "...",
  "created_at": 1710000000000,
  "is_otp": true,
  "otp": "123456"
}
```

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
GET /api/v1/list-domain?page=1&limit=20
```

Menampilkan semua domain penerima yang pernah masuk ke sistem dan sudah diproses worker. Domain disimpan di Redis lokal saat email inbound diproses. Endpoint memakai pagination agar response tidak terlalu besar.

Query parameter:

- `page`: nomor halaman, default `1`
- `limit`: jumlah domain per halaman, default `20`, maksimal `20`

Response:

```json
{
  "page": 1,
  "limit": 20,
  "total_domains": 45,
  "total_pages": 3,
  "last_page": 3,
  "domains": [
    {
      "domain": "example.com",
      "last_seen_at": 1710000000000,
      "total_messages": 12
    }
  ]
}
```

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
  "approved": true,
  "approved_at": 1777885500393,
  "uptime_seconds": 4492800,
  "uptime_days": 52,
  "uptime_label": "52 days",
  "status_label": "Domain approved (uptime 52 days)",
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

Redis menyimpan list inbox pendek, Redis Stream hanya menyimpan pointer spool, dan raw email ditulis ke disk supaya RAM Redis tidak habis oleh body email. Body final disimpan sharded per UUID agar satu folder tidak berisi jutaan file.

Untuk VPS tunggal, wajib batasi ukuran email, TTL, queue length, dan pantau disk. Contoh batas aman untuk temporary email text/OTP adalah 512 KB sampai 1 MB per email. Jika traffic benar-benar jutaan email/hari, kapasitas utama yang harus dipantau adalah disk I/O, free disk, Redis memory, dan lag worker email queue.
