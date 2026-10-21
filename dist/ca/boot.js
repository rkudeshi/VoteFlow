/* /ca → statewide; /ca/about; /ca/<county> → one county (unknown counties fall back to /ca). */
(function () {
  const parts = location.pathname.toLowerCase().replace(/^\/+|\/+$/g, '').split('/');
  if (parts[1] === 'about') VF.mount('ca-about', {}, document.getElementById('app'));
  else VF.mount('ca', { cid: parts[1] || null }, document.getElementById('app'));
})();
