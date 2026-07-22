# Framework adapters

Static discovery has a generic fallback and built-in heuristics for React, Vue,
Next, and Nuxt. Projects with a custom router or generated API client can add a
small adapter without changing the runner or report format.

An adapter should contribute:

```ts
interface DiscoveryAdapter {
  id: string;
  canHandle(context: { rootDir: string; framework: string }): Promise<boolean>;
  discoverRoutes(context: AdapterContext): Promise<DiscoveredRoute[]>;
  discoverApis(context: AdapterContext): Promise<DiscoveredApiOperation[]>;
  discoverRoles?(context: AdapterContext): Promise<RoleFinding[]>;
}
```

Adapters must return source evidence and confidence for every finding. They may
not execute browser actions or bypass the policy gate. Runtime observations are
merged later, so an adapter remains useful even when the target has no local
server.

When adding an adapter:

1. cover the parser with fixture files;
2. test duplicate and dynamic route handling;
3. include a negative fixture proving secrets are not extracted into artifacts;
4. document any project configuration needed for complete discovery.
