import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext } from 'playwright';

import {
  installExecutionRequestGuard,
  shouldPersistSensitiveArtifact,
} from '../../src/execution/executor.js';
import { createDefaultPolicy, type RunPlan } from '../../src/core/index.js';

function makePlan(overrides: Partial<RunPlan['policy']> = {}): Pick<RunPlan, 'target' | 'policy'> {
  return {
    target: {
      baseUrl: 'http://app.test:3000',
      projectRoot: '/tmp/fixture',
      environment: 'test',
    },
    policy: {
      ...createDefaultPolicy('http://app.test:3000'),
      ...overrides,
    },
  };
}

describe('execution network guard', () => {
  it('requires both an explicit option and policy permission for sensitive artifacts', () => {
    const defaultPlan = makePlan();
    expect(shouldPersistSensitiveArtifact(defaultPlan, undefined)).toBe(false);
    expect(shouldPersistSensitiveArtifact(defaultPlan, true)).toBe(false);
    expect(shouldPersistSensitiveArtifact(makePlan({ allowSecretPersistence: true }), false)).toBe(false);
    expect(shouldPersistSensitiveArtifact(makePlan({ allowSecretPersistence: true }), true)).toBe(true);
  });

  it('aborts external origins and non-read methods under the default policy', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const blocked: any[] = [];
    const context = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;

    await installExecutionRequestGuard(context, makePlan(), undefined, undefined, (decision) => blocked.push(decision));
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(handler).toBeDefined();

    const externalRoute = {
      request: () => ({ url: () => 'https://outside.test/collect', method: () => 'GET' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(externalRoute);
    expect(externalRoute.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(externalRoute.continue).not.toHaveBeenCalled();

    const mutationRoute = {
      request: () => ({ url: () => 'http://app.test:3000/api/orders', method: () => 'POST' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(mutationRoute);
    expect(mutationRoute.abort).toHaveBeenCalledWith('blockedbyclient');
    expect(mutationRoute.continue).not.toHaveBeenCalled();
    expect(blocked).toHaveLength(2);
    expect(blocked[0]).toMatchObject({ reason: 'external-host', method: 'GET' });
    expect(blocked[1]).toMatchObject({ reason: 'request-method-blocked', method: 'POST' });
  });

  it('allows approved same-origin mutation requests and evaluates redirects independently', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;

    await installExecutionRequestGuard(context, makePlan({ maxRisk: 'mutate' }));

    const sameOriginPost = {
      request: () => ({ url: () => 'http://app.test:3000/api/orders', method: () => 'POST' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(sameOriginPost);
    expect(sameOriginPost.continue).toHaveBeenCalledOnce();
    expect(sameOriginPost.abort).not.toHaveBeenCalled();

    // Playwright invokes the route handler for each redirect hop. A redirect
    // to an external origin must therefore be blocked just like a direct URL.
    const redirectedRoute = {
      request: () => ({ url: () => 'https://outside.test/redirected', method: () => 'GET' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(redirectedRoute);
    expect(redirectedRoute.abort).toHaveBeenCalledWith('blockedbyclient');
  });

  it('uses the scenario and active-step risk as stricter limits than the plan', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;
    const activeStepRisk: { risk: 'read' | 'mutate' | 'destructive' } = { risk: 'read' };

    await installExecutionRequestGuard(context, makePlan({ maxRisk: 'mutate' }), 'mutate', activeStepRisk);
    const route = {
      request: () => ({ url: () => 'http://app.test:3000/api/orders', method: () => 'POST' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(route);
    expect(route.abort).toHaveBeenCalledWith('blockedbyclient');

    activeStepRisk.risk = 'mutate';
    await handler?.(route);
    expect(route.continue).toHaveBeenCalledOnce();
  });

  it('requires explicit external-origin opt-in and allowlisting', async () => {
    let handler: ((route: any) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback;
      }),
      routeWebSocket: vi.fn(async () => undefined),
    } as unknown as BrowserContext;

    await installExecutionRequestGuard(context, makePlan({
      allowExternalOrigins: true,
      allowedHosts: ['cdn.test'],
    }));

    const allowlistedRoute = {
      request: () => ({ url: () => 'https://cdn.test/app.js', method: () => 'GET' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(allowlistedRoute);
    expect(allowlistedRoute.continue).toHaveBeenCalledOnce();

    const unlistedRoute = {
      request: () => ({ url: () => 'https://evil.test/collect', method: () => 'GET' }),
      abort: vi.fn(async () => undefined),
      continue: vi.fn(async () => undefined),
    };
    await handler?.(unlistedRoute);
    expect(unlistedRoute.abort).toHaveBeenCalledWith('blockedbyclient');
  });

  it('routes WebSockets before connection and blocks them fail-closed', async () => {
    let socketHandler: ((route: any) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async (_pattern: string, callback: (route: any) => Promise<void>) => {
        socketHandler = callback;
      }),
    } as unknown as BrowserContext;
    const blocked = vi.fn();

    await installExecutionRequestGuard(
      context,
      makePlan({ maxRisk: 'mutate' }),
      'mutate',
      { risk: 'mutate' },
      blocked,
    );
    const socket = {
      url: () => 'ws://app.test:3000/events',
      close: vi.fn(async () => undefined),
      connectToServer: vi.fn(),
    };
    await socketHandler?.(socket);
    expect(socket.close).toHaveBeenCalledWith({ code: 1008, reason: 'Blocked by AI Web Test policy' });
    expect(socket.connectToServer).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledOnce();
  });
});
