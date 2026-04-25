// Loads a silhouette image, builds a binary hit-mask, and provides
// Monte-Carlo Range Factor + single-impact sampling against that mask.

// Mask detection uses alpha only — works correctly with a transparent-background PNG.

// Deterministic unit-normal pool. Same random samples are reused for every MC
// call so the displayed RF is a smooth function of inputs (no jitter).
const SAMPLE_COUNT = 2048;
const UNIT_NORMALS = buildUnitNormals(SAMPLE_COUNT, 0x9E3779B1);

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildUnitNormals(n, seed) {
  const rng = mulberry32(seed);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    out[i * 2]     = mag * Math.cos(2 * Math.PI * v);
    out[i * 2 + 1] = mag * Math.sin(2 * Math.PI * v);
  }
  return out;
}

let cached = null;
let loading = null;

export function getSilhouette() { return cached; }

// Loads the silhouette, downscales to ~targetHeightPx tall, finds the bbox of
// non-background pixels, crops to it, and returns a {mask, width, height,
// displayUrl} record. Subsequent calls return the cached record.
export function loadSilhouette(url, targetHeightPx = 360) {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;

  loading = (async () => {
    const img = await loadImage(url);
    const scale = targetHeightPx / img.height;
    const w0 = Math.max(1, Math.round(img.width * scale));
    const h0 = targetHeightPx;

    const workCanvas = document.createElement("canvas");
    workCanvas.width = w0;
    workCanvas.height = h0;
    const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w0, h0);

    const pixels = ctx.getImageData(0, 0, w0, h0).data;

    // First pass: find bbox of non-background pixels.
    let minX = w0, minY = h0, maxX = -1, maxY = -1;
    for (let y = 0; y < h0; y++) {
      for (let x = 0; x < w0; x++) {
        const i = (y * w0 + x) * 4;
        const a = pixels[i + 3];
        const isBody = a > 16;
        if (isBody) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) throw new Error("Silhouette mask empty (all pixels look like background)");

    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const mask = new Uint8Array(bboxW * bboxH);
    for (let y = 0; y < bboxH; y++) {
      for (let x = 0; x < bboxW; x++) {
        const i = ((y + minY) * w0 + (x + minX)) * 4;
        const isBody = pixels[i + 3] > 16;
        if (isBody) mask[y * bboxW + x] = 1;
      }
    }

    // Render the cropped silhouette to a small PNG for use as an <img> src.
    const dispCanvas = document.createElement("canvas");
    dispCanvas.width = bboxW;
    dispCanvas.height = bboxH;
    const dctx = dispCanvas.getContext("2d");
    dctx.drawImage(workCanvas, minX, minY, bboxW, bboxH, 0, 0, bboxW, bboxH);
    const displayUrl = dispCanvas.toDataURL("image/png");

    cached = { mask, width: bboxW, height: bboxH, displayUrl, sourceUrl: url };
    return cached;
  })();

  return loading;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

// POA normalized coords (0..1 of silhouette bbox). Values chosen empirically
// to hit anatomical landmarks on a standing frontal human figure.
export const POA_PRESETS = {
  head:    { x: 0.50, y: 0.08 },
  chest:   { x: 0.50, y: 0.22 },
  abdomen: { x: 0.50, y: 0.38 },
  leg:     { x: 0.50, y: 0.72 },
};

function inchesPerPx(silh, figureHeightIn) {
  return figureHeightIn / silh.height;
}

// Shared mapping from MOA-space deviation to pixel-space deviation on the mask.
// Width scale stretches the figure horizontally: >1 = wider person, same px
// image represents more inches across → fewer px per inch of horizontal error.
function moaToPxFactors(silh, figureHeightIn, widthScale, distanceYd) {
  const inPerPxY = inchesPerPx(silh, figureHeightIn);
  const inPerPxX = inPerPxY * widthScale;
  const inPerMoa = distanceYd / 95.5;
  return {
    pxPerMoaX: inPerMoa / inPerPxX,
    pxPerMoaY: inPerMoa / inPerPxY,
  };
}

// params: { figureHeightIn, widthScale, distanceYd, dispersionMoa, poaNorm: {x,y} }
// Monte Carlo hit probability — uses the deterministic unit-normal pool, so
// output is a smooth function of inputs.
export function monteCarloRF(silh, params) {
  if (!silh) return 0;
  const { figureHeightIn, widthScale, distanceYd, dispersionMoa, poaNorm } = params;
  if (!(dispersionMoa > 0) || !(distanceYd > 0) || !(figureHeightIn > 0)) return 0;

  const { pxPerMoaX, pxPerMoaY } = moaToPxFactors(silh, figureHeightIn, widthScale, distanceYd);
  const sigmaPxX = dispersionMoa * pxPerMoaX;
  const sigmaPxY = dispersionMoa * pxPerMoaY;

  const w = silh.width, h = silh.height, mask = silh.mask;
  const poaPxX = poaNorm.x * w;
  const poaPxY = poaNorm.y * h;

  let hits = 0;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const dx = UNIT_NORMALS[i * 2]     * sigmaPxX;
    const dy = UNIT_NORMALS[i * 2 + 1] * sigmaPxY;
    const x = (poaPxX + dx) | 0;
    const y = (poaPxY + dy) | 0;
    if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) hits++;
  }
  return hits / SAMPLE_COUNT;
}

// Samples an impact whose visual position matches the HIT/MISS verdict from
// the d100 roll. Rejection-samples until the geometric verdict on the mask
// agrees with wantHit, then falls back to the nearest matching pixel if the
// loop exhausts (rare: skill/dispersion combos where the visual probability
// is near 0% or 100% but the dice went the other way).
export function sampleImpactForOutcome(silh, params, tightness, wantHit, rng = Math.random, maxTries = 500) {
  let last = null;
  for (let i = 0; i < maxTries; i++) {
    const impact = sampleOneImpact(silh, params, tightness, rng);
    last = impact;
    if (impact.hit === wantHit) return impact;
  }
  if (!last) return null;
  const nearest = findNearestPixel(silh, last.xPx, last.yPx, wantHit);
  if (!nearest) return last;
  return reprojectImpact(silh, params, nearest.x, nearest.y);
}

// Spiral search for the nearest pixel whose hit-status matches wantHit.
// Out-of-bounds pixels count as off-body (a natural "miss").
function findNearestPixel(silh, cx, cy, wantHit, maxRadius) {
  const { mask, width: w, height: h } = silh;
  const startX = Math.max(0, Math.min(w - 1, cx | 0));
  const startY = Math.max(0, Math.min(h - 1, cy | 0));
  const limit = maxRadius ?? Math.max(w, h);

  const check = (x, y) => {
    const oob = x < 0 || y < 0 || x >= w || y >= h;
    const onBody = !oob && mask[y * w + x] === 1;
    return wantHit ? onBody : !onBody;
  };

  if (check(startX, startY)) return { x: startX, y: startY };
  for (let r = 1; r <= limit; r++) {
    for (let dx = -r; dx <= r; dx++) {
      if (check(startX + dx, startY - r)) return { x: startX + dx, y: startY - r };
      if (check(startX + dx, startY + r)) return { x: startX + dx, y: startY + r };
    }
    for (let dy = -r + 1; dy <= r - 1; dy++) {
      if (check(startX - r, startY + dy)) return { x: startX - r, y: startY + dy };
      if (check(startX + r, startY + dy)) return { x: startX + r, y: startY + dy };
    }
  }
  return null;
}

// Given an explicit pixel position, reverse-map through the mask geometry to
// MOA/inch deviations so the readout stays consistent with the plotted dot.
function reprojectImpact(silh, params, xPx, yPx) {
  const { figureHeightIn, widthScale, distanceYd, poaNorm } = params;
  const { pxPerMoaX, pxPerMoaY } = moaToPxFactors(silh, figureHeightIn, widthScale, distanceYd);
  const poaPxX = poaNorm.x * silh.width;
  const poaPxY = poaNorm.y * silh.height;
  const xMoa = (xPx - poaPxX) / pxPerMoaX;
  const yMoa = (yPx - poaPxY) / pxPerMoaY;
  const ix = xPx | 0, iy = yPx | 0;
  const hit = ix >= 0 && iy >= 0 && ix < silh.width && iy < silh.height
              && silh.mask[iy * silh.width + ix] === 1;
  return {
    xMoa, yMoa,
    xIn: xMoa * distanceYd / 95.5,
    yIn: yMoa * distanceYd / 95.5,
    xPx, yPx, hit,
  };
}

// Samples one impact from the standard-normal pool with optional tightness
// (σ multiplier tied to shot type). Returns impact in pixel-space of the
// silhouette mask plus the MOA/inch deviations for display.
export function sampleOneImpact(silh, params, tightness = 1.0, rng = Math.random) {
  const { figureHeightIn, widthScale, distanceYd, dispersionMoa, poaNorm } = params;
  const { pxPerMoaX, pxPerMoaY } = moaToPxFactors(silh, figureHeightIn, widthScale, distanceYd);

  // Fresh Box–Muller so the visualized shot is not tied to the MC pool.
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const mag = Math.sqrt(-2 * Math.log(u));
  const z1 = mag * Math.cos(2 * Math.PI * v);
  const z2 = mag * Math.sin(2 * Math.PI * v);

  const xMoa = z1 * dispersionMoa * tightness;
  const yMoa = z2 * dispersionMoa * tightness;
  const xIn = xMoa * distanceYd / 95.5;
  const yIn = yMoa * distanceYd / 95.5;

  const poaPxX = poaNorm.x * silh.width;
  const poaPxY = poaNorm.y * silh.height;
  const xPx = poaPxX + xMoa * pxPerMoaX;
  const yPx = poaPxY + yMoa * pxPerMoaY;

  const ix = xPx | 0, iy = yPx | 0;
  const hit = ix >= 0 && iy >= 0 && ix < silh.width && iy < silh.height
              && silh.mask[iy * silh.width + ix] === 1;

  return { xMoa, yMoa, xIn, yIn, xPx, yPx, hit };
}
