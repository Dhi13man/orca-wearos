const { withDangerousMod } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')

/** RN 0.87 AGP requires Gradle >= 9.4.1; Expo prebuild still templates 9.0.0. */
module.exports = function withGradleWrapper(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const wrapper = path.join(
        cfg.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      )
      if (!fs.existsSync(wrapper)) {
        return cfg
      }
      const next = fs
        .readFileSync(wrapper, 'utf8')
        .replace(/gradle-\d+(?:\.\d+)*-(bin|all)\.zip/g, 'gradle-9.4.1-$1.zip')
      fs.writeFileSync(wrapper, next)
      return cfg
    }
  ])
}
