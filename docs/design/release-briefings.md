# Release-triggered first-run briefings

AgentMatrix can replay its first-run experience once for selected releases
without a push-notification service. The trigger ships with the application and
is evaluated locally whenever the updated app starts.

## Release contract

The current campaign lives in `config/release-briefing.json`:

```json
{
  "id": "2026-07-markdown-canvas",
  "title": "Markdown Canvas",
  "startPage": 2
}
```

- `id` is the durable acknowledgement key. Change it only when a release should
  show the briefing again.
- `title` appears in the release badge.
- `startPage` is zero-based. Returning users start on that feature, while true
  first-run users always start on page zero.

For an ordinary release that should not show FRE, leave the campaign unchanged.
For a highlighted release, update or add its slides and bump the campaign ID in
the same change.

## Runtime behavior

The renderer stores two small local values:

- `agentmatrix-intro-v2` records completion of the original welcome.
- `agentmatrix-release-briefing-v1` records the last acknowledged campaign ID.

On startup:

1. New users see the full welcome from page one.
2. Returning users whose acknowledged campaign differs from the checked-in ID
   see the release briefing once, starting at `startPage`.
3. Completing or skipping acknowledges the current campaign.
4. Settings can replay the briefing without changing release behavior.
5. `?intro=1` remains an explicit full-tour override.
6. `?intro=release` previews the current returning-user campaign and start page.

The start and update scripts need no notification-specific logic. Their existing
fast-forward pulls the campaign with the release, and the app evaluates it after
launch. Offline users see it the first time they later obtain and run that
release.

## Release checklist

1. Update the relevant slides in `app/components/FirstRunIntro.tsx`.
2. Bump `id`, `title`, and `startPage` in `config/release-briefing.json`.
3. Test a new user, a returning user, Skip, completion, Settings replay, and
   both `?intro=1` and `?intro=release`.
4. Do not derive the campaign from package version or commit SHA; that would
   replay FRE for every update instead of only intentional launches.
