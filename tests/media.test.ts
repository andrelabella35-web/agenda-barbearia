import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

const app = createApp();
afterAll(() => pool.end());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);

async function adminToken() {
  const r = await request(app).post('/api/v1/auth/login').send({ email: 'admin@barbearia.local', password: 'admin123' });
  return r.body.token as string;
}

describe('upload de imagem (admin)', () => {
  it('exige login de admin', async () => {
    const r = await request(app).post('/api/v1/admin/media').set('Content-Type', 'image/png').send(PNG);
    expect(r.status).toBe(401);
  });

  it('aceita PNG/JPEG e serve a imagem publicamente com o tipo correto', async () => {
    const t = await adminToken();
    for (const [buf, type] of [[PNG, 'image/png'], [JPG, 'image/jpeg']] as const) {
      const up = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${t}`).set('Content-Type', 'application/octet-stream').send(buf);
      expect(up.status).toBe(201);
      expect(up.body.url).toMatch(/^\/media\/\d+$/);
      const get = await request(app).get(up.body.url);
      expect(get.status).toBe(200);
      expect(get.headers['content-type']).toContain(type);
      expect(Buffer.compare(get.body, buf)).toBe(0);
    }
  });

  it('recusa arquivo que não é imagem suportada (ex.: SVG/HTML), mesmo com Content-Type de imagem', async () => {
    const t = await adminToken();
    const r = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${t}`).set('Content-Type', 'image/png')
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(r.status).toBe(415);
    expect(r.body.error.code).toBe('BAD_IMAGE');
  });

  it('recusa corpo vazio e arquivo acima de 5 MB', async () => {
    const t = await adminToken();
    const empty = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${t}`).set('Content-Type', 'image/png');
    expect(empty.status).toBe(400);
    const big = await request(app).post('/api/v1/admin/media').set('Authorization', `Bearer ${t}`).set('Content-Type', 'image/png')
      .send(Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]));
    expect(big.status).toBe(413);
  });

  it('404 para imagem inexistente', async () => {
    expect((await request(app).get('/media/999999')).status).toBe(404);
  });
});
