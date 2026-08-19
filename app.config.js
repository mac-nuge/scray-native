const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';

// IPA version numbers live in version_ipa.txt — one per variant, bumped by
// hand. Deliberately independent of assets/web/VERSION: the shell and the web
// payload version separately.
const { read: readIpaVersion } = require('./scripts/ipa-version');
const ipaVersion = readIpaVersion(IS_DEV_VARIANT ? 'dev' : 'prd');

// CI passes the run number so every build gets a unique CFBundleVersion.
const buildNumber = String(process.env.IPA_BUILD_NUMBER || '1');

module.exports = ({ config }) => {
  return {
    ...config,
    name: IS_DEV_VARIANT ? 'Scray Picker (Dev)' : 'Scray Picker',
    version: ipaVersion,
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