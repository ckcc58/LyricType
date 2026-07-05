// アプリ全体のフォント選択肢。
// 収録基準: 日本語（常用漢字を含む）と英数字をカバーし、本文として可読なもの。
// 装飾・ドット・極太ディスプレイ系（漢字欠けや可読性の問題）は入れない。

export type FontOption = {
  /** 設定に保存する ID。web フォントは CSS の family 名そのもの */
  id: string;
  /** 設定 UI に出す表示名 */
  label: string;
  /** font-family に流し込むスタック */
  stack: string;
};

const JP = '"Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif';

export const DEFAULT_FONT_ID = 'M PLUS 1';

export const FONT_OPTIONS: FontOption[] = [
  { id: 'M PLUS 1', label: 'M PLUS 1', stack: `"M PLUS 1", ${JP}` },
  { id: 'Noto Sans JP', label: 'Noto Sans JP', stack: `"Noto Sans JP", ${JP}` },
];

export function isValidFontId(id: unknown): id is string {
  return typeof id === 'string' && FONT_OPTIONS.some((f) => f.id === id);
}

export function fontStack(id: string): string {
  const found = FONT_OPTIONS.find((f) => f.id === id);
  if (found) return found.stack;
  return FONT_OPTIONS.find((f) => f.id === DEFAULT_FONT_ID)!.stack;
}

// Google Fonts の読み込み URL（system 以外の web フォント）。
// display=swap: 未ロード中はフォールバックで即描画し、届いたら差し替え。
export const GOOGLE_FONTS_HREF =
  'https://fonts.googleapis.com/css2' +
  '?family=M+PLUS+1:wght@400..700' +
  '&family=Noto+Sans+JP:wght@400..700' +
  '&display=swap';
