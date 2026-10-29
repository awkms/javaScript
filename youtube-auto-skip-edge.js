// ==UserScript==
// @name         YouTube 광고 건너뛰기 자동 클릭
// @namespace    local.john
// @version      1.5.1
// @description  광고 감지(클래스 + '건너뛰기'/'스폰서' 텍스트) → 음소거 + 끝으로 보내기 + 건너뛰기 즉시 클릭 + 화면 중앙 '광고중(초)' 표시 + 홈 화면 '스폰서' 광고 썸네일 숨김
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 콘솔(F12)에서 감지 이유를 보고 싶으면 true
  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log('[yt-ad]', ...a); };

  // =====================================================================
  // 1) 홈/피드의 '스폰서' 광고 썸네일 숨김 (기존 기능 그대로)
  // =====================================================================
  const HIDE_SPONSORED = true;

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
    }, 300);
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
  //    - 광고 판별: ① 플레이어 클래스  ② 광고 전용 요소  ③ 화면에 보이는
  //      '건너뛰기' 버튼 텍스트  ④ 화면에 보이는 '스폰서/광고' 라벨 텍스트
  //    - 광고이면: 음소거 + 16배속 + 영상 끝으로 이동 + 건너뛰기 버튼 클릭
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

  // 광고 전용 요소(광고가 아닐 때는 존재하지 않는 것들만)
  const AD_ONLY_SELECTORS = [
    '.ytp-ad-player-overlay-layout',
    '.ytp-ad-player-overlay',
    '.ytp-ad-persistent-progress-bar-container',
    '.ytp-ad-avatar-lockup-card',
    '.ytp-ad-simple-ad-badge',
    '.ytp-ad-preview-container',
    'ad-badge-view-model',
  ].join(',');

  // 텍스트 판별용 정규식 (짧은 리프 요소에만 적용)
  const SKIP_TEXT_RE = /^\s*(광고\s*)?(건너뛰기|skip(\s*ads?)?)\s*$/i;
  const SPONSOR_TEXT_RE = /^\s*(스폰서|sponsored|광고)(\s*[·•].*)?$/i;

  const CHECK_INTERVAL_MS = 200; // 상시 감시 주기
  const GRACE_MS = 3000;         // 광고 종료 후에도 이 시간 동안 건너뛰기 버튼 탐색(연속 광고 대비)
  const MAX_AD_SECONDS = 600;    // 이보다 긴 영상은 광고로 보지 않고 끝으로 보내지 않음(안전장치)
  const AD_RATE = 16;            // 광고 중 재생 속도(끝으로 보내기가 막힐 때의 보조)

  let player = null;
  let video = null;
  let classObserver = null;
  let wasAd = false;
  let graceUntil = 0;

  // 음소거 / 재생속도 복원용
  let adMuted = false;
  let prevMuted = false;
  let rateChanged = false;
  let prevRate = 1;

  // 오버레이
  let overlayEl = null;
  let adStartAt = 0;
  let lastShownSec = -1;

  // ---- 공통 유틸 ----
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  function refreshVideo() {
    if (!player) return;
    const v = player.querySelector('video.html5-main-video') || player.querySelector('video');
    if (v) video = v;
  }

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
    if (!isMuted()) setMuted(true);
  }
  function restoreMute() {
    if (!adMuted) return;
    adMuted = false;
    if (!prevMuted) setMuted(false);
  }

  // ---- 재생 속도 ----
  function speedUpForAd() {
    if (!video) return;
    if (!rateChanged) {
      prevRate = video.playbackRate || 1;
      rateChanged = true;
    }
    if (video.playbackRate !== AD_RATE) {
      try { video.playbackRate = AD_RATE; } catch (e) { /* 무시 */ }
    }
  }
  function restoreRate() {
    if (!rateChanged) return;
    rateChanged = false;
    if (video) {
      try { video.playbackRate = prevRate; } catch (e) { /* 무시 */ }
    }
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
    const sec = Math.floor((Date.now() - adStartAt) / 1000) + 1;
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

  // ---- 건너뛰기 버튼 찾기 (클래스 + 텍스트) ----
  function findSkipTargets() {
    const targets = new Set();
    if (!player) return [];

    // (1) 클래스 기반
    for (const el of player.querySelectorAll(SKIP_SELECTORS)) {
      const t = el.matches('button') ? el : (el.querySelector('button') || el);
      if (isVisible(t)) targets.add(t);
    }

    // (2) 텍스트/aria-label 기반 ('건너뛰기', 'Skip', 'Skip ad')
    const cands = player.querySelectorAll('button, [role="button"], yt-button-shape, button-view-model');
    for (const el of cands) {
      // innerText는 레이아웃 계산을 유발해 느리므로 textContent 사용
      const txt = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      const hit = (txt.length > 0 && txt.length <= 14 && SKIP_TEXT_RE.test(txt)) ||
                  (aria.length > 0 && aria.length <= 14 && SKIP_TEXT_RE.test(aria));
      if (!hit || !isVisible(el)) continue;
      const t = el.matches('button, [role="button"]') ? el : (el.querySelector('button') || el);
      targets.add(t);
    }
    return Array.from(targets);
  }

  // ---- '스폰서/광고' 라벨이 플레이어 안에 보이는지 ----
  function hasSponsorLabel() {
    if (!player) return false;
    const els = player.querySelectorAll('span, div, a, p, yt-formatted-string');
    for (const el of els) {
      if (el.children.length > 0) continue; // 텍스트만 가진 리프 요소만
      const t = (el.textContent || '').trim();
      if (t.length === 0 || t.length > 40) continue;
      if (SPONSOR_TEXT_RE.test(t) && isVisible(el)) return true;
    }
    return false;
  }

  // ---- 클릭 ----
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
    ];
    for (const [type, buttons] of seq) {
      const isPtr = type.startsWith('pointer');
      const Ctor = isPtr ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ctor(type, Object.assign({}, base, { buttons }, isPtr ? ptr : {})));
    }
    // 네이티브 click (이벤트 중복 발송 없이 한 번만)
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', Object.assign({}, base, { buttons: 0 })));
  }

  function clickSkipButton() {
    const targets = findSkipTargets();
    for (const t of targets) pressElement(t);
    return targets.length > 0;
  }

  // ---- 광고 영상을 끝으로 ----
  let lastSeekAt = 0;
  function seekAdToEnd() {
    if (!video) return;
    const now = Date.now();
    if (now - lastSeekAt < 300) return; // 연속 seek 방지
    lastSeekAt = now;
    const d = video.duration;
    if (isFinite(d) && d > 0 && d <= MAX_AD_SECONDS && video.currentTime < d - 0.2) {
      try { video.currentTime = d; } catch (e) { /* 무시 */ }
    }
  }

  // ---- 광고 여부 판별 (비용이 낮은 것부터) ----
  function detectAd() {
    if (!player) return '';
    if (player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting')) return 'class';
    if (player.querySelector(AD_ONLY_SELECTORS)) return 'ad-element';

    // 텍스트 기반 검사는 비싸므로 빈도 제한 (평소 600ms, 광고 중 150ms)
    const now = Date.now();
    if (now - lastScanAt < (wasAd ? 150 : 600)) return lastScanResult;
    lastScanAt = now;
    lastScanResult = findSkipTargets().length > 0 ? 'skip-button'
                   : (hasSponsorLabel() ? 'sponsor-label' : '');
    return lastScanResult;
  }
  let lastScanAt = 0;
  let lastScanResult = '';

  // ---- 메인 루프 ----
  // 호출이 몰려도(클래스 변경 감시 + 타이머) 100ms에 한 번만, 겹쳐 실행되지 않게 제한
  let ticking = false;
  let lastTickAt = 0;
  function tick() {
    const t = Date.now();
    if (ticking || t - lastTickAt < 100) return;
    ticking = true;
    lastTickAt = t;
    try {
      doTick();
    } catch (e) {
      log('오류', e);
    } finally {
      ticking = false;
    }
  }

  function doTick() {
    if (!player || !player.isConnected) {
      attach();
      if (!player) return;
    }
    refreshVideo();

    const reason = detectAd();
    const adNow = !!reason;

    if (adNow && !wasAd) {
      adStartAt = Date.now();
      lastShownSec = -1;
      log('광고 시작:', reason);
    } else if (!adNow && wasAd) {
      hideOverlay();
      restoreMute();
      restoreRate();
      graceUntil = Date.now() + GRACE_MS;
      log('광고 종료');
    }
    wasAd = adNow;

    if (adNow) {
      muteForAd();
      showOverlay();
      clickSkipButton();   // '건너뛰기'가 보이면 즉시 클릭
      speedUpForAd();      // 보조: 16배속
      seekAdToEnd();       // 광고 영상은 끝으로
    } else if (Date.now() < graceUntil) {
      clickSkipButton();   // 연속 광고 대비
    }
  }

  function attach() {
    const p = document.getElementById('movie_player');
    if (!p) return;

    if (p === player) return;
    if (classObserver) classObserver.disconnect();
    hideOverlay();
    if (adMuted) restoreMute();
    restoreRate();
    player = p;
    wasAd = false;
    graceUntil = 0;
    refreshVideo();
    classObserver = new MutationObserver(tick);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    tick();
  }

  // 광고 도중 다른 영상으로 이동해도 음소거/표시가 남지 않도록 정리
  document.addEventListener('yt-navigate-start', () => {
    if (!detectAd()) {
      hideOverlay();
      restoreMute();
      restoreRate();
    }
  });
  document.addEventListener('yt-navigate-finish', attach);

  attach();
  setInterval(tick, CHECK_INTERVAL_MS);
})();
