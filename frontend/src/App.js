
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
