import { describe, expect, it } from "vitest";

import {
  extractApiOperations,
  extractConfiguredRoutes,
  fileRoutePath,
} from "../../src/discovery/index.js";

describe("route extraction", () => {
  it("extracts nested route records, authentication metadata and roles", () => {
    const routes = extractConfiguredRoutes(
      "src/router.tsx",
      `
        const routes = [{
          path: '/orders',
          element: <ProtectedRoute><Orders /></ProtectedRoute>,
          meta: { requiresAuth: true, roles: ['admin', 'merchant'] },
          children: [
            { path: ':id', name: 'order-detail', component: OrderDetail },
          ],
        }];
      `,
      "react",
      "routing",
    );

    expect(routes.map((route) => route.path)).toEqual(["/orders", "/orders/:id"]);
    expect(routes[0]).toEqual(expect.objectContaining({
      requiresAuth: true,
      roles: ["admin", "merchant"],
      moduleName: "orders",
    }));
  });

  it("extracts React Router JSX including nested routes", () => {
    const routes = extractConfiguredRoutes(
      "src/App.tsx",
      `
        export const App = () => (
          <Routes>
            <Route path="/account" element={<Account />}>
              <Route path="security" element={<Security />} />
            </Route>
          </Routes>
        );
      `,
      "react",
      "root",
    );

    expect(routes.map((route) => route.path)).toEqual(["/account", "/account/security"]);
  });

  it("maps Next and Nuxt file conventions to route patterns", () => {
    expect(fileRoutePath("src/app/(shop)/products/[id]/page.tsx", "next")).toBe("/products/:id");
    expect(fileRoutePath("pages/blog/[...slug].tsx", "next")).toBe("/blog/*slug");
    expect(fileRoutePath("pages/users/[id].vue", "nuxt")).toBe("/users/:id");
    expect(fileRoutePath("pages/index.vue", "nuxt")).toBe("/");
  });
});

describe("API extraction", () => {
  it("extracts fetch, Axios instances, dynamic URLs and GraphQL operations", () => {
    const operations = extractApiOperations(
      "src/features/orders/api.ts",
      `
        import axios from 'axios';
        import { gql, request } from 'graphql-request';
        const API = '/api';
        const client = axios.create({ baseURL: API });

        export const listOrders = () => fetch(API + '/orders');
        export async function updateOrder(id: string) {
          return client.patch(\`/orders/\${id}\`, { status: 'paid' });
        }
        const OrderQuery = gql\`query Order($id: ID!) { order(id: $id) { id } }\`;
        export const loadOrder = () => request('/graphql', OrderQuery);
      `,
      "orders",
    );

    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "GET", urlPattern: "/api/orders", transport: "fetch" }),
      expect.objectContaining({ method: "PATCH", urlPattern: "/orders/${id}", transport: "axios" }),
      expect.objectContaining({ method: "QUERY", urlPattern: "/graphql", operationName: "Order" }),
    ]));
  });
});
