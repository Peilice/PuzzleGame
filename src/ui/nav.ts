// 畫面之間的導覽。各畫面只依賴這個介面，實作由 app.ts 填入，避免畫面模組互相 import。
import type { Difficulty, PuzzleImage } from '../core/content';

export interface Nav {
  home(): void;
  categories(): void;
  /** 異型拼圖：獨立於分類列表的入口 */
  shaped(): void;
  images(categoryId: string): void;
  game(img: PuzzleImage, diff: Difficulty): void;
  titles(): void;
  stats(): void;
  settings(): void;
}

export const nav = {} as Nav;
