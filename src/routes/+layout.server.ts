import type { LayoutServerLoad } from './$types';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_STORAGE_KEY } from '$lib/settings';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const settingsCookie = cookies.get(SETTINGS_STORAGE_KEY);

	return {
		user: locals.user,
		profile: locals.profile,
		settings: parseSettings(settingsCookie) ?? DEFAULT_SETTINGS,
		settingsFromCookie: Boolean(settingsCookie)
	};
};
