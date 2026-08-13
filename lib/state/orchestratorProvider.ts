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
export type OrchestratorProviderSetting = 'claude' | 'copilot' | 'kimi' | 'codex' | 'auto';

/** A concrete provider the orchestrator can actually run as. */
export type OrchestratorProvider = Exclude<OrchestratorProviderSetting, 'auto'>;

/**
 * Preference order for `orchestratorProvider: 'auto'`, cheapest-capable first.
 *
 * The orchestrator issues many small, internal, mostly-mechanical queries, so
 * per-token cost matters more than peak capability. Kimi leads now that
 * KimiProvider is registered; Claude is the cheap capable fallback; Copilot is
 * heavier still.
 *
 * Codex is LAST, and the reason is a property of how the orchestrator spawns
 * rather than of the CLI's price list. Orchestrator sessions do not pin a
 * model, so each provider runs whatever it defaults to — and Codex's documented
 * default is `gpt-5.6-sol`, its flagship ("the strongest capability for complex
 * coding, computer use, research, and cybersecurity"). Codex does have cheap
 * models (`gpt-5.6-luna`, `gpt-5.4-mini`), but nothing in this path selects
 * them, so an auto-picked Codex would quietly run the most expensive default of
 * the four. Copilot at least defaults to its routed `auto` model. Move Codex up
 * only together with a change that pins a cheap model for orchestrator work.
 *
 * THIS IS THE ONE KNOB — change the order here, nowhere else.
 */
export const ORCHESTRATOR_PROVIDER_PREFERENCE: OrchestratorProvider[] = [
  'kimi',
  'claude',
  'copilot',
  'codex',
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
