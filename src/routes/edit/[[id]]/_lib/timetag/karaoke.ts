// カラオケスイープ表示の計算 (純関数)
import type { TimeTagLine } from "$lib/parseLyric/timetag-parser";

/** カラオケ表示用グループ: タグ付き文字+後続タグなし文字をひとまとめ */
export type KaraokeUnit = {
  text: string; // "だっ" など結合テキスト
  startTime: number;
  endTime: number;
  charStart: number; // line.chars 内の開始 index
  charCount: number; // グループ内の文字数
};

/** 文字が持つ開始時刻 (タイムタグ) を返す。checkCount に依存せず純粋に時刻情報を見る。
 *  checkCount>0 の文字は times[0]、checkCount=0 でタグを持つ文字は blockTime に時刻が入る。 */
function charStartTime(ch: TimeTagLine["chars"][number]): number | null {
  if (ch.times[0] != null) return ch.times[0];
  if (ch.blockTime != null) return ch.blockTime;
  return null;
}

/**
 * 行をカラオケ表示用のグループ配列に変換する。
 * - checkCount(打鍵判定用)には依存せず、タイムタグ(時刻)が打たれた文字だけを起点にする。
 * - 起点 + 後続のタグ無し非スペース文字を 1 グループに結合する。
 * - グループの endTime は: グループ内文字の endTime > 次の起点(時刻を持つ文字)の startTime。
 * - 必要な endTime が得られないグループは省く。
 */
export function buildKaraokeUnits(line: TimeTagLine): KaraokeUnit[] {
  const units: KaraokeUnit[] = [];
  let current: KaraokeUnit | null = null;

  for (let i = 0; i < line.chars.length; i++) {
    const ch = line.chars[i];
    const startTime = charStartTime(ch);
    const isTagged = startTime !== null;
    const isSpace = /^[\s　]$/.test(ch.char);

    if (isTagged) {
      // 新グループ開始: ユニット内 (起点 + 後続のタグ無し非スペース) の endTime を優先
      let endTime: number | null = ch.endTime;
      for (let j = i + 1; j < line.chars.length; j++) {
        const jch = line.chars[j];
        // スペース、または次に時刻を持つ文字 (次の起点) が来たらグループ終了
        if (/^[\s　]$/.test(jch.char) || charStartTime(jch) !== null) break;
        if (jch.endTime !== null) endTime = jch.endTime;
      }
      // endTime がなければ次の起点 (時刻を持つ文字) の時刻にフォールバック
      if (endTime === null) {
        for (let j = i + 1; j < line.chars.length; j++) {
          const t = charStartTime(line.chars[j]);
          if (t !== null) {
            endTime = t;
            break;
          }
        }
      }
      if (endTime === null || endTime <= startTime) {
        // タイムタグ不足 → カラオケ表示しない
        current = null;
      } else {
        current = {
          text: ch.char,
          startTime,
          endTime,
          charStart: i,
          charCount: 1,
        };
        units.push(current);
      }
    } else if (current && !isSpace) {
      // タグなし・非スペース: 直前グループに結合
      current.text += ch.char;
      current.charCount++;
    } else {
      current = null;
    }
  }
  return units;
}

/**
 * 文字 ci のカラオケ進捗を 0~1 で返す (グループ内をスイープ的に塗る)。
 * グループ外の文字は 0 を返す。
 */
export function ttCharProgress(
  units: KaraokeUnit[],
  ci: number,
  currentTime: number,
): number {
  const unit = units.find(
    (u) => ci >= u.charStart && ci < u.charStart + u.charCount,
  );
  if (!unit) return 0;

  // グループ全体の進捗
  if (currentTime <= unit.startTime) return 0;
  let groupProgress: number;
  if (currentTime >= unit.endTime) groupProgress = 1;
  else
    groupProgress =
      (currentTime - unit.startTime) / (unit.endTime - unit.startTime);

  // グループ内スイープ: 左から右へ連続的に塗る
  const posInGroup = ci - unit.charStart;
  return Math.max(
    0,
    Math.min(1, groupProgress * unit.charCount - posInGroup),
  );
}

/**
 * 文字 ci を含むカラオケグループ全体の進捗を 0~1 で返す。
 * ルビは基礎文字ごとではなく読みグループ全体を左から右へ塗るために使う。
 */
export function ttUnitProgress(
  units: KaraokeUnit[],
  ci: number,
  currentTime: number,
): number {
  const unit = units.find(
    (u) => ci >= u.charStart && ci < u.charStart + u.charCount,
  );
  if (!unit) return 0;
  if (currentTime <= unit.startTime) return 0;
  if (currentTime >= unit.endTime) return 1;
  return (currentTime - unit.startTime) / (unit.endTime - unit.startTime);
}

export function ttRubyProgress(
  line: TimeTagLine,
  ci: number,
  currentTime: number,
): number {
  const ch = line.chars[ci];
  if (!ch || ch.reading === ch.char || !ch.reading) return 0;

  const span = Math.max(1, ch.rubySpan ?? 1);
  const startTime = charStartTime(ch);
  if (startTime === null) return 0;

  const spanEnd = Math.min(line.chars.length, ci + span);
  let endTime: number | null = null;
  for (let i = spanEnd - 1; i >= ci; i--) {
    if (line.chars[i]?.endTime != null) {
      endTime = line.chars[i].endTime;
      break;
    }
  }

  if (endTime === null) {
    for (let i = spanEnd; i < line.chars.length; i++) {
      const nextStart = charStartTime(line.chars[i]);
      if (nextStart !== null) {
        endTime = nextStart;
        break;
      }
    }
  }

  if (endTime === null || endTime <= startTime) return 0;
  if (currentTime <= startTime) return 0;
  if (currentTime >= endTime) return 1;
  return (currentTime - startTime) / (endTime - startTime);
}

export function ttRubyUnitProgress(
  units: KaraokeUnit[],
  line: TimeTagLine,
  ci: number,
  currentTime: number,
): number {
  const unit = units.find(
    (u) => ci >= u.charStart && ci < u.charStart + u.charCount,
  );
  if (unit) return ttUnitProgress(units, ci, currentTime);
  return ttRubyProgress(line, ci, currentTime);
}
