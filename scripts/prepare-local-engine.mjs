import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const WHISPER_BUILD = 'b5130'
const WHISPER_ARCHIVE = {
  url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_BUILD}/whisper-bin-x64.zip`,
  sha256: 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c'
}
const MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
const WHISPER_MODEL = {
  url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REVISION}/ggml-base.bin?download=true`,
  sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
}

const projectDirectory = resolve(import.meta.dirname, '..')
const downloadDirectory = resolve(projectDirectory, 'work', 'local-engine-downloads')
const extractionDirectory = resolve(downloadDirectory, `whisper-${WHISPER_BUILD}`)
const archivePath = resolve(downloadDirectory, `whisper-bin-x64-${WHISPER_BUILD}.zip`)
const outputDirectory = resolve(projectDirectory, 'vendor', 'whisper')
const modelPath = resolve(outputDirectory, 'ggml-base.bin')
const requiredBinaries = ['whisper-cli.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll']

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function validFile(path, expectedHash) {
  return existsSync(path) && await sha256(path) === expectedHash
}

async function download(url, destination, expectedHash, label) {
  if (await validFile(destination, expectedHash)) {
    console.log(`${label}: ya está preparado.`)
    return
  }

  mkdirSync(downloadDirectory, { recursive: true })
  const partialPath = `${destination}.download`
  rmSync(partialPath, { force: true })
  console.log(`${label}: descargando…`)

  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar ${label} (${response.status}).`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath))
  const actualHash = await sha256(partialPath)
  if (actualHash !== expectedHash) {
    rmSync(partialPath, { force: true })
    throw new Error(`La verificación de seguridad falló para ${label}.`)
  }
  rmSync(destination, { force: true })
  renameSync(partialPath, destination)
  console.log(`${label}: descarga verificada.`)
}

function binariesAreReady() {
  if (!requiredBinaries.every((name) => existsSync(resolve(outputDirectory, name)))) return false
  return readdirSync(outputDirectory).some((name) => /^ggml-cpu-.+\.dll$/i.test(name))
}

async function prepareBinaries() {
  if (binariesAreReady()) {
    console.log('Motor local: ya está preparado.')
    return
  }

  await download(WHISPER_ARCHIVE.url, archivePath, WHISPER_ARCHIVE.sha256, 'Motor local')
  rmSync(extractionDirectory, { recursive: true, force: true })
  mkdirSync(extractionDirectory, { recursive: true })

  const extracted = spawnSync('tar', ['-xf', archivePath, '-C', extractionDirectory], {
    stdio: 'inherit',
    windowsHide: true
  })
  if (extracted.status !== 0) throw new Error('No se pudo extraer el motor local de Whisper.')

  const releaseDirectory = resolve(extractionDirectory, 'Release')
  const binaryNames = readdirSync(releaseDirectory).filter((name) =>
    requiredBinaries.includes(name) || /^ggml-cpu-.+\.dll$/i.test(name)
  )
  mkdirSync(outputDirectory, { recursive: true })
  for (const name of binaryNames) {
    copyFileSync(resolve(releaseDirectory, name), resolve(outputDirectory, name))
  }
  if (!binariesAreReady()) throw new Error('El paquete oficial de Whisper no contiene los binarios esperados.')
  console.log('Motor local: preparado.')
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('El motor local incluido en Fluye está preparado para Windows x64.')
  }

  await prepareBinaries()
  mkdirSync(outputDirectory, { recursive: true })
  await download(WHISPER_MODEL.url, modelPath, WHISPER_MODEL.sha256, 'Modelo Whisper Base multilingüe')
  writeFileSync(
    resolve(outputDirectory, 'THIRD_PARTY_NOTICES.txt'),
    [
      'Fluye incluye whisper.cpp y pesos convertidos de OpenAI Whisper para la transcripción local.',
      '',
      `whisper.cpp build: ${WHISPER_BUILD}`,
      'Proyecto: https://github.com/ggml-org/whisper.cpp',
      'Licencia: MIT',
      '',
      `Modelo: ggml-base.bin (${MODEL_REVISION})`,
      'Origen: https://huggingface.co/ggerganov/whisper.cpp',
      'Modelo original: https://github.com/openai/whisper',
      'Licencia: MIT',
      ''
    ].join('\n'),
    'utf8'
  )
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
