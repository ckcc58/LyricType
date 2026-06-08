/**
 * モーラパーサー
 * 日本語の読み文字列をモーラ単位に分割する
 * 拗音(きゃ等)は1モーラ、促音(っ)は前のモーラに結合
 */

// 小書き仮名（拗音構成要素）— っ は含まない（促音は前モーラに結合する特別扱い）
const SMALL_KANA = /^[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]$/;
const SOKUON = /^[っッ]$/;

export class MoraParser {
  /**
   * 読み文字列をモーラ配列に分割する
   * 拗音は前の文字と結合して1モーラ
   * 促音は前のモーラに結合（先頭の場合は単独モーラ）
   *
   * @example
   * parse("きゃっと") → ["きゃっ", "と"]
   * parse("さった")   → ["さっ", "た"]
   * parse("はる")     → ["は", "る"]
   * parse("しょうがっこう") → ["しょ", "う", "がっ", "こ", "う"]
   */
  static parse(reading: string): string[] {
    const moras: string[] = [];
    const chars = [...reading]; // Unicode-safe split

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];

      if (SMALL_KANA.test(ch) && moras.length > 0) {
        // 拗音: 前のモーラに結合
        moras[moras.length - 1] += ch;
      } else if (SOKUON.test(ch) && moras.length > 0) {
        // 促音: 前のモーラに結合
        moras[moras.length - 1] += ch;
      } else {
        // 通常文字: 新しいモーラ開始
        moras.push(ch);
      }
    }

    return moras;
  }

  /**
   * 読みのモーラ数を返す
   */
  static count(reading: string): number {
    return MoraParser.parse(reading).length;
  }
}
