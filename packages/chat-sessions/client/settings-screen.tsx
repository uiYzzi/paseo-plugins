import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
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

export function ChatSettingsScreen(_props: PluginSurfaceProps) {
  const settings = useSettings(chatSettings);
  const status = useRpc(chatStatusRpc);
  const queryClient = useQueryClient();
  const [rootDraft, setRootDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [pruneDraft, setPruneDraft] = useState<boolean | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["chat", "status"],
    queryFn: () => status({ register: false }),
    staleTime: 10_000,
  });
  const registerMutation = useMutation({
    mutationFn: () => status({ register: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chat", "status"] });
    },
  });

  if (settings.status === "loading") {
    return (
      <SettingsSection title="聊天会话">
        <SettingsCard>
          <SettingsRow label="读取设置" hint="正在读取…" />
        </SettingsCard>
      </SettingsSection>
    );
  }

  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="聊天会话">
        <SettingsCard>
          <SettingsRow label="设置不可用" error={settings.error} />
          <SettingsAction
            label="恢复默认设置"
            actionLabel="重置"
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
    setSavedNote(null);
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
      setSavedNote("已保存。下一次新建会话会使用新的目录。");
    }
  };

  const projectStatus = registerMutation.data ?? statusQuery.data;
  const statusHint = projectStatus
    ? projectStatus.registered
      ? `已注册：${projectStatus.rootDirectory}`
      : projectStatus.message ?? "尚未注册"
    : "正在检查…";

  return (
    <>
      <SettingsSection
        title="聊天目录"
        info="在新建会话时选择这个项目，每次都会在根目录下新建一个子目录作为该会话的工作目录。"
      >
        <SettingsCard>
          <SettingsInput
            label="根目录"
            hint="支持 ~ 开头。留空会回退到主目录。"
            initialValue={values.rootDirectory}
            placeholder="~/.PaseoChats"
            onChangeText={setRootDraft}
          />
          <SettingsInput
            label="项目名称"
            hint="显示在项目选择器里的名字。"
            initialValue={values.projectName}
            placeholder="聊天"
            onChangeText={setNameDraft}
          />
          <SettingsSwitch
            label="自动清理空的旧目录"
            hint="删除一周前创建、至今仍然为空的会话目录。"
            value={pruneValue}
            onValueChange={setPruneDraft}
          />
          <SettingsAction
            label="保存设置"
            actionLabel={settings.saving ? "保存中…" : "保存"}
            disabled={!dirty || settings.saving}
            onPress={() => {
              void save();
            }}
            error={settings.saveError}
            hint={savedNote ?? undefined}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="项目">
        <SettingsCard>
          <SettingsRow
            label={projectStatus?.projectName || nameValue}
            hint={statusHint}
            error={projectStatus && !projectStatus.registered ? projectStatus.message : null}
          />
          <SettingsAction
            label="注册为 Paseo 项目"
            actionLabel={registerMutation.isPending ? "注册中…" : "注册"}
            disabled={registerMutation.isPending}
            onPress={() => registerMutation.mutate()}
            hint="目录存在但项目列表里看不到时用这个。"
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
