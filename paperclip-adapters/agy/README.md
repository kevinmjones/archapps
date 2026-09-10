# Paperclip Antigravity adapter

Governed source for the OT Labs `agy` external Paperclip adapter. The deployed
copy lives outside this repository and must only be updated through an approved
deployment/rollback procedure; editing the live adapter in place is prohibited.

The adapter discovers its authoritative model catalog with `agy models` at
dispatch time. Its static `models` list is only a UI/configuration fallback.

## Verification

Install or link `@paperclipai/adapter-utils`, then run:

```sh
npm test
```

The live discovery test requires an authenticated `agy` CLI on `PATH`.
