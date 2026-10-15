/**
 * Write keys for the Personal settings the host forwards to the person's
 * environment (`environment.*`): agent definitions and machine setup.
 */
export const environmentMutationKeys = {
  agentDefinitionsPut: () => ["environment.agentDefinitions.put"] as const,
  agentDefinitionsDelete: () =>
    ["environment.agentDefinitions.delete"] as const,
  setupPut: () => ["environment.setup.put"] as const,
  setupRetry: () => ["environment.setup.retry"] as const,
  undo: () => ["environment.undo"] as const,
  localOverrideSet: () => ["config.env.localOverride.set"] as const,
  localOverrideClear: () => ["config.env.localOverride.clear"] as const,
  remoteAccessSet: () => ["host.remoteAccess.set"] as const,
};
