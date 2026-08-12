// 言語タグ (英語 / 英語&日本語) の判定 (pure)
//
// 以前は Gemini が動画のタイトル/概要から歌唱言語を推定していたが、
// 「実際に打つ歌詞」と食い違うことがあるため LRC 本文の文字種比率で決める。
// 割合の基準は譜面一覧の英字ハイライト (routes/+page.svelte englishLevel) と揃えてある。
import { extractLrcPlainText } from "../repl/lrc-text";

/** コードが決めるタグ。手入力/AI 由来のタグとは別枠で付け直す */
export const LANGUAGE_TAGS = ["英語", "英語&日本語"];

// 文字種の分類は difficulty.ts の classifyChar と同じ集合
// (漢字/ひらがな/カタカナ をまとめて「日本語」として数える)
const JAPANESE_RE = /[一-鿿々〆ぁ-んァ-ヶー]/;
const ENGLISH_RE = /[a-zA-Zａ-ｚＡ-Ｚ]/;
const DIGIT_RE = /[0-9０-９]/;

/** ルビの読み (<rt>) を落として表示文字だけ残す。読みを数えると日本語に偏るため */
function stripRuby(text: string): string {
  return text
    .replace(/<rt>[\s\S]*?<\/rt>/gi, "")
    .replace(/<\/?ruby[^>]*>/gi, "");
}

/**
 * LRC 本文の文字種比率から言語タグを判定する。該当しなければ null。
 * - 英字が 9 割以上                    → 「英語」
 * - 英字 5 割以上 かつ 日本語 4 割以上 → 「英語&日本語」
 *
 * 母数は漢字/かな/英字/数字の合計 (記号・空白は数えない)。
 */
export function detectLanguageTag(lrcText: string): string | null {
  const text = extractLrcPlainText(stripRuby(lrcText));
  let english = 0;
  let japanese = 0;
  let total = 0;
  for (const ch of text) {
    if (JAPANESE_RE.test(ch)) {
      japanese++;
      total++;
    } else if (ENGLISH_RE.test(ch)) {
      english++;
      total++;
    } else if (DIGIT_RE.test(ch)) {
      // 数字はどちらの言語でもないが母数には含める
      total++;
    }
  }
  if (total === 0) return null;

  const en = english / total;
  const ja = japanese / total;
  if (en >= 0.9) return "英語";
  if (en >= 0.5 && ja >= 0.4) return "英語&日本語";
  return null;
}

/** タグの上限。schemas/chart.ts の `.max(10)` と揃える */
const MAX_TAGS = 10;

/**
 * タグ列の言語タグを `langTag` に揃えた配列を返す。
 * 既に揃っている場合は元の配列をそのまま返すので、
 * 呼び出し側は参照比較で「書き換えが必要か」を判定できる
 * (無意味な代入でタグの並びが変わったり未保存扱いになるのを避ける)。
 */
export function syncLanguageTag(
  tags: string[],
  langTag: string | null,
): string[] {
  const current = tags.filter((t) => LANGUAGE_TAGS.includes(t));
  if (current.length <= 1 && (current[0] ?? null) === langTag) return tags;

  const rest = tags.filter((t) => !LANGUAGE_TAGS.includes(t));
  if (!langTag) return rest;
  // 上限を超えるとサーバのバリデーションで投稿ごと弾かれるので、
  // 既に 10 件ある場合は末尾のタグを 1 つ落として言語タグを入れる
  return [...rest.slice(0, MAX_TAGS - 1), langTag];
}
