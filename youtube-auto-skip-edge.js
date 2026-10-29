// ==UserScript==
// @name         YouTube 광고 건너뛰기 자동 클릭
// @namespace    local.john
// @version      1.4
// @description  광고는 음소거로 재생하다가 '건너뛰기' 버튼이 나타나면 즉시 클릭 + 화면 중앙에 '광고중(초)' 표시 + 홈 화면 '스폰서' 광고 썸네일 숨김
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // =====================================================================
  // 1) 홈/피드의 '스폰서' 광고 썸네일 숨김 (기존 기능 그대로)
  // =====================================================================
  const HIDE_SPONSORED = true;

  // (A) CSS: 광고 전용 컴포넌트 + 광고 배지가 들어 있는 피드 카드를 숨김 (:has 사용)
  const AD_CSS = `
    ytd-ad-slot-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-display-ad-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    ytd-companion-slot-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    #masthead-ad,
    #player-ads,
    ytm-promoted-sparkles-web-renderer,
    ytm-companion-ad-renderer,
    ad-slot-renderer,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-item-renderer:has(ad-badge-view-model),
    ytd-rich-item-renderer:has(feed-ad-metadata-view-model),
    ytd-rich-section-renderer:has(ytd-ad-slot-renderer) {
      display: none !important;
    }
  `;

  function injectCss() {
    if (document.getElementById('yt-hide-sponsored-css')) return;
    const style = document.createElement('style');
    style.id = 'yt-hide-sponsored-css';
    style.textContent = AD_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  // (B) JS 보조: 클래스명이 바뀌어 CSS가 못 잡는 경우 '스폰서/광고/Sponsored' 배지 텍스트로 판별
  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-rich-section-renderer',
    'ytm-rich-item-renderer',
    'ytm-media-item',
  ].join(',');
  const BADGE_SELECTORS = [
    'ad-badge-view-model',
    'feed-ad-metadata-view-model',
    '.ytwAdsHeaderViewModelHost',
    'ytd-badge-supported-renderer',
    '.badge-style-type-ad',
    '.ytd-ad-slot-renderer',
    '[class*="ad-badge"]',
    '[class*="AdBadge"]',
  ].join(',');
  const SPONSOR_RE = /^\s*(스폰서|광고|sponsored|ad)\s*(·.*)?$/i;

  function hideSponsoredCards() {
    const cards = document.querySelectorAll(CARD_SELECTORS);
    for (const card of cards) {
      if (card.dataset.sponsorChecked === '1') continue;
      let isAd = false;
      const badges = card.querySelectorAll(BADGE_SELECTORS);
      for (const b of badges) {
        if (SPONSOR_RE.test(b.textContent || '')) { isAd = true; break; }
      }
      if (isAd) {
        card.style.setProperty('display', 'none', 'important');
        card.dataset.sponsorChecked = '1';
      } else if (card.querySelector('#details, #meta, h3, #video-title')) {
        // 내용이 다 렌더링된 카드만 '검사 완료' 처리 (아직 로딩 중이면 다음에 다시 검사)
        card.dataset.sponsorChecked = '1';
      }
    }
  }

  let sponsorTimer = null;
  function scheduleSponsorScan() {
    if (sponsorTimer) return;
    sponsorTimer = setTimeout(() => {
      sponsorTimer = null;
      hideSponsoredCards();
    }, 300); // 디바운스: 부하 최소화
  }

  if (HIDE_SPONSORED) {
    injectCss();
    hideSponsoredCards();
    new MutationObserver(scheduleSponsorScan)
      .observe(document.body, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', () => {
      injectCss();
      scheduleSponsorScan();
    });
  }

  // =====================================================================
  // 2) 영상 광고 처리
  //    - 광고는 끝으로 넘기지 않고 그대로 재생 (음소거 상태)
  //    - '건너뛰기' 버튼이 나타나면 즉시 클릭
  //    - 화면 중앙에 '광고중(경과 초)' 표시
  // =====================================================================
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button-modern',
    '.ytp-skip-ad button',
    '.ytp-ad-skip-button-slot button',
    '[class*="skip-button"]',
    '[class*="skip-ad"]',
  ].join(',');

  const CHECK_INTERVAL_MS = 100; // 광고 중(및 직후)에만 폴링
  // 광고가 끝난 뒤에도 이 시간(ms) 동안은 남아 있는 건너뛰기 버튼을 계속 찾아 클릭
  // (광고가 연달아 나오는 경우 대비)
  const GRACE_MS = 3000;

  let player = null;
  let video = null;
  let classObserver = null;
  let timer = null;
  let wasAd = false;
  let graceUntil = 0;

  // 음소거 상태 관리
  let adMuted = false;     // 광고 때문에 우리가 음소거를 걸었는지
  let prevMuted = false;   // 광고 시작 전 사용자의 음소거 상태

  // 오버레이
  let overlayEl = null;
  let adStartAt = 0;
  let lastShownSec = -1;

  // ---- 음소거 ----
  function isMuted() {
    if (player && typeof player.isMuted === 'function') return player.isMuted();
    return video ? video.muted : false;
  }
  function setMuted(m) {
    if (player && typeof player.mute === 'function' && typeof player.unMute === 'function') {
      if (m) player.mute(); else player.unMute();
    } else if (video) {
      video.muted = m;
    }
  }
  function muteForAd() {
    if (!adMuted) {
      prevMuted = isMuted();
      adMuted = true;
    }
    if (!isMuted()) setMuted(true); // 광고가 음소거를 풀어도 계속 다시 걸어줌
  }
  function restoreMute() {
    if (!adMuted) return;
    adMuted = false;
    if (!prevMuted) setMuted(false); // 원래 음소거가 아니었을 때만 해제
  }

  // ---- '광고중(N)' 오버레이 ----
  function getOverlay() {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'yt-ad-status-overlay';
      overlayEl.style.cssText = [
        'position:absolute',
        'left:50%',
        'top:50%',
        'transform:translate(-50%,-50%)',
        'z-index:2147483647',
        'padding:10px 22px',
        'background:rgba(0,0,0,0.65)',
        'color:#fff',
        'font:bold 28px/1.2 sans-serif',
        'border-radius:10px',
        'pointer-events:none',
        'display:none',
        'white-space:nowrap',
      ].join(';');
    }
    if (player && overlayEl.parentNode !== player) player.appendChild(overlayEl);
    return overlayEl;
  }
  function showOverlay() {
    const el = getOverlay();
    const sec = Math.floor((Date.now() - adStartAt) / 1000) + 1; // 1초부터 표시
    if (sec !== lastShownSec || el.style.display === 'none') {
      lastShownSec = sec;
      el.textContent = '광고중(' + sec + ')';
      el.style.display = 'block';
    }
  }
  function hideOverlay() {
    lastShownSec = -1;
    if (overlayEl) overlayEl.style.display = 'none';
  }

  // ---- 건너뛰기 버튼 클릭 ----
  // 컨테이너(div)가 잡히면 안쪽 실제 button을 찾아 누르고,
  // 마우스 이벤트 시퀀스를 함께 보내 클릭이 확실히 인식되게 함
  function pressElement(target) {
    const r = target.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const base = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: cx, clientY: cy, screenX: cx, screenY: cy, button: 0,
    };
    const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
    const seq = [
      ['pointerover', 0], ['mouseover', 0], ['pointermove', 0], ['mousemove', 0],
      ['pointerdown', 1], ['mousedown', 1],
      ['pointerup', 0], ['mouseup', 0],
      ['click', 0],
    ];
    for (const [type, buttons] of seq) {
      const isPtr = type.startsWith('pointer');
      const Ctor = isPtr ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ctor(type, Object.assign({}, base, { buttons }, isPtr ? ptr : {})));
    }
  }

  // 화면에 보이는 건너뛰기 버튼을 눌렀으면 true
  function clickSkipButton() {
    if (!player) return false;
    const targets = new Set();
    for (const el of player.querySelectorAll(SKIP_SELECTORS)) {
      const t = el.matches('button') ? el : (el.querySelector('button') || el);
      const r = t.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) targets.add(t);
    }
    for (const t of targets) pressElement(t);
    return targets.size > 0;
  }

  // 클릭이 먹히지 않을 때의 보조 수단:
  // 건너뛰기 버튼이 떠 있는(=건너뛸 수 있는) 광고에 한해 광고 영상을 끝으로 보냄
  const FALLBACK_SEEK = true;
  const FALLBACK_MS = 1000;      // 버튼이 보인 뒤 이 시간 동안 클릭이 안 먹으면 발동
  const MAX_AD_SECONDS = 180;
  let skipSeenAt = 0;

  function fallbackSeek() {
    if (!FALLBACK_SEEK || !video) return;
    const d = video.duration;
    if (isFinite(d) && d > 0 && d <= MAX_AD_SECONDS && video.currentTime < d - 0.2) {
      video.currentTime = d;
    }
  }

  // 광고 여부: 기존 'ad-showing' 클래스 외에, 새 광고 레이아웃의 요소가 있어도 광고로 판단
  function isAdShowing() {
    if (!player) return false;
    if (player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting')) return true;
    return !!player.querySelector(
      '.ytp-ad-player-overlay-layout, .ytp-skip-ad-button, .ytp-ad-skip-button-modern');
  }

  function pollTick() {
    if (isAdShowing()) {
      muteForAd();
      showOverlay();
      if (clickSkipButton()) {
        const now = Date.now();
        if (!skipSeenAt) skipSeenAt = now;
        else if (now - skipSeenAt > FALLBACK_MS) fallbackSeek();
      } else {
        skipSeenAt = 0;
      }
    } else if (Date.now() < graceUntil) {
      clickSkipButton();
    } else {
      stopPolling();
    }
  }

  function startPolling() {
    if (timer) return;
    pollTick();
    timer = setInterval(pollTick, CHECK_INTERVAL_MS);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onAdStart() {
    adStartAt = Date.now();
    lastShownSec = -1;
    muteForAd();
    showOverlay();
  }

  function onAdEnd() {
    skipSeenAt = 0;
    hideOverlay();
    restoreMute();
  }

  function onPlayerClassChange() {
    const adNow = isAdShowing();
    if (adNow && !wasAd) {
      onAdStart();
    } else if (!adNow && wasAd) {
      onAdEnd();
      graceUntil = Date.now() + GRACE_MS;
    }
    wasAd = adNow;
    if (adNow || Date.now() < graceUntil) startPolling();
    else stopPolling();
  }

  function attach() {
    const p = document.getElementById('movie_player');
    if (!p) return;

    const v = p.querySelector('video.html5-main-video');
    if (v) video = v;

    if (p === player) return;
    if (classObserver) classObserver.disconnect();
    stopPolling();
    // 플레이어가 교체되면 이전 상태 정리
    hideOverlay();
    if (adMuted) restoreMute();
    player = p;
    wasAd = false;
    graceUntil = 0;
    classObserver = new MutationObserver(onPlayerClassChange);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    onPlayerClassChange();
  }

  // 광고 도중 다른 영상으로 이동해도 음소거/표시가 남지 않도록 정리
  document.addEventListener('yt-navigate-start', () => {
    if (!isAdShowing()) {
      hideOverlay();
      restoreMute();
    }
  });
  // 플레이어 재연결 + SPA 페이지 이동 대응
  document.addEventListener('yt-navigate-finish', attach);
  attach();
  if (!player) {
    const boot = setInterval(() => {
      attach();
      if (player) clearInterval(boot);
    }, 500);
  }
  // 클래스 변화가 없는 새 광고 레이아웃 대비: 가벼운 감시를 상시 실행
  setInterval(() => {
    if (!player || !player.isConnected) attach();
    if (player) onPlayerClassChange();
  }, 250);
})();
