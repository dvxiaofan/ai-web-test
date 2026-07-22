export const routes = [
  { path: '/', name: 'home' },
  { path: '/login', name: 'login' },
  { path: '/products', name: 'products' },
  { path: '/orders', name: 'orders', meta: { requiresAuth: true } },
  { path: '/admin', name: 'admin', meta: { role: 'admin' } },
];
