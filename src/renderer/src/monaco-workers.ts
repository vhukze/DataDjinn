import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

type MonacoEnvironmentLike = {
  getWorker?: (_workerId: string, label: string) => Worker
}

const createMonacoWorker = (label: string): Worker => {
  if (label === 'json') {
    return new jsonWorker()
  }
  if (label === 'css' || label === 'scss' || label === 'less') {
    return new cssWorker()
  }
  if (label === 'html' || label === 'handlebars' || label === 'razor') {
    return new htmlWorker()
  }
  if (label === 'typescript' || label === 'javascript') {
    return new tsWorker()
  }
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
