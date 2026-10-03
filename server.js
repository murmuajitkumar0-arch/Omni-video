const http = require('http');
const fs = require('fs');
const path = require('path');

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
} catch {}

const KEY = process.env.KIE_API_KEY;
const PORT = process.env.PORT || 3000;
const API = 'https://api.kie.ai/api/v1/jobs';
const MODEL = 'google/gemini-omni-flash-1-1';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const readBody = req => new Promise(r => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } });
});

const kie = (url, opts = {}) =>
  fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
  }).then(r => r.json());

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    if (!KEY) return send(res, 500, { error: 'KIE_API_KEY missing' });
    const { prompt, duration, imageUrls, firstFrameUrl } = await readBody(req);
    if (!prompt || !prompt.trim()) return send(res, 400, { error: 'Prompt required' });

    const input = { prompt: prompt.trim(), duration: String(duration || '4') };
    if (firstFrameUrl) input.first_frame_url = firstFrameUrl;
    else if (imageUrls && imageUrls.length) input.image_urls = imageUrls.slice(0, 7);

    try {
      const j = await kie(`${API}/createTask`, { method: 'POST', body: JSON.stringify({ model: MODEL, input }) });
      if (j.code !== 200) return send(res, 502, { error: j.msg || 'Create failed' });
      return send(res, 200, { taskId: j.data.taskId });
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const id = url.searchParams.get('id');
    if (!id) return send(res, 400, { error: 'id required' });
    try {
      const j = await kie(`${API}/recordInfo?taskId=${encodeURIComponent(id)}`);
      if (j.code !== 200) return send(res, 502, { error: j.msg || 'Status failed' });
      const d = j.data || {};
      let videoUrl = null;
      if (d.state === 'success') {
        try { videoUrl = (JSON.parse(d.resultJson).resultUrls || [])[0] || null; } catch {}
      }
      return send(res, 200, { state: d.state, videoUrl, error: d.failMsg || null });
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }

  let f = url.pathname === '/' ? '/index.html' : url.pathname;
  f = path.normalize(path.join(PUBLIC, f));
  if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
