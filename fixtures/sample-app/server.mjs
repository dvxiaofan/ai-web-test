import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4178);

const products = [
  { id: 'p-1', name: 'Keyboard', price: 399 },
  { id: 'p-2', name: 'Mouse', price: 199 },
];
const orders = [{ id: 'o-1', productId: 'p-1', status: 'paid' }];

const page = (title, body, script = '') => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; max-width: 920px; margin: 40px auto; padding: 0 20px; }
      nav { display: flex; gap: 16px; margin-bottom: 32px; }
      button, input { font: inherit; padding: 8px 12px; }
      .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 12px 0; }
      #status { min-height: 24px; color: #14532d; }
    </style>
  </head>
  <body>
    <nav aria-label="Primary">
      <a href="/">Home</a><a href="/products">Products</a>
      <a href="/orders">Orders</a><a href="/admin">Admin</a>
      <a href="/login">Login</a>
    </nav>
    <main><h1>${title}</h1>${body}</main>
    <script>${script}</script>
  </body>
</html>`;

const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};

const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

  if (url.pathname === '/api/products' && request.method === 'GET') {
    return json(response, { items: products });
  }
  if (url.pathname === '/api/orders' && request.method === 'GET') {
    return json(response, { items: orders });
  }
  if (url.pathname === '/api/orders' && request.method === 'POST') {
    const input = JSON.parse((await readBody(request)) || '{}');
    const order = { id: `o-${orders.length + 1}`, productId: input.productId, status: 'draft' };
    orders.push(order);
    return json(response, order, 201);
  }

  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (url.pathname === '/') {
    return response.end(page('Sample shop', '<p data-testid="welcome">A fixture for AI Web Test.</p>'));
  }
  if (url.pathname === '/login') {
    return response.end(page('Login', `
      <form id="login-form">
        <label>Email <input name="email" type="email" required /></label>
        <button type="submit">Sign in</button>
      </form><p id="status" role="status"></p>`, `
      document.querySelector('#login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        document.querySelector('#status').textContent = 'Signed in for this test session';
      });`));
  }
  if (url.pathname === '/products') {
    return response.end(page('Products', '<section id="products" aria-live="polite">Loading…</section>', `
      fetch('/api/products').then(r => r.json()).then(({items}) => {
        document.querySelector('#products').innerHTML = items.map(item =>
          '<article class="card"><h2>' + item.name + '</h2><p>¥' + item.price + '</p>' +
          '<button data-product="' + item.id + '">Create draft order</button></article>'
        ).join('');
        document.querySelectorAll('[data-product]').forEach(button => button.addEventListener('click', async () => {
          const result = await fetch('/api/orders', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({productId: button.dataset.product}) }).then(r => r.json());
          button.insertAdjacentHTML('afterend', '<p role="status">Draft ' + result.id + ' created</p>');
        }));
      });`));
  }
  if (url.pathname === '/orders') {
    return response.end(page('Orders', '<section id="orders">Loading…</section>', `
      fetch('/api/orders').then(r => r.json()).then(({items}) => {
        document.querySelector('#orders').innerHTML = items.map(order =>
          '<article class="card" data-testid="order"><strong>' + order.id + '</strong> — ' + order.status + '</article>'
        ).join('');
      });`));
  }
  if (url.pathname === '/admin') {
    return response.end(page('Admin', '<p data-testid="admin-panel">Administrative overview.</p><button>Delete all orders</button>'));
  }

  response.statusCode = 404;
  return response.end(page('Not found', '<p>The requested page was not found.</p>'));
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`sample-app listening on http://127.0.0.1:${port}\n`);
});

const close = () => server.close(() => process.exit(0));
process.on('SIGTERM', close);
process.on('SIGINT', close);
