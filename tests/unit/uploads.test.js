/**
 * Upload middleware after the multer 1.x -> 2.x upgrade (engineering audit
 * F-SEC-01): an allowed file is accepted, an oversize file and a wrong type
 * are refused with our 400 envelope, and a request with no file still
 * reaches the handler.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const request = require('supertest');
const { uploadSingle, uploadDocSingle } = require('../../server/utils/upload');
const { classifyError } = require('../../server/services/errorLogService');

function appWith(middleware) {
  const app = express();
  app.post('/up', middleware, (req, res) => {
    res.json({
      file: req.file ? { mimetype: req.file.mimetype, size: req.file.size, name: req.file.originalname } : null,
      body: req.body,
    });
  });
  app.use((err, _req, res, _next) => {
    const c = classifyError(err);
    res.status(c.status).json({ code: c.code, message: c.message });
  });
  return app;
}

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('image upload (uploadSingle)', () => {
  const app = appWith(uploadSingle('image'));

  it('accepts a png and keeps the other form fields', async () => {
    const res = await request(app).post('/up').field('note', 'hello').attach('image', png, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.file).toEqual({ mimetype: 'image/png', size: png.length, name: 'a.png' });
    expect(res.body.body).toEqual({ note: 'hello' });
  });

  it('refuses a file over 5 MB with a clear message', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 1);
    const res = await request(app).post('/up').attach('image', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too large/i);
  });

  it('refuses a file type that is not an image', async () => {
    const res = await request(app).post('/up').attach('image', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/jpg, png or webp/i);
  });

  it('lets a request with no file through to the handler', async () => {
    const res = await request(app).post('/up').field('note', 'no file');
    expect(res.status).toBe(200);
    expect(res.body.file).toBeNull();
  });
});

describe('document upload (uploadDocSingle)', () => {
  const app = appWith(uploadDocSingle('file'));

  it('accepts a PDF', async () => {
    const res = await request(app).post('/up').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'inv.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.file.mimetype).toBe('application/pdf');
  });

  it('refuses a file over 10 MB', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 10, 1);
    const res = await request(app).post('/up').attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/too large/i);
  });

  it('refuses an executable', async () => {
    const res = await request(app).post('/up').attach('file', Buffer.from('MZ'), { filename: 'a.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
  });
});
