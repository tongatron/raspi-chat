const { all, get, run } = require('../db');

function serializeItem(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function itemRoutes(app) {
  app.get('/items', async () => {
    const rows = await all(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       ORDER BY id DESC`
    );

    return { items: rows.map(serializeItem) };
  });

  app.get('/items/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const row = await get(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       WHERE id = ?`,
      [id]
    );

    if (!row) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    return { item: serializeItem(row) };
  });

  app.post('/items', async (request, reply) => {
    const { name, description } = request.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'Field "name" is required' });
    }

    const now = new Date().toISOString();
    const result = await run(
      `INSERT INTO items (name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [name.trim(), typeof description === 'string' ? description : '', now, now]
    );

    const row = await get(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       WHERE id = ?`,
      [result.lastID]
    );

    return reply.code(201).send({ item: serializeItem(row) });
  });

  app.put('/items/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const { name, description } = request.body || {};

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return reply.code(400).send({ error: 'Field "name" must be a non-empty string' });
    }

    const existing = await get(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       WHERE id = ?`,
      [id]
    );

    if (!existing) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    const updatedName = typeof name === 'string' ? name.trim() : existing.name;
    const updatedDescription = typeof description === 'string' ? description : existing.description;
    const updatedAt = new Date().toISOString();

    await run(
      `UPDATE items
       SET name = ?, description = ?, updated_at = ?
       WHERE id = ?`,
      [updatedName, updatedDescription, updatedAt, id]
    );

    const row = await get(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       WHERE id = ?`,
      [id]
    );

    return { item: serializeItem(row) };
  });

  app.delete('/items/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const result = await run('DELETE FROM items WHERE id = ?', [id]);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Item not found' });
    }

    return reply.code(204).send();
  });
}

module.exports = itemRoutes;
