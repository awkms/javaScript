// ==UserScript==
// @name         YouTube 광고 건너뛰기 자동 클릭
// @namespace    local.john
// @version      1.2
// @description  광고 건너뛰기 자동 처리 + 광고 후 재생 위치 복원 (광고 재생 중에만 폴링하여 CPU/메모리 사용 최소화)
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

  // true: 버튼을 기다리지 않고 광고 영상을 즉시 끝으로 넘김
  // false: 버튼이 나타난 뒤에만 클릭
  const FAST_FORWARD = true;

  // 이 길이(초)보다 긴 영상은 광고가 아니라고 보고 점프하지 않음 (라이브 되감기 대비)
  const MAX_AD_SECONDS = 180;

  // true: 광고 시작 직전 재생 위치를 기억했다가 광고 후 그 위치로 되돌림
  const RESTORE_POSITION = true;
  // 광고 시작 시점 기준 이 시간(ms)보다 이전에 기록된 위치를 사용
  // (광고로 바뀌는 순간 기록이 오염되는 것을 방지; 복원 시 최대 이만큼 앞부분이 다시 재생됨)
  const SAMPLE_LAG_MS = 1500;
  // 광고 후 위치가 기억한 위치보다 이 값(초) 넘게 앞서 있을 때만 되돌림
  const RESUME_TOLERANCE = 2;

  let player = null;
  let video = null;
  let classObserver = null;
  let timer = null;
  let wasAd = false;
  let samples = [];     // [{at: 시각(ms), pos: 재생위치(초)}] 최근 10초분
  let savedPos = null;  // 광고 시작 직전 재생 위치

  function isVisible(el) {
    return !!el && el.getClientRects().length > 0 &&
           getComputedStyle(el).visibility !== 'hidden';
  }

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
    samples.push({ at: now, pos: video.currentTime });
    while (samples.length && now - samples[0].at > 10000) samples.shift();
  }

  function onAdStart() {
    savedPos = null;
    if (!RESTORE_POSITION || !samples.length) return;
    const limit = Date.now() - SAMPLE_LAG_MS;
    let pick = samples[0];
    for (const s of samples) {
      if (s.at <= limit) pick = s;
      else break;
    }
    savedPos = pick.pos;
  }

  function onAdEnd() {
    const target = savedPos;
    savedPos = null;
    if (target == null || !video) return;
    let tries = 0;
    // YouTube가 자체적으로 위치를 잡는 시간을 고려해 몇 번만 확인
    const tick = () => {
      if (!player || player.classList.contains('ad-showing')) return; // 다음 광고 시작됨
      if (video.currentTime > target + RESUME_TOLERANCE && inSeekable(video, target)) {
        video.currentTime = target;
      }
      if (++tries < 4) setTimeout(tick, 400);
    };
    setTimeout(tick, 100);
  }

  // ---- 광고 건너뛰기 ----
  function trySkip() {
    if (!player) return;
    if (FAST_FORWARD && video &&
        isFinite(video.duration) && video.duration > 0 &&
        video.duration <= MAX_AD_SECONDS &&
        video.currentTime < video.duration - 0.1) {
      video.currentTime = video.duration;
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
    const adNow = !!player && player.classList.contains('ad-showing');
    if (adNow && !wasAd) onAdStart();
    else if (!adNow && wasAd) onAdEnd();
    wasAd = adNow;
    if (adNow) startPolling();
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
    // 플레이어의 class 속성 변화(ad-showing 추가/제거)만 감시 — 부하 거의 없음
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
