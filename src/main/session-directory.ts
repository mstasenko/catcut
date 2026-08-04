import { dirname, join } from 'node:path'

export class SessionDirectory {
  private directory: string

  constructor(fallback: string) {
    this.directory = fallback
  }

  defaultPath(filename?: string): string {
    return filename ? join(this.directory, filename) : this.directory
  }

  remember(path: string, isDirectory = false): void {
    this.directory = isDirectory ? path : dirname(path)
  }
}
