import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrivateError } from "./crypto.js";

export async function privateDirectory(path: string, checkout: string): Promise<string> {
  const absolute = resolve(path);
  // Resolve the nearest existing parent before creating anything.
  let parent = absolute;
  while (true) {
    try { await lstat(parent); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PrivateError("storage_unavailable");
      parent = dirname(parent);
    }
  }
  const actual = resolve(await realpath(parent), relative(parent, absolute));
  const root = await realpath(checkout);
  if (actual === root || actual.startsWith(root + sep)) throw new PrivateError("private_path_in_checkout");
  await mkdir(actual, { recursive: true, mode: 0o700 });
  const stat = await lstat(actual);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new PrivateError("private_directory_permissions");
  return actual;
}

export async function readBytes(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await file.readFile(); } finally { await file.close(); }
}

export async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

// The temporary file contains ciphertext or safe configuration only.
export async function atomicWrite(path: string, bytes: Uint8Array, beforeRename?: () => Promise<void>): Promise<void> {
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await beforeRename?.();
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch { throw new PrivateError("save_failed"); }
  finally { await rm(temporary, { force: true }); }
}

async function withLockGuard<T>(directory: string, name: string, work: () => Promise<T>): Promise<T> {
  const path = resolve(directory, name + ".guard");
  let guard;
  try { guard = await open(path, "wx", 0o600); }
  catch { throw new PrivateError("storage_busy"); }
  try {
    await guard.writeFile(JSON.stringify({ schema: "wordwell-local-lock-guard-v1", pid: process.pid }) + "\n");
    return await work();
  } finally { await guard.close(); await rm(path, { force: true }); }
}

export async function withFileLock<T>(directory: string, name: string, work: () => Promise<T>): Promise<T> {
  const path = resolve(directory, name);
  const ownership = Buffer.from(JSON.stringify({ schema: "wordwell-local-lock-v1", pid: process.pid, owner: randomUUID() }) + "\n");
  const lock = await withLockGuard(directory, name, async () => {
    let file;
    try { file = await open(path, "wx", 0o600); }
    catch { throw new PrivateError("storage_busy"); }
    try { await file.writeFile(ownership); await file.sync(); return file; }
    catch { await file.close(); await rm(path, { force: true }); throw new PrivateError("storage_unavailable"); }
  });
  try {
    return await work();
  }
  finally {
    try {
      // A competing acquisition/recovery can briefly hold the guard. Never
      // delete it, but let that short critical section finish before releasing.
      for (let attempt = 0; ; attempt++) {
        try {
          await withLockGuard(directory, name, async () => {
            if (!(await readBytes(path)).equals(ownership)) throw new PrivateError("lock_ownership_conflict");
            await rm(path);
          });
          break;
        } catch (error) {
          if (!(error instanceof PrivateError) || error.code !== "storage_busy" || attempt >= 100) throw error;
          await delay(10);
        }
      }
    } finally { await lock.close(); }
  }
}

// Explicit recovery only. Missing/invalid ownership or a live/reused PID blocks it.
export async function recoverStoppedLock(directory: string, name: string, beforeRemove?: () => Promise<void>): Promise<void> {
  return withLockGuard(directory, name, async () => {
    const path = resolve(directory, name);
    let bytes: Buffer;
    try { bytes = await readBytes(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw new PrivateError("recovery_blocked"); }
    try {
      const lock = JSON.parse(bytes.toString());
      if (lock.schema !== "wordwell-local-lock-v1" || !Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error();
      try { process.kill(lock.pid, 0); throw new PrivateError("lock_owner_running"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      // Check the ownership bytes again before removing the stopped owner's lock.
      if (!(await readBytes(path)).equals(bytes)) throw new Error();
      await beforeRemove?.();
      await rm(path); await syncDirectory(directory);
    } catch (error) {
      if (error instanceof PrivateError) throw error;
      throw new PrivateError("recovery_blocked");
    }
  });
}
