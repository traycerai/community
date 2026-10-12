import { createElement } from "react";
import { LayersPlus } from "lucide-react";
import { PreloadedTabSurface } from "@/components/layout/preloaded-tab-surface";
import { draftSurfaceModule } from "@/stores/tabs/kinds/surface-modules";
import { useLandingDraftStore } from "@/stores/home/landing-draft-store";
import type { LandingDraftTab } from "@/stores/home/landing-draft-store";
import { landingDraftDisplayTitle } from "@/lib/composer/landing-draft-title";
import { draftRoute, draftPathname } from "@/lib/routes";
import { draftTabIntent } from "@/lib/tab-navigation/intents";
import type { TabKindModule } from "@/stores/tabs/types";
import { TAB_KIND_SPLIT_ELIGIBILITY } from "@/stores/tabs/tab-kind-policy";

/**
 * Module for `kind: "draft"` tabs. Each draft has its own
 * deep-linkable URL (`/draft/{draftId}`), so active highlighting
 * comes from URL matching - no `activeDraftId` cross-store read
 * needed at the strip level. The display `name` is derived at build
 * time from the draft content's first line (cheap - content is
 * hash-only, no base64); empty derived text (e.g. image-only draft)
 * → fallback label "Start Page".
 */
export const draftTabModule: TabKindModule<"draft", LandingDraftTab> = {
  kind: "draft",
  build: (source) => ({
    kind: "draft",
    id: source.id,
    route: draftPathname(source.id),
    name: landingDraftDisplayTitle(source.content),
    icon: LayersPlus,
    canDuplicate: false,
    canOpenInNewWindow: true,
    appearance: null,
  }),
  descriptor: {
    kind: "draft",
    surface: {
      render: (tab) => renderDraftSurface(tab.id),
      canonicalRoute: (tab) => tab.route,
      splitEligibility: TAB_KIND_SPLIT_ELIGIBILITY.draft,
      duplication: "forbidden",
      singleton: "per-instance",
      newWindow: "move",
      readinessScope: "default-host",
      durableState: { owner: "landing-draft", eviction: "reconstruct" },
    },
    duplicate: () => null,
    resolveIntent: (tab) => draftTabIntent(tab.id),
    routeOptions: (intent) => draftRoute(intent.draftId),
    activate: (intent) => {
      useLandingDraftStore.getState().setActiveDraft(intent.draftId);
    },
    requestClose: (tab, close) => {
      close({ kind: "draft", id: tab.id });
    },
    requiresCloseConfirm: () => false,
    openInNewWindow: (tab, deps) => {
      deps.draftFlow.requestOpenInNewWindow({ draftId: tab.id });
    },
    matchesPath: (tab, pathname) => pathname === tab.route,
  },
};

function renderDraftSurface(draftId: string) {
  return (
    <PreloadedTabSurface
      module={draftSurfaceModule}
      render={(draft) =>
        createElement(draft.DraftSurfaceProvider, {
          draftId,
          children: createElement(draft.LandingDraftSurface),
        })
      }
    />
  );
}
