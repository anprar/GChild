# Pemasangan di VPS

Installer ini memasang backend GChild di VPS Ubuntu/Debian **tanpa scp/copy manual**:
kode diambil dari GitHub, dependency dipasang, database dimigrasi, lalu service
systemd dinyalakan.

## Sekali jalan

Dari laptop (atau langsung di VPS):

```bash
ssh root@<IP-VPS> 'apt-get update -y && apt-get install -y git && rm -rf /tmp/gchild && git clone https://github.com/anprar/GChild.git /tmp/gchild && bash /tmp/gchild/infra/install.sh'
```

Installer melakukan:

- memasang `git`, `curl`, `build-essential`, `python3`, dan Node.js 22 (NodeSource);
- membuat user sistem `gchild` (tanpa login shell);
- clone/pull repo ke `/opt/gchild/app` (branch `main` secara default);
- membuat `.env` sekali saja di `/opt/gchild/app/.env` dengan `PAIRING_CODE_PEPPER`
  acak, `HOST=0.0.0.0`, dan `DATABASE_PATH=/opt/gchild/data/gchild.sqlite`;
- `npm ci` + `npm run migrate`;
- memasang dan menjalankan `gchild.service`.

Installer **tidak** menyentuh firewall, tidak memasang reverse proxy, dan tidak
menimpa `.env` yang sudah ada.

## Setelah pemasangan (manual, wajib)

1. Isi token bot di `/opt/gchild/app/.env`:

   ```bash
   nano /opt/gchild/app/.env      # TELEGRAM_BOT_TOKEN=...
   systemctl restart gchild
   ```

2. Daftarkan akun Telegram orang tua:

   ```bash
   runuser -u gchild -- bash -c "cd /opt/gchild/app && npm run admin:create -w apps/backend -- --telegram-id=<ID> --family-name='Keluarga'"
   ```

3. Buka port 3000 di firewall VPS sesuai kebijakanmu (contoh: `ufw allow 3000/tcp`).

4. Cek dari luar: `curl http://<IP-VPS>:3000/v1/healthz`.

## Update

Jalankan ulang installer; ia melakukan `git pull`, `npm ci`, migrasi, dan restart:

```bash
bash /opt/gchild/app/infra/install.sh
```

## HTTPS dan APK release

- APK **debug** mengizinkan cleartext, jadi bisa memakai `http://<IP-VPS>:3000`
  untuk uji cepat.
- APK **release** wajib `https://` (network security config menolak cleartext).
  Untuk produksi, taruh Caddy/nginx + domain di depan port 3000, lalu build APK
  dengan repo variable `GCHILD_API_BASE_URL=https://domain-kamu`.
- Jangan biarkan port 3000 terbuka ke internet tanpa TLS dalam jangka panjang:
  device secret dan pesan pairing lewat koneksi itu.

## Data dan backup

Database SQLite ada di `/opt/gchild/data/gchild.sqlite` (plus `-wal`/`-shm`).
Backup aman dilakukan dengan service berhenti:

```bash
systemctl stop gchild
cp -a /opt/gchild/data /opt/gchild/backup-$(date +%F)
systemctl start gchild
```

Belum ada enkripsi backup otomatis; keputusan D-05/D-10 di
`docs/IMPLEMENTATION_PLAN.md` masih terbuka.
