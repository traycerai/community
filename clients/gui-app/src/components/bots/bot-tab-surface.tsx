import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import { AgentSpinningDots } from "@/components/ui/agent-spinning-dots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabHostProvider } from "@/components/epic-canvas/tab-host-provider";
import { useTabHostClient } from "@/hooks/host/use-tab-host-client";
import { useHostDirectoryList } from "@/hooks/host/use-host-directory-list-query";
import {
  useBotSubscriptionForHost,
  type BotSubscriptionSnapshot,
} from "@/hooks/bots/use-bot-subscription";
import { useEnvironmentListQuery } from "@/hooks/bots/use-environment-list-query";
import { useBotClaimAuthorityMutation } from "@/hooks/bots/use-bot-mutations";
import { useBotTabsStore } from "@/stores/bots/bot-tabs-store";
import { BotConversationView } from "@/components/bots/bot-conversation-view";
import { BotUnderTheHoodPanel } from "@/components/bots/bot-under-the-hood-panel";
import { BotSettingsPanel } from "@/components/bots/bot-settings-panel";

type BotTabView = "conversation" | "under-the-hood" | "settings";

function isBotTabView(value: string): value is BotTabView {
  return (
    value === "conversation" || value === "under-the-hood" || value === "settings"
  );
}

/**
 * A bot's tab (Tracy Bots). Bound to ONE host for life through
 * `TabHostProvider`: the host the bot's trunk runs on, which is the only host
 * that serves its chats. Everything below reads that host - the stream, the
 * conversation list, every write. A bot that has since moved to another host
 * is viewed THROUGH that host (the tab record is rebound and this surface
 * remounts on it) or moved back here with `bot.claimAuthority`; it is never
 * cloned.
 */
export function BotTabSurface(props: {
  readonly botId: string;
  readonly hostId: string;
}): ReactNode {
  const { botId, hostId } = props;
  return (
    <TabHostProvider key={hostId} hostId={hostId}>
      <BotTabBody botId={botId} hostId={hostId} />
    </TabHostProvider>
  );
}

function BotTabBody(props: {
  readonly botId: string;
  readonly hostId: string;
}): ReactNode {
  const { botId, hostId } = props;
  const subscription = useBotSubscriptionForHost({
    botId,
    hostId,
    enabled: true,
  });
  const closeBotTab = useBotTabsStore((s) => s.closeBotTab);
  const setBotTabTitle = useBotTabsStore((s) => s.setBotTabTitle);
  const [view, setView] = useState<BotTabView>("conversation");

  // A deleted bot has no tab: the store removal closes it everywhere.
  useEffect(() => {
    if (subscription.deleted) closeBotTab(botId);
  }, [botId, closeBotTab, subscription.deleted]);

  // The header tab shows the stream's title, which a rename elsewhere moves.
  const snapshotTitle = subscription.snapshot?.bot.title ?? null;
  useEffect(() => {
    if (snapshotTitle !== null) setBotTabTitle(botId, snapshotTitle);
  }, [botId, setBotTabTitle, snapshotTitle]);

  // The host re-sends a snapshot only for changes IT made; a bot rebound or
  // edited from another host reaches this tab on the next subscribe, so the
  // tab asks again when its window comes back into view.
  const { resubscribe } = subscription;
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") resubscribe();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [resubscribe]);

  const snapshot = subscription.snapshot;
  if (snapshot === null) {
    if (subscription.error !== null) {
      return (
        <div
          role="status"
          data-testid="bot-tab-error"
          className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-ui-sm text-destructive-foreground"
        >
          <span>Couldn&apos;t reach this bot: {subscription.error}</span>
          <Button type="button" variant="outline" size="sm" onClick={resubscribe}>
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        aria-busy="true"
        data-testid="bot-tab-connecting"
      >
        <AgentSpinningDots className={undefined} testId={undefined} variant={undefined} />
      </div>
    );
  }

  const boundHere = snapshot.boundHost.isThisHost;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="bot-tab">
      <BotTabHeader botId={botId} hostId={hostId} snapshot={snapshot} />
      {boundHere ? null : (
        <BoundElsewhereBanner botId={botId} snapshot={snapshot} onMoved={resubscribe} />
      )}
      <Tabs
        value={view}
        onValueChange={(next) => {
          if (isBotTabView(next)) setView(next);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList aria-label="Bot view" className="mx-4 self-start">
          <TabsTrigger value="conversation" data-testid="bot-tab-view-conversation">
            Conversation
          </TabsTrigger>
          <TabsTrigger value="under-the-hood" data-testid="bot-tab-view-under-the-hood">
            Under the hood
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="bot-tab-view-settings">
            Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col">
          <BotConversationView
            botId={botId}
            hostId={hostId}
            botTitle={snapshot.bot.title}
          />
        </TabsContent>
        <TabsContent value="under-the-hood" className="flex min-h-0 flex-1 flex-col">
          <BotUnderTheHoodPanel
            botId={botId}
            hostId={hostId}
            botTitle={snapshot.bot.title}
            trunkChatId={snapshot.bot.trunkChatId}
            tasks={snapshot.tasks}
            openRequestCount={snapshot.openRequestCount}
          />
        </TabsContent>
        <TabsContent value="settings" className="flex min-h-0 flex-1 flex-col">
          <BotSettingsPanel bot={snapshot.bot} canEdit={boundHere} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BotTabHeader(props: {
  readonly botId: string;
  readonly hostId: string;
  readonly snapshot: BotSubscriptionSnapshot;
}): ReactNode {
  const { hostId, snapshot } = props;
  const client = useTabHostClient();
  const environments = useEnvironmentListQuery(client, true);
  const directory = useHostDirectoryList();
  const environmentLabel = useMemo(() => {
    const match = environments.data?.environments.find(
      (environment) =>
        environment.environmentId === snapshot.bot.environmentId,
    );
    return match?.label ?? snapshot.bot.environmentId;
  }, [environments.data, snapshot.bot.environmentId]);
  const hostLabel = useMemo(
    () =>
      directory.data?.find((entry) => entry.hostId === hostId)?.label ?? hostId,
    [directory.data, hostId],
  );
  const openRequests = snapshot.openRequestCount;
  return (
    <header className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/6 text-muted-foreground">
        <Bot className="size-4.5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1
          className="truncate text-ui-md font-semibold text-foreground"
          data-testid="bot-tab-title"
        >
          {snapshot.bot.title}
        </h1>
        <p className="truncate text-ui-xs text-muted-foreground">
          {environmentLabel} · {hostLabel}
        </p>
      </div>
      {openRequests !== null && openRequests > 0 ? (
        <Badge variant="warning" size="sm" data-testid="bot-tab-open-requests">
          {openRequests === 1 ? "1 open request" : `${openRequests} open requests`}
        </Badge>
      ) : null}
    </header>
  );
}

/**
 * The bot's trunk now runs on another host. Two ways on: view it through
 * that host (the tab rebinds and remounts there), or move it here, which
 * makes THIS host the bound one and re-reads the stream.
 */
function BoundElsewhereBanner(props: {
  readonly botId: string;
  readonly snapshot: BotSubscriptionSnapshot;
  readonly onMoved: () => void;
}): ReactNode {
  const { botId, snapshot, onMoved } = props;
  const client = useTabHostClient();
  const claim = useBotClaimAuthorityMutation(client);
  const rebindBotTab = useBotTabsStore((s) => s.rebindBotTab);
  const directory = useHostDirectoryList();
  const boundHostId = snapshot.boundHost.hostId;
  const boundLabel =
    directory.data?.find((entry) => entry.hostId === boundHostId)?.label ??
    boundHostId;
  return (
    <div
      role="status"
      data-testid="bot-tab-bound-elsewhere"
      className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-ui-sm text-info-foreground"
    >
      <span>This bot runs on {boundLabel}. Its conversation is read there.</span>
      <span className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={claim.isPending}
          onClick={() => rebindBotTab(botId, boundHostId)}
        >
          View on {boundLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={claim.isPending}
          data-testid="bot-tab-move-here"
          onClick={() =>
            claim.mutate({ botId }, { onSuccess: () => onMoved() })
          }
        >
          Move it here
          {claim.isPending ? (
            <AgentSpinningDots
              className="ml-1"
              testId={undefined}
              variant={undefined}
            />
          ) : null}
        </Button>
      </span>
    </div>
  );
}
