const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ============================================================
// KONFIGURASI - GANTI DENGAN URL SERVER VPS KAMU
// ============================================================
const SERVER_URL = process.env.SERVER_URL || 'http://IP_VPS_ANDA:3000';
const POLL_INTERVAL = 5000; // 5 detik
// ============================================================

const DOWNLOAD_DIR = path.join(__dirname, 'print-downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const LOG_FILE = path.join(__dirname, 'agent.log');

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function downloadImage(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
}

function runPowerShell(imagePath, printerName) {
  return new Promise((resolve, reject) => {
    const ps1Path = path.join(__dirname, 'print.ps1');
    if (!fs.existsSync(ps1Path)) {
      return reject(new Error('print.ps1 tidak ditemukan di folder yang sama dengan agent'));
    }

    const printerArg = printerName && printerName !== 'default' ? printerName : '';
    const cmd = `powershell -ExecutionPolicy Bypass -File "${ps1Path}" -imagePath "${imagePath}" -printerName "${printerArg}"`;

    log(`Menjalankan PowerShell: ${cmd}`);

    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function updateJobStatus(jobId, status, error = null) {
  try {
    const res = await fetch(`${SERVER_URL}/api/print-jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, error })
    });
    if (!res.ok) log(`Gagal update status job ${jobId}: HTTP ${res.status}`);
  } catch (err) {
    log(`Gagal update status job ${jobId}: ${err.message}`);
  }
}

async function processJob(job) {
  const imageUrl = new URL(job.image_path, SERVER_URL).toString();
  const fileName = path.basename(job.image_path);
  const localPath = path.join(DOWNLOAD_DIR, fileName);

  log(`Memproses job #${job.id}: ${fileName} (printer: ${job.printer_name})`);

  try {
    log(`Mendownload: ${imageUrl}`);
    await downloadImage(imageUrl, localPath);
    log(`Download selesai: ${localPath}`);

    log(`Mencetak dengan PowerShell...`);
    const result = await runPowerShell(localPath, job.printer_name);
    log(`Hasil PowerShell: ${result}`);

    log(`✅ Print sukses untuk job #${job.id}`);
    await updateJobStatus(job.id, 'printed');

    try {
      fs.unlinkSync(localPath);
      log(`File lokal dihapus: ${localPath}`);
    } catch (unlinkErr) {
      log(`Peringatan: gagal hapus file lokal: ${unlinkErr.message}`);
    }
  } catch (err) {
    log(`❌ Print gagal untuk job #${job.id}: ${err.message}`);
    await updateJobStatus(job.id, 'failed', err.message);
  }
}

async function poll() {
  try {
    const res = await fetch(`${SERVER_URL}/api/print-jobs?status=pending`);
    if (!res.ok) {
      log(`Polling error: HTTP ${res.status}`);
      return;
    }
    const jobs = await res.json();
    if (jobs.length > 0) {
      log(`Ditemukan ${jobs.length} job pending`);
    }
    for (const job of jobs) {
      await processJob(job);
    }
  } catch (err) {
    log(`Polling error: ${err.message}`);
  }
}

async function checkServer() {
  try {
    const res = await fetch(`${SERVER_URL}/api/settings`);
    if (res.ok) {
      log(`Terhubung ke server: ${SERVER_URL}`);
      return true;
    } else {
      log(`Server merespons dengan status: ${res.status}`);
      return false;
    }
  } catch (err) {
    log(`Tidak dapat terhubung ke server: ${err.message}`);
    return false;
  }
}

(async () => {
  log('============================================');
  log('Print Agent dimulai');
  log(`Server URL: ${SERVER_URL}`);
  log(`Interval polling: ${POLL_INTERVAL} ms`);
  log('============================================');

  const connected = await checkServer();
  if (!connected) {
    log('Periksa kembali URL server dan koneksi internet. Agent tetap berjalan untuk mencoba ulang...');
  }

  while (true) {
    await poll();
    await sleep(POLL_INTERVAL);
  }
})();