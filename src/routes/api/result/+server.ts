import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resultSubmitSchema } from '$lib/schemas/result';

export const POST: RequestHandler = async ({ request, locals }) => {
	// 認証チェック
	if (!locals.user || !locals.profile) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	// ボディ解析
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: '無効なリクエスト' }, { status: 400 });
	}

	// バリデーション
	const parsed = resultSubmitSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0].message }, { status: 400 });
	}
	const data = parsed.data;

	// 譜面の存在確認 + ノート数取得（不正チェック用）
	const { data: chart, error: chartError } = await locals.supabase
		.from('charts')
		.select('id, note_count')
		.eq('id', data.chart_id)
		.single();

	if (chartError || !chart) {
		return json({ error: '譜面が見つかりません' }, { status: 404 });
	}

	// 不正チェック: スコア上限
	const maxPossibleScore = chart.note_count * 100 * 2.5 * 1.5;
	if (data.score > maxPossibleScore) {
		return json({ error: 'スコアが不正です' }, { status: 400 });
	}

	// レート制限: 同一譜面に10秒以内の再送信拒否
	const { data: recentResult } = await locals.supabase
		.from('results')
		.select('id')
		.eq('chart_id', data.chart_id)
		.eq('user_id', locals.profile!.id)
		.gte('created_at', new Date(Date.now() - 10000).toISOString())
		.limit(1);

	if (recentResult && recentResult.length > 0) {
		return json({ error: '送信間隔が短すぎます' }, { status: 429 });
	}

	const backspaceCount = data.key_events.filter((event) => event[0] === 'Backspace').length;

	// RPC で全テーブルをトランザクション一括INSERT
	const { error: dbError } = await locals.supabase.rpc('insert_result_full', {
		p_chart_id:            data.chart_id,
		p_user_id:             locals.profile!.id,
		p_lyric_data:          data.lyric_data,
		p_chart_hash:          data.chart_hash,
		p_score:               data.score,
		p_perfect_count:       data.perfect_count,
		p_reading_match_count: data.reading_match_count,
		p_lost_count:          data.lost_count,
		p_typing_speed:        data.typing_speed,
		p_total_phrases:       data.total_phrases,
		p_backspace_count:     backspaceCount,
		p_key_events:          data.key_events,
		p_commit_events:       data.commit_events,
		p_phrase_results:      data.phrase_results,
	});

	if (dbError) {
		console.error('Result insert error:', dbError);
		return json({ error: '結果の保存に失敗しました' }, { status: 500 });
	}

	return json({ ok: true }, { status: 201 });
};
