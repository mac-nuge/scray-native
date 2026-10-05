const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';
// native 15.122: the Remote app - built like BBW iPlayer (release config, no
// Metro), but its web layer loads from the web-staging folder that
// deploy-web-staging.yml fills, so a web change merged to staging shows on the
// phone without an IPA build. Swapped in for the Dev app in SideStore
// (deactivate one, activate the other) - a free Apple ID allows 3 apps.
const IS_REMOTE_VARIANT = process.env.APP_VARIANT === 'remote';

// The IPA's identity is just the GitHub Actions run number, passed in as
// IPA_BUILD_NUMBER and stored as CFBundleVersion — nothing to maintain by
// hand. Web assets version separately in assets/web/VERSION.

// CHANGING THE ICONS AND APP NAMES
//step 1. change the name of the app in name: IS_DEV_VARIANT
// step 2. change the icon with config.ios with the name of the file in assets/images


const buildNumber = String(process.env.IPA_BUILD_NUMBER || '1');

// ⚙️ Release launch screen: black in light and dark mode, and a transparent
// image - expo-splash-screen wants one, so this is a blank 16x16 PNG.
const RELEASE_SPLASH = ['expo-splash-screen', {
  backgroundColor: '#000000',
  image: './assets/images/splash-blank.png',
  imageWidth: 1,
  dark: { backgroundColor: '#000000', image: './assets/images/splash-blank.png' },
}];

module.exports = ({ config }) => {
  return {
    ...config,
    name: IS_DEV_VARIANT ? 'Scray Picker (Dev)'
      : IS_REMOTE_VARIANT ? 'Scray Picker (Remote)'
      : 'BBW iPlayer',
    // native 15.101: a version per IPA build (1.0.<run number>), so SideStore
    // sees each build as an update - it compares this, and checks the IPA
    // against what its source lists. Was 1.0.0 for every build.
    version: `1.0.${buildNumber}`,
    // The Remote app keeps the Dev app's icon - only one of the two is ever
    // installed at a time.
    ...(IS_DEV_VARIANT || IS_REMOTE_VARIANT ? {} : { icon: './assets/images/icon-release-iplayer.png' }),
    // The offline/release app must not claim the dev-client link
    // (exp+scray-native://), or scanning Metro's QR code opens it instead of
    // Scray Picker (Dev). Listing expo-dev-client here stops the automatic
    // copy of the plugin from running with its default settings.
    //
    // The release app's launch screen is plain black - no blue, no Expo logo
    // (native 14.2). The dev app keeps app.json's blue splash, which also
    // makes the two easy to tell apart at launch. Swapped in place so the
    // plugin still runs once, in the same position.
    plugins: IS_DEV_VARIANT
      ? config.plugins
      : [
          ...(config.plugins || []).map(p =>
            (Array.isArray(p) ? p[0] : p) === 'expo-splash-screen' ? RELEASE_SPLASH : p),
          ['expo-dev-client', { addGeneratedScheme: false }],
        ],
    // Root view colour behind the web view while it loads - black too, so
    // there's no flash between the splash and the page.
    ...(IS_DEV_VARIANT ? {} : { backgroundColor: '#000000' }),
    ios: {
      ...config.ios,
      ...(IS_DEV_VARIANT || IS_REMOTE_VARIANT ? {} : { icon: './assets/images/icon-release-iplayer.png' }),
      buildNumber,
      bundleIdentifier: IS_DEV_VARIANT ? 'com.mac.scraynative.dev'
        : IS_REMOTE_VARIANT ? 'com.mac.scraynative.remote'
        : 'com.mac.scraynative',
      // native 15.122: where the Remote app loads its web layer from - the
      // WEB_STAGING_URL secret, passed in by build-ios-remote.yml. Read by
      // ScrayNativeView.loadSource; empty (every other build) = the bundled
      // copy, as before. Kept out of the repo because the folder name is
      // what keeps the device key it serves private.
      ...(IS_REMOTE_VARIANT ? {
        infoPlist: {
          ...((config.ios && config.ios.infoPlist) || {}),
          ScrayRemoteWebURL: process.env.SCRAY_REMOTE_WEB_URL || '',
        },
      } : {}),
    },
  };
};