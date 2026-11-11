// c. @aws-sdk/client-s3 GetObject / PutObject against an R2 endpoint
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

let client;
function s3(env) {
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return client;
}

export default {
  async fetch(request, env) {
    const key = new URL(request.url).pathname.slice("/s3/".length);
    if (request.method === 'PUT') {
      await s3(env).send(new PutObjectCommand({
        Bucket: env.BUCKET, Key: key, Body: new Uint8Array(await request.arrayBuffer()),
        ContentType: request.headers.get('content-type') ?? undefined,
      }));
      return new Response(null, { status: 204 });
    }
    const obj = await s3(env).send(new GetObjectCommand({ Bucket: env.BUCKET, Key: key }));
    return new Response(obj.Body.transformToWebStream(), {
      headers: { 'content-type': obj.ContentType ?? 'application/octet-stream', etag: obj.ETag ?? '' },
    });
  },
};
