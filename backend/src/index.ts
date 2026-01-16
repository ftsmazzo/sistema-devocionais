import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './database';
import authRoutes from './routes/auth';
import instanceRoutes from './routes/instances';
import { errorHandler } from './middleware/errorHandler';

dotenv.config();

const app = express();
const PORT: number = parseInt(process.env.PORT || '3001', 10);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);

// Error handler
app.use(errorHandler);

// Tratamento de sinais para shutdown graceful
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM recebido, encerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️ SIGINT recebido, encerrando servidor...');
  process.exit(0);
});

// Inicializar banco e servidor
async function start() {
  try {
    await initializeDatabase();
    console.log('✅ Banco de dados inicializado');
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('⚠️ SIGTERM recebido, encerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor encerrado');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();
