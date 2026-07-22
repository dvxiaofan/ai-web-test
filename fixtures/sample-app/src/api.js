export async function listProducts() {
  return fetch('/api/products').then((response) => response.json());
}

export async function listOrders() {
  return fetch('/api/orders').then((response) => response.json());
}

export async function createOrder(productId) {
  return fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId }),
  }).then((response) => response.json());
}
