import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectDir = resolve(import.meta.dirname, '..')
const packageDir = resolve(projectDir, '.packaging')
const sourceOut = resolve(projectDir, 'out')
const packagedOut = resolve(packageDir, 'out')
const projectPackage = JSON.parse(await readFile(resolve(projectDir, 'package.json'), 'utf8'))

await mkdir(packageDir, { recursive: true })
await cp(sourceOut, packagedOut, { recursive: true, force: true })
await writeFile(
  resolve(packageDir, 'package.json'),
  `${JSON.stringify({
    name: projectPackage.name,
    version: projectPackage.version,
    description: projectPackage.description,
    main: projectPackage.main,
    type: projectPackage.type,
    author: projectPackage.author,
    license: projectPackage.license,
    packageManager: 'traversal@1'
  }, null, 2)}\n`,
  'utf8'
)
