/**
 * Which CLI provider backs the hidden orchestrator session.
 *
 * The orchestrator powers internal features (Deep Session Search, task
 * assignment) and used to be hardcoded to Copilot, which meant those features
 * silently did nothing on a Claude-only install: `CopilotProvider.findBinary()`
 * threw, the spawn was swallowed, and every query returned `{ success: false }`.
 *
 * Resolution is a pure function of (setting, availability) so it can be unit
 * tested without pulling in PtyManager / node-pty. Callers supply the
 * availability probe.
 */

/** The persisted setting value. Wider than `CliType` only in that it carries
 *  'auto'; every concrete member is a registered provider. */
export type OrchestratorProviderSetting = 'claude' | 'copilot' | 'kimi' | 'auto';

/** A concrete provider the orchestrator can actually run as. */
export type OrchestratorProvider = Exclude<OrchestratorProviderSetting, 'auto'>;

/**
 * Preference order for `orchestratorProvider: 'auto'`, cheapest-capable first.
 *
 * The orchestrator issues many small, internal, mostly-mechanical queries, so
 * per-token cost matters more than peak capability. Kimi leads now that
 * KimiProvider is registered; Claude is the cheap capable fallback; Copilot is
 * last because it's the heaviest.
 *
 * THIS IS THE ONE KNOB — change the order here, nowhere else.
 */
export const ORCHESTRATOR_PROVIDER_PREFERENCE: OrchestratorProvider[] = [
  'kimi',
  'claude',
  'copilot',
];

/**
 * Resolve the setting to a concrete provider.
 *
 * - An explicit provider is honoured when available, and rejected (null) when
 *   not — the caller decides the fallback, so the failure is visible in logs
 *   rather than silently becoming a different provider.
 * - 'auto' (or an absent setting) walks `preference` and takes the first
 *   available entry.
 * - Returns null when nothing resolves.
 *
 * `isAvailable` must not throw for a provider it cannot resolve — it should
 * simply report false.
 */
export function resolveOrchestratorProvider(
  setting: OrchestratorProviderSetting | undefined,
  isAvailable: (provider: OrchestratorProvider) => boolean,
  preference: OrchestratorProvider[] = ORCHESTRATOR_PROVIDER_PREFERENCE,
): OrchestratorProvider | null {
  if (setting && setting !== 'auto') {
    return isAvailable(setting) ? setting : null;
  }
  return preference.find(isAvailable) ?? null;
}
