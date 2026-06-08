import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/login');
	if (!locals.profile?.name) redirect(303, '/auth/setup');
	redirect(303, '/');
};
