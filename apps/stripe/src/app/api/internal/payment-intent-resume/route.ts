import { env } from "@/lib/env";
import { saleorApp } from "@/lib/saleor-app";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { paymentIntentResumeSecret } from "@/modules/internal-api/payment-intent-resume";
import {
  InternalRequestError,
  verifyInternalRequest,
} from "@/modules/internal-api/verify-internal-request";
import { createSaleorApiUrl } from "@/modules/saleor/saleor-api-url";
import { createStripePaymentIntentId } from "@/modules/stripe/stripe-payment-intent-id";
import { StripePaymentIntentsApiFactory } from "@/modules/stripe/stripe-payment-intents-api-factory";

const MAX_REQUEST_BYTES = 4_096;
const TRANSACTION_QUERY = `query OpiePaymentIntentResume($id: ID!) {
  transaction(id: $id) {
    pspReference
    checkout { channel { id } }
    order { channel { id } }
  }
}`;

type ResumeRequest = {
  transaction_id?: unknown;
  saleor_api_url?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  try {
    if (!env.OPIE_INTERNAL_SECRET) {
      return Response.json({ error: "Internal payment resume is not configured" }, { status: 503 });
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");

    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Request is too large" }, { status: 413 });
    }
    const body = (await request.json()) as ResumeRequest;
    const transactionId = typeof body.transaction_id === "string" ? body.transaction_id : "";
    const rawSaleorApiUrl = typeof body.saleor_api_url === "string" ? body.saleor_api_url : "";

    if (!transactionId || !rawSaleorApiUrl) {
      return Response.json(
        { error: "transaction_id and saleor_api_url are required" },
        { status: 400 },
      );
    }
    verifyInternalRequest({
      transactionId,
      saleorApiUrl: rawSaleorApiUrl,
      headers: request.headers,
      secrets: [env.OPIE_INTERNAL_SECRET, env.OPIE_INTERNAL_PREVIOUS_SECRET].filter(
        (secret): secret is string => Boolean(secret),
      ),
    });
    const saleorApiUrlResult = createSaleorApiUrl(rawSaleorApiUrl);

    if (saleorApiUrlResult.isErr()) throw saleorApiUrlResult.error;
    const saleorApiUrl = saleorApiUrlResult.value;
    const authData = await saleorApp.apl.get(saleorApiUrl);

    if (!authData)
      return Response.json({ error: "Saleor installation not found" }, { status: 404 });
    const graphResponse = await fetch(saleorApiUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${authData.token}`, "content-type": "application/json" },
      body: JSON.stringify({ query: TRANSACTION_QUERY, variables: { id: transactionId } }),
      cache: "no-store",
    });

    if (!graphResponse.ok) throw new Error(`Saleor GraphQL HTTP ${graphResponse.status}`);
    const graphPayload = (await graphResponse.json()) as {
      data?: {
        transaction?: {
          pspReference?: string;
          checkout?: { channel: { id: string } };
          order?: { channel: { id: string } };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (graphPayload.errors?.length)
      throw new Error(graphPayload.errors.map((error) => error.message).join("; "));
    const transaction = graphPayload.data?.transaction;
    const channelId = transaction?.checkout?.channel.id ?? transaction?.order?.channel.id;

    if (!transaction?.pspReference || !channelId) {
      return Response.json({ error: "Transaction or Stripe reference not found" }, { status: 404 });
    }
    const stripeConfig = await appConfigRepoImpl.getStripeConfig({
      channelId,
      appId: authData.appId,
      saleorApiUrl,
    });

    if (stripeConfig.isErr()) throw stripeConfig.error;
    if (!stripeConfig.value)
      return Response.json({ error: "Stripe channel configuration not found" }, { status: 404 });
    const stripeApi = new StripePaymentIntentsApiFactory().create({
      key: stripeConfig.value.restrictedKey,
    });
    const paymentIntent = await stripeApi.getPaymentIntent({
      id: createStripePaymentIntentId(transaction.pspReference),
    });

    if (paymentIntent.isErr()) throw paymentIntent.error;
    const intent = paymentIntent.value;
    const clientSecret = paymentIntentResumeSecret(intent);

    if (!clientSecret) {
      return Response.json(
        { resumable: false, payment_intent_state: intent.status },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      {
        resumable: true,
        payment_intent_state: intent.status,
        client_secret: clientSecret,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof InternalRequestError ? 401 : 502;

    return Response.json(
      { error: error instanceof Error ? error.message : "Payment resume lookup failed" },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
