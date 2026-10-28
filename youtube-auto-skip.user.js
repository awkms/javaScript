// ==UserScript==
// @name         YouTube 광고 건너뛰기 자동 클릭
// @namespace    local.john
// @version      1.0
// @description  '건너뛰기' 버튼이 나타나면 자동으로 클릭 (광고 재생 중에만 동작하여 CPU/메모리 사용 최소화)
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SKIP_SELECTORS = [
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button-container button',
    'button.ytp-ad-skip-button-modern',
  ].join(',');

  const CHECK_INTERVAL_MS = 250; // 광고 중에만 폴링
  let player = null;
  let classObserver = null;
  let timer = null;

  function isVisible(el) {
    return !!el && el.getClientRects().length > 0 &&
           getComputedStyle(el).visibility !== 'hidden';
  }

  // true: 버튼을 기다리지 않고 광고 영상을 즉시 끝으로 넘김 (건너뛰기 불가 광고도 해당)
  // false: 버튼이 나타난 뒤에만 클릭 (기존 동작)
  const FAST_FORWARD = true;

  function trySkip() {
    if (!player) return;
    if (FAST_FORWARD) {
      const video = player.querySelector('video.html5-main-video');
      if (video && isFinite(video.duration) && video.duration > 0 &&
          video.currentTime < video.duration - 0.1) {
        video.currentTime = video.duration;
      }
    }
    const btn = player.querySelector(SKIP_SELECTORS);
    if (btn && isVisible(btn)) {
      btn.click();
    }
  }

  function startPolling() {
    if (timer) return;
    trySkip();
    timer = setInterval(() => {
      if (!player || !player.classList.contains('ad-showing')) {
        stopPolling();
        return;
      }
      trySkip();
    }, CHECK_INTERVAL_MS);
  }

  function stopPolling() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onPlayerClassChange() {
    if (player && player.classList.contains('ad-showing')) startPolling();
    else stopPolling();
  }

  function attach() {
    const p = document.getElementById('movie_player');
    if (!p || p === player) return;
    if (classObserver) classObserver.disconnect();
    stopPolling();
    player = p;
    // 플레이어의 class 속성 변화(ad-showing 추가/제거)만 감시 — 부하 거의 없음
    classObserver = new MutationObserver(onPlayerClassChange);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    onPlayerClassChange();
  }

  // 플레이어가 아직 없을 때 대비 + SPA 페이지 이동 대응
  document.addEventListener('yt-navigate-finish', attach);
  attach();
  if (!player) {
    const boot = setInterval(() => {
      attach();
      if (player) clearInterval(boot);
    }, 500);
  }
})();
