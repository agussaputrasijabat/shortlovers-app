import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.cwd();
const distDir = join(root, 'dist');
const srcDir = join(root, 'src');
const srcExtensionsDir = join(srcDir, 'extensions');

function log(...args: any[]) { console.log('[build]', ...args); }
function err(...args: any[]) { console.error('[build]', ...args); }

function cleanDist() {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
    log('Cleaned dist directory');
  }
  mkdirSync(distDir, { recursive: true });
}

function run(cmd: string, cwd: string = root) {
  log(`$ (${cwd.replace(root, '.')}) ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function buildTypescript() {
  // Compile project TS -> dist
  run('npm run build:ts');
}

function findExtensionTargets(baseDir: string): string[] {
  const targets: string[] = [];
  if (!existsSync(baseDir)) return targets;
  const entries = readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const extensionDir = join(baseDir, entry.name);
    const pkg = join(extensionDir, 'package.json');
    if (existsSync(pkg)) targets.push(extensionDir);
    // one level deeper (e.g., endpoints/custom)
    const subEntries = readdirSync(extensionDir, { withFileTypes: true });
    for (const subEntry of subEntries) {
      if (!subEntry.isDirectory()) continue;
      const subDir = join(extensionDir, subEntry.name);
      const subPkg = join(subDir, 'package.json');
      if (existsSync(subPkg)) targets.push(subDir);
    }
  }
  return targets;
}

function copyFileOrDir(src: string, dest: string) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function sanitizeExtensionPackageJson(pkgPath: string) {
  const json = JSON.parse(readFileSync(pkgPath, 'utf-8')) as any;
  // Keep only fields relevant for Directus to load the extension in runtime
  const kept = {
    name: json.name,
    version: json.version || '1.0.0',
    description: json.description || '',
    icon: json.icon,
    keywords: json.keywords,
    type: json.type || 'module',
    files: ['dist'],
    'directus:extension': {
      ...json['directus:extension'],
      // Ensure path points to built JS
      path: json['directus:extension']?.path || 'dist/index.js',
    },
  };
  return JSON.stringify(kept, null, 2);
}

function buildAndAssembleExtensions() {
  const targets = findExtensionTargets(srcExtensionsDir);
  if (targets.length === 0) {
    log('No extensions found under', srcExtensionsDir);
    return;
  }
  log('Found extensions:', targets.map(t => relative(root, t)).join(', '));

  const distExtensionsDir = join(distDir, 'extensions');

  for (const target of targets) {
    // Build extension (uses directus-extension build)
    try {
      run('npm run build', target);
    } catch (e) {
      err('Failed to build extension at', target, e);
      continue;
    }

    const rel = relative(srcExtensionsDir, target); // e.g. "custom" or "endpoints/custom"
    const destRoot = join(distExtensionsDir, rel);

    // Copy built dist folder
    copyFileOrDir(join(target, 'dist'), join(destRoot, 'dist'));

    // Copy sanitized package.json
    const pkgPath = join(target, 'package.json');
    if (existsSync(pkgPath)) {
      const content = sanitizeExtensionPackageJson(pkgPath);
      mkdirSync(destRoot, { recursive: true });
      writeFileSync(join(destRoot, 'package.json'), content);
    }

    // Copy optional assets (schema, README, etc.) if present
    for (const extra of ['README.md', 'README', 'LICENSE']) {
      const extraPath = join(target, extra);
      if (existsSync(extraPath)) copyFileOrDir(extraPath, join(destRoot, extra));
    }

    log('Assembled extension into', relative(root, destRoot));
  }
}

function copyProjectConfigs() {
  // Copy ecosystem config if exists
  const eco = join(root, 'ecosystem.config.json');
  if (existsSync(eco)) copyFileOrDir(eco, join(distDir, 'ecosystem.config.json'));

  // Copy config directory if exists (env files, etc.)
  const cfg = join(root, 'config');
  if (existsSync(cfg)) copyFileOrDir(cfg, join(distDir, 'config'));

  // Read root package.json to propagate dependencies
  const rootPkgPath = join(root, 'package.json');
  let deps: Record<string, string> | undefined;
  let devDeps: Record<string, string> | undefined;
  let version = '1.0.0';
  let name = 'shortlovers-dist';
  let type = 'module';

  if (existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8')) as any;
    deps = rootPkg.dependencies ?? undefined;
    devDeps = rootPkg.devDependencies ?? undefined;
    version = rootPkg.version ?? version;
    name = `${rootPkg.name ?? 'app'}-dist`;
    type = rootPkg.type ?? type;
  }

  // Create a package.json in dist that includes dependencies and devDependencies
  const distPkg: any = {
    name,
    private: true,
    type,
    version,
    scripts: {
      start: 'directus start'
    },
    dependencies: deps ?? {},
    devDependencies: devDeps ?? {},
  };

  writeFileSync(join(distDir, 'package.json'), JSON.stringify(distPkg, null, 2));
}

function main() {
  log('Starting build...');
  cleanDist();
  buildTypescript();
  buildAndAssembleExtensions();
  copyProjectConfigs();
  log('Build completed. Dist ready at ./dist');
}

main();
