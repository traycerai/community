/**
 * `environment.list` - every team environment the signed-in user belongs to.
 *
 * An environment is the cloud container a team shares: skills, the shared
 * notes block, the agent selection guide and the bot list, all held in one
 * collab room. A team is an authn organization. The user belongs to one
 * environment per team they are in, plus their personal environment, and sees
 * them side by side; there is no "current" one. The cloud lists and creates
 * them; the host proxies the list, cached for the signed-in session.
 *
 * OPTIONAL capability. Never in `RELEASED_FLOOR_METHOD_NAMES`: the floor is
 * fail-closed on the method-name union, so a name present on only one peer
 * would make the whole connection incompatible. Registered with
 * `degrade: { kind: "unsupported" }`, so a host that predates environments
 * reports the method unsupported instead of failing the handshake.
 */
import { z } from "zod";
import { defineRpcContract } from "@traycer/protocol/framework/index";
import { lazySchema } from "@traycer/protocol/framework/lazy-schema";

/**
 * Who owns an environment: an authn organization (team), or a single user.
 */
export const environmentOwnerKindSchema = lazySchema(() =>
  z.enum(["organization", "user"]),
);
export type EnvironmentOwnerKind = z.infer<typeof environmentOwnerKindSchema>;

/**
 * One environment the user belongs to. `ownerId` is the team id for an
 * organization environment and the user's own id for the personal one.
 * `label` is what to call it: the team's handle, or "Personal". `roomId`
 * names its collab room, which the host opens, never a client.
 */
export const environmentDescriptorSchema = lazySchema(() =>
  z.object({
    environmentId: z.string().min(1),
    ownerKind: environmentOwnerKindSchema,
    ownerId: z.string().min(1),
    roomId: z.string().min(1),
    label: z.string(),
  }),
);
export type EnvironmentDescriptor = z.infer<typeof environmentDescriptorSchema>;

export const environmentListRequestSchema = lazySchema(() => z.object({}));
export type EnvironmentListRequest = z.infer<
  typeof environmentListRequestSchema
>;

/**
 * The personal environment first, then one per team. A member of an object
 * root, never a bare array root, so the response can grow additively.
 */
export const environmentListResponseSchema = lazySchema(() =>
  z.object({
    environments: z.array(environmentDescriptorSchema),
  }),
);
export type EnvironmentListResponse = z.infer<
  typeof environmentListResponseSchema
>;

export const environmentListV10 = defineRpcContract({
  method: "environment.list",
  schemaVersion: { major: 1, minor: 0 } as const,
  requestSchema: environmentListRequestSchema,
  responseSchema: environmentListResponseSchema,
});
