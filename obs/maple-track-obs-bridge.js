#!/usr/bin/env node
// Local OBS WebSocket screenshot bridge for Maple Track.
// Node 18+; no third-party packages required.
const http = require('node:http');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = Number(process.env.MAPLE_TRACK_PORT || 8787);
const OBS_URL = process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455';
const OBS_PASSWORD = process.env.OBS_WEBSOCKET_PASSWORD || '';
const MAX_BODY = 12 * 1024 * 1024;
let ws;
let wsReady;
let wsPending = new Map();
let frames = [];
let trackerState = {samples: [], level: null};
let ocrReports = [], cleanSince = null, cleanCount = 0;
let trackerUrl = process.env.MAPLE_TRACK_TRACKER_URL || '';

function sendWs(op, d) {
  if (!ws || ws.readyState !== 1) throw new Error('OBS WebSocket is not connected');
  ws.send(JSON.stringify({op, d}));
}
function waitForObs() {
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    ws = new WebSocket(OBS_URL);
    const timer = setTimeout(() => reject(new Error('Timed out connecting to OBS WebSocket')), 6000);
    ws.onmessage = async event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.op === 0) {
        const hello = msg.d;
        const identify = {rpcVersion: hello.rpcVersion};
        if (hello.authentication) {
          if (!OBS_PASSWORD) { clearTimeout(timer); reject(new Error('OBS WebSocket password is required; set OBS_WEBSOCKET_PASSWORD')); return; }
          const secret = OBS_PASSWORD + hello.authentication.salt;
          const secretHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
          const secretBase64 = btoa(String.fromCharCode(...new Uint8Array(secretHash)));
          const authHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretBase64 + hello.authentication.challenge));
          identify.authentication = btoa(String.fromCharCode(...new Uint8Array(authHash)));
        }
        sendWs(1, identify);
      } else if (msg.op === 2) {
        clearTimeout(timer); resolve();
      } else if (msg.op === 7 && wsPending.has(msg.d.requestId)) {
        const pending = wsPending.get(msg.d.requestId); wsPending.delete(msg.d.requestId);
        if (!msg.d.requestStatus.result) pending.reject(new Error(msg.d.requestStatus.comment || 'OBS screenshot request failed'));
        else pending.resolve(msg.d.responseData);
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not connect to OBS WebSocket')); };
    ws.onclose = () => { wsReady = null; ws = null; };
  });
  return wsReady;
}
async function screenshot(sourceName) {
  await waitForObs();
  const requestId = crypto.randomUUID();
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { wsPending.delete(requestId); reject(new Error('OBS screenshot request timed out')); }, 15000);
    wsPending.set(requestId, {resolve: data => { clearTimeout(timer); resolve(data); }, reject: err => { clearTimeout(timer); reject(err); }});
  });
  sendWs(6, {requestType: 'GetSourceScreenshot', requestId, requestData: {sourceName, imageFormat: 'png'}});
  const result = await response;
  const b64 = result.imageData?.split(',')[1];
  if (!b64) throw new Error('OBS returned no image data');
  return Buffer.from(b64, 'base64');
}
function response(res, status, body, type='application/json') {
  const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {'Content-Type': type, 'Content-Length': data.length, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'});
  res.end(data);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'OPTIONS') return response(res, 204, '');
  if (req.method === 'GET' && url.pathname === '/health') return response(res, 200, {ok: true, obsConnected: !!ws && ws.readyState === 1, latestFrameAt: frames.at(-1)?.timestamp || null});
  if (req.method === 'GET' && url.pathname === '/latest') {
    if (!frames.length) return response(res, 404, {error: 'No screenshots received yet'});
    res.writeHead(200, {'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'X-Frame-Timestamp', 'X-Frame-Timestamp': String(frames.at(-1).timestamp)});
    return res.end(frames.at(-1).image);
  }
  if (req.method === 'GET' && url.pathname === '/frame') {
    const timestamp=Number(url.searchParams.get('timestamp'));
    const frame=frames.find(f=>(f.timestamp<1e12?f.timestamp*1000:f.timestamp)===timestamp);
    if(!frame)return response(res,404,{error:'Frame is no longer in the capture buffer'});
    res.writeHead(200,{'Content-Type':'image/png','Access-Control-Allow-Origin':'*'});return res.end(frame.image);
  }
  if (req.method === 'GET' && url.pathname === '/frames') return response(res, 200, frames.map(({timestamp, source, bytes}) => ({timestamp, source, bytes})));
  if (req.method === 'GET' && url.pathname === '/tracker-state') return response(res, 200, trackerState);
  if (req.method === 'GET' && url.pathname === '/ocr-status') {
    const latest=ocrReports.at(-1)||null, fresh=latest&&Date.now()-latest.receivedAt<=25000;
    return response(res,200,{latest,cleanSince: fresh?cleanSince:null,cleanCount:fresh?cleanCount:0,cleanDurationMs:fresh&&cleanSince?latest.receivedAt-cleanSince:0,reports:ocrReports});
  }
  if (req.method === 'POST' && url.pathname === '/ocr-status') {
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>16384)req.destroy();});
    req.on('end',()=>{try{
      const report=JSON.parse(body);if(typeof report.accepted!=='boolean')return response(res,400,{error:'Missing OCR outcome'});
      const now=Date.now(),prior=ocrReports.at(-1);
      if(!report.accepted){cleanSince=null;cleanCount=0;}else{if(!prior||!prior.accepted||now-prior.receivedAt>25000){cleanSince=now;cleanCount=0;}cleanCount++;}
      ocrReports.push({accepted:report.accepted,frameAt:report.frameAt,levelText:String(report.levelText||'').slice(0,100),expText:String(report.expText||'').slice(0,200),error:String(report.error||'').slice(0,200),receivedAt:now});
      if(ocrReports.length>600)ocrReports.shift();return response(res,200,{ok:true});
    }catch{return response(res,400,{error:'Invalid OCR report'});}});return;
  }
  if (req.method === 'POST' && url.pathname === '/tracker-state') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const next = JSON.parse(body);
        if (!Array.isArray(next.samples) || next.samples.length > 240) return response(res, 400, {error: 'Invalid tracker state'});
        trackerState = {samples: next.samples, level: Number.isFinite(next.level) ? next.level : null};
        return response(res, 200, {ok: true, samples: trackerState.samples.length});
      } catch { return response(res, 400, {error: 'Invalid JSON'}); }
    });
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/capture') return response(res, 404, {error: 'Not found'});
  const source = url.searchParams.get('source');
  if (!source) return response(res, 400, {error: 'Add ?source=OBS_SOURCE_NAME'});
  try {
    const image = await screenshot(source);
    const frame = {timestamp: Number(url.searchParams.get('timestamp')) || Date.now(), source, image, bytes: image.length};
    frames.push(frame); if (frames.length > 20) frames.shift();
    if (trackerUrl) fetch(trackerUrl, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({timestamp: frame.timestamp, source, imageData: `data:image/png;base64,${image.toString('base64')}`})}).catch(err => console.warn('Tracker forward failed:', err.message));
    console.log(`Captured ${source} (${image.length} bytes)`);
    return response(res, 200, {ok: true, timestamp: frame.timestamp, source, bytes: image.length});
  } catch (error) {
    console.warn(error.message);
    return response(res, 502, {error: error.message});
  }
});
server.listen(PORT, HOST, () => {
  console.log(`Maple Track OBS bridge listening on http://${HOST}:${PORT}`);
  console.log(`OBS WebSocket: ${OBS_URL}`);
  if (OBS_PASSWORD) console.log('OBS password: supplied through environment');
  console.log('Configure the tracker forward URL with MAPLE_TRACK_TRACKER_URL if available.');
});
