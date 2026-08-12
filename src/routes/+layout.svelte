<script lang="ts">
  import { page, navigating } from '$app/state';
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import {
    settings,
    updateSetting,
    LYRIC_DELAY_MIN,
    LYRIC_DELAY_MAX,
  } from '$lib/settings';
  import { FONT_OPTIONS, fontStack, GOOGLE_FONTS_HREF } from '$lib/fonts';
  import { volume } from '../store';
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { createQueryClient } from '$lib/query-client';
  import { PUBLIC_SUPABASE_URL } from '$env/static/public';

  const queryClient = createQueryClient();

  let { children, data }: { children: Snippet; data: any } = $props();

  let showSettings = $state(false);

  $effect(() => {
    if (data.settingsFromCookie) {
      settings.set(data.settings);
    }
  });

  // ナビゲーション中のプログレスバー (YouTube 風)
  let navProgressVisible = $state(false);
  let navProgress = $state(0);
  let navProgressOpacity = $state(1);
  let navRampTimer: ReturnType<typeof setTimeout> | undefined;
  let navHideTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (navigating.to) {
      // ナビゲーション開始
      clearTimeout(navRampTimer);
      clearTimeout(navHideTimer);
      navProgressVisible = true;
      navProgressOpacity = 1;
      navProgress = 0;
      // 次フレームで開始位置に動かして、その後 85% まで遅めの transition で伸ばす
      requestAnimationFrame(() => {
        navProgress = 15;
        navRampTimer = setTimeout(() => {
          navProgress = 85;
        }, 80);
      });
    } else if (navProgressVisible) {
      // ナビゲーション完了 → 100% → フェードアウト
      clearTimeout(navRampTimer);
      navProgress = 100;
      navHideTimer = setTimeout(() => {
        navProgressOpacity = 0;
        navHideTimer = setTimeout(() => {
          navProgressVisible = false;
          navProgress = 0;
        }, 200);
      }, 120);
    }
  });

  // settings.volume → volume store 同期
  $effect(() => {
    volume.set($settings.volume);
  });

  // settings.fontFamily → 全体フォント適用（--app-font を html に反映）
  $effect(() => {
    document.documentElement.style.setProperty('--app-font', fontStack($settings.fontFamily));
  });

  type NavItem = {
    href: string;
    label: string;
    icon: string;
    disabled?: boolean;
  };

  const navItems: NavItem[] = [
    {
      href: '/',
      label: 'ホーム',
      icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'
    },
    {
      href: '/chart/local',
      label: 'ローカル譜面をプレイ',
      icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/>'
    },
    {
      href: '/edit',
      label: 'エディタ',
      icon: '<path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>'
    },
  ];

  const gearIcon = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>';

  function isActive(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/') return path === '/';
    if (href === '/chart/local') return path === '/chart/local';
    return path.startsWith(href);
  }

</script>

<svelte:head>
  <link rel="preconnect" href={PUBLIC_SUPABASE_URL} crossorigin="anonymous" />
  <link rel="preconnect" href="https://i.ytimg.com" crossorigin="anonymous" />
  <link rel="preconnect" href="https://www.youtube.com" />
  <link rel="dns-prefetch" href="https://i.ytimg.com" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
</svelte:head>

{#if navProgressVisible}
  <div
    class="nav-progress"
    style:width="{navProgress}%"
    style:opacity={navProgressOpacity}
  ></div>
{/if}

<QueryClientProvider client={queryClient}>
<div class="appLayout">
  <!-- サイドバー内のどこをクリックしても設定を閉じる。
       歯車ボタンだけは自前でトグルするため stopPropagation する。
       (各項目はボタン/リンクでキーボード操作可能なので click 補助のみ) -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <nav class="sidebar" onclick={() => (showSettings = false)}>
    <!-- Auth: top of sidebar -->
    {#if data.profile}
      <a href="/user" class="navItem authItem" title={data.profile.name}>
        <svg class="navIcon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z"/>
        </svg>
        <span class="tooltip">{data.profile.name}</span>
      </a>
    {:else if data.user}
      <a href="/auth/setup" class="navItem authItem" title="プロフィール設定">
        <svg class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        <span class="tooltip">プロフィール設定</span>
      </a>
    {:else}
      <a href="/auth/login" class="navItem authItem" title="ログイン">
        <svg class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        <span class="tooltip">ログイン</span>
      </a>
    {/if}

    <div class="authSeparator"></div>

    {#each navItems as item}
      {#if item.disabled}
        <div class="navItem disabled" title={item.label}>
          <svg class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            {@html item.icon}
          </svg>
          <span class="tooltip">{item.label}</span>
        </div>
      {:else}
        <a href={item.href} class="navItem" class:active={isActive(item.href)} title={item.label}>
          <svg class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            {@html item.icon}
          </svg>
          <span class="tooltip">{item.label}</span>
        </a>
      {/if}
    {/each}

    <div class="sidebarSpacer"></div>

    <button
      class="navItem settingsBtn"
      class:active={showSettings}
      title="設定"
      onclick={(e) => {
        e.stopPropagation(); // nav の「閉じる」ハンドラに飲まれないように
        showSettings = !showSettings;
      }}
    >
      <svg class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {@html gearIcon}
      </svg>
      <span class="tooltip">設定</span>
    </button>
  </nav>

  {#if showSettings}
    <div class="settingsOverlay" onclick={() => showSettings = false} role="presentation"></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="settingsPanel"
      transition:fly={{ x: -280, duration: 220, easing: cubicOut, opacity: 1 }}
      onclick={(e) => e.stopPropagation()}
      onmousedown={(e) => e.stopPropagation()}
    >
      <div class="settingsTitle">設定</div>

      <div class="settingGroup">
        <label class="settingLabel">音量: {$settings.volume}</label>
        <input
          type="range" min="0" max="100" step="1"
          value={$settings.volume}
          oninput={(e) => updateSetting('volume', +(e.currentTarget as HTMLInputElement).value)}
          class="settingSlider"
        />
      </div>

      <div class="settingGroup">
        <label class="settingLabel" for="lyricDelaySlider"
          >歌詞表示タイミング調整: {$settings.lyricDelay >= 0
            ? '+'
            : ''}{$settings.lyricDelay.toFixed(2)}s</label
        >
        <input
          id="lyricDelaySlider"
          type="range"
          min={LYRIC_DELAY_MIN}
          max={LYRIC_DELAY_MAX}
          step="0.01"
          value={$settings.lyricDelay}
          oninput={(e) =>
            updateSetting('lyricDelay', +(e.currentTarget as HTMLInputElement).value)}
          class="settingSlider"
        />
        <div class="settingHint">
          プレイ中、歌詞の表示タイミングを調整します。
        </div>
      </div>

      <div class="settingGroup">
        <label class="settingLabel" for="fontSelect">フォント</label>
        <select
          id="fontSelect"
          class="settingSelect"
          value={$settings.fontFamily}
          onchange={(e) => updateSetting('fontFamily', (e.currentTarget as HTMLSelectElement).value)}
        >
          {#each FONT_OPTIONS as f}
            <option value={f.id} style="font-family: {f.stack}">{f.label}</option>
          {/each}
        </select>
      </div>

    </div>
  {/if}

  <main class="content">
    {@render children()}
  </main>
</div>
</QueryClientProvider>

<style>
  /* skip-hint (ゲーム画面) の kbd キーキャップ風スタイル。
     GameOverlay 側のスコープ CSS だとチャンク読み込み前は無スタイル化される場合があるので
     レイアウト側のグローバルとして配置 */
  :global(.skip-text kbd) {
    display: inline-block;
    padding: 1px 6px;
    margin: 0 2px;
    font-size: 0.78rem;
    font-family: inherit; /* kbd の UA 既定 (monospace) を打ち消す */
    color: rgba(255, 255, 255, 0.65);
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 4px;
    line-height: 1.2;
    vertical-align: baseline;
  }

  /* ナビゲーション中のプログレスバー */
  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    height: 3px;
    background: linear-gradient(90deg, #4dd0e1, #2196f3, #4dd0e1);
    background-size: 200% 100%;
    box-shadow: 0 0 8px rgba(77, 208, 225, 0.6);
    z-index: 9999;
    pointer-events: none;
    /* 幅は遅めにイージング (ロード感)、opacity は素早く */
    transition:
      width 2.5s cubic-bezier(0.08, 0.6, 0.2, 1),
      opacity 0.2s ease;
    will-change: width, opacity;
  }

  /* デザイントークン。使い方・追加ルールは /DESIGN.md 参照 */
  :global(:root) {
    --bg-page: #15161a;
    --bg-editor: #0d0d0d;
    --bg-game: #000;
    --bg-card: #24262b;
    --bg-input: #2a2a2a;
    --border: #333;
    --border-strong: #444;
    --text-primary: #eee;
    --text-secondary: #bbb;
    --text-muted: #aaa;
    --accent: #4a9eff;
    --accent-game: #4dd0e1;
    --accent-english: #fc7ca1; /* 英語譜面 (英字9割以上) の識別色 */
    --danger: #ff6b6b;
    --warn: #ffa726;
    --success: #4caf50;
  }

  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #0d0d0d;
    /* 既定はブラウザ既定フォント。設定で選ぶと --app-font が上書きする（fonts.ts / 設定パネル参照） */
    font-family: var(--app-font, sans-serif);
  }

  /* フォームコントロールは body のフォントを継承しないため明示 */
  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font-family: inherit;
  }

  /* グローバルスクロールバー */
  :global(*) {
    scrollbar-width: thin;
    scrollbar-color: #444 transparent;
  }
  :global(*::-webkit-scrollbar) {
    width: 8px;
    height: 8px;
  }
  :global(*::-webkit-scrollbar-track) {
    background: transparent;
  }
  :global(*::-webkit-scrollbar-thumb) {
    background: #444;
    border-radius: 4px;
  }
  :global(*::-webkit-scrollbar-thumb:hover) {
    background: #555;
  }
  :global(*::-webkit-scrollbar-corner) {
    background: transparent;
  }


  .appLayout {
    display: flex;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .sidebar {
    width: 48px;
    min-width: 48px;
    background: #111;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 8px;
    padding-bottom: 8px;
    gap: 4px;
    border-right: 1px solid #222;
    z-index: 100;
    transition: margin-left 0.3s ease, opacity 0.3s ease;
  }

  .sidebarSpacer {
    flex: 1;
  }

  .navItem {
    position: relative;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    color: #666;
    text-decoration: none;
    transition:
      color 0.18s ease,
      background 0.18s ease,
      transform 0.18s ease;
    cursor: pointer;
  }

  .settingsBtn {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
  }

  .navItem:hover:not(.disabled) {
    color: #ccc;
    background: rgba(255, 255, 255, 0.05);
  }

  /* アクティブ状態: 白系の塗りつぶし + 左側に細い縦アクセントバー */
  .navItem.active {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
  .navItem.active::before {
    content: "";
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 22px;
    background: #fff;
    border-radius: 0 2px 2px 0;
  }
  .navItem.active .navIcon {
    color: #fff;
  }

  .navItem.disabled {
    color: #333;
    cursor: default;
    pointer-events: none;
  }

  .navIcon {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }

  .tooltip {
    position: absolute;
    left: 52px;
    top: 50%;
    transform: translateY(-50%);
    background: #222;
    color: #eee;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 200;
  }

  .navItem:hover .tooltip {
    opacity: 1;
  }

  .content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
  }

  /* Settings Panel */
  .settingsOverlay {
    position: fixed;
    inset: 0;
    /* パネル (98) より後ろ。パネル上のクリックを奪わないようにする */
    z-index: 97;
  }

  .settingsPanel {
    position: fixed;
    left: 48px;
    top: 0;
    width: 280px;
    height: 100vh;
    background: #1e1e1e;
    border-right: 1px solid #333;
    padding: 16px;
    /* サイドバー (z-index:100) より後ろ。パネルがサイドバーの下から滑り出す */
    z-index: 98;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-sizing: border-box;
  }

  .settingsTitle {
    color: #eee;
    font-size: 16px;
    font-weight: bold;
  }

  .settingGroup {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* 項目間の細い区切り線 (最初の項目の上には引かない) */
  .settingGroup + .settingGroup {
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    padding-top: 16px;
  }

  .settingLabel {
    color: #aaa;
    font-size: 13px;
  }

  .settingHint {
    color: #aaa;
    font-size: 11px;
    line-height: 1.4;
  }


  .settingSlider {
    width: 100%;
    accent-color: #0070f3;
  }

  .settingSelect {
    width: 100%;
    padding: 6px 8px;
    background: #2a2a2a;
    color: #eee;
    border: 1px solid #444;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  .settingSelect:focus {
    outline: none;
    border-color: #4a9eff;
  }

  /* Auth items */
  .authItem {
    margin-bottom: 0;
  }

  .authSeparator {
    width: 28px;
    height: 1px;
    background: #333;
    margin: 4px 0;
  }

</style>
