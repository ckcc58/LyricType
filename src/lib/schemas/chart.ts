import { z } from 'zod';

export const chartSubmitSchema = z.object({
	lrc_raw: z.string().min(1, 'LRCデータが必要です').max(500_000),
	repl_raw: z.string().max(500_000).default(''),
	title: z.string().min(1, 'タイトルが必要です').max(200),
	artist: z.string().max(200).default(''),
	description: z.string().max(2000).default(''),
	youtube_video_id: z
		.string()
		.regex(/^[A-Za-z0-9_-]{11}$/, '無効なYouTube Video ID')
		.optional(),
	source: z.string().max(200).optional().default(''),
	tags: z.array(z.string().max(50)).max(10).optional().default([]),
	// 実際の曲の長さ (秒)。エディタのプレイヤーから取得して送る。
	// 未指定 (旧クライアント/メディア未ロード時) はサーバ側で歌詞末尾から近似する。
	duration_seconds: z.number().min(1).max(36000).optional(),
	// 譜面一覧のサムネから流すプレビューの開始位置 (秒)。
	// 未指定なら歌詞の最初のタイムタグ時刻をサーバ側で入れる。
	preview_time: z.number().min(0).max(36000).optional()
});

export type ChartSubmitInput = z.infer<typeof chartSubmitSchema>;
