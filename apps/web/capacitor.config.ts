import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cosmo.ledgertrack',
  appName: 'Kumon Ledger Track',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    Haptics: {},
    Preferences: {},
    LocalNotifications: {
      smallIcon: 'ic_launcher',
      iconColor: '#2B4C7E',
    },
  },
};

export default config;
