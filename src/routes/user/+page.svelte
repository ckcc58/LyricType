<script lang="ts">
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import { get } from 'svelte/store';
	import AccountTab from './_components/account/AccountTab.svelte';
	import StatsTab from './_components/stats/StatsTab.svelte';

	let { data } = $props();

	// アクティブタブを URL クエリ(?tab=stats)に保存し、再読込でも維持する。
	let activeTab = $state<'account' | 'stats'>(
		get(page).url.searchParams.get('tab') === 'stats' ? 'stats' : 'account'
	);

	function selectTab(tab: 'account' | 'stats') {
		activeTab = tab;
		const url = new URL(get(page).url);
		url.searchParams.set('tab', tab);
		replaceState(url, {});
	}
</script>

<div class="account-page">
	<div class="tab-bar">
		<button
			class="tab"
			class:active={activeTab === 'account'}
			onclick={() => selectTab('account')}>アカウント設定</button
		>
		<button
			class="tab"
			class:active={activeTab === 'stats'}
			onclick={() => selectTab('stats')}>統計</button
		>
	</div>

	<div class="account-card">
		{#if activeTab === 'account'}
			<AccountTab {data} />
		{:else}
			<StatsTab {data} />
		{/if}
	</div>
</div>

<style>
	/* 上から下まで背景色を統一（ページ全体を1色で塗りつぶす） */
	.account-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 40px 24px;
		min-height: 100%;
		box-sizing: border-box;
		background: #1e1e1e;
	}

	.tab-bar {
		display: flex;
		gap: 4px;
		width: 100%;
		border-bottom: 1px solid #3a3a3a;
	}
	.tab {
		padding: 12px 20px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		color: #aaa;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.tab:hover:not(.active) {
		color: #e6e6e6;
	}
	.tab.active {
		color: #4a9eff;
		border-bottom-color: #4a9eff;
	}

	/* カードは独立した箱にせず、統一背景に溶け込ませる */
	.account-card {
		background: transparent;
		padding: 32px 0 0;
		width: 100%;
	}
</style>
