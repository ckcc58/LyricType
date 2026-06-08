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

	const { data: allResults, error: resultsErr } = await locals.supabase
		.from('results')
		.select('id, user_id, score, typing_speed, backspace_count, created_at')
		.eq('chart_id', id)
		.order('score', { ascending: false });

	if (resultsErr) {
		console.error('Rankings fetch error:', resultsErr);
		return json({ error: 'ランキング取得失敗' }, { status: 500 });
	}

	// ユーザー毎の最高スコアを抽出 → TOP 10
	const seen = new Set<number>();
	const topResults = (allResults ?? []).filter((r) => {
		if (seen.has(r.user_id)) return false;
		seen.add(r.user_id);
		return true;
	}).slice(0, 10);

	if (topResults.length === 0) {
		return json({ rankings: [] });
	}

	const userIds = topResults.map((r) => r.user_id);
	const { data: usersData } = await locals.supabase
		.from('users')
		.select('id, name')
		.in('id', userIds);

	const userMap = new Map((usersData ?? []).map((p) => [p.id, p.name]));

	const rankings: RankingEntry[] = topResults.map((r) => ({
		id: r.id,
		user_id: r.user_id,
		score: r.score,
		typing_speed: r.typing_speed,
		backspace_count: r.backspace_count ?? 0,
		created_at: r.created_at,
		name: userMap.get(r.user_id) ?? '???'
	}));

	return json({ rankings });
};
