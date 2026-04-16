// backend/server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const xss = require('xss');
const morgan = require('morgan');

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

app.use(limiter);

// Configuration from environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;

// OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// In-memory databases (replace with actual DB in production)
const users = new Map();
const conversations = new Map();
const userChats = new Map();
const failedAttempts = new Map();

// WebSocket for real-time communication
const wss = new WebSocket.Server({ port: 8081 });

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'voice') {
        if (!data.text || typeof data.text !== 'string') {
          throw new Error('Invalid voice input');
        }
        
        const response = await getVoiceAssistantResponse(data.text, data.userId);
        ws.send(JSON.stringify({ type: 'response', text: response, userId: data.userId }));
      }
    } catch (error) {
      console.error('WebSocket error:', error);
      ws.send(JSON.stringify({ type: 'error', message: 'Processing failed' }));
    }
  });
});

// Input validation middleware
const validateInput = (req, res, next) => {
  try {
    if (req.body) {
      if (req.body.username) req.body.username = xss(req.body.username);
      if (req.body.password) req.body.password = xss(req.body.password);
      if (req.body.text) req.body.text = xss(req.body.text);
    }
    next();
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
};

// User registration
app.post('/api/register', validateInput, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const existingUser = Array.from(users.values()).find(u => u.username === username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userId = Date.now().toString();
    users.set(userId, {
      id: userId,
      username,
      password: hashedPassword,
      createdAt: new Date(),
      lastLogin: new Date()
    });
    
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: userId, username } });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login
app.post('/api/login', validateInput, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const user = Array.from(users.values()).find(u => u.username === username);
    
    if (!user) {
      const ip = req.ip;
      const attempts = failedAttempts.get(ip) || 0;
      failedAttempts.set(ip, attempts + 1);
      
      if (attempts >= 5) {
        return res.status(429).json({ error: 'Too many failed attempts' });
      }
      
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      const ip = req.ip;
      const attempts = failedAttempts.get(ip) || 0;
      failedAttempts.set(ip, attempts + 1);
      
      if (attempts >= 5) {
        return res.status(429).json({ error: 'Too many failed attempts' });
      }
      
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    failedAttempts.delete(req.ip);
    user.lastLogin = new Date();
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Telegram Webhook
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (!update || !update.message) {
      return res.status(400).json({ error: 'Invalid update format' });
    }
    
    const chatId = update.message.chat.id;
    const text = update.message.text;
    const from = update.message.from;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    
    let userId = conversations.get(chatId);
    if (!userId) {
      userId = Date.now().toString();
      users.set(userId, {
        id: userId,
        username: from.username || from.first_name,
        createdAt: new Date(),
        lastLogin: new Date()
      });
      conversations.set(chatId, userId);
      
      if (!userChats.has(userId)) {
        userChats.set(userId, []);
      }
      userChats.get(userId).push(chatId);
    }
    
    try {
      const response = await getVoiceAssistantResponse(text, userId);
      await sendTelegramMessage(chatId, response);
    } catch (error) {
      console.error('Voice assistant error:', error);
      await sendTelegramMessage(chatId, "I'm having trouble processing your request right now.");
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's chats
app.get('/api/chats', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;
    const userChatIds = userChats.get(userId) || [];
    
    const chats = userChatIds.map(chatId => ({
      id: chatId,
      name: `Chat ${chatId}`,
      lastMessage: 'No messages yet'
    }));
    
    res.json({ chats });
  } catch (error) {
    console.error('Chats error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

async function getVoiceAssistantResponse(text, userId) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a helpful voice assistant that manages Telegram conversations. Be friendly, concise, and professional. If you don't understand, ask for clarification." 
        },
        { role: "user", content: text }
      ],
      max_tokens: 150,
      temperature: 0.7
    });
    
    const response = completion.choices[0].message.content;
    return response || "I'm not sure how to respond to that.";
  } catch (error) {
    console.error('OpenAI error:', error);
    return "I'm having trouble processing your request right now. Please try again later.";
  }
}

async function sendTelegramMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Telegram error:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`WebSocket running on port 8081`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
