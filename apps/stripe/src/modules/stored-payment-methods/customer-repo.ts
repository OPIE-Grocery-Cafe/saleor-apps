import { GetItemCommand, PutItemCommand } from "dynamodb-toolbox";

import { type SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

import { StoredPaymentCustomer } from "./customer-db-model";

export type StoredPaymentAccess = { saleorApiUrl: SaleorApiUrl; appId: string };

export class StoredPaymentCustomerRepo {
  private readonly entity: typeof StoredPaymentCustomer.entity;

  constructor(entity = StoredPaymentCustomer.entity) {
    this.entity = entity;
  }

  async get(access: StoredPaymentAccess, saleorUserId: string): Promise<string | null> {
    const result = await this.entity
      .build(GetItemCommand)
      .key({
        PK: StoredPaymentCustomer.getPK(access),
        SK: StoredPaymentCustomer.getSK(saleorUserId),
      })
      .send();

    return result.Item?.stripeCustomerId ?? null;
  }

  async put(
    access: StoredPaymentAccess,
    saleorUserId: string,
    stripeCustomerId: string,
  ): Promise<void> {
    await this.entity
      .build(PutItemCommand)
      .item({
        PK: StoredPaymentCustomer.getPK(access),
        SK: StoredPaymentCustomer.getSK(saleorUserId),
        saleorUserId,
        stripeCustomerId,
      })
      .options({
        condition: {
          or: [
            { attr: "stripeCustomerId", exists: false },
            { attr: "stripeCustomerId", eq: stripeCustomerId },
          ],
        },
      })
      .send();
  }
}
