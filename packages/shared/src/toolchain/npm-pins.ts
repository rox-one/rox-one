/** Small verified metadata shared by main and renderer; dependency lock blobs stay server-side. */
export const ACPX_NPM_PIN = {
  "packageName": "acpx",
  "version": "0.19.4",
  "tarballUrl": "https://registry.npmjs.org/acpx/-/acpx-0.19.4.tgz",
  "tarballSha256": "ccb1e4ad1cb1468493769af3a2ba0df6aeffb4e1e176541f1f231f3ec5782311",
  "tarballIntegrity": "sha512-fN1c3Ype4LrwZoeJwcZEnyO+1ArThgymwswmJyd52dHKaz+3hjkR6lYdlyBPOZYIIcCVARezcfvkFUNxsylSBA==",
  "tarballSize": 658040,
  "requiredNodeRange": ">=22.13.0",
  "entrypoint": "dist/cli.js"
} as const;

export const OPENCLAW_NPM_PIN = {
  packageName: 'openclaw',
  version: '2026.7.1-2',
  tarballUrl: 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz',
  tarballSha256: '5bb525f36f471a41239615d321c441778c7e1c007018ed6d84b795be77803276',
  tarballIntegrity: 'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==',
  requiredNodeRange: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0',
  entrypoint: 'openclaw.mjs',
} as const;
