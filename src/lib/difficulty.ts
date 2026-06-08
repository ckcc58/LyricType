import type { ChartDataJSON } from './chart-serialization';

export type CharTypeBreakdown = {
	kanji: number;
	hiragana: number;
	katakana: number;
	english: number;
	digit: number;
};

export type DifficultyResult = {
	avgCpm: number;
	medianCpm: number;
	peakCpm: number;
	peakStartLineNo: number;
	peakStartLineText: string;
	peakEndLineNo: number;
	peakEndLineText: string;
	charTypes: CharTypeBreakdown;
};

/** 1 文字を 5 種類に分類して charTypes をインクリメント */
function classifyChar(ch: string, out: CharTypeBreakdown): void {
	if (/[一-鿿々〆]/.test(ch)) out.kanji++;
	else if (/[ぁ-ん]/.test(ch)) out.hiragana++;
	else if (/[ァ-ヶー]/.test(ch)) out.katakana++;
	else if (/[a-zA-Zａ-ｚＡ-Ｚ]/.test(ch)) out.english++;
	else if (/[0-9０-９]/.test(ch)) out.digit++;
}

/** <ruby>本体<rt>読み</rt></ruby> から表示文字だけ取り出す（ツールチップ用） */
function stripRuby(text: string): string {
	return text
		.replace(/<rt>[\s\S]*?<\/rt>/gi, '')
		.replace(/<\/?ruby[^>]*>/gi, '');
}

export function calcDifficulty(lyric: ChartDataJSON['lyric']): DifficultyResult {
	// === Step A: フレーズ列を構築 ===
	// chars は「読み文字数」基準で数える（漢字 1 文字 = 読みのひらがな分の打鍵負荷）
	type Phrase = { start: number; lineNo: number; chars: number; text: string };
	const phrases: Phrase[] = lyric.map((lrc) => ({
		start: lrc.time,
		lineNo: lrc.line,
		chars: lrc.segments.reduce((s, seg) => s + seg.normalizedReading.length, 0),
		text: lrc.phrase
	}));

	// === 文字種別カウント (normalizedText ベース、つまり表示文字を 5 種類に分類) ===
	const charTypes: CharTypeBreakdown = { kanji: 0, hiragana: 0, katakana: 0, english: 0, digit: 0 };
	for (const lrc of lyric) {
		for (const seg of lrc.segments) {
			for (const ch of seg.normalizedText) {
				classifyChar(ch, charTypes);
			}
		}
	}

	// === 行番号 → 行のテキスト (同じ行内の複数フレーズを連結 + ルビタグ除去) ===
	const lineTextMap = new Map<number, string>();
	for (const lrc of lyric) {
		const prev = lineTextMap.get(lrc.line) ?? '';
		lineTextMap.set(lrc.line, prev + stripRuby(lrc.phrase));
	}

	// === Step B: 行レベル集約 ===
	type Line = { lineNo: number; lineStart: number; lineEnd: number };
	const lineMap = new Map<number, Line>();
	for (const lrc of lyric) {
		const ex = lineMap.get(lrc.line);
		if (!ex) {
			lineMap.set(lrc.line, { lineNo: lrc.line, lineStart: lrc.time, lineEnd: lrc.endTime });
		} else {
			ex.lineStart = Math.min(ex.lineStart, lrc.time);
			ex.lineEnd = Math.max(ex.lineEnd, lrc.endTime);
		}
	}

	// === Step C: 同時追加スナップ（連続行 start 差 < 1秒 → 前行の start に揃える）===
	const SNAP_THRESHOLD = 1;
	const lines = [...lineMap.values()].sort((a, b) => a.lineStart - b.lineStart);
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].lineStart - lines[i - 1].lineStart < SNAP_THRESHOLD) {
			lines[i].lineStart = lines[i - 1].lineStart;
		}
	}

	// === Step D: 各行の displayEnd を 5行キュー方式で計算 ===
	const DISPLAY_LINES = 5;
	const GRACE_DURATION = 5;
	const lastDisplayEnd = lines.length > 0 ? lines[lines.length - 1].lineEnd + GRACE_DURATION : 0;
	const lineDisplayEndMap = new Map<number, number>();
	for (let k = 0; k < lines.length; k++) {
		const pushedBy = lines[k + DISPLAY_LINES];
		lineDisplayEndMap.set(lines[k].lineNo, pushedBy ? pushedBy.lineStart : lastDisplayEnd);
	}

	// === Step E-F: フレーズに deadline 割り当て + start でソート ===
	type EnrichedPhrase = Phrase & { deadline: number };
	const enriched: EnrichedPhrase[] = phrases
		.map((p) => ({
			...p,
			deadline: lineDisplayEndMap.get(p.lineNo) ?? lastDisplayEnd
		}))
		.sort((a, b) => a.start - b.start);

	// === Step G: 連続英語フレーズ統合（同じ行内のみ）===
	const isEnglishOnly = (text: string): boolean =>
		!/[ぁ-んァ-ヶー一-鿿々〆ヵヶ]/.test(text);
	const MERGE_THRESHOLD = 1;
	const merged: EnrichedPhrase[] = [];
	let lastAbsorbedStart = -Infinity; // 直近に統合したフレーズの start
	for (const p of enriched) {
		const last = merged[merged.length - 1];
		if (
			last &&
			last.lineNo === p.lineNo &&
			isEnglishOnly(last.text) &&
			isEnglishOnly(p.text) &&
			p.start - lastAbsorbedStart < MERGE_THRESHOLD
		) {
			last.chars += p.chars;
			last.text += ' ' + p.text;
		} else {
			merged.push({ ...p });
		}
		lastAbsorbedStart = p.start;
	}

	// === Step H: ウィンドウ CPM 計算 ===
	// peak  : 全 (i, k) 窓 CPM の最大値（開始行 i と終了行 k を記録）
	// avg   : 各 i における「最終窓 (最も大きい k) の CPM」の平均
	// median: 同上の中央値
	let peakCpmRaw = 0;
	let peakStartLineNo = -1;
	let peakEndLineNo = -1;
	const lastCpms: number[] = [];
	for (let i = 0; i < merged.length; i++) {
		let cumChars = 0;
		let lastCpm = 0; // この i での最終窓 (i, k_max) の CPM
		for (let k = i; k < merged.length; k++) {
			// k のフレーズが i の deadline を過ぎていたら i は既に消えている
			if (k > i && merged[k].start >= merged[i].deadline) break;
			cumChars += merged[k].chars;
			if (cumChars === 0) continue;
			const timeAvail = merged[k].deadline - merged[i].start;
			if (timeAvail <= 0) continue;
			const cpm = (cumChars / timeAvail) * 60;
			if (cpm > peakCpmRaw) {
				peakCpmRaw = cpm;
				peakStartLineNo = merged[i].lineNo;
				peakEndLineNo = merged[k].lineNo;
			}
			lastCpm = cpm;
		}
		if (lastCpm > 0) lastCpms.push(lastCpm);
	}
	const peakCpm = Math.round(peakCpmRaw);
	const peakStartLineText = lineTextMap.get(peakStartLineNo) ?? '';
	const peakEndLineText = lineTextMap.get(peakEndLineNo) ?? '';
	const avgCpm =
		lastCpms.length > 0
			? Math.round(lastCpms.reduce((a, b) => a + b, 0) / lastCpms.length)
			: 0;

	// 中央値
	let medianCpm = 0;
	if (lastCpms.length > 0) {
		const sorted = [...lastCpms].sort((a, b) => a - b);
		const mid = Math.floor(sorted.length / 2);
		medianCpm =
			sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : Math.round(sorted[mid]);
	}

	return {
		avgCpm,
		medianCpm,
		peakCpm,
		peakStartLineNo,
		peakStartLineText,
		peakEndLineNo,
		peakEndLineText,
		charTypes
	};
}
