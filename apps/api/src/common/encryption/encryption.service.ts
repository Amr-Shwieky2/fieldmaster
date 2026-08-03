import { Injectable, Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from "@aws-sdk/client-kms";

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  encryptionKeyId: string;
}

const ALGORITHM = "aes-256-gcm";

/**
 * Envelope encryption for sensitive fields (bank accounts, identity
 * documents -- spec section 8.3). In development, `LOCAL_ENCRYPTION_KEY_BASE64`
 * is used directly as the AES-256 data key. In production (KMS_KEY_ID set),
 * a fresh data key is requested from AWS KMS for every encrypt call and the
 * KMS-encrypted copy of that key is stored alongside the ciphertext, so a
 * compromised database alone never exposes plaintext.
 *
 * The KMS path is real client code but has not been exercised against a
 * live AWS account in this environment (no credentials available here) --
 * see IMPLEMENTATION_STATUS.md.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly kmsKeyId = process.env.KMS_KEY_ID || "";
  private readonly kmsClient = this.kmsKeyId ? new KMSClient({}) : null;

  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    if (this.kmsClient) {
      return this.encryptWithKms(plaintext);
    }
    return this.encryptWithLocalKey(plaintext);
  }

  async decrypt(payload: EncryptedPayload): Promise<string> {
    if (payload.encryptionKeyId.startsWith("kms:")) {
      return this.decryptWithKms(payload);
    }
    return this.decryptWithLocalKey(payload);
  }

  private getLocalKey(): Buffer {
    const base64 = process.env.LOCAL_ENCRYPTION_KEY_BASE64;
    if (!base64) {
      throw new Error("LOCAL_ENCRYPTION_KEY_BASE64 is not set; required in development mode.");
    }
    const key = Buffer.from(base64, "base64");
    if (key.length !== 32) {
      throw new Error("LOCAL_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes (AES-256).");
    }
    return key;
  }

  private encryptWithLocalKey(plaintext: string): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.getLocalKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag(), encryptionKeyId: "local:dev-key-v1" };
  }

  private decryptWithLocalKey(payload: EncryptedPayload): string {
    const decipher = createDecipheriv(ALGORITHM, this.getLocalKey(), payload.iv);
    decipher.setAuthTag(payload.authTag);
    const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  }

  private async encryptWithKms(plaintext: string): Promise<EncryptedPayload> {
    const result = await this.kmsClient!.send(
      new GenerateDataKeyCommand({ KeyId: this.kmsKeyId, KeySpec: "AES_256" }),
    );
    if (!result.Plaintext || !result.CiphertextBlob) {
      throw new Error("KMS did not return a data key.");
    }
    const dataKey = Buffer.from(result.Plaintext);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    dataKey.fill(0); // zero the plaintext data key as soon as it's no longer needed

    return {
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      // The KMS-encrypted data key is stored as the "key id" so decrypt can
      // ask KMS to unwrap it again.
      encryptionKeyId: `kms:${Buffer.from(result.CiphertextBlob).toString("base64")}`,
    };
  }

  private async decryptWithKms(payload: EncryptedPayload): Promise<string> {
    const encryptedDataKey = Buffer.from(payload.encryptionKeyId.slice("kms:".length), "base64");
    const result = await this.kmsClient!.send(new DecryptCommand({ CiphertextBlob: encryptedDataKey }));
    if (!result.Plaintext) throw new Error("KMS did not return a plaintext data key.");
    const dataKey = Buffer.from(result.Plaintext);
    const decipher = createDecipheriv(ALGORITHM, dataKey, payload.iv);
    decipher.setAuthTag(payload.authTag);
    const plaintext = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
    dataKey.fill(0);
    return plaintext.toString("utf8");
  }
}
