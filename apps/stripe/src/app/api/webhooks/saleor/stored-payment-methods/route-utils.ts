import { captureException } from "@sentry/nextjs";

import { createSaleorApiUrl, type SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

export function webhookContext(
  authData: { saleorApiUrl: string; appId: string },
  payload: { channel: { id: string }; user: { id: string; email?: string | null } },
): {
  saleorApiUrl: SaleorApiUrl;
  appId: string;
  channelId: string;
  user: { id: string; email?: string | null };
} {
  const saleorApiUrl = createSaleorApiUrl(authData.saleorApiUrl);

  if (saleorApiUrl.isErr()) throw saleorApiUrl.error;

  return {
    saleorApiUrl: saleorApiUrl.value,
    appId: authData.appId,
    channelId: payload.channel.id,
    user: payload.user,
  };
}

export function webhookFailure(error: unknown): Response {
  captureException(error);

  return Response.json(
    { error: error instanceof Error ? error.message : "Stored payment method request failed" },
    { status: 500 },
  );
}
