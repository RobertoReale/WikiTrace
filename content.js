'use strict';

let reported = false;

let scrollTimeout = null;

function checkBottom() {
  if (reported) return;
  try {
    const scrollY = window.scrollY;
    const innerHeight = window.innerHeight;
    const scrollHeight = document.documentElement.scrollHeight;
    
    if (scrollY + innerHeight >= scrollHeight - 150) {
      reported = true;
      window.removeEventListener('scroll', scheduleCheck);
      chrome.runtime.sendMessage({ type: 'PAGE_SCROLL_BOTTOM', url: location.href });
    }
  } catch (e) {
    // ignore
  }
}

function scheduleCheck() {
  if (reported || scrollTimeout) return;
  scrollTimeout = setTimeout(() => {
    scrollTimeout = null;
    checkBottom();
  }, 200);
}

window.addEventListener('scroll', scheduleCheck, { passive: true });
setTimeout(scheduleCheck, 1000);

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  try {
    const u = new URL(link.href);
    if (u.hostname.endsWith('wikipedia.org') && u.pathname.startsWith('/wiki/')) {
      const title = link.textContent.trim().slice(0, 300);
      if (title) chrome.runtime.sendMessage({ type: 'LINK_HINT', url: link.href, title });
    }
  } catch { /* ignore non-parseable hrefs */ }
}, { passive: true });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_REFERRER') {
    sendResponse({ referrer: document.referrer });
  }
});
