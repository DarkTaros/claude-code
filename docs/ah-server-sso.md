# AH Server SSO

`/login` includes an `AH SSO` option for logging in through an `ah_server` instance that shares the same Logto tenant as `chatbot-new`.

## Client configuration

Set the server URL before running `/login`:

```bash
export AH_SERVER_BASE_URL=http://localhost:8787
```

The login flow stores only the AH server bearer token locally:

- `modelType: "openai"`
- `env.OPENAI_BASE_URL = "$AH_SERVER_BASE_URL/v1"`
- `env.OPENAI_API_KEY = "<ah_server_token>"`

Provider keys and upstream model routing stay on `ah_server`.
