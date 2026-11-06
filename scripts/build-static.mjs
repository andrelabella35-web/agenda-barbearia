// Monta public/ para a Vercel: site em /, painel em /admin, utilitários em /shared.
import fs from 'node:fs';
fs.rmSync('public', { recursive: true, force: true });
fs.cpSync('web/public', 'public', { recursive: true });
fs.cpSync('web/admin', 'public/admin', { recursive: true });
fs.cpSync('web/shared', 'public/shared', { recursive: true });
console.log('public/ gerado');
