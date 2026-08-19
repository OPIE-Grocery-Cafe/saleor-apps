import { Layout } from "@saleor/apps-ui";
import { Box, Select, Text } from "@saleor/macaw-ui";
import React from "react";

import { type ChannelFragment } from "@/generated/graphql";
import { type StripeFrontendConfigSerializedFields } from "@/modules/app-config/domain/stripe-config";

type Props = {
  channels: ChannelFragment[];
  configs: StripeFrontendConfigSerializedFields[];
  mapping: Record<string, StripeFrontendConfigSerializedFields>;
  onMappingChange(data: { channelId: string; configId: string | null }): void;
  isLoading: boolean;
};

const emptyValue = { value: "", label: "Not assigned" };

export const ChannelsConfigMapping = ({
  channels,
  configs,
  mapping,
  onMappingChange,
  isLoading,
}: Props) => {
  return (
    <Layout.AppSectionCard>
      <Box>
        {channels.map((channel) => {
          const options = [
            emptyValue,
            ...configs.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ];

          return (
            <Box paddingY={2} key={channel.id} display="flex" justifyContent="space-between">
              <Text>{channel.slug}</Text>
              <Box __minWidth="200px">
                <Select
                  disabled={isLoading}
                  value={mapping[channel.id]?.id ?? ""}
                  onChange={(value) => {
                    onMappingChange({
                      configId: value || null,
                      channelId: channel.id,
                    });
                  }}
                  options={options}
                />
              </Box>
            </Box>
          );
        })}
      </Box>
    </Layout.AppSectionCard>
  );
};
