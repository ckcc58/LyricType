import { z } from 'zod';

// 1プレイ分の統計（chart-game.ts の flushPlayStats が送る）。
export const statsPlaySchema = z
	.object({
		chart_id: z.number().int().positive().nullable(),
		source: z.enum(['chart', 'local']),
		retry: z.union([z.literal(0), z.literal(1)]),
		finish: z.union([z.literal(0), z.literal(1)]),
		keystrokes: z.number().int().min(0).max(100000),
		play_ms: z.number().int().min(0).max(86400000), // ≤24h
		// キーは KeyboardEvent.code（英数字）＋ 修飾子サフィックスのみ許可。
		// 例: "KeyA" / "KeyA+IME" / "ShiftLeft+Shift" / "Enter+Shift+IME"。
		// 任意の長い文字列で user_key_stats の行を膨らませる攻撃を防ぐ。
		key_counts: z
			.record(
				z.string().regex(/^[A-Za-z0-9]{1,20}(\+(Shift|Ctrl|Alt|Meta|IME)){0,5}$/),
				z.number().int().min(0).max(100000)
			)
			.refine((m) => Object.keys(m).length <= 256, 'too many keys'),
		lost_phrases: z.array(z.number().int().min(0)).max(1000),
		score: z.number().min(0).max(10000).nullable()
	})
	// 公開譜面(chart)は chart_id 必須。ローカルは null。
	.refine((d) => d.source !== 'chart' || d.chart_id !== null, {
		message: 'chart_id required for source=chart',
		path: ['chart_id']
	});

export type StatsPlayInput = z.infer<typeof statsPlaySchema>;
