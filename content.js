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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_REFERRER') {
    sendResponse({ referrer: document.referrer });
  }
});
