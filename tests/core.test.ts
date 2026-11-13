import { describe, expect, it } from 'vitest';
import { CATEGORIES, DIFFICULTIES, pieceCount, type Content, type PuzzleImage } from '../src/core/content';
import { createSave, migrate, recordCompletion, type SaveData } from '../src/core/save';
import { computeStats } from '../src/core/stats';
import { toProgress } from '../src/core/storage';
import { buildTitles, evaluateTitles, visibleTitles } from '../src/core/titles';
import {
  arrangeAround,
  correctPos,
  dropGroup,
  enterTray,
  gatherToTray,
  generateEdges,
  isComplete,
  leaveTray,
  looseSingles,
  makeLayout,
  newPieces,
  sanitizeTray,
  shuffledOrder,
  tableBounds,
  trayCellAt,
  trayGeometry,
  tracePiece,
  withTrayFallback,
  type PieceEdges,
  type PieceState,
} from '../src/core/puzzle';

function makeContent(perCategory = 10, categories = CATEGORIES): Content {
  const images: PuzzleImage[] = [];
  for (const c of categories) {
    for (let i = 1; i <= perCategory; i++) {
      const id = `${c.id}-${String(i).padStart(2, '0')}`;
      images.push({ id, category: c.id, name: id, src: '', thumb: '' });
    }
  }
  return { categories, difficulties: DIFFICULTIES, images };
}

function complete(save: SaveData, imageId: string, diffIdx: number, timeMs = 3_600_000) {
  const d = DIFFICULTIES[diffIdx];
  return recordCompletion(save, { imageId, difficultyId: d.id, pieces: pieceCount(d), timeMs, at: 1, assistsUsed: [] }).save;
}

function run(save: SaveData, content: Content) {
  const defs = buildTitles(content);
  const stats = computeStats(save, content);
  return { defs, stats, ...evaluateTitles(save, stats, content, defs) };
}

describe('難度', () => {
  it('行列比例接近 4:3 且拼片接近正方形', () => {
    for (const d of DIFFICULTIES) {
      const pieceAspect = (4 / d.cols) / (3 / d.rows);
      expect(pieceAspect).toBeGreaterThan(0.85);
      expect(pieceAspect).toBeLessThan(1.15);
      expect(Math.abs(pieceCount(d) - d.label) / d.label).toBeLessThan(0.05);
    }
  });
});

describe('存檔', () => {
  it('初始存檔已解鎖並裝備「見習拼圖師」', () => {
    const s = createSave();
    expect(s.profile.equippedTitle).toBe('progress-0');
    expect(s.unlockedTitles['progress-0']).toBeDefined();
  });

  it('migrate 補齊缺漏欄位、拒絕未來版本', () => {
    const m = migrate({ version: 1, completions: [{ imageId: 'a', difficultyId: 'd150', pieces: 154, timeMs: 1, at: 1 }] });
    expect(m.completions[0].assistsUsed).toEqual([]);
    expect(m.settings.sound).toBe(true);
    // 舊存檔沒有 showHints → 預設顯示操作提示；已關閉的設定要保留
    expect(m.settings.showHints).toBe(true);
    expect(m.settings.toolsCollapsed).toBe(false);
    expect(migrate({ version: 1, settings: { sound: false, table: 'oak', showHints: false } }).settings.showHints).toBe(false);
    expect(() => migrate({ version: 99 })).toThrow();
    // 壞掉的欄位不會帶進存檔
    const dirty = migrate({
      version: 1,
      completions: [null, { imageId: 'a', difficultyId: 'd150', pieces: 'x', timeMs: 1 }, { imageId: 'a', difficultyId: 'd150', pieces: 154, timeMs: 5, at: 2 }],
      best: { 'a|d150': 5, bad: 'fast', nan: null },
      totalPlayMs: 'long',
      settings: { sound: 'yes', table: 3 },
      profile: { equippedTitle: 7 },
    });
    expect(dirty.completions).toHaveLength(1);
    expect(dirty.best).toEqual({ 'a|d150': 5 });
    expect(dirty.totalPlayMs).toBe(0);
    expect(dirty.settings).toEqual({ sound: true, table: 'oak', showHints: true, startInTray: true, toolsCollapsed: false });
    expect(dirty.profile.equippedTitle).toBe('progress-0');
    expect(() => migrate('x')).toThrow();
  });

  it('最佳時間只在更快時更新', () => {
    let s = createSave();
    const r1 = recordCompletion(s, { imageId: 'a', difficultyId: 'd150', pieces: 154, timeMs: 5000, at: 1, assistsUsed: [] });
    expect(r1.isNewBest).toBe(true);
    s = r1.save;
    const r2 = recordCompletion(s, { imageId: 'a', difficultyId: 'd150', pieces: 154, timeMs: 6000, at: 2, assistsUsed: [] });
    expect(r2.isNewBest).toBe(false);
    expect(r2.save.best['a|d150']).toBe(5000);
  });
});

describe('稱號', () => {
  const content = makeContent();

  it('目前可見的稱號共 87 個', () => {
    const save = createSave();
    const { defs, stats } = run(save, content);
    expect(visibleTitles(save, stats, content, defs)).toHaveLength(87);
  });

  it('分類線計算不重複的圖片 × 難度組合', () => {
    let s = createSave();
    s = complete(s, 'food-01', 0);
    s = complete(s, 'food-01', 0); // 重複不算
    s = complete(s, 'food-01', 1);
    s = complete(s, 'food-02', 0);
    const { newlyUnlocked, stats } = run(s, content);
    expect(stats.combosByCategory.get('food')).toBe(3);
    expect(newlyUnlocked).toContain('cat-food-1');
    expect(newlyUnlocked).toContain('cat-food-3');
    expect(newlyUnlocked).not.toContain('cat-food-5');
  });

  it('難度線與總進度線計入重複遊玩', () => {
    let s = createSave();
    for (let i = 0; i < 5; i++) s = complete(s, 'art-01', 0);
    const { newlyUnlocked, stats } = run(s, content);
    expect(stats.countByDifficulty.get('d150')).toBe(5);
    expect(stats.totalPieces).toBe(154 * 5);
    expect(newlyUnlocked).toContain('diff-d150-5');
    expect(newlyUnlocked).toContain('progress-500');
  });

  it('速度線依門檻判定', () => {
    let s = createSave();
    s = complete(s, 'art-01', 0, 9 * 60_000);
    const { newlyUnlocked } = run(s, content);
    expect(newlyUnlocked).toEqual(expect.arrayContaining(['speed-d150-0', 'speed-d150-1']));
    expect(newlyUnlocked).not.toContain('speed-d150-2');
  });

  it('五感全開需要 5 類各 1 組', () => {
    let s = createSave();
    for (const c of CATEGORIES.slice(0, 4)) s = complete(s, `${c.id}-01`, 0);
    expect(run(s, content).newlyUnlocked).not.toContain('col-five-senses');
    s = complete(s, 'flower-01', 0);
    expect(run(s, content).newlyUnlocked).toContain('col-five-senses');
  });

  it('內容不足的分類等級不顯示，內容增加後自動出現', () => {
    const save = createSave();
    const small = run(save, content);
    const ids = visibleTitles(save, small.stats, content, small.defs).map((v) => v.def.id);
    expect(ids).toContain('cat-food-40');
    expect(ids).not.toContain('cat-food-60');
    const big = makeContent(25);
    const r = run(save, big);
    const ids2 = visibleTitles(save, r.stats, big, r.defs).map((v) => v.def.id);
    expect(ids2).toContain('cat-food-100');
  });

  it('全部完成類稱號永久保留，內容增加後標示「有新內容」', () => {
    const tiny = makeContent(1);
    let s = createSave();
    for (const img of tiny.images) for (let d = 0; d < 4; d++) s = complete(s, img.id, d);
    const r1 = run(s, tiny);
    expect(r1.newlyUnlocked).toEqual(expect.arrayContaining(['col-perfect', 'col-all-images', 'col-cat-food']));
    s = r1.save;
    // 內容增加
    const more = makeContent(2);
    const r2 = run(s, more);
    expect(r2.save.unlockedTitles['col-perfect']).toBeDefined();
    const view = visibleTitles(r2.save, r2.stats, more, r2.defs).find((v) => v.def.id === 'col-perfect')!;
    expect(view.unlocked).toBe(true);
    expect(view.hasNewContent).toBe(true);
  });

  it('新增分類時產生新的分類線與「萬象通曉」，五感全開仍只看原 5 類', () => {
    const extra = [
      ...CATEGORIES,
      { id: 'space', name: '太空', original: false, titleNames: Array.from({ length: 10 }, (_, i) => `太空${i}`), collectorName: '太空收藏家' },
    ];
    const c = makeContent(10, extra);
    let s = createSave();
    for (const cat of CATEGORIES) s = complete(s, `${cat.id}-01`, 0);
    const r = run(s, c);
    expect(r.newlyUnlocked).toContain('col-five-senses');
    expect(r.newlyUnlocked).not.toContain('col-all-categories');
    expect(r.defs.some((d) => d.id === 'cat-space-1')).toBe(true);
  });
});

describe('拼圖幾何', () => {
  it('相鄰拼片的卡榫互補', () => {
    const cols = 6;
    const rows = 4;
    const e = generateEdges(cols, rows, 42);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (x < cols - 1) expect(e[i].right.dir).toBe(-e[i + 1].left.dir);
        if (y < rows - 1) expect(e[i].bottom.dir).toBe(-e[i + cols].top.dir);
        if (x === 0) expect(e[i].left.dir).toBe(0);
        if (y === rows - 1) expect(e[i].bottom.dir).toBe(0);
      }
    }
  });

  it('相鄰拼片共用邊的切割線在世界座標完全重合', () => {
    // 依 tracePiece 的順序（上 → 右 → 下 → 左）把輪廓切成四條邊的點列
    const traceEdges = (pe: PieceEdges, w: number, h: number, ox: number, oy: number) => {
      const corners = [[w, 0], [w, h], [0, h], [0, 0]];
      const edges: [number, number][][] = [[]];
      const add = (x: number, y: number) => edges[edges.length - 1].push([x + ox, y + oy]);
      const end = (x: number, y: number) => {
        const k = edges.length - 1;
        if (k < 4 && x === corners[k][0] && y === corners[k][1]) edges.push([]);
      };
      tracePiece(
        {
          moveTo: () => {},
          lineTo: (x, y) => (add(x, y), end(x, y)),
          bezierCurveTo: (a, b, c, d, x, y) => (add(a, b), add(c, d), add(x, y), end(x, y)),
          closePath: () => {},
        },
        pe,
        w,
        h,
      );
      return edges.slice(0, 4);
    };
    // 共用邊兩側走向相反：去掉最後的轉角點、反轉後應與另一側（含起點）逐點相同
    const same = (a: [number, number][], b: [number, number][], a0: [number, number]) => {
      const fwd = [a0, ...a.slice(0, -1)];
      const rev = [...b].reverse();
      expect(rev.length).toBe(fwd.length);
      // 控制點順序也會反轉：一段貝茲 (P0,C1,C2,P1) 反向為 (P1,C2,C1,P0)，點列整體反轉即可對上
      rev.forEach((p, k) => {
        expect(p[0]).toBeCloseTo(fwd[k][0], 6);
        expect(p[1]).toBeCloseTo(fwd[k][1], 6);
      });
    };
    for (const seed of [1, 42, 999]) {
      const cols = 5;
      const rows = 4;
      const w = 100;
      const h = 90;
      const e = generateEdges(cols, rows, seed);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          const me = traceEdges(e[i], w, h, x * w, y * h);
          if (x < cols - 1) {
            const nb = traceEdges(e[i + 1], w, h, (x + 1) * w, y * h);
            same(me[1], nb[3], [(x + 1) * w, y * h]);
          }
          if (y < rows - 1) {
            const nb = traceEdges(e[i + cols], w, h, x * w, (y + 1) * h);
            same(me[2], nb[0], [(x + 1) * w, (y + 1) * h]);
          }
        }
      }
    }
  });

  it('相同種子產生相同形狀', () => {
    expect(generateEdges(5, 5, 7)).toEqual(generateEdges(5, 5, 7));
    expect(generateEdges(5, 5, 7)).not.toEqual(generateEdges(5, 5, 8));
  });

  it('輪廓路徑可以繪製且卡榫不超出留白', () => {
    const e = generateEdges(3, 3, 1);
    const pts: number[] = [];
    const sink = {
      moveTo: (x: number, y: number) => pts.push(x, y),
      lineTo: (x: number, y: number) => pts.push(x, y),
      bezierCurveTo: (a: number, b: number, c: number, d: number, x: number, y: number) => pts.push(a, b, c, d, x, y),
      closePath: () => {},
    };
    tracePiece(sink, e[4], 100, 100);
    expect(Math.min(...pts)).toBeGreaterThan(-28);
    expect(Math.max(...pts)).toBeLessThan(128);
  });
});

describe('吸附與鎖定', () => {
  const L = makeLayout(4, 3);
  const fresh = (): PieceState[] => Array.from({ length: 12 }, (_, i) => ({ x: 1000 + i * 300, y: 1000, group: i, locked: false }));

  it('相鄰拼片靠近時合併成組並對齊', () => {
    const p = fresh();
    p[1].x = p[0].x + L.pw + 5;
    p[1].y = p[0].y - 4;
    const r = dropGroup(p, L, 1);
    expect(r.merged).toBe(true);
    expect(p[0].group).toBe(p[1].group);
    expect(p[1].x - p[0].x).toBeCloseTo(L.pw);
    expect(p[1].y - p[0].y).toBeCloseTo(0);
  });

  it('不相鄰（非正確鄰居）的拼片不會合併', () => {
    const p = fresh();
    p[2].x = p[0].x + L.pw;
    p[2].y = p[0].y;
    expect(dropGroup(p, L, 2).merged).toBe(false);
  });

  it('接近正確位置時鎖定，與鎖定拼片吸附的組也會鎖定', () => {
    const p = fresh();
    const c0 = correctPos(L, 0);
    p[0].x = c0.x + 6;
    p[0].y = c0.y - 6;
    expect(dropGroup(p, L, 0).locked).toBe(true);
    expect(p[0].x).toBe(c0.x);
    p[1].x = p[0].x + L.pw + 3;
    p[1].y = p[0].y + 3;
    const r = dropGroup(p, L, 1);
    expect(r.locked).toBe(true);
    expect(p[1].locked).toBe(true);
    expect(p[1].x).toBeCloseTo(correctPos(L, 1).x);
  });

  it('全部鎖定即完成', () => {
    const p = fresh();
    p.forEach((q, i) => {
      const c = correctPos(L, i);
      q.x = c.x;
      q.y = c.y;
    });
    for (let i = 0; i < p.length; i++) dropGroup(p, L, p[i].group);
    expect(isComplete(p)).toBe(true);
  });

  it('散放：只移動指定的拼片，相同種子結果相同', () => {
    const L = makeLayout(4, 3);
    const fresh = (): PieceState[] => Array.from({ length: 12 }, (_, i) => ({ x: 0, y: 0, group: i, locked: false }));
    const pieces = fresh();
    const targets = [0, 1, 2, 3, 4, 5, 6, 7];
    arrangeAround(pieces, L, targets, 123);
    for (const i of [8, 9, 10, 11]) expect(pieces[i]).toMatchObject({ x: 0, y: 0 });
    for (const i of targets) expect(pieces[i].x !== 0 || pieces[i].y !== 0).toBe(true);
    const again = fresh();
    arrangeAround(again, L, targets, 123);
    expect(again).toEqual(pieces);
  });

  it('新局所有拼片都在拼盤外', () => {
    const big = makeLayout(28, 21);
    const pieces = newPieces(big, 3);
    for (const q of pieces) {
      const inside = q.x + big.pw > 0 && q.x < big.boardW && q.y + big.ph > 0 && q.y < big.boardH;
      expect(inside).toBe(false);
    }
  });
});

describe('托盤', () => {
  const L = makeLayout(4, 3);
  const fresh = () => newPieces(L, 7);
  const inTray = (p: PieceState[]) => p.map((q, i) => (q.tray ? i : -1)).filter((i) => i >= 0);

  it('初始順序是種子決定的隨機排列，不是依拼片位置或索引排序', () => {
    const a = shuffledOrder(12, 7);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(shuffledOrder(12, 7)).toEqual(a);
    expect(shuffledOrder(12, 8)).not.toEqual(a);
    expect(a).not.toEqual([...a].sort((x, y) => x - y));
  });

  it('放進托盤接在最後；已在托盤、已鎖定或已合併的拼片放不進去', () => {
    const p = fresh();
    const order: number[] = [];
    expect(enterTray(p, order, 3)).toBe(true);
    expect(enterTray(p, order, 5)).toBe(true);
    expect(order).toEqual([3, 5]);
    expect(p[3].tray).toBe(true);
    expect(enterTray(p, order, 3)).toBe(false);
    p[1].locked = true;
    expect(enterTray(p, order, 1)).toBe(false);
    p[7].group = p[8].group = 7; // 7、8 相連
    expect(enterTray(p, order, 7)).toBe(false);
    expect(order).toEqual([3, 5]);
  });

  it('拿出托盤：從順序移除、放到指定位置；其餘拼片順序不變', () => {
    const p = fresh();
    const order = [4, 2, 9];
    for (const i of order) p[i].tray = true;
    expect(leaveTray(p, order, 2, 10, 20)).toBe(true);
    expect(order).toEqual([4, 9]);
    expect(p[2]).toMatchObject({ x: 10, y: 20, tray: false });
    expect(leaveTray(p, order, 2, 0, 0)).toBe(false);
  });

  it('收回散片：只收未鎖定的單片，整個托盤重新洗牌且不重複', () => {
    const p = fresh();
    p[0].locked = true;
    p[5].group = p[6].group = 5;
    const order = [9];
    p[9].tray = true;
    gatherToTray(p, order, 11);
    expect(new Set(order).size).toBe(order.length);
    expect(order).toHaveLength(12 - 1 - 2);
    expect(order).not.toContain(0);
    expect(order).not.toContain(5);
    expect(order).not.toContain(6);
    expect(looseSingles(p)).toEqual([]);
    expect(inTray(p).sort((a, b) => a - b)).toEqual([...order].sort((a, b) => a - b));
  });

  it('托盤內的拼片不會被拖到旁邊的拼片吸附，也不計入桌面範圍', () => {
    const p = fresh();
    const c0 = correctPos(L, 0);
    p[0].x = c0.x + 400;
    p[0].y = c0.y + 400;
    p[1].tray = true;
    p[1].x = p[0].x + L.pw; // 剛好在 0 的正確右鄰位置
    p[1].y = p[0].y;
    expect(dropGroup(p, L, 0).merged).toBe(false);
    expect(p[1].group).toBe(1);
    const all = p.map((q) => ({ ...q, tray: true }));
    expect(tableBounds(all, L)).toEqual({ minX: 0, minY: 0, maxX: L.boardW, maxY: L.boardH });
  });

  it('整理來源不可信的托盤順序', () => {
    const p = fresh();
    p[2].locked = true;
    p[4].group = p[5].group = 4;
    expect(sanitizeTray([3, 3, 99, -1, 2, 4, 1.5, 'x', 6], p)).toEqual([3, 6]);
    expect(sanitizeTray(undefined, p)).toEqual([]);
    expect(sanitizeTray('abc', p)).toEqual([]);
  });

  it('存檔用的後備座標：托盤內的拼片被放到桌面外圍，原資料不被改動', () => {
    const p = fresh();
    const order = [0, 1, 2];
    for (const i of order) Object.assign(p[i], { tray: true, x: 0, y: 0 });
    const out = withTrayFallback(p, L, order, 5);
    for (const i of order) {
      const q = out[i];
      const inside = q.x + L.pw > 0 && q.x < L.boardW && q.y + L.ph > 0 && q.y < L.boardH;
      expect(inside).toBe(false);
      expect(p[i]).toMatchObject({ x: 0, y: 0 });
    }
  });

  it('托盤格子：排列、命中與空白處', () => {
    const g = trayGeometry(L, 300, 7);
    expect(g.cols).toBe(3);
    expect(g.contentH).toBeCloseTo(3 * g.cellH + 2 * g.gap);
    expect(trayCellAt(g, 7, 1, 1)).toBe(0);
    expect(trayCellAt(g, 7, g.cellW + g.gap + 1, 1)).toBe(1);
    expect(trayCellAt(g, 7, 1, g.cellH + g.gap + 1)).toBe(3);
    expect(trayCellAt(g, 7, g.cellW + 1, 1)).toBe(-1); // 格子間的縫隙
    expect(trayCellAt(g, 7, g.cellW * 2 + g.gap * 2 + 1, 2 * (g.cellH + g.gap) + 1)).toBe(-1); // 第 7 格之後沒有拼片
    expect(trayCellAt(g, 7, -1, 5)).toBe(-1);
    expect(trayGeometry(L, 150, 4).cols).toBe(2);
    expect(trayGeometry(L, 150, 0).contentH).toBe(0);
  });

  describe('存檔', () => {
    const base = (n: number) => ({
      imageId: 'a',
      difficultyId: 'b',
      seed: 1,
      elapsedMs: 0,
      pieces: Array.from({ length: n }, (_, i) => [0, 0, i, 0]),
      updatedAt: 0,
    });

    it('舊存檔沒有 tray 欄位也能讀；有的話保留整數索引', () => {
      expect(toProgress(base(4))!.tray).toBeUndefined();
      expect(toProgress({ ...base(4), tray: [2, 0, 1.5, 'x'] })!.tray).toEqual([2, 0]);
      expect(toProgress({ ...base(4), tray: 'oops' })!.tray).toBeUndefined();
    });
  });
});
