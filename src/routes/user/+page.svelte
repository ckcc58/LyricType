<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	let handle = $state(data.profile.handle);
	let displayName = $state(data.profile.name);
	let handleError = $state('');
	let nameError = $state('');
	let handleSaving = $state(false);
	let nameSaving = $state(false);
	let handleSuccess = $state(false);
	let nameSuccess = $state(false);


	async function saveHandle() {
		handleError = '';
		handleSuccess = false;
		handleSaving = true;
		const res = await fetch('/api/profile', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ handle })
		});
		const result = await res.json();
		handleSaving = false;
		if (result.error) {
			handleError = result.error;
		} else {
			handleSuccess = true;
			await invalidateAll();
		}
	}

	async function saveName() {
		nameError = '';
		nameSuccess = false;
		nameSaving = true;
		const res = await fetch('/api/profile', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: displayName })
		});
		const result = await res.json();
		nameSaving = false;
		if (result.error) {
			nameError = result.error;
		} else {
			nameSuccess = true;
			await invalidateAll();
		}
	}
</script>

<div class="account-page">
	<div class="account-card">
		<h1>アカウント設定</h1>

		<section>
			<h2>ハンドル <span class="at">@</span></h2>
			<p class="desc">URLに使用されます。変更後30日間は他のユーザーが同じハンドルを使用できません。</p>
			<div class="field-row">
				<input
					type="text"
					bind:value={handle}
					maxlength="20"
					pattern="[a-zA-Z0-9_]+"
					placeholder="handle"
					autocomplete="off"
				/>
				<button onclick={saveHandle} disabled={handleSaving || handle === data.profile.handle}>
					{handleSaving ? '保存中...' : '保存'}
				</button>
			</div>
			<small>1〜20文字、英数字とアンダースコア(_)のみ</small>
			{#if handleError}<p class="error">{handleError}</p>{/if}
			{#if handleSuccess}<p class="success">ハンドルを更新しました</p>{/if}
		</section>

		<section>
			<h2>表示名</h2>
			<p class="desc">自由に変更できます。他ユーザーと同じ名前も使用可能です。</p>
			<div class="field-row">
				<input
					type="text"
					bind:value={displayName}
					maxlength="30"
					placeholder="表示名"
					autocomplete="off"
				/>
				<button onclick={saveName} disabled={nameSaving || displayName === data.profile.name}>
					{nameSaving ? '保存中...' : '保存'}
				</button>
			</div>
			<small>1〜30文字</small>
			{#if nameError}<p class="error">{nameError}</p>{/if}
			{#if nameSuccess}<p class="success">表示名を更新しました</p>{/if}
		</section>

		<section class="danger-zone">
			<h2>アカウント</h2>
			<form method="POST" action="/auth/logout">
				<input type="hidden" name="redirectTo" value="/" />
				<button type="submit" class="logout-btn">ログアウト</button>
			</form>
		</section>
	</div>
</div>

<style>
	.account-page {
		display: flex;
		justify-content: center;
		padding: 40px 24px;
	}

	.account-card {
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 12px;
		padding: 40px;
		max-width: 550px;
		width: 100%;
	}

	h1 {
		color: #ddd;
		margin: 0 0 32px;
		font-size: 1.5rem;
	}

	section {
		margin-bottom: 32px;
	}

	h2 {
		color: #ccc;
		font-size: 1rem;
		margin: 0 0 4px;
	}

	.at {
		color: #4a9eff;
	}

	.desc {
		color: #666;
		font-size: 0.82rem;
		margin: 0 0 10px;
	}

	.field-row {
		display: flex;
		gap: 8px;
		margin-bottom: 4px;
	}

	input {
		flex: 1;
		padding: 10px 12px;
		border-radius: 6px;
		border: 1px solid #444;
		background: #2a2a2a;
		color: #ddd;
		font-size: 1rem;
	}

	button {
		padding: 10px 18px;
		border-radius: 6px;
		border: none;
		background: #4a9eff;
		color: white;
		font-size: 0.9rem;
		cursor: pointer;
		transition: background 0.15s;
		white-space: nowrap;
	}

	button:hover:not(:disabled) {
		background: #3a8eef;
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	small {
		color: #555;
		font-size: 0.8rem;
	}

	.error {
		color: #ff6b6b;
		font-size: 0.85rem;
		margin: 6px 0 0;
	}

	.success {
		color: #4caf50;
		font-size: 0.85rem;
		margin: 6px 0 0;
	}

	.danger-zone {
		border-top: 1px solid #333;
		padding-top: 24px;
		margin-bottom: 0;
	}

	.logout-btn {
		padding: 10px 18px;
		border-radius: 6px;
		border: 1px solid #555;
		background: transparent;
		color: #aaa;
		font-size: 0.9rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s;
	}

	.logout-btn:hover {
		border-color: #ff6b6b;
		color: #ff6b6b;
	}
</style>
