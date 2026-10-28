// ==UserScript==
// @name         YouTube 광고 건너뛰기 자동 클릭
// @namespace    local.john
// @version      1.3
// @description  광고 건너뛰기 자동 처리 + 광고 후 재생 위치 복원 + 홈 화면 '스폰서' 광고 썸네일 숨김
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // =====================================================================
  // 1) 홈/피드의 '스폰서' 광고 썸네일 숨김
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
  // 2) 영상 광고 건너뛰기 + 재생 위치 복원 (기존 기능)
  // =====================================================================
  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button-modern',
  ].join(',');

  const CHECK_INTERVAL_MS = 100; // 광고 중(및 직후)에만 폴링
  // 광고가 끝난 뒤에도 이 시간(ms) 동안은 남아 있는 건너뛰기 버튼을 계속 찾아 클릭
  const GRACE_MS = 8000;

  // true: 버튼을 기다리지 않고 광고 영상을 즉시 끝으로 넘김
  // false: 버튼이 나타난 뒤에만 클릭
  const FAST_FORWARD = true;

  // 이 길이(초)보다 긴 영상은 광고가 아니라고 보고 점프하지 않음 (라이브 되감기 대비)
  const MAX_AD_SECONDS = 180;

  // true: 광고 시작 직전 재생 위치를 기억했다가 광고 후 그 위치로 되돌림
  const RESTORE_POSITION = true;
  // 광고 시작 시점 기준 이 시간(ms)보다 이전에 기록된 위치를 사용
  const SAMPLE_LAG_MS = 1500;
  // 광고 후 위치가 기억한 위치보다 이 값(초) 넘게 앞서 있을 때만 되돌림
  const RESUME_TOLERANCE = 2;
  // true: 광고 시작 직전의 재생 속도를 기억했다가 광고 후 다시 적용
  const RESTORE_SPEED = true;

  let player = null;
  let video = null;
  let classObserver = null;
  let timer = null;
  let wasAd = false;
  let samples = [];     // [{at: 시각(ms), pos: 재생위치(초)}] 최근 10초분
  let savedPos = null;  // 광고 시작 직전 재생 위치
  let graceUntil = 0;   // 광고 종료 후 버튼 탐색을 계속할 시각(ms)
  let savedRate = null; // 광고 시작 직전 재생 속도

  function inSeekable(v, t) {
    const s = v.seekable;
    for (let i = 0; i < s.length; i++) {
      if (t >= s.start(i) && t <= s.end(i)) return true;
    }
    return false;
  }

  // ---- 재생 위치 기록 (광고가 아닐 때만) ----
  function onTimeUpdate() {
    if (!video || !player || player.classList.contains('ad-showing')) return;
    const now = Date.now();
    samples.push({ at: now, pos: video.currentTime, rate: video.playbackRate });
    while (samples.length && now - samples[0].at > 10000) samples.shift();
  }

  function onAdStart() {
    savedPos = null;
    savedRate = null;
    if (!samples.length) return;
    const limit = Date.now() - SAMPLE_LAG_MS;
    let pick = samples[0];
    for (const s of samples) {
      if (s.at <= limit) pick = s;
      else break;
    }
    if (RESTORE_POSITION) savedPos = pick.pos;
    if (RESTORE_SPEED) savedRate = pick.rate;
  }

  function onAdEnd() {
    const target = savedPos;
    const rate = savedRate;
    savedPos = null;
    savedRate = null;
    if ((target == null && rate == null) || !video) return;
    let tries = 0;
    // YouTube가 자체적으로 위치/속도를 잡는 시간을 고려해 몇 번 확인
    const tick = () => {
      if (!player || player.classList.contains('ad-showing')) return; // 다음 광고 시작됨
      if (target != null && video.currentTime > target + RESUME_TOLERANCE &&
          inSeekable(video, target)) {
        video.currentTime = target;
      }
      if (rate != null && video.playbackRate !== rate) {
        if (typeof player.setPlaybackRate === 'function') player.setPlaybackRate(rate);
        else video.playbackRate = rate;
      }
      if (++tries < 6) setTimeout(tick, 400);
    };
    setTimeout(tick, 100);
  }

  // ---- 광고 건너뛰기 ----
  function clickSkipButton() {
    if (!player) return;
    const btn = player.querySelector(SKIP_SELECTORS);
    if (btn) btn.click();
  }

  function trySkip() {
    if (!player) return;
    if (FAST_FORWARD && video &&
        isFinite(video.duration) && video.duration > 0 &&
        video.duration <= MAX_AD_SECONDS &&
        video.currentTime < video.duration - 0.1) {
      video.currentTime = video.duration;
    }
    clickSkipButton();
  }

  function pollTick() {
    if (player && player.classList.contains('ad-showing')) {
      trySkip();
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

  function onPlayerClassChange() {
    const adNow = !!player && player.classList.contains('ad-showing');
    if (adNow && !wasAd) onAdStart();
    else if (!adNow && wasAd) {
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
    if (v && v !== video) {
      if (video) video.removeEventListener('timeupdate', onTimeUpdate);
      video = v;
      video.addEventListener('timeupdate', onTimeUpdate);
    }

    if (p === player) return;
    if (classObserver) classObserver.disconnect();
    stopPolling();
    player = p;
    wasAd = false;
    samples = [];
    savedPos = null;
    savedRate = null;
    graceUntil = 0;
    classObserver = new MutationObserver(onPlayerClassChange);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    onPlayerClassChange();
  }

  // 다른 영상으로 이동하면 이전 영상의 위치 기록을 버림
  document.addEventListener('yt-navigate-start', () => {
    samples = [];
    savedPos = null;
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
})();
