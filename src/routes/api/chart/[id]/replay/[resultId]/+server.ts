import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export type ReplayPayload = {
	result_id: number;
	final_score: number;
	name: string;
	lyric_data: unknown;
	key_events: unknown;
	commit_events: unknown;
	phrase_results: unknown;
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const chartId = parseInt(params.id);
	const resultId = parseInt(params.resultId);
	if (isNaN(chartId) || isNaN(resultId)) {
		return json({ error: '無効なID' }, { status: 400 });
	}

	const { data: result } = await locals.supabase
		.from('results')
		.select('id, score, user_id, chart_version_id')
		.eq('id', resultId)
		.eq('chart_id', chartId)
		.single();

	if (!result) {
		return json({ error: 'リザルトが見つかりません' }, { status: 404 });
	}

	const [replayRes, versionRes, profileRes] = await Promise.all([
		locals.supabase
			.from('replay_data')
			.select('key_events, commit_events, phrase_results')
			.eq('result_id', resultId)
			.single(),
		locals.supabase
			.from('chart_versions')
			.select('lyric_data')
			.eq('id', result.chart_version_id)
			.single(),
		locals.supabase.from('users').select('name').eq('id', result.user_id).single()
	]);

	if (!replayRes.data || !versionRes.data) {
		return json({ error: 'リプレイデータが見つかりません' }, { status: 404 });
	}

	const payload: ReplayPayload = {
		result_id: resultId,
		final_score: result.score,
		name: profileRes.data?.name ?? '???',
		lyric_data: versionRes.data.lyric_data,
		key_events: replayRes.data.key_events,
		commit_events: replayRes.data.commit_events,
		phrase_results: replayRes.data.phrase_results
	};

	return json(payload);
};
