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

// Health check ANTES dos middlewares para responder o mais rápido possível
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Evolution Manager API',
    timestamp: new Date().toISOString()
  });
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);

// Error handler
app.use(errorHandler);

// Inicializar banco e servidor
async function start() {
  let server: any;
  let isShuttingDown = false;
  let startTime = Date.now();
  const MIN_UPTIME = 30000; // Mínimo de 30 segundos antes de permitir shutdown
  
  try {
    await initializeDatabase();
    console.log('✅ Banco de dados inicializado');
    
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      console.log(`✅ Health check disponível em http://0.0.0.0:${PORT}/health`);
      startTime = Date.now();
    });

    // Manter o processo vivo
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    // Graceful shutdown - ignorar SIGTERM muito cedo
    const gracefulShutdown = (signal: string) => {
      const uptime = Date.now() - startTime;
      
      // Ignorar SIGTERM se o servidor acabou de iniciar (menos de 30 segundos)
      if (uptime < MIN_UPTIME) {
        console.log(`⚠️ ${signal} recebido muito cedo (${Math.round(uptime/1000)}s), ignorando...`);
        return;
      }
      
      if (isShuttingDown) {
        return; // Já está encerrando
      }
      
      isShuttingDown = true;
      console.log(`⚠️ ${signal} recebido após ${Math.round(uptime/1000)}s, encerrando servidor...`);
      
      // Dar tempo para requisições em andamento terminarem
      setTimeout(() => {
        if (server) {
          server.close(() => {
            console.log('✅ Servidor encerrado');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      }, 5000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Manter processo vivo
    process.on('uncaughtException', (error) => {
      console.error('❌ Erro não capturado:', error);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Promise rejeitada não tratada:', reason);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();
