const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withWearManifest(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest
    manifest['uses-permission'] = [
      ...(manifest['uses-permission'] ?? []).filter(
        (permission) => permission.$?.['android:name'] !== 'android.permission.INTERNET'
      ),
      { $: { 'android:name': 'android.permission.INTERNET' } }
    ]
    const features = manifest['uses-feature'] ?? []
    manifest['uses-feature'] = [
      ...features.filter(
        (feature) =>
          feature.$?.['android:name'] !== 'android.hardware.type.watch' &&
          feature.$?.['android:name'] !== 'android.hardware.touchscreen'
      ),
      {
        $: {
          'android:name': 'android.hardware.type.watch',
          'android:required': 'true'
        }
      },
      {
        $: {
          'android:name': 'android.hardware.touchscreen',
          'android:required': 'false'
        }
      }
    ]
    const application = manifest.application?.[0]
    if (application) {
      const metadata = application['meta-data'] ?? []
      application['meta-data'] = metadata.map((entry) =>
        entry.$?.['android:name'] === 'com.google.android.wearable.standalone'
          ? { $: { ...entry.$, 'android:value': 'true' } }
          : entry
      )
    }

    return configWithManifest
  })
}
