
// frontend/src/App.js
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { jwtDecode } from 'jwt-decode';
import './App.css';

const socket = io('http://localhost:8081');

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [selectedChat, setSelectedChat] = useState(null);
  const [chats, setChats] = useState([]);
  const [user, setUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decoded = jwtDecode(token);
        setUser(decoded);
        setShowLogin(false);
        fetchChats(token);
      } catch (error) {
        console.error('Invalid token');
        localStorage.removeItem('token');
      }
    }
  }, []);

  useEffect(() => {
    socket.on('response', (data) => {
      if (data.userId === user?.userId && selectedChat) {
        setMessages(prev => [...prev, { text: data.text, type: 'assistant', timestamp: new Date() }]);
      }
    });

    socket.on('error', (data) => {
      setError(data.message || 'An error occurred');
      setTimeout(() => setError(''), 5000);
    });
  }, [user, selectedChat]);

  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(recordingTimerRef.current);
      setRecordingTime(0);
    }
    
    return () => clearInterval(recordingTimerRef.current);
  }, [isRecording]);

  const fetchChats = async (token) => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('http://localhost:3000/api/chats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch chats');
      }
      
      const data = await response.json();
      setChats(data.chats);
      if (data.chats.length > 0) {
        setSelectedChat(data.chats[0].id);
      }
    } catch (error) {
      console.error('Error fetching chats:', error);
      setError('Failed to load chats. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('http://localhost:3000/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }
      
      if (data.token) {
        localStorage.setItem('token', data.token);
        setUser(data.user);
        setShowLogin(false);
        fetchChats(data.token);
      }
    } catch (error) {
      setError(error.message || 'Login error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await fetch('http://localhost:3000/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      
      if (data.token) {
        localStorage.setItem('token', data.token);
        setUser(data.user);
        setShowLogin(false);
        fetchChats(data.token);
      }
    } catch (error) {
      setError(error.message || 'Registration error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setShowLogin(true);
    setChats([]);
    setSelectedChat(null);
    setMessages([]);
    setError('');
  };

  const startRecording = () => {
    setIsRecording(true);
    audioChunksRef.current = [];
    setRecordingTime(0);
    
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        mediaRecorderRef.current = new MediaRecorder(stream);
        mediaRecorderRef.current.ondataavailable = event => {
          audioChunksRef.current.push(event.data);
        };
        mediaRecorderRef.current.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          simulateVoiceRecognition();
        };
        mediaRecorderRef.current.start();
      })
      .catch(error => {
        console.error('Error accessing microphone:', error);
        setIsRecording(false);
        setError('Could not access microphone. Please check permissions.');
      });
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const simulateVoiceRecognition = () => {
    setTimeout(() => {
      const simulatedVoice = "Hello, how are you doing today?";
      setTranscript(simulatedVoice);
      handleVoiceInput(simulatedVoice);
    }, 1000);
  };

  const handleVoiceInput = (text) => {
    if (text.trim() && selectedChat) {
      const userMessage = { text, type: 'user', timestamp: new Date() };
      setMessages(prev => [...prev, userMessage]);
      
      socket.send(JSON.stringify({ 
        type: 'voice', 
        text, 
        userId: user.userId 
      }));
    }
  };

  const handleTextInput = () => {
    if (input.trim() && selectedChat) {
      const userMessage = { text: input, type: 'user', timestamp: new Date() };
      setMessages(prev => [...prev, userMessage]);
      
      socket.send(JSON.stringify({ 
        type: 'voice', 
        text: input, 
        userId: user.userId 
      }));
      setInput('');
    }
  };

  if (showLogin) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h2 className="login-title">Telegram Voice Assistant</h2>
          <p className="login-subtitle">Sign in to manage your conversations</p>
          
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          
          <div className="form-group">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          
          <div className="button-group">
            <button 
              onClick={handleLogin} 
              disabled={loading}
              className="login-button"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
            <button 
              onClick={handleRegister} 
              disabled={loading}
              className="register-button"
            >
              {loading ? 'Registering...' : 'Register'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header">
        <div className="header-content">
          <h1 className="app-title">Telegram Voice Assistant</h1>
          <div className="user-info">
            <span className="welcome-text">Welcome, {user.username}</span>
            <button onClick={handleLogout} className="logout-button">
              Logout
            </button>
          </div>
        </div>
      </div>
      
      <div className="main-container">
        <div className="chat-list">
          <h3 className="chat-list-title">Your Chats</h3>
          {loading ? (
            <div className="loading">Loading chats...</div>
          ) : (
            chats.map(chat => (
              <div 
                key={chat.id}
                className={`chat-item ${selectedChat === chat.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedChat(chat.id);
                  setMessages([]);
                }}
              >
                <div className="chat-name">{chat.name}</div>
                <div className="chat-last-message">No messages yet</div>
              </div>
            ))
          )}
        </div>
        
        <div className="chat-container">
          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="empty-state">
                <p>Start a conversation or select a chat</p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`message ${msg.type}`}>
                  <div className="message-content">{msg.text}</div>
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
          
          <div className="input-area">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type or speak..."
              disabled={loading}
            />
            <button 
              onClick={handleTextInput}
              disabled={loading || !input.trim()}
              className="send-button"
            >
              Send
            </button>
            <button 
              onClick={isRecording ? stopRecording : startRecording}
              className={isRecording ? 'recording-button active' : 'recording-button'}
              disabled={loading}
            >
              {isRecording ? (
                <span>
                  <span className="recording-icon">■</span>
                  {recordingTime}s
                </span>
              ) : (
                <span className="mic-icon">🎤</span>
              )}
            </button>
          </div>
        </div>
      </div>
      
      {error && (
        <div className="global-error">
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
/* frontend/src/App.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}

body {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  color: #333;
}

.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 20px;
}

.login-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  padding: 30px;
  width: 100%;
  max-width: 400px;
  text-align: center;
}

.login-title {
  color: #667eea;
  margin-bottom: 10px;
  font-size: 28px;
}

.login-subtitle {
  color: #666;
  margin-bottom: 25px;
  font-size: 16px;
}

.form-group {
  margin-bottom: 20px;
  text-align: left;
}

.form-group input {
  width: 100%;
  padding: 12px 15px;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 0.3s;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
}

.button-group {
  display: flex;
  gap: 10px;
  margin-top: 25px;
}

.login-button, .register-button {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.login-button {
  background: #667eea;
  color: white;
}

.login-button:hover {
  background: #5a67d8;
}

.register-button {
  background: #48bb78;
  color: white;
}

.register-button:hover {
  background: #38a169;
}

.error-message {
  background: #fed7d7;
  color: #c53030;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
}

.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.header {
  background: rgba(255, 255, 255, 0.95);
  padding: 15px 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(10px);
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1400px;
  margin: 0 auto;
}

.app-title {
  color: #667eea;
  font-size: 24px;
  font-weight: 700;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 15px;
}

.welcome-text {
  color: #333;
  font-weight: 500;
}

.logout-button {
  background: #f56565;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.3s;
}

.logout-button:hover {
  background: #e53e3e;
}

.main-container {
  display: flex;
  flex: 1;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
  padding: 20px;
  gap: 20px;
}

.chat-list {
  width: 300px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  padding: 20px;
  overflow-y: auto;
  max-height: calc(100vh - 120px);
}

.chat-list-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 15px;
  color: #333;
}

.chat-item {
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.chat-item:hover {
  background: #f7fafc;
}

.chat-item.selected {
  background: #667eea;
  color: white;
  border-color: #5a67d8;
}

.chat-name {
  font-weight: 500;
  margin-bottom: 4px;
}

.chat-last-message {
  font-size: 13px;
  opacity: 0.7;
}

.chat-container {
  flex: 1;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
}

.messages-container {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 18px;
  position: relative;
}

.message.user {
  background: #667eea;
  color: white;
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}

.message.assistant {
  background: #f7fafc;
  color: #333;
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}

.message-content {
  word-wrap: break-word;
}

.message-time {
  font-size: 11px;
  opacity: 0.6;
  margin-top: 4px;
}

.input-area {
  padding: 15px 20px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  gap: 10px;
  align-items: center;
}

input[type="text"] {
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 25px;
  font-size: 16px;
  transition: border-color 0.3s;
}

input[type="text"]:focus {
  outline: none;
  border-color: #667eea;
}

.send-button, .recording-button {
  padding: 12px 20px;
  border: none;
  border-radius: 25px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.send-button {
  background: #667eea;
  color: white;
}

.send-button:hover {
  background: #5a67d8;
}

.send-button:disabled {
  background: #cbd5e0;
  cursor: not-allowed;
}

.recording-button {
  background: #f56565;
  color: white;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
}

.recording-button:hover {
  background: #e53e3e;
}

.recording-button:disabled {
  background: #cbd5e0;
  cursor: not-allowed;
}

.recording-button.active {
  background: #e53e3e;
  animation: pulse 1.5s infinite;
}

.recording-icon {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
  animation: blink 1s infinite;
}

.mic-icon {
  font-size: 18px;
}

.empty-state {
  text-align: center;
  color: #718096;
  padding: 40px;
  font-size: 16px;
}

.loading {
  text-align: center;
  color: #718096;
  padding: 20px;
}

.global-error {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #fed7d7;
  color: #c53030;
  padding: 12px 20px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  max-width: 90%;
  text-align: center;
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 768px) {
  .main-container {
    flex-direction: column;
  }
  
  .chat-list {
    width: 100%;
    max-height: 200px;
  }
  
  .input-area {
    flex-direction: column;
  }
  
  input[type="text"] {
    width: 100%;
  }
  
  .send-button, .recording-button {
    width: 100%;
    justify-content: center;
  }
}
