/**
 * タイムタグエディタ用パーサー
 *
 * LRC テキストと REPL 辞書から、タイムタグエディタで使用する
 * 行ごと・文字ごとのチェック情報（TimeTagLine / TimeTagChar）を生成する。
 *
 * --- アーキテクチャ ---
 * 1. ReplParser.edit() で読み注釈付き LRC を取得
 * 2. 注釈付き LRC を行ごとにブロック分割（[タイムタグ + 次タイムタグまでの内容）
 * 3. 各ブロックの先頭文字がブロックのタイムタグを受け取る
 * 4. ブロック内の文字を char/ruby トークンから TimeTagChar[] に変換
 * 5. 後処理（小書き仮名結合、記号チェック借用、hideEndMark 等）
 */

import { timeTagToTime } from "./parse-chart";
import { ReplParser, R_START, R_END, R_SPAN } from "./repl-parser";
import { MoraParser, SMALL_KANA, SOKUON } from "./mora-parser";
import { stripNonKana } from "./char-class";

// ============================================================
// 型定義
// ============================================================

export type TimeTagChar = {
  char: string;
  reading: string;
  checkCount: number;
  times: (number | null)[];
  endTime: number | null;
  rubySpan?: number;
  blockTime?: number;  // checkCount=0 だが元LRCにタイムタグがあった文字の位置マーカー
  isEndCheck?: boolean;
  hideEndMark?: boolean;
};

export type TimeTagLine = {
  chars: TimeTagChar[];
  originalText: string;
};

// ============================================================
// ヘルパー関数
// ============================================================

/** この文字にチェック（タイムタグ打ち対象）を付けるべきか
 *  ※ char-class の共有集合とは別物（意図的）。長音符ー は単独でチェックを付けず
 *     前モーラに結合する設計のため、ここでは ー を含めない。
 *     （ヵヶ は ァ-ヶ に既に含まれるため冗長だが無害） */
function isCheckable(ch: string): boolean {
  return /^[ぁ-んァ-ヶ々〆ヵヶ一-鿿]$/.test(ch);
}

function isSpace(ch: string): boolean {
  return /^[\s　]$/.test(ch);
}

/** 日本語文字か（isCheckable と違い長音符ー も含む）。
 *  ※ char-class の共有集合とは別物（意図的）。ヵヶ は ァ-ヶ に含まれ冗長だが無害。 */
function isJapanese(c: string): boolean {
  return /[ぁ-んァ-ヶー々〆ヵヶ一-鿿]/.test(c);
}

// ============================================================
// ブロック分割: 注釈付きLRC行 → ブロック列
// ============================================================

type ContentToken =
  | { type: "char"; value: string }
  | { type: "ruby"; value: string };

type Block = {
  time: number | null;
  tokens: ContentToken[];
};

/**
 * 注釈付きLRC行をタイムタグ区切りのブロック列に分解する
 *
 * 入力例: [00:01:00]明\x01あした\x02[00:01:50]日\x01\x02は[00:02:00]
 *
 * 出力:
 *   {time:null, tokens:[]},
 *   {time:1.0, tokens:[char(明), ruby(あした)]},
 *   {time:1.5, tokens:[char(日), ruby(""), char(は)]},
 *   {time:2.0, tokens:[]}
 */
function splitIntoBlocks(annotatedLine: string): Block[] {
  const blocks: Block[] = [];
  let currentTime: number | null = null;
  let currentTokens: ContentToken[] = [];
  let i = 0;

  while (i < annotatedLine.length) {
    if (annotatedLine[i] === "[") {
      const match = annotatedLine.slice(i).match(/^\[(\d{2}:\d{2}:\d{2})\]/);
      if (match) {
        blocks.push({ time: currentTime, tokens: currentTokens });
        currentTime = timeTagToTime(match[1]);
        currentTokens = [];
        i += match[0].length;
        continue;
      }
    }

    if (annotatedLine[i] === R_START) {
      const endIdx = annotatedLine.indexOf(R_END, i + 1);
      if (endIdx >= 0) {
        currentTokens.push({ type: "ruby", value: annotatedLine.slice(i + 1, endIdx) });
        i = endIdx + 1;
        continue;
      }
    }

    currentTokens.push({ type: "char", value: annotatedLine[i] });
    i++;
  }

  blocks.push({ time: currentTime, tokens: currentTokens });
  return blocks;
}

// ============================================================
// メイン: buildTimeTagData
// ============================================================

/**
 * LRCテキストとREPLテキストから、タイムタグエディタ用のデータを生成する
 */
export function buildTimeTagData(
  lrcContent: string,
  chartReplContent: string,
): TimeTagLine[] {
  // Step 1: 注釈付きLRCを取得（chart replのみ使用）
  const annotated = ReplParser.edit(lrcContent, chartReplContent);

  const rawLines = annotated.split("\n");
  // ファイル末尾の \n に由来する末尾の空文字を除去 (round-trip でズレ続けるのを防ぐ)
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  const lines: TimeTagLine[] = [];

  for (const rawLine of rawLines) {
    // Step 2: ブロック分割
    const blocks = splitIntoBlocks(rawLine);

    const hasChar = blocks.some((b) => b.tokens.some((t) => t.type === "char"));
    if (!hasChar) {
      // 空行を保持 (LRC ↔ TimeTag の往復で改行が失われないため)
      lines.push({ chars: [], originalText: rawLine });
      continue;
    }

    // Step 3: ブロック列 → TimeTagChar[]
    const chars: TimeTagChar[] = [];
    let trailingTime: number | null = null;

    for (const block of blocks) {
      const hasContent = block.tokens.some((t) => t.type === "char");

      if (!hasContent) {
        // 空ブロック（連続タイムタグ）: 直前の文字の endTime に設定
        if (block.time !== null && chars.length > 0) {
          chars[chars.length - 1].endTime = block.time;
        }
        trailingTime = block.time;
        continue;
      }

      // コンテンツあり: trailingTimeはリセット
      trailingTime = null;

      let pendingTime: number | null = block.time;
      const tokens = block.tokens;

      for (let ti = 0; ti < tokens.length; ti++) {
        const token = tokens[ti];
        if (token.type === "ruby") continue;

        const ch = token.value;

        // 次のトークンが ruby かチェック
        let rubyReading: string | null = null;
        let rubySpan: number | undefined;
        if (ti + 1 < tokens.length && tokens[ti + 1].type === "ruby") {
          rubyReading = (tokens[ti + 1] as { type: "ruby"; value: string }).value;
          if (rubyReading.startsWith(R_SPAN)) {
            const match = rubyReading.slice(R_SPAN.length).match(/^(\d+):(.*)$/s);
            if (match) {
              rubySpan = Number(match[1]);
              rubyReading = match[2];
            }
          }
          ti++;
        }

        // 小書き仮名 → 前の文字に結合
        const isSmallKana = SMALL_KANA.test(ch);
        const isSokuon = SOKUON.test(ch);
        const isSpaceChar = isSpace(ch);

        if (isSmallKana && chars.length > 0 && !isSpaceChar) {
          const prev = chars[chars.length - 1];
          prev.char += ch;
          if (prev.reading) prev.reading += ch;
          continue;
        }

        // 読みとcheckCountの決定
        let reading = "";
        let checkCount = 0;
        const isAlpha = /^[a-zA-Zａ-ｚＡ-Ｚ0-9０-９'']$/.test(ch);

        if (isSpaceChar || isSokuon) {
          // スペース・促音
          checkCount = 0;
          reading = "";
        } else if (isAlpha) {
          // 英数字列:
          //   pendingTime あり（ブロック先頭）→ checkCount=1
          //   直前が alpha → checkCount=0（同一英単語の続き）
          //   直前が非JP記号でcheckCount>0（記号ブロック先頭の続き）→ checkCount=0
          const prevCharObj = chars.length > 0 ? chars[chars.length - 1] : null;
          const prevCharStr = prevCharObj ? prevCharObj.char.slice(-1) : "";
          const prevIsAlpha = /^[a-zA-Zａ-ｚＡ-Ｚ0-9０-９'']$/.test(prevCharStr);
          const prevIsSymbolGroupStarter =
            prevCharObj !== null &&
            prevCharObj.checkCount > 0 &&
            !isJapanese(prevCharStr) &&
            !prevIsAlpha;
          checkCount =
            (prevIsAlpha || prevIsSymbolGroupStarter) && pendingTime === null
              ? 0
              : 1;
          reading = ch;
        } else if (rubyReading !== null) {
          // REPL注釈あり
          if (rubyReading === "") {
            // 熟字訓の後続文字
            checkCount = 0;
            reading = "";
          } else {
            // 読みあり
            reading = rubyReading;
            const cleanReading = stripNonKana(rubyReading) || rubyReading;
            checkCount = MoraParser.count(cleanReading);
          }
        } else if (!isCheckable(ch)) {
          // 記号等: ブロック先頭（pendingTime あり）ならcheckCount=1
          if (pendingTime !== null) {
            checkCount = 1;
            reading = "";
          } else {
            checkCount = 0;
            reading = "";
          }
        } else if (/^[々〆ヵヶ一-鿿]$/.test(ch)) {
          // 漢字だがREPL注釈なし: ブロック先頭ならcheckCount=1
          if (pendingTime !== null) {
            checkCount = 1;
            reading = "";
          } else {
            checkCount = 0;
            reading = "";
          }
        } else {
          // 仮名（注釈なし）
          checkCount = 1;
          reading = ch;
        }

        const times: (number | null)[] = Array(checkCount).fill(null);
        if (pendingTime !== null && checkCount > 0) {
          times[0] = pendingTime;
          pendingTime = null;
        }

        // スペース前の pendingTime → 直前の文字の endTime に設定
        if (isSpaceChar && pendingTime !== null && chars.length > 0) {
          chars[chars.length - 1].endTime = pendingTime;
          pendingTime = null;
        }

        // checkCount=0 の非スペース文字が pendingTime を持つ → blockTime として保存。
        // 促音も対象にする (除外すると「、[t]って」のタグが て 側へ流れ、
        // 往復で「、っ[t]て」に化ける)。
        let charBlockTime: number | undefined;
        if (!isSpaceChar && pendingTime !== null && checkCount === 0) {
          charBlockTime = pendingTime;
          pendingTime = null;
        }

        chars.push({ char: ch, reading, checkCount, times, endTime: null, rubySpan, blockTime: charBlockTime });
      }

      // ブロック内で pendingTime が消費されなかった場合（全char=spaceなど）
      if (pendingTime !== null) {
        if (chars.length > 0) {
          chars[chars.length - 1].endTime = pendingTime;
        }
        trailingTime = pendingTime;
      }
    }

    // === 後処理 ===

    // Post-process 1: フレーズ先頭 or スペース直後の記号 → 後続の文字から
    // チェックを「全て」借りる (熟字訓と同じく、先頭にまとめて後続は checkCount=0)。
    const alphaNumRegex = /[a-zA-Zａ-ｚＡ-Ｚ0-9０-９''']/;
    for (let ci = 0; ci < chars.length; ci++) {
      // 行頭 or フレーズ区切り直後の位置か判定。
      // 区切りはゲーム側 parse-chart の splitReg /([、。\s])/ と揃える
      // (読点・句点の直後もゲームでは新フレーズの先頭になるため)。
      const isStartPos = ci === 0 || /[\s　、。]/.test(chars[ci - 1].char);
      if (!isStartPos) continue;
      // スペースはスキップして最初の非空白文字を探す
      let targetIdx = -1;
      for (let si = ci; si < chars.length; si++) {
        const c = chars[si].char;
        if (/[\s　]/.test(c)) continue;
        targetIdx = si;
        break;
      }
      if (
        targetIdx >= 0 &&
        chars[targetIdx].checkCount === 0 &&
        !alphaNumRegex.test(chars[targetIdx].char)
      ) {
        for (let ni = targetIdx + 1; ni < chars.length; ni++) {
          if (chars[ni].checkCount >= 1) {
            // 借りる文字 (ni) の checkCount (チェック枠) のみを先頭記号へ移す。
            // 読み (reading) は元の文字に残す（記号側にルビを付けない）。
            // 既に打たれていたタイムタグも元の文字の blockTime として残し、
            // LRC 上のタグ位置を変えない（「[t]春 → [t]「春 と移動させない）。
            const firstTag = chars[ni].times.find((t) => t !== null);
            chars[targetIdx].checkCount = chars[ni].checkCount;
            chars[targetIdx].times = Array(chars[ni].checkCount).fill(null);
            if (firstTag !== undefined && firstTag !== null) {
              chars[ni].blockTime = firstTag;
            }
            chars[ni].checkCount = 0;
            chars[ni].times = [];
            break;
          }
        }
      }
    }

    // Post-process 2/3: 英単語間スペースの hideEndMark と isEndCheck。
    // 両者は同じ「英単語の間か」の判定を共有する必要がある。
    // (以前は hideEndMark が「前後とも日本語でない」、isEndCheck が「前後とも英数字」
    //  という別基準で、記号を挟むと「endTime は打てるのにマークが見えない」ズレが出た)
    const isAlphaRe = /^[a-zA-Zａ-ｚＡ-Ｚ0-9０-９'',.]$/;
    /** そのスペースが英単語同士の区切りか (前後とも英数字) */
    const isBetweenAlpha = (ci: number): boolean => {
      const prevCharStr = ci > 0 ? chars[ci - 1].char.slice(-1) : "";
      const nextCharStr =
        ci < chars.length - 1 ? chars[ci + 1].char[0] : "";
      return isAlphaRe.test(prevCharStr) && isAlphaRe.test(nextCharStr);
    };
    for (let ci = 0; ci < chars.length; ci++) {
      if (!isSpace(chars[ci].char)) continue;
      if (isBetweenAlpha(ci)) {
        // 英単語間: エンドチェックを置かない (表示も無し)
        chars[ci].hideEndMark = true;
      } else if (ci > 0) {
        chars[ci - 1].isEndCheck = true;
      }
    }
    if (chars.length > 0) {
      chars[chars.length - 1].isEndCheck = true;
    }

    // Post-process 4: Trailing time → endTime（isEndCheck の文字に設定）
    if (trailingTime !== null && chars.length > 0) {
      for (let k = chars.length - 1; k >= 0; k--) {
        if (chars[k].isEndCheck) {
          chars[k].endTime = trailingTime;
          break;
        }
      }
    }

    const originalText = chars.map((c) => c.char).join("");
    lines.push({ chars, originalText });
  }

  return lines;
}
