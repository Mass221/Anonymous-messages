const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


// Configuration
const ADMIN_PASSWORD = 'admin123';
let users = {}; // Stockage en mémoire

// Middleware sessions pour admin
app.use(session({
  secret: 'unSecretTropSecretChangeMoi',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // En prod, mettre true si HTTPS
}));

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fonction d'échappement HTML pour éviter XSS
function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
}

// Helper functions
function createUser(username) {
  if (!users[username]) {
    users[username] = {
      messages: [],
      created: new Date().toLocaleString('fr-FR')
    };
  }
  return users[username];
}

function addMessage(username, message) {
  if (!users[username]) {
    createUser(username);
  }

  const messageObj = {
    id: Date.now(),
    text: message,
    timestamp: new Date().toLocaleString('fr-FR')
  };

  users[username].messages.push(messageObj);
  return messageObj;
}

function loadTemplate(templateName, replacements = {}) {
  let html = fs.readFileSync(path.join(__dirname, 'views', templateName), 'utf8');

  Object.keys(replacements).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    html = html.replace(regex, replacements[key]);
  });

  return html;
}

// Middleware vérification admin
function checkAdminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.status(403).sendFile(path.join(__dirname, 'views', 'access-denied.html'));
  }
}

// Routes principales
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.post('/create-user', (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();

  // Validation username
  if (!username.match(/^[a-zA-Z0-9_-]{3,20}$/)) {
    return res.redirect('/?error=invalid');
  }

  createUser(username);
  res.redirect(`/dashboard/${username}`);
});

app.get('/dashboard/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  createUser(username);

  const messageCount = users[username].messages.length;
  const userLink = `${req.protocol}://${req.get('host')}/u/${username}`;
  const whatsappMessage = encodeURIComponent(`Hey ! Envoie-moi un message anonyme sur : ${userLink}`);

  const html = loadTemplate('dashboard.html', {
    username: escapeHtml(username),
    USERNAME_UPPER: escapeHtml(username.charAt(0).toUpperCase()),
    messageCount: messageCount,
    userLink: userLink,
    whatsappMessage: whatsappMessage
  });

  res.send(html);
});

app.get('/messages/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  
  if (!users[username]) {
    return res.redirect('/');
  }
  
  const userData = users[username];
  
  // Juste rediriger vers le fichier HTML statique
  res.sendFile(path.join(__dirname, 'views', 'messages.html'));
});

app.get('/u/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  createUser(username);

  const messageCount = users[username].messages.length;

  const html = loadTemplate('send-message.html', {
    username: escapeHtml(username),
    USERNAME_UPPER: escapeHtml(username.charAt(0).toUpperCase()),
    messageCount: messageCount
  });

  res.send(html);
});

app.post('/send/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  const message = (req.body.message || '').trim();

  if (message.length > 0 && message.length <= 300) {
    addMessage(username, message);
  }

  const html = loadTemplate('message-sent.html', {
    username: escapeHtml(username)
  });

  res.send(html);
});

// Route pour afficher le détail d'un message
app.get('/message/:username/:messageId', (req, res) => {
  const username = req.params.username.toLowerCase();
  const messageId = Number(req.params.messageId);
  
  if (!users[username]) {
    return res.redirect('/');
  }
  
  const userData = users[username];
  const message = userData.messages.find(m => m.id === messageId);
  
  if (!message) {
    return res.redirect(`/messages/${username}`);
  }
  
  const html = loadTemplate('message-detail.html', {
    username: username,
    messageId: messageId,
    messageText: message.text,
    messageTime: message.timestamp,
    totalMessages: userData.messages.length
  });
  
  res.send(html);
});

// Route pour sauvegarder les réactions
app.post('/message/:username/:messageId/reaction', (req, res) => {
  const username = req.params.username.toLowerCase();
  const messageId = Number(req.params.messageId);
  const reaction = req.body.reaction;
  
  if (users[username]) {
    const message = users[username].messages.find(m => m.id === messageId);
    if (message) {
      message.reaction = reaction;
      message.readAt = new Date().toLocaleString('fr-FR');
    }
  }
  
  res.json({ success: true });
});

// --- Routes admin ---

// Page login admin simple
app.get('/admin', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return adminDashboard(req, res);
  }
  // Affiche page login admin simple (à créer)
  res.sendFile(path.join(__dirname, 'views', 'admin-login.html'));
});

app.post('/admin-login', (req, res) => {
  const pass = req.body.pass || '';
  if (pass === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin?error=wrongpass');
  }
});

function adminDashboard(req, res) {
  const totalUsers = Object.keys(users).length;
  const totalMessages = Object.values(users).reduce((sum, user) => sum + user.messages.length, 0);

  let usersList = '';
  if (totalUsers > 0) {
    usersList = Object.entries(users).map(([username, userData]) => `
      <div class="message-item">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="flex: 1; min-width: 200px;">
            <strong>@${escapeHtml(username)}</strong>
            <div style="color: #666; font-size: 0.9em;">
              ${userData.messages.length} message(s) • Créé le ${escapeHtml(userData.created)}
            </div>
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <a href="/admin-user/${encodeURIComponent(username)}" 
               style="background: #667eea; color: white; padding: 8px 15px; border-radius: 10px; text-decoration: none;">
              Voir
            </a>
            <button onclick="if(confirm('Supprimer @${escapeHtml(username)} et tous ses messages ?')) { window.location.href='/delete-user/${encodeURIComponent(username)}'; }" 
                    class="delete-btn">
              Supprimer
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } else {
    usersList = '<div class="message-item" style="text-align: center; color: #666;">Aucun utilisateur créé</div>';
  }

  const html = loadTemplate('admin.html', {
    totalUsers: totalUsers,
    totalMessages: totalMessages,
    usersList: usersList,
    adminPass: '' // Ne pas afficher le mot de passe
  });

  res.send(html);
}

app.get('/admin-user/:username', checkAdminAuth, (req, res) => {
  const username = req.params.username;
  const userData = users[username];

  if (!userData) {
    return res.redirect('/admin');
  }

  let messagesList = '';
  if (userData.messages.length > 0) {
    messagesList = userData.messages.map(msg => `
      <div class="message-item">
        <div class="message-text">${escapeHtml(msg.text)}</div>
        <div class="message-time">${escapeHtml(msg.timestamp)}</div>
        <button onclick="if(confirm('Supprimer ce message ?')) { window.location.href='/delete-message/${encodeURIComponent(username)}/${msg.id}'; }" 
                class="delete-btn">
          Supprimer
        </button>
        <div style="clear: both;"></div>
      </div>
    `).join('');
  } else {
    messagesList = '<div class="message-item" style="text-align: center; color: #666;">Aucun message</div>';
  }

  const html = loadTemplate('admin-user.html', {
    username: escapeHtml(username),
    messageCount: userData.messages.length,
    messagesList: messagesList,
    adminPass: ''
  });

  res.send(html);
});

app.get('/delete-message/:username/:messageId', checkAdminAuth, (req, res) => {
  const { username, messageId } = req.params;
  if (users[username]) {
    users[username].messages = users[username].messages.filter(m => m.id !== Number(messageId));
  }

  res.redirect(`/admin-user/${encodeURIComponent(username)}`);
});

app.get('/delete-user/:username', checkAdminAuth, (req, res) => {
  const username = req.params.username;
  delete users[username];

  res.redirect('/admin');
});

// Déconnexion admin
app.get('/admin-logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin');
  });
});

// Démarrage du serveur
app.listen(port, () => {
  console.log(`🚀 Clone NGL lancé sur http://localhost:${port}`);
  console.log(`📝 Accueil: http://localhost:${port}/`);
  console.log(`🔐 Admin: http://localhost:${port}/admin`);
});
