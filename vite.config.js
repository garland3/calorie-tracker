import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig } from 'vite';

const listFiles = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? listFiles(join(dir, d.name)) : [join(dir, d.name)]));

/** After the build, write dist/sw.js with the list of built files and a version hash of their contents. */
function serviceWorker() {
  let outDir;
  return {
    name: 'calories-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir)
        .map(f => relative(outDir, f).split(sep).join('/'))
        .filter(f => f !== 'sw.js')
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const src = readFileSync('src/sw.js', 'utf8')
        .replace("/*__VERSION__*/ 'dev'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('/*__FILES__*/ []', JSON.stringify(files));
      writeFileSync(join(outDir, 'sw.js'), src);
    },
  };
}

export default defineConfig({
  // Relative paths, so the build works at any URL (GitHub Pages project sites live under /<repo>/).
  base: './',
  plugins: [serviceWorker()],
  test: {
    environment: 'node',
  },
});
