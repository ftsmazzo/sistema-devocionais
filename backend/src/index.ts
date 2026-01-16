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

// Health check (deve ser antes das rotas para responder rapidamente)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Health check alternativo
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Evolution Manager API',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);

// Error handler
app.use(errorHandler);

// Inicializar banco e servidor
async function start() {
  let server: any;
  
  try {
    await initializeDatabase();
    console.log('✅ Banco de dados inicializado');
    
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
      console.log(`⚠️ ${signal} recebido, encerrando servidor...`);
      if (server) {
        server.close(() => {
          console.log('✅ Servidor encerrado');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();
