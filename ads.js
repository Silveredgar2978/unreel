/* Loads Google AdSense only when a publisher ID is set in index.html */
(function () {
  const cfg = window.UNREEL_ADS || {};
  if (!/^ca-pub-\d+$/.test(cfg.client || '')) return;
  if (!document.querySelector('script[src*="adsbygoogle.js"]')) {
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + cfg.client;
  document.head.appendChild(s);
  }
  document.querySelectorAll('.ad[data-slot]').forEach(box => {
    const slot = (cfg.slots || {})[box.dataset.slot];
    if (!slot) return;
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.setAttribute('data-ad-client', cfg.client);
    ins.setAttribute('data-ad-slot', slot);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    box.appendChild(ins); box.classList.remove('hidden');
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
})();
