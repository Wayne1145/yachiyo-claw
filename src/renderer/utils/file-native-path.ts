const FILE_NATIVE_PATH_PROPERTY = '__chatboxNativePath'

type FileWithRememberedNativePath = File & {
  [FILE_NATIVE_PATH_PROPERTY]?: string
}

export function rememberFileNativePath(file: File, nativePath: string): string {
  if (nativePath) {
    Object.defineProperty(file, FILE_NATIVE_PATH_PROPERTY, {
      value: nativePath,
      configurable: true,
    })
  }
  return nativePath
}

export function getBestEffortFileNativePath(file: File): string {
  return (file as FileWithRememberedNativePath)[FILE_NATIVE_PATH_PROPERTY] || file.path || ''
}
