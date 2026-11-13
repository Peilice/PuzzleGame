// 刻意不載入 fake-indexeddb：模擬 IndexedDB 無法使用的環境（例如部分無痕模式）。
import { describe, expect, it } from 'vitest';
import { allProgress, deleteProgress, isPersistent, loadProgress, loadSave, writeProgress, writeSave } from '../src/core/storage';

describe('IndexedDB 無法使用', () => {
  it('改以記憶體暫存，讀寫照常運作', async () => {
    const r = await loadSave();
    expect(r.issue).toBe('unavailable');
    expect(isPersistent()).toBe(false);

    r.save.totalPlayMs = 42;
    await writeSave(r.save);
    const p = { imageId: 'art-01', difficultyId: 'd150', seed: 1, elapsedMs: 1, pieces: [[0, 0, 0, 0]] as [number, number, number, number][], updatedAt: 1 };
    await writeProgress(p);
    p.elapsedMs = 999; // 存入的是複本，之後修改不影響已存資料
    expect((await loadProgress('art-01', 'd150'))?.elapsedMs).toBe(1);
    expect(await allProgress()).toHaveLength(1);
    await deleteProgress('art-01', 'd150');
    expect(await allProgress()).toHaveLength(0);
  });
});
