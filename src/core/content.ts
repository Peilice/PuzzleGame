// 遊戲內容定義：分類、難度、圖片。新增內容時只需修改這裡與 images.json。

export interface Category {
  id: string;
  name: string;
  /** 是否為最初的 5 類（「五感全開」只看這些） */
  original: boolean;
  /** 分類線 10 級稱號名稱，對應 CATEGORY_THRESHOLDS */
  titleNames: string[];
  /** 「全部完成」收藏家稱號名稱 */
  collectorName: string;
  /** 獨立入口：不出現在「選擇分類」列表，由主畫面另設按鈕進入（暫時與其他分類分開） */
  standalone?: boolean;
}

export interface Difficulty {
  id: string;
  /** 介面顯示的片數 */
  label: number;
  cols: number;
  rows: number;
  /** 難度線 5 級稱號名稱，對應 DIFFICULTY_THRESHOLDS */
  titleNames: string[];
  /** 速度線 銅 / 銀 / 金：門檻（分鐘）與名稱 */
  speed: { minutes: number; name: string }[];
}

export interface PuzzleImage {
  id: string;
  category: string;
  name: string;
  src: string;
  thumb: string;
  artist?: string;
  license?: string;
  sourceUrl?: string;
}

export interface Content {
  categories: Category[];
  difficulties: Difficulty[];
  images: PuzzleImage[];
}

export const pieceCount = (d: Difficulty) => d.cols * d.rows;

export const CATEGORIES: Category[] = [
  {
    id: 'landscape',
    name: '風景',
    original: true,
    titleNames: ['散步者', '郊遊客', '旅人', '背包客', '登山客', '探險家', '山海行者', '環球旅行家', '地平線守望者', '天地行者'],
    collectorName: '風景收藏家',
  },
  {
    id: 'food',
    name: '美食',
    original: true,
    titleNames: ['路邊攤常客', '小吃迷', '饕客', '美食部落客', '美食評論家', '主廚', '米其林主廚', '食神', '味覺之王', '美食傳說'],
    collectorName: '美食收藏家',
  },
  {
    id: 'architecture',
    name: '建築',
    original: true,
    titleNames: ['磚塊搬運工', '工地學徒', '泥作師傅', '監工', '建築師', '首席建築師', '城市規劃師', '地標締造者', '萬城之主', '建築傳說'],
    collectorName: '建築收藏家',
  },
  {
    id: 'art',
    name: '藝術',
    original: true,
    titleNames: ['藝廊訪客', '素描學徒', '美術系學生', '畫家', '策展人', '藝術評論家', '藝術鑑賞家', '宮廷畫師', '大師傳人', '不朽藝術家'],
    collectorName: '藝術收藏家',
  },
  {
    id: 'flower',
    name: '花卉',
    original: true,
    titleNames: ['賞花人', '澆水小幫手', '園丁', '花店店員', '花藝師', '植物學家', '花藝大師', '花園主人', '百花仙子', '花神'],
    collectorName: '花卉收藏家',
  },
  {
    id: 'shaped',
    name: '異型',
    original: false,
    standalone: true,
    titleNames: ['圖案初學者', '拼貼學徒', '剪紙達人', '花窗工匠', '織紋設計師', '拼花匠師', '萬花筒玩家', '幾何大師', '曼陀羅行者', '異形傳說'],
    collectorName: '異型收藏家',
  },
];

export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'd150',
    label: 150,
    cols: 14,
    rows: 11,
    titleNames: ['初出茅廬', '漸入佳境', '駕輕就熟', '爐火純青', '信手拈來'],
    speed: [
      { minutes: 15, name: '俐落' },
      { minutes: 10, name: '快手' },
      { minutes: 6, name: '神之手' },
    ],
  },
  {
    id: 'd250',
    label: 250,
    cols: 18,
    rows: 14,
    titleNames: ['小試牛刀', '穩紮穩打', '遊刃有餘', '得心應手', '揮灑自如'],
    speed: [
      { minutes: 25, name: '輕快' },
      { minutes: 18, name: '疾風' },
      { minutes: 12, name: '風馳電掣' },
    ],
  },
  {
    id: 'd400',
    label: 400,
    cols: 24,
    rows: 17,
    titleNames: ['挑戰者', '耐心磨練', '越戰越勇', '百折不撓', '鍥而不捨'],
    speed: [
      { minutes: 45, name: '迅捷' },
      { minutes: 30, name: '迅雷' },
      { minutes: 20, name: '雷霆萬鈞' },
    ],
  },
  {
    id: 'd600',
    label: 600,
    cols: 28,
    rows: 21,
    titleNames: ['千片不懼', '堅持到底', '毅力過人', '鋼鐵意志', '拼圖苦行僧'],
    speed: [
      { minutes: 70, name: '急速' },
      { minutes: 50, name: '閃電拼圖師' },
      { minutes: 35, name: '光速傳說' },
    ],
  },
];
