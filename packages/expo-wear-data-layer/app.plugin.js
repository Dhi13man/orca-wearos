const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withWearDataLayer(config, { role }) {
  if (role !== 'phone' && role !== 'watch') {
    throw new Error('Wear companion role must be phone or watch')
  }
  return withAndroidManifest(config, (result) => {
    const application = result.modResults.manifest.application?.[0]
    if (!application) {
      throw new Error('Android application manifest is missing')
    }
    const owned = ['dev.orca.wear.role']
    if (role === 'watch') {
      owned.push('com.google.android.wearable.standalone')
    }
    application['meta-data'] = [
      ...(application['meta-data'] ?? []).filter(
        (entry) => !owned.includes(entry.$?.['android:name'])
      ),
      { $: { 'android:name': 'dev.orca.wear.role', 'android:value': role } },
      ...(role === 'watch'
        ? [
            {
              $: {
                'android:name': 'com.google.android.wearable.standalone',
                'android:value': 'false'
              }
            }
          ]
        : [])
    ]
    return result
  })
}
