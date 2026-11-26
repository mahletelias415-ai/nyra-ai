# Nyra MCP

The hosted endpoint is `https://nyraagent.online/mcp`. It supports stateless JSON-RPC over HTTP POST. Configure a client that supports a remote HTTP MCP server:

```json
{
  "mcpServers": {
    "nyra": {
      "url": "https://nyraagent.online/mcp"
    }
  }
}
```

Client configuration field names can differ. The endpoint does not accept or require a wallet private key, seed phrase or browser cookie.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `rh_network` | None | Chain ID, latest block and gas price |
| `rh_wallet` | `address` | ETH and supported Stock Token balances |
| `rh_stock` | `symbol` | Official bid/ask, multiplier, contract and quote time |
| `rh_pons_token` | `address` | Indexed launch and curve/market snapshot |
| `rh_pons_launches` | None | Latest indexed Pons launch page |
| `rh_transaction` | `hash` | Transaction status, parties and gas |
| `rh_contract` | `address` | Code presence and `owner()` where available |

Use `tools/list` to inspect the current schemas. Successful calls include `readAt` and a source URL. Tool failures are returned as MCP `isError` content.

## Check the endpoint

```sh
curl --fail-with-body https://nyraagent.online/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl --fail-with-body https://nyraagent.online/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"rh_network","arguments":{}}}'
```

MCP calls read public sources only. They do not create a signed-in workspace reading, start a watch, access private research or execute a transaction. Contract metadata is not a safety assessment; Pons coverage is the indexed page rather than every on-chain transaction.
