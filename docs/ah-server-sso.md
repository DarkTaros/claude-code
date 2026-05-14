# AH Server SSO

`/login` includes an `AH SSO` option for logging in through an `ah_server` instance that shares the same Logto tenant as `chatbot-new`.

## Client configuration

Set the server URL before running `/login`:

```bash
export AH_SERVER_BASE_URL=http://localhost:8787
```

The login flow stores only the AH server bearer token locally:

- `modelType: "ah_server"`
- `ahServerAuth.accessToken = "<ah_server_token>"`
- optional `ahServerAuth.userEmail`, `ahServerAuth.userName`, and `ahServerAuth.expiresAt`

`AH_SERVER_BASE_URL` is only the business/login server address. It is not a model provider base URL and is not written into provider configuration.

Model calls use dedicated AH APIs:

- `GET /api/cli/models`
- `POST /api/cli/chat/completions`

Provider keys, provider base URLs, model authorization, routing, and streaming upstream calls stay on `ah_server`.
