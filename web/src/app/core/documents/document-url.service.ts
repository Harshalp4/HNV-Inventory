import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Fetches an uploaded document through the API and hands back a blob URL.
 *
 * <p>Documents are served from <c>/api/documents/{id}</c>, which is behind the same
 * permission check as everything else — the site-scoping happens on every read. That check
 * needs the session's bearer token, and a browser sends none of its own on an
 * <c>&lt;img src&gt;</c> or a plain link opened in a new tab: both arrive unauthenticated
 * and come back 401. So the file is fetched with HttpClient, which the auth interceptor
 * does reach, and the resulting blob is what the page points at.</p>
 *
 * <p>Blob URLs are cached per document because the same challan is drawn as a thumbnail and
 * then opened full size, and because they are cheap to keep and awkward to revoke early —
 * revoking one still on screen leaves a broken picture. They are all released together when
 * the app shuts down.</p>
 */
@Injectable({ providedIn: 'root' })
export class DocumentUrlService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, Promise<string>>();

  /** The blob URL for a document, fetching it the first time it is asked for. */
  resolve(documentId: string): Promise<string> {
    let pending = this.cache.get(documentId);

    if (!pending) {
      pending = firstValueFrom(
        this.http.get(`/api/documents/${documentId}`, { responseType: 'blob' }),
      )
        .then((blob) => URL.createObjectURL(blob))
        .catch((error: unknown) => {
          // A failed fetch must not be cached, or a network blip hides the file for good.
          this.cache.delete(documentId);
          throw error;
        });

      this.cache.set(documentId, pending);
    }

    return pending;
  }

  /** Opens the document in a new tab, once it has been fetched with the session's token. */
  async open(documentId: string): Promise<void> {
    // Opened before the await: a browser blocks window.open that arrives after one, because
    // by then the call no longer looks like it came from the click.
    const tab = window.open('', '_blank', 'noopener');
    const url = await this.resolve(documentId);

    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener');
  }

  ngOnDestroy(): void {
    for (const pending of this.cache.values()) {
      void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
    }
    this.cache.clear();
  }
}
