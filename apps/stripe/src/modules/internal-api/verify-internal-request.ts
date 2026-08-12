import { createHmac, timingSafeEqual } from "node:crypto";

export class InternalRequestError extends Error {}

export function verifyInternalRequest(args: {
  transactionId: string;
  saleorApiUrl: string;
  headers: Headers;
  secrets: string[];
  now?: number;
}): void {
  const timestamp = args.headers.get("x-opie-timestamp") ?? "";
  const supplied = (args.headers.get("x-opie-signature") ?? "").replace(/^v1=/, "");
  const parsed = Number(timestamp);
  const now = args.now ?? Math.floor(Date.now() / 1000);

  if (!Number.isInteger(parsed) || Math.abs(now - parsed) > 300) {
    throw new InternalRequestError("Internal request timestamp is outside the five-minute window");
  }
  if (!/^[a-f0-9]{64}$/i.test(supplied) || !args.secrets.length) {
    throw new InternalRequestError("Internal request signature is invalid");
  }
  const signed = `${timestamp}.${args.transactionId}.${args.saleorApiUrl}`;
  const suppliedBytes = Buffer.from(supplied, "hex");
  const valid = args.secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(signed).digest();

    return expected.length === suppliedBytes.length && timingSafeEqual(expected, suppliedBytes);
  });

  if (!valid) throw new InternalRequestError("Internal request signature is invalid");
}
