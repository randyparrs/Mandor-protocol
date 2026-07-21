// Per-vault pinned AI model version, no silent migration, see
// docs/architecture.md and docs/threat-model.md's "Model drift on silent
// version updates" row. In-memory for now; Phase 3's real VaultMetadata
// store backs this the same way, the shape doesn't change.
export interface ModelPin {
  modelId: string;
  pinnedAt: string;
}

const pins = new Map<string, ModelPin>();

export class NoModelPinError extends Error {
  constructor(vaultId: string) {
    super(
      `No model pin exists for vault ${vaultId}. Refusing to run: a model migration ` +
        `requires a manual registry update and a Paper Vault re-validation pass, never a silent default.`,
    );
    this.name = "NoModelPinError";
  }
}

export function getModelPin(vaultId: string): ModelPin {
  const pin = pins.get(vaultId);
  if (!pin) throw new NoModelPinError(vaultId);
  return pin;
}

export function setModelPin(vaultId: string, modelId: string): void {
  pins.set(vaultId, { modelId, pinnedAt: new Date().toISOString() });
}
