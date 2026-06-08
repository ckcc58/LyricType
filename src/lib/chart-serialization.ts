import type { ParsedChart, MediaSource } from '$lib/parseLyric/parse-chart';

/** DB charts.chart_data に保存する JSONB 型 */
export type ChartDataJSON = {
	lyric: {
		time: number;
		endTime: number;
		line: number;
		phrase: string;
		segments: { text: string; reading: string; normalizedText: string; normalizedReading: string; explicit: boolean }[];
		matchRegExpSource: string;
		charGroups: { count: number; startTime: number; endTime?: number }[];
	}[];
};

/** parseLyric() の結果 → JSONB 安全なオブジェクトに変換 */
export function serializeChart(lyric: ParsedChart['lyric']): ChartDataJSON {
	return {
		lyric: lyric.map((item) => ({
			time: item.time,
			endTime: item.endTime,
			line: item.line,
			phrase: item.phrase,
			segments: item.segments,
			matchRegExpSource: item.matchRegExp.source,
			charGroups: item.charGroups
		}))
	};
}

/** DB行 → ParsedChart 型に復元（Phase 3 のプレイ時に使用） */
export function chartFromJSON(row: {
	title: string;
	artist?: string | null;
	youtube_video_id?: string | null;
	chart_data: ChartDataJSON;
}): ParsedChart {
	const availableSources: MediaSource[] = [];
	if (row.youtube_video_id) {
		availableSources.push({ type: 'youtube', label: 'YouTube', videoId: row.youtube_video_id });
	}

	return {
		title: row.title,
		imageURL: '',
		media: row.youtube_video_id
			? { url: '', type: 'youtube', videoId: row.youtube_video_id }
			: { url: '', type: 'audio' },
		availableSources,
		lyric: row.chart_data.lyric.map((item) => ({
			...item,
			matchRegExp: new RegExp(item.matchRegExpSource)
		}))
	};
}
