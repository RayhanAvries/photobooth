const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const sharp = require('sharp');
const { exec } = require('child_process');
const cors = require('cors');
const http = require('http');
const https = require('https');
const selfsigned = require('selfsigned');

const app = express();
const HTTP_PORT = 3000;
const HTTPS_PORT = 3443;

// ---------- Middleware ----------
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// ---------- Database ----------
const db = new Database('foto-booth.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id INTEGER,
    filename TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (frame_id) REFERENCES frames(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('language', 'en');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('countdown_seconds', '5');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('printer', 'default');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('mirror_camera', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_capture_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_retake_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_print_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_capture_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_retake_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_print_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_background_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('sound_background_id_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('background_music', '');
`);

// Cek kolom active di frames
const tableInfo = db.prepare("PRAGMA table_info(frames)").all();
const hasActiveColumn = tableInfo.some(col => col.name === 'active');
if (!hasActiveColumn) {
  console.log('Menambahkan kolom active ke tabel frames...');
  db.exec("ALTER TABLE frames ADD COLUMN active INTEGER DEFAULT 1");
}

const soundsTableInfo = db.prepare("PRAGMA table_info(sounds)").all();
const hasCategoryColumn = soundsTableInfo.some(col => col.name === 'category');
if (!hasCategoryColumn) {
  console.log('Menambahkan kolom category ke tabel sounds...');
  db.exec("ALTER TABLE sounds ADD COLUMN category TEXT NOT NULL DEFAULT 'general'");
}

// Buat folder yang diperlukan
['public/frames', 'public/photos', 'public/print', 'public/sounds', 'public/music', 'uploads'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only image and audio files are allowed'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ==================== API Endpoints ====================
// SOUNDS
app.get('/api/sounds', (req, res) => {
  const sounds = db.prepare('SELECT * FROM sounds ORDER BY category, created_at DESC').all();
  res.json(sounds);
});

app.post('/api/sounds', upload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' });
  const name = req.body.name || 'Untitled';
  const category = req.body.category || 'general';
  const filename = req.file.filename;
  const destPath = path.join('public/sounds', filename);
  fs.renameSync(req.file.path, destPath);
  const info = db.prepare('INSERT INTO sounds (name, filename, category) VALUES (?, ?, ?)').run(name, filename, category);
  res.status(201).json({ id: info.lastInsertRowid, name, filename, category });
});

app.delete('/api/sounds/:id', (req, res) => {
  const sound = db.prepare('SELECT * FROM sounds WHERE id = ?').get(req.params.id);
  if (!sound) return res.status(404).json({ error: 'Sound not found' });
  const filePath = path.join('public/sounds', sound.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM sounds WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/sound-settings', (req, res) => {
  const settings = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'sound_%'").all();
  const soundSettings = {};
  settings.forEach(s => { soundSettings[s.key] = s.value; });
  res.json(soundSettings);
});

// BACKGROUND MUSIC
app.post('/api/background-music', upload.single('music'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' });
  const filename = req.file.filename;
  const destPath = path.join('public/music', filename);
  fs.renameSync(req.file.path, destPath);
  const oldRow = db.prepare("SELECT value FROM settings WHERE key = 'background_music'").get();
  if (oldRow && oldRow.value) {
    const oldPath = path.join('public/music', oldRow.value);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('background_music', filename);
  res.json({ success: true, filename });
});

app.delete('/api/background-music', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'background_music'").get();
  if (row && row.value) {
    const filePath = path.join('public/music', row.value);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare("DELETE FROM settings WHERE key = 'background_music'").run();
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'No background music set' });
  }
});

// FRAMES
app.get('/api/frames', (req, res) => {
  const frames = db.prepare('SELECT * FROM frames ORDER BY created_at DESC').all();
  res.json(frames);
});

app.post('/api/frames', upload.single('frame'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file required' });
  const name = req.body.name || 'Untitled';
  const filename = req.file.filename;
  const destPath = path.join('public/frames', filename);
  fs.renameSync(req.file.path, destPath);
  const info = db.prepare('INSERT INTO frames (name, filename, active) VALUES (?, ?, 1)').run(name, filename);
  res.status(201).json({ id: info.lastInsertRowid, name, filename, active: 1 });
});

app.patch('/api/frames/:id/active', (req, res) => {
  const { active } = req.body;
  if (active === undefined) return res.status(400).json({ error: 'active value required' });
  const frame = db.prepare('SELECT * FROM frames WHERE id = ?').get(req.params.id);
  if (!frame) return res.status(404).json({ error: 'Frame not found' });
  db.prepare('UPDATE frames SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ success: true, active });
});

app.delete('/api/frames/:id', (req, res) => {
  const frame = db.prepare('SELECT * FROM frames WHERE id = ?').get(req.params.id);
  if (!frame) return res.status(404).json({ error: 'Frame not found' });
  const filePath = path.join('public/frames', frame.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM frames WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// PHOTOS
app.post('/api/photos', express.json({ limit: '20mb' }), (req, res) => {
  const { image, frame_id } = req.body;
  if (!image) return res.status(400).json({ error: 'Image data missing' });
  const matches = image.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Invalid data URL format' });
  const ext = matches[1] === 'jpeg' ? 'jpg' : 'png';
  const base64Data = matches[2];
  const filename = uuidv4() + '.' + ext;
  const filePath = path.join('public/photos', filename);
  fs.writeFileSync(filePath, base64Data, 'base64');
  const info = db.prepare('INSERT INTO photos (frame_id, filename) VALUES (?, ?)').run(frame_id || null, filename);
  res.json({ id: info.lastInsertRowid, filename, url: `/photos/${filename}` });
});

app.get('/api/photos', (req, res) => {
  const { date } = req.query;
  let photos;
  if (date) {
    photos = db.prepare(`
      SELECT photos.*, frames.name as frame_name 
      FROM photos 
      LEFT JOIN frames ON photos.frame_id = frames.id 
      WHERE DATE(photos.created_at) = ? 
      ORDER BY photos.created_at DESC
    `).all(date);
  } else {
    photos = db.prepare(`
      SELECT photos.*, frames.name as frame_name 
      FROM photos 
      LEFT JOIN frames ON photos.frame_id = frames.id 
      ORDER BY photos.created_at DESC
    `).all();
  }
  res.json(photos);
});

app.delete('/api/photos/:id', (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const filePath = path.join('public/photos', photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.delete('/api/photos/date/:date', (req, res) => {
  const photos = db.prepare('SELECT * FROM photos WHERE DATE(created_at) = ?').all(req.params.date);
  photos.forEach(photo => {
    const filePath = path.join('public/photos', photo.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });
  db.prepare('DELETE FROM photos WHERE DATE(created_at) = ?').run(req.params.date);
  res.json({ success: true, deleted: photos.length });
});

app.get('/api/photos/dates', (req, res) => {
  const dates = db.prepare(`
    SELECT DISTINCT DATE(created_at) as date, COUNT(*) as count 
    FROM photos 
    GROUP BY DATE(created_at) 
    ORDER BY date DESC
  `).all();
  res.json(dates);
});

// SETTINGS
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' });
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  res.json({ success: true });
});

// PRINTER
app.get('/api/printers', (req, res) => {
  const cmd = 'wmic printer get name';
  exec(cmd, (error, stdout) => {
    if (error) {
      return res.json([{ name: 'default', description: 'Default printer (system)' }]);
    }
    const names = stdout.split('\n')
      .filter(line => line.trim() && !line.includes('Name'))
      .map(line => line.trim())
      .filter(Boolean);
    const list = names.map(name => ({ name, description: name }));
    list.unshift({ name: 'default', description: 'Default printer (system)' });
    res.json(list);
  });
});

app.post('/api/print-temp', express.json({ limit: '20mb' }), async (req, res) => {
  const { imageData, printerName } = req.body;
  if (!imageData) return res.status(400).json({ error: 'No image data' });

  try {
    const matches = imageData.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid image format' });
    const base64Data = matches[2];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const TARGET_WIDTH_MM = 72;
    const TARGET_HEIGHT_MM = 150;
    const DPI = 300;
    const targetWidthPx = Math.round((TARGET_WIDTH_MM / 25.4) * DPI);
    const targetHeightPx = Math.round((TARGET_HEIGHT_MM / 25.4) * DPI);

    const processedBuffer = await sharp(imageBuffer)
      .resize(targetWidthPx, targetHeightPx, { fit: 'fill' })
      .png({ compressionLevel: 0 })
      .withMetadata({ density: DPI })
      .toBuffer();

    const filename = `print_${uuidv4()}.png`;
    const printPath = path.join(__dirname, 'public', 'print', filename);
    fs.writeFileSync(printPath, processedBuffer);

    const printName = printerName && printerName !== 'default' ? printerName : '';
    const ps1Path = path.join(__dirname, 'print.ps1');

    if (!fs.existsSync(ps1Path)) {
      return res.status(500).json({ error: 'print.ps1 not found' });
    }

    const cmd = `powershell -ExecutionPolicy Bypass -File "${ps1Path}" -imagePath "${printPath}" -printerName "${printName}"`;

    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(printPath); } catch (e) {}
      if (error) {
        return res.status(500).json({ error: 'Print failed: ' + (stderr || error.message) });
      }
      res.json({ success: true, method: 'powershell_temp' });
    });

  } catch (err) {
    res.status(500).json({ error: 'Processing failed: ' + err.message });
  }
});

app.delete('/api/print-temp', (req, res) => {
  const dir = path.join(__dirname, 'public', 'print');
  try {
    const files = fs.readdirSync(dir);
    files.forEach(file => fs.unlinkSync(path.join(dir, file)));
    res.json({ success: true, deleted: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 10MB)' });
    return res.status(400).json({ error: err.message });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// Route untuk halaman
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/booth', (req, res) => res.sendFile(path.join(__dirname, 'public', 'booth.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ==================== SERVER HTTP (port 3000) ====================
http.createServer(app).listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP Server running at http://localhost:${HTTP_PORT}`);
  console.log(`📡 Access from other devices using http://<your-ip>:${HTTP_PORT}`);
  console.log(`\n⚠️  For camera access from other devices, you need HTTPS:`);
  console.log(`   https://<your-ip>:${HTTPS_PORT} (self-signed certificate)`);
  console.log(`   Browser will show warning - proceed anyway.\n`);
});

// ==================== SERVER HTTPS (port 3443) ====================
// Buat sertifikat self-signed
const attrs = [{ name: 'commonName', value: 'localhost' }];
const altNames = [
  'DNS:localhost',
  'DNS:127.0.0.1',
  'IP:127.0.0.1'
];
const pems = selfsigned.generate(attrs, {
  days: 365,
  altNames: altNames,
  algorithm: 'sha256'
});

const httpsOptions = {
  key: pems.private,
  cert: pems.cert,
  // Konfigurasi minimal untuk kompatibilitas maksimal
  secureOptions: require('constants').SSL_OP_NO_SSLv2 |
                  require('constants').SSL_OP_NO_SSLv3 |
                  require('constants').SSL_OP_NO_TLSv1 |
                  require('constants').SSL_OP_NO_TLSv1_1,
  // Gunakan cipher default Node.js (lebih kompatibel)
  ciphers: 'DEFAULT@SECLEVEL=1'
};

https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
  console.log(`🔒 HTTPS Server running at https://localhost:${HTTPS_PORT}`);
  console.log(`📡 Access from other devices using https://<your-ip>:${HTTPS_PORT}`);
  console.log(`⚠️  Browser will show security warning - proceed anyway.\n`);
});