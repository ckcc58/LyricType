import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.profile) {
		redirect(303, '/auth/login');
	}

	// 統計（get_user_stats / get_user_chart_breakdown）。
	// マイグレーション未適用の環境では関数が存在せずエラーになるため、
	// その場合は空配列にフォールバックしてページを壊さない。
	const [statsRes, breakdownRes] = await Promise.all([
		locals.supabase.rpc('get_user_stats', { p_user_id: locals.profile.id }),
		locals.supabase.rpc('get_user_chart_breakdown', {
			p_user_id: locals.profile.id,
			p_limit: 20
		})
	]);

	return {
		profile: locals.profile,
		stats: statsRes.error ? [] : (statsRes.data ?? []),
		chartBreakdown: breakdownRes.error ? [] : (breakdownRes.data ?? [])
	};
};
