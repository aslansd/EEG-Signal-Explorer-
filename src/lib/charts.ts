/**
 * Convert a mouse position into the SVG's own coordinate system.
 *
 * The original charts mixed the two: `paddingLeft` was a viewBox coordinate (55 or
 * 40) but was subtracted from `rect.width`, which is in CSS pixels. Whenever the
 * SVG rendered at anything other than exactly its viewBox width — which is always,
 * since the charts are `w-full` — the crosshair drifted away from the cursor. One
 * chart also used 55 where its own drawing code used 60.
 *
 * Going through `getScreenCTM()` is exact regardless of how the element is sized,
 * scaled or scrolled.
 */
export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/**
 * Min/max decimation for line charts.
 *
 * A 40 s recording at 256 Hz is 10,240 samples per channel. Emitting one path
 * command per sample across eight channels meant ~82,000 path segments for the
 * full-recording view, most of them sub-pixel. This reduces each column of pixels
 * to its minimum and maximum, which preserves the visual envelope — including
 * single-sample spikes, which naive downsampling would drop — at a fraction of the
 * cost.
 */
export function decimateMinMax(
  data: Float32Array,
  from: number,
  to: number,
  columns: number,
): { index: number; value: number }[] {
  const count = Math.max(0, Math.min(data.length, to) - Math.max(0, from));
  const start = Math.max(0, from);
  if (count <= 0) return [];

  // Below two samples per column there is nothing to decimate.
  if (count <= columns * 2) {
    const out: { index: number; value: number }[] = [];
    for (let i = 0; i < count; i++) out.push({ index: start + i, value: data[start + i] });
    return out;
  }

  const perColumn = count / columns;
  const out: { index: number; value: number }[] = [];
  for (let c = 0; c < columns; c++) {
    const a = start + Math.floor(c * perColumn);
    const b = Math.min(start + count, start + Math.floor((c + 1) * perColumn));
    if (b <= a) continue;

    let min = data[a];
    let max = data[a];
    let minIdx = a;
    let maxIdx = a;
    for (let i = a + 1; i < b; i++) {
      const v = data[i];
      if (v < min) {
        min = v;
        minIdx = i;
      }
      if (v > max) {
        max = v;
        maxIdx = i;
      }
    }
    // Emit in temporal order so the path does not zig-zag backwards.
    if (minIdx <= maxIdx) {
      out.push({ index: minIdx, value: min });
      if (maxIdx !== minIdx) out.push({ index: maxIdx, value: max });
    } else {
      out.push({ index: maxIdx, value: max });
      out.push({ index: minIdx, value: min });
    }
  }
  return out;
}
