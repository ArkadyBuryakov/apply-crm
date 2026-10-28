// Object storage behind an interface (ADR 0006): S3-compatible in every deployed environment, in-memory in tests.
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "../env.js";

export const blobKeys = {
  upload: (projectId: string, versionId: string, filename: string) =>
    `projects/${projectId}/documents/${versionId}/${filename}`,
  pdf: (projectId: string, versionId: string) => `projects/${projectId}/documents/${versionId}/output.pdf`,
  templateFile: (projectId: string, templateVersionId: string, name: string) =>
    `projects/${projectId}/templates/${templateVersionId}/${name}`,
  chatAttachment: (projectId: string, chatId: string, attachmentId: string) =>
    `projects/${projectId}/chats/${chatId}/${attachmentId}`,
};

export interface BlobStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    config: {
      endpoint?: string;
      region: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle: boolean;
    },
  ) {
    this.client = new S3Client({
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
    });
  }

  static fromEnv(env: Env) {
    return new S3BlobStore(env.S3_BUCKET, {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  /** Creates the bucket if it does not exist (convenient for local development). */
  async ensureBucket() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType });
  }

  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
