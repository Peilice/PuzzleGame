import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, createSave, recordCompletion } from '../src/core/save';
import { allProgress, exportAll, importAll, loadProgress, loadSave, toProgress, writeProgress, writeSave } from '../src/core/storage';

/** 直接寫入 IndexedDB，模擬裝置上既有的（可能壞掉或較新的）存檔 */
function putRaw(key: string, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('puzzle-game', 1);
    req.onsuccess = () => {
      const t = req.result.transaction('kv', 'readwrite');
      t.objectStore('kv').put(value, key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}

function getRaw(key: string) {
  return new Promise<unknown>((resolve, reject) => {
    const req = indexedDB.open('puzzle-game', 1);
    req.onsuccess = () => {
      const r = req.result.transaction('kv', 'readonly').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('IndexedDB 存檔', () => {
  it('匯出後再匯入，存檔與進度完整還原', async () => {
    let save = createSave();
    save = recordCompletion(save, { imageId: 'food-01', difficultyId: 'd150', pieces: 154, timeMs: 123456, at: 1, assistsUsed: [] }).save;
    save.profile.equippedTitle = 'cat-food-1';
    await writeSave(save);
    await writeProgress({ imageId: 'art-01', difficultyId: 'd600', seed: 9, elapsedMs: 5000, pieces: [[1, 2, 0, 0]], updatedAt: 1 });
    const text = JSON.stringify(await exportAll(save));

    await writeSave(createSave());
    await writeProgress({ imageId: 'x', difficultyId: 'd150', seed: 1, elapsedMs: 1, pieces: [], updatedAt: 1 });

    const restored = await importAll(text);
    expect(restored.best['food-01|d150']).toBe(123456);
    const loaded = await loadSave();
    expect(loaded.issue).toBeNull();
    expect(loaded.save.profile.equippedTitle).toBe('cat-food-1');
    expect((await loadProgress('art-01', 'd600'))?.elapsedMs).toBe(5000);
    expect(await loadProgress('x', 'd150')).toBeUndefined();
  });

  it('拒絕非本遊戲的檔案，且原資料不變', async () => {
    const before = createSave();
    before.totalPlayMs = 777;
    await writeSave(before);
    await expect(importAll('not json')).rejects.toMatchObject({ code: 'not-json' });
    await expect(importAll(JSON.stringify({ hello: 1 }))).rejects.toMatchObject({ code: 'not-ours' });
    await expect(importAll(JSON.stringify({ app: 'puzzle-game', save: { version: 99 } }))).rejects.toMatchObject({ code: 'newer' });
    expect((await loadSave()).save.totalPlayMs).toBe(777);
  });

  it('匯入時略過格式不對的進度', async () => {
    const good = { imageId: 'art-02', difficultyId: 'd150', seed: 3, elapsedMs: 10, pieces: [[0, 0, 0, 1], [5, 5, 1, 0]], updatedAt: 2 };
    const bad = [
      { ...good, imageId: 'bad-1', pieces: [[0, 0, 0]] }, // 欄位數不對
      { ...good, imageId: 'bad-2', pieces: [['x', 0, 0, 0]] }, // 座標不是數字
      { ...good, imageId: 'bad-3', pieces: [[0, 0, 9, 0]] }, // 組別超出範圍
      { ...good, imageId: 'bad-4', elapsedMs: null },
      null,
    ];
    await importAll(JSON.stringify({ app: 'puzzle-game', save: createSave(), progress: [good, ...bad] }));
    expect((await allProgress()).map((p) => p.imageId)).toEqual(['art-02']);
    expect(toProgress(good)).not.toBeNull();
  });

  it('無法辨識的存檔：備份原資料後改用新存檔', async () => {
    const junk = { hello: 'world' };
    await putRaw('save', junk);
    const r = await loadSave();
    expect(r.issue).toBe('corrupt');
    expect(r.save.completions).toEqual([]);
    expect(await getRaw('save-corrupt')).toEqual(junk);
  });

  // 放在最後：之後這個測試檔的儲存層會停留在記憶體模式
  it('版本較新的存檔不會被覆蓋，本次改用記憶體暫存', async () => {
    const newer = { version: SAVE_VERSION + 1, future: true };
    await putRaw('save', newer);
    const r = await loadSave();
    expect(r.issue).toBe('newer');
    await writeSave(r.save);
    await writeProgress({ imageId: 'art-01', difficultyId: 'd150', seed: 1, elapsedMs: 1, pieces: [[0, 0, 0, 0]], updatedAt: 1 });
    expect(await getRaw('save')).toEqual(newer);
    expect((await loadProgress('art-01', 'd150'))?.seed).toBe(1);
  });
});
