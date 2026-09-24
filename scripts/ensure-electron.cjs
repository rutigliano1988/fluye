const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const projectRoot = join(__dirname, '..')
const electronRoot = join(projectRoot, 'node_modules', 'electron')
const executable = join(electronRoot, 'dist', 'electron.exe')
const installer = join(electronRoot, 'install.js')
const force = process.argv.includes('--force')

if (!existsSync(installer)) {
  console.error('\nNo está instalado el paquete Electron. Ejecuta primero: npm install\n')
  process.exit(1)
}

if (force && existsSync(join(electronRoot, 'dist'))) {
  rmSync(join(electronRoot, 'dist'), { recursive: true, force: true })
}

if (existsSync(executable) && !force) process.exit(0)

console.log('\nPreparando Electron para Windows (sólo es necesario la primera vez)…\n')

const configuredMirror = process.env.ELECTRON_MIRROR || process.env.npm_config_electron_mirror
const sources = configuredMirror
  ? [{ name: 'el origen configurado', mirror: configuredMirror }]
  : [
      { name: 'GitHub Releases', mirror: undefined },
      { name: 'el espejo recomendado por Electron', mirror: 'https://npmmirror.com/mirrors/electron/' }
    ]

for (const source of sources) {
  console.log(`Descargando desde ${source.name}…`)
  const environment = { ...process.env }
  if (source.mirror) environment.ELECTRON_MIRROR = source.mirror
  else {
    delete environment.ELECTRON_MIRROR
    delete environment.npm_config_electron_mirror
  }

  const result = spawnSync(process.execPath, [installer], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: environment
  })
  if (result.status === 0 && existsSync(executable)) break
  console.log(`No fue posible usar ${source.name}.`)
}

if (!existsSync(executable)) {
  console.error(
    '\nNo se pudo descargar Electron. Comprueba la conexión, desactiva temporalmente VPN/proxy ' +
      'o permite npmmirror.com y vuelve a ejecutar: npm run repair:electron\n'
  )
  process.exit(1)
}

console.log('\nElectron está preparado. Abriendo Fluye…\n')
