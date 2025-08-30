document.addEventListener('DOMContentLoaded', () => {
    // --- Firebase Configuration ---
    // IMPORTANT: Replace with your own Firebase project configuration
    const firebaseConfig = {
  apiKey: "AIzaSyA1MLXpyxJ9Hnhzdo0EE-7RnhxTj58hYCk",
  authDomain: "echocheck-ea0b2.firebaseapp.com",
  databaseURL: "https://echocheck-ea0b2-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "echocheck-ea0b2",
  storageBucket: "echocheck-ea0b2.firebasestorage.app",
  messagingSenderId: "556400987286",
  appId: "1:556400987286:web:7d646a651ea7af13c046b7",
  measurementId: "G-TZ8Z1GS8CN"
};

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // --- App Initialization ---
    const authScreen = document.getElementById('auth-screen');
    const chatUI = document.getElementById('chat-ui');
    const showLoginBtn = document.getElementById('show-login-btn');
    const showSignupBtn = document.getElementById('show-signup-btn');
    const loginModal = document.getElementById('login-modal');
    const signupModal = document.getElementById('signup-modal');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const sendBtn = document.getElementById('send-btn');
    const chatInput = document.getElementById('chat-input');
    const chatContainer = document.getElementById('chat-container');
    const historyList = document.getElementById('history-list');
    const newChatBtn = document.getElementById('new-chat-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userInitial = document.getElementById('user-initial');
    const userEmail = document.getElementById('user-email');

    const BACKEND_URL = 'http://127.0.0.1:5000/analyze';
    let currentChatId = null;
    let historyUnsubscribe = null;

    // --- Authentication State Observer ---
    auth.onAuthStateChanged(user => {
        if (user) {
            authScreen.classList.add('hidden');
            chatUI.classList.remove('hidden');
            userEmail.textContent = user.email;
            userInitial.textContent = user.email.charAt(0).toUpperCase();
            loadUserHistory(user.uid);
        } else {
            authScreen.classList.remove('hidden');
            chatUI.classList.add('hidden');
            historyList.innerHTML = '';
            chatContainer.innerHTML = '';
            if (historyUnsubscribe) {
                historyUnsubscribe();
            }
        }
    });

    // --- Authentication Flow ---
    function showModal(modal) { 
        modal.classList.remove('hidden');
        void modal.offsetWidth; 
        modal.querySelector('.modal-content').style.transform = 'scale(1)';
        modal.querySelector('.modal-content').style.opacity = '1';
    }

    function hideModal(modal) { 
        modal.querySelector('.modal-content').style.transform = 'scale(0.95)';
        modal.querySelector('.modal-content').style.opacity = '0';
        setTimeout(() => {
            modal.classList.add('hidden');
            const errorEl = modal.querySelector('[id$="-error"]');
            if (errorEl) {
                errorEl.classList.add('hidden');
                errorEl.textContent = '';
            }
        }, 300);
    }

    showLoginBtn.addEventListener('click', () => showModal(loginModal));
    showSignupBtn.addEventListener('click', () => showModal(signupModal));
    
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            hideModal(e.target.closest('.modal-backdrop'));
        });
    });

    signupBtn.addEventListener('click', () => {
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const confirmPassword = document.getElementById('signup-confirm-password').value;
        const errorEl = document.getElementById('signup-error');

        if (password !== confirmPassword) {
            errorEl.textContent = "Passwords do not match.";
            errorEl.classList.remove('hidden');
            return;
        }

        auth.createUserWithEmailAndPassword(email, password)
            .then(() => hideModal(signupModal))
            .catch(error => {
                errorEl.textContent = error.message;
                errorEl.classList.remove('hidden');
            });
    });

    loginBtn.addEventListener('click', () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');

        auth.signInWithEmailAndPassword(email, password)
            .then(() => hideModal(loginModal))
            .catch(error => {
                errorEl.textContent = error.message;
                errorEl.classList.remove('hidden');
            });
    });

    logoutBtn.addEventListener('click', () => {
        auth.signOut();
    });

    // --- Chat Logic ---
    async function handleSendMessage() {
        const statement = chatInput.value.trim();
        if (!statement) return;

        const user = auth.currentUser;
        if (!user) return;

        if (!currentChatId) {
            chatContainer.innerHTML = '';
        }

        displayUserMessage(statement);
        chatInput.value = '';
        
        displayTypingIndicator();

        try {
            const response = await fetch(BACKEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ statement: statement })
            });

            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.statusText}`);
            }

            const result = await response.json();
            
            removeTypingIndicator();
            displayAIMessage(result, statement);

            // Save chat to Firestore
            const newChatRef = db.collection('users').doc(user.uid).collection('chats').doc();
            currentChatId = newChatRef.id;
            await newChatRef.set({
                statement: statement,
                result: result,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

        } catch (error) {
            console.error("Error during analysis:", error);
            removeTypingIndicator();
            displayAIMessage({ verdict: 'Connection Error', reasoning: 'Could not connect to the analysis server. Please ensure the Python backend is running.', evidence: [] }, statement);
        }
    }

    sendBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSendMessage();
    });
    
    newChatBtn.addEventListener('click', () => {
        chatContainer.innerHTML = `<div class="text-center text-gray-400 mt-8">Ask a question to start a new chat.</div>`;
        currentChatId = null;
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        chatInput.focus();
    });

    // --- History Display Logic ---
    async function deleteHistoryItem(chatId) {
        const user = auth.currentUser;
        if (!user) return;
        try {
            await db.collection('users').doc(user.uid).collection('chats').doc(chatId).delete();
            if (currentChatId === chatId) {
                newChatBtn.click();
            }
        } catch (error) {
            console.error("Error deleting history item:", error);
        }
    }

    function loadUserHistory(userId) {
        const chatsRef = db.collection('users').doc(userId).collection('chats').orderBy('timestamp', 'desc');
        
        historyUnsubscribe = chatsRef.onSnapshot(snapshot => {
            const history = [];
            snapshot.forEach(doc => {
                history.push({ id: doc.id, ...doc.data() });
            });
            updateHistoryList(history);
        }, error => {
            console.error("Error loading history from Firestore:", error);
        });
    }

    function updateHistoryList(history) {
        historyList.innerHTML = '';
        history.forEach(conv => {
            const div = createDOMElement('div', 'p-3 cursor-pointer history-item rounded-md text-gray-700 text-sm flex items-center justify-between space-x-3');
            div.dataset.chatId = conv.id;

            const contentWrapper = createDOMElement('div', 'flex items-center space-x-2 overflow-hidden flex-grow');
            const statementSpan = createDOMElement('span', 'truncate', conv.statement);
            const verdictIconContainer = createDOMElement('div', 'flex-shrink-0');
            verdictIconContainer.innerHTML = getVerdictUI(conv.result.verdict, 'w-5 h-5').icon;
            
            contentWrapper.appendChild(verdictIconContainer);
            contentWrapper.appendChild(statementSpan);
            
            const deleteBtn = createDOMElement('button', 'delete-history-btn p-1 rounded-full hover:bg-red-100');
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`;
            
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistoryItem(conv.id);
            });

            div.addEventListener('click', () => {
                displayConversation(conv);
                document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
                div.classList.add('active');
            });

            div.appendChild(contentWrapper);
            div.appendChild(deleteBtn);
            historyList.appendChild(div);
        });
    }
    
    function displayConversation(conv) {
        if (!conv) return;
        chatContainer.innerHTML = '';
        currentChatId = conv.id;
        displayUserMessage(conv.statement);
        setTimeout(() => displayAIMessage(conv.result, conv.statement), 100);
    }

    // --- UI Element Creation Functions ---
    function createDOMElement(tag, classNames, content = '') {
        const el = document.createElement(tag);
        if (classNames) el.className = classNames;
        if (content) el.innerHTML = content;
        return el;
    }

    function displayUserMessage(text) {
        const wrapper = createDOMElement('div', 'mb-4 flex justify-end chat-bubble');
        const bubble = createDOMElement('div', 'chat-bubble-user p-4 rounded-xl max-w-xl shadow-md');
        bubble.textContent = text;
        wrapper.appendChild(bubble);
        chatContainer.appendChild(wrapper);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function displayTypingIndicator() {
        const indicator = createDOMElement('div', 'mb-4 flex', '');
        indicator.id = 'typing-indicator';
        indicator.innerHTML = `
            <div class="analyst-card p-6 w-full max-w-3xl mx-auto">
                <div class="flex items-center justify-center space-x-2 loader-dots">
                    <div class="w-3 h-3 rounded-full"></div>
                    <div class="w-3 h-3 rounded-full"></div>
                    <div class="w-3 h-3 rounded-full"></div>
                </div>
                <p class="text-slate-600 text-center text-lg font-medium mt-4">EchoCheck is analyzing...</p>
            </div>`;
        chatContainer.appendChild(indicator);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    }

    function displayAIMessage(result, statement) {
        const wrapper = createDOMElement('div', 'mb-4 w-full');
        
        const statementCard = createDOMElement('div', 'analyst-card p-6 mb-8 ui-element-in');
        statementCard.innerHTML = `
            <p class="text-slate-600 text-sm font-medium">Statement Analyzed:</p>
            <p class="text-slate-800 font-semibold text-xl">${statement}</p>
        `;
        wrapper.appendChild(statementCard);

        const grid = createDOMElement('div', 'grid grid-cols-1 lg:grid-cols-3 gap-8');
        
        // Verdict Card
        const verdictUI = getVerdictUI(result.verdict);
        const verdictCard = createDOMElement('div', 'analyst-card p-6 lg:col-span-1 ui-element-in');
        verdictCard.style.animationDelay = '0.1s';
        verdictCard.innerHTML = `
            <h2 class="text-xl font-bold text-slate-800 mb-4 border-b border-slate-200 pb-3">Verdict</h2>
            <div class="text-center py-4 flex flex-col items-center justify-center h-full">
                <div class="mb-4">${verdictUI.icon}</div>
                <p class="text-3xl font-bold ${verdictUI.textColor}">${result.verdict}</p>
                <p class="text-slate-500 mt-2 text-md">${result.reasoning}</p>
            </div>
        `;
        grid.appendChild(verdictCard);

        // Evidence Card
        const evidenceCard = createDOMElement('div', 'analyst-card p-6 lg:col-span-2 ui-element-in');
        evidenceCard.style.animationDelay = '0.2s';
        let evidenceHTML = result.evidence && result.evidence.length > 0 ? 
            result.evidence.map(item => `
                <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="block border-l-4 border-slate-200 pl-4 transition-all duration-300 evidence-snippet">
                    <p class="font-semibold text-slate-800">${item.title}</p>
                    <p class="text-sm text-slate-500">${item.source}</p>
                </a>
            `).join('') : 
            '<p class="text-slate-500">No direct evidence was found.</p>';
        
        evidenceCard.innerHTML = `
            <h2 class="text-xl font-bold text-slate-800 mb-4 border-b border-slate-200 pb-3">Supporting Evidence</h2>
            <div class="space-y-4 text-slate-700 max-h-[400px] overflow-y-auto pr-2">${evidenceHTML}</div>
        `;
        grid.appendChild(evidenceCard);
        wrapper.appendChild(grid);

        // Bias Card
        if (result.evidence && result.evidence.length > 0) {
            const biasCard = createDOMElement('div', 'analyst-card p-6 mt-8 ui-element-in');
            biasCard.style.animationDelay = '0.3s';
            const canvasId = `chart-${currentChatId || 'temp'}`;
            biasCard.innerHTML = `
                <h2 class="text-xl font-bold text-slate-800 mb-4 border-b border-slate-200 pb-3">Source Bias Analysis</h2>
                <div class="relative h-48 md:h-full"><canvas id="${canvasId}"></canvas></div>
            `;
            wrapper.appendChild(biasCard);
            setTimeout(() => renderBiasChart(result.evidence, canvasId), 0);
        }

        chatContainer.appendChild(wrapper);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    let charts = {};
    function renderBiasChart(evidence, canvasId) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;
        const biasCounts = { 'Left-leaning': 0, 'Center': 0, 'Right-leaning': 0 };
        evidence.forEach(item => { if (item.bias in biasCounts) biasCounts[item.bias]++; });
        
        if (charts[canvasId]) charts[canvasId].destroy();

        charts[canvasId] = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(biasCounts),
                datasets: [{
                    data: Object.values(biasCounts),
                    backgroundColor: ['#3B82F6', '#6B7280', '#EF4444'],
                    borderColor: 'rgba(255, 255, 255, 0.7)',
                    borderWidth: 4,
                    hoverOffset: 8
                }]
            },
            options: { 
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    legend: { display: false },
                    tooltip: { 
                        displayColors: false,
                        backgroundColor: '#1e293b',
                        titleFont: { size: 16 },
                        bodyFont: { size: 14, weight: 'bold' }
                    }
                } 
            }
        });
    }

    function getVerdictUI(verdict, size = 'h-16 w-16') {
        const iconBaseClass = `${size}`;
        switch (verdict) {
            case "Confirmed": return { icon: `<svg class="${iconBaseClass} text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`, textColor: 'text-green-600' };
            case "Debunked": return { icon: `<svg class="${iconBaseClass} text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`, textColor: 'text-red-600' };
            case "Fundamentally False": return { icon: `<svg class="${iconBaseClass} text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>`, textColor: 'text-slate-700' };
            default: return { icon: `<svg class="${iconBaseClass} text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`, textColor: 'text-amber-600' };
        }
    }
});
