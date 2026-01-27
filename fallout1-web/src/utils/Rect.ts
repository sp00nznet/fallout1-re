/**
 * Rectangle structure matching the original game's Rect
 * Used throughout the engine for screen regions, clipping, etc.
 */
export interface Rect {
  ulx: number;  // upper-left x
  uly: number;  // upper-left y
  lrx: number;  // lower-right x
  lry: number;  // lower-right y
}

export function createRect(ulx = 0, uly = 0, lrx = 0, lry = 0): Rect {
  return { ulx, uly, lrx, lry };
}

export function rectCopy(dest: Rect, src: Rect): void {
  dest.ulx = src.ulx;
  dest.uly = src.uly;
  dest.lrx = src.lrx;
  dest.lry = src.lry;
}

export function rectOffset(rect: Rect, dx: number, dy: number): void {
  rect.ulx += dx;
  rect.uly += dy;
  rect.lrx += dx;
  rect.lry += dy;
}

export function rectGetWidth(rect: Rect): number {
  return rect.lrx - rect.ulx + 1;
}

export function rectGetHeight(rect: Rect): number {
  return rect.lry - rect.uly + 1;
}

export function rectIntersect(a: Rect, b: Rect, result: Rect): boolean {
  result.ulx = Math.max(a.ulx, b.ulx);
  result.uly = Math.max(a.uly, b.uly);
  result.lrx = Math.min(a.lrx, b.lrx);
  result.lry = Math.min(a.lry, b.lry);

  return result.lrx >= result.ulx && result.lry >= result.uly;
}

export function rectUnion(a: Rect, b: Rect, result: Rect): void {
  result.ulx = Math.min(a.ulx, b.ulx);
  result.uly = Math.min(a.uly, b.uly);
  result.lrx = Math.max(a.lrx, b.lrx);
  result.lry = Math.max(a.lry, b.lry);
}

export function rectContainsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.ulx && x <= rect.lrx && y >= rect.uly && y <= rect.lry;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.ulx >= outer.ulx &&
         inner.uly >= outer.uly &&
         inner.lrx <= outer.lrx &&
         inner.lry <= outer.lry;
}

export function rectEquals(a: Rect, b: Rect): boolean {
  return a.ulx === b.ulx && a.uly === b.uly && a.lrx === b.lrx && a.lry === b.lry;
}
