import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { statsPlaySchema } from '$lib/schemas/stats';

// 1プレイ分の統計を受け取り、集計カウンタ加算（bump_play_stats）と、
// 完走時は play_logs への記録（insert_play_log）を行う。
// user_id はクライアント値を信用せず、セッションの profile.id を使う。
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.profile) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: '無効なリクエスト' }, { status: 400 });
	}

	const parsed = statsPlaySchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}
	const d = parsed.data;
	const userId = locals.profile.id;
	const chartId = d.source === 'chart' ? d.chart_id : null;

	// 集計カウンタ（user_stats / user_chart_stats / user_daily_stats / user_key_stats）
	const { error: bumpErr } = await locals.supabase.rpc('bump_play_stats', {
		p_user_id: userId,
		p_chart_id: chartId,
		p_source: d.source,
		p_start: 1,
		p_retry: d.retry,
		p_finish: d.finish,
		p_keystrokes: d.keystrokes,
		p_play_ms: d.play_ms,
		p_key_counts: d.key_counts,
		p_day: null // RPC 側で current_date を使う
	});
	if (bumpErr) {
		console.error('bump_play_stats error:', bumpErr);
		return json({ error: '統計の保存に失敗しました' }, { status: 500 });
	}

	// 完走プレイは play_logs に1行残す（難所・推移分析用）
	if (d.finish === 1) {
		const { error: logErr } = await locals.supabase.rpc('insert_play_log', {
			p_user_id: userId,
			p_chart_id: chartId,
			p_source: d.source,
			p_score: d.score,
			p_keystrokes: d.keystrokes,
			p_play_ms: d.play_ms,
			p_lost_phrases: d.lost_phrases
		});
		// ログ記録の失敗は致命的でない（カウンタは既に加算済）ので 500 にはしない
		if (logErr) console.error('insert_play_log error:', logErr);
	}

	return json({ ok: true }, { status: 201 });
};
