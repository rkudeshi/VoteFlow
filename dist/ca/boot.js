/* /ca → statewide; /ca/<county> → one county (unknown counties fall back to /ca). */
(function () {
  const parts = location.pathname.toLowerCase().replace(/^\/+|\/+$/g, '').split('/');
  VF.mount('ca', { cid: parts[1] || null }, document.getElementById('app'));
})();
