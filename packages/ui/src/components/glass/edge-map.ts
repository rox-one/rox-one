/**
 * Edge-lensing displacement map: neutral grey (no shift) across the body, with
 * the red (x) and green (y) channels ramping only in a thin band at each edge,
 * so the backdrop bends at the rim like a lens and stays undistorted inside.
 */
export const EDGE_MAP =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" preserveAspectRatio="none">' +
      '<linearGradient id="x"><stop offset="0" stop-color="#000"/><stop offset=".12" stop-color="#800000"/>' +
      '<stop offset=".88" stop-color="#800000"/><stop offset="1" stop-color="#f00"/></linearGradient>' +
      '<linearGradient id="y" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".12" stop-color="#008000"/>' +
      '<stop offset=".88" stop-color="#008000"/><stop offset="1" stop-color="#0f0"/></linearGradient>' +
      '<rect width="100" height="100" fill="url(#x)"/>' +
      '<rect width="100" height="100" fill="url(#y)" style="mix-blend-mode:screen"/></svg>',
  )

