# Paperclip Antigravity adapter

Governed source for the OT Labs `agy` external Paperclip adapter. The deployed
copy lives outside this repository and must only be updated through an approved
deployment/rollback procedure; editing the live adapter in place is prohibited.

The adapter discovers its authoritative model catalog with `agy models` at
dispatch time. Its static `models` list is only a UI/configuration fallback.

## Permission policy and migration

`dangerouslySkipPermissions` is deny-by-default. Omitting it, or setting it to
`false`, leaves Agy's normal permission boundary in force. This limits the
blast radius of prompt injection or an over-broad autonomous action, but an
unattended run that reaches an interactive permission prompt may stop instead
of completing.

Operators must set `dangerouslySkipPermissions: true` explicitly for a reviewed
agent whose autonomous workload cannot otherwise complete. Before rollout,
audit existing Agy agent configurations and add the explicit override only to
those accepted exceptions. Roll back by reverting the adapter release; because
the previous behavior interpreted an omitted value as `true`, no configuration
migration is required for rollback. No credentials or other permission settings
are changed by this policy.

## Verification

Install or link `@paperclipai/adapter-utils`, then run:

```sh
npm test
```

The live discovery test requires an authenticated `agy` CLI on `PATH`.
