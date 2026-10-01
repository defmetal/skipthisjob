(function () {
  const A = globalThis.SkipThisJobAccess;
  const btn = document.getElementById('stj-enable');
  const msg = document.getElementById('stj-msg');

  function show(text, cls) {
    msg.textContent = text;
    msg.className = cls || '';
  }

  A.hasSiteAccess().then((ok) => {
    if (ok) {
      show('Access is already enabled. Open a LinkedIn or Indeed job to see scores.', 'ok');
      btn.disabled = true;
    }
  });

  // chrome.permissions.request must be called from the click handler.
  btn.addEventListener('click', () => {
    btn.disabled = true;
    A.requestSiteAccess(undefined, { reloadActiveTab: false }).then((res) => {
      if (res.granted) {
        show('Enabled! Reload any open LinkedIn or Indeed tabs (or open a job) to see scores.', 'ok');
      } else {
        btn.disabled = false;
        show('Access was not granted. You can try again, or enable it from chrome://extensions → Skip This Job → Details → Site access.', 'err');
      }
    });
  });
})();
