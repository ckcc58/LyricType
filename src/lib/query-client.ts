import { QueryClient } from '@tanstack/svelte-query';

export const createQueryClient = () =>
	new QueryClient({
		defaultOptions: { queries: { staleTime: 30 * 1000 } }
	});
