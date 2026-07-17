import fs from 'node:fs/promises'
import ts from 'typescript'

const errorsPath = 'src/shared/models/errors.ts'
const scanPath = 'src/renderer/i18n/for-key-scan.ts'
const checkOnly = process.argv.includes('--check')

const generatedStart = '  // BEGIN GENERATED ERROR I18N KEYS'
const generatedEnd = '  // END GENERATED ERROR I18N KEYS'

function getPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }
  return undefined
}

function isStringLiteralLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function extractErrorI18nKeys(sourceText) {
  const sourceFile = ts.createSourceFile(errorsPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const keys = []

  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      getPropertyName(node.name) === 'i18nKey' &&
      isStringLiteralLike(node.initializer)
    ) {
      keys.push(node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...new Set(keys)]
}

function toQuotedString(value) {
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'"
  return `${quote}${value
    .replaceAll('\\', '\\\\')
    .replaceAll(quote, `\\${quote}`)
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}${quote}`
}

function formatKeyCall(key) {
  const literal = toQuotedString(key)
  const oneLine = `  t(${literal})`
  if (oneLine.length <= 120) {
    return oneLine
  }
  return `  t(\n    ${literal}\n  )`
}

function replaceGeneratedBlock(scanText, keys) {
  const startIndex = scanText.indexOf(generatedStart)
  const endIndex = scanText.indexOf(generatedEnd)
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Generated markers not found in ${scanPath}`)
  }

  const before = scanText.slice(0, startIndex)
  const after = scanText.slice(endIndex + generatedEnd.length)
  const generated = [generatedStart, ...keys.map(formatKeyCall), generatedEnd].join('\n')
  return `${before}${generated}${after}`
}

const errorsText = await fs.readFile(errorsPath, 'utf-8')
const scanText = await fs.readFile(scanPath, 'utf-8')
const keys = extractErrorI18nKeys(errorsText)

if (keys.length === 0) {
  throw new Error(`No i18nKey entries found in ${errorsPath}`)
}

const nextScanText = replaceGeneratedBlock(scanText, keys)
if (checkOnly && nextScanText !== scanText) {
  console.error(`${scanPath} is out of sync with ${errorsPath}. Run pnpm run sync:error-i18n-keys.`)
  process.exit(1)
}

if (!checkOnly && nextScanText !== scanText) {
  await fs.writeFile(scanPath, nextScanText)
}

console.log(`${checkOnly ? 'Checked' : 'Synced'} ${keys.length} error i18n keys in ${scanPath}`)
