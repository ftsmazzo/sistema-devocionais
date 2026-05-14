import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    console.log(`🔐 Tentativa de login: ${email}`);
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      console.log(`❌ Usuário não encontrado: ${email}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      console.log(`❌ Senha inválida para: ${email}`);
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    console.log(`✅ Login bem-sucedido: ${email}`);

    const jwtSecret = (process.env.JWT_SECRET || 'secret') as string;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
    
    const payload = { id: user.id, email: user.email, role: user.role };
    // @ts-expect-error - jsonwebtoken accepts string for expiresIn at runtime
    const token = jwt.sign(payload, jwtSecret, { expiresIn: jwtExpiresIn });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

/** Nome exibido no painel (rodapé). Sem autenticação — apenas texto público. */
router.get('/branding', (_req, res) => {
  const raw = process.env.ADMIN_NOME ?? process.env.ADMIN_NAME ?? '';
  const admin_nome = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  res.json({ admin_nome });
});

// Verificar token
router.get('/me', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT id, email, name, role FROM users WHERE id = $1', [
      req.user!.id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Erro ao verificar token:', error);
    res.status(500).json({ error: 'Erro ao verificar token' });
  }
});

export default router;
