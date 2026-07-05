import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resultSubmitSchema } from '$lib/schemas/result';

// 版の content-addressing 用ハッシュ。旧クライアント hashLyric と同一の djb2。
function djb2Hex(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
	return (h >>> 0).toString(16);
}

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

	// 譜面の存在確認 + ノート数 + スナップショット元データ取得
	const { data: chart, error: chartError } = await locals.supabase
		.from('charts')
		.select('id, note_count, chart_data, updated_at, created_at')
		.eq('id', data.chart_id)
		.single();

	if (chartError || !chart) {
		return json({ error: '譜面が見つかりません' }, { status: 404 });
	}

	// 版ズレガード: プレイ開始時の版と現在の版が違う（プレイ中に譜面が更新された）なら拒否。
	// 許すと「旧版で記録した操作ログ(phrase_index)」が「新版のフレーズ配列」に紐づき
	// リプレイがズレるため。旧クライアント(client_version 未送信)はスキップする。
	const currentVersion = chart.updated_at ?? chart.created_at;
	if (data.client_version && currentVersion) {
		const played = new Date(data.client_version).getTime();
		const current = new Date(currentVersion).getTime();
		if (!Number.isNaN(played) && !Number.isNaN(current) && played !== current) {
			return json(
				{ error: '譜面が更新されました。ページを再読み込みしてください' },
				{ status: 409 },
			);
		}
	}

	// リプレイ用スナップショットは、クライアントの申告値ではなくサーバが信頼できる
	// charts.chart_data から組む（毒入れ・ゴミ混入を原理的に防ぐ）。
	// chart_versions.lyric_data は「配列」で保存する形式なので chart_data.lyric を渡す。
	const lyricArray = (chart.chart_data as { lyric?: unknown } | null)?.lyric;
	if (!Array.isArray(lyricArray)) {
		return json({ error: '譜面データが不正です' }, { status: 500 });
	}
	const chartHash = djb2Hex(JSON.stringify(lyricArray));

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
		p_lyric_data:          lyricArray,
		p_chart_hash:          chartHash,
		p_score:               data.score,
		p_typing_speed:        data.typing_speed,
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
