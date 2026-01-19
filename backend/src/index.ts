import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase } from './database';
import authRoutes from './routes/auth';
import instanceRoutes from './routes/instances';
import webhookRoutes from './routes/webhooks';
import messageRoutes from './routes/messages';
import blindageRoutes from './routes/blindage';
import devocionalRoutes from './routes/devocional';
import contactRoutes from './routes/contacts';
import tagRoutes from './routes/tags';
import listRoutes from './routes/lists';
import marketingRoutes from './routes/marketing';
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
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Log de OPTIONS (preflight)
app.options('*', (req, res) => {
  console.log(`🔄 OPTIONS ${req.path} - Preflight request`);
  res.sendStatus(200);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log de todas as requisições para debug
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  if (req.method === 'POST') {
    console.log(`   Body:`, JSON.stringify(req.body, null, 2));
  }
  next();
});

// Rota de teste
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend está funcionando!', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/instances', instanceRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/blindage', blindageRoutes);
app.use('/api/devocional', devocionalRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/marketing', marketingRoutes);

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

    // Ignorar SIGTERM completamente - EasyPanel não tem health check configurável
    // O servidor deve ficar rodando indefinidamente
    process.on('SIGTERM', (signal) => {
      const uptime = Date.now() - startTime;
      console.log(`⚠️ SIGTERM recebido após ${Math.round(uptime/1000)}s, mas ignorando para manter servidor ativo...`);
      // Não encerrar - apenas logar
    });
    
    // Apenas SIGINT (Ctrl+C) encerra o servidor
    process.on('SIGINT', () => {
      console.log('⚠️ SIGINT recebido, encerrando servidor...');
      if (server) {
        server.close(() => {
          console.log('✅ Servidor encerrado');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
    
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
