(function () {
  const LABEL_TEXT = {
    low: 'Worth Applying',
    moderate: 'Proceed with Caution',
    high: 'Likely a Waste of Time',
    very_high: 'Skip This Job',
  };
  const LABEL_COLORS = {
    low: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32' },
    moderate: { bg: '#fff3e0', border: '#ff9800', text: '#e65100' },
    high: { bg: '#fce4ec', border: '#f44336', text: '#c62828' },
    very_high: { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a' },
  };

  const scoreRoot = document.getElementById('stj-score');
  const helpRoot = document.getElementById('stj-help');

  function isJobHost(url) {
    return /linkedin\.com|indeed\.com/i.test(url || '');
  }

  function renderScore(state) {
    if (!scoreRoot || !state || state.score == null) return false;
    const color = LABEL_COLORS[state.label] || LABEL_COLORS.moderate;
    const signals = (state.signals || []).slice(0, 5)
      .map(s => '<li>' + escapeHtml(s) + '</li>')
      .join('');
    scoreRoot.style.display = 'block';
    scoreRoot.innerHTML =
      '<div class="score-card" style="border-left:4px solid ' + color.border + ';background:' + color.bg + ';">' +
        '<div class="score-num" style="color:' + color.text + ';">' + state.score + '<span>/100</span></div>' +
        '<div class="score-label" style="color:' + color.text + ';">' + (LABEL_TEXT[state.label] || state.label) + '</div>' +
        '<div class="score-job">' +
          '<strong>' + escapeHtml(state.title || 'Current listing') + '</strong>' +
          (state.companyName ? '<div>' + escapeHtml(state.companyName) + '</div>' : '') +
        '</div>' +
        (signals ? '<ul class="score-signals">' + signals + '</ul>' : '') +
      '</div>';
    if (helpRoot) helpRoot.style.display = 'none';
    return true;
  }

  function renderHelp(onJobSite) {
    if (scoreRoot) scoreRoot.style.display = 'none';
    if (!helpRoot) return;
    helpRoot.style.display = 'block';
    const status = helpRoot.querySelector('.status');
    if (status) {
      status.innerHTML = onJobSite
        ? 'On a job site — open a listing (or wait a moment) to see the live ghost score here.'
        : 'Browse any job listing on <strong>LinkedIn</strong> or <strong>Indeed</strong> and a ghost risk score will appear on the page and here.';
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sameSite(url, state) {
    if (!state || !state.platform) return isJobHost(url);
    if (state.platform === 'linkedin') return /linkedin\.com/i.test(url);
    if (state.platform === 'indeed') return /indeed\.com/i.test(url);
    return isJobHost(url);
  }

  function applyState(tabUrl, live, stored) {
    const onJobSite = isJobHost(tabUrl);
    const candidate = live && live.score != null ? live : stored;
    const fresh = candidate && candidate.updatedAt && (Date.now() - candidate.updatedAt < 30 * 60 * 1000);
    if (onJobSite && candidate && fresh && sameSite(tabUrl, candidate)) {
      renderScore(candidate);
    } else {
      renderHelp(onJobSite);
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const tabUrl = (tab && tab.url) || '';

    chrome.storage.local.get('stjActiveListing', (stored) => {
      const cached = stored && stored.stjActiveListing;

      if (tab && tab.id != null && isJobHost(tabUrl)) {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_SCORE' }, (response) => {
          const err = chrome.runtime.lastError;
          applyState(tabUrl, err ? null : response, cached);
        });
      } else {
        applyState(tabUrl, null, cached);
      }
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.stjActiveListing) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabUrl = (tabs && tabs[0] && tabs[0].url) || '';
      applyState(tabUrl, changes.stjActiveListing.newValue, changes.stjActiveListing.newValue);
    });
  });
})();
