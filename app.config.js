const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';

// The IPA's identity is just the GitHub Actions run number, passed in as
// IPA_BUILD_NUMBER and stored as CFBundleVersion — nothing to maintain by
// hand. Web assets version separately in assets/web/VERSION.

// CHANGING THE ICONS AND APP NAMES
//step 1. change the name of the app in name: IS_DEV_VARIANT
// step 2. change the icon with config.ios with the name of the file in assets/images


const buildNumber = String(process.env.IPA_BUILD_NUMBER || '1');

module.exports = ({ config }) => {
  return {
    ...config,
    name: IS_DEV_VARIANT ? 'Scray Picker (Dev)' : 'BBW iPlayer',
    ...(IS_DEV_VARIANT ? {} : { icon: './assets/images/icon-release-iplayer.png' }),
    // The offline/release app must not claim the dev-client link
    // (exp+scray-native://), or scanning Metro's QR code opens it instead of
    // Scray Picker (Dev). Listing expo-dev-client here stops the automatic
    // copy of the plugin from running with its default settings.
    plugins: IS_DEV_VARIANT
      ? config.plugins
      : [...(config.plugins || []), ['expo-dev-client', { addGeneratedScheme: false }]],
    ios: {
      ...config.ios,
      ...(IS_DEV_VARIANT ? {} : { icon: './assets/images/icon-release-iplayer.png' }),
      buildNumber,
      bundleIdentifier: IS_DEV_VARIANT
        ? 'com.mac.scraynative.dev'
        : 'com.mac.scraynative',
    },
  };
};