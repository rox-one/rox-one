/**
 * Acquisition stage barrels.
 *
 * The frozen record shapes (`DetectedBrowser`, `ScannedBrowserProfile`,
 * `StagedProfile`, …) live in `../types.ts`; this barrel exposes only the
 * acquisition entry points and their option bags.
 */

export {
  detectBrowsers,
  defaultProfileFs,
  displayNameForVendor,
  executableCandidates,
  readChromiumVersion,
  vendorForChromiumRoot,
  vendorForFirefoxRoot,
  type BrowserDetectorOptions,
} from './browserDetector.ts'
export { scanProfiles, type ProfileScannerOptions } from './profileScanner.ts'
export {
  ShadowCopyService,
  cleanupAllStaging,
  cleanupStagingDir,
  shadowCopyProfile,
  stagingBytes,
  type ShadowCopyServiceOptions,
} from './shadowCopy.ts'