import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from '../src/core/content';
import images from '../src/content/images.json';

// 守門：避免把測試圖或缺檔的圖庫發佈出去
describe('圖庫 images.json', () => {
  // 「造型」為程式生成，暫時只有 9 張（之後補到 10 張時，把這裡的例外拿掉）
  const EXPECTED: Record<string, number> = { shaped: 9 };
  it('每個分類的張數符合預期（預設 10 張）', () => {
    for (const c of CATEGORIES) expect(images.filter((i) => i.category === c.id), c.id).toHaveLength(EXPECTED[c.id] ?? 10);
  });
  it('id 不重複、名稱不是測試圖、皆有授權資訊', () => {
    expect(new Set(images.map((i) => i.id)).size).toBe(images.length);
    for (const i of images) {
      expect(i.name).not.toMatch(/測試/);
      expect(i.license).toMatch(/public domain|cc0|pd/i);
      // 程式生成的圖沒有外部來源；其餘都要有 Commons 出處
      if (i.artist === '程式生成') expect(i.sourceUrl, i.id).toBeUndefined();
      else expect(i.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });
  it('圖檔與縮圖都存在', () => {
    for (const i of images) {
      expect(fs.existsSync(path.join('public', i.src)), i.src).toBe(true);
      expect(fs.existsSync(path.join('public', i.thumb)), i.thumb).toBe(true);
    }
  });
});
