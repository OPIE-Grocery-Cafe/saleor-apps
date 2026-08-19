import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";

import { withLoggerContext } from "@/lib/logger-context";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { StoredPaymentMethodsService } from "@/modules/stored-payment-methods/service";

import { webhookContext, webhookFailure } from "../stored-payment-methods/route-utils";
import { paymentMethodInitializeTokenizationDefinition } from "../stored-payment-methods/webhook-definitions";
import { withRecipientVerification } from "../with-recipient-verification";

const service = new StoredPaymentMethodsService(appConfigRepoImpl);
const handler = paymentMethodInitializeTokenizationDefinition.createHandler(
  withRecipientVerification(async (_request, ctx) => {
    try {
      if (ctx.payload.paymentFlowToSupport !== "INTERACTIVE") {
        return Response.json({
          result: "FAILED_TO_TOKENIZE",
          error: "Only interactive card tokenization is supported",
        });
      }

      return Response.json(
        await service.initializeMethod({
          ...webhookContext(ctx.authData, ctx.payload),
          issuedAt: ctx.payload.issuedAt,
          data: ctx.payload.data,
        }),
      );
    } catch (error) {
      return webhookFailure(error);
    }
  }),
);

export const POST = compose(withLoggerContext, withSpanAttributesAppRouter)(handler);
