import {
  useRpc,
  useSettings,
  useTranslation,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  ExternalLink,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { codexbarSettings } from "../shared/settings";
import { codexbarStatus } from "../shared/status";
import { messages } from "./messages";

const CODEXBAR_URL = "https://github.com/steipete/CodexBar";

export function CodexbarSettingsScreen(_props: PluginSurfaceProps) {
  const { t } = useTranslation(messages);
  const status = useRpc(codexbarStatus);
  const settings = useSettings(codexbarSettings);
  const queryClient = useQueryClient();
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ["codexbar", "status"],
    queryFn: () => status({}),
    staleTime: 10_000,
  });

  const body = () => {
    if (query.isPending) return <SettingsRow label={t("status.checking")} />;
    if (query.isError || !query.data) {
      return (
        <SettingsRow
          label={t("status.cliLabel")}
          error={t("status.checkFailed")}
          hint={query.error instanceof Error ? query.error.message : undefined}
        />
      );
    }
    const data = query.data;
    // A missing CLI is the case worth shouting about: nothing else here can work.
    if (!data.available) {
      return (
        <>
          <SettingsRow
            label={t("status.missingLabel")}
            error={data.error}
            hint={t("status.missingHint")}
          >
            <ExternalLink href={CODEXBAR_URL} accessibilityLabel={t("status.install")}>
              {t("status.install")}
            </ExternalLink>
          </SettingsRow>
        </>
      );
    }
    return (
      <>
        <SettingsRow
          label={t("status.cliLabel")}
          hint={data.version ? `${data.command} · ${data.version}` : data.command}
        />
        {data.providers.length > 0 ? (
          <SettingsRow
            label={t("status.providersLabel")}
            hint={t("status.providersHint", { count: data.providers.length })}
          >
            {data.providers.map((provider) => provider.name).join(", ")}
          </SettingsRow>
        ) : (
          <SettingsRow label={t("status.providersLabel")} error={t("status.providersEmpty")} />
        )}
      </>
    );
  };

  const settingsBody = () => {
    if (settings.status === "loading") return <SettingsRow label={t("cliPath.label")} />;
    if (settings.status === "error" || settings.status === "invalid") {
      return (
        <>
          <SettingsRow label={t("cliPath.label")} error={settings.error} />
          <SettingsAction
            label={t("cliPath.label")}
            actionLabel={t("cliPath.reset")}
            onPress={() => {
              void settings.reset();
            }}
          />
        </>
      );
    }
    const value = pathDraft ?? settings.values.cliPath;
    const dirty = value !== settings.values.cliPath;
    return (
      <>
        <SettingsInput
          label={t("cliPath.label")}
          hint={t("cliPath.hint")}
          placeholder={t("cliPath.placeholder")}
          initialValue={settings.values.cliPath}
          onChangeText={(text) => {
            setSaved(false);
            setPathDraft(text);
          }}
        />
        <SettingsAction
          label={t("cliPath.label")}
          actionLabel={settings.saving ? t("cliPath.saving") : t("cliPath.action")}
          disabled={!dirty || settings.saving}
          error={settings.saveError}
          hint={saved ? t("cliPath.done") : undefined}
          onPress={() => {
            void (async () => {
              const ok = await settings.save({ cliPath: value.trim() }, settings.revision);
              if (!ok) return;
              setPathDraft(null);
              setSaved(true);
              void queryClient.invalidateQueries({ queryKey: ["codexbar", "status"] });
            })();
          }}
        />
      </>
    );
  };

  return (
    <>
      <SettingsSection title={t("status.title")} info={t("status.info")}>
        <SettingsCard>
          {body()}
          <SettingsAction
            label={t("status.title")}
            actionLabel={t("status.check")}
            disabled={query.isFetching}
            onPress={() => {
              void queryClient.invalidateQueries({ queryKey: ["codexbar", "status"] });
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("cliPath.title")} info={t("cliPath.info")}>
        <SettingsCard>{settingsBody()}</SettingsCard>
      </SettingsSection>
    </>
  );
}
