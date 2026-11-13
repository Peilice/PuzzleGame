import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from '../src/core/content';
import images from '../src/content/images.json';

// 守門：避免把測試圖或缺檔的圖庫發佈出去
describe('圖庫 images.json', () => {
  it('每個分類剛好 10 張', () => {
    for (const c of CATEGORIES) expect(images.filter((i) => i.category === c.id), c.id).toHaveLength(10);
  });
  it('id 不重複、名稱不是測試圖、皆有授權資訊', () => {
    expect(new Set(images.map((i) => i.id)).size).toBe(images.length);
    for (const i of images) {
      expect(i.name).not.toMatch(/測試/);
      expect(i.license).toMatch(/public domain|cc0|pd/i);
      expect(i.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });
  it('圖檔與縮圖都存在', () => {
    for (const i of images) {
      expect(fs.existsSync(path.join('public', i.src)), i.src).toBe(true);
      expect(fs.existsSync(path.join('public', i.thumb)), i.thumb).toBe(true);
    }
  });
});
