// ==UserScript==
// @name         YouTube/Netflix 광고 자동 처리
// @namespace    local.john
// @version      1.8.0
// @description  YouTube: 광고 시 음소거, 광고마다 5초 대기 후 '건너뛰기' 클릭(버튼 없으면 음소거만 유지, 광고 종료 시 해제, 재생 속도는 변경 안 함) + '광고중(초)' 표시 + 홈 '스폰서' 숨김 / Netflix: 광고 시 음소거+10배속, 광고 종료 시 복원
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://www.netflix.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 콘솔(F12)에서 감지 이유를 보고 싶으면 true
  const DEBUG = true;
  let lastLogAt = Date.now();
  const log = (...a) => {
    if (!DEBUG) return;
    const n = Date.now();
    console.log('[ad +' + (n - lastLogAt) + 'ms]', ...a); // 직전 로그와의 간격 → 어디서 시간이 걸리는지 확인용
    lastLogAt = n;
  };

  const AD_RATE = 10; // 광고 중 재생 속도 (넷플릭스 전용 · 유튜브는 속도를 변경하지 않음)

  // =====================================================================
  // NETFLIX
  // =====================================================================
  if (location.hostname.endsWith('netflix.com')) {
    runNetflix();
    return;
  }

  function runNetflix() {
    // 광고 전용 요소 (Netflix DOM 변경 시 여기만 보강하면 됨)
    const NF_AD_SELECTORS = [
      '[data-uia="ads-info-container"]',
      '[data-uia="ads-info-text"]',
      '[data-uia="ad-break-timer"]',
      '.watch-video--ads-info-container',
      '.ads-info-container',
    ].join(',');

    // '광고 · 0:15', '광고(1/2) 0:30', 'Ad 0:15', 'Ads · 0:30' 등 (숫자 포함 필수)
    const NF_AD_TEXT_RE = /^\s*(광고|ads?)(?=[\s·•:(\d])[^]{0,24}\d/i;

    const NF_CHECK_MS = 200;
    const NF_END_CONFIRM = 2; // 연속 N회 광고 미감지여야 종료로 판단 (깜빡임 방지)

    let adActive = false;
    let missCount = 0;
    let prevMuted = false;
    let prevRate = 1;
    let normalRate = 1;

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    }

    function getVideo() {
      return document.querySelector('.watch-video video') || document.querySelector('video');
    }

    let lastScanAt = 0;
    let lastScanResult = '';
    function detectNetflixAd() {
      for (const el of document.querySelectorAll(NF_AD_SELECTORS)) {
        if (isVisible(el)) return 'ad-element';
      }
      // 텍스트 기반 검사는 비싸므로 빈도 제한
      const now = Date.now();
      if (now - lastScanAt < 400) return lastScanResult;
      lastScanAt = now;
      lastScanResult = '';
      const root = document.querySelector('.watch-video') || document.body;
      for (const el of root.querySelectorAll('span, div, p')) {
        if (el.children.length > 0) continue; // 텍스트만 가진 리프 요소
        const t = (el.textContent || '').trim();
        if (t.length === 0 || t.length > 30) continue;
        if (NF_AD_TEXT_RE.test(t) && isVisible(el)) { lastScanResult = 'ad-text'; break; }
      }
      return lastScanResult;
    }

    function nfTick() {
      const v = getVideo();
      if (!v) return;

      const reason = detectNetflixAd();

      if (reason) {
        missCount = 0;
        if (!adActive) {
          adActive = true;
          prevMuted = v.muted;
          prevRate = normalRate; // 광고 직전에 기억해 둔 속도
          log('Netflix 광고 시작:', reason, '이전 속도', prevRate);
        }
        if (!v.muted) v.muted = true;
        if (v.playbackRate !== AD_RATE) {
          try { v.playbackRate = AD_RATE; } catch (e) { /* 무시 */ }
        }
      } else if (adActive) {
        missCount++;
        if (missCount >= NF_END_CONFIRM) {
          adActive = false;
          missCount = 0;
          v.muted = prevMuted;
          try { v.playbackRate = prevRate; } catch (e) { /* 무시 */ }
          log('Netflix 광고 종료, 속도 복원', prevRate);
        } else {
          // 종료 확정 전까지는 광고 상태 유지
          if (!v.muted) v.muted = true;
          if (v.playbackRate !== AD_RATE) {
            try { v.playbackRate = AD_RATE; } catch (e) { /* 무시 */ }
          }
        }
      } else if (v.playbackRate !== AD_RATE) {
        normalRate = v.playbackRate || 1; // 광고가 아닐 때 현재 속도를 계속 기억
      }
    }

    setInterval(() => {
      try { nfTick(); } catch (e) { log('오류', e); }
    }, NF_CHECK_MS);
  }

  // =====================================================================
  // YOUTUBE
  // =====================================================================

  // 1) 홈/피드의 '스폰서' 광고 썸네일 숨김 (기존 기능 그대로)
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

  // 2) 영상 광고 처리 (단순 버전)
  //    - 광고 판별: ① 플레이어 클래스 ② 광고 전용 요소 ③ '건너뛰기' 버튼 텍스트 ④ '스폰서/광고' 라벨
  //    - 광고 시작: 음소거 (재생 속도는 건드리지 않음)
  //    - 광고마다 5초 대기 후 '건너뛰기' 버튼이 보이면 클릭 (연속 광고도 광고마다 5초 대기)
  //    - 버튼이 없으면 음소거만 유지하고, 광고가 끝나면 음소거 해제
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

  const CHECK_INTERVAL_MS = 200;     // 상시 감시 주기
  const SKIP_WAIT_MS = 5000;         // 광고(개별)가 시작된 뒤 건너뛰기를 누르기까지 대기 시간
  const CLICK_RETRY_MS = 1500;       // 클릭 후에도 같은 광고가 이어질 때 재시도 간격
  const FORCE_CLICK_EXTRA_MS = 3000; // '클릭 가능' 표식이 없는 버튼을 그냥 눌러 보기까지 추가 대기 (마크업 변경 대비)
  const AD_END_CONFIRM_MS = 500;     // 광고 감지가 이 시간 이상 끊겨야 '광고 종료'로 판단

  let player = null;
  let video = null;
  let classObserver = null;
  let wasAd = false;

  let adStartAt = 0;        // 광고 구간(연속 광고 포함) 시작 시각 → '광고중(N)' 표시용
  let segStart = 0;         // 현재 광고(개별) 시작 시각 → 5초 대기 기준
  let segKey = '';          // 현재 광고 영상 식별(주소+길이)
  let lastTime = 0;         // 직전 재생 위치 (되돌아가면 새 광고로 판단)
  let missSince = 0;        // 광고 감지가 끊기기 시작한 시각
  let lastClickAt = 0;
  let clickedInBreak = false;
  let ignoreSoftUntil = 0;  // 본편 복귀 직후 잔여 광고 요소 때문에 광고가 다시 시작되는 것을 막는 시각

  // 음소거 복원용
  let adMuted = false;
  let prevMuted = false;
  let normalMuted = false;  // 광고가 아닐 때 계속 갱신되는 '현재 음소거 상태'

  // 오버레이
  let overlayEl = null;
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
      prevMuted = normalMuted; // 광고 직전에 기억해 둔 음소거 상태
      adMuted = true;
    }
    if (!isMuted()) setMuted(true); // YouTube가 해제해도 다시 음소거
  }
  function restoreMute() {
    if (!adMuted) return;
    adMuted = false;
    if (!prevMuted) setMuted(false);
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

    // (1) 클래스 기반: 실제 버튼만 대상으로 함 (버튼을 감싼 컨테이너는 카운트다운 중에도 보임)
    for (const el of player.querySelectorAll(SKIP_SELECTORS)) {
      const t = el.matches('button, [role="button"]') ? el : el.querySelector('button, [role="button"]');
      if (t && isVisible(t)) targets.add(t);
    }

    // (2) 텍스트/aria-label 기반 ('건너뛰기', 'Skip', 'Skip ad')
    const cands = player.querySelectorAll('button, [role="button"], yt-button-shape, button-view-model');
    for (const el of cands) {
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

  // 버튼이 실제로 눌러도 되는 상태인가? (활성화 전에는 보여도 눌러지지 않음)
  function isSkipReady(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    return el.classList.contains('ytp-ad-component--clickable') ||
           !!el.closest('.ytp-ad-component--clickable');
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
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', Object.assign({}, base, { buttons: 0 })));
  }

  // 대기 시간이 지난 뒤 호출: 눌러도 되는 버튼을 우선 누르고, 표식이 없는 버튼은 조금 더 기다린 뒤 누름
  function trySkipClick(now) {
    const targets = findSkipTargets();
    if (targets.length === 0) return false;
    const ready = targets.find(isSkipReady);
    const t0 = ready || (now - segStart >= SKIP_WAIT_MS + FORCE_CLICK_EXTRA_MS ? targets[0] : null);
    if (!t0) return false;
    log('건너뛰기 클릭', ready ? '(활성)' : '(활성 표식 없음)', (now - segStart) + 'ms 경과');
    pressElement(t0);
    return true;
  }

  // ---- 광고 여부 판별 (비용이 낮은 것부터) ----
  let lastScanAt = 0;
  let lastScanResult = '';
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

  // ---- 연속 광고 구분: 영상(주소+길이)이 바뀌거나 재생 위치가 되돌아가면 새 광고 → 5초 대기를 다시 시작 ----
  function trackSegment() {
    if (!video) return;
    let newSeg = false;
    const d = video.duration;
    if (isFinite(d) && d > 0) {
      const key = (video.currentSrc || '') + '|' + d.toFixed(1);
      if (segKey && key !== segKey) newSeg = true;
      segKey = key;
    }
    const t = video.currentTime || 0;
    if (t < lastTime - 1) newSeg = true;
    lastTime = t;
    if (newSeg) {
      segStart = Date.now();
      log('다음 광고 감지 → 5초 대기 다시 시작');
    }
  }

  // ---- 메인 루프 ----
  let ticking = false;
  let lastTickAt = 0;
  function tick() {
    const t = Date.now();
    if (ticking || t - lastTickAt < 50) return;
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

  function startAd(reason) {
    const now = Date.now();
    wasAd = true;
    adStartAt = now;
    segStart = now;
    segKey = '';
    lastTime = video ? (video.currentTime || 0) : 0;
    lastClickAt = 0;
    clickedInBreak = false;
    missSince = 0;
    muteForAd();
    log('광고 시작:', reason, '→ 음소거, ' + (SKIP_WAIT_MS / 1000) + '초 후 건너뛰기 확인');
  }

  function endAd(why) {
    hideOverlay();
    restoreMute();
    wasAd = false;
    missSince = 0;
    clickedInBreak = false;
    log('광고 종료' + (why ? ' (' + why + ')' : '') + ' → 음소거 해제');
  }

  function doTick() {
    if (!player || !player.isConnected) {
      attach();
      if (!player) return;
    }
    refreshVideo();

    const now = Date.now();
    let reason = detectAd();
    if (reason && reason !== 'class' && now < ignoreSoftUntil) reason = ''; // 본편 복귀 직후엔 잔여 요소 무시
    const adNow = !!reason;

    if (adNow && !wasAd) {
      startAd(reason);
    } else if (adNow) {
      missSince = 0;
    } else if (wasAd) {
      // 감지가 잠깐 끊겨도 바로 종료하지 않음
      if (!missSince) missSince = now;
      if (now - missSince >= AD_END_CONFIRM_MS) endAd();
    }

    if (!wasAd) {
      if (!adMuted) normalMuted = isMuted(); // 광고가 아닐 때 현재 음소거 상태를 계속 기억
      return;
    }

    // 건너뛰기 클릭 후 광고 플레이어 클래스가 사라졌다면 본편으로 복귀한 것 → 소리를 바로 복원
    if (adNow && clickedInBreak && reason !== 'class' && now - lastClickAt > 300) {
      ignoreSoftUntil = now + 2000;
      endAd('본편 복귀');
      return;
    }

    showOverlay();
    if (adNow) muteForAd(); // 광고 중 음소거 유지
    trackSegment();

    // 광고마다 5초 대기 후 건너뛰기 버튼이 보이면 클릭 (버튼이 없으면 아무것도 안 함: 음소거만 유지)
    if (adNow && now - segStart >= SKIP_WAIT_MS && now - lastClickAt >= CLICK_RETRY_MS) {
      if (trySkipClick(now)) {
        lastClickAt = now;
        clickedInBreak = true;
      }
    }
  }

  function attach() {
    const p = document.getElementById('movie_player');
    if (!p) return;

    if (p === player) return;
    if (classObserver) classObserver.disconnect();
    missSince = 0;
    hideOverlay();
    if (adMuted) restoreMute();
    player = p;
    wasAd = false;
    clickedInBreak = false;
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
    }
  });
  document.addEventListener('yt-navigate-finish', attach);

  attach();
  setInterval(tick, CHECK_INTERVAL_MS);
})();
