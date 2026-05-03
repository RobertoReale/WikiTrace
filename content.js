'use strict';

let reported = false;

function checkBottom() {
  if (reported) return;
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 150) {
    reported = true;
    window.removeEventListener('scroll', checkBottom);
    chrome.runtime.sendMessage({ type: 'PAGE_SCROLL_BOTTOM', url: location.href });
  }
}

window.addEventListener('scroll', checkBottom, { passive: true });

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
