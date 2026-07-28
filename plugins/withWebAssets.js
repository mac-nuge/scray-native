const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

module.exports = function withWebAssets(config) {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const src = path.join(config.modRequest.projectRoot, 'assets', 'web');
      const dest = path.join(config.modRequest.platformProjectRoot, config.modRequest.projectName, 'web');
      copyRecursive(src, dest);
      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.getFirstTarget().uuid;
    project.addResourceFile('web', { target, lastKnownFileType: 'folder' });
    return config;
  });

  return config;
};