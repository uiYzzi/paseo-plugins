import {
  useRpc,
  useSettings,
  useTranslation,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { chatSettings, chatStatusRpc } from "../shared/chat";
import { messages, PROBLEM_KEYS } from "./messages";

export function ChatSettingsScreen(_props: PluginSurfaceProps) {
  const { t, locale } = useTranslation(messages);
  const settings = useSettings(chatSettings);
  const status = useRpc(chatStatusRpc);
  const queryClient = useQueryClient();
  const [rootDraft, setRootDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [pruneDraft, setPruneDraft] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["chat", "status"],
    queryFn: () => status({ register: false }),
    staleTime: 10_000,
  });
  const refreshStatus = () => {
    void queryClient.invalidateQueries({ queryKey: ["chat", "status"] });
  };
  const registerMutation = useMutation({
    mutationFn: () => status({ register: true, locale }),
    onSuccess: refreshStatus,
  });
  const resetNameMutation = useMutation({
    mutationFn: () => status({ rename: true, locale }),
    onSuccess: refreshStatus,
  });
  const projectBusy = registerMutation.isPending || resetNameMutation.isPending;

  if (settings.status === "loading") {
    return (
      <SettingsSection title={t("title")}>
        <SettingsCard>
          <SettingsRow label={t("loading.label")} hint={t("loading.hint")} />
        </SettingsCard>
      </SettingsSection>
    );
  }

  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title={t("title")}>
        <SettingsCard>
          <SettingsRow label={t("invalid.label")} error={settings.error} />
          <SettingsAction
            label={t("invalid.label")}
            actionLabel={t("invalid.action")}
            onPress={() => {
              void settings.reset();
            }}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const values = settings.values;
  const rootValue = rootDraft ?? values.rootDirectory;
  const nameValue = nameDraft ?? values.projectName;
  const pruneValue = pruneDraft ?? values.pruneEmptyDirectories;
  const dirty =
    rootValue !== values.rootDirectory ||
    nameValue !== values.projectName ||
    pruneValue !== values.pruneEmptyDirectories;

  const save = async () => {
    setSaved(false);
    const ok = await settings.save(
      {
        rootDirectory: rootValue.trim(),
        projectName: nameValue.trim(),
        pruneEmptyDirectories: pruneValue,
      },
      settings.revision,
    );
    if (ok) {
      setRootDraft(null);
      setNameDraft(null);
      setPruneDraft(null);
      setSaved(true);
    }
  };

  const projectStatus = registerMutation.data ?? statusQuery.data;
  const projectProblem = projectStatus?.problem
    ? t(PROBLEM_KEYS[projectStatus.problem], {
        path: projectStatus.rootDirectory || projectStatus.projectName,
        detail: projectStatus.detail ?? "",
      })
    : null;
  const statusHint = projectProblem
    ? projectProblem
    : projectStatus
      ? t("project.registered", { path: projectStatus.rootDirectory })
      : t("project.checking");

  return (
    <>
      <SettingsSection title={t("directory.title")} info={t("directory.info")}>
        <SettingsCard>
          <SettingsInput
            label={t("root.label")}
            hint={t("root.hint")}
            initialValue={values.rootDirectory}
            placeholder={t("root.placeholder")}
            onChangeText={setRootDraft}
          />
          <SettingsInput
            label={t("name.label")}
            hint={t("name.hint")}
            initialValue={values.projectName}
            placeholder={t("name.placeholder")}
            onChangeText={setNameDraft}
          />
          <SettingsSwitch
            label={t("prune.label")}
            hint={t("prune.hint")}
            value={pruneValue}
            onValueChange={setPruneDraft}
          />
          <SettingsAction
            label={t("save.label")}
            actionLabel={settings.saving ? t("save.saving") : t("save.action")}
            disabled={!dirty || settings.saving}
            onPress={() => {
              void save();
            }}
            error={settings.saveError}
            hint={saved ? t("save.done") : undefined}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("project.title")}>
        <SettingsCard>
          <SettingsRow
            label={projectStatus?.projectName || values.projectName}
            hint={statusHint}
            error={projectProblem}
          />
          <SettingsAction
            label={t("project.register.label")}
            actionLabel={
              registerMutation.isPending
                ? t("project.register.pending")
                : t("project.register.action")
            }
            disabled={projectBusy}
            onPress={() => registerMutation.mutate()}
            hint={t("project.register.hint")}
          />
          <SettingsAction
            label={t("project.reset.label")}
            actionLabel={t("project.reset.action")}
            disabled={projectBusy || !projectStatus?.registered}
            onPress={() => resetNameMutation.mutate()}
            hint={t("project.reset.hint")}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
