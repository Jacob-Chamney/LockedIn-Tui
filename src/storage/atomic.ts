/**
 * The one atomic write: temp file → fsync → rename → fsync directory
 * (`docs/data-model.md` §3).
 *
 * A crash leaves either the old bytes or the new ones, never a partial file.
 * The temp name is derived from the destination so a crashed run leaves a
 * recognisable, ignorable file. Callers map the thrown error into their own
 * taxonomy; nothing here inspects the content.
 */
import { open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Best-effort directory fsync: a platform that refuses it is not a failure. */
export async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems and Windows reject a directory handle; the rename is
    // still atomic, so this is the durable-ordering nicety, not the guarantee.
  }
}

/** Write `contents` to `destination` atomically. Throws if the write fails. */
export async function writeFileAtomic(
  destination: string,
  contents: string | Uint8Array,
): Promise<void> {
  const directory = dirname(destination);
  const temp = join(directory, `.${randomUUID()}-atomic.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temp, "w");
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, destination);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // the original failure is the one worth reporting
    }
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  await fsyncDirectory(directory);
}
