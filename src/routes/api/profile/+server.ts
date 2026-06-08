import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const handleSchema = z
	.string()
	.min(1, 'ハンドルは1文字以上')
	.max(20, 'ハンドルは20文字以下')
	.regex(/^[a-zA-Z0-9_]+$/, '英数字とアンダースコアのみ使用可能');

const nameSchema = z
	.string()
	.min(1, '表示名は1文字以上')
	.max(30, '表示名は30文字以下');

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user || !locals.profile) {
		return json({ error: 'ログインが必要です' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: '無効なリクエスト' }, { status: 400 });
	}

	const { handle, name } = body as { handle?: string; name?: string };

	// 表示名の更新
	if (name !== undefined) {
		const result = nameSchema.safeParse(name);
		if (!result.success) {
			return json({ error: result.error.issues[0].message }, { status: 400 });
		}

		const { error } = await locals.supabase
			.from('users')
			.update({ name: result.data })
			.eq('id', locals.profile.id);

		if (error) {
			return json({ error: '表示名の更新に失敗しました' }, { status: 500 });
		}
	}

	// ハンドルの更新
	if (handle !== undefined) {
		const result = handleSchema.safeParse(handle);
		if (!result.success) {
			return json({ error: result.error.issues[0].message }, { status: 400 });
		}

		const newHandle = result.data;
		const newHandleKey = newHandle.toLowerCase();
		const currentHandle = locals.profile.handle;
		const currentHandleKey = currentHandle.toLowerCase();

		// 同じハンドルなら何もしない
		if (newHandle === currentHandle) {
			return json({ ok: true });
		}

		if (newHandleKey === currentHandleKey) {
			const { error } = await locals.supabase
				.from('users')
				.update({ handle: newHandle, handle_key: newHandleKey })
				.eq('id', locals.profile.id);

			if (error) {
				return json({ error: 'ハンドルの更新に失敗しました' }, { status: 500 });
			}

			return json({ ok: true });
		}

		// 他のユーザーが使用中か確認
		const { data: existingProfile } = await locals.supabase
			.from('users')
			.select('id')
			.eq('handle_key', newHandleKey)
			.neq('id', locals.profile.id)
			.single();

		if (existingProfile) {
			return json({ error: 'このハンドルは既に使われています' }, { status: 400 });
		}

		// 30日以内の予約チェック（自分以外）
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
		const { data: reservation } = await locals.supabase
			.from('handle_reservations')
			.select('profile_id')
			.eq('handle_key', newHandleKey)
			.gte('released_at', thirtyDaysAgo)
			.neq('profile_id', locals.profile.id)
			.single();

		if (reservation) {
			return json({ error: 'このハンドルは現在使用できません（30日間の予約期間中）' }, { status: 400 });
		}

		// 旧ハンドルを予約テーブルに保存
		await locals.supabase.from('handle_reservations').insert({
			handle: currentHandle,
			handle_key: currentHandleKey,
			profile_id: locals.profile.id
		});

		// ハンドルを更新
		const { error } = await locals.supabase
			.from('users')
			.update({ handle: newHandle, handle_key: newHandleKey })
			.eq('id', locals.profile.id);

		if (error) {
			return json({ error: 'ハンドルの更新に失敗しました' }, { status: 500 });
		}
	}

	return json({ ok: true });
};
