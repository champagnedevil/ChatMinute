from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Form, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import math
import os
import socket

from database import db
from auth import verify_password, get_password_hash, create_access_token, verify_token

app = FastAPI(title="Video Dating App")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

# In-memory хранилище для активных сессий
waiting_users = []
active_timers = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        
        # Обновляем статус пользователя в БД
        db.update_user_online_status(user_id, True)
    
    def disconnect(self, user_id: int):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        
        # Обновляем статус пользователя в БД
        db.update_user_online_status(user_id, False)
    
    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except:
                self.disconnect(user_id)

manager = ConnectionManager()

# Зависимость для аутентификации
async def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    
    token = auth_header[7:]
    payload = verify_token(token)
    if not payload:
        return None
    
    user_id = int(payload.get("sub"))
    user = db.get_user_by_id(user_id)
    return user

# Вспомогательные функции
def calculate_distance(lat1, lng1, lat2, lng2):
    """Упрощенный расчет расстояния"""
    return math.sqrt((lat1 - lat2)**2 + (lng1 - lng2)**2)

def find_best_match(current_user_data):
    """Найти лучшего собеседника"""
    if not waiting_users:
        return None
    
    best_match = None
    best_score = float('inf')
    
    for candidate in waiting_users:
        if candidate['user_id'] == current_user_data['user_id']:
            continue
        
        candidate_user = db.get_user_by_id(candidate['user_id'])
        if not candidate_user:
            continue
        
        # Проверяем противоположный пол
        if candidate['gender'] == current_user_data['gender']:
            continue
        
        # Проверяем разницу в возрасте (максимум 10 лет)
        age_diff = abs(candidate['age'] - current_user_data['age'])
        if age_diff > 10:
            continue
        
        # Рассчитываем расстояние и score
        distance = calculate_distance(
            current_user_data['location'][0], current_user_data['location'][1],
            candidate['location'][0], candidate['location'][1]
        )
        
        score = distance + age_diff * 5
        
        if score < best_score:
            best_score = score
            best_match = candidate
    
    return best_match

async def start_session_timer(session_id: str, room_id: str, user1_id: int, user2_id: int):
    """Запустить таймер сессии"""
    await asyncio.sleep(60)  # 1 минута
    
    # Проверяем, существует ли еще сессия
    session = db.get_match_session_by_room(room_id)
    if not session or session.get('ended_at'):
        return
    
    # Если время вышло и нет mutual like - завершаем сессию
    if not (session['user1_approval'] and session['user2_approval']):
        db.complete_match_session(session_id, False)
        
        # Уведомляем пользователей
        await manager.send_personal_message({
            "type": "time_expired",
            "message": "Время вышло! Продолжаем поиск..."
        }, user1_id)
        
        await manager.send_personal_message({
            "type": "time_expired", 
            "message": "Время вышло! Продолжаем поиск..."
        }, user2_id)

# API endpoints
@app.post("/api/register")
async def register(
    username: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    first_name: str = Form(...),
    last_name: str = Form(...),
    age: int = Form(...),
    gender: str = Form(...),
    bio: str = Form(""),
    interests: str = Form(""),
    location_lat: float = Form(55.7558),
    location_lng: float = Form(37.6173)
):
    # Проверяем, не существует ли пользователь
    existing_user = db.get_user_by_username(username)
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Пользователь с таким именем уже существует"
        )
    
    if email:
        existing_email = db.get_user_by_email(email)
        if existing_email:
            raise HTTPException(
                status_code=400,
                detail="Пользователь с таким email уже существует"
            )
    
    # Создаем пользователя
    user_data = {
        'username': username,
        'email': email,
        'password_hash': get_password_hash(password),
        'first_name': first_name,
        'last_name': last_name,
        'age': age,
        'gender': gender,
        'bio': bio,
        'interests': interests,
        'location_lat': location_lat,
        'location_lng': location_lng
    }
    
    user_id = db.create_user(user_data)
    user = db.get_user_by_id(user_id)
    
    # Создаем токен
    access_token = create_access_token(
        data={"sub": str(user_id)},
        expires_delta=timedelta(minutes=60 * 24 * 7)  # 7 дней
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user['id'],
            "username": user['username'],
            "first_name": user['first_name'],
            "last_name": user['last_name'],
            "age": user['age'],
            "gender": user['gender']
        }
    }

@app.post("/api/login")
async def login(
    username: str = Form(...),
    password: str = Form(...)
):
    user = db.get_user_by_username(username)
    if not user or not verify_password(password, user['password_hash']):
        raise HTTPException(
            status_code=401,
            detail="Неверное имя пользователя или пароль"
        )
    
    # Создаем токен
    access_token = create_access_token(
        data={"sub": str(user['id'])},
        expires_delta=timedelta(minutes=60 * 24 * 7)  # 7 дней
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user['id'],
            "username": user['username'],
            "first_name": user['first_name'],
            "last_name": user['last_name'],
            "age": user['age'],
            "gender": user['gender']
        }
    }

@app.get("/api/profile")
async def get_profile(current_user: dict = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    return {
        "id": current_user['id'],
        "username": current_user['username'],
        "email": current_user['email'],
        "first_name": current_user['first_name'],
        "last_name": current_user['last_name'],
        "age": current_user['age'],
        "gender": current_user['gender'],
        "bio": current_user['bio'],
        "interests": current_user['interests'],
        "location_lat": current_user['location_lat'],
        "location_lng": currentUser['location_lng'],
        "is_online": bool(current_user['is_online']),
        "last_seen": current_user['last_seen']
    }

@app.put("/api/profile")
async def update_profile(
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    update_data = await request.json()
    
    # Обновляем пользователя
    db.update_user(current_user['id'], update_data)
    
    return {"status": "success", "message": "Профиль обновлен"}

@app.get("/api/user/{user_id}")
async def get_user(user_id: int):
    user = db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "id": user['id'],
        "username": user['username'],
        "first_name": user['first_name'],
        "last_name": user['last_name'],
        "age": user['age'],
        "gender": user['gender'],
        "bio": user['bio']
    }

# WebSocket endpoint с аутентификацией
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, token: str = None):
    # Проверяем аутентификацию
    if not token:
        await websocket.close(code=1008)
        return
    
    payload = verify_token(token)
    if not payload or int(payload.get("sub")) != user_id:
        await websocket.close(code=1008)
        return
    
    await manager.connect(websocket, user_id)
    
    try:
        while True:
            data = await websocket.receive_json()
            await handle_websocket_message(data, user_id)
    
    except WebSocketDisconnect:
        await handle_disconnect(user_id)
    except Exception as e:
        print(f"WebSocket error: {e}")
        await handle_disconnect(user_id)

async def handle_websocket_message(data: dict, user_id: int):
    message_type = data.get("type")
    
    if message_type == "start_search":
        await handle_start_search(data, user_id)
            
    elif message_type == "stop_search":
        await handle_stop_search(user_id)
            
    elif message_type == "approve":
        await handle_approve(data, user_id)
            
    elif message_type == "reject":
        await handle_reject(data, user_id)
            
    elif message_type == "webrtc_offer":
        await handle_webrtc_signal(data, user_id, "offer")
            
    elif message_type == "webrtc_answer":
        await handle_webrtc_signal(data, user_id, "answer")
            
    elif message_type == "ice_candidate":
        await handle_webrtc_signal(data, user_id, "candidate")

async def handle_start_search(data: dict, user_id: int):
    """Обработка начала поиска"""
    user = db.get_user_by_id(user_id)
    if not user:
        return
    
    user_data = {
        'user_id': user_id,
        'gender': user['gender'],
        'age': user['age'],
        'location': (user['location_lat'], user['location_lng'])
    }
    
    # Добавляем в очередь поиска
    if not any(u['user_id'] == user_id for u in waiting_users):
        waiting_users.append(user_data)
    
    await manager.send_personal_message({
        "type": "search_started",
        "message": "Поиск собеседника начат..."
    }, user_id)
    
    # Ищем матч
    matched_user = find_best_match(user_data)
    
    if matched_user:
        await create_match_session(user_id, matched_user['user_id'])
    else:
        await manager.send_personal_message({
            "type": "searching",
            "message": "Ищем подходящего собеседника..."
        }, user_id)

async def handle_stop_search(user_id: int):
    """Обработка остановки поиска"""
    # Удаляем из очереди ожидания
    waiting_users[:] = [u for u in waiting_users if u['user_id'] != user_id]
    
    await manager.send_personal_message({
        "type": "search_stopped",
        "message": "Поиск остановлен"
    }, user_id)

async def create_match_session(user1_id: int, user2_id: int):
    """Создать сессию матча"""
    room_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    
    db.create_match_session(user1_id, user2_id, room_id, session_id)
    
    # Удаляем из очереди ожидания
    waiting_users[:] = [u for u in waiting_users if u['user_id'] not in [user1_id, user2_id]]
    
    # Запускаем таймер
    asyncio.create_task(start_session_timer(session_id, room_id, user1_id, user2_id))
    
    # Уведомляем обоих пользователей
    await manager.send_personal_message({
        "type": "match_found",
        "room_id": room_id,
        "partner_id": user2_id,
        "message": "Собеседник найден! Подготовка к видеозвонку..."
    }, user1_id)
    
    await manager.send_personal_message({
        "type": "match_found",
        "room_id": room_id,
        "partner_id": user1_id,
        "message": "Собеседник найден! Подготовка к видеозвонку..."
    }, user2_id)

async def handle_approve(data: dict, user_id: int):
    """Обработка одобрения собеседника"""
    room_id = data.get("room_id")
    
    session = db.get_match_session_by_room(room_id)
    if not session:
        return
    
    db.update_match_session_approval(session['id'], user_id, True)
    
    # Проверяем mutual like
    session_updated = db.get_match_session_by_room(room_id)
    if session_updated['user1_approval'] and session_updated['user2_approval']:
        await handle_mutual_match(session_updated)

async def handle_mutual_match(session: dict):
    """Обработка взаимного согласия - НЕ разрываем соединение"""
    db.complete_match_session(session['id'], True)
    db.create_connection(session['user1_id'], session['user2_id'])
    
    # Уведомляем обоих пользователей о успешном матче
    await manager.send_personal_message({
        "type": "match_success",
        "message": "🎉 Вы понравились друг другу! Теперь вы можете общаться дальше.",
        "room_id": session['room_id']  # Важно: отправляем room_id для продолжения общения
    }, session['user1_id'])
    
    await manager.send_personal_message({
        "type": "match_success", 
        "message": "🎉 Вы понравились друг другу! Теперь вы можете общаться дальше.",
        "room_id": session['room_id']  # Важно: отправляем room_id для продолжения общения
    }, session['user2_id'])

async def handle_reject(data: dict, user_id: int):
    """Обработка отклонения собеседника"""
    room_id = data.get("room_id")
    
    session = db.get_match_session_by_room(room_id)
    if not session:
        return
    
    db.complete_match_session(session['id'], False)
    
    # Уведомляем другого пользователя
    other_user_id = session['user2_id'] if session['user1_id'] == user_id else session['user1_id']
    await manager.send_personal_message({
        "type": "match_rejected",
        "message": "Собеседник решил продолжить поиск"
    }, other_user_id)

async def handle_webrtc_signal(data: dict, user_id: int, signal_type: str):
    """Обработка WebRTC сигналов"""
    target_user_id = data.get("target_user_id")
    if not target_user_id:
        print(f"❌ No target_user_id in {signal_type} from {user_id}")
        return
    
    message = {
        "type": f"webrtc_{signal_type}",
        signal_type: data.get(signal_type),
        "from_user_id": user_id
    }
    
    # Добавляем логирование для отладки
    print(f"📨 WebRTC {signal_type} from {user_id} to {target_user_id}")
    
    try:
        await manager.send_personal_message(message, target_user_id)
        print(f"✅ WebRTC {signal_type} delivered to {target_user_id}")
    except Exception as e:
        print(f"❌ Error sending WebRTC {signal_type}: {e}")

async def handle_disconnect(user_id: int):
    """Обработка отключения пользователя"""
    manager.disconnect(user_id)
    # Удаляем из очереди ожидания
    waiting_users[:] = [u for u in waiting_users if u['user_id'] != user_id]

@app.get("/")
async def read_root():
    """Главная страница"""
    try:
        # Пытаемся прочитать index.html из static директории
        return FileResponse("static/index.html")
    except Exception as e:
        # Если файл не найден, возвращаем простую HTML страницу
        html_content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Video Dating App</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .status { padding: 20px; background: #f0f0f0; border-radius: 5px; }
            </style>
        </head>
        <body>
            <h1>Video Dating App</h1>
            <div class="status">
                <p>🚀 Сервер запущен и работает!</p>
                <p>📁 Убедитесь, что файлы находятся в папке <code>static</code></p>
                <p>🔧 Проверьте консоль сервера для отладки</p>
            </div>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content)

@app.get("/api/stats")
async def get_stats():
    """Получить статистику приложения"""
    stats = db.get_stats()
    stats['waiting_users'] = len(waiting_users)
    return stats

@app.get("/health")
async def health_check():
    """Проверка здоровья сервера"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}

@app.get("/api/ice-servers")
async def get_ice_servers(request: Request):
    """ICE серверы с нашим Coturn"""
    
    # Получаем все сетевые интерфейсы
    hostname = socket.gethostname()
    local_ip = socket.gethostbyname(hostname)
    
    return {
        "iceServers": [
            # STUN серверы (IP адреса чтобы избежать DNS)
            {
                "urls": [
                    "stun:74.125.200.127:19302",  # stun.l.google.com
                    "stun:74.125.142.127:19302",  # stun1.l.google.com
                    "stun:142.250.64.127:19302",  # stun2.l.google.com
                    f"stun:{local_ip}:3478",      # Локальный STUN
                    f"stun:82.202.139.143:3478"   # Публичный STUN
                ]
            },
            # Наш TURN сервер (Coturn)
            {
                "urls": [
                    "turn:82.202.139.143:3478?transport=udp",
                    "turn:82.202.139.143:3478?transport=tcp",
                    "turns:82.202.139.143:5349?transport=tcp"
                ],
                "username": "test_09",
                "credential": "test_09",
                "credentialType": "password"
            },
            # Резервные TURN серверы
            {
                "urls": [
                    "turn:34.117.8.253:80",  # relay.metered.ca
                    "turn:34.117.8.253:443",
                    "turn:34.117.8.253:443?transport=tcp"
                ],
                "username": "9b71e30dd46f2849df329b56",
                "credential": "YnvX4nWJy9A18IVI"
            }
        ],
        "iceTransportPolicy": "all",
        "iceCandidatePoolSize": 10
    }

@app.get("/api/debug/webrtc")
async def debug_webrtc():
    """Отладочная информация о WebRTC"""
    return {
        "timestamp": datetime.now().isoformat(),
        "active_connections": len(manager.active_connections),
        "waiting_users": len(waiting_users),
        "active_sessions": len([u for u in waiting_users if u.get('in_session')]),
        "server_info": {
            "python_version": os.sys.version,
            "platform": os.sys.platform
        }
    }

@app.get("/api/test/turn")
async def test_turn():
    """Тест TURN сервера"""
    import subprocess
    try:
        # Пробуем подключиться к TURN
        result = subprocess.run(
            ["timeout", "5", "nc", "-zv", "82.202.139.143", "3478"],
            capture_output=True,
            text=True
        )
        
        return {
            "status": "success" if result.returncode == 0 else "error",
            "output": result.stdout + result.stderr,
            "turn_server": "82.202.139.143:3478",
            "credentials": "test_09:test_09"
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("🚀 Запуск Video Dating App с Coturn...")
    print("🌐 Ваш IP: 82.202.139.143")
    print("📡 TURN сервер: 82.202.139.143:3478")
    print("👤 Логин: test_09 | Пароль: test_09")
    print("=" * 60)
    print("🌐 Сервер будет доступен по адресу: http://localhost:8000")
    print("📡 Для тестирования TURN: http://localhost:8000/api/test/turn")
    print("=" * 60)
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)