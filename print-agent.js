const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SERVER_URL = 'https://studio.kidversa.fun';
const POLL_INTERVAL = 3000;

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
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(arrayBuffer));
}

function runPowerShell(imagePath, printerName) {
  return new Promise((resolve, reject) => {
    const ps1Path = path.join(__dirname, 'print.ps1');
    if (!fs.existsSync(ps1Path)) {
      return reject(new Error('print.ps1 not found'));
    }

    const printerArg = printerName && printerName !== 'default' ? printerName : '';
    const cmd = `powershell -ExecutionPolicy Bypass -File "${ps1Path}" -imagePath "${imagePath}" -printerName "${printerArg}"`;

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
    if (!res.ok) log(`Failed to update job ${jobId}: HTTP ${res.status}`);
  } catch (err) {
    log(`Failed to update job ${jobId}: ${err.message}`);
  }
}

async function processJob(job) {
  const imageUrl = new URL(job.image_path, SERVER_URL).toString();
  const fileName = path.basename(job.image_path);
  const localPath = path.join(DOWNLOAD_DIR, fileName);

  log(`Processing job #${job.id}: ${fileName}`);

  try {
    await downloadImage(imageUrl, localPath);
    log(`Downloaded: ${fileName}`);

    await runPowerShell(localPath, job.printer_name);
    log(`Print success: ${fileName}`);

    await updateJobStatus(job.id, 'printed');

    try {
      fs.unlinkSync(localPath);
    } catch (e) {}
  } catch (err) {
    log(`Print failed for job #${job.id}: ${err.message}`);
    await updateJobStatus(job.id, 'failed', err.message);
  }
}

async function poll() {
  try {
    const res = await fetch(`${SERVER_URL}/api/print-jobs?status=pending`);
    if (!res.ok) return;
    const jobs = await res.json();
    if (jobs.length > 0) log(`Found ${jobs.length} pending jobs`);
    for (const job of jobs) {
      await processJob(job);
    }
  } catch (err) {
    log(`Polling error: ${err.message}`);
  }
}

(async () => {
  log('Print Agent started');
  log(`Server: ${SERVER_URL}`);
  
  while (true) {
    await poll();
    await sleep(POLL_INTERVAL);
  }
})();