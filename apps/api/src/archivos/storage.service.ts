import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { CONFIG, Config } from '../config';

/** Abstracción del almacenamiento de objetos (S3, R2 o MinIO). */
export abstract class Storage {
  abstract urlDeSubida(key: string, mime: string, bytes: number): Promise<string>;
  abstract existe(key: string): Promise<boolean>;
}

@Injectable()
export class S3Storage extends Storage {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(@Inject(CONFIG) config: Config) {
    super();
    this.bucket = config.s3.bucket;
    this.s3 = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      forcePathStyle: Boolean(config.s3.endpoint), // MinIO
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    });
  }

  urlDeSubida(key: string, mime: string, bytes: number): Promise<string> {
    // URL de vida corta: el móvil sube directo al bucket, el API nunca recibe binarios
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mime, ContentLength: bytes }),
      { expiresIn: 15 * 60 },
    );
  }

  async existe(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
