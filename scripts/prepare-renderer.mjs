import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve('src/renderer/index.html')
const outputDirectory = resolve('out/renderer')
const outputPath = resolve(outputDirectory, 'index.html')

const source = readFileSync(sourcePath, 'utf8')
const html = source
  .replace(
    '<script type="module" src="/src/main.tsx"></script>',
    '<link rel="stylesheet" href="./assets/main.css" />\n    <script type="module" src="./assets/main.js"></script>'
  )

mkdirSync(outputDirectory, { recursive: true })
writeFileSync(outputPath, html, 'utf8')
