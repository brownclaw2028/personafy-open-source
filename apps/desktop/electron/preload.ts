import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  appVersion: process.env.npm_package_version ?? 'unknown',
});
