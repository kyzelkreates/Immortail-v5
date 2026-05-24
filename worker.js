// IMMORTAIL™ Local Media Worker v1
// Off-thread image/video/audio processing via OffscreenCanvas + VideoDecoder

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    let result;
    switch (type) {
      case 'PROCESS_IMAGE':     result = await processImage(payload);     break;
      case 'BUILD_SPRITESHEET': result = await buildSpritesheet(payload); break;
      case 'PROCESS_AUDIO':     result = await processAudio(payload);     break;
      case 'PING':              result = { ok: true, ts: Date.now() };    break;
      default: throw new Error('Unknown: ' + type);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};

// ── Image — crop to square, resize, bg remove, convert to webp ────────────
async function processImage({ buffer, targetSize = 512, expression = 'idle', slot = 'body' }) {
  const blob   = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);
  const size   = Math.min(bitmap.width, bitmap.height);
  const sx     = (bitmap.width  - size) / 2;
  const sy     = (bitmap.height - size) / 2;
  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = '#0B0F14';
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, targetSize, targetSize);
  if (slot === 'body' || slot === 'face') _removeBackground(ctx, targetSize);
  const outBlob   = await canvas.convertToBlob({ type: 'image/webp', quality: 0.88 });
  const outBuffer = await outBlob.arrayBuffer();
  return { buffer: outBuffer, mimeType: 'image/webp', width: targetSize, height: targetSize, expression, slot, processed: Date.now() };
}

function _removeBackground(ctx, size) {
  const data = ctx.getImageData(0, 0, size, size);
  const d    = data.data;
  let r=0,g=0,b=0,n=0;
  for (let py=0;py<4;py++) for (let px=0;px<4;px++) { const i=(py*size+px)*4; r+=d[i];g+=d[i+1];b+=d[i+2];n++; }
  const bR=r/n,bG=g/n,bB=b/n;
  if (!(bR>180&&bG>180&&bB>180)) return;
  const thr=38;
  for (let i=0;i<d.length;i+=4) {
    if (Math.abs(d[i]-bR)<thr&&Math.abs(d[i+1]-bG)<thr&&Math.abs(d[i+2]-bB)<thr) d[i+3]=0;
  }
  ctx.putImageData(data,0,0);
}

// ── Spritesheet builder ────────────────────────────────────────────────────
async function buildSpritesheet({ buffers, frameSize=256, cols=4, expression='idle' }) {
  const rows   = Math.ceil(buffers.length/cols);
  const canvas = new OffscreenCanvas(frameSize*cols, frameSize*rows);
  const ctx    = canvas.getContext('2d');
  for (let i=0;i<buffers.length;i++) {
    const blob   = new Blob([buffers[i]],{type:'image/webp'});
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap,(i%cols)*frameSize,Math.floor(i/cols)*frameSize,frameSize,frameSize);
    bitmap.close();
  }
  const outBlob = await canvas.convertToBlob({type:'image/webp',quality:0.85});
  return { buffer: await outBlob.arrayBuffer(), mimeType:'image/webp', frameSize, cols, rows, frameCount:buffers.length, expression };
}

// ── Audio — pass-through, store as-is ─────────────────────────────────────
async function processAudio({ buffer, expression='idle' }) {
  return { buffer, expression, processed: Date.now(), note:'Audio normalisation runs on main thread' };
}
