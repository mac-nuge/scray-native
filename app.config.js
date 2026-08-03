const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => {
  return {
    ...config,
    name: IS_DEV_VARIANT ? 'Scray Picker (Dev)' : 'Scray Picker',
    ios: {
      ...config.ios,
      bundleIdentifier: IS_DEV_VARIANT
        ? 'com.mac.scraynative.dev'
        : 'com.mac.scraynative',
    },
  };
};