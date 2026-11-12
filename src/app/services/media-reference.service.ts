import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MediaReferenceService {
  private readonly pendingReference = signal('');

  set(reference: string): void {
    this.pendingReference.set(reference);
  }

  take(): string {
    const reference = this.pendingReference();
    this.pendingReference.set('');
    return reference;
  }
}
