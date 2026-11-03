// ==UserScript==
// @name         YouTube 광고/스폰서 숨기기
// @namespace    https://tampermonkey.net/
// @version      2.0.0
// @description  YouTube의 스폰서/광고 영역을 숨깁니다. (건너뛰기 클릭, 배속/음소거 등 다른 기능은 없음)
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ---------- 1) CSS로 광고/스폰서 영역 숨기기 ---------- */
  const css = `
    ytd-ad-slot-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-display-ad-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-promoted-video-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    ytd-companion-slot-renderer,
    ytd-action-companion-ad-renderer,
    ytd-player-legacy-desktop-watch-ads-renderer,
    ytd-merch-shelf-renderer,
    #player-ads,
    #masthead-ad,
    .ytp-ad-overlay-container,
    .ytp-ad-overlay-slot,
    .ytp-ad-image-overlay,
    .ytp-ad-text-overlay,
    ytd-rich-item-renderer:has(ytd-ad-slot-renderer),
    ytd-rich-section-renderer:has(ytd-ad-slot-renderer) {
      display: none !important;
    }
  `;
  const style = document.createElement('style');
  style.id = 'yt-ad-cleaner-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  /* ---------- 2) '스폰서/광고' 배지가 붙은 카드 숨기기 ---------- */
  const SPONSOR_WORDS = ['스폰서', '광고', 'sponsored', 'ad'];
  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-compact-promoted-video-renderer',
    'ytd-promoted-video-renderer',
  ].join(',');
  const BADGE_SELECTORS = [
    'ad-badge-view-model',
    'ytd-badge-supported-renderer',
    '.badge-style-type-ad',
    '.ytd-ad-badge-renderer',
    'badge-shape',
    '#ad-badge',
    '.ytd-display-ad-renderer',
  ].join(',');

  function hideSponsoredCards() {
    document.querySelectorAll(CARD_SELECTORS).forEach((card) => {
      if (card.dataset.adChecked === '1') return;
      for (const b of card.querySelectorAll(BADGE_SELECTORS)) {
        const t = (b.textContent || '').trim().toLowerCase();
        if (t && SPONSOR_WORDS.includes(t)) {
          card.style.display = 'none';
          card.dataset.adChecked = '1';
          return;
        }
      }
    });
  }

  /* ---------- 3) 페이지 변경 시(스크롤/이동 등) 다시 검사 ---------- */
  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      hideSponsoredCards();
    }, 300);
  }

  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  schedule();
})();
