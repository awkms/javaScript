// ==UserScript==
// @name         YouTube/Netflix 광고 자동 처리
// @namespace    local.john
// @version      1.7.2
// @description  YouTube: 광고 시 음소거+10배속, 1초 간격 최대 6회 '건너뛰기' 클릭 후 음소거/속도 복원 + '광고중(초)' 표시 + 홈 '스폰서' 숨김 / Netflix: 광고 시 음소거+10배속, 광고 종료 시 복원
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

  const AD_RATE = 10; // 광고 중 재생 속도 (유튜브/넷플릭스 공통)

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

  // 2) 영상 광고 처리
  //    - 광고 판별: ① 플레이어 클래스 ② 광고 전용 요소 ③ '건너뛰기' 버튼 텍스트 ④ '스폰서/광고' 라벨
  //    - 광고 시작: 음소거 + 10배속 (광고 직전 속도 기억)
  //    - 1초 간격으로 '건너뛰기' 버튼 확인(최대 6회) → 보이면 클릭 + 음소거 해제 + 속도 복원
  //    - 건너뛰기를 못 눌렀어도 광고가 끝나면 음소거/속도 복원
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

  const CHECK_INTERVAL_MS = 100;  // 상시 감시 주기
  const SKIP_POLL_MS = 150;       // 건너뛰기 버튼 확인 간격
  const SKIP_MAX_CHECKS = 40;     // 광고 1건당 최대 확인 횟수(버튼이 아직 안 보일 때만 카운트) ≈ 6초
  const SKIP_WAIT_MAX_CHECKS = 270; // 버튼은 보이지만 아직 '클릭 가능' 상태가 아닐 때 기다리는 최대 횟수 ≈ 40초
  const SKIP_FORCE_AFTER = 27;    // 이 횟수 넘게 기다려도 '클릭 가능' 표식이 없으면 그냥 눌러 봄(마크업 변경 대비)
  const MAX_AD_SECONDS = 600;     // 플레이어가 '광고 상태'로 확실하지 않을 때만 적용하는 안전장치 (광고 클래스가 있으면 길이 제한 없음)
  const AD_END_CONFIRM_MS = 700;  // 광고 감지가 이 시간 이상 끊겨야 '광고 종료'로 판단 (감지 깜빡임으로 폴링/오버레이가 초기화되는 것 방지)
  const RECHECK_AFTER_SKIP_MS = 300; // 건너뛰기 클릭 후에도 광고 상태가 이어지면 다음(연속) 광고로 간주

  let player = null;
  let video = null;
  let classObserver = null;
  let wasAd = false;

  // 음소거 / 재생속도 복원용
  let adMuted = false;
  let prevMuted = false;
  let rateChanged = false;
  let prevRate = 1;
  let normalRate = 1; // 광고가 아닐 때 계속 갱신되는 '현재 정상 속도'

  // 광고 1건 처리 상태
  let adHandled = false;   // 건너뛰기 성공 → 새 광고가 감지되기 전까지 다시 음소거/가속하지 않음
  let recheckAt = 0;
  let skipTimer = null;
  let missSince = 0;       // 광고 감지가 끊기기 시작한 시각
  let skipClick = null;    // 건너뛰기 클릭 시점의 영상 상태(클릭이 실제로 광고를 끝냈는지 확인용)

  // 연속 광고(새 광고) 감지용
  let normalMuted = false; // 광고가 아닐 때 계속 갱신되는 '현재 음소거 상태'

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
    if (v && v !== video) {
      video = v;
      v.addEventListener('ended', onVideoEnded);
    } else if (v) {
      video = v;
    }
  }
  // 광고 영상이 끝난 순간 바로 건너뛰기 시도 (주기 루프를 기다리지 않음)
  function onVideoEnded() {
    if (!wasAd) return;
    lastEndClickAt = 0;
    clickWhileEndCard();
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
      prevMuted = normalMuted; // 광고 직전에 기억해 둔 음소거 상태 (unMute 지연으로 인한 오판 방지)
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
  function trackNormalRate() {
    if (video && !rateChanged && video.playbackRate !== AD_RATE) {
      normalRate = video.playbackRate || 1;
    }
  }
  function speedUpForAd() {
    if (!video) return;
    if (!rateChanged) {
      prevRate = normalRate; // 광고 직전에 기억해 둔 속도
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
    // 실제 버튼만 대상으로 함 (버튼을 감싼 컨테이너는 카운트다운 중에도 보여서 오클릭 위험)
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

  // 버튼이 실제로 '눌러도 되는' 상태인가?
  // 연속 광고에서는 버튼이 DOM에 보이지만 아직 활성화 전(ytp-ad-component--clickable 없음)인 경우가 있고,
  // 이때 누르면 아무 일도 안 일어나는데 '성공'으로 착각해서 폴링/속도 복원이 꼬였음.
  function isSkipReady(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    return el.classList.contains('ytp-ad-component--clickable') ||
           !!el.closest('.ytp-ad-component--clickable');
  }

  // 반환: { found: 버튼 보임, ready: 활성 버튼을 눌렀음, clicked: 무엇이든 눌렀음 }
  function clickSkipButton(allowUnready, quiet) {
    const targets = findSkipTargets();
    if (targets.length === 0) return { found: false, ready: false, clicked: false };
    const readyTarget = targets.find(isSkipReady);
    const t0 = readyTarget || (allowUnready ? targets[0] : null);
    if (!t0) return { found: true, ready: false, clicked: false };
    if (!quiet) {
      log('클릭 대상:', t0.tagName, t0.className, (t0.textContent || '').trim().slice(0, 20),
          readyTarget ? '(활성)' : '(활성 표식 없음)');
    }
    pressElement(t0); // 한 번에 하나만 클릭 (중복 클릭으로 다음 광고까지 눌리는 것 방지)
    return { found: true, ready: !!readyTarget, clicked: true };
  }

  // ---- 건너뛰기 폴링: 1초 간격, 최대 6회 ----
  function stopSkipPolling() {
    if (skipTimer) { clearInterval(skipTimer); skipTimer = null; }
  }

  function onSkipped() {
    skipClick = video ? { t: video.currentTime, d: video.duration, src: video.currentSrc || '', at: Date.now() } : null;
    adHandled = true;
    recheckAt = Date.now() + RECHECK_AFTER_SKIP_MS;
    // 클릭만으로는 광고가 실제로 끝났는지 알 수 없으므로 음소거/가속은 유지하고,
    // 광고 상태가 사라지는 순간(아래 doTick)에 복원한다.
    log('건너뛰기 클릭 (음소거·가속 유지, 광고 상태가 끝나면 복원)');
  }

  // ---- 광고 영상은 끝났는데 종료 화면(스폰서 카드)이 남아 대기하는 경우 ----
  // 영상이 끝난 뒤에는 건너뛰기 버튼이 유일한 탈출구이므로, 확인 횟수(6회) 제한 없이 짧은 간격으로 계속 클릭
  let lastEndClickAt = 0;
  let endCardLogged = false;
  // 대기가 길어질 때 원인 파악용 상태 덤프 (1초에 최대 1번)
  // 광고 영상이 이미 사라지고(duration NaN, readyState 0) 플레이어가 ended-mode인 상태 = YouTube가 다음 단계를 준비하는 중.
  // 이 상태에서는 건너뛸 영상이 없으므로 '다음 광고' 재시작/강제 클릭을 반복하지 않고, 활성 버튼만 가끔 누르며 대기 시간을 측정한다.
  let endWaitSince = 0;
  function isEndCardWait() {
    if (!player || !video || !player.classList.contains('ended-mode')) return false;
    const d = video.duration;
    return !isFinite(d) || video.readyState === 0;
  }
  let lastDiagAt = 0;
  function diag(tag) {
    const now = Date.now();
    if (now - lastDiagAt < 1000) return;
    lastDiagAt = now;
    const b = findSkipTargets()[0];
    log('진단', tag,
      'ended=' + (video && video.ended),
      't=' + (video ? video.currentTime.toFixed(1) : '-') + '/' + (video ? video.duration : '-'),
      'rate=' + (video && video.playbackRate),
      'paused=' + (video && video.paused),
      'rs=' + (video && video.readyState),
      'player=' + (player ? player.className.replace(/\s+/g, '.') : '-'),
      'btn=' + (b ? b.className.replace(/\s+/g, '.') + ' dis=' + b.disabled + ' aria=' + b.getAttribute('aria-disabled') +
                    ' txt=' + (b.textContent || '').trim().slice(0, 20) : '없음'));
  }
  function adVideoEnded() {
    if (!video) return false;
    if (video.ended) return true;
    const d = video.duration;
    return isFinite(d) && d > 0 && (d <= MAX_AD_SECONDS || isHardAd()) && video.currentTime >= d - 0.3;
  }
  function clickWhileEndCard() {
    if (!adVideoEnded()) { endCardLogged = false; return; }
    const now = Date.now();
    if (now - lastEndClickAt < 120) return;
    lastEndClickAt = now;
    if (!endCardLogged) {
      endCardLogged = true;
      log('광고 영상 종료 상태에서 대기 중 → 건너뛰기 반복 클릭');
    }
    clickSkipButton(true); // 영상이 끝난 뒤엔 유일한 탈출구라 활성 표식이 없어도 누름
  }

  // ---- 클릭이 안 먹혔을 때의 보조: 광고 영상을 끝으로 ----
  function isHardAd() {
    return !!player && (player.classList.contains('ad-showing') ||
                        player.classList.contains('ad-interrupting'));
  }
  let lastSeekAt = 0;
  let lastIneffLogAt = 0;
  function seekAdToEnd() {
    if (!video || !isHardAd()) return; // 확실한 광고 상태(플레이어 클래스)일 때만
    const now = Date.now();
    if (now - lastSeekAt < 300) return;
    lastSeekAt = now;
    const d = video.duration;
    if (isFinite(d) && d > 0 && video.currentTime < d - 0.2) { // isHardAd()가 보장되므로 10분 넘는 광고도 처리
      try { video.currentTime = d; } catch (e) { /* 무시 */ }
    }
  }
  // 클릭 후에도 같은 광고가 계속 재생 중인가? (영상 주소/길이가 같고 재생 위치가 되돌아가지 않음)
  // 클릭 이후 영상이 실제로 바뀌었는가? (주소/길이가 달라졌거나 재생 위치가 되돌아감) → 고정 대기 없이 즉시 다음 광고 처리
  function adChanged() {
    if (!video || !skipClick) return false;
    if ((video.currentSrc || '') !== skipClick.src) return true;
    const d = video.duration;
    if (isFinite(d) && isFinite(skipClick.d) && Math.abs(d - skipClick.d) > 0.5) return true;
    return video.currentTime < skipClick.t - 0.5;
  }
  function clickWasIneffective() {
    if (!video || !skipClick) return false;
    const d = video.duration;
    return isFinite(d) && Math.abs(d - skipClick.d) <= 0.5 &&
           video.currentTime >= skipClick.t - 0.5 &&
           (video.currentSrc || '') === skipClick.src;
  }

  function startSkipPolling() {
    stopSkipPolling();
    let n = 0;       // 버튼이 안 보인 횟수
    let waited = 0;  // 버튼은 보이는데 아직 활성 전인 횟수
    const step = () => {
      if (!wasAd || !player) { log('건너뛰기 확인 중단: 광고 아님'); stopSkipPolling(); return; }
      const res = clickSkipButton(waited >= SKIP_FORCE_AFTER && !isEndCardWait()); // 종료 화면 대기 중엔 비활성 버튼 강제 클릭 안 함
      if (res.ready) {
        stopSkipPolling();
        onSkipped();
        return;
      }
      if (res.found) {
        // 버튼이 보이지만 아직 활성 전 → 성공으로 치지 않고 계속 기다림 (음소거/가속 유지)
        waited++;
        if (waited === 1 || waited % 13 === 0) log('건너뛰기 버튼 활성 대기', waited + '/' + SKIP_WAIT_MAX_CHECKS + (res.clicked ? ' (강제 클릭)' : ''));
        if (waited >= SKIP_WAIT_MAX_CHECKS) { log('건너뛰기 대기 종료'); stopSkipPolling(); }
        return;
      }
      n++;
      if (n === 1 || n % 13 === 0) log('건너뛰기 확인', n + '/' + SKIP_MAX_CHECKS);
      if (n >= SKIP_MAX_CHECKS) { log('건너뛰기 확인 ' + SKIP_MAX_CHECKS + '회 종료'); stopSkipPolling(); }
    };
    skipTimer = setInterval(step, SKIP_POLL_MS);
    step(); // 첫 확인을 간격만큼 기다리지 않고 즉시 수행
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
    adStartAt = Date.now();
    lastShownSec = -1;
    adHandled = false;
    endCardLogged = false;
    log('광고 시작:', reason, '이전 속도', normalRate);
  }


  // 연속 광고: 음소거/가속/건너뛰기 확인을 처음부터 다시 시작
  // (광고중 초 표시는 이어서 증가시키고, 되돌아가지 않도록 adStartAt은 유지)
  function beginNextAd() {
    const keepStart = adStartAt;
    startAd('next-ad');
    adStartAt = keepStart;
    muteForAd();
    speedUpForAd();
    startSkipPolling();
  }

  function endAd() {
    stopSkipPolling();
    hideOverlay();
    restoreMute();
    restoreRate();
    adHandled = false;
    log('광고 종료');
  }

  function doTick() {
    if (!player || !player.isConnected) {
      attach();
      if (!player) return;
    }
    refreshVideo();

    const reason = detectAd();
    const adNow = !!reason;

    if (adNow) missSince = 0;

    if (adNow && !wasAd) {
      wasAd = true; // startSkipPolling이 wasAd를 확인하므로 먼저 설정
      startAd(reason);
      muteForAd();
      speedUpForAd();
      startSkipPolling();
    } else if (!adNow && wasAd) {
      // 감지가 잠깐 끊겨도 바로 종료하지 않음 (끊기는 동안엔 속도만 복원해 실제 영상이 빨리 넘어가지 않게 함)
      if (!missSince) {
        missSince = Date.now();
        restoreRate();
        if (adHandled) restoreMute(); // 스킵 성공 후 광고가 사라졌으면 소리도 바로 복원
      }
      if (Date.now() - missSince >= AD_END_CONFIRM_MS) {
        wasAd = false;
        missSince = 0;
        endAd();
      }
    }

    if (wasAd) {
      showOverlay();
      const recheckDue = Date.now() > recheckAt;
      const endWait = adNow && isEndCardWait();
      if (endWait) {
        if (!endWaitSince) {
          endWaitSince = Date.now();
          log('종료 화면 대기 시작 (광고 영상 없음 · YouTube가 다음 단계를 준비 중)');
        }
        muteForAd();
        speedUpForAd();
        if (Date.now() - lastEndClickAt >= 300) { // 활성 버튼만, 조용히
          lastEndClickAt = Date.now();
          clickSkipButton(false, true);
        }
      } else if (endWaitSince) {
        log('종료 화면 대기 끝: ' + ((Date.now() - endWaitSince) / 1000).toFixed(1) + '초');
        endWaitSince = 0;
      }
      if (endWait) {
        // 위에서 처리 완료 (아래 분기 건너뜀)
      } else if (adNow && adHandled && !isHardAd()) {
        // 클릭 후 광고 플레이어 클래스가 사라짐 = 본편으로 돌아가는 중 → 본편이 빨리 지나가지 않게 즉시 복원
        restoreRate();
        restoreMute();
      } else if (adNow && adHandled && skipClick && Date.now() - skipClick.at > 60 && adChanged()) {
        // 영상이 실제로 바뀜 → 고정 대기 없이 곧바로 다음 광고 처리 시작
        beginNextAd();
      } else if (adNow && adHandled && recheckDue && clickWasIneffective()) {
        // 클릭했는데 같은 광고가 계속 재생 중 → 클릭이 먹히지 않은 것: 음소거+가속 후 광고를 끝으로 보냄
        if (Date.now() - lastIneffLogAt > 2000) {
          lastIneffLogAt = Date.now();
          log('클릭이 광고를 끝내지 못함 → 광고 끝으로 이동',
              'd=' + (video ? video.duration : '-') + ' t=' + (video ? video.currentTime.toFixed(1) : '-'));
        }
        muteForAd();
        speedUpForAd();
        seekAdToEnd();
        recheckAt = Date.now() + RECHECK_AFTER_SKIP_MS;
      } else if (adNow && adHandled && recheckDue) {
        // 변화를 판별할 수 없지만 광고 상태가 이어짐 → 연속 광고로 간주
        beginNextAd();
      } else if (adNow) {
        muteForAd();     // 광고 중 음소거 유지 (클릭 직후 대기 중에도)
        speedUpForAd();  // 광고 중 10배속 유지 (YouTube가 되돌려도 재적용)
      }
      if (adNow && !endWait) clickWhileEndCard(); // 영상이 끝난 뒤 종료 화면 대기 단축 (플레이어 클래스가 바뀌어도 계속 시도)
      if (adNow) diag(adVideoEnded() ? '영상종료' : '진행');
    } else {
      trackNormalRate(); // 광고가 아닐 때 현재 속도/음소거 상태를 계속 기억
      if (!adMuted) normalMuted = isMuted();
    }
  }

  function attach() {
    const p = document.getElementById('movie_player');
    if (!p) return;

    if (p === player) return;
    if (classObserver) classObserver.disconnect();
    stopSkipPolling();
    missSince = 0;
    hideOverlay();
    if (adMuted) restoreMute();
    restoreRate();
    player = p;
    wasAd = false;
    adHandled = false;
    refreshVideo();
    trackNormalRate();
    classObserver = new MutationObserver(tick);
    classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    tick();
  }

  // 광고 도중 다른 영상으로 이동해도 음소거/표시가 남지 않도록 정리
  document.addEventListener('yt-navigate-start', () => {
    if (!detectAd()) {
      stopSkipPolling();
      hideOverlay();
      restoreMute();
      restoreRate();
    }
  });
  document.addEventListener('yt-navigate-finish', attach);

  attach();
  setInterval(tick, CHECK_INTERVAL_MS);
})();
