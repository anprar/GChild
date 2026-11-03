import { createDeviceClient } from './client.js';
import { SIMULATOR_LABEL, runDeviceCycle, type SimulatorScenario } from './index.js';

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv
    .slice(2)
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length);
  return value ?? fallback;
}

const baseUrl = arg('base-url', 'http://127.0.0.1:3000');
const code = arg('code');
const installationId =
  arg('installation-id') ?? process.env.SIMULATOR_INSTALLATION_ID ?? 'simulator-installation-1';
const label = arg('label') ?? 'Perangkat Simulator';
const scenario = (arg('scenario', 'connect') ?? 'connect') as SimulatorScenario;
const deviceSecret = process.env.SIMULATOR_DEVICE_SECRET ?? '';
const enrollmentId = arg('enrollment-id');
const pollSeconds = Number(arg('poll-seconds', '5'));

if (!baseUrl) {
  console.error('SIMULATOR: --base-url wajib diisi');
  process.exit(1);
}

const log = (message: string): void => {
  console.log(`${SIMULATOR_LABEL}: ${message}`);
};

const client = createDeviceClient({ baseUrl });

async function enroll(): Promise<void> {
  const secret = deviceSecret;
  const pairingCode = code;
  if (secret.length < 32) {
    log(
      'SIMULATOR_DEVICE_SECRET wajib (>=32 karakter). Buat nilai lokal dengan: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
    process.exit(1);
  }
  if (!pairingCode) {
    log('--code=<kode 8 digit dari bot Telegram> wajib untuk enrollment');
    process.exit(1);
  }

  const claim = await client.claim({
    code: pairingCode,
    deviceSecret: secret,
    device: {
      label,
      installationId,
      model: 'Simulator',
      manufacturer: SIMULATOR_LABEL,
      appVersion: 'simulator',
      sdkInt: 34,
    },
  });
  log(`enrollment ${claim.enrollmentId} status ${claim.status}`);
  log(`kode verifikasi: ${claim.verificationCode} (cocokkan di bot Telegram)`);

  await client.confirmLocal(claim.enrollmentId, claim.claimToken, true);
  log('persetujuan lokal dikirim; menunggu persetujuan orang tua di Telegram');

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const enrollment = await client.getEnrollment(claim.enrollmentId, claim.claimToken);
    if (enrollment.status === 'APPROVED') {
      client.setCredential(deviceSecret);
      log('pairing disetujui; credential aktif');
      return;
    }
    if (enrollment.status === 'REJECTED' || enrollment.status === 'EXPIRED') {
      log(`enrollment ${enrollment.status}; berhenti`);
      process.exit(2);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  log('timeout menunggu persetujuan; jalankan ulang dengan --enrollment-id bila perlu');
  process.exit(3);
}

async function main(): Promise<void> {
  if (enrollmentId) {
    client.setCredential(deviceSecret);
    log(`melanjutkan enrollment ${enrollmentId} (asumsi sudah disetujui)`);
  } else {
    await enroll();
  }

  log(`skenario ${scenario}; menekan Ctrl+C untuk berhenti`);
  for (;;) {
    const summary = await runDeviceCycle(client, { scenario });
    log(
      `siklus: fetched=${summary.fetched} acked=${summary.acked} executed=${summary.executed} ` +
        `expired=${summary.expired} duplicateAck=${summary.duplicateAck} requests=${summary.requests}`,
    );
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, pollSeconds) * 1000));
  }
}

void main().catch((error: unknown) => {
  log(`berhenti karena error: ${(error as Error).message}`);
  process.exit(1);
});
