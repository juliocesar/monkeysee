---
'@monkeysee/protocol': minor
'@monkeysee/bridge': minor
'extension': minor
---

Multi-tab control. Every observation/action/navigation tool now accepts an optional `tabId`
to target a specific tab without changing which tab is controlled; the target rides on the
`RpcRequest` envelope (the bridge splits it off the tool args, the SW router resolves it via
`pickTab`/`resolveTab`). Adds three MCP tools: `list_tabs` (returns `{ tabId, url, title,
active, controlled }` per tab plus the current `controlledTabId`), `switch_tab(tabId)` (sets
the controlled tab and brings it to the front), and `close_tab(tabId)` (closing the
controlled tab releases control back to the active tab). `open_tab` still sets the controlled
tab. Protocol exports `ListTabsParams`, `SwitchTabParams`, `CloseTabParams` and adds
`list_tabs`/`switch_tab`/`close_tab` to `RpcMethod`.
