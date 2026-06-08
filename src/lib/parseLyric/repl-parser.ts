/**
 * REPL パーサー
 *
 * repl.txt を読み込み、LRC テキストに対して読み注釈を付ける。
 *
 * ── repl.txt フォーマット ──
 *
 * 基本: key,reading
 *   パイプなし → キー全体が1読みグループ（当て字・熟字訓向け）
 *   パイプあり → 明示的に文字ごとの読みを指定（インクリメンタルマッチング）
 *
 * グループ化（パイプパート末尾に付与）:
 *   +   → 次の1文字もまとめる
 *   +N  → 次のN文字もまとめる
 *   +*  → 残り全文字をまとめる
 *
 * エスケープ:
 *   \| → リテラル |
 *   \+ → リテラル +
 *   \\ → リテラル \
 *
 * 例:
 *   世界,せ|かい              → 世=せ, 界=かい（パイプ分割）
 *   食べる,た|べ|る           → 食=た, べ=自身, る=自身（仮名もパイプ）
 *   今日,きょう               → 今日全体=きょう（パイプなし=全体読み）
 *   留守番,るす+|ばん         → 留守=るす, 番=ばん（+でグループ化）
 *   語り継がれる創造神,カミサマ → 全体=カミサマ（当て字）
 *
 * 注釈の制御文字:
 *   \x01 (SOH) = 読み開始マーカー
 *   \x02 (STX) = 読み終了マーカー
 *   例: 世\x01せ\x02界\x01かい\x02
 *
 * readings 配列の値:
 *   string  → その文字の読み（"" = 熟字訓後続でcheckCount=0）
 *   null    → 仮名文字なので注釈不要（デフォルト処理）
 */

export const R_START = "\x01";
export const R_END = "\x02";
export const R_SPAN = "\x06";

// ============================================================
// 内部型
// ============================================================

type ReplEntry = {
  key: string;
  readings: (string | null)[];
  regex: RegExp;
  replacement: string;
};

// エスケープ用一時マーカー（制御文字領域）
const ESC_BACKSLASH = "\x03";
const ESC_PIPE = "\x04";
const ESC_PLUS = "\x05";

// ============================================================
// ReplParser
// ============================================================

export class ReplParser {

  // --- ユーティリティ ---

  private static kataToHira(str: string): string {
    return str.replace(/[\u30a1-\u30f6]/g, (m) =>
      String.fromCharCode(m.charCodeAt(0) - 0x60),
    );
  }

  private static isKana(ch: string): boolean {
    return /^[ぁ-んァ-ヶー]$/.test(ch);
  }

  private static escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // --- エスケープ処理 ---

  /** repl 読みのエスケープシーケンスを一時マーカーに退避 */
  private static escapeMarkers(reading: string): string {
    return reading
      .replace(/\\\\/g, ESC_BACKSLASH)
      .replace(/\\\|/g, ESC_PIPE)
      .replace(/\\\+/g, ESC_PLUS);
  }

  /** 一時マーカーを実文字に復元 */
  private static unescapeMarkers(s: string): string {
    return s
      .replace(/\x03/g, "\\")
      .replace(/\x04/g, "|")
      .replace(/\x05/g, "+");
  }

  // --- + サフィックス解析 ---

  /**
   * パート末尾の +/+N/+* を解析し [読み文字列, 追加文字数] を返す
   */
  private static parsePlusSuffix(part: string, remainingChars: number): [string, number] {
    // +* → 残り全文字
    if (part.endsWith("+*")) {
      return [part.slice(0, -2), Math.max(0, remainingChars - 1)];
    }
    // +N → N文字追加
    const plusNMatch = part.match(/\+(\d+)$/);
    if (plusNMatch) {
      return [part.slice(0, -plusNMatch[0].length), parseInt(plusNMatch[1])];
    }
    // trailing + → 1文字ずつ追加
    let plusCount = 0;
    let cleaned = part;
    while (cleaned.endsWith("+")) {
      plusCount++;
      cleaned = cleaned.slice(0, -1);
    }
    return [cleaned, plusCount];
  }

  // --- 読み構築 ---

  /**
   * key と reading から readings 配列を構築する
   *
   * パイプなし: キー全体 = 1読みグループ（当て字・熟字訓）
   * パイプあり: 明示的な文字ごと分割
   */
  private static buildReadings(key: string, reading: string): (string | null)[] {
    const keyChars = [...key];
    const escaped = ReplParser.escapeMarkers(reading);

    if (!escaped.includes("|")) {
      return ReplParser.buildWholeReading(keyChars, escaped);
    }
    return ReplParser.buildPipedReadings(keyChars, escaped);
  }

  /** パイプなし: キー全体を1つの読みグループとして扱う */
  private static buildWholeReading(keyChars: string[], escaped: string): (string | null)[] {
    // 末尾の +/+N/+* は全体読みでは冗長なので除去
    const [cleaned] = ReplParser.parsePlusSuffix(escaped, keyChars.length);
    const actualReading = ReplParser.unescapeMarkers(cleaned);

    // 1文字キー + 仮名一致 → 注釈不要
    if (keyChars.length === 1 && ReplParser.isKana(keyChars[0]) &&
        ReplParser.kataToHira(keyChars[0]) === ReplParser.kataToHira(actualReading)) {
      return [null];
    }

    // 先頭に読み、残りは "" (熟字訓後続)
    const readings: (string | null)[] = [actualReading];
    for (let i = 1; i < keyChars.length; i++) {
      readings.push("");
    }
    return readings;
  }

  /** パイプあり: 各パートを解析して文字ごとの readings を構築 */
  private static buildPipedReadings(keyChars: string[], escaped: string): (string | null)[] {
    const parts = escaped.split("|");
    const readings: (string | null)[] = [];
    let charIdx = 0;

    for (const part of parts) {
      if (charIdx >= keyChars.length) break;

      const remainingChars = keyChars.length - charIdx;
      const [cleanedPart, plusCount] = ReplParser.parsePlusSuffix(part, remainingChars);
      const readingStr = ReplParser.unescapeMarkers(cleanedPart);
      const groupSize = Math.min(1 + plusCount, remainingChars);

      // 空パート or 1文字仮名一致 → null（注釈不要）
      if (readingStr === "" ||
          (groupSize === 1 && ReplParser.isKana(keyChars[charIdx]) &&
           ReplParser.kataToHira(keyChars[charIdx]) === ReplParser.kataToHira(readingStr))) {
        readings.push(null);
      } else {
        readings.push(readingStr);
      }

      // グループ後続文字は "" (熟字訓マーカー)
      for (let j = 1; j < groupSize; j++) {
        readings.push("");
      }

      charIdx += groupSize;
    }

    // パーツ不足時: 残りの文字を未指定として処理
    while (readings.length < keyChars.length) {
      const ch = keyChars[readings.length];
      readings.push(ReplParser.isKana(ch) ? null : "");
    }

    return readings;
  }

  private static buildRubySpans(
    key: string,
    reading: string,
    readings: (string | null)[],
  ): (number | undefined)[] {
    const keyChars = [...key];
    const escaped = ReplParser.escapeMarkers(reading);
    const spans: (number | undefined)[] = Array(keyChars.length).fill(undefined);

    if (!escaped.includes("|")) {
      if (keyChars.length > 1 && readings[0] !== null) spans[0] = keyChars.length;
      return spans;
    }

    const parts = escaped.split("|");
    let charIdx = 0;
    for (const part of parts) {
      if (charIdx >= keyChars.length) break;

      const remainingChars = keyChars.length - charIdx;
      const [cleanedPart, plusCount] = ReplParser.parsePlusSuffix(part, remainingChars);
      const readingStr = ReplParser.unescapeMarkers(cleanedPart);
      const groupSize = Math.min(1 + plusCount, remainingChars);
      const hasReading =
        readingStr !== "" &&
        !(
          groupSize === 1 &&
          ReplParser.isKana(keyChars[charIdx]) &&
          ReplParser.kataToHira(keyChars[charIdx]) === ReplParser.kataToHira(readingStr)
        );

      if (hasReading && groupSize > 1) spans[charIdx] = groupSize;
      charIdx += groupSize;
    }

    return spans;
  }

  // --- ReplEntry 構築 ---

  private static buildReplEntry(
    key: string,
    readings: (string | null)[],
    spans: (number | undefined)[] = [],
  ): ReplEntry {
    const TIME_TAG_PATTERN = "(?:\\[\\d{2}:\\d{2}:\\d{2}\\])*";
    const keyChars = [...key];
    let pattern = "";
    let replacement = "";
    let group = 1;

    for (let i = 0; i < keyChars.length; i++) {
      pattern += `(${ReplParser.escapeRegExp(keyChars[i])})(?!${ReplParser.escapeRegExp(R_START)})`;
      if (readings[i] !== null) {
        const spanPrefix =
          spans[i] != null && spans[i]! > 1
            ? `${R_SPAN}${spans[i]}:`
            : "";
        replacement += `$${group}${R_START}${spanPrefix}${readings[i]}${R_END}`;
      } else {
        replacement += `$${group}`;
      }
      group++;
      if (i < keyChars.length - 1) {
        pattern += `(${TIME_TAG_PATTERN})`;
        replacement += `$${group}`;
        group++;
      }
    }

    return { key, readings, regex: new RegExp(pattern, "g"), replacement };
  }

  private static parseReplEntries(replTxt: string): ReplEntry[] {
    const entries: ReplEntry[] = [];
    for (const line of replTxt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const commaIdx = trimmed.indexOf(",");
      if (commaIdx < 0) continue;
      const key = trimmed.slice(0, commaIdx);
      const value = trimmed.slice(commaIdx + 1);
      if (!key || !value) continue;
      const readings = ReplParser.buildReadings(key, value);
      const spans = ReplParser.buildRubySpans(key, value, readings);
      entries.push(ReplParser.buildReplEntry(key, readings, spans));
    }
    entries.sort((a, b) => [...b.key].length - [...a.key].length);
    return entries;
  }

  // --- HTML <ruby> 構築 ---

  private static buildRubyHtml(key: string, readings: (string | null)[]): string {
    const keyChars = [...key];
    let html = "";
    let i = 0;
    while (i < keyChars.length) {
      const r = readings[i];
      if (r === null) {
        html += keyChars[i];
        i++;
      } else if (r !== "") {
        // 熟字訓グループ: 後続の "" 読みの文字をまとめて一つのrubyに
        let chars = keyChars[i];
        let j = i + 1;
        while (j < keyChars.length && readings[j] === "") {
          chars += keyChars[j];
          j++;
        }
        html += `<ruby>${chars}<rt>${r}</rt></ruby>`;
        i = j;
      } else {
        // "" が先頭に来た場合（想定外）はプレーンテキストとして出力
        html += keyChars[i];
        i++;
      }
    }
    return html;
  }

  // ============================================================
  // 公開 API
  // ============================================================

  /**
   * ゲームプレイ用: [kanji, rubyHtml][]
   * parse-chart.ts の parseLyric() から使用する
   */
  static chart(replTxt: string): [string, string][] {
    const results: [string, string][] = [];
    for (const line of replTxt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const commaIdx = trimmed.indexOf(",");
      if (commaIdx < 0) continue;
      const key = trimmed.slice(0, commaIdx);
      const value = trimmed.slice(commaIdx + 1);
      if (!key || !value) continue;
      const readings = ReplParser.buildReadings(key, value);
      results.push([key, ReplParser.buildRubyHtml(key, readings)]);
    }
    return results.sort((a, b) => [...b[0]].length - [...a[0]].length);
  }

  /**
   * エディタ用: LRCテキストに \x01読み\x02 注釈を付与して返す
   * timetag-parser.ts から使用する
   */
  static edit(lrcText: string, replTxt: string): string {
    const entries = ReplParser.parseReplEntries(replTxt);
    let result = lrcText;
    for (const entry of entries) {
      result = result.replace(entry.regex, entry.replacement);
    }
    return result;
  }

  // ============================================================
  // マイグレーション: 旧フォーマット → 新パイプフォーマット
  // ============================================================

  /**
   * 旧フォーマットの repl テキストを新パイプフォーマットに自動変換する。
   * 旧 assignRuby ロジックでキー中の仮名をアンカーにして漢字ごとの読みを推測し、
   * パイプ区切りに変換する。
   *
   * - パイプ済みのエントリはそのまま維持
   * - 推測できないエントリ（当て字等）はそのまま維持（パイプなし=全体読み）
   */
  static migrate(replTxt: string): string {
    const kanaRegex = /[ぁ-んァ-ヶー]/;

    // --- 旧ロジック（マイグレーション専用） ---

    type Seg = { type: "kanji" | "kana"; text: string };

    const splitSegs = (kanji: string): Seg[] => {
      const segs: Seg[] = [];
      let cur = "";
      let curType: "kanji" | "kana" | null = null;
      for (const ch of kanji) {
        const t = kanaRegex.test(ch) ? "kana" : "kanji";
        if (t !== curType) {
          if (cur) segs.push({ type: curType!, text: cur });
          cur = ch;
          curType = t;
        } else {
          cur += ch;
        }
      }
      if (cur) segs.push({ type: curType!, text: cur });
      return segs;
    };

    const assignRuby = (segments: Seg[], kana: string): [string, string][] => {
      const reading = ReplParser.kataToHira(kana);
      const segHira = segments.map(s => ({
        ...s,
        hiraText: s.type === "kana" ? ReplParser.kataToHira(s.text) : s.text,
      }));

      let left = 0;
      let right = reading.length;
      for (let i = 0; i < segHira.length; i++) {
        if (segHira[i].type !== "kana") break;
        left += segHira[i].hiraText.length;
      }
      for (let i = segHira.length - 1; i >= 0; i--) {
        if (segHira[i].type !== "kana") break;
        right -= segHira[i].hiraText.length;
      }

      if (left > right) return [];
      const middleReading = reading.slice(left, right);
      const middleSegs = segHira.filter((s, idx) =>
        s.type === "kanji" || (s.type === "kana" && idx > 0 && idx < segHira.length - 1),
      );
      const kanjiSegs = middleSegs.filter(s => s.type === "kanji");
      if (kanjiSegs.length === 0) return [];
      if (kanjiSegs.length === 1) return [[kanjiSegs[0].text, middleReading]];

      const result: [string, string][] = [];
      let pos = 0;
      for (let i = 0; i < middleSegs.length; i++) {
        const seg = middleSegs[i];
        if (seg.type === "kana") {
          const hira = seg.hiraText;
          let bestPos = middleReading.indexOf(hira, pos + 1);
          if (bestPos === -1) {
            bestPos = middleReading.indexOf(hira, pos);
            if (bestPos === -1) bestPos = pos;
          }
          if (i > 0 && middleSegs[i - 1].type === "kanji") {
            result.push([middleSegs[i - 1].text, middleReading.slice(pos, bestPos)]);
          }
          pos = bestPos + hira.length;
        } else if (seg.type === "kanji" && i === middleSegs.length - 1) {
          result.push([seg.text, middleReading.slice(pos)]);
        }
      }
      return result;
    };

    // --- readings 配列 → パイプ文字列 ---

    const readingsToPipe = (keyChars: string[], readings: (string | null)[]): string => {
      const parts: string[] = [];
      let i = 0;
      while (i < keyChars.length) {
        const r = readings[i];
        if (r === null) {
          parts.push(keyChars[i]);
          i++;
        } else if (r !== "") {
          let groupExtra = 0;
          let j = i + 1;
          while (j < keyChars.length && readings[j] === "") {
            groupExtra++;
            j++;
          }
          parts.push(groupExtra === 0 ? r : r + "+".repeat(groupExtra));
          i = j;
        } else {
          parts.push(keyChars[i]);
          i++;
        }
      }
      return parts.join("|");
    };

    // --- 1エントリの変換 ---

    const convertEntry = (key: string, reading: string): string => {
      // 既にパイプあり → そのまま
      if (reading.includes("|")) return reading;

      const keyChars = [...key];

      // 全文字が仮名 → 変換不要
      if (keyChars.every(ch => ReplParser.isKana(ch))) return reading;

      // 1文字キー → パイプ不要
      if (keyChars.length === 1) return reading;

      // assignRuby で推測
      const segs = splitSegs(key);
      const pairs = assignRuby(segs, reading);

      if (pairs.length === 0) return reading; // 推測失敗→そのまま

      // 漢字グループに空読みがあれば推測失敗（仮名アンカー不一致）
      if (pairs.some(([, ruby]) => ruby === "")) return reading;

      // pairs をキー文字にマッピング（Set で割当済み位置を追跡）
      const charReadings: (string | null)[] = keyChars.map(ch =>
        ReplParser.isKana(ch) ? null : null,
      );
      const assigned = new Set<number>();

      // 仮名位置は割当済みとしてマーク
      keyChars.forEach((ch, i) => {
        if (ReplParser.isKana(ch)) assigned.add(i);
      });

      for (const [group, ruby] of pairs) {
        const groupChars = [...group];
        const keyStr = keyChars.join("");
        let searchFrom = 0;

        while (searchFrom <= keyStr.length - group.length) {
          const idx = keyStr.indexOf(group, searchFrom);
          if (idx === -1) break;

          // この位置のグループ全文字が未割当か確認
          let canAssign = true;
          for (let j = 0; j < groupChars.length; j++) {
            if (assigned.has(idx + j)) {
              canAssign = false;
              break;
            }
          }

          if (!canAssign) {
            searchFrom = idx + 1;
            continue;
          }

          // 割り当て
          charReadings[idx] = ruby;
          assigned.add(idx);
          for (let j = 1; j < groupChars.length; j++) {
            charReadings[idx + j] = "";
            assigned.add(idx + j);
          }
          break;
        }
      }

      // 未割当の非仮名文字があれば推測失敗
      const hasUnassigned = keyChars.some((ch, i) =>
        !ReplParser.isKana(ch) && !assigned.has(i),
      );
      if (hasUnassigned) return reading; // そのまま

      // パイプ文字列に変換
      const pipeResult = readingsToPipe(keyChars, charReadings);
      // パイプなし（1グループで全体読みと等価）ならそのまま
      if (!pipeResult.includes("|")) return reading;
      return pipeResult;
    };

    // --- 全行処理 ---

    return replTxt.split("\n").map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      const commaIdx = trimmed.indexOf(",");
      if (commaIdx < 0) return line;
      const key = trimmed.slice(0, commaIdx);
      const reading = trimmed.slice(commaIdx + 1);
      if (!key || !reading) return line;
      const converted = convertEntry(key, reading);
      return key + "," + converted;
    }).join("\n");
  }
}
