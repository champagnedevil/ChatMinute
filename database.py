import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
import hashlib
import os

class Database:
    def __init__(self, db_path: str = "dating_app.db"):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Инициализация базы данных и создание таблиц"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Таблица пользователей
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE,
                    password_hash TEXT NOT NULL,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    age INTEGER NOT NULL,
                    gender TEXT NOT NULL,
                    bio TEXT,
                    interests TEXT,
                    location_lat REAL DEFAULT 55.7558,
                    location_lng REAL DEFAULT 37.6173,
                    is_online BOOLEAN DEFAULT FALSE,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Таблица сессий матчей
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS match_sessions (
                    id TEXT PRIMARY KEY,
                    user1_id INTEGER NOT NULL,
                    user2_id INTEGER NOT NULL,
                    room_id TEXT UNIQUE NOT NULL,
                    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    user1_approval BOOLEAN,
                    user2_approval BOOLEAN,
                    is_matched BOOLEAN DEFAULT FALSE,
                    ended_at DATETIME,
                    FOREIGN KEY (user1_id) REFERENCES users (id),
                    FOREIGN KEY (user2_id) REFERENCES users (id)
                )
            ''')
            
            # Таблица связей (matches)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS connections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user1_id INTEGER NOT NULL,
                    user2_id INTEGER NOT NULL,
                    matched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE,
                    FOREIGN KEY (user1_id) REFERENCES users (id),
                    FOREIGN KEY (user2_id) REFERENCES users (id)
                )
            ''')
            
            conn.commit()
    
    def get_connection(self):
        """Получить соединение с базой данных"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    # Методы для работы с пользователями
    def create_user(self, user_data: Dict[str, Any]) -> int:
        """Создать нового пользователя"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO users (
                    username, email, password_hash, first_name, last_name, 
                    age, gender, bio, interests, location_lat, location_lng
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_data['username'],
                user_data.get('email'),
                user_data['password_hash'],
                user_data['first_name'],
                user_data['last_name'],
                user_data['age'],
                user_data['gender'],
                user_data.get('bio'),
                user_data.get('interests'),
                user_data.get('location_lat', 55.7558),
                user_data.get('location_lng', 37.6173)
            ))
            user_id = cursor.lastrowid
            conn.commit()
            return user_id
    
    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Получить пользователя по ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE id = ?', (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Получить пользователя по имени"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Получить пользователя по email"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE email = ?', (email,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def update_user(self, user_id: int, update_data: Dict[str, Any]):
        """Обновить данные пользователя"""
        allowed_fields = ['first_name', 'last_name', 'age', 'gender', 'bio', 'interests', 'location_lat', 'location_lng']
        set_clause = []
        values = []
        
        for field in allowed_fields:
            if field in update_data:
                set_clause.append(f"{field} = ?")
                values.append(update_data[field])
        
        if not set_clause:
            return
        
        values.append(user_id)
        set_clause.append("updated_at = CURRENT_TIMESTAMP")
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f'''
                UPDATE users 
                SET {', '.join(set_clause)}
                WHERE id = ?
            ''', values)
            conn.commit()
    
    def update_user_online_status(self, user_id: int, is_online: bool):
        """Обновить онлайн статус пользователя"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE users 
                SET is_online = ?, last_seen = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (is_online, user_id))
            conn.commit()
    
    # Методы для работы с матч-сессиями
    def create_match_session(self, user1_id: int, user2_id: int, room_id: str, session_id: str):
        """Создать сессию матча"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO match_sessions (id, user1_id, user2_id, room_id)
                VALUES (?, ?, ?, ?)
            ''', (session_id, user1_id, user2_id, room_id))
            conn.commit()
    
    def get_match_session_by_room(self, room_id: str) -> Optional[Dict[str, Any]]:
        """Получить сессию по room_id"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM match_sessions WHERE room_id = ?', (room_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def update_match_session_approval(self, session_id: str, user_id: int, approval: bool):
        """Обновить статус одобрения в сессии"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            # Определяем, какой пользователь (user1 или user2)
            cursor.execute('SELECT user1_id, user2_id FROM match_sessions WHERE id = ?', (session_id,))
            session = cursor.fetchone()
            
            if session:
                user1_id = session['user1_id']
                field = 'user1_approval' if user_id == user1_id else 'user2_approval'
                
                cursor.execute(f'''
                    UPDATE match_sessions 
                    SET {field} = ?
                    WHERE id = ?
                ''', (approval, session_id))
                conn.commit()
    
    def complete_match_session(self, session_id: str, is_matched: bool = False):
        """Завершить сессию матча"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE match_sessions 
                SET ended_at = CURRENT_TIMESTAMP, is_matched = ?
                WHERE id = ?
            ''', (is_matched, session_id))
            conn.commit()
    
    def create_connection(self, user1_id: int, user2_id: int):
        """Создать связь между пользователями"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO connections (user1_id, user2_id)
                VALUES (?, ?)
            ''', (min(user1_id, user2_id), max(user1_id, user2_id)))
            conn.commit()
    
    # Методы для статистики
    def get_stats(self) -> Dict[str, int]:
        """Получить статистику приложения"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            cursor.execute('SELECT COUNT(*) as total FROM users')
            total_users = cursor.fetchone()['total']
            
            cursor.execute('SELECT COUNT(*) as online FROM users WHERE is_online = TRUE')
            online_users = cursor.fetchone()['online']
            
            cursor.execute('SELECT COUNT(*) as matches FROM connections')
            total_matches = cursor.fetchone()['matches']
            
            cursor.execute('SELECT COUNT(*) as sessions FROM match_sessions WHERE ended_at IS NULL')
            active_sessions = cursor.fetchone()['sessions']
            
            return {
                'total_users': total_users,
                'online_users': online_users,
                'total_matches': total_matches,
                'active_sessions': active_sessions
            }

# Глобальный экземпляр базы данных
db = Database()