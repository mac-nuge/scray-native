const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';

// The IPA's identity is just the GitHub Actions run number, passed in as
// IPA_BUILD_NUMBER and stored as CFBundleVersion — nothing to maintain by
// hand. Web assets version separately in assets/web/VERSION.
const buildNumber = String(process.env.IPA_BUILD_NUMBER || '1');

module.exports = ({ config }) => {
  return {
    ...config,
    name: IS_DEV_VARIANT ? 'Scray Picker (Dev)' : 'Scray Picker',
    ...(IS_DEV_VARIANT ? {} : { icon: './assets/images/icon-release.png' }),
    ios: {
      ...config.ios,
      ...(IS_DEV_VARIANT ? {} : { icon: './assets/images/icon-release.png' }),
      buildNumber,
      bundleIdentifier: IS_DEV_VARIANT
        ? 'com.mac.scraynative.dev'
        : 'com.mac.scraynative',
    },
  };
};