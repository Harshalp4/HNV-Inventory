import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotifyService } from '../notify/notify.service';

export interface QueuedAction {
  /** Generated when the action is queued, not when it is sent, so a retry after a restart keeps it. */
  key: string;
  method: 'POST' | 'PUT';
  url: string;
  body: unknown;
  /** What to tell the user this was, e.g. "Used 25 bags of cement". */
  label: string;
  queuedAt: number;
  attempts: number;
  lastError?: string;
}

const DB_NAME = 'sitestock-offline';
const STORE = 'queue';
const DB_VERSION = 1;

/**
 * Actions taken with no usable connection, held on the device until they can be sent.
 *
 * <p>The design rests on one thing: every queued action carries an idempotency key
 * generated when it was queued. The server remembers keys it has already carried out, so
 * the queue can retry as often as it likes and a delivery is never recorded twice. Without
 * that guarantee an offline queue is a way to corrupt stock, not a feature.</p>
 *
 * <p>What is deliberately <b>not</b> here: reading stale data offline. A supervisor shown a
 * cached stock figure that a lorry has since changed will act on it, and a wrong number
 * presented confidently is worse than an honest "no connection". Only writes are queued.</p>
 */
@Injectable({ providedIn: 'root' })
export class OfflineQueue {
  private readonly http = inject(HttpClient);
  private readonly notify = inject(NotifyService);

  private readonly _pending = signal<QueuedAction[]>([]);
  private readonly _online = signal(navigator.onLine);
  private readonly _syncing = signal(false);

  readonly pending = this._pending.asReadonly();
  readonly online = this._online.asReadonly();
  readonly syncing = this._syncing.asReadonly();
  readonly count = computed(() => this._pending().length);

  private db?: IDBDatabase;

  constructor() {
    void this.open().then(() => this.refresh());

    window.addEventListener('online', () => {
      this._online.set(true);
      void this.sync();
    });

    window.addEventListener('offline', () => this._online.set(false));

    // A connection can come back without firing the event — a captive portal, or a phone
    // that reports online while the site's wifi is still deciding. Nudge it periodically.
    setInterval(() => {
      if (this._online() && this._pending().length > 0) void this.sync();
    }, 30_000);
  }

  /**
   * Sends now if there is a connection; queues it if not.
   * Returns the server's response, or null when the action was queued.
   */
  async send<T>(action: Omit<QueuedAction, 'key' | 'queuedAt' | 'attempts'>): Promise<T | null> {
    const queued: QueuedAction = {
      ...action,
      key: crypto.randomUUID(),
      queuedAt: Date.now(),
      attempts: 0,
    };

    if (!this._online()) {
      await this.enqueue(queued);
      this.notify.info(`Saved on this phone. It will send when you have signal.`);
      return null;
    }

    try {
      return await this.dispatch<T>(queued);
    } catch (error) {
      // Only a connection failure is worth queueing. A refusal from the server — a rule
      // broken, a permission missing — will be refused again in an hour, and hiding it in
      // a queue means the person walks away believing it worked.
      if (isConnectionFailure(error)) {
        await this.enqueue(queued);
        this._online.set(false);
        this.notify.info('No connection. Saved on this phone and it will send later.');
        return null;
      }

      throw error;
    }
  }

  /** Tries everything in the queue, oldest first, stopping at the first connection failure. */
  async sync(): Promise<void> {
    if (this._syncing() || this._pending().length === 0) return;

    this._syncing.set(true);
    let sent = 0;

    try {
      for (const action of [...this._pending()].sort((a, b) => a.queuedAt - b.queuedAt)) {
        try {
          await this.dispatch(action);
          await this.remove(action.key);
          sent++;
        } catch (error) {
          if (isConnectionFailure(error)) {
            // Still no connection. Leave the rest queued and try again later.
            this._online.set(false);
            break;
          }

          // The server refused it. Retrying for ever would hide the problem, so it is kept
          // with the reason attached and surfaced to the user to sort out.
          await this.markFailed(action, describe(error));
        }
      }
    } finally {
      this._syncing.set(false);
      await this.refresh();

      if (sent > 0) {
        this.notify.success(
          sent === 1 ? 'Your saved entry has been sent.' : `${sent} saved entries have been sent.`);
      }
    }
  }

  /** Drops one stuck action, for when the server will never accept it. */
  async discard(key: string): Promise<void> {
    await this.remove(key);
    await this.refresh();
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  private async dispatch<T>(action: QueuedAction): Promise<T> {
    const headers = { 'Idempotency-Key': action.key };

    const request = action.method === 'PUT'
      ? this.http.put<T>(action.url, action.body, { headers })
      : this.http.post<T>(action.url, action.body, { headers });

    return await firstValueFrom(request);
  }

  private open(): Promise<void> {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };

        // A private window, or storage the browser has refused. The app still works — it
        // simply cannot hold anything back, which is better than failing to start.
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async enqueue(action: QueuedAction): Promise<void> {
    await this.write((store) => store.put(action));
    await this.refresh();
  }

  private async remove(key: string): Promise<void> {
    await this.write((store) => store.delete(key));
  }

  private async markFailed(action: QueuedAction, reason: string): Promise<void> {
    await this.write((store) => store.put({ ...action, attempts: action.attempts + 1, lastError: reason }));
  }

  private write(operation: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) return resolve();

      try {
        const transaction = this.db.transaction(STORE, 'readwrite');
        operation(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private refresh(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.db) {
        this._pending.set([]);
        return resolve();
      }

      try {
        const request = this.db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        request.onsuccess = () => {
          this._pending.set(request.result as QueuedAction[]);
          resolve();
        };
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/** A dropped connection, not a refusal. Status 0 is what the browser reports when it cannot reach the server. */
function isConnectionFailure(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status === 504);
}

function describe(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const problem = error.error as { title?: string } | null;
    return problem?.title ?? `The server refused it (${error.status}).`;
  }
  return 'Could not send it.';
}
