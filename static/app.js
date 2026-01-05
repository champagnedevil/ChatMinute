let ws = null;
let currentUser = null;
let currentRoom = null;
let timerInterval = null;
let timeLeft = 60;
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let authToken = localStorage.getItem('authToken');

// Базовая конфигурация с нашим Coturn
let configuration = {
    iceServers: [
        // STUN серверы (IP адреса)
        {
            urls: [
                'stun:74.125.200.127:19302',  // stun.l.google.com
                'stun:74.125.142.127:19302',  // stun1.l.google.com
                'stun:142.250.64.127:19302',  // stun2.l.google.com
                'stun:82.202.139.143:3478'    // Наш STUN
            ]
        },
        // Наш TURN сервер (Coturn)
        {
            urls: [
                'turn:82.202.139.143:3478?transport=udp',
                'turn:82.202.139.143:3478?transport=tcp',
                'turns:82.202.139.143:5349?transport=tcp'
            ],
            username: 'test_09',
            credential: 'test_09',
            credentialType: 'password'
        }
    ],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 10
};

// Элементы DOM
const loginScreen = document.getElementById('loginScreen');
const registerScreen = document.getElementById('registerScreen');
const mainScreen = document.getElementById('mainScreen');
const userInfo = document.getElementById('userInfo');
const userName = document.getElementById('userName');
const profileInfo = document.getElementById('profileInfo');
const statsInfo = document.getElementById('statsInfo');
const startSearchBtn = document.getElementById('startSearchBtn');
const stopSearchBtn = document.getElementById('stopSearchBtn');
const status = document.getElementById('status');
const videoChat = document.getElementById('videoChat');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const timer = document.getElementById('timer');
const partnerName = document.getElementById('partnerName');

// Глобальная переменная для хранения информации о собеседнике
let currentPartner = null;
let iceCandidatesCount = 0;
let turnServerUsed = false;

// Проверка аутентификации при загрузке
document.addEventListener('DOMContentLoaded', function() {
    console.log('📱 Приложение загружено');
    console.log('🌐 Наш TURN сервер: 82.202.139.143:3478');
    console.log('👤 Логин: test_09, Пароль: test_09');
    
    if (authToken) {
        checkAuth();
    } else {
        showLoginScreen();
    }
    
    setupMobileHandlers();
});

function setupMobileHandlers() {
    document.addEventListener('dblclick', function(e) {
        e.preventDefault();
    }, { passive: false });
    
    document.addEventListener('touchstart', function() {}, { passive: true });
}

async function checkAuth() {
    try {
        const response = await fetch('/api/profile', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            currentUser = await response.json();
            showMainScreen();
        } else {
            localStorage.removeItem('authToken');
            authToken = null;
            showLoginScreen();
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        showLoginScreen();
    }
}

// Функции для переключения экранов
function showLoginScreen() {
    loginScreen.classList.remove('hidden');
    registerScreen.classList.add('hidden');
    mainScreen.classList.add('hidden');
    videoChat.classList.add('hidden');
}

function showRegisterScreen() {
    loginScreen.classList.add('hidden');
    registerScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
    videoChat.classList.add('hidden');
}

function showMainScreen() {
    loginScreen.classList.add('hidden');
    registerScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    videoChat.classList.add('hidden');
    
    userName.textContent = `${currentUser.first_name} ${currentUser.last_name}`;
    initializeWebSocket();
    loadUserProfile();
    loadStats();
    
    // Тестируем TURN сервер при загрузке
    setTimeout(testTurnServer, 2000);
}

// Функция для получения текущего местоположения
function getCurrentLocation() {
    if (!navigator.geolocation) {
        alert('Геолокация не поддерживается вашим браузером');
        return;
    }

    status.textContent = 'Определяем ваше местоположение...';
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            const latInputs = document.querySelectorAll('input[id*="Lat"]');
            const lngInputs = document.querySelectorAll('input[id*="Lng"]');
            
            latInputs.forEach(input => input.value = lat.toFixed(6));
            lngInputs.forEach(input => input.value = lng.toFixed(6));
            
            status.textContent = `Местоположение получено: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
            
            setTimeout(() => {
                status.textContent = '';
            }, 3000);
        },
        (error) => {
            console.error('Ошибка геолокации:', error);
            let errorMessage = 'Не удалось определить местоположение. ';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMessage += 'Разрешение на геолокацию отклонено.';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage += 'Информация о местоположении недоступна.';
                    break;
                case error.TIMEOUT:
                    errorMessage += 'Время ожидания геолокации истекло.';
                    break;
                default:
                    errorMessage += 'Произошла неизвестная ошибка.';
            }
            
            alert(errorMessage);
            status.textContent = 'Используются координаты по умолчанию (Москва)';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        }
    );
}

// Аутентификация
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('Пожалуйста, заполните все поля');
        return;
    }

    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            authToken = data.access_token;
            currentUser = data.user;
            
            localStorage.setItem('authToken', authToken);
            showMainScreen();
        } else {
            const errorData = await response.json();
            alert(errorData.detail || 'Ошибка входа');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Ошибка подключения к серверу');
    }
}

async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerConfirmPassword').value;
    const firstName = document.getElementById('registerFirstName').value.trim();
    const lastName = document.getElementById('registerLastName').value.trim();
    const age = parseInt(document.getElementById('registerAge').value);
    const gender = document.getElementById('registerGender').value;
    const bio = document.getElementById('registerBio').value.trim();
    const lat = parseFloat(document.getElementById('registerLat').value) || 55.7558;
    const lng = parseFloat(document.getElementById('registerLng').value) || 37.6173;

    if (!username || !email || !password || !firstName || !lastName || !age || !gender) {
        alert('Пожалуйста, заполните все обязательные поля');
        return;
    }

    if (password !== confirmPassword) {
        alert('Пароли не совпадают');
        return;
    }

    if (age < 18 || age > 100) {
        alert('Возраст должен быть от 18 до 100 лет');
        return;
    }

    const formData = new FormData();
    formData.append('username', username);
    formData.append('email', email);
    formData.append('password', password);
    formData.append('first_name', firstName);
    formData.append('last_name', lastName);
    formData.append('age', age);
    formData.append('gender', gender);
    formData.append('bio', bio);
    formData.append('location_lat', lat);
    formData.append('location_lng', lng);
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const data = await response.json();
            authToken = data.access_token;
            currentUser = data.user;
            
            localStorage.setItem('authToken', authToken);
            showMainScreen();
        } else {
            const errorData = await response.json();
            alert(errorData.detail || 'Ошибка регистрации');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Ошибка подключения к серверу');
    }
}

function logout() {
    if (ws) {
        ws.close();
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    localStorage.removeItem('authToken');
    authToken = null;
    currentUser = null;
    
    showLoginScreen();
}

// Функция для получения ICE серверов с сервера
async function getIceServers() {
    try {
        console.log('🔄 Запрашиваем ICE серверы с сервера...');
        const response = await fetch('/api/ice-servers');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('✅ Получены ICE серверы:', data.iceServers);
        
        // Обновляем глобальную конфигурацию
        configuration.iceServers = data.iceServers;
        
        return data.iceServers;
    } catch (error) {
        console.error('❌ Error getting ICE servers:', error);
        // Возвращаем нашу локальную конфигурацию
        return configuration.iceServers;
    }
}

// Тестирование TURN сервера
async function testTurnServer() {
    console.log('🧪 Тестируем TURN сервер...');
    
    try {
        const response = await fetch('/api/test/turn');
        const data = await response.json();
        
        if (data.status === 'success') {
            console.log('✅ TURN сервер работает!', data);
            status.textContent = '✅ TURN сервер готов к работе';
        } else {
            console.warn('⚠️ Проблемы с TURN сервером:', data);
            status.textContent = '⚠️ Проверьте настройки TURN сервера';
        }
    } catch (error) {
        console.error('❌ Ошибка тестирования TURN:', error);
    }
}

// Редактирование профиля
function showEditProfileModal() {
    document.getElementById('editFirstName').value = currentUser.first_name || '';
    document.getElementById('editLastName').value = currentUser.last_name || '';
    document.getElementById('editAge').value = currentUser.age || '';
    document.getElementById('editGender').value = currentUser.gender || '';
    document.getElementById('editBio').value = currentUser.bio || '';
    document.getElementById('editInterests').value = currentUser.interests || '';
    document.getElementById('editLat').value = currentUser.location_lat || 55.7558;
    document.getElementById('editLng').value = currentUser.location_lng || 37.6173;
    
    document.getElementById('editProfileModal').classList.remove('hidden');
}

function hideEditProfileModal() {
    document.getElementById('editProfileModal').classList.add('hidden');
}

async function updateProfile() {
    const firstName = document.getElementById('editFirstName').value.trim();
    const lastName = document.getElementById('editLastName').value.trim();
    const age = parseInt(document.getElementById('editAge').value);
    const gender = document.getElementById('editGender').value;
    const bio = document.getElementById('editBio').value.trim();
    const interests = document.getElementById('editInterests').value.trim();
    const lat = parseFloat(document.getElementById('editLat').value) || 55.7558;
    const lng = parseFloat(document.getElementById('editLng').value) || 37.6173;

    if (!firstName || !lastName || !age || !gender) {
        alert('Пожалуйста, заполните все обязательные поля');
        return;
    }

    if (age < 18 || age > 100) {
        alert('Возраст должен быть от 18 до 100 лет');
        return;
    }

    const updateData = {
        first_name: firstName,
        last_name: lastName,
        age: age,
        gender: gender,
        bio: bio,
        interests: interests,
        location_lat: lat,
        location_lng: lng
    };
    
    try {
        const response = await fetch('/api/profile', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
            const profileResponse = await fetch('/api/profile', {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            });
            
            if (profileResponse.ok) {
                currentUser = await profileResponse.json();
                loadUserProfile();
                hideEditProfileModal();
                alert('Профиль успешно обновлен!');
            }
        } else {
            const errorData = await response.json();
            alert(errorData.detail || 'Ошибка обновления профиля');
        }
    } catch (error) {
        console.error('Update profile error:', error);
        alert('Ошибка подключения к серверу');
    }
}

function initializeWebSocket() {
    if (!authToken || !currentUser) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentUser.id}?token=${authToken}`;
    
    console.log('🔌 Подключаем WebSocket:', wsUrl);
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('✅ WebSocket connected');
        status.textContent = 'Подключено к серверу';
        setTimeout(() => {
            status.textContent = 'Готов к поиску собеседников';
        }, 2000);
    };
    
    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log('📨 WebSocket message:', message.type, message);
        handleWebSocketMessage(message);
    };
    
    ws.onclose = (event) => {
        console.log('❌ WebSocket disconnected:', event.code, event.reason);
        status.textContent = 'Отключено от сервера';
        
        setTimeout(() => {
            if (authToken && currentUser) {
                console.log('🔄 Пытаемся переподключиться...');
                initializeWebSocket();
            }
        }, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        status.textContent = 'Ошибка подключения';
    };
}

function handleWebSocketMessage(message) {
    console.log('Received message type:', message.type);
    
    switch (message.type) {
        case 'search_started':
            status.textContent = '🔍 Ищем подходящего собеседника...';
            startSearchBtn.classList.add('hidden');
            stopSearchBtn.classList.remove('hidden');
            break;
            
        case 'searching':
            status.textContent = message.message;
            break;
            
        case 'match_found':
            handleMatchFound(message);
            break;
            
        case 'match_success':
            handleMatchSuccess(message);
            break;
            
        case 'match_rejected':
            handleMatchRejected(message);
            break;
            
        case 'time_expired':
            handleTimeExpired(message);
            break;
            
        case 'webrtc_offer':
            handleWebRTCOffer(message);
            break;
            
        case 'webrtc_answer':
            handleWebRTCAnswer(message);
            break;
            
        case 'ice_candidate':
            handleICECandidate(message);
            break;
    }
}

async function handleMatchFound(message) {
    console.log('✅ Match found! Partner ID:', message.partner_id, 'Room:', message.room_id);
    currentRoom = message.room_id;
    status.textContent = message.message;
    
    try {
        const partnerResponse = await fetch(`/api/user/${message.partner_id}`);
        if (partnerResponse.ok) {
            const partner = await partnerResponse.json();
            
            document.getElementById('partnerFullName').textContent = `${partner.first_name} ${partner.last_name}`;
            document.getElementById('partnerAge').textContent = `${partner.age} лет`;
            document.getElementById('partnerName').textContent = `${partner.first_name}, ${partner.age}`;
            
            currentPartner = partner;
        }
    } catch (error) {
        console.error('Error fetching partner info:', error);
        document.getElementById('partnerFullName').textContent = 'Собеседник';
        document.getElementById('partnerAge').textContent = '';
    }
    
    await startVideoCall();
    startTimer();
}

async function startVideoCall() {
    try {
        console.log('🎥 Запрашиваем доступ к камере и микрофону...');
        
        await getIceServers();
        
        const constraintsOptions = [
            { video: true, audio: true },
            { video: { facingMode: 'user' }, audio: true },
            { video: false, audio: true }
        ];

        let lastError;
        
        for (const constraints of constraintsOptions) {
            try {
                console.log('🔄 Пробуем конфигурацию:', constraints);
                localStream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log('✅ Успешно получен медиапоток');
                break;
            } catch (error) {
                console.log('❌ Ошибка с конфигурацией:', constraints, error);
                lastError = error;
                continue;
            }
        }

        if (!localStream) {
            console.warn('⚠️ Не удалось получить доступ к камере/микрофону');
        } else {
            localVideo.srcObject = localStream;
            
            await new Promise((resolve) => {
                localVideo.onloadedmetadata = resolve;
            });

            console.log('✅ Локальное видео загружено');
        }

        await createPeerConnection();
        
        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        
        await peerConnection.setLocalDescription(offer);
        
        console.log('📤 Отправляем WebRTC offer партнеру:', getPartnerId());
        
        sendWebSocketMessage({
            type: 'webrtc_offer',
            offer: offer,
            target_user_id: getPartnerId()
        });
        
        videoChat.classList.remove('hidden');
        document.querySelector('.profile-section').classList.add('hidden');
        document.querySelector('.stats-section').classList.add('hidden');
        document.querySelector('.controls').classList.add('hidden');
        
    } catch (error) {
        console.error('❌ Error starting video call:', error);
        
        let errorMessage = '❌ ';
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Доступ к камере/микрофону запрещен. ';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'Камера/микрофон не найдены. ';
        } else if (error.name === 'NotReadableError') {
            errorMessage += 'Не удалось получить доступ к камере/микрофону. ';
        } else {
            errorMessage += 'Ошибка доступа к медиаустройствам. ';
        }
        errorMessage += 'Вы можете продолжить без видео.';
        
        status.textContent = errorMessage;
        
        videoChat.classList.remove('hidden');
        document.querySelector('.profile-section').classList.add('hidden');
        document.querySelector('.stats-section').classList.add('hidden');
        document.querySelector('.controls').classList.add('hidden');
        
        try {
            await createPeerConnection();
        } catch (pcError) {
            console.error('❌ Error creating peer connection:', pcError);
        }
        
        startTimer();
    }
}

async function createPeerConnection() {
    try {
        console.log('🔄 Создаем Peer Connection с Coturn...');
        
        const iceServers = await getIceServers();
        
        const pcConfig = {
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 10
        };
        
        console.log('📋 Конфигурация PeerConnection:', pcConfig);
        
        peerConnection = new RTCPeerConnection(pcConfig);
        
        if (localStream) {
            localStream.getTracks().forEach(track => {
                console.log(`🎯 Добавляем локальный трек: ${track.kind}`);
                peerConnection.addTrack(track, localStream);
            });
        }
        
        peerConnection.ontrack = (event) => {
            console.log('✅ Получен удаленный поток!', event);
            console.log('Streams:', event.streams);
            console.log('Track:', event.track);
            
            if (event.streams && event.streams[0]) {
                remoteStream = event.streams[0];
                console.log('🎯 Устанавливаем remoteVideo srcObject');
                
                const remoteVideo = document.getElementById('remoteVideo');
                
                if (remoteVideo.srcObject) {
                    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                }
                
                remoteVideo.srcObject = remoteStream;
                
                setTimeout(() => {
                    remoteVideo.play()
                        .then(() => {
                            console.log('✅ Видео воспроизводится');
                            status.textContent = '✅ Видеосвязь установлена!';
                            remoteVideo.style.border = '3px solid #4CAF50';
                            
                            const forceBtn = document.getElementById('forcePlayBtn');
                            if (forceBtn) forceBtn.style.display = 'none';
                        })
                        .catch(error => {
                            console.error('❌ Ошибка воспроизведения:', error);
                            showForcePlayButton();
                        });
                }, 1000);
                
                event.track.onmute = () => console.log('Track muted');
                event.track.onunmute = () => console.log('Track unmuted');
                event.track.onended = () => console.log('Track ended');
            }
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                iceCandidatesCount++;
                if (document.getElementById('iceCandidates')) {
                    document.getElementById('iceCandidates').textContent = iceCandidatesCount;
                }
                
                console.log('📨 ICE кандидат:', event.candidate.type, event.candidate.candidate);
                
                if (event.candidate.type === 'relay') {
                    console.log('✅ Используется TURN сервер!');
                    turnServerUsed = true;
                    if (document.getElementById('turnUsed')) {
                        document.getElementById('turnUsed').textContent = 'да';
                        document.getElementById('turnUsed').style.color = '#4CAF50';
                    }
                }
                
                if (event.candidate.candidate && event.candidate.candidate.includes('82.202.139.143')) {
                    console.log('✅ Наш TURN сервер обнаружен в кандидате');
                }
                
                sendWebSocketMessage({
                    type: 'ice_candidate',
                    candidate: event.candidate,
                    target_user_id: getPartnerId()
                });
            } else {
                console.log('✅ Все ICE candidates собраны');
                console.log('Всего кандидатов:', iceCandidatesCount);
                console.log('TURN используется:', turnServerUsed);
            }
        };
        
        peerConnection.onicecandidateerror = (event) => {
            console.log('ℹ️ ICE candidate error (игнорируем):', event.errorCode, event.errorText);
        };
        
        peerConnection.onconnectionstatechange = () => {
            console.log('🔗 Состояние соединения:', peerConnection.connectionState);
            updateDebugInfo();
            
            switch(peerConnection.connectionState) {
                case 'connected':
                    status.textContent = '✅ Соединение установлено';
                    break;
                case 'disconnected':
                    status.textContent = '⚠️ Соединение прервано';
                    break;
                case 'failed':
                    status.textContent = '❌ Ошибка соединения';
                    setTimeout(() => {
                        if (currentRoom) {
                            restartIce();
                        }
                    }, 2000);
                    break;
                case 'connecting':
                    status.textContent = '🔄 Устанавливаем соединение...';
                    break;
            }
        };
        
        peerConnection.oniceconnectionstatechange = () => {
            console.log('🧊 ICE состояние:', peerConnection.iceConnectionState);
            updateDebugInfo();
            
            if (peerConnection.iceConnectionState === 'connected') {
                console.log('✅ ICE соединение установлено');
            }
        };
        
        peerConnection.onsignalingstatechange = () => {
            console.log('📡 Сигнальное состояние:', peerConnection.signalingState);
            updateDebugInfo();
        };
        
        return peerConnection;
    } catch (error) {
        console.error('❌ Error creating peer connection:', error);
        throw error;
    }
}

function forceVideoPlay() {
    const remoteVideo = document.getElementById('remoteVideo');
    if (remoteVideo && remoteVideo.srcObject) {
        console.log('🔄 Принудительное воспроизведение видео...');
        
        remoteVideo.pause();
        const stream = remoteVideo.srcObject;
        remoteVideo.srcObject = null;
        
        setTimeout(() => {
            remoteVideo.srcObject = stream;
            
            let attempts = 0;
            const tryPlay = () => {
                attempts++;
                if (attempts > 5) {
                    console.error('❌ Превышено количество попыток');
                    return;
                }
                
                remoteVideo.play()
                    .then(() => {
                        console.log(`✅ Видео воспроизводится (попытка ${attempts})`);
                        remoteVideo.style.border = '3px solid #4CAF50';
                        
                        const forceBtn = document.getElementById('forcePlayBtn');
                        if (forceBtn) forceBtn.style.display = 'none';
                    })
                    .catch(error => {
                        console.warn(`⚠️ Попытка ${attempts} не удалась:`, error.message);
                        setTimeout(tryPlay, 500);
                    });
            };
            
            tryPlay();
        }, 100);
    }
}

function showForcePlayButton() {
    if (!document.getElementById('forcePlayBtn')) {
        const btn = document.createElement('button');
        btn.id = 'forcePlayBtn';
        btn.innerHTML = '▶️ Включить видео';
        btn.style.cssText = `
            position: absolute;
            bottom: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: #4CAF50;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            z-index: 100;
            font-size: 16px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;
        btn.onclick = forceVideoPlay;
        document.querySelector('.video-container').appendChild(btn);
    }
}

async function restartIce() {
    if (!peerConnection) return;
    
    try {
        console.log('🔄 Перезапускаем ICE...');
        const offer = await peerConnection.createOffer({ iceRestart: true });
        await peerConnection.setLocalDescription(offer);
        
        sendWebSocketMessage({
            type: 'webrtc_offer',
            offer: offer,
            target_user_id: getPartnerId()
        });
    } catch (error) {
        console.error('Ошибка перезапуска ICE:', error);
    }
}

async function startSearch() {
    if (!currentUser) return;
    
    status.textContent = 'Подготавливаем поиск...';
    
    sendWebSocketMessage({
        type: 'start_search',
        gender: currentUser.gender,
        age: currentUser.age,
        lat: currentUser.location_lat || 55.7558,
        lng: currentUser.location_lng || 37.6173
    });
}

function stopSearch() {
    if (ws) {
        sendWebSocketMessage({
            type: 'stop_search'
        });
    }
    resetSearch();
}

function approveMatch() {
    if (currentRoom) {
        sendWebSocketMessage({
            type: 'approve',
            room_id: currentRoom
        });
        
        document.getElementById('approveBtn').style.background = '#2e7d32';
        document.getElementById('approveBtn').innerHTML = '💚';
        document.getElementById('approveBtn').style.transform = 'scale(1.1)';
    }
}

function rejectMatch() {
    if (currentRoom) {
        sendWebSocketMessage({
            type: 'reject',
            room_id: currentRoom
        });
        
        document.getElementById('rejectBtn').style.background = '#d32f2f';
        document.getElementById('rejectBtn').innerHTML = '❌';
        document.getElementById('rejectBtn').style.transform = 'scale(1.1)';
    }
}

async function handleMatchSuccess(message) {
    clearInterval(timerInterval);
    
    document.querySelector('.timer').textContent = '✓ Match!';
    document.querySelector('.timer').style.color = '#4CAF50';
    document.querySelector('.timer-label').textContent = 'вы понравились друг другу';
    
    document.getElementById('approveBtn').style.background = '#4CAF50';
    document.getElementById('approveBtn').innerHTML = '❤️';
    document.getElementById('approveBtn').style.transform = 'scale(1.1)';
    document.getElementById('approveBtn').disabled = true;
    
    document.getElementById('rejectBtn').style.background = '#666';
    document.getElementById('rejectBtn').innerHTML = '❤️';
    document.getElementById('rejectBtn').style.transform = 'scale(1.1)';
    document.getElementById('rejectBtn').disabled = true;
    
    document.getElementById('endChatBtn').classList.remove('hidden');
    document.querySelector('.chat-controls-overlay').classList.add('matched');
    
    status.textContent = message.message;
    loadStats();
    
    console.log('✅ Match successful! Video call continues...');
}

function handleMatchRejected(message) {
    status.textContent = message.message;
    
    setTimeout(() => {
        resetVideoCall();
        setTimeout(() => {
            startSearch();
        }, 1000);
    }, 2000);
}

function handleTimeExpired(message) {
    status.textContent = message.message;
    
    setTimeout(() => {
        resetVideoCall();
        setTimeout(() => {
            startSearch();
        }, 2000);
    }, 1000);
}

function startTimer() {
    timeLeft = 60;
    updateTimerDisplay();
    
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        
        if (timeLeft <= 10) {
            timer.style.color = '#ff6b6b';
        }
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            timer.textContent = '00:00';
            timer.style.color = '#ff6b6b';
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function resetSearch() {
    startSearchBtn.classList.remove('hidden');
    stopSearchBtn.classList.add('hidden');
    status.textContent = 'Поиск остановлен';
}

function resetVideoCall() {
    clearInterval(timerInterval);
    
    document.querySelector('.profile-section').classList.remove('hidden');
    document.querySelector('.stats-section').classList.remove('hidden');
    document.querySelector('.controls').classList.remove('hidden');
    
    videoChat.classList.add('hidden');
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    localVideo.srcObject = null;
    
    timer.style.color = 'white';
    timer.style.fontSize = '28px';
    timer.textContent = '01:00';
    document.querySelector('.timer-label').textContent = 'до принятия решения';
    
    document.getElementById('approveBtn').style.background = '';
    document.getElementById('approveBtn').innerHTML = '👍';
    document.getElementById('approveBtn').style.transform = '';
    document.getElementById('approveBtn').disabled = false;
    
    document.getElementById('rejectBtn').style.background = '';
    document.getElementById('rejectBtn').innerHTML = '👎';
    document.getElementById('rejectBtn').style.transform = '';
    document.getElementById('rejectBtn').disabled = false;
    
    document.getElementById('endChatBtn').classList.add('hidden');
    document.querySelector('.chat-controls-overlay').classList.remove('matched');
    
    iceCandidatesCount = 0;
    turnServerUsed = false;
    
    const forceBtn = document.getElementById('forcePlayBtn');
    if (forceBtn) forceBtn.remove();
    
    currentRoom = null;
    currentPartner = null;
    resetSearch();
}

function endConversation() {
    if (confirm('Завершить разговор и начать новый поиск?')) {
        resetVideoCall();
        status.textContent = 'Разговор завершен. Начинаем новый поиск...';
        setTimeout(() => {
            startSearch();
        }, 1000);
    }
}

async function handleWebRTCOffer(message) {
    console.log('📨 Получен WebRTC offer от', message.from_user_id);
    
    if (window.__processingOffer) {
        console.log('⚠️ Уже обрабатываем offer, игнорируем');
        return;
    }
    
    window.__processingOffer = true;
    
    try {
        if (!peerConnection || peerConnection.signalingState === 'closed') {
            if (peerConnection) peerConnection.close();
            await createPeerConnection();
        }
        
        if (peerConnection.signalingState !== 'stable') {
            console.log('⚠️ Signaling state не stable:', peerConnection.signalingState);
            
            if (peerConnection.signalingState === 'have-local-offer') {
                console.log('🔄 Игнорируем offer, так как уже отправили свой');
                return;
            }
        }
        
        console.log('🔄 Устанавливаем remote description...');
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
        console.log('✅ Remote description установлен');
        
        console.log('🔄 Создаем answer...');
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        console.log('✅ Local description установлен');
        
        sendWebSocketMessage({
            type: 'webrtc_answer',
            answer: answer,
            target_user_id: message.from_user_id
        });
        console.log('📨 Answer отправлен');
        
    } catch (error) {
        console.error('❌ Error handling WebRTC offer:', error);
        
        if (error.toString().includes('m-lines')) {
            console.log('🔄 Ошибка m-lines, пробуем через 1 секунду...');
            setTimeout(() => {
                handleWebRTCOffer(message);
            }, 1000);
        }
    } finally {
        window.__processingOffer = false;
    }
}

async function handleWebRTCAnswer(message) {
    console.log('📨 Получен WebRTC answer от', message.from_user_id);
    
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
            console.log('✅ Remote description (answer) установлен');
        } catch (error) {
            console.error('❌ Error setting remote description (answer):', error);
        }
    }
}

async function handleICECandidate(message) {
    if (peerConnection && message.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
            console.log('✅ ICE candidate добавлен');
        } catch (error) {
            console.error('❌ Error adding ICE candidate:', error);
        }
    }
}

function sendWebSocketMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('📤 Отправляем сообщение:', message.type);
        ws.send(JSON.stringify(message));
    } else {
        console.error('❌ WebSocket не подключен');
    }
}

async function loadUserProfile() {
    if (!currentUser) return;
    
    const lat = currentUser.location_lat || 55.7558;
    const lng = currentUser.location_lng || 37.6173;
    
    profileInfo.innerHTML = `
        <div class="profile-info-grid">
            <div class="profile-item">
                <strong>Имя:</strong> ${currentUser.first_name || ''} ${currentUser.last_name || ''}
            </div>
            <div class="profile-item">
                <strong>Возраст:</strong> ${currentUser.age || ''} лет
            </div>
            <div class="profile-item">
                <strong>Пол:</strong> ${getGenderText(currentUser.gender)}
            </div>
            <div class="profile-item">
                <strong>Местоположение:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}
            </div>
            ${currentUser.bio ? `<div class="profile-item"><strong>О себе:</strong> ${currentUser.bio}</div>` : ''}
            ${currentUser.interests ? `<div class="profile-item"><strong>Интересы:</strong> ${currentUser.interests}</div>` : ''}
        </div>
        <div style="margin-top: 15px;">
            <button onclick="showEditProfileModal()" class="edit-profile-btn">✏️ Редактировать профиль</button>
        </div>
    `;
}

function getGenderText(gender) {
    const genders = {
        'male': 'Мужской',
        'female': 'Женский',
        'other': 'Другой'
    };
    return genders[gender] || gender;
}

async function loadStats() {
    try {
        const response = await fetch('/api/stats');
        const stats = await response.json();
        
        statsInfo.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${stats.online_users || 0}</div>
                    <div class="stat-label">онлайн</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.waiting_users || 0}</div>
                    <div class="stat-label">ищут пару</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.active_sessions || 0}</div>
                    <div class="stat-label">общаются</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${stats.total_matches || 0}</div>
                    <div class="stat-label">matches</div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function getPartnerId() {
    return currentPartner ? currentPartner.id : null;
}

function updateDebugInfo() {
    if (peerConnection) {
        const connState = document.getElementById('connState');
        const iceState = document.getElementById('iceState');
        const sigState = document.getElementById('sigState');
        
        if (connState) connState.textContent = peerConnection.connectionState;
        if (iceState) iceState.textContent = peerConnection.iceConnectionState;
        if (sigState) sigState.textContent = peerConnection.signalingState;
        
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo) {
            console.log('Video element state:', {
                srcObject: !!remoteVideo.srcObject,
                paused: remoteVideo.paused,
                readyState: remoteVideo.readyState,
                videoWidth: remoteVideo.videoWidth,
                videoHeight: remoteVideo.videoHeight
            });
        }
    }
}

function checkVideoPlayback() {
    const video = document.getElementById('remoteVideo');
    if (video && video.srcObject && video.paused) {
        console.log('🔄 Проверка видео: пытаемся воспроизвести...');
        
        video.play()
            .then(() => {
                console.log('✅ Видео воспроизводится');
                const forceBtn = document.getElementById('forcePlayBtn');
                if (forceBtn) forceBtn.style.display = 'none';
            })
            .catch(e => {
                console.warn('⚠️ Автовоспроизведение заблокировано:', e.message);
                showForcePlayButton();
            });
    }
}

setInterval(checkVideoPlayback, 3000);

// Глобальные функции
window.testTURN = async function() {
    console.log('🧪 Тестируем TURN сервер...');
    
    try {
        const pc = new RTCPeerConnection(configuration);
        
        let candidates = [];
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE кандидат:', event.candidate.type, event.candidate.candidate);
                candidates.push(event.candidate);
                
                if (event.candidate.type === 'relay') {
                    console.log('✅ TURN сервер работает! Используется relay кандидат');
                    alert('✅ TURN сервер работает! Relay кандидат найден.');
                }
                
                if (event.candidate.candidate.includes('82.202.139.143')) {
                    console.log('✅ Наш TURN сервер обнаружен');
                }
            } else {
                console.log('✅ Все ICE кандидаты собраны');
                console.log('Всего кандидатов:', candidates.length);
                
                const relayCandidates = candidates.filter(c => c.type === 'relay');
                const srflxCandidates = candidates.filter(c => c.type === 'srflx');
                
                console.log('Relay (TURN):', relayCandidates.length);
                console.log('Server Reflexive (STUN):', srflxCandidates.length);
                
                if (relayCandidates.length === 0) {
                    console.warn('⚠️ TURN сервер не предоставил relay кандидатов');
                    alert('⚠️ TURN сервер не предоставил relay кандидатов. Проверьте настройки Coturn.');
                }
                
                pc.close();
            }
        };
        
        const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        
        console.log('✅ Тест TURN запущен...');
        
    } catch (error) {
        console.error('❌ Ошибка тестирования TURN:', error);
        alert('❌ Ошибка тестирования TURN: ' + error.message);
    }
};

window.forceVideoPlay = forceVideoPlay;
window.restartIce = restartIce;

document.addEventListener('DOMContentLoaded', function() {
    const editModal = document.getElementById('editProfileModal');
    if (editModal) {
        editModal.addEventListener('click', function(e) {
            if (e.target === this) {
                hideEditProfileModal();
            }
        });
    }
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            hideEditProfileModal();
        }
    });
    
    const debugSection = document.createElement('div');
    debugSection.innerHTML = `
        <div style="margin-top: 10px; text-align: center;">
            <button onclick="window.testTURN && window.testTURN()" style="background: #ff9800; color: white; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; margin-right: 10px;">
                🧪 Тестировать TURN
            </button>
            <button onclick="window.forceVideoPlay && window.forceVideoPlay()" style="background: #2196F3; color: white; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                🔄 Принудительно воспроизвести видео
            </button>
        </div>
    `;
    const statsSection = document.querySelector('.stats-section');
    if (statsSection) {
        statsSection.appendChild(debugSection);
    }
});