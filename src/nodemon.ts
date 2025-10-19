import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import nodemon from 'nodemon';
import { readdirSync, existsSync, rmSync, symlinkSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, normalize } from 'path';
import { execSync } from 'child_process';
console.log('Loaded nodemon.ts');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .options('env', {
    alias: 'e',
    describe: 'Environment',
    default: 'portal',
    choices: ['portal', 'staging', 'staging2'],
  })
  .options('prod', {
    type: 'boolean',
    describe: 'Run in production mode (build extensions)',
    default: false,
  })
  .parseSync();

const script = 'src/start.ts';
const isProduction = argv.prod;

// Log current working directory for debugging
console.log('Current working directory:', process.cwd());

// Utility: Find all subfolders containing package.json at the extension root
const findExtensionTargets = (baseDir: string): string[] => {
  const targets: string[] = [];
  const srcExtensionsDir = normalize(baseDir);
  const entries = readdirSync(srcExtensionsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const extensionDir = join(srcExtensionsDir, entry.name);
    const packageJsonPath = join(extensionDir, 'package.json');
    
    // Check if package.json exists at the extension root
    if (existsSync(packageJsonPath)) {
      targets.push(extensionDir);
    }
    
    // Check one level deeper (e.g., endpoints/custom)
    const subEntries = readdirSync(extensionDir, { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) continue;
      
      const subExtensionDir = join(extensionDir, subEntry.name);
      const subPackageJsonPath = join(subExtensionDir, 'package.json');
      
      if (existsSync(subPackageJsonPath)) {
        targets.push(subExtensionDir);
      }
    }
  }
  
  return targets;
};

// Build extensions (for production only)
const buildExtensions = () => {
  if (!isProduction) return; // Skip building in development
  const extensionsDir = join(process.cwd(), 'src/extensions');
  if (!existsSync(extensionsDir)) {
    console.log('No extensions directory found at:', extensionsDir);
    return;
  }

  const targets = findExtensionTargets(extensionsDir);
  console.log('Building extensions at:', targets);
  for (const target of targets) {
    console.log(`Building extension at: ${target}`);
    try {
      execSync('npm run build', {
        cwd: target,
        stdio: 'inherit',
      });
    } catch (error) {
      console.error(`Failed to build extension at ${target}:`, error);
    }
  }
};

// Link extensions to the extensions directory
const linkExtensions = () => {
  const extensionsDir = join(process.cwd(), 'extensions');
  const srcExtensionsDir = join(process.cwd(), 'src/extensions');

  if (existsSync(extensionsDir)) {
    rmSync(extensionsDir, { recursive: true, force: true });
    console.log('Cleared extensions directory:', extensionsDir);
  }

  if (!existsSync(srcExtensionsDir)) {
    console.log('No extensions directory found at:', srcExtensionsDir);
    return;
  }

  const targets = findExtensionTargets(srcExtensionsDir);
  console.log('Found extension targets:', targets);
  for (const target of targets) {
    const srcPath = join(target, 'src');
    const distPath = join(target, 'dist');
    const extensionName = target.replace(srcExtensionsDir, '').slice(1); // Nama ekstensi, e.g., directus-extension-endpoints-custom
    const destPath = join(extensionsDir, extensionName, 'src'); // Symlink ke folder src
    const packageJsonPath = join(target, 'package.json');
    const destPackageJsonPath = join(extensionsDir, extensionName, 'package.json'); // package.json di root ekstensi

    if (isProduction) {
      // In production, link dist folders
      if (existsSync(distPath)) {
        mkdirSync(dirname(destPath), { recursive: true });
        symlinkSync(distPath, destPath, 'junction');
        console.log(`Linked compiled extension from ${distPath} to ${destPath}`);
      } else {
        console.log(`Dist path does not exist, building extension at: ${target}`);
        try {
          execSync('npm run build', { cwd: target, stdio: 'inherit' });
          mkdirSync(dirname(destPath), { recursive: true });
          symlinkSync(distPath, destPath, 'junction');
          console.log(`Linked compiled extension from ${distPath} to ${destPath}`);
        } catch (error) {
          console.error(`Failed to build and link extension at ${target}:`, error);
        }
      }
    } else {
      console.log('Src path:', srcPath);
      // In development, link src folders and update package.json
      if (existsSync(srcPath)) {
        console.log('Dest path:', destPath);
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          symlinkSync(srcPath, destPath, 'junction');
          console.log(`Linked TypeScript extension from ${srcPath} to ${destPath}`);
        } catch (error) {
          console.error(`Failed to create symlink from ${srcPath} to ${destPath}:`, error);
        }
        // Copy and modify package.json for development
        if (existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          // Ensure package.json has correct directus:extension config
          packageJson['directus:extension'] = {
            ...packageJson['directus:extension'],
            type: packageJson['directus:extension']?.type || 'endpoint',
            path: 'src/index.ts', // Perbaikan: Mengarah ke src/index.ts
            source: 'src/index.ts'
          };
          // Bersihkan package.json yang sudah ada di destinasi
          if (existsSync(destPackageJsonPath)) {
            rmSync(destPackageJsonPath, { force: true });
            console.log(`Removed existing package.json at ${destPackageJsonPath}`);
          }
          mkdirSync(dirname(destPackageJsonPath), { recursive: true });
          writeFileSync(destPackageJsonPath, JSON.stringify(packageJson, null, 2));
          console.log(`Updated package.json at ${destPackageJsonPath} for TypeScript loading`);
        } else {
          console.error(`package.json not found at ${packageJsonPath}`);
        }
      } else {
        console.log(`Src path does not exist: ${srcPath}`);
      }
    }
  }
};

// Initial setup
buildExtensions(); // Build only in production
linkExtensions(); // Link src (dev) or dist (prod)

// Start Nodemon
const tsConfigPath = `"${join(process.cwd(), 'tsconfig.json').replace(/\\/g, '/')}"`;
const tsCommand = `cross-env NODE_ENV=${isProduction ? 'production' : 'development'} SERVE_APP=true env-cmd -f ./.config/${argv.env}.env -- node --loader ts-node/esm -r tsconfig-paths/register "${script}" --project ${tsConfigPath}`;
console.log('Executing nodemon with command:', tsCommand);

nodemon({
  script,
  exec: tsCommand, // Ensure tsCommand is always used
  ext: 'ts,env,liquid',
  watch: [
    'src',
    '.config',
    'config',
    'tsconfig.json',
    'package.json',
    'snapshot.js',
  ],
  delay: 500,
});

// Nodemon events with type assertion
(nodemon as any)
  .on('start', () => {
    console.log(`Process started in ${isProduction ? 'production' : 'development'} mode`);
  })
  .on('restart', (files?: string[]) => {
    console.log('Detected changes, restarting...');
    console.log('Restart triggered by files:', files);
    if (files && files.some((file) => file.includes('src/extensions'))) {
      console.log('Changes detected in src/extensions, re-linking...');
      linkExtensions();
    }
  })
  .on('quit', () => {
    console.log('Process exited cleanly.');
    process.exit();
  });