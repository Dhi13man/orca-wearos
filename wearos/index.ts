import { registerRootComponent } from 'expo'
import { AppRegistry } from 'react-native'
import App from './App'
import { runBackgroundRefresh } from './src/orca/background-refresh'

registerRootComponent(App)
AppRegistry.registerHeadlessTask('OrcaWearDashboardRefresh', () => runBackgroundRefresh)
