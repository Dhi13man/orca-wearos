const {
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle
} = require('expo/config-plugins')
const { copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const CONFIG_FILE = 'google-services.json'

function hasConfig(config) {
  return existsSync(join(config.modRequest.projectRoot, CONFIG_FILE))
}

module.exports = function withWearFirebase(config) {
  config = withProjectBuildGradle(config, (next) => {
    if (hasConfig(next) && !next.modResults.contents.includes('com.google.gms:google-services')) {
      if (
        !next.modResults.contents.includes(
          "classpath('com.facebook.react:react-native-gradle-plugin')"
        )
      ) {
        throw new Error('Wear Firebase setup: project Gradle plugin anchor missing')
      }
      next.modResults.contents = next.modResults.contents.replace(
        "classpath('com.facebook.react:react-native-gradle-plugin')",
        "classpath('com.facebook.react:react-native-gradle-plugin')\n    classpath('com.google.gms:google-services:4.5.0')"
      )
    }
    return next
  })
  config = withAppBuildGradle(config, (next) => {
    if (
      hasConfig(next) &&
      !next.modResults.contents.includes('apply plugin: "com.google.gms.google-services"')
    ) {
      if (!next.modResults.contents.includes('apply plugin: "com.android.application"')) {
        throw new Error('Wear Firebase setup: app Gradle plugin anchor missing')
      }
      next.modResults.contents = next.modResults.contents.replace(
        'apply plugin: "com.android.application"',
        'apply plugin: "com.android.application"\napply plugin: "com.google.gms.google-services"'
      )
    }
    return next
  })
  return withDangerousMod(config, [
    'android',
    (next) => {
      if (hasConfig(next)) {
        copyFileSync(
          join(next.modRequest.projectRoot, CONFIG_FILE),
          join(next.modRequest.platformProjectRoot, 'app', CONFIG_FILE)
        )
      }
      return next
    }
  ])
}
