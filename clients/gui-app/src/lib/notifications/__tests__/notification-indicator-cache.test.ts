import { createElement, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostClient } from "@traycer-clients/shared/host-client/host-client";
import { mockLocalHostEntry } from "@traycer-clients/shared/host-client/mock/mock-host-directory";
import { MockHostMessenger } from "@traycer-clients/shared/host-client/mock/mock-host-messenger";
import { createRequestContextFixture } from "@traycer-clients/shared/test-fixtures/request-context";
import type { HostNotificationsIndicatorStateResponse } from "@traycer/protocol/host/notifications/contracts";
import { hostRpcRegistry, type HostRpcRegistry } from "@traycer/protocol/host";
import {
  clearNotificationIndicatorCaches,
  invalidateNotificationIndicators,
  invalidateNotificationIndicatorsForEntities,
} from "@/lib/notifications/notification-indicator-cache";
import { createHostQueryInvalidator } from "@/lib/host/query-invalidator";
import { notificationsQueryKeys, queryKeys } from "@/lib/query-keys";

function indicatorKey(input: {
  readonly hostId: string;
  readonly userId: string;
  readonly epicIds: ReadonlyArray<string>;
  readonly chatIds: ReadonlyArray<string>;
}) {
  return [
    ...queryKeys.hostMethod<
      HostRpcRegistry,
      "host.notifications.indicatorState"
    >(input.hostId, "host.notifications.indicatorState", {
      epicIds: [...input.epicIds],
      chatIds: [...input.chatIds],
    }),
    notificationsQueryKeys.indicatorIdentity(input.userId),
  ] as const;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise(value) };
}

function createIndicatorClient(
  queryClient: QueryClient,
  requests: Array<Deferred<HostNotificationsIndicatorStateResponse>>,
): HostClient<HostRpcRegistry> {
  const spine = new HostClient<HostRpcRegistry>({
    registry: hostRpcRegistry,
    invalidator: createHostQueryInvalidator(queryClient),
    findHostById: (hostId) =>
      hostId === mockLocalHostEntry.hostId ? mockLocalHostEntry : null,
    messenger: new MockHostMessenger<HostRpcRegistry>({
      registry: hostRpcRegistry,
      requestId: () => "request-1",
      handlers: {
        "host.notifications.indicatorState": () => {
          const deferred =
            createDeferred<HostNotificationsIndicatorStateResponse>();
          requests.push(deferred);
          return deferred.promise;
        },
      },
    }),
  });
  spine.setRequestContext(
    createRequestContextFixture({ origin: "renderer", bearerToken: "token" }),
  );
  return spine.createRequester(mockLocalHostEntry);
}

const CALM_INDICATOR = {
  unreadFailure: false,
  pendingFork: false,
  pendingApproval: false,
  pendingInterview: false,
  unreadDone: false,
};

function indicatorResponse(
  unreadFailure: boolean,
): HostNotificationsIndicatorStateResponse {
  return {
    epics: { "epic-a": { ...CALM_INDICATOR, unreadFailure } },
    chats: {},
  };
}

/** Invalidations coalesce on a microtask; let it and the hops behind it run. */
async function flush(): Promise<void> {
  for (let hop = 0; hop < 20; hop += 1) await Promise.resolve();
}

function afterMicrotasks(count: number, run: () => void): void {
  if (count <= 0) {
    run();
    return;
  }
  queueMicrotask(() => afterMicrotasks(count - 1, run));
}

/** One mounted indicator query whose every request stays pending until settled. */
function mountIndicatorQuery() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const requests: Array<Deferred<HostNotificationsIndicatorStateResponse>> = [];
  const client = createIndicatorClient(queryClient, requests);
  const key = indicatorKey({
    hostId: mockLocalHostEntry.hostId,
    userId: "alice",
    epicIds: ["epic-a"],
    chatIds: ["chat-a"],
  });
  const wrapper = (props: { readonly children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: queryClient }, props.children);
  const { result } = renderHook(
    () =>
      useQuery(
        queryOptions({
          queryKey: key,
          queryFn: () =>
            client.request("host.notifications.indicatorState", {
              epicIds: ["epic-a"],
              chatIds: ["chat-a"],
            }),
        }),
      ),
    { wrapper },
  );
  return { queryClient, client, requests, result };
}

describe("notification indicator cache invalidation", () => {
  // Globals are off: the mounted query of one test must not outlive it.
  afterEach(() => {
    cleanup();
  });

  it("invalidates only query surfaces containing the frame entity", async () => {
    const queryClient = new QueryClient();
    const target = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-a"],
      chatIds: ["chat-a"],
    });
    const other = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-b"],
      chatIds: ["chat-b"],
    });
    const epicOnly = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-a"],
      chatIds: [],
    });
    queryClient.setQueryData(target, { epics: {}, chats: {} });
    queryClient.setQueryData(other, { epics: {}, chats: {} });
    queryClient.setQueryData(epicOnly, { epics: {}, chats: {} });

    invalidateNotificationIndicatorsForEntities(
      queryClient,
      "host-a",
      [{ epicId: "epic-a", chatId: "chat-a" }],
      null,
    );
    await flush();

    expect(queryClient.getQueryState(target)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(epicOnly)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it("clears all account-scoped indicator caches on identity reset", () => {
    const queryClient = new QueryClient();
    const alice = indicatorKey({
      hostId: "host-a",
      userId: "alice",
      epicIds: ["epic-a"],
      chatIds: [],
    });
    const bob = indicatorKey({
      hostId: "host-b",
      userId: "bob",
      epicIds: ["epic-b"],
      chatIds: [],
    });
    queryClient.setQueryData(alice, { epics: {}, chats: {} });
    queryClient.setQueryData(bob, { epics: {}, chats: {} });

    clearNotificationIndicatorCaches(queryClient);

    expect(queryClient.getQueryData(alice)).toBeUndefined();
    expect(queryClient.getQueryData(bob)).toBeUndefined();
  });

  it("cancels an in-flight fetch before refetching after an entity invalidation", async () => {
    const { queryClient, client, requests, result } = mountIndicatorQuery();
    await waitFor(() => expect(requests).toHaveLength(1));

    act(() => {
      invalidateNotificationIndicatorsForEntities(
        queryClient,
        mockLocalHostEntry.hostId,
        [{ epicId: "epic-a", chatId: "chat-a" }],
        client,
      );
    });

    await waitFor(() => expect(requests).toHaveLength(2));

    act(() => {
      requests[0].resolve(indicatorResponse(false));
      requests[1].resolve(indicatorResponse(true));
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(indicatorResponse(true));
    });
  });

  it("coalesces invalidations of one host raised in the same tick into one pass, keeping every entity and other hosts apart", async () => {
    const queryClient = new QueryClient();
    const chatA = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-a"],
      chatIds: ["chat-a"],
    });
    const chatB = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-b"],
      chatIds: ["chat-b"],
    });
    const untouched = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-c"],
      chatIds: [],
    });
    const otherHost = indicatorKey({
      hostId: "host-b",
      userId: "user-a",
      epicIds: ["epic-a"],
      chatIds: ["chat-a"],
    });
    for (const key of [chatA, chatB, untouched, otherHost]) {
      queryClient.setQueryData(key, { epics: {}, chats: {} });
    }
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    invalidateNotificationIndicatorsForEntities(
      queryClient,
      "host-a",
      [{ epicId: "epic-a", chatId: "chat-a" }],
      null,
    );
    invalidateNotificationIndicatorsForEntities(
      queryClient,
      "host-a",
      [{ epicId: "epic-b", chatId: "chat-b" }],
      null,
    );
    invalidateNotificationIndicatorsForEntities(
      queryClient,
      "host-a",
      [{ epicId: "epic-a", chatId: "chat-a" }],
      null,
    );

    // Nothing is issued synchronously: the frames of one tick share a pass.
    expect(invalidate).not.toHaveBeenCalled();
    await flush();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(chatA)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(chatB)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(untouched)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(otherHost)?.isInvalidated).toBe(false);
  });

  it("widens a pending entity invalidation to the whole host when a full one joins it", async () => {
    const queryClient = new QueryClient();
    const chat = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-a"],
      chatIds: ["chat-a"],
    });
    const elsewhere = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-b"],
      chatIds: [],
    });
    queryClient.setQueryData(chat, { epics: {}, chats: {} });
    queryClient.setQueryData(elsewhere, { epics: {}, chats: {} });

    invalidateNotificationIndicatorsForEntities(
      queryClient,
      "host-a",
      [{ epicId: "epic-a", chatId: "chat-a" }],
      null,
    );
    invalidateNotificationIndicators(queryClient, "host-a", null);
    await flush();

    expect(queryClient.getQueryState(chat)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(elsewhere)?.isInvalidated).toBe(true);
  });

  it("refetches once more for an invalidation that arrives while the previous refetch is still pending, instead of joining its stale answer", async () => {
    const { queryClient, client, requests, result } = mountIndicatorQuery();
    await waitFor(() => expect(requests).toHaveLength(1));

    act(() => {
      invalidateNotificationIndicatorsForEntities(
        queryClient,
        mockLocalHostEntry.hostId,
        [{ epicId: "epic-a", chatId: "chat-a" }],
        client,
      );
    });
    await waitFor(() => expect(requests).toHaveLength(2));

    // A second frame lands while request 2 is in flight: it is held as the
    // dirty successor rather than cancelling or joining the read in flight.
    act(() => {
      invalidateNotificationIndicatorsForEntities(
        queryClient,
        mockLocalHostEntry.hostId,
        [{ epicId: "epic-a", chatId: "chat-a" }],
        client,
      );
    });
    await flush();
    expect(requests).toHaveLength(2);

    act(() => {
      requests[0].resolve(indicatorResponse(false));
      requests[1].resolve(indicatorResponse(false));
    });
    await waitFor(() => expect(requests).toHaveLength(3));

    act(() => {
      requests[2].resolve(indicatorResponse(true));
    });
    await waitFor(() => {
      expect(result.current.data).toEqual(indicatorResponse(true));
    });
    // Once the successor settles nothing is left dirty.
    await flush();
    expect(requests).toHaveLength(3);
  });

  // A change raised just after a pass finished must not be lost to the pass's
  // own bookkeeping. Where in the microtask queue it lands is not something a
  // caller controls, so every offset must end the same way: the change's
  // surface is invalidated.
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    "invalidates a change raised %i microtasks after the previous pass's last invalidation settled",
    async (offset) => {
      const queryClient = new QueryClient();
      const first = indicatorKey({
        hostId: "host-a",
        userId: "user-a",
        epicIds: ["epic-a"],
        chatIds: ["chat-a"],
      });
      const later = indicatorKey({
        hostId: "host-a",
        userId: "user-a",
        epicIds: ["epic-b"],
        chatIds: ["chat-b"],
      });
      queryClient.setQueryData(first, { epics: {}, chats: {} });
      queryClient.setQueryData(later, { epics: {}, chats: {} });
      const invalidate = queryClient.invalidateQueries.bind(queryClient);
      let raised = false;
      vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
        (...args) => {
          const answered = invalidate(...args);
          if (!raised) {
            raised = true;
            // Registered ahead of the pass's own continuation.
            void answered.then(() => {
              afterMicrotasks(offset, () => {
                invalidateNotificationIndicatorsForEntities(
                  queryClient,
                  "host-a",
                  [{ epicId: "epic-b", chatId: "chat-b" }],
                  null,
                );
              });
            });
          }
          return answered;
        },
      );

      invalidateNotificationIndicatorsForEntities(
        queryClient,
        "host-a",
        [{ epicId: "epic-a", chatId: "chat-a" }],
        null,
      );
      await flush();
      await flush();

      expect(queryClient.getQueryState(first)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(later)?.isInvalidated).toBe(true);
    },
  );

  it("keeps an earlier raiser's cancellation authority when a later raiser in the same tick brings none", async () => {
    const { queryClient, client, requests } = mountIndicatorQuery();
    await waitFor(() => expect(requests).toHaveLength(1));
    // The real client's own cancellation, wrapped to record its calls: the
    // read in flight is genuinely cancelled and the refetch is a fresh request.
    // (A requester resolves its methods through a proxy on every read, so
    // `vi.spyOn(client, ...)` would not be the function the cache calls.)
    const cancelActiveRead = vi.fn(client.cancelActiveRead.bind(client));
    const entity = { epicId: "epic-a", chatId: "chat-a" };

    act(() => {
      invalidateNotificationIndicatorsForEntities(
        queryClient,
        mockLocalHostEntry.hostId,
        [entity],
        { cancelActiveRead },
      );
      invalidateNotificationIndicatorsForEntities(
        queryClient,
        mockLocalHostEntry.hostId,
        [entity],
        null,
      );
    });
    await waitFor(() => expect(requests).toHaveLength(2));

    // The read in flight is told to stop on the host, not only dropped here.
    expect(cancelActiveRead).toHaveBeenCalledWith(
      "host.notifications.indicatorState",
      { epicIds: ["epic-a"], chatIds: ["chat-a"] },
    );
  });

  it("drops a pending invalidation when the indicator caches are cleared", async () => {
    const queryClient = new QueryClient();
    const key = indicatorKey({
      hostId: "host-a",
      userId: "user-a",
      epicIds: ["epic-a"],
      chatIds: ["chat-a"],
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(key, { epics: {}, chats: {} });

    invalidateNotificationIndicators(queryClient, "host-a", null);
    clearNotificationIndicatorCaches(queryClient);
    await flush();

    expect(invalidate).not.toHaveBeenCalled();
  });
});
