/**
 * 打鍵対象になる文字クラスの単一定義。
 *
 * このゲームで「タイプして消せる文字」= 数字(半角/全角)・英字(半角/全角)・
 * ひらがな・カタカナ(長音符ー含む)・々〆・漢字・波ダッシュ(～〜)。
 *
 * 従来 chart-game.ts / parse-chart.ts / GameOverlay.svelte に同一の正規表現が
 * コピペされていたため、ここに集約する。
 *
 * ⚠️ TYPEABLE_CHARS は「正規表現の文字クラス [...] の中身」として使う前提の断片。
 *    文字を追加するときは、文字クラス内で特別な意味を持つ `-` `]` `^` `\` を
 *    そのまま入れないこと（範囲指定やクラス終端と誤解釈され壊れる）。
 *    追加する場合はエスケープするか、範囲(例 ぁ-ん)の形で書くこと。
 */
export const TYPEABLE_CHARS = "0-9０-９a-zA-Zａ-ｚＡ-Ｚぁ-んァ-ヶー々〆一-鿿～〜";

// ホットパス（入力ごと checkInput/handleInput、文字単位の GameOverlay レンダー）から
// 呼ばれるため、RegExp は毎回生成せずモジュール内でキャッシュする。
// - TYPEABLE_RE は non-global。.test() で使い回しても lastIndex が進まず安全。
// - UNTYPEABLE_RE は global。.replace() でのみ使う想定で、.replace は毎回 lastIndex を
//   リセットするため共有しても安全（.test() で使うと lastIndex が進み壊れるので使わない）。
const TYPEABLE_RE = new RegExp(`[${TYPEABLE_CHARS}]`);
const UNTYPEABLE_RE = new RegExp(`[^${TYPEABLE_CHARS}]`, "g");

/** 文字列が1つでも打鍵可能文字を含むか */
export function hasTypeable(s: string): boolean {
  return TYPEABLE_RE.test(s);
}

/** 打鍵不能な文字をすべて除去する */
export function stripUntypeable(s: string): string {
  return s.replace(UNTYPEABLE_RE, "");
}

/**
 * かな文字クラス（ひらがな・カタカナ・長音符ー）。
 *
 * 「この文字はかなか」「かな以外を除去」といった判定で repl-parser / timetag-parser /
 * optimize が同じ集合を使っていたため共有する。
 * ※ ァ-ヶ は U+30A1..U+30F6 で ヴヵヶ も含む。ー(U+30FC)はその外なので別途追加している。
 * ※ difficulty.ts の「ひらがな/カタカナ分類」はバケツ分け用途で意図的に ぁ-ん 等へ絞っており、
 *    こちらの共有集合とは別物（統合しないこと）。
 */
export const KANA_CHARS = "ぁ-んァ-ヶー";

const KANA_RE = new RegExp(`[${KANA_CHARS}]`); // 非g。.test で共有安全
const NON_KANA_RE = new RegExp(`[^${KANA_CHARS}]`, "g"); // g。.replace 専用

/** 文字列がかなを含むか（1文字に使えば「その文字がかなか」の判定） */
export function isKana(s: string): boolean {
  return KANA_RE.test(s);
}

/** かな以外の文字をすべて除去する */
export function stripNonKana(s: string): string {
  return s.replace(NON_KANA_RE, "");
}
