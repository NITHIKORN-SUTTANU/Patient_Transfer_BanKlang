import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'

export async function temporaryProbeJournal() {
  const root = resolve(tmpdir()), directory = await mkdtemp(join(root, 'pt-probe-'))
  const valid = () => resolve(directory) === directory && dirname(directory) === root && basename(directory).startsWith('pt-probe-')
  if (!valid()) throw new Error('Unexpected temporary probe directory')
  return { path: join(directory, 'probes.jsonl'), async close() {
    if (!valid()) throw new Error('Temporary probe cleanup escaped its named directory')
    await rm(directory, { recursive: true, force: true })
  } }
}
