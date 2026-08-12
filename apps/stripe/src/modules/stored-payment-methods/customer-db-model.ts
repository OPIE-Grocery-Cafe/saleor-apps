import { Entity, item, string } from "dynamodb-toolbox";

import { DynamoMainTable, dynamoMainTable } from "@/modules/dynamodb/dynamo-main-table";
import { type SaleorApiUrl } from "@/modules/saleor/saleor-api-url";

const schema = item({
  PK: string().key(),
  SK: string().key(),
  saleorUserId: string(),
  stripeCustomerId: string(),
});

const createEntity = (table: DynamoMainTable) =>
  new Entity({
    table,
    name: "StoredPaymentCustomer",
    schema,
    timestamps: {
      created: { name: "createdAt", savedAs: "createdAt" },
      modified: { name: "modifiedAt", savedAs: "modifiedAt" },
    },
  });

export const StoredPaymentCustomer = {
  entity: createEntity(dynamoMainTable),
  createEntity,
  getPK: ({ saleorApiUrl, appId }: { saleorApiUrl: SaleorApiUrl; appId: string }) =>
    DynamoMainTable.getPrimaryKeyScopedToInstallation({ saleorApiUrl, appId }),
  getSK: (saleorUserId: string) => `STORED_PAYMENT_CUSTOMER#${saleorUserId}` as const,
};
