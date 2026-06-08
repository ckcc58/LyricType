import { z } from 'zod';

export const chartSubmitSchema = z.object({
	lrc_raw: z.string().min(1, 'LRCデータが必要です').max(500_000),
	repl_raw: z.string().max(500_000).default(''),
	title: z.string().min(1, 'タイトルが必要です').max(200),
	artist: z.string().max(200).default(''),
	difficulty: z.number().int().min(0).max(99).default(0),
	description: z.string().max(2000).default(''),
	youtube_video_id: z
		.string()
		.regex(/^[A-Za-z0-9_-]{11}$/, '無効なYouTube Video ID')
		.optional(),
	source: z.string().max(200).optional().default(''),
	tags: z.array(z.string().max(50)).max(10).optional().default([])
});

export type ChartSubmitInput = z.infer<typeof chartSubmitSchema>;
