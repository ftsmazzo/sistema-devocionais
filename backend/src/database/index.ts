import { Pool, PoolClient } from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    // Criar tabela de usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar tabela de instâncias
    await client.query(`
      CREATE TABLE IF NOT EXISTS instances (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        api_key VARCHAR(255) NOT NULL,
        api_url VARCHAR(500) NOT NULL,
        instance_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'disconnected',
        phone_number VARCHAR(20),
        qr_code TEXT,
        last_connection TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Adicionar coluna phone_number se não existir (migração)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'instances' AND column_name = 'phone_number'
        ) THEN
          ALTER TABLE instances ADD COLUMN phone_number VARCHAR(20);
        END IF;
      END $$;
    `);

    // Criar tabela de webhooks
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER REFERENCES instances(id) ON DELETE CASCADE,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB NOT NULL,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed BOOLEAN DEFAULT FALSE
      )
    `);

    // Criar índices para webhooks
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_webhook_events_instance ON webhook_events(instance_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON webhook_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_webhook_events_processed ON webhook_events(processed);
    `);

    // Criar tabela de configurações de webhook por instância
    await client.query(`
      CREATE TABLE IF NOT EXISTS instance_webhook_config (
        id SERIAL PRIMARY KEY,
        instance_id INTEGER UNIQUE REFERENCES instances(id) ON DELETE CASCADE,
        webhook_url VARCHAR(500) NOT NULL,
        events TEXT[] DEFAULT ARRAY[]::TEXT[],
        enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Criar índice para busca
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status)
    `);

    // Criar usuário admin padrão se não existir
    const adminCheck = await client.query('SELECT id FROM users WHERE email = $1', [
      process.env.ADMIN_EMAIL || 'admin@example.com'
    ]);

    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(
        process.env.ADMIN_PASSWORD || 'admin123',
        10
      );
      
      await client.query(
        'INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)',
        [
          process.env.ADMIN_EMAIL || 'admin@example.com',
          hashedPassword,
          'Administrador',
          'admin'
        ]
      );
      console.log('👤 Usuário admin criado');
    }

    console.log('✅ Tabelas criadas/verificadas');
  } finally {
    client.release();
  }
}

export { pool };
export default pool;
