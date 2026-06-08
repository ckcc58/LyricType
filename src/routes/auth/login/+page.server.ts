import { redirect } from '@sveltejs/kit';
import { signIn } from '../../../auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user && !locals.profile) redirect(303, '/auth/setup');
	if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
	google: signIn
};
