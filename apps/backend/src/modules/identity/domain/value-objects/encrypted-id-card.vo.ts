// SSOT Phase 003 §5 — encrypted ID card value object (opaque wrapper)
export class EncryptedIdCard {
  private constructor(readonly ciphertext: string) {}

  static fromCiphertext(ciphertext: string): EncryptedIdCard {
    if (!ciphertext || ciphertext.length < 16) {
      throw new Error('Invalid encrypted ID card payload');
    }
    return new EncryptedIdCard(ciphertext);
  }
}
