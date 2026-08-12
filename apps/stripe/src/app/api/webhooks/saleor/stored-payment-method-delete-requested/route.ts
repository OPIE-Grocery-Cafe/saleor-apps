import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";

import { withLoggerContext } from "@/lib/logger-context";
import { appConfigRepoImpl } from "@/modules/app-config/repositories/app-config-repo-impl";
import { StoredPaymentMethodsService } from "@/modules/stored-payment-methods/service";

import { webhookContext, webhookFailure } from "../stored-payment-methods/route-utils";
import { storedPaymentMethodDeleteRequestedDefinition } from "../stored-payment-methods/webhook-definitions";
import { withRecipientVerification } from "../with-recipient-verification";

const service = new StoredPaymentMethodsService(appConfigRepoImpl);
const handler = storedPaymentMethodDeleteRequestedDefinition.createHandler(
  withRecipientVerification(async (_request, ctx) => {
    try {
      return Response.json(
        await service.remove({
          ...webhookContext(ctx.authData, ctx.payload),
          paymentMethodId: ctx.payload.paymentMethodId,
        }),
      );
    } catch (error) {
      return webhookFailure(error);
    }
  }),
);

export const POST = compose(withLoggerContext, withSpanAttributesAppRouter)(handler);
