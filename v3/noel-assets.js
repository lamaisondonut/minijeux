/* Seasonal artwork map consumed by the original V3 scenery loader. */
(() => {
 'use strict';
 const base=document.currentScript?.src||document.baseURI;
 const paths=Object.freeze({
  'assets/forest-panorama.png':new URL('assets/noel/forest-panorama-noel.png',base).href,
  'assets/forest-landscape.png':new URL('assets/noel/forest-landscape-noel.png',base).href
 });
 window.BorealEmbeddedAssets={...window.BorealEmbeddedAssets,images:{...window.BorealEmbeddedAssets?.images,...paths}};
 window.BorealNoelAssets=Object.freeze({images:paths});
})();
