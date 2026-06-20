import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export type RankingEntry = {
	id: number;
	user_id: number;
	score: number;
	typing_speed: number;
	backspace_count: number;
	created_at: string;
	name: string;
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const id = parseInt(params.id);
	if (isNaN(id)) {
		return json({ error: '無効なID' }, { status: 400 });
	}

	// ユーザー毎の最高スコア全員分を DB 側で集計（users JOIN 込みの 1 クエリ）
	const { data: rankings, error: rpcErr } = await locals.supabase.rpc('get_chart_rankings', {
		p_chart_id: id
	});

	if (rpcErr) {
		console.error('Rankings fetch error:', rpcErr);
		return json({ error: 'ランキング取得失敗' }, { status: 500 });
	}

	return json({ rankings: (rankings ?? []) as RankingEntry[] });
};
