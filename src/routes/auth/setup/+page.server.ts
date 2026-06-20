import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import { clearProfileCookie } from '$lib/server/profile-cookie';

const handleSchema = z
	.string()
	.min(1, 'ハンドルは1文字以上')
	.max(20, 'ハンドルは20文字以下')
	.regex(/^[a-zA-Z0-9_]+$/, '英数字とアンダースコアのみ使用可能');

const nameSchema = z
	.string()
	.min(1, '表示名は1文字以上')
	.max(30, '表示名は30文字以下');

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(303, '/auth/login');
	}

	// Already has profile — go home
	if (locals.profile) {
		redirect(303, '/');
	}
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		if (!locals.user) {
			redirect(303, '/auth/login');
		}

		const formData = await request.formData();
		const handle = formData.get('handle') as string;
		const name = formData.get('name') as string;

		const handleResult = handleSchema.safeParse(handle);
		if (!handleResult.success) {
			return fail(400, { error: handleResult.error.issues[0].message });
		}
		const handleKey = handleResult.data.toLowerCase();

		const nameResult = nameSchema.safeParse(name);
		if (!nameResult.success) {
			return fail(400, { error: nameResult.error.issues[0].message });
		}

		const { data: existingUser } = await locals.supabase
			.from('users')
			.select('id')
			.eq('auth_id', locals.user.id)
			.maybeSingle();

		if (existingUser) {
			redirect(303, '/');
		}

		// ハンドルの重複チェック（users）
		const { data: existingProfile } = await locals.supabase
			.from('users')
			.select('id')
			.eq('handle_key', handleKey)
			.single();

		if (existingProfile) {
			return fail(400, { error: 'このハンドルは既に使われています' });
		}

		// ハンドルの予約チェック（handle_reservations、30日以内）
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const { data: reservation } = await locals.supabase
			.from('handle_reservations')
			.select('profile_id')
			.eq('handle_key', handleKey)
			.gte('released_at', thirtyDaysAgo)
			.single();

		if (reservation) {
			return fail(400, { error: 'このハンドルは現在使用できません（30日間の予約期間中）' });
		}

		const { error } = await locals.supabase.from('users').insert({
			auth_id: locals.user.id,
			handle: handleResult.data,
			handle_key: handleKey,
			name: nameResult.data
		});

		if (error) {
			console.error('Profile insert error:', error);
			return fail(500, { error: 'プロフィールの作成に失敗しました' });
		}

		// プロフィールキャッシュ Cookie をバストして次リクエストで再取得させる
		clearProfileCookie(cookies);

		redirect(303, '/');
	}
};
