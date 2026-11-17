import fs from 'node:fs/promises';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const windowsSign = process.env.WINDOWS_CERTIFICATE_FILE
  ? {
      certificateFile: process.env.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD,
      description: 'M365 Multi Tenant Management',
      website: 'https://github.com/JILTechnology/M365-Multi-Tenant-Management',
    }
  : undefined;

// Vite bundles everything except node-pty, a native module (vite.main.config.ts).
// Copy only its Windows runtime files into the packaged app; asar.unpack keeps them
// on disk where Windows can load the .node/.dll/.exe files.
async function copyNodePty(buildPath: string): Promise<void> {
  const source = path.resolve('node_modules', 'node-pty');
  const target = path.join(buildPath, 'node_modules', 'node-pty');
  await fs.cp(source, target, {
    recursive: true,
    filter: (file) => {
      const rel = path.relative(source, file).split(path.sep).join('/');
      if (['', 'package.json', 'lib', 'prebuilds', 'prebuilds/win32-x64'].includes(rel)) return true;
      if (rel.startsWith('lib/')) return !rel.endsWith('.map') && !rel.endsWith('.test.js');
      if (rel.startsWith('prebuilds/win32-x64/')) return !rel.endsWith('.pdb');
      return false;
    },
  });

  // node-pty starts a worker thread from its own folder but only rewrites
  // node_modules.asar paths; point it at app.asar.unpacked, where the file really is.
  const conoutPath = path.join(target, 'lib', 'windowsConoutConnection.js');
  const code = await fs.readFile(conoutPath, 'utf8');
  const patched = code.replace(
    "__dirname.replace('node_modules.asar', 'node_modules.asar.unpacked')",
    "__dirname.replace('app.asar', 'app.asar.unpacked')",
  );
  if (patched === code) throw new Error('node-pty worker path patch did not apply.');
  await fs.writeFile(conoutPath, patched);
}

const config: ForgeConfig = {
  hooks: {
    packageAfterPrune: async (_config, buildPath) => copyNodePty(buildPath),
  },
  packagerConfig: {
    asar: { unpack: '**/node_modules/node-pty/**' },
    name: 'M365 Multi Tenant Management',
    icon: './assets/icon',
    ...(windowsSign ? { windowsSign } : {}),
  },
  // node-pty ships prebuilt Node-API binaries that work with any Electron version.
  rebuildConfig: { ignoreModules: ['node-pty'] },
  makers: [
    new MakerSquirrel({
      name: 'M365MultiTenantManagement',
      iconUrl: 'https://raw.githubusercontent.com/JILTechnology/M365-Multi-Tenant-Management/9f6696ca9c315e1ad69eefd5cfeb4ec9d0acf7d3/assets/icon.ico',
      setupIcon: './assets/icon.ico',
      ...(windowsSign ? { windowsSign } : {}),
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
