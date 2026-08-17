import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

type MonacoEnvironmentLike = {
  getWorker?: (_workerId: string, label: string) => Worker
}

const createMonacoWorker = (label: string): Worker => {
  void label
  return new editorWorker()
}

export const configureMonacoWorkers = (): void => {
  const environment: MonacoEnvironmentLike = {
    getWorker: (_workerId: string, label: string) => createMonacoWorker(label)
  }
  ;(
    globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironmentLike }
  ).MonacoEnvironment = environment
  ;(window as Window & { MonacoEnvironment?: MonacoEnvironmentLike }).MonacoEnvironment =
    environment
}
