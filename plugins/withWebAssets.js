const { withXcodeProject } = require('@expo/config-plugins');

module.exports = function withWebAssets(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget().uuid;

    project.addBuildPhase(
      [],
      'PBXShellScriptBuildPhase',
      'Copy Web Assets',
      target,
      {
        shellPath: '/bin/sh',
        shellScript:
          'mkdir -p "${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/web" && cp -R "${SRCROOT}/../assets/web/." "${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/web/"',
      }
    );

    return config;
  });
};