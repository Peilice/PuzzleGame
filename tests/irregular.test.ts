import { describe, expect, it } from 'vitest';
import { makeIrregularLayout, polygonArea, silhouettePolygon, SILHOUETTES, type Silhouette } from '../src/core/irregular';
import { dropGroup, isComplete, makeLayout, newPieces, piecePad, type Layout, type PieceGeom } from '../src/core/puzzle';

type Pt = [number, number];

/** 把拼片輪廓（含貝茲曲線）攤平成折線 */
function flatten(g: PieceGeom): Pt[] {
  const pts: Pt[] = [];
  let cur: Pt = [0, 0];
  g.trace({
    moveTo: (x, y) => pts.push((cur = [x, y])),
    lineTo: (x, y) => pts.push((cur = [x, y])),
    bezierCurveTo: (c1x, c1y, c2x, c2y, x, y) => {
      const [x0, y0] = cur;
      for (let s = 1; s <= 24; s++) {
        const t = s / 24;
        const u = 1 - t;
        pts.push([u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y]);
      }
      cur = [x, y];
    },
    closePath: () => {},
  });
  return pts;
}

const layoutArea = (L: Layout) => polygonArea(L.outline ?? [[0, 0], [L.boardW, 0], [L.boardW, L.boardH], [0, L.boardH]]);

describe('異型切割', () => {
  const cols = 14;
  const rows = 11;

  for (const sil of SILHOUETTES) {
    describe(`輪廓 ${sil}`, () => {
      const L = makeIrregularLayout(cols, rows, 4 / 3, 12345, sil);

      it('片數與難度一致，每片都有鄰居', () => {
        expect(L.geoms).toHaveLength(cols * rows);
        for (const g of L.geoms) {
          expect(g.neighbors.length).toBeGreaterThanOrEqual(2);
          expect(g.w).toBeGreaterThan(0);
          expect(g.h).toBeGreaterThan(0);
        }
      });

      it('鄰居是對稱的，且位移互為相反', () => {
        L.geoms.forEach((g, i) => {
          for (const n of g.neighbors) {
            const back = L.geoms[n.i].neighbors.find((m) => m.i === i);
            expect(back, `${n.i} → ${i}`).toBeDefined();
            expect(back!.dx).toBeCloseTo(-n.dx, 6);
            expect(back!.dy).toBeCloseTo(-n.dy, 6);
          }
        });
      });

      it('凹凸互補：所有拼片面積加起來等於輪廓面積', () => {
        const total = L.geoms.reduce((s, g) => s + Math.abs(polygonArea(flatten(g))), 0);
        expect(total / layoutArea(L)).toBeCloseTo(1, 3);
      });

      it('卡榫不會超出留白範圍', () => {
        const pad = piecePad(L);
        let overflow = 0; // 超出留白的最大距離
        for (const g of L.geoms) {
          for (const [x, y] of flatten(g)) overflow = Math.max(overflow, -pad - x, -pad - y, x - (g.w + pad), y - (g.h + pad));
        }
        expect(overflow).toBeLessThanOrEqual(0);
      });

      it('有邊框片，且不是每一片都是', () => {
        const n = L.geoms.filter((g) => g.edge).length;
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(L.geoms.length);
      });

      it('每片的位置都落在拼盤內', () => {
        for (const g of L.geoms) {
          expect(g.x).toBeGreaterThanOrEqual(-1e-6);
          expect(g.y).toBeGreaterThanOrEqual(-1e-6);
          expect(g.x + g.w).toBeLessThanOrEqual(L.boardW + 1e-6);
          expect(g.y + g.h).toBeLessThanOrEqual(L.boardH + 1e-6);
        }
      });

      it('依序放到正確位置就能全部拼起來', () => {
        const pieces = newPieces(L, 7);
        let locked = 0;
        for (let i = 0; i < pieces.length; i++) {
          pieces[i].x = L.geoms[i].x;
          pieces[i].y = L.geoms[i].y;
          if (dropGroup(pieces, L, pieces[i].group).locked) locked++;
        }
        expect(locked).toBeGreaterThan(0);
        expect(isComplete(pieces)).toBe(true);
      });
    });
  }

  it('同一個 seed 結果完全相同，不同 seed 不同', () => {
    const a = makeIrregularLayout(cols, rows, 4 / 3, 99, 'circle');
    const b = makeIrregularLayout(cols, rows, 4 / 3, 99, 'circle');
    const c = makeIrregularLayout(cols, rows, 4 / 3, 100, 'circle');
    const key = (L: Layout) => L.geoms.map((g) => `${g.x.toFixed(3)},${g.y.toFixed(3)},${g.w.toFixed(3)}`).join('|');
    expect(key(a)).toBe(key(b));
    expect(key(a)).not.toBe(key(c));
  });

  it('拼片大小有落差（確實是異型），但不會差太多', () => {
    const L = makeIrregularLayout(cols, rows, 4 / 3, 5, 'rect');
    const areas = L.geoms.map((g) => g.w * g.h);
    const mean = areas.reduce((s, a) => s + a, 0) / areas.length;
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(1.5);
    expect(Math.max(...areas)).toBeLessThan(mean * 8);
  });

  it('輪廓內縮、不超出拼盤', () => {
    for (const sil of SILHOUETTES) {
      const poly = silhouettePolygon(sil as Silhouette, 1400, 1050);
      expect(polygonArea(poly)).toBeGreaterThan(0); // 順時針
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1400);
        expect(y).toBeLessThanOrEqual(1050);
      }
    }
  });

  it('最大難度（600 片）在合理時間內切完', () => {
    const t = performance.now();
    const L = makeIrregularLayout(28, 21, 4 / 3, 2024, 'hexagon');
    expect(L.geoms).toHaveLength(588);
    expect(performance.now() - t).toBeLessThan(5000);
  });

  it('經典切割的幾何與先前一致（外框、鄰居、位置）', () => {
    const L = makeLayout(4, 3, 4 / 3, 1);
    expect(L.geoms).toHaveLength(12);
    expect(L.geoms[5].x).toBeCloseTo(100);
    expect(L.geoms[5].neighbors.map((n) => n.i).sort((a, b) => a - b)).toEqual([1, 4, 6, 9]);
    expect(L.geoms[0].edge).toBe(true);
    expect(L.geoms[5].edge).toBe(false);
  });
});
