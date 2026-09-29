// Local-dev WaltzDeck worker: consumes DECK_QUEUE (must NOT be the prod queue) against the dev DB.
//   ssh -N -L 6380:127.0.0.1:6379 linuxg1      (Redis on linuxg1 is localhost-only)
//   DECK_QUEUE=clipwaltz-deck-dev REDIS_URL=redis://127.0.0.1:6380 node --env-file=.env.local worker/deck/dev-worker.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { startDeckWorker, DECK_QUEUE } from "./jobs.mjs";

if (!process.env.DECK_QUEUE || DECK_QUEUE === "clipwaltz-deck") throw new Error("set DECK_QUEUE to a dev queue name (not clipwaltz-deck)");
if (!/\/clipwaltz_dev(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL is not the dev DB");
const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://192.168.166.169:9000", region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});
const getBytes = async (key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? "clipwaltz", Key: key }))).Body.transformToByteArray());
const Bucket = process.env.S3_BUCKET ?? "clipwaltz";
const putBytes = (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
const deleteKey = (Key) => s3.send(new DeleteObjectCommand({ Bucket, Key }));
startDeckWorker({ sql, getBytes, putBytes, deleteKey, run: promisify(execFile), redisUrl: process.env.REDIS_URL });
