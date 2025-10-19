import { startServer } from '@directus/api/server';
import { register } from 'ts-node';
import { register as registerTsConfigPaths } from 'tsconfig-paths';
import { join } from 'path';

// Log current working directory for debugging
console.log('start.ts working directory:', process.cwd());

// Register ts-node and tsconfig-paths only if not already registered by nodemon
if (!process.execArgv.includes('--import=ts-node/register/transpile-only') && !process.execArgv.includes('--loader=ts-node/esm')) {
  console.log('Registering ts-node and tsconfig-paths in start.ts');
  const tsConfigPath = join(process.cwd(), 'tsconfig.json').replace(/\\/g, '/');
  console.log('Using tsconfig.json path:', tsConfigPath);
  register({
    project: tsConfigPath,
    transpileOnly: true,
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
  });
  registerTsConfigPaths();
}

// Start Directus server
startServer().then(() => {
  console.log('Directus server started with custom extensions configuration.');
});