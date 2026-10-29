/*
 * The Pixel Exchange share market now lives in the Exchange's universe.js (from version 1.11.0), because from 1 March
 * 2027 the Exchange's history depends on it: every page that runs the Exchange must run the market too. This file is
 * kept so that pages which still load it keep working; it does nothing.
 */
(function (root) {
  if (!(root.PixelUniverse && root.PixelUniverse.shares) && root.console) root.console.warn('shares.js: load the Exchange universe.js, which now includes the share market');
})(typeof window !== 'undefined' ? window : globalThis);
