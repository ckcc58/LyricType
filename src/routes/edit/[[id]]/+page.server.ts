import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const isLoggedIn = !!locals.user;

	if (!params.id || !locals.supabase) {
		return { editChart: null, canEditChart: false, isLoggedIn };
	}

	const id = parseInt(params.id);
	if (isNaN(id)) {
		return { editChart: null, canEditChart: false, isLoggedIn };
	}

	const { data: chart, error } = await locals.supabase
		.from('charts')
		.select('id, lrc_raw, repl_raw, title, artist, description, youtube_video_id, source, tags, uploader_id')
		.eq('id', id)
		.eq('status', 'active')
		.single();

	if (error || !chart) {
		return { editChart: null, canEditChart: false, isLoggedIn };
	}

	const canEditChart =
		!!locals.profile &&
		(locals.profile.role === 'admin' || chart.uploader_id === locals.profile.id);

	return { editChart: chart, canEditChart, isLoggedIn };
};
